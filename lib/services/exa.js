import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.12.3 — /lib/services/exa.js
// ==============================================================================
// Adaptador HTTP para Exa.ai (búsqueda semántica/keyword para IA).
// Base: https://api.exa.ai
// Auth: header `x-api-key: <api_key>` (también acepta Authorization: Bearer).
//
// Endpoints cubiertos:
//   "search"   → POST /search   { query, type, numResults, contents:{text,highlights},
//                                 startPublishedDate, endPublishedDate, includeDomains }
//   "contents" → POST /contents { urls, text:{maxCharacters}, highlights }
//   "answer"   → POST /answer   { query, text } (respuesta con citas)
// ==============================================================================

const BASE = "https://api.exa.ai";

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "search": return callSearch(payload, apiKey);
    case "contents": return callContents(payload, apiKey);
    case "answer": return callAnswer(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Exa endpoint: ${endpoint}` };
  }
}

function headers(apiKey) {
  return { "x-api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" };
}

async function callSearch(payload, apiKey) {
  const {
    query, type = "auto", numResults = 5, text = false, highlights = true,
    startPublishedDate, endPublishedDate, includeDomains,
  } = payload;
  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };
  const body = {
    query,
    type,
    numResults: Math.min(30, Math.max(1, Number(numResults) || 5)),
    contents: { text: Boolean(text), highlights: Boolean(highlights) },
  };
  if (startPublishedDate) body.startPublishedDate = startPublishedDate;
  if (endPublishedDate) body.endPublishedDate = endPublishedDate;
  if (Array.isArray(includeDomains) && includeDomains.length) body.includeDomains = includeDomains;
  return doFetch(`${BASE}/search`, body, apiKey);
}

async function callContents(payload, apiKey) {
  const { urls, maxCharacters = 2000, highlights = true } = payload;
  if (!Array.isArray(urls) || urls.length === 0) {
    return { status: 400, data: null, raw: null, error: "Missing urls array" };
  }
  const body = {
    urls,
    text: { maxCharacters: Math.min(10000, Math.max(200, Number(maxCharacters) || 2000)) },
    highlights: Boolean(highlights),
  };
  return doFetch(`${BASE}/contents`, body, apiKey);
}

async function callAnswer(payload, apiKey) {
  const { query, text = true } = payload;
  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };
  return doFetch(`${BASE}/answer`, { query, text: Boolean(text) }, apiKey);
}

async function doFetch(url, body, apiKey) {
  const response = await fetchT(url, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
    timeoutMs: 30000,
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data, raw, error: response.ok ? undefined : `HTTP ${response.status}` };
}

export default { callService };
