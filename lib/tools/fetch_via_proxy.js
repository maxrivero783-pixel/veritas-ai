// ==============================================================================
// Véritas v2.2 — /lib/tools/fetch_via_proxy.js
// ==============================================================================
// Llamada HTTP a una API externa desde el iframe del Sandbox vía proxy del
// Worker. Evita problemas de CORS. Si la URL pertenece a un servicio del
// rotador (Firecrawl, Jina, etc.), el Worker inyecta la API key automáticamente.
//
// Este handler es una alternativa directa a /api/artifact/proxy para que el
// modelo pueda invocar URLs externas desde el Tool Caller embebido (sin
// necesidad de que el frontend gestione el proxy manualmente).
//
// Interfaz: export async function run(args, ctx)
//   args: { url, method?, headers?, body? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getKey, markCooldown } from "../keyRotator.js";

export async function run(args, ctx) {
  const { env } = ctx;
  const { url: targetUrl, method = "GET", headers = {}, body } = args;
  if (!targetUrl) return { status: "error", output: "Missing 'url' argument." };

  const startTs = Date.now();

  // Validar URL.
  let parsed;
  try { parsed = new URL(targetUrl); } catch {
    return { status: "error", output: `URL inválida: ${targetUrl}` };
  }
  if (parsed.protocol !== "https:") {
    return { status: "error", output: `SSRF bloqueado: solo se permiten URLs HTTPS (recibido ${parsed.protocol}).` };
  }

  // Anti-SSRF: bloquear IPs internas.
  const hostname = parsed.hostname.toLowerCase();
  const blocked = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname)
              || hostname.startsWith("10.")
              || hostname.startsWith("192.168.")
              || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
              || hostname.endsWith(".internal");
  if (blocked) {
    return { status: "error", output: `SSRF bloqueado: hostname interno no permitido (${hostname}).` };
  }

  // Detectar si la URL pertenece a un servicio del rotador.
  const serviceForHost = matchServiceByHost(hostname);
  let injectedKey = null;
  if (serviceForHost) {
    try {
      const k = await getKey(env, serviceForHost);
      injectedKey = k.key;
    } catch (e) {
      // Sin claves configuradas para ese servicio — proceder sin auth (probablemente fallará upstream).
    }
  }

  const finalHeaders = { ...headers };
  if (injectedKey) {
    if (serviceForHost === "scrapingbee") parsed.searchParams.set("api_key", injectedKey);
    else if (serviceForHost === "serper") finalHeaders["X-API-KEY"] = injectedKey;
    else if (serviceForHost === "steel") finalHeaders["steel-api-key"] = injectedKey;
    else if (serviceForHost === "tavily") {
      // Tavily espera api_key en body JSON.
      const bodyObj = body ? JSON.parse(body) : {};
      bodyObj.api_key = injectedKey;
      body = JSON.stringify(bodyObj);
    }
    else finalHeaders["Authorization"] = `Bearer ${injectedKey}`;
  }

  try {
    const resp = await fetch(parsed.toString(), {
      method,
      headers: finalHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const text = await resp.text();
    const latency = Date.now() - startTs;

    // Truncar output si es muy grande para el contexto del modelo.
    const MAX_OUTPUT = 32_000;
    let output = text;
    if (text.length > MAX_OUTPUT) {
      output = text.slice(0, MAX_OUTPUT) +
        `\n\n[... ${text.length - MAX_OUTPUT} bytes más. La respuesta completa fue persistida en R2 si necesitas recuperar parte.]`;
    }

    return {
      status: resp.status >= 200 && resp.status < 300 ? "ok" : "error",
      output: `HTTP ${resp.status} ${resp.statusText} desde ${parsed.host} (latencia ${latency}ms)\n` +
              `Content-Type: ${resp.headers.get("Content-Type") || "desconocido"}\n` +
              `${serviceForHost ? `(API key de ${serviceForHost} inyectada automáticamente)\n` : ""}` +
              `${"=".repeat(60)}\n${output}`,
      latency_ms: latency,
      extra: {
        status: resp.status,
        content_type: resp.headers.get("Content-Type"),
        latency_ms: latency,
        service: serviceForHost,
        size: text.length,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error de red al llamar ${targetUrl}: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

function matchServiceByHost(hostname) {
  if (hostname.endsWith("jina.ai") || hostname === "r.jina.ai" || hostname === "s.jina.ai") return "jina";
  if (hostname.endsWith("tavily.com") || hostname === "api.tavily.com") return "tavily";
  if (hostname.endsWith("serper.dev") || hostname === "google.serper.dev") return "serper";
  if (hostname.endsWith("scrapingbee.com") || hostname === "app.scrapingbee.com") return "scrapingbee";
  if (hostname.endsWith("firecrawl.dev") || hostname === "api.firecrawl.dev") return "firecrawl";
  if (hostname.endsWith("browser-use.com") || hostname === "api.browser-use.com") return "browser_use";
  if (hostname.endsWith("steel.dev") || hostname === "api.steel.dev") return "steel";
  if (hostname.endsWith("openrouter.ai")) return "openrouter";
  return null;
}

export default { run };
