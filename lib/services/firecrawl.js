// ==============================================================================
// Véritas v2.4 — /lib/services/firecrawl.js
// ==============================================================================
// Adaptador HTTP para Firecrawl.
// Endpoints:
//   POST https://api.firecrawl.dev/v1/scrape    (scraping de una URL con extracción estructurada)
//   POST https://api.firecrawl.dev/v1/crawl     (crawl recursivo multi-página)
//   GET  https://api.firecrawl.dev/v1/crawl/:id (estado de un crawl async)
//   GET  https://api.firecrawl.dev/v1/key       (cuota restante)
// Auth: Authorization: Bearer <api_key>
// ==============================================================================

const BASE = "https://api.firecrawl.dev/v1";

// ------------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// Endpoints soportados:
//   "scrape"   → payload: { url, formats?, onlyMainContent?, includeTags?, excludeTags?, waitFor?, timeout? }
//   "crawl"    → payload: { url, limit?, max_depth?, includes?, excludes?, allowBackwardLinks? }
//   "crawl_status" → payload: { id }
//   "key"      → payload: {} (GET /key para cuota)
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "scrape":
      return callScrape(payload, apiKey);
    case "crawl":
      return callCrawl(payload, apiKey);
    case "crawl_status":
      return callCrawlStatus(payload, apiKey);
    case "key":
      return callKey(apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Firecrawl endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// scrape: POST /v1/scrape
// Body: { url, formats: ["markdown","html","rawHtml"], onlyMainContent: true, ... }
// Devuelve { data: { markdown, html, rawHtml, metadata: { title, description, url, ... } } }
// ------------------------------------------------------------------------------
async function callScrape(payload, apiKey) {
  const {
    url,
    formats = ["markdown"],
    onlyMainContent = true,
    includeTags,
    excludeTags,
    waitFor,
    timeout = 30000,
    extract,
  } = payload;

  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const body = { url, formats, onlyMainContent, timeout };
  if (includeTags) body.includeTags = includeTags;
  if (excludeTags) body.excludeTags = excludeTags;
  if (waitFor) body.waitFor = waitFor;
  if (extract) body.extract = extract;

  const resp = await fetch(`${BASE}/scrape`, {
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

// ------------------------------------------------------------------------------
// crawl: POST /v1/crawl (async — devuelve { id, url } para pollear)
// Body: { url, limit, max_depth, ... }
// ------------------------------------------------------------------------------
async function callCrawl(payload, apiKey) {
  const {
    url,
    limit = 10,
    max_depth = 2,
    includes,
    excludes,
    allowBackwardLinks = false,
  } = payload;

  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const body = { url, limit, max_depth, allowBackwardLinks };
  if (includes) body.includes = includes;
  if (excludes) body.excludes = excludes;

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

// ------------------------------------------------------------------------------
// crawl_status: GET /v1/crawl/:id
// Devuelve { status: "scraping" | "completed" | "failed", total, completed, data: [...] }
// ------------------------------------------------------------------------------
async function callCrawlStatus(payload, apiKey) {
  const { id } = payload;
  if (!id) return { status: 400, data: null, raw: null, error: "Missing id" };

  const resp = await fetch(`${BASE}/crawl/${id}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// key: GET /v1/key → cuota restante
// ------------------------------------------------------------------------------
async function callKey(apiKey) {
  const resp = await fetch(`${BASE}/key`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
