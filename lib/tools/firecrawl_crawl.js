// ==============================================================================
// Véritas v2.4 — /lib/tools/firecrawl_crawl.js
// ==============================================================================
// Crawl recursivo de un sitio web completo (hasta N páginas) vía Firecrawl.
// Firecrawl devuelve { id } y el crawl es async; este handler hace polling
// hasta completar (o timeout).
//
// Interfaz: export async function run(args, ctx)
//   args: { url: string, limit?: number, max_depth?: number }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import firecrawl from "../services/firecrawl.js";

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 min
const MAX_OUTPUT_BYTES = 80_000; // permitimos más porque un crawl implica varias páginas

export async function run(args, ctx) {
  const { env } = ctx;
  const { url, limit = 10, max_depth = 2 } = args;
  if (!url) return { status: "error", output: "Missing 'url' argument." };

  if (discoverKeys(env, "firecrawl").length === 0) {
    return {
      status: "error",
      output: "Firecrawl no está configurado. Configura FIRECRAWL_API_KEY_1 con: wrangler secret put FIRECRAWL_API_KEY_1",
    };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, "firecrawl");

    // 1. Crear el crawl.
    const createR = await firecrawl.callService({
      endpoint: "crawl",
      payload: { url, limit, max_depth },
      apiKey: key,
    });

    if (createR.status !== 200 || !createR.data || !createR.data.id) {
      await markCooldown(env, "firecrawl", index, 30_000, `crawl create HTTP ${createR.status}`);
      return {
        status: "error",
        output: `Firecrawl crawl creation falló para ${url}: HTTP ${createR.status}. ${createR.data?.error || createR.raw?.slice(0, 500) || ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const crawlId = createR.data.id;

    // 2. Polling hasta completar.
    const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
    let lastStatus = null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const pollR = await firecrawl.callService({
        endpoint: "crawl_status",
        payload: { id: crawlId },
        apiKey: key,
      });
      if (pollR.status !== 200 || !pollR.data) continue;
      lastStatus = pollR.data;
      const status = lastStatus.status;
      if (status === "completed") break;
      if (status === "failed" || status === "error") {
        return {
          status: "error",
          output: `Firecrawl crawl ${crawlId} falló: ${lastStatus.error || "sin mensaje de error"}`,
          latency_ms: Date.now() - startTs,
          extra: { crawl_id: crawlId, url },
        };
      }
      // si no terminó, seguir polleando
    }

    if (!lastStatus || lastStatus.status !== "completed") {
      return {
        status: "error",
        output: `Firecrawl crawl ${crawlId} agotó timeout de ${DEFAULT_TIMEOUT_MS}ms. Último status: ${lastStatus?.status || "desconocido"}.`,
        latency_ms: Date.now() - startTs,
        extra: { crawl_id: crawlId, url, last_status: lastStatus?.status },
      };
    }

    // 3. Formatear resultados.
    const pages = lastStatus.data || [];
    let output = `Firecrawl crawl completado para ${url} — ${Date.now() - startTs}ms\n` +
                 `Páginas extraídas: ${pages.length} (limit=${limit}, max_depth=${max_depth})\n` +
                 `${"=".repeat(60)}\n`;

    let totalSize = 0;
    let truncated = false;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const md = (page.markdown || "").slice(0, 5000);
      const pageBlock = `\n--- Página ${i + 1}: ${page.metadata?.sourceURL || page.metadata?.url || "(sin URL)"} ---\n${md}\n`;
      if (output.length + pageBlock.length > MAX_OUTPUT_BYTES) {
        truncated = true;
        output += `\n[... ${pages.length - i} páginas más omitidas por límite de tamaño. El crawl completo tiene ${pages.length} páginas.]`;
        break;
      }
      output += pageBlock;
      totalSize += page.markdown?.length || 0;
    }

    return {
      status: "ok",
      output,
      latency_ms: Date.now() - startTs,
      extra: {
        crawl_id: crawlId,
        url,
        pages_count: pages.length,
        total_size: totalSize,
        truncated,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Firecrawl crawl: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { run };
