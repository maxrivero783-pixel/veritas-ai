import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.12 — /lib/services/tavily.js
// ==============================================================================
// Adaptador HTTP para Tavily AI Search.
// Endpoint: POST https://api.tavily.com/search
// Auth: API key en el body (campo "api_key").
//
// Tavily devuelve resultados enriquecidos: cada resultado incluye title, url,
// content, score. Opcionalmente answer (resumen generado) y images.
// ==============================================================================

const SEARCH_URL = "https://api.tavily.com/search";
const EXTRACT_URL = "https://api.tavily.com/extract";

// ------------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// Endpoints soportados:
//   "search"  → payload: { query, max_results?, search_depth?, include_answer?, include_raw_content?, topic? }
//   "extract" → payload: { urls }  (extrae contenido limpio de URLs)
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "search":
      return callSearch(payload, apiKey);
    case "extract":
      return callExtract(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Tavily endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// search: POST /search con api_key en body.
// search_depth: "basic" (default, 1 step) | "advanced" (más profundo, más caro).
// topic: "general" (default) | "news".
// include_answer: true → devuelve campo "answer" con resumen generado.
// ------------------------------------------------------------------------------
async function callSearch(payload, apiKey) {
  const {
    query,
    max_results = 5,
    search_depth = "basic",
    include_answer = true,
    include_raw_content = false,
    topic = "general",
    include_domains = [],
    exclude_domains = [],
  } = payload;

  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };

  const body = {
    api_key: apiKey,
    query,
    max_results,
    search_depth,
    include_answer,
    include_raw_content,
    topic,
  };
  if (include_domains.length) body.include_domains = include_domains;
  if (exclude_domains.length) body.exclude_domains = exclude_domains;

  const resp = await fetchT(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// extract: POST /extract con api_key en body.
// payload: { urls: ["https://...", ...] }
// Devuelve { results: [{ url, raw_content, images? }], failed: [...] }
// ------------------------------------------------------------------------------
async function callExtract(payload, apiKey) {
  const { urls } = payload;
  if (!Array.isArray(urls) || urls.length === 0) {
    return { status: 400, data: null, raw: null, error: "Missing or invalid urls" };
  }
  const body = { api_key: apiKey, urls };
  const resp = await fetchT(EXTRACT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
