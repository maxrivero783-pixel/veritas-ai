// Véritas v2.4 — /lib/tools/openalex_search.js
// Busca literatura académica abierta e instituciones en OpenAlex.
// API pública gratuita. No requiere keyRotator.

const MAX_OUTPUT = 15000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}, ctx = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const limit = clamp(args.limit, 5, 1, 25);
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', args.query.trim());
  url.searchParams.set('per-page', String(limit));
  if (ctx.env?.OPENALEX_MAILTO) url.searchParams.set('mailto', ctx.env.OPENALEX_MAILTO);

  let resp;
  try { resp = await fetch(url.toString()); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'OpenAlex HTTP ' + resp.status + ': ' + JSON.stringify(data).slice(0, 300) };

  const results = data?.results || [];
  if (!results.length) return { success: true, results: 0, output: 'OpenAlex — sin resultados para: ' + args.query };

  let text = 'OpenAlex — ' + args.query + '\n' + '='.repeat(60) + '\n';
  results.forEach(function(w, i) {
    text += '#' + (i + 1) + ' ' + (w.display_name || 'Sin titulo') + ' (' + (w.publication_year || 's/f') + ')\n';
    text += 'DOI: ' + (w.doi || 'N/D') + ' · Citas: ' + (w.cited_by_count || 0) + '\n';
    text += 'Fuente: ' + (w.primary_location?.source?.display_name || 'N/D') + '\n';
    text += 'URL: ' + (w.id || 'N/D') + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';
  return { success: true, results: results.length, output: text.trim() };
}
