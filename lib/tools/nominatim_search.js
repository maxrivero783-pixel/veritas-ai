// ==============================================================================
// Véritas v2.4 — /lib/tools/nominatim_search.js
// ==============================================================================
// Geocodifica lugares con Nominatim/OpenStreetMap (pública, sin key).
// ==============================================================================

const MAX_OUTPUT = 10000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 5, 1), 10);
  const format = args.format || 'jsonv2';

  try {
    const params = new URLSearchParams({
      q: query,
      format: format,
      limit: String(limit),
      addressdetails: '1',
      namedetails: '1',
      accept_language: 'es,en',
    });

    const resp = await fetch('https://nominatim.openstreetmap.org/search?' + params.toString(), {
      headers: { 'User-Agent': 'VéritasAI/2.4 (OSINT research tool)' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { success: false, error: 'Nominatim HTTP ' + resp.status };
    const data = await resp.json();

    if (!data.length) {
      return { success: true, results: [], message: 'Sin resultados para: ' + query };
    }

    let output = 'Nominatim — "' + query + '"\n';
    const results = [];

    data.forEach(function(r, i) {
      const addr = r.address || {};
      output += '\n#' + (i + 1) + ' ' + (r.display_name || 'Sin nombre');
      output += '\nTipo: ' + (r.type || 'N/D') + ' | Clase: ' + (r.class || 'N/D');
      output += '\nLat: ' + r.lat + ' | Lon: ' + r.lon;
      if (addr.country) output += ' | País: ' + addr.country;
      if (addr.state || addr.region) output += ' | Estado: ' + (addr.state || addr.region);
      if (addr.city || addr.town || addr.village) output += ' | Ciudad: ' + (addr.city || addr.town || addr.village);
      if (r.importance !== undefined) output += ' | Importancia: ' + r.importance.toFixed(3);
      output += '\nOSM: https://www.openstreetmap.org/?mlat=' + r.lat + '&mlon=' + r.lon + '#map=15/' + r.lat + '/' + r.lon;

      results.push({ display_name: r.display_name, lat: r.lat, lon: r.lon, type: r.type, class: r.class, address: addr });
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
