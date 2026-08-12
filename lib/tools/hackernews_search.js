// ==============================================================================
// Véritas v2.4 — /lib/tools/hackernews_search.js
// ==============================================================================
// Busca discusiones y señales técnicas en Hacker News vía Algolia API (pública).
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 10, 1), 20);
  const tags = args.tags || 'story'; // story, comment, poll, ask_hn, show_hn

  try {
    const url = 'https://hn.algolia.com/api/v1/search' +
      '?query=' + encodeURIComponent(query) +
      '&tags=' + tags +
      '&hitsPerPage=' + limit;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return { success: false, error: 'HN Algolia HTTP ' + resp.status };
    const data = await resp.json();
    const hits = data.hits || [];

    if (!hits.length) {
      return { success: true, results: [], message: 'Sin resultados en HN para: ' + query };
    }

    let output = 'Hacker News (' + tags + ') — "' + query + '"\n';
    const results = [];

    hits.forEach(function(h, i) {
      output += '\n#' + (i + 1) + ' ' + (h.title || h.story_title || 'Sin título');
      if (h.points !== undefined) output += ' | Puntos: ' + h.points;
      if (h.num_comments !== undefined) output += ' | Comentarios: ' + h.num_comments;
      if (h.author) output += ' | por ' + h.author;
      output += '\n' + (h.url || h.story_url || 'https://news.ycombinator.com/item?id=' + h.objectID);

      results.push({
        title: h.title || h.story_title,
        url: h.url || h.story_url,
        points: h.points || 0,
        comments: h.num_comments || 0,
        author: h.author,
        created: h.created_at,
      });
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
