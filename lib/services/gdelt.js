// ==============================================================================
// Véritas v2.4 — /lib/services/gdelt.js
// ==============================================================================
// Adaptador HTTP para GDELT Project API.
// API pública gratuita — NO requiere autenticación.
//
// Endpoints cubiertos:
//   - "events" → GET https://api.gdeltproject.org/api/v2/doc/doc?query=...
//   - "gkg"    → GET https://api.gdeltproject.org/api/v2/gkg/gkg?search=...
//   - "trends" → GET https://api.gdeltproject.org/api/v2/trends/trends?keyword=...
// ==============================================================================

const EVENTS_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";
const GKG_BASE    = "https://api.gdeltproject.org/api/v2/gkg/gkg";
const TRENDS_BASE = "https://api.gdeltproject.org/api/v2/trends/trends";

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "events":
      return callEvents(payload);
    case "gkg":
      return callGKG(payload);
    case "trends":
      return callTrends(payload);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown GDELT endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// Events Doc API
// {base}?query={q}&mode={m}&maxrecords={n}&format={f}&timespan={t}&sort={s}
// ------------------------------------------------------------------------------
async function callEvents(payload) {
  const {
    query,
    mode = "ArtList",
    maxrecords = 25,
    format = "json",
    timespan = "1d",
    sort = "DateDesc",
  } = payload;

  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };

  const safeRecords = Math.min(Math.max(Number(maxrecords) || 25, 1), 250);

  let url = `${EVENTS_BASE}?query=${encodeURIComponent(query)}`;
  url += `&mode=${encodeURIComponent(mode)}`;
  url += `&maxrecords=${safeRecords}`;
  url += `&format=${encodeURIComponent(format)}`;
  url += `&timespan=${encodeURIComponent(timespan)}`;
  url += `&sort=${encodeURIComponent(sort)}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Global Knowledge Graph (GKG) API
// {base}?search={q}&maxrecords={n}&format={f}&timespan={t}
// ------------------------------------------------------------------------------
async function callGKG(payload) {
  const {
    query,
    maxrecords = 25,
    format = "json",
    timespan = "1d",
  } = payload;

  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };

  const safeRecords = Math.min(Math.max(Number(maxrecords) || 25, 1), 250);

  let url = `${GKG_BASE}?search=${encodeURIComponent(query)}`;
  url += `&maxrecords=${safeRecords}`;
  url += `&format=${encodeURIComponent(format)}`;
  url += `&timespan=${encodeURIComponent(timespan)}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Trends API
// {base}?keyword={q}&maxrecords={n}&timespan={t}
// ------------------------------------------------------------------------------
async function callTrends(payload) {
  const {
    query,
    maxrecords = 10,
    timespan = "30d",
  } = payload;

  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };

  const safeRecords = Math.min(Math.max(Number(maxrecords) || 10, 1), 250);

  let url = `${TRENDS_BASE}?keyword=${encodeURIComponent(query)}`;
  url += `&maxrecords=${safeRecords}`;
  url += `&timespan=${encodeURIComponent(timespan)}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
