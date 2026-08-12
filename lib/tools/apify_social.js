// ==============================================================================
// Véritas v2.2 — /lib/tools/apify_social.js
// ==============================================================================
// Handler para Apify Social Media Tools — scraping de perfiles/posts públicos.
// Plataformas: facebook_posts, instagram_profile, instagram_posts,
//              tiktok_profile, twitter_profile, threads_profile.
//
// Interfaz: export async function run(args, ctx)
//   args: { platform, target, results_limit? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import apify from "../services/apify.js";

const MAX_OUTPUT_BYTES = 50_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 120_000;

// Mapeo plataforma → actor ID.
const PLATFORM_ACTORS = {
  facebook_posts: "facebook_posts",
  instagram_profile: "instagram_profile",
  instagram_posts: "instagram_posts",
  tiktok_profile: "tiktok_profile",
  twitter_profile: "twitter_profile",
  threads_profile: "threads_profile",
};

const VALID_PLATFORMS = Object.keys(PLATFORM_ACTORS);

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    platform,
    target,
    results_limit = 10,
    wait_for_completion = false,
  } = args;

  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return { status: "error", output: `Missing o inválido 'platform'. Debe ser uno de: ${VALID_PLATFORMS.join(", ")}` };
  }
  if (!target) {
    return { status: "error", output: `Missing 'target'. Especifica username, URL o ID según la plataforma.` };
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

    // Construir input según plataforma.
    const actorName = PLATFORM_ACTORS[platform];
    const runInput = buildRunInput(platform, target, results_limit);

    // 1. Lanzar actor.
    const r = await apify.callService({
      endpoint: "run_actor",
      payload: { actor: actorName, runInput },
      apiKey: key,
    });

    if (r.status >= 400 || !r.data) {
      await markCooldown(env, "apify", index, 30_000, `Apify Social ${platform} run HTTP ${r.status}`);
      return {
        status: "error",
        output: `Apify Social (${platform}): fallo al lanzar actor. HTTP ${r.status}. ${r.raw ? r.raw.slice(0, 500) : ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const runId = r.data?.data?.id || r.data?.id;
    if (!runId) {
      return {
        status: "error",
        output: `Apify Social (${platform}): no runId en respuesta. ${JSON.stringify(r.data || {}).slice(0, 300)}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 2. Pollear hasta terminar.
    let finalStatus = null;
    let datasetId = r.data?.data?.defaultDatasetId || r.data?.defaultDatasetId;

    if (!wait_for_completion) {
      return {
        status: "pending",
        output: `Apify Social: actor iniciado. RunId: ${runId}. Para respetar Cloudflare Free Tier no se espera el resultado en esta request. Consulta el run/dataset más tarde o vuelve a ejecutar con wait_for_completion=true si aceptas el riesgo de timeout.`,
        latency_ms: Date.now() - startTs,
        extra: { run_id: runId, dataset_id: datasetId || null, async: true },
      };
    }

    const pollStart = Date.now();
    while (Date.now() - pollStart < MAX_POLL_MS) {
      await sleep(POLL_INTERVAL_MS);
      const pollR = await apify.callService({
        endpoint: "get_run",
        payload: { actor: actorName, runId },
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
      const msg = finalStatus ? `Actor terminó: ${finalStatus}` : "Polling timeout (120s)";
      await markCooldown(env, "apify", index, 10_000, `Social ${platform} ${msg}`);
      return {
        status: "error",
        output: `Apify Social (${platform}): ${msg}. RunId: ${runId}`,
        latency_ms: Date.now() - startTs,
      };
    }

    if (!datasetId) {
      return {
        status: "error",
        output: `Apify Social (${platform}): no datasetId. RunId: ${runId}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 3. Obtener resultados.
    const dsR = await apify.callService({
      endpoint: "get_dataset",
      payload: { datasetId, limit: Math.min(results_limit, 50) },
      apiKey: key,
    });

    if (dsR.status >= 400 || !Array.isArray(dsR.data)) {
      return {
        status: "error",
        output: `Apify Social (${platform}): fallo dataset. HTTP ${dsR.status}. ${dsR.raw ? dsR.raw.slice(0, 300) : ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 4. Formatear según plataforma.
    const items = dsR.data;
    let output = formatByPlatform(platform, items);

    let truncated = false;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    const actorId = apify.resolveActor(actorName);
    let header = `Apify Social (${platform}) — "${target}" — ${Date.now() - startTs}ms\n` +
                  `Actor: ${actorId} | Run: ${runId}\n` +
                  `Results: ${items.length} items\n${"=".repeat(60)}\n\n`;

    return {
      status: "ok",
      output: header + output + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        platform,
        target,
        actor: actorId,
        run_id: runId,
        result_count: items.length,
        size: output.length,
        truncated,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Apify Social: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

// -----------------------------------------------------------------------------
// buildRunInput: construye el input del actor según plataforma.
// -----------------------------------------------------------------------------
function buildRunInput(platform, target, results_limit) {
  const limit = Math.min(results_limit, 20);

  switch (platform) {
    case "facebook_posts":
      return { startUrls: [{ url: target }], resultsLimit: limit };
    case "instagram_profile":
      return { usernames: [target], resultsLimit: limit };
    case "instagram_posts":
      return { postURLs: [target], resultsLimit: limit };
    case "tiktok_profile":
      return { profiles: [target], resultsLimit: limit };
    case "twitter_profile":
      return { usernames: [target], resultsLimit: limit };
    case "threads_profile":
      return { usernames: [target], resultsLimit: limit };
    default:
      return { resultsLimit: limit };
  }
}

// -----------------------------------------------------------------------------
// formatByPlatform: formatea los items crudos según la plataforma.
// -----------------------------------------------------------------------------
function formatByPlatform(platform, items) {
  if (items.length === 0) return "(Sin resultados)";

  return items.map((item, i) => {
    let block = `--- Item ${i + 1} ---\n`;

    // Campos genéricos
    if (item.username || item.handle) block += `Username: ${item.username || item.handle}\n`;
    if (item.fullName || item.name) block += `Nombre: ${item.fullName || item.name}\n`;
    if (item.bio || item.description) block += `Bio: ${(item.bio || item.description || "").slice(0, 300)}\n`;
    if (item.text || item.content) block += `Texto: ${(item.text || item.content || "").slice(0, 500)}\n`;
    if (item.url) block += `URL: ${item.url}\n`;
    if (item.timestamp || item.date) block += `Fecha: ${item.timestamp || item.date}\n`;
    if (item.likes !== undefined || item.likeCount !== undefined) block += `Likes: ${item.likes ?? item.likeCount}\n`;
    if (item.comments !== undefined || item.commentCount !== undefined) block += `Comments: ${item.comments ?? item.commentCount}\n`;
    if (item.shares !== undefined || item.shareCount !== undefined) block += `Shares: ${item.shares ?? item.shareCount}\n`;
    if (item.followersCount !== undefined) block += `Followers: ${item.followersCount}\n`;
    if (item.followingCount !== undefined) block += `Following: ${item.followingCount}\n`;
    if (item.postsCount !== undefined) block += `Posts: ${item.postsCount}\n`;
    if (item.verified) block += "Verificado: si\n";
    if (item.profilePictureUrl) block += `Avatar: ${item.profilePictureUrl}\n`;
    if (item.externalUrl) block += `Web: ${item.externalUrl}\n`;

    // Si tiene hashtags o menciones
    if (item.hashtags && item.hashtags.length > 0) block += `Hashtags: ${item.hashtags.join(", ")}\n`;
    if (item.mentions && item.mentions.length > 0) block += `Mentions: ${item.mentions.join(", ")}\n`;

    return block;
  }).join("\n\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { run };
