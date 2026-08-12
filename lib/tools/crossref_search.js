// ==============================================================================
// Véritas v2.4 — /lib/tools/crossref_search.js
// ==============================================================================
// Busca metadatos bibliográficos y DOI en Crossref (pública, sin key).
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const rows = Math.min(Math.max(Math.floor(Number(args.rows)) || 10, 1), 20);

  try {
    const url = 'https://api.crossref.org/works' +
      '?query=' + encodeURIComponent(query) +
      '&rows=' + rows +
      '&select=DOI,title,author,published-print,container-title,type,abstract,is-referenced-by-count,URL';

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'VéritasAI/2.4 (mailto:veritas@ai.dev)' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: 'Crossref HTTP ' + resp.status + ': ' + text.slice(0, 300) };
    }

    const data = await resp.json();
    const items = data.message && data.message.items ? data.message.items : [];

    if (!items.length) {
      return { success: true, results: [], message: 'Sin resultados para: ' + query };
    }

    let output = 'Crossref — "' + query + '"\n';
    items.forEach(function(item, i) {
      output += '\n#' + (i + 1) + ' ' + (item.title && item.title[0] ? item.title[0] : 'Sin título');
      if (item.author && item.author.length) {
        output += '\nAutores: ' + item.author.map(function(a) { return (a.given || '') + ' ' + (a.family || ''); }).join(', ');
      }
      if (item['published-print'] && item['published-print']['date-parts']) {
        output += ' (' + item['published-print']['date-parts'][0][0] + ')';
      }
      if (item['container-title'] && item['container-title'][0]) output += ' | ' + item['container-title'][0];
      if (item['is-referenced-by-count'] !== undefined) output += ' | Citas: ' + item['is-referenced-by-count'];
      if (item.DOI) output += '\nDOI: https://doi.org/' + item.DOI;
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: items, count: items.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
