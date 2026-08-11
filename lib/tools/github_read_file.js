// ==============================================================================
// Véritas v2.4 — /lib/tools/github_read_file.js
// ==============================================================================
// Lee un archivo de un repo GitHub del usuario. Devuelve contenido decodificado.
//
// Interfaz: export async function run(args, ctx)
//   args: { owner, repo, path, branch? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import github from "../services/oauth/github.js";

const MAX_OUTPUT_BYTES = 50_000;

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { owner, repo, path, branch } = args;
  if (!owner || !repo || !path) {
    return { status: "error", output: "Missing required args: owner, repo, path." };
  }
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "github");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de GitHub. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    // GET /repos/:owner/:repo/contents/:path?ref=:branch
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const resp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}${query}`,
    });

    await auditExternalCall(env, user_email, "github", "read_file", `${owner}/${repo}/${path}`, resp.status, Date.now() - startTs);

    if (resp.status === 429 || resp.status === 403) {
      const rlInfo = checkRateLimit(resp, 'github');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('github', rlInfo, 'read_file'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "github", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (resp.status === 401) {
      await markConnectionInvalid(env, user_email, "github");
      return { status: "forbidden", output: "Conexión GitHub revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (resp.status === 404) {
      return { status: "ok", output: `Archivo no encontrado: ${owner}/${repo}/${path}${branch ? ` (branch ${branch})` : ""}`, latency_ms: Date.now() - startTs };
    }
    if (!resp.ok) {
      const errText = await resp.text();
      return { status: "error", output: `GitHub HTTP ${resp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const data = await resp.json();
    // GitHub devuelve { content (base64), encoding, name, path, size, type, sha, ... }
    if (data.type === "dir") {
      const items = (data.entries || []).map((e) => `  ${e.type === "dir" ? "📁" : "📄"} ${e.name}`).join("\n");
      // Si no trae entries (caso común), hacer otra llamada para listar.
      let listing = items;
      if (!data.entries) {
        const listResp = await github.apiCall({
          accessToken: conn.accessToken,
          method: "GET",
          path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}${query}`,
        });
        if (listResp.ok) {
          const arr = await listResp.json();
          listing = arr.map((e) => `  ${e.type === "dir" ? "📁" : "📄"} ${e.name} (${e.size} bytes)`).join("\n");
        }
      }
      return {
        status: "ok",
        output: `Directorio: ${owner}/${repo}/${path}${branch ? ` @ ${branch}` : ""}\n${listing}`,
        latency_ms: Date.now() - startTs,
        extra: { type: "dir", path },
      };
    }

    // Archivo: decodificar base64.
    if (data.encoding === "base64" && data.content) {
      // GitHub devuelve base64 con saltos de línea; limpiar.
      const cleanB64 = data.content.replace(/\s/g, "");
      const bytes = base64ToBytes(cleanB64);
      const content = new TextDecoder("utf-8").decode(bytes);

      let truncated = false;
      let finalContent = content;
      if (content.length > MAX_OUTPUT_BYTES) {
        finalContent = content.slice(0, MAX_OUTPUT_BYTES);
        truncated = true;
      }

      const header = `Archivo: ${owner}/${repo}/${path}${branch ? ` @ ${branch}` : ""}\n` +
                     `Tamaño: ${data.size} bytes | SHA: ${data.sha}\n${"=".repeat(60)}\n`;
      return {
        status: "ok",
        output: header + finalContent + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes; archivo completo: ${content.length} bytes]` : ""),
        latency_ms: Date.now() - startTs,
        extra: { type: "file", path, size: data.size, sha: data.sha, truncated },
      };
    }

    return {
      status: "ok",
      output: `Archivo sin contenido decodificable: ${JSON.stringify(data).slice(0, 1000)}`,
      latency_ms: Date.now() - startTs,
    };
  } catch (e) {
    return { status: "error", output: `Error GitHub read_file: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

function base64ToBytes(b64) {
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(normalized);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export default { run };
