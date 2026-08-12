// ==============================================================================
// Véritas v2.3 — /lib/tools/dropbox_read_file.js
// ==============================================================================
// Lee un archivo de Dropbox del usuario. Extrae texto (mismo extractor que el
// repositorio: PDF, HTML, MD, código, etc.).
//
// Dropbox API: POST /files/download (content.dropboxapi.com), con apiArg en
// header Dropbox-API-Arg especificando path.
//
// Interfaz: export async function run(args, ctx)
//   args: { path: string }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import dropbox from "../services/oauth/dropbox.js";

const MAX_OUTPUT_BYTES = 50_000;

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { path } = args;
  if (!path) return { status: "error", output: "Missing 'path' argument." };
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "dropbox");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de Dropbox. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    const resp = await dropbox.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: "/files/download",
      apiArg: { path },
    });

    await auditExternalCall(env, user_email, "dropbox", "read_file", path, resp.status, Date.now() - startTs);

    if (resp.status === 429) {
      const rlInfo = checkRateLimit(resp, 'dropbox');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('dropbox', rlInfo, 'read_file'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "dropbox", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (resp.status === 401) {
      await markConnectionInvalid(env, user_email, "dropbox");
      return { status: "forbidden", output: "Conexión Dropbox revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (resp.status === 409) {
      const errText = await resp.text();
      return { status: "ok", output: `Archivo no encontrado en Dropbox: ${path}. Detalle: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }
    if (!resp.ok) {
      const errText = await resp.text();
      return { status: "error", output: `Dropbox HTTP ${resp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const buf = await resp.arrayBuffer();
    // Metadatos vienen en header Dropbox-API-Result.
    const metaHeader = resp.headers.get("Dropbox-API-Result") || "{}";
    let meta = {};
    try { meta = JSON.parse(metaHeader); } catch {}

    const filename = meta.name || path.split("/").pop() || "file";
    const ext = filename.split(".").pop().toLowerCase();
    const text = extractText(buf, ext);

    let truncated = false;
    let finalContent = text;
    if (text.length > MAX_OUTPUT_BYTES) {
      finalContent = text.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    const header = `Archivo Dropbox: ${path}\n` +
                   `Nombre: ${filename} | Tamaño: ${formatBytes(buf.byteLength)}` +
                   `${meta.server_modified ? ` | Modificado: ${meta.server_modified}` : ""}\n` +
                   `${"=".repeat(60)}\n`;

    return {
      status: "ok",
      output: header + finalContent + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes; archivo completo: ${text.length} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: { path, filename, size: buf.byteLength, mime: meta.content_type, truncated },
    };
  } catch (e) {
    return { status: "error", output: `Error Dropbox read_file: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

// ------------------------------------------------------------------------------
// extractText: mismo extractor que search_repository (sin dependencias externas).
// ------------------------------------------------------------------------------
function extractText(buf, ext) {
  const text = new TextDecoder("utf-8").decode(buf);

  if (ext === "html" || ext === "htm") {
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (ext === "pdf") {
    const matches = text.match(/\(([^()\\]{1,})\)\s*Tj|\[(.*?)\]\s*TJ/g) || [];
    const extracted = matches
      .map((m) => m.replace(/\(|\)|Tj|TJ|\[|\]/g, "").replace(/<[^>]+>/g, ""))
      .join(" ")
      .trim();
    if (extracted.length > 50) return `[PDF — extracción parcial]\n${extracted.slice(0, 50000)}`;
    return `[PDF — extracción limitada en Worker. Raw parcial:]\n${text.replace(/[^\x20-\x7E\n\r\t]+/g, " ").slice(0, 20000)}`;
  }
  return text;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default { run };
