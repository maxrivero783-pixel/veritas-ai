// ==============================================================================
// Véritas v2.2 — /lib/tools/steel_session.js
// ==============================================================================
// Crea/release/scrape sesiones de navegador persistente en Steel.dev.
//
// Acciones:
//   create   → POST /v1/sessions          → devuelve session_id + ws_endpoint
//   release  → DELETE /v1/sessions/:id     → libera la sesión
//   scrape   → POST /v1/scrape             → scrape usando una sesión existente
//
// Interfaz: export async function run(args, ctx)
//   args: { action, session_id?, url? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import steel from "../services/steel.js";

const MAX_OUTPUT_BYTES = 50_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const { action, session_id, url } = args;
  if (!action) return { status: "error", output: "Missing 'action' argument." };

  if (discoverKeys(env, "steel").length === 0) {
    return {
      status: "error",
      output: "Steel.dev no está configurado. Configura STEEL_API_KEY_1 con: wrangler secret put STEEL_API_KEY_1",
    };
  }

  const startTs = Date.now();

  // Obtener clave saludable del pool.
  let apiKey, keyIndex;
  try {
    const k = await getKey(env, "steel");
    apiKey = k.key;
    keyIndex = k.index;
  } catch (e) {
    return {
      status: "error",
      output: `No hay claves saludables en el pool de steel: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }

  try {
    let result;
    switch (action) {
      case "create":
        result = await doCreate(env, apiKey, startTs);
        break;
      case "release":
        if (!session_id) return { status: "error", output: "Missing 'session_id' for action=release." };
        result = await doRelease(apiKey, session_id, startTs);
        break;
      case "scrape":
        if (!url) return { status: "error", output: "Missing 'url' for action=scrape." };
        result = await doScrape(env, apiKey, session_id, url, startTs);
        break;
      default:
        return { status: "error", output: `Unknown action: ${action}. Use create|release|scrape.` };
    }
    // Si el resultado indica error HTTP, marcar cooldown según status.
    if (result.extra && result.extra.http_status) {
      const st = result.extra.http_status;
      if (st === 401 || st === 403) await markCooldown(env, "steel", keyIndex, 3600_000, `HTTP ${st} auth`);
      else if (st === 429 || st === 503) await markCooldown(env, "steel", keyIndex, 30_000, `HTTP ${st}`);
    }
    return result;
  } catch (e) {
    return {
      status: "error",
      output: `Error Steel action=${action}: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

async function doCreate(env, apiKey, startTs) {
  const r = await steel.callService({
    endpoint: "create_session",
    payload: { sessionTimeout: 300000, solveCaptcha: false },
    apiKey,
  });

  if (r.status !== 200 && r.status !== 201 || !r.data) {
    return {
      status: "error",
      output: `Steel create_session falló: HTTP ${r.status}. ${r.raw?.slice(0, 500) || ""}`,
      latency_ms: Date.now() - startTs,
    };
  }

  const session = r.data;
  return {
    status: "ok",
    output:
      `Sesión Steel creada — ${Date.now() - startTs}ms\n` +
      `Session ID: ${session.id}\n` +
      `Status: ${session.status}\n` +
      `WebSocket endpoint: ${session.wsEndpoint || "(no expuesto)"}\n` +
      `CDP URL: ${session.cdpUrl || "(no expuesto)"}\n\n` +
      `Para scrape, invoca steel_session con action="scrape" y session_id="${session.id}".\n` +
      `Importante: libera la sesión con action="release" cuando termines para no consumir cuota.`,
    latency_ms: Date.now() - startTs,
    extra: { session_id: session.id, ws_endpoint: session.wsEndpoint, cdp_url: session.cdpUrl },
  };
}

async function doRelease(apiKey, sessionId, startTs) {
  const r = await steel.callService({
    endpoint: "release_session",
    payload: { session_id: sessionId },
    apiKey,
  });

  if (r.status === 204 || (r.status >= 200 && r.status < 300)) {
    return {
      status: "ok",
      output: `Sesión Steel ${sessionId} liberada — ${Date.now() - startTs}ms`,
      latency_ms: Date.now() - startTs,
      extra: { session_id: sessionId, released: true },
    };
  }
  return {
    status: "error",
    output: `Steel release_session falló: HTTP ${r.status}. ${r.raw?.slice(0, 500) || ""}`,
    latency_ms: Date.now() - startTs,
  };
}

async function doScrape(env, apiKey, sessionId, url, startTs) {
  const payload = { url, render_js: true, timeout: 30000 };
  if (sessionId) payload.session_id = sessionId;

  const r = await steel.callService({
    endpoint: "scrape",
    payload,
    apiKey,
  });

  if (r.status !== 200 || !r.data) {
    return {
      status: "error",
      output: `Steel scrape falló para ${url}: HTTP ${r.status}. ${r.raw?.slice(0, 500) || ""}`,
      latency_ms: Date.now() - startTs,
    };
  }

  const data = r.data;
  let content = data.content || "";
  let truncated = false;
  if (content.length > MAX_OUTPUT_BYTES) {
    content = content.slice(0, MAX_OUTPUT_BYTES);
    truncated = true;
  }

  const output =
    `Steel scrape de ${url} — ${Date.now() - startTs}ms\n` +
    `Session: ${sessionId || "(nueva, efímera)"} | HTTP: ${data.statusCode || "?"}\n` +
    `Título: ${data.title || "(sin título)"}\n${"=".repeat(60)}\n${content}` +
    (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : "");

  return {
    status: "ok",
    output,
    latency_ms: Date.now() - startTs,
    extra: {
      url,
      session_id: sessionId,
      title: data.title,
      http_status: data.statusCode,
      size: (data.content || "").length,
      truncated,
    },
  };
}

export default { run };
