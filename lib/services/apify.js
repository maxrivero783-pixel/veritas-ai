// ==============================================================================
// Véritas v2.4 — /lib/services/apify.js
// ==============================================================================
// Adaptador HTTP para Apify — plataforma de actores de scraping.
// Flujo: POST /v2/acts/<actor>/runs → pollear GET /v2/acts/<actor>/runs/<runId>
//        hasta terminar → GET /v2/datasets/<datasetId>/items para resultados.
//
// Auth: Authorization: Bearer {APIFY_API_TOKEN} o ?token= en query.
// ==============================================================================

const APIFY_BASE = "https://api.apify.com/v2";

// -----------------------------------------------------------------------------
// ACTOR_MAP — mapea nombres cortos a actor IDs de Apify.
// -----------------------------------------------------------------------------
const ACTOR_MAP = {
  // Google Places
  google_places: "compass~crawler-google-places",
  // Social Media
  facebook_posts: "apify~facebook-posts-scraper",
  instagram_profile: "apify~instagram-profile-scraper",
  instagram_posts: "apify~instagram-post-scraper",
  tiktok_profile: "clockworks~free-tiktok-scraper",
  twitter_profile: "apify~twitter-profile-scraper",
  threads_profile: "curious_coder~threads-scraper",
};

// -----------------------------------------------------------------------------
// callService: dispatcher.
// -----------------------------------------------------------------------------
// endpoint: "run_actor" | "get_run" | "get_dataset"
// payload :
//   run_actor   → { actor, runInput, timeout_ms? }
//   get_run     → { actor, runId }
//   get_dataset → { datasetId, limit? }
// apiKey       : API token
// -----------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "run_actor":
      return callRunActor(payload, apiKey);
    case "get_run":
      return callGetRun(payload, apiKey);
    case "get_dataset":
      return callGetDataset(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Apify endpoint: ${endpoint}` };
  }
}

// -----------------------------------------------------------------------------
// resolveActor: convierte nombre corto a actor ID.
// -----------------------------------------------------------------------------
export function resolveActor(name) {
  return ACTOR_MAP[name] || name;
}

// -----------------------------------------------------------------------------
// callRunActor: POST /v2/acts/<actor>/runs — lanza un actor.
// Devuelve { runId, status, ... }.
// -----------------------------------------------------------------------------
async function callRunActor(payload, apiKey) {
  const { actor, runInput, timeout_ms } = payload;
  if (!actor) return { status: 400, data: null, raw: null, error: "Missing actor name" };

  const actorId = resolveActor(actor);
  const body = typeof runInput === "object" ? JSON.stringify(runInput) : (runInput || "{}");

  const resp = await fetch(`${APIFY_BASE}/acts/${actorId}/runs`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callGetRun: GET /v2/acts/<actor>/runs/<runId> — estado de un run.
// -----------------------------------------------------------------------------
async function callGetRun(payload, apiKey) {
  const { actor, runId } = payload;
  if (!actor || !runId) return { status: 400, data: null, raw: null, error: "Missing actor and/or runId" };

  const actorId = resolveActor(actor);
  const resp = await fetch(`${APIFY_BASE}/acts/${actorId}/runs/${runId}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callGetDataset: GET /v2/datasets/<datasetId>/items — resultados del run.
// -----------------------------------------------------------------------------
async function callGetDataset(payload, apiKey) {
  const { datasetId, limit = 100 } = payload;
  if (!datasetId) return { status: 400, data: null, raw: null, error: "Missing datasetId" };

  const resp = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?limit=${limit}&clean=true`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService, resolveActor };
