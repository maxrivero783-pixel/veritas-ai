// ==============================================================================
// Véritas v2.2 — /lib/tools/rover_scrape.js
// ==============================================================================
// Handler para Rover (rtrvr.ai) — scraper cloud MCP-native.
// Dos modos:
//   scrape → cloud_scrape: extracción instantánea de URL a Markdown (barato).
//   agent  → cloud_agent:  agente web multi-paso con prompt NL (más costoso).
//
// Interfaz: export async function run(args, ctx)
//   args: { mode: "scrape"|"agent", url, prompt?, max_steps? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import rover from "../services/rover.js";

const MAX_OUTPUT_BYTES = 50_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const { mode = "scrape", url, prompt, max_steps = 3 } = args;

  if (mode !== "scrape" && mode !== "agent") {
    return { status: "error", output: "Mode debe ser 'scrape' o 'agent'." };
  }
  if (mode === "scrape" && !url) {
    return { status: "error", output: "Missing 'url' argument para modo scrape." };
  }
  if (mode === "agent" && !prompt) {
    return { status: "error", output: "Missing 'prompt' argument para modo agent." };
  }

  if (discoverKeys(env, "rover").length === 0) {
    return {
      status: "error",
      output: "Rover no está configurado. Configura ROVER_API_KEY_1 con: wrangler secret put ROVER_API_KEY_1",
    };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, "rover");

    // Construir payload según modo.
    const payload = {};
    if (mode === "scrape") {
      payload.url = url;
      if (prompt) payload.prompt = prompt;
    } else {
      if (url) payload.url = url;
      payload.prompt = prompt;
      payload.max_steps = Math.min(max_steps, 10);
    }

    const r = await rover.callService({
      endpoint: mode === "scrape" ? "scrape" : "agent",
      payload,
      apiKey: key,
    });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, "rover", index, 30_000, `Rover HTTP ${r.status}: ${r.error || ""}`);
      return {
        status: "error",
        output: `Rover ${mode} falló: HTTP ${r.status}. ${r.error || (r.raw ? r.raw.slice(0, 500) : "")}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // Extraer contenido del response JSON-RPC 2.0.
    let content = "";
    if (r.data) {
      // JSON-RPC: el resultado está en data.result.content[0].text
      if (r.data.result) {
        const mc = r.data.result.content;
        if (Array.isArray(mc)) {
          content = mc.map((c) => c.text || JSON.stringify(c)).join("\n");
        } else if (typeof mc === "string") {
          content = mc;
        } else if (mc && mc.text) {
          content = mc.text;
        } else {
          content = JSON.stringify(r.data.result, null, 2);
        }
      } else {
        content = JSON.stringify(r.data, null, 2);
      }
    } else if (r.raw) {
      content = r.raw;
    }

    let truncated = false;
    if (content.length > MAX_OUTPUT_BYTES) {
      content = content.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    const label = mode === "scrape" ? `scrape de ${url}` : `agent: ${prompt.slice(0, 80)}`;
    let header = `Rover ${label} — ${Date.now() - startTs}ms\n` +
                  `Mode: ${mode}\n${"=".repeat(60)}\n`;
    if (mode === "agent" && url) {
      header += `URL: ${url}\n`;
    }
    header += "\n";

    return {
      status: "ok",
      output: header + content + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        mode,
        url: url || null,
        size: content.length,
        truncated,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Rover: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

export default { run };
