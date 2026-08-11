// ==============================================================================
// Véritas v2.2 — /lib/tools/spider_cloud_search.js
// ==============================================================================
// Handler para Spider Cloud — crawler ultra-rápido.
// Cuatro modos:
//   search    → búsqueda web + crawling en un solo call (endpoint /search)
//   crawl     → crawling paralelo de un sitio (endpoint /crawl)
//   screenshot→ captura visual de página (endpoint /screenshot)
//   unblocker → bypass anti-bot Cloudflare/intersticiales (endpoint /unblocker)
//
// Interfaz: export async function run(args, ctx)
//   args: { mode, query?, url?, limit?, return_format? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import spiderCloud from "../services/spider_cloud.js";

const MAX_OUTPUT_BYTES = 50_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    mode = "search",
    query,
    url,
    limit = 5,
    return_format = "markdown",
    domain,
  } = args;

  const validModes = ["search", "crawl", "screenshot", "unblocker"];
  if (!validModes.includes(mode)) {
    return { status: "error", output: `Mode debe ser uno de: ${validModes.join(", ")}` };
  }
  if ((mode === "search") && !query) {
    return { status: "error", output: "Missing 'query' argument para modo search." };
  }
  if ((mode === "crawl" || mode === "screenshot" || mode === "unblocker") && !url) {
    return { status: "error", output: `Missing 'url' argument para modo ${mode}.` };
  }

  if (discoverKeys(env, "spider_cloud").length === 0) {
    return {
      status: "error",
      output: "Spider Cloud no está configurado. Configura SPIDER_CLOUD_API_KEY_1 con: wrangler secret put SPIDER_CLOUD_API_KEY_1",
    };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, "spider_cloud");

    // Construir payload según modo.
    const payload = { limit: Math.min(limit, 20) };
    if (mode === "search") {
      payload.query = query;
      payload.return_format = return_format;
      if (domain) payload.domain = domain;
    } else if (mode === "crawl") {
      payload.url = url;
      payload.return_format = return_format;
    } else if (mode === "screenshot") {
      payload.url = url;
    } else if (mode === "unblocker") {
      payload.url = url;
    }

    const r = await spiderCloud.callService({
      endpoint: mode,
      payload,
      apiKey: key,
    });

    if (r.status >= 400) {
      await markCooldown(env, "spider_cloud", index, 30_000, `Spider Cloud HTTP ${r.status}`);
      return {
        status: "error",
        output: `Spider Cloud ${mode} falló: HTTP ${r.status}. ${r.error || (r.raw ? r.raw.slice(0, 500) : "")}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // Para screenshot, el contenido es base64 — no truncar igual.
    if (mode === "screenshot" && r.data && r.data.image_base64) {
      const b64Len = r.data.image_base64.length;
      return {
        status: "ok",
        output: `Spider Cloud screenshot de ${url} — ${Date.now() - startTs}ms
` +
                `${"=".repeat(60)}\n` +
                `[Imagen capturada — ${r.data.content_type}, base64 ${b64Len} chars]`,
        latency_ms: Date.now() - startTs,
        extra: {
          mode: "screenshot",
          url,
          content_type: r.data.content_type,
          size: b64Len,
          image_base64: r.data.image_base64,
        },
      };
    }

    // Formatear resultado de search/crawl/unblocker.
    let output = "";
    if (r.data) {
      if (Array.isArray(r.data)) {
        // Array de resultados — formatear cada uno.
        const items = r.data.slice(0, 10);
        output = items.map((item, i) => {
          let block = `--- Result ${i + 1} ---\n`;
          if (item.url) block += `URL: ${item.url}\n`;
          if (item.title) block += `Title: ${item.title}\n`;
          if (item.description) block += `Description: ${item.description}\n`;
          if (item.markdown) block += `\n${item.markdown}`;
          if (item.html) block += `\n${item.html}`;
          if (item.content) block += `\n${typeof item.content === "string" ? item.content : JSON.stringify(item.content, null, 2)}`;
          return block;
        }).join("\n\n");
        if (r.data.length > 10) output += `\n\n[... ${r.data.length - 10} resultados adicionales omitidos]`;
      } else if (r.data.content) {
        output = typeof r.data.content === "string" ? r.data.content : JSON.stringify(r.data.content, null, 2);
      } else if (r.data.markdown) {
        output = r.data.markdown;
      } else if (r.data.html) {
        output = r.data.html;
      } else {
        output = JSON.stringify(r.data, null, 2);
      }
    } else if (r.raw) {
      output = r.raw;
    }

    let truncated = false;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    const target = query || url;
    let header = `Spider Cloud ${mode} de "${target.slice(0, 80)}" — ${Date.now() - startTs}ms\n` +
                  `Mode: ${mode} | Limit: ${limit} | Format: ${return_format}\n${"=".repeat(60)}\n\n`;

    return {
      status: "ok",
      output: header + output + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        mode,
        url: url || null,
        query: query || null,
        size: output.length,
        truncated,
        result_count: Array.isArray(r.data) ? r.data.length : null,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Spider Cloud: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

export default { run };
