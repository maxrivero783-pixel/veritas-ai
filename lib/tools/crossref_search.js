// Véritas v2.4 — /lib/tools/crossref_search.js
// Busca metadatos bibliográficos y DOI en Crossref.
// API pública gratuita. No requiere keyRotator.

const MAX_OUTPUT = 15000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}, ctx = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const rows = clamp(args.rows || args.limit, 5, 1, 20);
  const url = new URL('https://api.crossref.org/works');
  url.searchParams.set('query', args.query.trim());
  url.searchParams.set('rows', String(rows));
  if (ctx.env?.CROSSREF_MAILTO) url.searchParams.set('mailto', ctx.env.CROSSREF_MAILTO);

  let resp;
  try { resp = await fetch(url.toString()); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'Crossref HTTP ' + resp.status };

  const items = data?.message?.items || [];
  if (!items.length) return { success: true, results: 0, output: 'Crossref — sin resultados para: ' + args.query };

  let text = 'Crossref — ' + args.query + '\n' + '='.repeat(60) + '\n';
  items.forEach(function(w, i) {
    const year = w.issued?.['date-parts']?.[0]?.[0] || 's/f';
    const title = Array.isArray(w.title) ? w.title[0] : (w.title || 'Sin titulo');
    text += '#' + (i + 1) + ' ' + title + ' (' + year + ')\n';
    text += 'DOI: ' + (w.DOI || 'N/D') + ' · Tipo: ' + (w.type || 'N/D') + '\n';
    text += 'Editorial: ' + (w.publisher || 'N/D') + '\n';
    text += 'URL: ' + (w.URL || 'N/D') + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';
  return { success: true, results: items.length, output: text.trim() };
}
