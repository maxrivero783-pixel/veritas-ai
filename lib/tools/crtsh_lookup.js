// Véritas v2.4 — /lib/tools/crtsh_lookup.js
// Busca certificados y subdominios publicos en crt.sh (certificate transparency).
// API publica. No requiere keyRotator.

const MAX_OUTPUT = 15000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  if (!args.domain?.trim()) return { success: false, error: 'Parametro "domain" es obligatorio.' };
  const limit = clamp(args.limit, 50, 1, 100);
  const domain = args.domain.trim();

  let resp;
  try {
    resp = await fetch('https://crt.sh/?q=' + encodeURIComponent(domain) + '&output=json', {
      headers: { 'User-Agent': 'Véritas/2.4 OSINT tool' },
    });
  } catch (e) {
    return { success: false, error: 'Error de conexion a crt.sh: ' + e.message };
  }

  let data;
  try { data = await resp.json(); } catch (e) {
    return { success: false, error: 'Respuesta invalida de crt.sh.' };
  }
  if (!Array.isArray(data)) {
    return { success: false, error: 'crt.sh no devolvio datos validos.' };
  }

  // Deduplicar por nombre de certificado
  const seen = new Set();
  const unique = [];
  for (const cert of data) {
    const name = cert.name_value;
    if (name && !seen.has(name)) {
      seen.add(name);
      unique.push(cert);
      if (unique.length >= limit) break;
    }
  }

  if (!unique.length) return { success: true, results: 0, output: 'crt.sh — sin certificados para: ' + domain };

  let text = 'crt.sh — ' + domain + ' (' + unique.length + ' certificados unicos)\n' + '='.repeat(60) + '\n';
  unique.forEach(function(c, i) {
    const names = String(c.name_value).replace(/\n/g, ', ');
    text += '#' + (i + 1) + ' ' + names + '\n';
    text += 'Issuer: ' + (c.issuer_name || 'N/D') + ' · Not before: ' + (c.not_before || 'N/D') + ' · Not after: ' + (c.not_after || 'N/D') + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';

  return { success: true, results: unique.length, output: text.trim(), domains: [...seen] };
}
