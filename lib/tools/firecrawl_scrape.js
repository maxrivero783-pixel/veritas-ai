// ==============================================================================
// Véritas v2.4 — /lib/tools/firecrawl_scrape.js
// ==============================================================================
// Scraping de una URL con extracción estructurada vía Firecrawl.
// Devuelve markdown limpio (y opcionalmente HTML/rawHtml si se pide).
//
// Interfaz: export async function run(args, ctx)
//   args: { url: string, formats?: string[] }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import firecrawl from "../services/firecrawl.js";

const MAX_OUTPUT_BYTES = 50_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const { url, formats = ["markdown"] } = args;
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
    const r = await firecrawl.callService({
      endpoint: "scrape",
      payload: { url, formats, onlyMainContent: true },
      apiKey: key,
    });

    if (r.status !== 200 || !r.data) {
      await markCooldown(env, "firecrawl", index, 30_000, `scrape HTTP ${r.status}`);
      return {
        status: "error",
        output: `Firecrawl scrape falló para ${url}: HTTP ${r.status}. ${r.data?.error || r.raw?.slice(0, 500) || ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const data = r.data.data || r.data;
    const parts = [];
    if (data.markdown) parts.push(`--- MARKDOWN ---\n${data.markdown}`);
    if (data.html) parts.push(`--- HTML ---\n${data.html}`);
    if (data.rawHtml) parts.push(`--- RAW HTML ---\n${data.rawHtml}`);
    if (data.metadata) parts.push(`--- METADATA ---\n${JSON.stringify(data.metadata, null, 2)}`);

    let output = parts.join("\n\n");
    let truncated = false;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    const header = `Firecrawl scrape de ${url} — ${Date.now() - startTs}ms\n` +
                   `Formats: ${formats.join(", ")}\n${"=".repeat(60)}\n`;
    return {
      status: "ok",
      output: header + output + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        url,
        formats,
        size: output.length,
        truncated,
        title: data.metadata?.title,
        description: data.metadata?.description,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Firecrawl: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

export default { run };
