// ==============================================================================
// Véritas v2.4 — /lib/tools/dropbox_list_folder.js
// ==============================================================================
// Lista el contenido de una carpeta en Dropbox del usuario.
//
// Dropbox API: POST /files/list_folder con apiArg en header Dropbox-API-Arg.
// El path "" equivale a la raíz (para app folder, /Apps/Véritas/).
//
// Interfaz: export async function run(args, ctx)
//   args: { path?: string }  // default "" = raíz
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import dropbox from "../services/oauth/dropbox.js";

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const path = args.path || "";
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
      path: "/files/list_folder",
      apiArg: { path: path === "" ? "" : path, recursive: false, limit: 1000 },
    });

    await auditExternalCall(env, user_email, "dropbox", "list_folder", path || "/", resp.status, Date.now() - startTs);

    if (resp.status === 429) {
      const rlInfo = checkRateLimit(resp, 'dropbox');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('dropbox', rlInfo, 'list_folder'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "dropbox", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (resp.status === 401) {
      await markConnectionInvalid(env, user_email, "dropbox");
      return { status: "forbidden", output: "Conexión Dropbox revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (!resp.ok) {
      const errText = await resp.text();
      return { status: "error", output: `Dropbox HTTP ${resp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const data = await resp.json();
    const entries = data.entries || [];
    let output = `Carpeta Dropbox: ${path || "/"} (${entries.length} elementos)\n${"=".repeat(60)}\n`;
    for (const e of entries) {
      const icon = e[".tag"] === "folder" ? "📁" : "📄";
      output += `${icon} ${e.name} (${e[".tag"]})`;
      if (e.size) output += ` — ${formatBytes(e.size)}`;
      if (e.server_modified) output += ` — modificado ${e.server_modified}`;
      output += `\n  Path: ${e.path_display}\n`;
    }

    if (data.has_more) {
      output += `\n[... hay más elementos. Usa dropbox_search o refine el path para paginar.]`;
    }

    return {
      status: "ok",
      output,
      latency_ms: Date.now() - startTs,
      extra: { path, count: entries.length, has_more: !!data.has_more },
    };
  } catch (e) {
    return { status: "error", output: `Error Dropbox list_folder: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default { run };
