// ==============================================================================
// Véritas v2.4 — /lib/tools/wikidata_search.js
// ==============================================================================
// Busca entidades estructuradas, aliases y relaciones en Wikidata (pública).
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args) {
  const query = args.query;
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio.' };

  const lang = args.language || args.lang || 'es';
  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 5, 1), 20);

  try {
    const url = 'https://www.wikidata.org/w/api.php' +
      '?action=wbsearchentities&search=' + encodeURIComponent(query) +
      '&language=' + lang + '&format=json&limit=' + limit + '&origin=*';

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return { success: false, error: 'Wikidata HTTP ' + resp.status };
    const data = await resp.json();
    const entities = data.search || [];

    if (!entities.length) {
      return { success: true, results: [], message: 'Sin resultados en Wikidata para: ' + query };
    }

    // Obtener detalles de cada entidad
    let output = 'Wikidata — "' + query + '"\n';
    const results = [];

    for (let i = 0; i < Math.min(entities.length, 5); i++) {
      const ent = entities[i];
      let details = '';
      try {
        const detUrl = 'https://www.wikidata.org/wiki/Special:EntityData/' + ent.id + '.json';
        const detResp = await fetch(detUrl, { signal: AbortSignal.timeout(8000) });
        if (detResp.ok) {
          const detData = await detResp.json();
          const claims = detData.entities && detData.entities[ent.id] && detData.entities[ent.id].claims;
          if (claims) {
            const lines = [];
            const keys = Object.keys(claims).slice(0, 10);
            keys.forEach(function(prop) {
              const claim = claims[prop][0];
              if (claim && claim.mainsnak && claim.mainsnak.datavalue) {
                const val = claim.mainsnak.datavalue.value;
                lines.push('  ' + prop + ': ' + (typeof val === 'object' ? (val['text'] || val.id || JSON.stringify(val).slice(0, 100)) : String(val).slice(0, 100)));
              }
            });
            details = lines.join('\n');
          }
        }
      } catch (e) { /* sin detalles */ }

      output += '\n#' + (i + 1) + ' ' + (ent.label || ent.id);
      if (ent.description) output += ' — ' + ent.description;
      output += '\nID: ' + ent.id;
      if (ent.aliases && ent.aliases.length) output += ' | Aliases: ' + ent.aliases.join(', ');
      if (details) output += '\n' + details;
      output += '\nhttps://www.wikidata.org/wiki/' + ent.id;

      results.push({ id: ent.id, label: ent.label, description: ent.description, url: 'https://www.wikidata.org/wiki/' + ent.id });
    }

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
