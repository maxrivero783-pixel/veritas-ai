// ==============================================================================
// Véritas v2.4 — /lib/tools/nasa_search.js
// ==============================================================================
// Busca contenido público en NASA Image and Video Library (pública, sin key).
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const mediaType = args.media_type || 'image';
  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 10, 1), 20);

  try {
    const params = new URLSearchParams({
      q: query,
      media_type: mediaType,
      page_size: String(limit),
    });

    const resp = await fetch('https://images-api.nasa.gov/search?' + params.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { success: false, error: 'NASA HTTP ' + resp.status };
    const data = await resp.json();
    const items = (data.collection && data.collection.items) || [];

    if (!items.length) {
      return { success: true, results: [], message: 'Sin resultados en NASA para: ' + query };
    }

    let output = 'NASA — "' + query + '" (' + (data.collection.metadata && data.collection.metadata.total_hits || 0) + ' total)
';
    const results = [];

    items.forEach(function(item, i) {
      const meta = item.data && item.data[0] ? item.data[0] : {};
      const thumb = item.links && item.links[0] ? item.links[0].href : '';

      output += '\n#' + (i + 1) + ' ' + (meta.title || 'Sin título');
      if (meta.description) output += '\n  ' + meta.description.slice(0, 250);
      if (meta.date_created) output += '\n  Fecha: ' + meta.date_created.slice(0, 10);
      if (meta.center) output += ' | Centro: ' + meta.center;
      if (meta.photographer) output += ' | Fotógrafo: ' + meta.photographer;
      if (thumb) output += '\n  Imagen: ' + thumb;

      results.push({ title: meta.title, description: meta.description, date: meta.date_created, center: meta.center, thumbnail: thumb });
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
