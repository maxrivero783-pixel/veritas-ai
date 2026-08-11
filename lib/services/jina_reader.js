// ==============================================================================
// Véritas v2.2 — /lib/services/jina_reader.js
// ==============================================================================
// Adaptador HTTP para r.jina.ai (Reader + Search vía GET).
// Separado del servicio jina.js (que cubre s.jina.ai POST y embeddings/rerank).
//
// Endpoints cubiertos:
//   - "reader"  → GET https://r.jina.ai/<url>       → markdown limpio
//   - "search"  → GET https://r.jina.ai/search?q=…&count=…  → JSON results
//
// Auth: Authorization: Bearer <api_key>
// ==============================================================================

const BASE_URL = 'https://r.jina.ai';

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case 'reader':
      return callReader(payload, apiKey);
    case 'search':
      return callSearch(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// Reader: GET https://r.jina.ai/<url>
// Devuelve markdown limpio con metadatos de imágenes y enlaces.
// ------------------------------------------------------------------------------
async function callReader(payload, apiKey) {
  const { url } = payload;
  if (!url) return { status: 400, data: null, raw: null, error: 'Missing url' };

  const targetUrl = `${BASE_URL}/${url.startsWith('http') ? url : 'https://' + url}`;

  const resp = await fetch(targetUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'text/markdown',
      'X-Return-Format': 'markdown',
      'X-With-Generated-Alt': 'true',
      'X-With-Links-Summary': 'true',
      'X-With-Images-Summary': 'true',
    },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Search: GET https://r.jina.ai/search?q=<query>&count=<count>
// Devuelve JSON con resultados de búsqueda.
// ------------------------------------------------------------------------------
async function callSearch(payload, apiKey) {
  const { query, count = 5 } = payload;
  if (!query) return { status: 400, data: null, raw: null, error: 'Missing query' };

  let url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  url += `&count=${Math.min(Math.max(Number(count) || 5, 1), 10)}`;

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
