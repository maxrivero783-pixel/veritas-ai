import { fetchT } from '../services/http.js';
// ==============================================================================
// Véritas v2.12 — /lib/tools/analyze_media.js
// ==============================================================================
// Tool de percepción multimodal. Llama al endpoint /api/chat/perceive
// internamente, que selecciona el modelo Nano adecuado (VL para imagen/PDF,
// Omni para audio/video) y devuelve la descripción textual.
//
// Esta tool es el puente entre el protocolo XML embebido del modelo ejecutor
// y el endpoint de percepción implementado en ETAPA 2.
//
// Interfaz: export async function run(args, ctx)
//   args: { target: string (URL o R2 key), modality: "image"|"pdf"|"audio"|"video" }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { target, modality } = args;

  if (!target) {
    return { status: "error", output: "Missing 'target' argument. Provide a URL or R2 key." };
  }
  if (!modality || !["image", "pdf", "audio", "video"].includes(modality)) {
    return { status: "error", output: "Invalid 'modality'. Must be one of: image, pdf, audio, video." };
  }

  const startTs = Date.now();

  try {
    // Determinar si el target es una URL o una R2 key.
    const isUrl = /^https?:\/\//i.test(target);
    const body = {};
    if (isUrl) {
      body.attachment_url = target;
    } else {
      body.attachment_r2_key = target;
    }
    body.modality = modality;

    // Construir URL interna del endpoint.
    // En Cloudflare Workers, usamos env.PAGES_URL o fallback.
    const baseUrl = env.PAGES_URL || "https://veritas.pages.dev";
    const perceiveUrl = `${baseUrl}/api/chat/perceive`;

    // Hacer fetch interno. El header cf-access-user-email debe pasarse
    // para que el endpoint pueda autenticar. En Workers, las llamadas
    // internas no pasan por Cloudflare Access, así que inyectamos el email.
    const resp = await fetchT(perceiveUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-access-user-email": user_email,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      return {
        status: "error",
        output: `Percepción fallida (${resp.status}): ${errData.error || "unknown"}. ${errData.message || ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const data = await resp.json();
    const { description, model, role: nanoRole, modality: respModality, tokens_in, tokens_out } = data;

    // Formatear salida para el modelo ejecutor.
    const output = [
      `[Percepción multimodal — modelo: ${model} (${nanoRole}), modalidad: ${respModality}]`,
      `Tokens: ${tokens_in} in / ${tokens_out} out`,
      "",
      description,
    ].join("\n");

    return {
      status: "ok",
      output,
      latency_ms: Date.now() - startTs,
      extra: {
        model,
        role: nanoRole,
        modality: respModality,
        tokens_in,
        tokens_out,
        target_type: isUrl ? "url" : "r2_key",
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error al invocar percepción: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

export default { run };
