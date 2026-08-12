// ==============================================================================
// Véritas v2.2 — /lib/tools/browserless_execute.js
// ==============================================================================
// Handler para Browserless — clúster headless Chromium remoto.
// Cuatro modos:
//   evaluate  → ejecuta código JS arbitrario en una página y devuelve el resultado.
//   screenshot→ captura screenshot de una URL (devuelve base64 en extra).
//   pdf       → genera PDF de una URL (devuelve base64 en extra).
//   content   → extrae el HTML completo de una página.
//
// Interfaz: export async function run(args, ctx)
//   args: { mode, url, code?, full_page? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import browserless from "../services/browserless.js";

const MAX_OUTPUT_BYTES = 50_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    mode = "evaluate",
    url,
    code,
    full_page = false,
  } = args;

  const validModes = ["evaluate", "screenshot", "pdf", "content"];
  if (!validModes.includes(mode)) {
    return { status: "error", output: `Mode debe ser uno de: ${validModes.join(", ")}` };
  }
  if (!url) {
    return { status: "error", output: "Missing 'url' argument." };
  }
  if (mode === "evaluate" && !code) {
    return { status: "error", output: "Missing 'code' argument para modo evaluate." };
  }

  if (discoverKeys(env, "browserless").length === 0) {
    return {
      status: "error",
      output: "Browserless no está configurado. Configura BROWSERLESS_API_KEY_1 con: wrangler secret put BROWSERLESS_API_KEY_1",
    };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, "browserless");

    const r = await browserless.callService({
      endpoint: mode,
      payload: { url, code, full_page },
      apiKey: key,
    });

    if (r.status >= 400) {
      await markCooldown(env, "browserless", index, 60_000, `Browserless HTTP ${r.status}`);
      const errSnippet = typeof r.raw === "string" ? r.raw.slice(0, 500) : JSON.stringify(r.data || "");
      return {
        status: "error",
        output: `Browserless ${mode} falló para ${url}: HTTP ${r.status}. ${errSnippet}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // Para screenshot y pdf, devolver referencia al binario en extra.
    if ((mode === "screenshot" || mode === "pdf") && r.data && r.data.image_base64) {
      return {
        status: "ok",
        output: `Browserless ${mode} de ${url} — ${Date.now() - startTs}ms
` +
                `${"=".repeat(60)}\n` +
                `[${mode === "screenshot" ? "Imagen" : "PDF"} generado — base64 en extra, ${r.data.content_type || "application/pdf"}]`,
        latency_ms: Date.now() - startTs,
        extra: {
          mode,
          url,
          content_type: r.data.content_type,
          image_base64: r.data.image_base64,
        },
      };
    }

    // Para evaluate y content: el resultado es texto/JSON.
    let output = "";
    if (r.data !== null && r.data !== undefined) {
      output = typeof r.data === "string" ? r.data : JSON.stringify(r.data, null, 2);
    } else if (typeof r.raw === "string") {
      output = r.raw;
    }

    let truncated = false;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    let header = `Browserless ${mode} de ${url} — ${Date.now() - startTs}ms\n` +
                  `${"=".repeat(60)}\n\n`;

    return {
      status: "ok",
      output: header + output + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        mode,
        url,
        size: output.length,
        truncated,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Browserless: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

export default { run };
