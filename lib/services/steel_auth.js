import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.2 — /lib/services/steel_auth.js
// ==============================================================================
// Adaptador HTTP para Steel.dev sesiones AUTENTICADAS (con proxy, headers,
// cookies, fingerprint, geoLocation).
// Separado del servicio steel.js (sesiones no autenticadas/efímeras).
//
// Endpoints cubiertos:
//   - "create" → POST https://api.steel.dev/v1/sessions
//   - "scrape" → POST https://api.steel.dev/v1/sessions/{session_id}/scrape
//
// Auth: header "steel-api-key: <api_key>"
// ==============================================================================

const BASE = 'https://api.steel.dev/v1';

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case 'create':
      return createSession(payload, apiKey);
    case 'scrape':
      return scrapeSession(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Steel Auth endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// createSession: POST /v1/sessions
// Body: { proxy?, geoLocation?, headers?, cookies?, blockAds?, fingerprint? }
// Devuelve { id, status, wsEndpoint, cdpUrl, ... }
// ------------------------------------------------------------------------------
async function createSession(payload, apiKey) {
  const body = {
    blockAds: payload.blockAds || false,
  };

  if (payload.proxy) body.proxy = payload.proxy;
  if (payload.geoLocation) body.geoLocation = payload.geoLocation;
  if (payload.headers) body.headers = payload.headers;
  if (payload.cookies) body.cookies = payload.cookies;
  if (payload.fingerprint) body.fingerprint = payload.fingerprint;

  const resp = await fetchT(`${BASE}/sessions`, {
    method: 'POST',
    headers: {
      'steel-api-key': apiKey,
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
// scrapeSession: POST /v1/sessions/{session_id}/scrape
// Body: { url, actions?, extract? }
// Devuelve { content, title, statusCode, ... }
// ------------------------------------------------------------------------------
async function scrapeSession(payload, apiKey) {
  const { session_id, url } = payload;
  if (!session_id) return { status: 400, data: null, raw: null, error: 'Missing session_id' };
  if (!url) return { status: 400, data: null, raw: null, error: 'Missing url' };

  const body = { url };
  if (payload.actions) body.actions = payload.actions;
  if (payload.extract) body.extract = payload.extract;

  const resp = await fetchT(`${BASE}/sessions/${encodeURIComponent(session_id)}/scrape`, {
    method: 'POST',
    headers: {
      'steel-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
