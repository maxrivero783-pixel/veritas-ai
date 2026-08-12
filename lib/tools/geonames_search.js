// ==============================================================================
// Véritas v2.4 — /lib/tools/geonames_search.js
// ==============================================================================
// Busca lugares con GeoNames. Requiere GEONAMES_USERNAME en env.
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args, ctx) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const username = (ctx && ctx.env && (ctx.env.GEONAMES_USERNAME || ctx.env.GEONAMES_USER));
  if (!username) return { success: false, error: 'GeoNames requiere GEONAMES_USERNAME configurado. Crear cuenta gratis en geonames.org.' };

  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 10, 1), 50);

  try {
    const params = new URLSearchParams({
      q: query,
      maxRows: String(limit),
      username: username,
      style: 'FULL',
    });
    if (args.country) params.set('country', args.country);
    if (args.featureClass) params.set('featureClass', args.featureClass);

    const resp = await fetch('https://secure.geonames.org/searchJSON?' + params.toString(), {
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { success: false, error: 'GeoNames HTTP ' + resp.status };
    const data = await resp.json();

    if (data.status) {
      return { success: false, error: 'GeoNames: ' + (data.status.message || data.status.value || 'Error desconocido') };
    }

    const geonames = data.geonames || [];
    if (!geonames.length) {
      return { success: true, results: [], message: 'Sin resultados para: ' + query };
    }

    let output = 'GeoNames — "' + query + '"\n';
    const results = [];

    geonames.forEach(function(g, i) {
      output += '\n#' + (i + 1) + ' ' + (g.name || 'N/D') + ', ' + (g.countryName || 'N/D');
      if (g.adminName1) output += ' > ' + g.adminName1;
      output += '\n' + g.lat + ', ' + g.lng;
      if (g.population) output += ' | Población: ' + Number(g.population).toLocaleString();
      if (g.timezone) output += ' | TZ: ' + g.timezone;
      if (g.featureClassName) output += ' | Tipo: ' + g.featureClassName;

      results.push({ name: g.name, country: g.countryName, lat: g.lat, lng: g.lng, population: g.population, timezone: g.timezone });
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
