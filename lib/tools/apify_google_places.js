// ==============================================================================
// Véritas v2.2 — /lib/tools/apify_google_places.js
// ==============================================================================
// Handler para Apify Google Places Crawler.
// Lanza el actor compass~crawler-google-places, espera resultado,
// y formatea listings con nombre, dirección, teléfono, web, coords, reviews.
//
// Interfaz: export async function run(args, ctx)
//   args: { query, max_places?, country?, language? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import apify from "../services/apify.js";

const MAX_OUTPUT_BYTES = 50_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 120_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    query,
    max_places = 10,
    country,
    language,
    wait_for_completion = false,
  } = args;

  if (!query) {
    return { status: "error", output: "Missing 'query' argument. Ejemplo: 'restaurants in Miami'." };
  }

  if (discoverKeys(env, "apify").length === 0) {
    return {
      status: "error",
      output: "Apify no está configurado. Configura APIFY_API_TOKEN_1 con: wrangler secret put APIFY_API_TOKEN_1",
    };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, "apify");

    // Construir input del actor.
    const runInput = {
      searchStringsArray: [query],
      maxCrawledPlaces: Math.min(max_places, 20),
    };
    if (country) runInput.country = country;
    if (language) runInput.language = language;

    // 1. Lanzar actor.
    const r = await apify.callService({
      endpoint: "run_actor",
      payload: { actor: "google_places", runInput },
      apiKey: key,
    });

    if (r.status >= 400 || !r.data) {
      await markCooldown(env, "apify", index, 30_000, `Apify Google Places run HTTP ${r.status}`);
      return {
        status: "error",
        output: `Apify Google Places: fallo al lanzar actor. HTTP ${r.status}. ${r.raw ? r.raw.slice(0, 500) : ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const runId = r.data?.data?.id || r.data?.id;
    if (!runId) {
      return {
        status: "error",
        output: `Apify Google Places: no runId en respuesta. ${JSON.stringify(r.data || {}).slice(0, 300)}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 2. Pollear hasta que termine (o timeout).
    const actorId = apify.resolveActor("google_places");
    let finalStatus = null;
    let datasetId = r.data?.data?.defaultDatasetId || r.data?.defaultDatasetId;

    if (!wait_for_completion) {
      return {
        status: "pending",
        output: `Apify Google Places: actor iniciado. RunId: ${runId}. Para respetar Cloudflare Free Tier no se espera el resultado en esta request. Consulta el run/dataset más tarde o vuelve a ejecutar con wait_for_completion=true si aceptas el riesgo de timeout.`,
        latency_ms: Date.now() - startTs,
        extra: { run_id: runId, dataset_id: datasetId || null, actor: actorId, async: true },
      };
    }

    const pollStart = Date.now();
    while (Date.now() - pollStart < MAX_POLL_MS) {
      await sleep(POLL_INTERVAL_MS);
      const pollR = await apify.callService({
        endpoint: "get_run",
        payload: { actor: "google_places", runId },
        apiKey: key,
      });
      if (pollR.data?.data?.status) {
        finalStatus = pollR.data.data.status;
        if (!datasetId && pollR.data.data.defaultDatasetId) {
          datasetId = pollR.data.data.defaultDatasetId;
        }
      }
      if (finalStatus === "SUCCEEDED" || finalStatus === "FAILED" || finalStatus === "ABORTED" || finalStatus === "TIMED-OUT") {
        break;
      }
    }

    if (finalStatus !== "SUCCEEDED") {
      const msg = finalStatus ? `Actor terminó con estado: ${finalStatus}` : "Polling timeout (120s)";
      await markCooldown(env, "apify", index, 10_000, `Google Places ${msg}`);
      return {
        status: "error",
        output: `Apify Google Places: ${msg}. RunId: ${runId}`,
        latency_ms: Date.now() - startTs,
      };
    }

    if (!datasetId) {
      return {
        status: "error",
        output: `Apify Google Places: no datasetId para obtener resultados. RunId: ${runId}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 3. Obtener resultados del dataset.
    const dsR = await apify.callService({
      endpoint: "get_dataset",
      payload: { datasetId, limit: Math.min(max_places, 50) },
        apiKey: key,
    });

    if (dsR.status >= 400 || !Array.isArray(dsR.data)) {
      return {
        status: "error",
        output: `Apify Google Places: fallo al obtener dataset. HTTP ${dsR.status}. ${dsR.raw ? dsR.raw.slice(0, 300) : ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 4. Formatear listings.
    const places = dsR.data;
    let output = places.map((p, i) => {
      let block = `--- Place ${i + 1} ---\n`;
      if (p.title || p.name) block += `Nombre: ${p.title || p.name}\n`;
      if (p.address) block += `Dirección: ${p.address}\n`;
      if (p.phone) block += `Teléfono: ${p.phone}\n`;
      if (p.website) block += `Web: ${p.website}\n`;
      if (p.category) block += `Categoría: ${p.category}\n`;
      if (p.rating || p.totalScore) block += `Rating: ${p.rating || p.totalScore}/5\n`;
      if (p.totalReviews || p.reviewsCount) block += `Reviews: ${p.totalReviews || p.reviewsCount}\n`;
      if (p.lat || p.location?.lat) block += `Coords: ${p.lat || p.location?.lat}, ${p.lng || p.location?.lng}\n`;
      if (p.googleMapsUrl || p.url) block += `Maps: ${p.googleMapsUrl || p.url}\n`;
      if (p.hours) block += `Horarios: ${typeof p.hours === 'string' ? p.hours : JSON.stringify(p.hours)}\n`;
      if (p.postsSummary) block += `Posts: ${JSON.stringify(p.postsSummary)}\n`;
      return block;
    }).join("\n\n");

    let truncated = false;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    let header = `Apify Google Places — "${query}" — ${Date.now() - startTs}ms\n` +
                  `Actor: ${actorId} | Run: ${runId}\n` +
                  `Results: ${places.length} places\n${"=".repeat(60)}\n\n`;

    return {
      status: "ok",
      output: header + output + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        query,
        actor: actorId,
        run_id: runId,
        result_count: places.length,
        size: output.length,
        truncated,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Apify Google Places: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { run };
