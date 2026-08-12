// ==============================================================================
// Véritas v2.4 — /lib/tools/semantic_scholar_search.js
// ==============================================================================
// Busca papers, autores y citas en Semantic Scholar Graph API (pública, sin key).
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 10, 1), 20);
  const fields = 'paperId,title,abstract,authors,year,citationCount,openAccessPdf,externalIds,url';

  try {
    const url = 'https://api.semanticscholar.org/graph/v1/paper/search' +
      '?query=' + encodeURIComponent(query) +
      '&limit=' + limit +
      '&fields=' + fields;

    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: 'Semantic Scholar HTTP ' + resp.status + ': ' + text.slice(0, 300) };
    }

    const data = await resp.json();
    const papers = data.data || [];

    if (!papers.length) {
      return { success: true, results: [], message: 'Sin resultados para: ' + query };
    }

    let output = 'Semantic Scholar — "' + query + '"\n';
    papers.forEach(function(p, i) {
      output += '\n#' + (i + 1) + ' ' + (p.title || 'Sin título');
      if (p.year) output += ' (' + p.year + ')';
      output += '\nCitas: ' + (p.citationCount || 0);
      if (p.authors && p.authors.length) {
        output += ' | Autores: ' + p.authors.map(function(a) { return a.name || ''; }).join(', ');
      }
      if (p.abstract) output += '\n' + p.abstract.slice(0, 300) + (p.abstract.length > 300 ? '...' : '');
      if (p.openAccessPdf && p.openAccessPdf.url) output += '\nPDF: ' + p.openAccessPdf.url;
      if (p.externalIds) {
        if (p.externalIds.DOI) output += ' | DOI: ' + p.externalIds.DOI;
        if (p.externalIds.PMID) output += ' | PMID: ' + p.externalIds.PMID;
      }
      if (p.url) output += '\n' + p.url;
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: papers, count: papers.length, total: data.total || 0, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
