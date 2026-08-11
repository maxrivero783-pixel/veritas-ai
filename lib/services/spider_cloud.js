// ==============================================================================
// Véritas v2.2 — /lib/services/spider_cloud.js
// ==============================================================================
// Adaptador HTTP para Spider Cloud — crawler ultra-rápido.
// Endpoints:
//   POST /search     → búsqueda web combinada con crawling
//   POST /crawl      → crawling paralelo de múltiples páginas
//   POST /screenshot → captura visual de página (PNG/base64)
//   POST /unblocker  → bypass anti-bot (Cloudflare, intersticiales)
// Auth: Authorization: Bearer {SPIDER_API_KEY}
// ==============================================================================

const BASE = "https://api.spider.cloud";

// -----------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// -----------------------------------------------------------------------------
// endpoint: "search" | "crawl" | "screenshot" | "unblocker"
// payload :
//   search    → { query, limit?, return_format?, domain?, tbs? }
//   crawl     → { url, limit?, return_format?, depth? }
//   screenshot→ { url, full_page?, format?, quality? }
//   unblocker → { url, return_html? }
// apiKey    : clave Bearer
// -----------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "search":
      return callSearch(payload, apiKey);
    case "crawl":
      return callCrawl(payload, apiKey);
    case "screenshot":
      return callScreenshot(payload, apiKey);
    case "unblocker":
      return callUnblocker(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Spider Cloud endpoint: ${endpoint}` };
  }
}

// -----------------------------------------------------------------------------
// search: POST /search — búsqueda web + crawling en un solo call.
// -----------------------------------------------------------------------------
async function callSearch(payload, apiKey) {
  const {
    query,
    limit = 5,
    return_format = "markdown",
    domain,
    tbs,
  } = payload;

  if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };

  const body = { query, limit, return_format };
  if (domain) body.domain = domain;
  if (tbs) body.tbs = tbs;

  const resp = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// crawl: POST /crawl — crawling paralelo de un sitio.
// -----------------------------------------------------------------------------
async function callCrawl(payload, apiKey) {
  const {
    url,
    limit = 5,
    return_format = "markdown",
    depth,
  } = payload;

  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const body = { url, limit, return_format };
  if (depth !== undefined) body.depth = depth;

  const resp = await fetch(`${BASE}/crawl`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// screenshot: POST /screenshot — captura visual de página.
// -----------------------------------------------------------------------------
async function callScreenshot(payload, apiKey) {
  const {
    url,
    full_page = false,
    format = "png",
    quality = 80,
  } = payload;

  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const body = { url, full_page, format, quality };

  const resp = await fetch(`${BASE}/screenshot`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // Screenshots devuelven binario; devolver como base64.
  const contentType = resp.headers.get("content-type") || "image/png";
  if (contentType.includes("image")) {
    const buf = await resp.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { status: resp.status, data: { image_base64: b64, content_type: contentType }, raw: b64 };
  }

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// unblocker: POST /unblocker — bypass anti-bot.
// -----------------------------------------------------------------------------
async function callUnblocker(payload, apiKey) {
  const {
    url,
    return_html = false,
  } = payload;

  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const body = { url, return_html };

  const resp = await fetch(`${BASE}/unblocker`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
