// ==============================================================================
// Véritas v2.4 — /lib/tools/dropbox_write_file.js
// ==============================================================================
// Crea o sobrescribe un archivo en Dropbox del usuario.
//
// Dropbox API: POST /files/upload (content.dropboxapi.com), con body binario
// y apiArg en header Dropbox-API-Arg especificando path + mode=overwrite.
//
// Interfaz: export async function run(args, ctx)
//   args: { path: string, content: string }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import dropbox from "../services/oauth/dropbox.js";

const MAX_CONTENT_BYTES = 5_000_000; // 5 MB límite de Dropbox para upload simple

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { path, content } = args;
  if (!path || content === undefined) {
    return { status: "error", output: "Missing required args: path, content." };
  }
  if (content.length > MAX_CONTENT_BYTES) {
    return { status: "error", output: `Contenido demasiado grande: ${content.length} bytes (máx ${MAX_CONTENT_BYTES}). Usa upload session para archivos mayores.` };
  }
  if (!path.startsWith("/")) {
    return { status: "error", output: `Path debe empezar con "/". Recibido: ${path}` };
  }

  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "dropbox");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de Dropbox. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    // Convertir string a bytes.
    const bytes = new TextEncoder().encode(content);

    const resp = await dropbox.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: "/files/upload",
      apiArg: {
        path,
        mode: "overwrite", // sobrescribe si existe
        autorename: false,
        mute: true, // no disparar notificaciones de Dropbox
      },
      body: bytes,
    });

    await auditExternalCall(env, user_email, "dropbox", "write_file", path, resp.status, Date.now() - startTs);

    if (resp.status === 429) {
      const rlInfo = checkRateLimit(resp, 'dropbox');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('dropbox', rlInfo, 'write_file'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "dropbox", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (resp.status === 401) {
      await markConnectionInvalid(env, user_email, "dropbox");
      return { status: "forbidden", output: "Conexión Dropbox revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (!resp.ok) {
      const errText = await resp.text();
      return { status: "error", output: `Dropbox upload HTTP ${resp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const meta = await resp.json();
    return {
      status: "ok",
      output:
        `Archivo subido a Dropbox — ${Date.now() - startTs}ms\n` +
        `Path: ${meta.path_display}\n` +
        `Tamaño: ${meta.size} bytes\n` +
        `ID: ${meta.id}\n` +
        `Modificado: ${meta.server_modified}`,
      latency_ms: Date.now() - startTs,
      extra: {
        path: meta.path_display,
        size: meta.size,
        id: meta.id,
        server_modified: meta.server_modified,
      },
    };
  } catch (e) {
    return { status: "error", output: `Error Dropbox write_file: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
