// Véritas v2.4 — /lib/tools/wikipedia_search.js
// Busca contexto enciclopedico y desambiguacion en Wikipedia.
// API REST publica. No requiere keyRotator.

const MAX_OUTPUT = 12000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const lang = /^[a-z]{2,3}$/i.test(args.language || '') ? args.language : 'es';
  const limit = clamp(args.limit, 5, 1, 20);
  const url = 'https://' + lang + '.wikipedia.org/w/rest.php/v1/search/page?q=' + encodeURIComponent(args.query.trim()) + '&limit=' + limit;

  let resp;
  try { resp = await fetch(url, { headers: { 'User-Agent': 'Véritas/2.4 OSINT tool', Accept: 'application/json' } }); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'Wikipedia HTTP ' + resp.status };

  const pages = data?.pages || [];
  if (!pages.length) return { success: true, results: 0, output: 'Wikipedia (' + lang + ') — sin resultados para: ' + args.query };

  let text = 'Wikipedia (' + lang + ') — ' + args.query + '\n' + '='.repeat(60) + '\n';
  pages.forEach(function(p, i) {
    const key = p.key || p.title || '';
    text += '#' + (i + 1) + ' ' + (p.title || 'Sin titulo') + '\n';
    text += (p.description || '') + '\n';
    text += (p.excerpt || '').replace(/<[^>]+>/g, '').slice(0, 400) + '\n';
    text += 'URL: https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(key) + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';
  return { success: true, results: pages.length, output: text.trim() };
}
