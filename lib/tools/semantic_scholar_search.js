// ==============================================================================
// Véritas v2.4 — /lib/tools/semantic_scholar_search.js
// ==============================================================================
// Busca papers, autores y citas en Semantic Scholar Graph API.
// API pública gratuita (rate limit más alto con API key opcional).
// No requiere keyRotator.
// ==============================================================================

const MAX_OUTPUT = 15000;

function clamp(val, fallback, min, max) {
  const n = Number(val);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

export async function run(args = {}, ctx = {}) {
  if (!args.query?.trim()) {
    return { success: false, error: 'Parametro "query" es obligatorio.' };
  }

  const limit = clamp(args.limit, 5, 1, 20);
  const url = new URL('https://api.semanticscholar.org/graph/v1/paper/search');
  url.searchParams.set('query', args.query.trim());
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('fields', 'title,year,authors,citationCount,url,abstract,venue');

  const headers = { Accept: 'application/json' };
  const key = ctx.env?.SEMANTIC_SCHOLAR_API_KEY;
  if (key) headers['x-api-key'] = key;

  let resp;
  try {
    resp = await fetch(url.toString(), { headers });
  } catch (e) {
    return { success: false, error: 'Error de conexion a Semantic Scholar: ' + e.message };
  }

  let data;
  try { data = await resp.json(); } catch (e) {
    return { success: false, error: 'Respuesta invalida de Semantic Scholar.' };
  }

  if (!resp.ok) {
    return { success: false, error: 'Semantic Scholar HTTP ' + resp.status + ': ' + (data?.message || '').slice(0, 300) };
  }

  const papers = data?.data || [];
  if (!papers.length) {
    return { success: true, results: 0, output: 'Semantic Scholar — sin resultados para: ' + args.query };
  }

  let text = 'Semantic Scholar — ' + args.query + '\n' + '='.repeat(60) + '\n';
  papers.forEach(function(p, i) {
    const authors = (p.authors || []).slice(0, 5).map(function(a) { return a.name; }).join(', ') || 'N/D';
    text += '#' + (i + 1) + ' ' + (p.title || 'Sin titulo') + ' (' + (p.year || 's/f') + ')\n';
    text += 'Autores: ' + authors + '\n';
    text += 'Citas: ' + (p.citationCount || 0) + ' · Venue: ' + (p.venue || 'N/D') + '\n';
    text += 'URL: ' + (p.url || 'N/D') + '\n';
    if (p.abstract) text += 'Resumen: ' + p.abstract.slice(0, 500) + '\n';
    text += '\n';
  });

  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';

  return { success: true, results: papers.length, output: text.trim() };
}
