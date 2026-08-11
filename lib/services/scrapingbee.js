// ==============================================================================
// Véritas v2.4 — /lib/services/scrapingbee.js
// ==============================================================================
// Adaptador HTTP para ScrapingBee.
// Endpoint: GET https://app.scrapingbee.com/api/v1/
// Auth: api_key en query string.
//
// ScrapingBee renderiza JS con headless Chrome. Útil cuando r.jina.ai no puede
// extraer contenido de SPAs pesadas. Soporta proxy premium, stealth proxy,
// wait_for_selector, js_scenario (para clicks/scrolls).
// ==============================================================================

const API_URL = "https://app.scrapingbee.com/api/v1";

// ------------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// Endpoints soportados:
//   "scrape"   → payload: { url, render_js?, premium_proxy?, stealth_proxy?,
//                            wait_for?, timeout?, js_scenario?, extract_rules? }
//   "usage"    → payload: {}  (GET /usage para telemetría)
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "scrape":
      return callScrape(payload, apiKey);
    case "usage":
      return callUsage(apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown ScrapingBee endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// scrape: GET /api/v1/ con api_key + url + opciones en query.
// Devuelve el HTML crudo de la página (200) o JSON de error.
// ------------------------------------------------------------------------------
async function callScrape(payload, apiKey) {
  const {
    url,
    render_js = true,
    premium_proxy = false,
    stealth_proxy = false,
    wait_for,
    wait,
    timeout = 30000,
    js_scenario,
    extract_rules,
    return_page_source = true,
    custom_headers,
  } = payload;

  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const u = new URL(API_URL);
  u.searchParams.set("api_key", apiKey);
  u.searchParams.set("url", url);
  // render_js: ScrapingBee usa "render_js" como string "true"/"false".
  u.searchParams.set("render_js", render_js ? "true" : "false");
  u.searchParams.set("premium_proxy", premium_proxy ? "true" : "false");
  u.searchParams.set("stealth_proxy", stealth_proxy ? "true" : "false");
  u.searchParams.set("return_page_source", return_page_source ? "true" : "false");
  u.searchParams.set("timeout", String(timeout));
  if (wait_for) u.searchParams.set("wait_for", wait_for);
  if (wait) u.searchParams.set("wait", String(wait));
  if (js_scenario) u.searchParams.set("js_scenario", bytesToBase64(new TextEncoder().encode(typeof js_scenario === "string" ? js_scenario : JSON.stringify(js_scenario))));
  if (extract_rules) u.searchParams.set("extract_rules", JSON.stringify(extract_rules));
  if (custom_headers) {
    // ScrapingBee acepta headers custom con prefijo "custom_header=".
    for (const [k, v] of Object.entries(custom_headers)) {
      u.searchParams.append("custom_headers", `${k}: ${v}`);
    }
  }

  const resp = await fetch(u.toString(), { method: "GET" });
  const text = await resp.text();

  // 200 → HTML crudo. Otros → JSON de error.
  let data;
  if (resp.status === 200) {
    data = { content: text };
  } else {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// usage: GET /api/v1/usage?api_key=...
// Devuelve { max_api_calls, used_api_calls, max_concurrency, current_concurrency }
// ------------------------------------------------------------------------------
async function callUsage(apiKey) {
  const u = new URL(API_URL.replace("/v1", "/v1/usage"));
  u.searchParams.set("api_key", apiKey);
  const resp = await fetch(u.toString(), { method: "GET" });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };

// ------------------------------------------------------------------------------
// Helper: bytes → base64. Reemplaza Buffer.from() que no existe en Workers.
// ------------------------------------------------------------------------------
function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
