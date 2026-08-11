// ==============================================================================
// Véritas v2.4 — /lib/services/serper.js
// ==============================================================================
// Adaptador HTTP para Serper.dev (Google Search API).
// Endpoint: POST https://google.serper.dev/search  (y variantes /news, /images, /places)
// Auth: header X-API-KEY: <api_key>
//
// Serper devuelve resultados estilo Google SERP: organic, knowledgeGraph,
// peopleAlsoAsk, relatedSearches. Cada organic incluye title, link, snippet,
// position.
// ==============================================================================

const BASE = "https://google.serper.dev";

// ------------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// Endpoints soportados:
//   "search"  → payload: { q, num?, gl?, hl?, tbs? }
//   "news"    → payload: { q, num?, gl?, hl? }
//   "images"  → payload: { q, num?, gl?, hl? }
//   "places"  → payload: { q, num?, gl?, hl?, location? }
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  const path = {
    search: "/search",
    news: "/news",
    images: "/images",
    places: "/places",
  }[endpoint];

  if (!path) {
    return { status: 400, data: null, raw: null, error: `Unknown Serper endpoint: ${endpoint}` };
  }

  const { q, num = 10, gl = "us", hl = "es", tbs, location } = payload;
  if (!q) return { status: 400, data: null, raw: null, error: "Missing q" };

  const body = { q, num, gl, hl };
  if (tbs) body.tbs = tbs;
  if (location) body.location = location;

  const resp = await fetch(BASE + path, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
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
