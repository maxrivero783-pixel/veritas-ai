// Véritas v2.4 — /lib/tools/geonames_search.js
// Busca lugares con GeoNames (geocodificacion, poblacion, coords).
// Requiere GEONAMES_USERNAME en env. No requiere keyRotator.

const MAX_OUTPUT = 10000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}, ctx = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const username = ctx.env?.GEONAMES_USERNAME;
  if (!username) return { success: false, error: 'GeoNames requiere GEONAMES_USERNAME en Variables de entorno.' };

  const limit = clamp(args.limit, 10, 1, 50);
  const url = 'https://secure.geonames.org/searchJSON?q=' + encodeURIComponent(args.query.trim()) + '&maxRows=' + limit + '&username=' + encodeURIComponent(username);
  if (args.country) url += '&country=' + encodeURIComponent(args.country);
  if (args.featureClass) url += '&featureClass=' + encodeURIComponent(args.featureClass);

  let resp;
  try { resp = await fetch(url); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (data?.status) return { success: false, error: 'GeoNames: ' + (data.status.message || 'Error') };

  const geos = data?.geonames || [];
  if (!geos.length) return { success: true, results: 0, output: 'GeoNames — sin resultados para: ' + args.query };

  let text = 'GeoNames — ' + args.query + '\n' + '='.repeat(60) + '\n';
  geos.forEach(function(g, i) {
    text += '#' + (i + 1) + ' ' + (g.name || 'N/D') + ', ' + (g.countryName || 'N/D') + '\n';
    text += 'Lat/lon: ' + (g.lat || 'N/D') + ', ' + (g.lng || 'N/D') + '\n';
    text += 'Poblacion: ' + (g.population || 0) + ' · Fuso: ' + (g.timezone || 'N/D') + '\n';
    text += 'Tipo: ' + (g.fclName || 'N/D') + ' / ' + (g.fcodeName || 'N/D') + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';

  return { success: true, results: geos.length, output: text.trim() };
}
