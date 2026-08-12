// ==============================================================================
// Véritas v2.3 — /lib/tools/github_list_repos.js
// ==============================================================================
// Lista los repositorios del usuario conectado en GitHub.
//
// Usa la conexión OAuth del usuario (tabla external_connections) y el adaptador
// /lib/services/oauth/github.js. Audita la llamada en external_api_calls.
//
// Interfaz: export async function run(args, ctx)
//   args: { affiliation?: string }  // default 'owner,collaborator'
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { getValidConnection, markConnectionInvalid, auditExternalCall } from "../oauth.js";
import { checkRateLimit, rateLimitErrorMessage } from "../rateLimit.js";
import github from "../services/oauth/github.js";

const MAX_REPOS = 50;

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { affiliation = "owner,collaborator" } = args;
  const startTs = Date.now();

  let conn;
  try {
    conn = await getValidConnection(env, user_email, "github");
  } catch (e) {
    return {
      status: "forbidden",
      output: `Conecta tu cuenta de GitHub en Ajustes → Conexiones externas para usar esta tool. (Detalle: ${e.message})`,
      latency_ms: Date.now() - startTs,
    };
  }

  try {
    const resp = await github.apiCall({
      accessToken: conn.accessToken,
      method: "GET",
      path: `/user/repos?per_page=${MAX_REPOS}&sort=updated&affiliation=${encodeURIComponent(affiliation)}`,
    });

    await auditExternalCall(env, user_email, "github", "list_repos", "user/repos", resp.status, Date.now() - startTs);

    if (resp.status === 429 || resp.status === 403) {
      const rlInfo = checkRateLimit(resp, 'github');
      if (rlInfo.rateLimited) {
        return { status: "rate_limited", output: rateLimitErrorMessage('github', rlInfo, 'list_repos'), latency_ms: Date.now() - startTs, extra: { rate_limited: true, provider: "github", remaining: rlInfo.remaining, limit: rlInfo.limit, reset_at: rlInfo.resetAt, wait_seconds: rlInfo.waitSeconds } };
      }
    }
    if (resp.status === 401) {
      await markConnectionInvalid(env, user_email, "github");
      return {
        status: "forbidden",
        output: "Tu conexión de GitHub fue revocada. Reconéctala en Ajustes → Conexiones externas.",
        latency_ms: Date.now() - startTs,
      };
    }
    if (!resp.ok) {
      const errText = await resp.text();
      return {
        status: "error",
        output: `GitHub API devolvió HTTP ${resp.status}: ${errText.slice(0, 500)}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const repos = await resp.json();
    const formatted = repos.map((r) => ({
      full_name: r.full_name,
      name: r.name,
      owner: r.owner?.login,
      private: r.private,
      default_branch: r.default_branch,
      description: r.description || "",
      updated_at: r.updated_at,
      html_url: r.html_url,
    }));

    let output = `Repositorios de GitHub (${formatted.length} ${formatted.length === MAX_REPOS ? "(máximo)" : ""})\n${"=".repeat(60)}\n`;
    for (const r of formatted) {
      output += `• ${r.full_name}${r.private ? " [privado]" : ""} (default: ${r.default_branch})\n` +
                `  ${r.description ? r.description.slice(0, 100) : "(sin descripción)"}\n` +
                `  Actualizado: ${r.updated_at} | ${r.html_url}\n\n`;
    }

    return {
      status: "ok",
      output,
      latency_ms: Date.now() - startTs,
      extra: { count: formatted.length, repos: formatted },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando GitHub: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

export default { run };
