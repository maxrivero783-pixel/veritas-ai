import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.12.3 — /lib/services/scrapedo.js
// ==============================================================================
// Adaptador HTTP para Scrape.do (scraping con pool de proxies rotativos).
// Base: https://api.scrape.do
// Auth: token como query parameter.
//
// Endpoints cubiertos:
//   "scrape" → GET /?token&url  (+ render, geoCode, output=raw|markdown, super, device)
//   "google" → GET /plugin/google/search?token&q  (SERP estructurada)
//
// Nota: `super=true` usa proxies residenciales/móviles y cuesta 10x créditos.
// ==============================================================================

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "scrape": {
      const { url: targetUrl, render = false, geoCode, output, super_proxy = false, device } = payload;
      if (!targetUrl) return { status: 400, data: null, raw: null, error: "Missing url" };
      const u = new URL("https://api.scrape.do/");
      u.searchParams.set("token", apiKey);
      u.searchParams.set("url", targetUrl);
      if (render) u.searchParams.set("render", "true");
      if (geoCode) u.searchParams.set("geoCode", geoCode);
      if (output) u.searchParams.set("output", output);
      if (super_proxy) u.searchParams.set("super", "true");
      if (device) u.searchParams.set("device", device);
      return doFetch(u.toString(), 60000);
    }
    case "google": {
      const { query } = payload;
      if (!query) return { status: 400, data: null, raw: null, error: "Missing query" };
      const u = new URL("https://api.scrape.do/plugin/google/search");
      u.searchParams.set("token", apiKey);
      u.searchParams.set("q", query);
      return doFetch(u.toString(), 45000);
    }
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Scrape.do endpoint: ${endpoint}` };
  }
}

async function doFetch(url, timeoutMs) {
  const response = await fetchT(url, { timeoutMs });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data, raw, error: response.ok ? undefined : `HTTP ${response.status}` };
}

export default { callService };
