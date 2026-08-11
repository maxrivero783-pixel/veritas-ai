// ==============================================================================
// Véritas v2.4 — /lib/tools/github_write_files.js
// ==============================================================================
// Escribe múltiples archivos en un repo GitHub en un solo commit usando la
// Trees API. Útil para "Push a GitHub" del Sandbox.
//
// Flujo:
//   1. GET /repos/:owner/:repo/git/ref/heads/:branch → obtener SHA del HEAD
//   2. POST /repos/:owner/:repo/git/trees → crear árbol con todos los blobs
//   3. POST /repos/:owner/:repo/git/commits → crear commit con el árbol
//   4. PATCH /repos/:owner/:repo/git/ref/heads/:branch → mover el ref al nuevo commit
//
// Interfaz: export async function run(args, ctx)
//   args: { owner, repo, branch, files: [{path, content}], message }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import github from "../services/oauth/github.js";

const MAX_FILES = 100;
const MAX_FILE_SIZE = 5_000_000; // 5 MB por archivo (límite de blob de GitHub)

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { owner, repo, branch, files, message } = args;
  if (!owner || !repo || !branch || !Array.isArray(files) || files.length === 0 || !message) {
    return { status: "error", output: "Missing required args: owner, repo, branch, files[], message." };
  }
  if (files.length > MAX_FILES) {
    return { status: "error", output: `Demasiados archivos: ${files.length}. Máximo ${MAX_FILES} por commit.` };
  }
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "github");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de GitHub. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    // 1. Obtener SHA del HEAD de la branch.
    const refResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
    });
    if (refResp.status === 404) {
      return { status: "error", output: `Branch "${branch}" no existe en ${owner}/${repo}. Crea primero la branch con github_create_branch.`, latency_ms: Date.now() - startTs };
    }
    if (!refResp.ok) {
      const errText = await refResp.text();
      return { status: "error", output: `GitHub ref HTTP ${refResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }
    const refData = await refResp.json();
    const headSha = refData.object.sha;

    // 2. Obtener el tree SHA del HEAD commit.
    const headCommitResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "GET",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${headSha}`,
    });
    if (!headCommitResp.ok) {
      return { status: "error", output: `No se pudo obtener el commit HEAD: HTTP ${headCommitResp.status}`, latency_ms: Date.now() - startTs };
    }
    const headCommit = await headCommitResp.json();
    const baseTreeSha = headCommit.tree.sha;

    // 3. Crear el nuevo árbol con todos los blobs.
    const treeEntries = [];
    for (const file of files) {
      if (!file.path || file.content === undefined) {
        return { status: "error", output: `Archivo inválido en la lista: falta path o content.`, latency_ms: Date.now() - startTs };
      }
      if (file.content.length > MAX_FILE_SIZE) {
        return { status: "error", output: `Archivo ${file.path} excede 5MB (${file.content.length} bytes).`, latency_ms: Date.now() - startTs };
      }
      treeEntries.push({
        path: file.path,
        mode: "100644", // regular file
        type: "blob",
        content: file.content,
      });
    }

    const treeResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
      body: { base_tree: baseTreeSha, tree: treeEntries },
    });
    if (!treeResp.ok) {
      const errText = await treeResp.text();
      return { status: "error", output: `GitHub trees HTTP ${treeResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }
    const treeData = await treeResp.json();
    const newTreeSha = treeData.sha;

    // 4. Crear el commit apuntando al árbol nuevo.
    const commitResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
      body: { message, tree: newTreeSha, parents: [headSha] },
    });
    if (!commitResp.ok) {
      const errText = await commitResp.text();
      return { status: "error", output: `GitHub commit HTTP ${commitResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }
    const commitData = await commitResp.json();
    const newCommitSha = commitData.sha;

    // 5. Mover el ref al nuevo commit.
    const patchResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "PATCH",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`,
      body: { sha: newCommitSha, force: false },
    });

    await auditExternalCall(env, user_email, "github", "write_files", `${owner}/${repo}@${branch}`, patchResp.status, Date.now() - startTs);

    if (patchResp.status === 429 || patchResp.status === 403) {
      const rlInfo = checkRateLimit(patchResp, 'github');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('github', rlInfo, 'write_files'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "github", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (patchResp.status === 401) {
      await markConnectionInvalid(env, user_email, "github");
      return { status: "forbidden", output: "Conexión GitHub revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (!patchResp.ok) {
      const errText = await patchResp.text();
      return { status: "error", output: `GitHub ref update HTTP ${patchResp.status}: ${errText.slice(0, 500)}. El commit ${newCommitSha} fue creado pero la branch no se actualizó.`, latency_ms: Date.now() - startTs };
    }

    return {
      status: "ok",
      output:
        `Commit multi-archivo creado en ${owner}/${repo}@${branch} — ${Date.now() - startTs}ms\n` +
        `Commit SHA: ${newCommitSha}\n` +
        `Archivos escritos: ${files.length}\n` +
        `Mensaje: "${message}"\n\n` +
        `Archivos:\n${files.map((f) => `  - ${f.path} (${f.content.length} bytes)`).join("\n")}`,
      latency_ms: Date.now() - startTs,
      extra: {
        commit_sha: newCommitSha,
        tree_sha: newTreeSha,
        files_count: files.length,
        owner, repo, branch,
      },
    };
  } catch (e) {
    return { status: "error", output: `Error GitHub write_files: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
