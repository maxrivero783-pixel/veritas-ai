// ==============================================================================
// Véritas v2.4 — /lib/tools/openalex_search.js
// ==============================================================================
// Busca literatura académica abierta e instituciones en OpenAlex (pública, sin key).
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 10, 1), 25);
  const type = args.type || 'works'; // works, authors, institutions, sources, topics

  try {
    const params = new URLSearchParams({
      search: query,
      per_page: String(limit),
      mailto: 'veritas@ai.dev',
    });

    const url = 'https://api.openalex.org/' + type + '?' + params.toString();
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: 'OpenAlex HTTP ' + resp.status + ': ' + text.slice(0, 300) };
    }

    const data = await resp.json();
    const results = data.results || [];

    if (!results.length) {
      return { success: true, results: [], message: 'Sin resultados para: ' + query };
    }

    let output = 'OpenAlex (' + type + ') — "' + query + '"\n';
    results.forEach(function(item, i) {
      output += '\n#' + (i + 1) + ' ';
      if (type === 'works') {
        output += (item.title || 'Sin título');
        if (item.publication_year) output += ' (' + item.publication_year + ')';
        if (item.cited_by_count !== undefined) output += ' | Citas: ' + item.cited_by_count;
        if (item.type) output += ' | Tipo: ' + item.type;
        if (item.doi) output += '\nDOI: https://doi.org/' + item.doi;
        if (item.primary_location && item.primary_location.source) {
          output += ' | Fuente: ' + (item.primary_location.source.display_name || '');
        }
      } else if (type === 'authors') {
        output += (item.display_name || '');
        if (item.works_count !== undefined) output += ' | Trabajos: ' + item.works_count;
        if (item.cited_by_count !== undefined) output += ' | Citas: ' + item.cited_by_count;
      } else if (type === 'institutions') {
        output += (item.display_name || '');
        if (item.country_code) output += ' (' + item.country_code + ')';
        if (item.works_count !== undefined) output += ' | Trabajos: ' + item.works_count;
      } else {
        output += (item.display_name || item.title || JSON.stringify(item).slice(0, 200));
      }
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
