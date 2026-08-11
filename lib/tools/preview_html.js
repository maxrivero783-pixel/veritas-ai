// ==============================================================================
// Véritas v2.4 — /lib/tools/preview_html.js
// ==============================================================================
// Carga HTML en el Live Preview del Sandbox. Útil para el Agente cuando quiere
// mostrar algo rápido sin archivos separados.
//
// Esta tool se ejecuta PRINCIPALMENTE en el frontend (el iframe del Sandbox
// está en el cliente, no en el Worker). El Worker solo actúa como passthrough:
// persiste el HTML en R2 (Carpeta Proyecto, prefijo sandbox/preview/) y
// devuelve un output que el frontend detecta para cargar en el iframe.
//
// El protocolo: el frontend detecta en el output el marcador
//   [[VERITAS_PREVIEW_HTML:<r2_key>]]
// y hace fetch al endpoint /api/storage/download/<filename> para cargar el HTML.
//
// Interfaz: export async function run(args, ctx)
//   args: { html: string }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

export async function run(args, ctx) {
  const { env, user_email, chat_id } = ctx;
  const { html } = args;
  if (!html || typeof html !== "string") {
    return { status: "error", output: "Missing or invalid 'html' argument." };
  }

  const startTs = Date.now();
  const timestamp = Date.now();
  const filename = `sandbox_preview_${timestamp}.html`;
  const r2Key = `projects/${user_email}/${filename}`;

  // Inyectar CSP del sandbox (Sección 12.3 del BUILD) si no la tiene.
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data:; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://esm.sh; style-src 'unsafe-inline' https:; img-src https: data:; connect-src https:;">`;
  let finalHtml = html;
  if (!/Content-Security-Policy/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      finalHtml = html.replace(/<head([^>]*)>/i, `<head$1>\n  ${csp}`);
    } else if (/<html[^>]*>/i.test(html)) {
      finalHtml = html.replace(/<html([^>]*)>/i, `<html$1><head>${csp}</head>`);
    } else {
      // HTML fragment — envolver.
      finalHtml = `<!DOCTYPE html><html><head>${csp}</head><body>${html}</body></html>`;
    }
  }

  await env.BUCKET.put(r2Key, new TextEncoder().encode(finalHtml), {
    customMetadata: {
      user_email,
      chat_id: chat_id || "",
      type: "sandbox_preview",
      created: new Date().toISOString(),
    },
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });

  return {
    status: "ok",
    output: `HTML cargado en el Live Preview del Sandbox (${finalHtml.length} bytes).\n\n[[VERITAS_PREVIEW_HTML:${filename}]]`,
    latency_ms: Date.now() - startTs,
    extra: { filename, r2_key: r2Key, size: finalHtml.length },
  };
}

export default { run };
