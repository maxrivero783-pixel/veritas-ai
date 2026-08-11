// ==============================================================================
// Véritas v2.3 — /lib/tools/github_write_file.js
// ==============================================================================
// Crea o actualiza un archivo en un repo GitHub del usuario. Crea commit con
// el mensaje dado.
//
// Usa PUT /repos/:owner/:repo/contents/:path con el contenido en base64.
// Si el archivo ya existe, requiere el SHA actual (lo obtenemos automáticamente).
//
// Interfaz: export async function run(args, ctx)
//   args: { owner, repo, path, content, message, branch? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import github from "../services/oauth/github.js";

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { owner, repo, path, content, message, branch } = args;
  if (!owner || !repo || !path || content === undefined || !message) {
    return { status: "error", output: "Missing required args: owner, repo, path, content, message." };
  }
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "github");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de GitHub. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    // 1. Obtener SHA actual (si el archivo existe).
    const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const existingResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}${query}`,
    });
    let sha = null;
    if (existingResp.status === 200) {
      const existing = await existingResp.json();
      sha = existing.sha;
    } else if (existingResp.status !== 404) {
      // Error inesperado al leer; continuar sin SHA (creará archivo nuevo).
    }

    // 2. PUT con contenido base64.
    const contentB64 = bytesToBase64(new TextEncoder().encode(content));
    const body = {
      message,
      content: contentB64,
    };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;

    const putResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "PUT",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(path)}`,
      body,
    });

    await auditExternalCall(env, user_email, "github", "write_file", `${owner}/${repo}/${path}`, putResp.status, Date.now() - startTs);

    if (putResp.status === 429 || putResp.status === 403) {
      const rlInfo = checkRateLimit(putResp, 'github');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('github', rlInfo, 'write_file'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "github", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (putResp.status === 401) {
      await markConnectionInvalid(env, user_email, "github");
      return { status: "forbidden", output: "Conexión GitHub revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (!putResp.ok) {
      const errText = await putResp.text();
      return { status: "error", output: `GitHub write HTTP ${putResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const result = await putResp.json();
    const commitSha = result.commit?.sha;
    const fileSha = result.content?.sha;
    const htmlUrl = result.content?.html_url;

    return {
      status: "ok",
      output:
        `Archivo ${sha ? "actualizado" : "creado"} en ${owner}/${repo}/${path}${branch ? ` @ ${branch}` : ""}\n` +
        `Commit SHA: ${commitSha}\n` +
        `File SHA: ${fileSha}\n` +
        `URL: ${htmlUrl}\n` +
        `Mensaje: "${message}"`,
      latency_ms: Date.now() - startTs,
      extra: { commit_sha: commitSha, file_sha: fileSha, html_url: htmlUrl, owner, repo, path, branch, created: !sha },
    };
  } catch (e) {
    return { status: "error", output: `Error GitHub write_file: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export default { run };
