// ==============================================================================
// Véritas v2.4 — /lib/tools/crtsh_lookup.js
// ==============================================================================
// Busca certificados y subdominios públicos en crt.sh (certificate transparency).
// API pública, sin autenticación.
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query || args.domain;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio (dominio o patrón).' };

  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 100, 1), 500);

  try {
    // crt.sh busca por % en el nombre para obtener subdominios
    const search = query.includes('%') ? query : '%.' + query;
    const url = 'https://crt.sh/?q=' + encodeURIComponent(search) + '&output=json';

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      return { success: false, error: 'crt.sh HTTP ' + resp.status + ' (puede que esté sobrecargado, reintentar)' };
    }

    let data;
    try { data = await resp.json(); } catch (e) {
      return { success: false, error: 'crt.sh devolvió datos inválidos. Reintentar.' };
    }

    if (!Array.isArray(data)) data = [];

    // Deduplicar por nombre de certificado
    const seen = new Set();
    const unique = [];
    data.forEach(function(cert) {
      const name = (cert.name_value || '').split('\n')[0].trim().toLowerCase();
      if (name && !seen.has(name)) {
        seen.add(name);
        unique.push({
          name: name,
          issuer: cert.issuer_name || '',
          not_before: cert.not_before || '',
          not_after: cert.not_after || '',
        });
      }
    });

    const results = unique.slice(0, limit);

    if (!results.length) {
      return { success: true, results: [], message: 'Sin certificados para: ' + query };
    }

    let output = 'crt.sh — Certificados para ' + query + ' (' + results.length + ' únicos de ' + data.length + ' totales)\n';
    results.forEach(function(r, i) {
      output += '\n' + r.name;
      if (r.not_before) output += ' | Desde: ' + r.not_before.slice(0, 10);
      if (r.not_after) output += ' | Hasta: ' + r.not_after.slice(0, 10);
      if (r.issuer) output += '\n  Emisor: ' + r.issuer.split(',').slice(0, 2).join(', ');
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, total_unique: unique.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
