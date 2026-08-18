// ==============================================================================
// Véritas v2.12 — /lib/tools/browser_use_cloud.js
// ==============================================================================
// Ejecuta una tarea de navegación autónoma vía Browser Use Cloud API.
//
// Interfaz: export async function run(args, ctx)
//   args: { task: string, url?: string, max_steps?: number }
//   ctx:  { env, user_email, chat_id, role }
//
// Usa una API key explícita si existe en el entorno y, si no, intenta el flujo
// de auto-provisioning expuesto por el adaptador HTTP.
// ==============================================================================

import browserUseCloud from "../services/browser_use_cloud.js";

const MAX_OUTPUT_BYTES = 30_000;
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const TERMINAL_STATUSES = new Set(["finished", "completed", "complete", "success", "succeeded", "failed", "error", "cancelled", "canceled"]);
const ERROR_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);

export async function run(args, ctx) {
  const { env } = ctx;
  const { task, url, max_steps = 50, wait_for_completion = false } = args || {};
  if (!task) return { status: "error", output: "Missing 'task' argument." };

  const startTs = Date.now();
  let apiKey = findConfiguredKey(env);

  try {
    let result = await runTaskAndPoll({ task, url, max_steps, apiKey, startTs, wait_for_completion });

    // Si no hay key configurada y la API exige auth, intenta auto-provisioning.
    if (!apiKey && result.authError) {
      const provisioned = await autoProvisionKey(env, ctx);
      if (!provisioned.ok) {
        return {
          status: "error",
          output: `Browser Use Cloud requiere API key y no se pudo auto-provisionar: ${provisioned.error}`,
          latency_ms: Date.now() - startTs,
        };
      }
      apiKey = provisioned.apiKey;
      result = await runTaskAndPoll({ task, url, max_steps, apiKey, startTs, wait_for_completion });
    }

    if (result.status === "error") return result;

    const data = result.data || {};
    const status = normalizeStatus(data.status || result.taskStatus || "completed");
    const outputText = !wait_for_completion && result.taskId
      ? `Browser Use Cloud task iniciada — ${Date.now() - startTs}ms\nTaskId: ${result.taskId}\nPara respetar Cloudflare Free Tier no se espera el resultado en esta request.`
      : formatOutput({ data, task, url, latency: Date.now() - startTs });

    return {
      status: (!wait_for_completion && result.taskId) ? "pending" : (ERROR_STATUSES.has(status) ? "error" : "ok"),
      output: truncate(outputText, MAX_OUTPUT_BYTES),
      latency_ms: Date.now() - startTs,
      extra: {
        task_id: data.id || data.task_id || result.taskId || null,
        task_status: status,
        url: url || null,
        task,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Browser Use Cloud: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

function findConfiguredKey(env = {}) {
  return env.BROWSER_USE_CLOUD_API_KEY ||
    env.BROWSER_USE_CLOUD_API_KEY_1 ||
    env.BROWSER_USE_API_KEY ||
    env.BROWSER_USE_API_KEY_1 ||
    null;
}

async function runTaskAndPoll({ task, url, max_steps, apiKey, startTs, wait_for_completion }) {
  const create = await browserUseCloud.callService({
    endpoint: "run_task",
    payload: { task, url, max_steps },
    apiKey,
  });

  if (create.status === 401 || create.status === 403) {
    return { status: "error", authError: true, output: `Browser Use Cloud auth error: HTTP ${create.status}` };
  }

  if (create.status < 200 || create.status >= 300 || !create.data) {
    return {
      status: "error",
      output: `Browser Use Cloud run_task falló: HTTP ${create.status}. ${create.raw?.slice(0, 500) || create.error || ""}`,
      latency_ms: Date.now() - startTs,
    };
  }

  const taskId = create.data.id || create.data.task_id || create.data.taskId;
  if (!wait_for_completion && taskId) {
    return { status: "ok", data: { ...create.data, status: create.data.status || "running" }, taskId, taskStatus: "running" };
  }
  if (!taskId) {
    // Algunas respuestas pueden traer el resultado final directamente.
    return { status: "ok", data: create.data, taskId: null, taskStatus: create.data.status };
  }

  let latest = create.data;
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = normalizeStatus(latest.status || latest.state);
    if (TERMINAL_STATUSES.has(status)) {
      return { status: "ok", data: latest, taskId, taskStatus: status };
    }

    await delay(POLL_INTERVAL_MS);
    const poll = await browserUseCloud.callService({
      endpoint: "get_task",
      payload: { task_id: taskId },
      apiKey,
    });

    if (poll.status === 401 || poll.status === 403) {
      return { status: "error", authError: true, output: `Browser Use Cloud auth error: HTTP ${poll.status}` };
    }

    if (poll.status < 200 || poll.status >= 300 || !poll.data) {
      return {
        status: "error",
        output: `Browser Use Cloud get_task falló: HTTP ${poll.status}. ${poll.raw?.slice(0, 500) || poll.error || ""}`,
        latency_ms: Date.now() - startTs,
      };
    }
    latest = poll.data;
  }

  return {
    status: "error",
    output: `Browser Use Cloud timeout tras ${DEFAULT_TIMEOUT_MS / 1000}s. task_id=${taskId}`,
    latency_ms: Date.now() - startTs,
    extra: { task_id: taskId, last_status: latest.status || latest.state || null },
  };
}

async function autoProvisionKey(env, ctx) {
  const email = ctx.user_email || env.DEV_USER_EMAIL || undefined;
  const challenge = await browserUseCloud.callService({
    endpoint: "signup_challenge",
    payload: { email },
    apiKey: null,
  });

  if (challenge.status < 200 || challenge.status >= 300 || !challenge.data) {
    return { ok: false, error: `challenge HTTP ${challenge.status}. ${challenge.raw?.slice(0, 300) || ""}` };
  }

  const answer = solveMathChallenge(challenge.data);
  const sessionId = challenge.data.session_id || challenge.data.sessionId || challenge.data.id;
  if (!sessionId || answer === null || answer === undefined) {
    return { ok: false, error: "challenge sin session_id o sin respuesta calculable" };
  }

  const verify = await browserUseCloud.callService({
    endpoint: "signup_verify",
    payload: { session_id: sessionId, answer },
    apiKey: null,
  });

  if (verify.status < 200 || verify.status >= 300 || !verify.data) {
    return { ok: false, error: `verify HTTP ${verify.status}. ${verify.raw?.slice(0, 300) || ""}` };
  }

  const apiKey = verify.data.api_key || verify.data.apiKey || verify.data.key || verify.data.token;
  if (!apiKey) return { ok: false, error: "verify no devolvió api_key" };
  return { ok: true, apiKey };
}

function solveMathChallenge(data) {
  if (typeof data.answer === "number" || typeof data.answer === "string") return data.answer;

  const text = String(data.challenge || data.question || data.prompt || JSON.stringify(data));
  const m = text.match(/(-?\d+)\s*([+\-*/x×])\s*(-?\d+)/i);
  if (!m) return null;

  const a = Number(m[1]);
  const op = m[2];
  const b = Number(m[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*":
    case "x":
    case "×": return a * b;
    case "/": return b === 0 ? null : a / b;
    default: return null;
  }
}

function formatOutput({ data, task, url, latency }) {
  const status = data.status || data.state || "completed";
  let out = `Browser Use Cloud task completada — ${latency}ms\n` +
    `Task: "${task}"\n` +
    (url ? `URL inicial: ${url}\n` : "") +
    `Status: ${status}\n${"=".repeat(60)}\n`;

  const result = data.output || data.result || data.final_result || data.markdown || data.text;
  if (typeof result === "string") out += `${result}\n`;
  else if (result) out += `${JSON.stringify(result, null, 2)}\n`;
  else out += `${JSON.stringify(data, null, 2)}\n`;

  if (Array.isArray(data.steps) && data.steps.length > 0) {
    out += `\nPASOS (${data.steps.length}):\n`;
    for (const step of data.steps.slice(0, 10)) {
      out += `  - ${typeof step === "string" ? step : JSON.stringify(step).slice(0, 240)}\n`;
    }
    if (data.steps.length > 10) out += `  ... y ${data.steps.length - 10} pasos más.\n`;
  }

  if (data.error) out += `\nERROR: ${typeof data.error === "string" ? data.error : JSON.stringify(data.error)}\n`;
  return out;
}

function normalizeStatus(status) {
  return String(status || "").toLowerCase();
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n\n[... truncado a ${max} bytes]` : text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { run };
