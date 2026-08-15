import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.7.3 — /lib/services/courtlistener.js
// ==============================================================================
// Adaptador HTTP para CourtListener REST API v4 (Free Law Project).
// ~8M de opiniones de cortes federales/estatales de EE.UU. + RECAP (PACER).
//
// Base: https://www.courtlistener.com/api/rest/v4/
// Auth: header `Authorization: Token <api_key>` (NOTA: es "Token", no "Bearer").
// Límites cuenta free: 5 req/min, 50/hora, 125/día.
//
// Endpoints cubiertos:
//   "search"   → GET  /search/ (type: o=opiniones, r=RECAP/dockets, p=argumentos orales)
//   "opinion"  → GET  /opinions/{id}/ (texto completo de una opinión)
//   "citation" → POST /citation-lookup/ (verificación de citas legales)
// ==============================================================================

const BASE = "https://www.courtlistener.com/api/rest/v4";

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "search": return callSearch(payload, apiKey);
    case "opinion": return callOpinion(payload, apiKey);
    case "citation": return callCitation(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown CourtListener endpoint: ${endpoint}` };
  }
}

function authHeaders(apiKey) {
  return { Authorization: `Token ${apiKey}`, Accept: "application/json" };
}

async function callSearch(payload, apiKey) {
  const { query, type = "o", court, filed_after, filed_before, page_size = 10 } = payload;
  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };
  const url = new URL(`${BASE}/search/`);
  url.searchParams.set("q", query);
  url.searchParams.set("type", type);
  if (court) url.searchParams.set("court", court);
  if (filed_after) url.searchParams.set("filed_after", filed_after);
  if (filed_before) url.searchParams.set("filed_before", filed_before);
  url.searchParams.set("page_size", String(Math.min(50, Math.max(1, Number(page_size) || 10))));
  return doFetch(url.toString(), { headers: authHeaders(apiKey) });
}

async function callOpinion(payload, apiKey) {
  const { id } = payload;
  if (!id) return { status: 400, data: null, raw: null, error: "Missing opinion id" };
  return doFetch(`${BASE}/opinions/${encodeURIComponent(id)}/`, { headers: authHeaders(apiKey) });
}

async function callCitation(payload, apiKey) {
  const { text } = payload;
  if (!text) return { status: 400, data: null, raw: null, error: "Missing citation text" };
  return doFetch(`${BASE}/citation-lookup/`, {
    method: "POST",
    headers: { ...authHeaders(apiKey), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text }).toString(),
  });
}

async function doFetch(url, options) {
  const response = await fetchT(url, { ...options, timeoutMs: 20000 });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data, raw, error: response.ok ? undefined : `HTTP ${response.status}` };
}

export default { callService };
