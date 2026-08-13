import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.2 — /lib/services/jina_github.js
// ==============================================================================
// Adaptador HTTP para Jina AI GitHub Code Search + README retrieval.
// Separado del servicio jina.js (s.jina.ai embeddings) y jina_reader.js (r.jina.ai reader/search).
//
// Endpoints cubiertos:
//   - "search" → POST https://api.jina.ai/v1/github/search
//   - "readme" → GET  https://api.jina.ai/v1/github/readme/{owner}/{repo}
//
// Auth: Authorization: Bearer <api_key>
// ==============================================================================

const BASE_URL = 'https://api.jina.ai';

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case 'search':
      return callSearch(payload, apiKey);
    case 'readme':
      return callReadme(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// Search: POST /v1/github/search
// Body: { query, sort, per_page, page }
// Devuelve resultados de búsqueda de código en GitHub.
// ------------------------------------------------------------------------------
async function callSearch(payload, apiKey) {
  const { query } = payload;
  if (!query) return { status: 400, data: null, raw: null, error: 'Missing query' };

  const body = {
    query,
    sort: payload.sort || 'best_match',
    per_page: Math.min(Math.max(Number(payload.per_page) || 10, 1), 30),
    page: Math.min(Math.max(Number(payload.page) || 1, 1), 5),
  };

  const resp = await fetchT(`${BASE_URL}/v1/github/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Readme: GET /v1/github/readme/{owner}/{repo}
// Devuelve el contenido parseado (markdown) del README de un repositorio.
// ------------------------------------------------------------------------------
async function callReadme(payload, apiKey) {
  const { owner, repo } = payload;
  if (!owner || !repo) {
    return { status: 400, data: null, raw: null, error: 'Missing owner and/or repo' };
  }

  const url = `${BASE_URL}/v1/github/readme/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

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
