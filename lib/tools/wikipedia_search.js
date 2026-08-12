// ==============================================================================
// Véritas v2.4 — /lib/tools/wikipedia_search.js
// ==============================================================================
// Busca contexto enciclopédico y desambiguación en Wikipedia REST API (pública).
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const lang = args.language || args.lang || 'es';
  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 3, 1), 5);

  try {
    // 1) Buscar artículos
    const searchUrl = 'https://' + lang + '.wikipedia.org/w/api.php' +
      '?action=query&list=search&srsearch=' + encodeURIComponent(query) +
      '&srlimit=' + limit + '&format=json&origin=*';

    const searchResp = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
    if (!searchResp.ok) return { success: false, error: 'Wikipedia search HTTP ' + searchResp.status };
    const searchData = await searchResp.json();
    const hits = (searchData.query && searchData.query.search) || [];

    if (!hits.length) {
      return { success: true, results: [], message: 'Sin resultados en Wikipedia para: ' + query };
    }

    // 2) Obtener extractos de cada artículo
    let output = 'Wikipedia (' + lang + ') — "' + query + '"\n';
    const results = [];

    for (let i = 0; i < hits.length; i++) {
      const title = hits[i].title;
      const summary = hits[i].snippet ? hits[i].snippet.replace(/<[^>]*>/g, '') : '';

      // Obtener extracto completo
      let extract = '';
      try {
        const extUrl = 'https://' + lang + '.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title);
        const extResp = await fetch(extUrl, { signal: AbortSignal.timeout(8000) });
        if (extResp.ok) {
          const extData = await extResp.json();
          extract = extData.extract || '';
        }
      } catch (e) { /* usar snippet como fallback */ }

      const text = extract || summary;
      output += '\n#' + (i + 1) + ' ' + title;
      output += '\n' + text.slice(0, 600);
      output += '\nhttps://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));

      results.push({ title: title, summary: text.slice(0, 800), url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_')) });
    }

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
