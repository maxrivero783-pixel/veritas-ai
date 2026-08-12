// Véritas v2.4 — /lib/tools/hackernews_search.js
// Busca discusiones y senales tecnicas en Hacker News via Algolia.
// API publica gratuita. No requiere keyRotator.

const MAX_OUTPUT = 12000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const limit = clamp(args.limit, 10, 1, 50);
  const tags = args.tags || 'story';
  const url = 'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(args.query.trim()) + '&tags=' + tags + '&hitsPerPage=' + limit;

  let resp;
  try { resp = await fetch(url); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'HN Algolia HTTP ' + resp.status };

  const hits = data?.hits || [];
  if (!hits.length) return { success: true, results: 0, output: 'Hacker News — sin resultados para: ' + args.query };

  let text = 'Hacker News — ' + args.query + '\n' + '='.repeat(60) + '\n';
  hits.forEach(function(h, i) {
    const title = h.title || h.story_title || 'Sin titulo';
    const link = h.url || ('https://news.ycombinator.com/item?id=' + h.objectID);
    text += '#' + (i + 1) + ' ' + title + '\n';
    text += 'Puntos: ' + (h.points || 0) + ' · Comentarios: ' + (h.num_comments || 0) + ' · Autor: ' + (h.author || 'N/D') + '\n';
    text += 'URL: ' + link + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';
  return { success: true, results: hits.length, output: text.trim() };
}
