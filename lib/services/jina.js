import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.12 — /lib/services/jina.js
// ==============================================================================
// Adaptador HTTP para Jina AI.
// Endpoints cubiertos:
//   - Reader:    GET https://r.jina.ai/<url>     (scraping → markdown limpio)
//   - Search:    POST https://s.jina.ai/         (búsqueda web, devuelve resultados con contenido)
//   - Embeddings:POST https://api.jina.ai/v1/embeddings  (futura tool)
//   - Reranker:  POST https://api.jina.ai/v1/rerank       (futura tool)
//
// Auth: Authorization: Bearer <api_key>
//
// API común que implementan todos los adaptadores /lib/services/*.js:
//   callService({ endpoint, payload, apiKey })
//     → { status, data, raw }
//   `endpoint` identifica qué llamada del servicio se quiere (el adaptador
//   despacha internamente). `payload` depende del endpoint.
// ==============================================================================

const READER_BASE = "https://r.jina.ai";
const SEARCH_URL = "https://s.jina.ai/";
const EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings";
const RERANK_URL = "https://api.jina.ai/v1/rerank";

// ------------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// Endpoints soportados:
//   "reader"     → payload: { url, options? }
//   "search"     → payload: { query, num? }
//   "embeddings" → payload: { input, model? }
//   "rerank"     → payload: { query, documents, model?, top_n? }
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "reader":
      return callReader(payload, apiKey);
    case "search":
      return callSearch(payload, apiKey);
    case "embeddings":
      return callEmbeddings(payload, apiKey);
    case "rerank":
      return callRerank(payload, apiKey);
    default:
      return {
        status: 400,
        data: null,
        raw: null,
        error: `Unknown Jina endpoint: ${endpoint}`,
      };
  }
}

// ------------------------------------------------------------------------------
// Reader: GET r.jina.ai/<url>
// Headers opcionales útiles:
//   X-Return-Format: markdown | html | text | plainContent  (default: markdown)
//   X-Timeout: segundos máximos
//   X-Wait-For-Selector: selector CSS a esperar antes de extraer
//   X-With-Links-Summary: "true" para incluir enlaces al final
// ------------------------------------------------------------------------------
async function callReader(payload, apiKey) {
  const { url, options = {} } = payload;
  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const targetUrl = `${READER_BASE}/${url.startsWith("http") ? url : "https://" + url}`;
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "X-Return-Format": options.format || "markdown",
  };
  if (options.timeout) headers["X-Timeout"] = String(options.timeout);
  if (options.waitForSelector) headers["X-Wait-For-Selector"] = options.waitForSelector;
  if (options.withLinksSummary) headers["X-With-Links-Summary"] = "true";

  const resp = await fetchT(targetUrl, { method: "GET", headers });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Search: POST s.jina.ai/
// Body: { q: "query", num: 5 }
// Headers: Authorization, Accept: application/json, X-Respond-With: "content"
// ------------------------------------------------------------------------------
async function callSearch(payload, apiKey) {
  const { query, num = 5 } = payload;
  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };

  const resp = await fetchT(SEARCH_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Respond-With": "content",
    },
    body: JSON.stringify({ q: query, num }),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Embeddings: POST api.jina.ai/v1/embeddings
// Body: { input: string | string[], model: "jina-embeddings-v3" }
// ------------------------------------------------------------------------------
async function callEmbeddings(payload, apiKey) {
  const { input, model = "jina-embeddings-v3" } = payload;
  if (!input) return { status: 400, data: null, raw: null, error: "Missing input" };

  const resp = await fetchT(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, model }),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Rerank: POST api.jina.ai/v1/rerank
// Body: { query, documents, model: "jina-reranker-v2-base-multilingual", top_n }
// ------------------------------------------------------------------------------
async function callRerank(payload, apiKey) {
  const { query, documents, model = "jina-reranker-v2-base-multilingual", top_n = 5 } = payload;
  if (!query || !documents) return { status: 400, data: null, raw: null, error: "Missing query/documents" };

  const resp = await fetchT(RERANK_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, documents, model, top_n }),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
