// ==============================================================================
// Véritas v2.4 — /lib/tools/scrape_url.js
// ==============================================================================
// Scraping puntual de una URL. Estrategia:
//   1. Si render_js === false: usar Jina r.jina.ai (rápido, sin headless).
//   2. Si render_js === true: usar ScrapingBee (headless Chrome).
//   3. Fallback: si ScrapingBee no está configurado y se pidió render_js,
//      intentar Jina igual con warning (probablemente no renderizará el JS,
//      pero al menos devolverá contenido estático).
//
// Interfaz: export async function run(args, ctx)
//   args: { url: string, render_js?: boolean }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import jina from "../services/jina.js";
import scrapingbee from "../services/scrapingbee.js";

const MAX_OUTPUT_BYTES = 50_000; // 50 KB truncado para el contexto del modelo

export async function run(args, ctx) {
  const { env } = ctx;
  const { url, render_js = false } = args;
  if (!url) return { status: "error", output: "Missing 'url' argument." };

  const startTs = Date.now();
  const wantRenderJs = render_js === true || render_js === "true";

  // 1. Jina Reader (sin JS render, a menos que se pida explícitamente y no haya ScrapingBee)
  if (!wantRenderJs && discoverKeys(env, "jina").length > 0) {
    const result = await tryJina(env, url);
    if (result) return finalize(result, startTs, "jina");
  }

  // 2. ScrapingBee (con JS render si se pidió)
  if (discoverKeys(env, "scrapingbee").length > 0) {
    const result = await tryScrapingBee(env, url, wantRenderJs);
    if (result) return finalize(result, startTs, "scrapingbee", wantRenderJs ? "render_js=true" : "render_js=false");
  }

  // 3. Fallback: Jina Reader incluso si se pidió render_js (ScrapingBee no disponible)
  if (wantRenderJs && discoverKeys(env, "jina").length > 0) {
    const result = await tryJina(env, url);
    if (result) {
      result.warning = "Se solicitó render_js=true pero ScrapingBee no está configurado. Se usó Jina Reader (sin renderizado JS).";
      return finalize(result, startTs, "jina-fallback");
    }
  }

  return {
    status: "error",
    output: `No se pudo scrappear ${url}. Ningún proveedor de scraping (Jina, ScrapingBee) está configurado o todos fallaron. ` +
            `Configura JINA_API_KEY_1 (sin JS render) o SCRAPINGBEE_API_KEY_1 (con JS render) con wrangler secret put.`,
    latency_ms: Date.now() - startTs,
  };
}

async function tryJina(env, url) {
  try {
    const { key, index } = await getKey(env, "jina");
    const r = await jina.callService({ endpoint: "reader", payload: { url }, apiKey: key });
    if (r.status === 200 && r.data && (r.data.content || r.raw)) {
      return {
        provider: "jina",
        content: r.data.content || r.raw,
        title: r.data.title || url,
        url,
      };
    }
    await markCooldown(env, "jina", index, 30_000, `scrape_url HTTP ${r.status}`);
  } catch (e) { /* fall through */ }
  return null;
}

async function tryScrapingBee(env, url, renderJs) {
  try {
    const { key, index } = await getKey(env, "scrapingbee");
    const r = await scrapingbee.callService({
      endpoint: "scrape",
      payload: { url, render_js: renderJs },
      apiKey: key,
    });
    if (r.status === 200 && r.data && r.data.content) {
      return {
        provider: "scrapingbee",
        content: r.data.content,
        title: url,
        url,
      };
    }
    await markCooldown(env, "scrapingbee", index, 60_000, `scrape_url HTTP ${r.status}`);
  } catch (e) { /* fall through */ }
  return null;
}

function finalize(result, startTs, providerLabel, extraLabel) {
  const latency = Date.now() - startTs;
  let content = result.content || "";
  let truncated = false;
  if (content.length > MAX_OUTPUT_BYTES) {
    content = content.slice(0, MAX_OUTPUT_BYTES);
    truncated = true;
  }
  let output = `Scraping de ${result.url} vía ${result.provider}${extraLabel ? ` (${extraLabel})` : ""} — ${latency}ms\n` +
               `Título: ${result.title}\n${"=".repeat(60)}\n${content}`;
  if (truncated) output += `\n\n[... contenido truncado a ${MAX_OUTPUT_BYTES} bytes para el contexto del modelo. Si necesitas más, pídelo explícitamente.]`;
  if (result.warning) output = `${result.warning}\n\n${output}`;
  return {
    status: "ok",
    output,
    latency_ms: latency,
    extra: { provider: result.provider, url: result.url, size: (result.content || "").length, truncated },
  };
}

export default { run };
