import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.2 — /lib/services/gfw.js
// ==============================================================================
// Adaptador HTTP para GFW (general web search API alternativa).
// Endpoint base: https://api.gfw.tools
//
// Endpoints cubiertos:
//   - "search" → GET https://api.gfw.tools/search?q=…&p=…&n=…
//
// Auth: Authorization: Bearer <api_key>
// ==============================================================================

const BASE_URL = 'https://api.gfw.tools';

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case 'search':
      return callSearch(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// Search: GET https://api.gfw.tools/search?q=<query>&p=<page>&n=<count>
// Devuelve JSON con resultados de búsqueda.
// ------------------------------------------------------------------------------
async function callSearch(payload, apiKey) {
  const { query, page = 1, count = 10 } = payload;
  if (!query) return { status: 400, data: null, raw: null, error: 'Missing query' };

  const safePage = Math.min(Math.max(Number(page) || 1, 1), 10);
  const safeCount = Math.min(Math.max(Number(count) || 10, 1), 20);

  let url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  url += `&p=${safePage}`;
  url += `&n=${safeCount}`;

  const resp = await fetchT(url, {
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
