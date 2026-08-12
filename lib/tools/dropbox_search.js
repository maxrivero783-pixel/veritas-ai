// ==============================================================================
// Véritas v2.3 — /lib/tools/dropbox_search.js
// ==============================================================================
// Busca archivos en Dropbox del usuario por nombre o contenido.
//
// Dropbox API v2: POST /files/search_v2 con apiArg en header Dropbox-API-Arg.
// Permite limitar la búsqueda a una carpeta con `path`.
//
// Interfaz: export async function run(args, ctx)
//   args: { query: string, path?: string }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import dropbox from "../services/oauth/dropbox.js";

const MAX_RESULTS = 20;

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { query, path } = args;
  if (!query) return { status: "error", output: "Missing 'query' argument." };
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "dropbox");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de Dropbox. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    const apiArg = {
      query,
      match_field_options: {
        include_highlights: false,
      },
      max_results: MAX_RESULTS,
    };
    if (path) {
      apiArg.options = { path, file_status: "active", filename_only: false };
    }

    const resp = await dropbox.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: "/files/search_v2",
      apiArg,
    });

    await auditExternalCall(env, user_email, "dropbox", "search", path || "/", resp.status, Date.now() - startTs);

    if (resp.status === 429) {
      const rlInfo = checkRateLimit(resp, 'dropbox');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('dropbox', rlInfo, 'search'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "dropbox", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (resp.status === 401) {
      await markConnectionInvalid(env, user_email, "dropbox");
      return { status: "forbidden", output: "Conexión Dropbox revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (!resp.ok) {
      const errText = await resp.text();
      return { status: "error", output: `Dropbox search HTTP ${resp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const data = await resp.json();
    const matches = data.matches || [];
    let output = `Búsqueda Dropbox "${query}"${path ? ` en ${path}` : ""} — ${matches.length} resultados\n${"=".repeat(60)}\n`;

    if (matches.length === 0) {
      output += "(sin resultados)\n";
    } else {
      matches.forEach((m, i) => {
        const meta = m.metadata?.metadata || m.metadata || {};
        const tag = meta[".tag"] || "file";
        const icon = tag === "folder" ? "📁" : "📄";
        output += `${i + 1}. ${icon} ${meta.name || "(sin nombre)"}\n` +
                  `   Path: ${meta.path_display || "(?)"}\n`;
        if (meta.size) output += `   Tamaño: ${formatBytes(meta.size)}\n`;
        if (meta.server_modified) output += `   Modificado: ${meta.server_modified}\n`;
        output += `\n`;
      });
    }

    if (data.has_more) {
      output += `[... hay más resultados. Refina la query para reducir.]`;
    }

    return {
      status: "ok",
      output,
      latency_ms: Date.now() - startTs,
      extra: { query, count: matches.length, has_more: !!data.has_more },
    };
  } catch (e) {
    return { status: "error", output: `Error Dropbox search: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default { run };
