// ==============================================================================
// Véritas v2.4 — /lib/services/steel.js
// ==============================================================================
// Adaptador HTTP para Steel.dev (browser sessions persistentes).
// Endpoints:
//   POST https://api.steel.dev/v1/sessions        (crear sesión)
//   GET  https://api.steel.dev/v1/sessions/:id    (estado)
//   DELETE https://api.steel.dev/v1/sessions/:id  (liberar)
//   POST https://api.steel.dev/v1/scrape          (scrape usando una sesión)
// Auth: header "steel-api-key: <api_key>"
//
// Steel devuelve un endpoint WebSocket/CDP para control posterior, pero para
// Véritas usamos el endpoint de scrape directo (no CDP).
// ==============================================================================

const BASE = "https://api.steel.dev/v1";

// ------------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// Endpoints soportados:
//   "create_session"  → payload: { proxy?, userAgent?, sessionTimeout?, ... }
//   "release_session" → payload: { session_id }
//   "scrape"          → payload: { url, session_id?, render_js?, timeout? }
//   "session_status"  → payload: { session_id }
//   "health"          → payload: {}
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "create_session":
      return createSession(payload, apiKey);
    case "release_session":
      return releaseSession(payload, apiKey);
    case "scrape":
      return scrape(payload, apiKey);
    case "session_status":
      return sessionStatus(payload, apiKey);
    case "health":
      return callHealth(apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Steel endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// createSession: POST /v1/sessions
// Body: { proxy?, userAgent?, sessionTimeout?, solveCaptcha?, ... }
// Devuelve { id, status, wsEndpoint, cdpUrl, ... }
// ------------------------------------------------------------------------------
async function createSession(payload, apiKey) {
  const body = {
    // defaults sensatos
    sessionTimeout: 300000, // 5 min
    solveCaptcha: false,
    ...payload,
  };

  const resp = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: {
      "steel-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// releaseSession: DELETE /v1/sessions/:id
// Devuelve 204 No Content o JSON con error.
// ------------------------------------------------------------------------------
async function releaseSession(payload, apiKey) {
  const { session_id } = payload;
  if (!session_id) return { status: 400, data: null, raw: null, error: "Missing session_id" };

  const resp = await fetch(`${BASE}/sessions/${encodeURIComponent(session_id)}`, {
    method: "DELETE",
    headers: { "steel-api-key": apiKey },
  });
  // 204 → sin body
  if (resp.status === 204) return { status: 204, data: { released: true }, raw: "" };
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// scrape: POST /v1/scrape
// Body: { url, sessionId?, renderJs?, timeout?, waitForSelector?, ... }
// Devuelve { url, content, title, statusCode, ... }
// ------------------------------------------------------------------------------
async function scrape(payload, apiKey) {
  const { url, session_id, render_js = true, timeout = 30000, waitForSelector } = payload;
  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const body = { url, renderJs: render_js, timeout };
  if (session_id) body.sessionId = session_id;
  if (waitForSelector) body.waitForSelector = waitForSelector;

  const resp = await fetch(`${BASE}/scrape`, {
    method: "POST",
    headers: {
      "steel-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// sessionStatus: GET /v1/sessions/:id
// ------------------------------------------------------------------------------
async function sessionStatus(payload, apiKey) {
  const { session_id } = payload;
  if (!session_id) return { status: 400, data: null, raw: null, error: "Missing session_id" };

  const resp = await fetch(`${BASE}/sessions/${encodeURIComponent(session_id)}`, {
    method: "GET",
    headers: { "steel-api-key": apiKey },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// health: GET /v1/health
// ------------------------------------------------------------------------------
async function callHealth(apiKey) {
  const resp = await fetch(`${BASE}/health`, {
    method: "GET",
    headers: { "steel-api-key": apiKey },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { status: text }; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
