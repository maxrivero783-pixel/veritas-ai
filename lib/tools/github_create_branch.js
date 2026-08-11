// ==============================================================================
// Véritas v2.4 — /lib/tools/github_create_branch.js
// ==============================================================================
// Crea una nueva rama en un repo GitHub, basada en otra existente (default:
// la branch por defecto del repo).
//
// Interfaz: export async function run(args, ctx)
//   args: { owner, repo, branch_name, from_branch? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import github from "../services/oauth/github.js";

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { owner, repo, branch_name, from_branch } = args;
  if (!owner || !repo || !branch_name) {
    return { status: "error", output: "Missing required args: owner, repo, branch_name." };
  }
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "github");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de GitHub. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    // 1. Resolver la branch origen (default: default_branch del repo).
    let sourceBranch = from_branch;
    if (!sourceBranch) {
      const repoResp = await github.apiCall({
        accessToken: conn.accessToken,
        method: "GET",
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      });
      if (!repoResp.ok) {
        const errText = await repoResp.text();
        return { status: "error", output: `GitHub repo HTTP ${repoResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
      }
      const repoData = await repoResp.json();
      sourceBranch = repoData.default_branch;
    }

    // 2. Obtener el SHA del HEAD de la branch origen.
    const refResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(sourceBranch)}`,
    });
    if (refResp.status === 404) {
      return { status: "error", output: `Branch origen "${sourceBranch}" no existe en ${owner}/${repo}.`, latency_ms: Date.now() - startTs };
    }
    if (!refResp.ok) {
      return { status: "error", output: `GitHub ref HTTP ${refResp.status}`, latency_ms: Date.now() - startTs };
    }
    const refData = await refResp.json();
    const sourceSha = refData.object.sha;

    // 3. Crear el nuevo ref.
    const createResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
      body: { ref: `refs/heads/${branch_name}`, sha: sourceSha },
    });

    await auditExternalCall(env, user_email, "github", "create_branch", `${owner}/${repo}@${branch_name}`, createResp.status, Date.now() - startTs);

    if (createResp.status === 429 || createResp.status === 403) {
      const rlInfo = checkRateLimit(createResp, 'github');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('github', rlInfo, 'create_branch'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "github", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (createResp.status === 401) {
      await markConnectionInvalid(env, user_email, "github");
      return { status: "forbidden", output: "Conexión GitHub revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (createResp.status === 422) {
      const errText = await createResp.text();
      return { status: "error", output: `Branch "${branch_name}" ya existe o el SHA es inválido: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }
    if (!createResp.ok) {
      const errText = await createResp.text();
      return { status: "error", output: `GitHub create ref HTTP ${createResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    return {
      status: "ok",
      output:
        `Branch creada: ${branch_name} en ${owner}/${repo} (basada en ${sourceBranch})\n` +
        `Commit inicial SHA: ${sourceSha}`,
      latency_ms: Date.now() - startTs,
      extra: { branch_name, from_branch: sourceBranch, source_sha: sourceSha, owner, repo },
    };
  } catch (e) {
    return { status: "error", output: `Error GitHub create_branch: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
