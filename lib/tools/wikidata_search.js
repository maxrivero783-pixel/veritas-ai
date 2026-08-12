// Véritas v2.4 — /lib/tools/wikidata_search.js
// Busca entidades estructuradas, aliases y relaciones en Wikidata.
// API publica. No requiere keyRotator.

const MAX_OUTPUT = 12000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const lang = /^[a-z]{2,3}$/i.test(args.language || '') ? args.language : 'es';
  const limit = clamp(args.limit, 10, 1, 50);
  const url = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=' + lang + '&uselang=' + lang + '&search=' + encodeURIComponent(args.query.trim()) + '&limit=' + limit + '&origin=*';

  let resp;
  try { resp = await fetch(url, { headers: { 'User-Agent': 'Véritas/2.4 OSINT tool' } }); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'Wikidata HTTP ' + resp.status };

  const results = data?.search || [];
  if (!results.length) return { success: true, results: 0, output: 'Wikidata — sin resultados para: ' + args.query };

  let text = 'Wikidata — ' + args.query + '\n' + '='.repeat(60) + '\n';
  results.forEach(function(e, i) {
    text += '#' + (i + 1) + ' ' + (e.label || 'Sin etiqueta') + ' (' + e.id + ')\n';
    text += (e.description || 'Sin descripcion') + '\n';
    text += 'URL: ' + (e.concepturi || 'N/D') + '\n';
    if (e.aliases && e.aliases.length) text += 'Aliases: ' + e.aliases.slice(0, 5).join(', ') + '\n';
    text += '\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';
  return { success: true, results: results.length, output: text.trim() };
}
