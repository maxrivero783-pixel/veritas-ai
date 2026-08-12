// ==============================================================================
// Véritas v2.3 — /lib/tools/github_create_pr.js
// ==============================================================================
// Crea un Pull Request en un repo GitHub del usuario.
//
// Interfaz: export async function run(args, ctx)
//   args: { owner, repo, title, body?, head, base }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import github from "../services/oauth/github.js";

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { owner, repo, title, body, head, base } = args;
  if (!owner || !repo || !title || !head || !base) {
    return { status: "error", output: "Missing required args: owner, repo, title, head, base." };
  }
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "github");
  } catch (e) {
    return { status: "forbidden", output: `Conecta tu cuenta de GitHub. (${e.message})`, latency_ms: Date.now() - startTs };
  }

  try {
    const createResp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "POST",
      path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      body: {
        title,
        body: body || "",
        head,
        base,
        maintainer_can_modify: false,
      },
    });

    await auditExternalCall(env, user_email, "github", "create_pr", `${owner}/${repo}!${head}->${base}`, createResp.status, Date.now() - startTs);

    if (createResp.status === 429 || createResp.status === 403) {
      const rlInfo = checkRateLimit(createResp, 'github');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('github', rlInfo, 'create_pr'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "github", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (createResp.status === 401) {
      await markConnectionInvalid(env, user_email, "github");
      return { status: "forbidden", output: "Conexión GitHub revocada. Reconéctala en Ajustes.", latency_ms: Date.now() - startTs };
    }
    if (createResp.status === 422) {
      const errText = await createResp.text();
      return {
        status: "error",
        output: `No se pudo crear el PR. Posibles causas: branch ${head} no existe, no hay commits entre ${head} y ${base}, o ya existe un PR idéntico. Detalle: ${errText.slice(0, 500)}`,
        latency_ms: Date.now() - startTs,
      };
    }
    if (!createResp.ok) {
      const errText = await createResp.text();
      return { status: "error", output: `GitHub PR HTTP ${createResp.status}: ${errText.slice(0, 500)}`, latency_ms: Date.now() - startTs };
    }

    const pr = await createResp.json();
    return {
      status: "ok",
      output:
        `Pull Request creado en ${owner}/${repo} — ${Date.now() - startTs}ms\n` +
        `PR #${pr.number}: ${pr.title}\n` +
        `${head} → ${base}\n` +
        `URL: ${pr.html_url}\n` +
        `Estado: ${pr.state}\n` +
        `Body:\n${pr.body || "(sin body)"}`,
      latency_ms: Date.now() - startTs,
      extra: {
        pr_number: pr.number,
        pr_url: pr.html_url,
        pr_state: pr.state,
        owner, repo, head, base,
      },
    };
  } catch (e) {
    return { status: "error", output: `Error GitHub create_pr: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
