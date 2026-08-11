// ==============================================================================
// Véritas v2.3 — /lib/tools/dropbox_upload_large.js
// ==============================================================================
// Sube archivos grandes a Dropbox (>5MB) usando upload_session.
//
// Dropbox limita el upload simple a ~150MB, pero en la práctica el contenido
// string del Worker está limitado por la memoria. Esta tool usa el flujo
// upload_session para archivos de 5MB a 150MB con chunks de 8MB.
//
// Flujo:
//   1. upload_session/start   → session_id
//   2. upload_session/append_v2 → N chunks (contenido no binario, no necesita close)
//   3. upload_session/finish   → commit con path/mode
//
// Interfaz: export async function run(args, ctx)
//   args: { path: string, content: string, mode?: "overwrite"|"add" }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import dropbox from "../services/oauth/dropbox.js";

const MIN_SIZE = 5_000_000;  // 5 MB — umbral para usar upload session
const MAX_SIZE = 150_000_000; // 150 MB — límite duro de Dropbox
const CHUNK_SIZE = 8_000_000; // 8 MB por chunk (recomendado por Dropbox)

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { path, content, mode = "overwrite" } = args;
  if (!path || content === undefined) {
    return { status: "error", output: "Missing required args: path, content." };
  }
  if (!path.startsWith("/")) {
    return { status: "error", output: `Path debe empezar con "/". Recibido: ${path}` };
  }
  const contentLength = typeof content === "string" ? new TextEncoder().encode(content).length : content.byteLength;
  if (contentLength < MIN_SIZE) {
    return {
      status: "error",
      output: `Contenido demasiado pequeño para upload_large (${formatBytes(contentLength)}). Usa dropbox_write_file para archivos <5MB.`,
    };
  }
  if (contentLength > MAX_SIZE) {
    return {
      status: "error",
      output: `Contenido excede el límite de 150MB (${formatBytes(contentLength)}). No se puede subir este archivo via Dropbox API.`,
    };
  }

  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "dropbox");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de Dropbox. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const totalChunks = Math.ceil(bytes.length / CHUNK_SIZE);

    // 1. upload_session/start
    const startResp = await dropbox.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: "/files/upload_session/start",
      apiArg: {},
    });

    if (startResp.status === 429) {
      const rlInfo = checkRateLimit(startResp, 'dropbox');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('dropbox', rlInfo, 'upload_large_start'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "dropbox", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (startResp.status === 401) {
      await markConnectionInvalid(env, user_email, "dropbox");
      return { status: "forbidden", output: "Conexión Dropbox revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (!startResp.ok) {
      const errText = await startResp.text();
      return { status: "error", output: `Dropbox session start HTTP ${startResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const startData = await startResp.json();
    const sessionId = startData.session_id;

    // 2. upload_session/append_v2 — uno o más chunks
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * CHUNK_SIZE;
      const end = Math.min(offset + CHUNK_SIZE, bytes.length);
      const chunk = bytes.slice(offset, end);
      const isLast = i === totalChunks - 1;

      // Si es el último chunk, usamos finish directamente en vez de append
      if (isLast) {
        break; // el último chunk va en finish
      }

      const appendResp = await dropbox.apiCall({
        accessToken: conn.accessToken,
        method: "POST",
        path: "/files/upload_session/append_v2",
        apiArg: {
          cursor: { session_id: sessionId, offset },
          close: false,
        },
        body: chunk,
      });

      if (appendResp.status === 429) {
        const rlInfo = checkRateLimit(appendResp, 'dropbox');
        if (rlInfo.rateLimited) {
          return { status: "rate_limited", output: rateLimitErrorMessage('dropbox', rlInfo, 'upload_large_append'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "dropbox", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
        }
      }
      if (!appendResp.ok) {
        const errText = await appendResp.text();
        return {
          status: "error",
          output: `Dropbox session append fallo en chunk ${i + 1}/${totalChunks}: HTTP ${appendResp.status}: ${errText.slice(0, 500)}`,
          latency_ms: Date.now() - startTs,
        };
      }
    }

    // 3. upload_session/finish — último chunk + commit
    const lastOffset = (totalChunks - 1) * CHUNK_SIZE;
    const lastChunk = bytes.slice(lastOffset);

    // Para finish, el body va en el content endpoint y el commit en apiArg
    const finishResp = await dropbox.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: "/files/upload_session/finish",
      apiArg: {
        cursor: { session_id: sessionId, offset: lastOffset },
        commit: {
          path,
          mode,
          autorename: false,
          mute: true,
        },
      },
      body: lastChunk,
    });

    await auditExternalCall(env, user_email, "dropbox", "upload_large", path, finishResp.status, Date.now() - startTs);

    if (finishResp.status === 429) {
      const rlInfo = checkRateLimit(finishResp, 'dropbox');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('dropbox', rlInfo, 'upload_large_finish'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "dropbox", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (finishResp.status === 401) {
      await markConnectionInvalid(env, user_email, "dropbox");
      return { status: "forbidden", output: "Conexión Dropbox revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (!finishResp.ok) {
      const errText = await finishResp.text();
      return { status: "error", output: `Dropbox session finish HTTP ${finishResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const meta = await finishResp.json();
    return {
      status: "ok",
      output:
        `Archivo grande subido a Dropbox — ${Date.now() - startTs}ms\n` +
        `Path: ${meta.path_display}\n` +
        `Tamaño: ${meta.size} bytes (${formatBytes(meta.size)})\n` +
        `Chunks: ${totalChunks} x ${formatBytes(CHUNK_SIZE)}\n` +
        `ID: ${meta.id}\n` +
        `Modificado: ${meta.server_modified}`,
      latency_ms: Date.now() - startTs,
      extra: {
        path: meta.path_display,
        size: meta.size,
        id: meta.id,
        server_modified: meta.server_modified,
        chunks: totalChunks,
      },
    };
  } catch (e) {
    return { status: "error", output: `Error Dropbox upload_large: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default { run };
