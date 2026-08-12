// Véritas v2.4 — /lib/tools/nasa_search.js
// Busca contenido publico en NASA Image and Video Library.
// API publica. No requiere keyRotator.

const MAX_OUTPUT = 12000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const limit = clamp(args.limit, 10, 1, 20);
  const mediaType = args.media_type || 'image';
  const url = 'https://images-api.nasa.gov/search?q=' + encodeURIComponent(args.query.trim()) + '&media_type=' + mediaType + '&page_size=' + limit;

  let resp;
  try { resp = await fetch(url); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }

  const items = data?.collection?.items || [];
  if (!items.length) return { success: true, results: 0, output: 'NASA — sin resultados para: ' + args.query };

  let text = 'NASA — ' + args.query + ' (' + mediaType + ')\n' + '='.repeat(60) + '\n';
  items.forEach(function(item, i) {
    const d = item.data?.[0] || {};
    text += '#' + (i + 1) + ' ' + (d.title || 'Sin titulo') + '\n';
    text += (d.description || '').slice(0, 300) + '\n';
    text += 'Centro: ' + (d.center || 'N/D') + ' · Fecha: ' + (d.date_created || 'N/D') + '\n';
    const href = item.links?.[0]?.href || '';
    if (href) text += 'Imagen: ' + href + '\n';
    text += '\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';

  return { success: true, results: items.length, output: text.trim() };
}
