// Véritas v2.4 — /lib/tools/nominatim_search.js
// Geocodifica lugares con Nominatim/OpenStreetMap.
// API publica gratuita (requiere User-Agent). No requiere keyRotator.

const MAX_OUTPUT = 10000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const limit = clamp(args.limit, 5, 1, 10);
  let urlStr = 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=' + encodeURIComponent(args.query.trim()) + '&limit=' + limit;
  if (args.countrycodes) urlStr += '&countrycodes=' + encodeURIComponent(args.countrycodes);

  let resp;
  try { resp = await fetch(urlStr, { headers: { 'User-Agent': 'Véritas/2.4 OSINT tool' } }); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'Nominatim HTTP ' + resp.status };

  if (!Array.isArray(data) || !data.length) return { success: true, results: 0, output: 'Nominatim — sin resultados para: ' + args.query };

  let text = 'Nominatim — ' + args.query + '\n' + '='.repeat(60) + '\n';
  data.forEach(function(p, i) {
    text += '#' + (i + 1) + ' ' + p.display_name + '\n';
    text += 'Lat/lon: ' + p.lat + ', ' + p.lon + ' · Tipo: ' + (p.type || 'N/D') + ' · Importancia: ' + (p.importance || 'N/D') + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';
  return { success: true, results: data.length, output: text.trim(), locations: data.map(function(p) { return { lat: p.lat, lon: p.lon, display_name: p.display_name, type: p.type }; }) };
}
