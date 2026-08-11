// ==============================================================================
// Véritas v2.2 — /lib/tools/browser_use_cloud.js
// ==============================================================================
// Handler para Browser Use Cloud — agente navegador autónomo con NL.
// Opción adicional a browser_use_browse (NO lo reemplaza).
// Incluye auto-provisioning vía math challenge si no hay key configurada.
//
// Interfaz: export async function run(args, ctx)
//   args: { task, url?, max_steps? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import browserUseCloud from "../services/browser_use_cloud.js";

const MAX_OUTPUT_BYTES = 50_000;
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_MS = 300_000; // 5 min — tareas complejas.

// Cache en memoria del isolate para la API key auto-provisioned.
let _cachedApiKey = null;

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    task,
    url,
    max_steps = 50,
  } = args;

  if (!task) {
    return { status: "error", output: "Missing 'task'. Describe la tarea de navegación en lenguaje natural." };
  }

  const startTs = Date.now();
  try {
    // 1. Obtener API key: prioridad env → cache → auto-provision.
    let apiKey = env.BROWSER_USE_CLOUD_API_KEY_1 || null;
    if (!apiKey && _cachedApiKey) {
      apiKey = _cachedApiKey;
    }

    // 2. Auto-provisioning si no hay key.
    if (!apiKey) {
      const provisioned = await autoProvision();
      if (!provisioned) {
        return {
          status: "error",
          output: "Browser Use Cloud: sin API key y auto-provisioning falló. Configura BROWSER_USE_CLOUD_API_KEY_1 o verifica el flujo de signup.",
          latency_ms: Date.now() - startTs,
        };
      }
      apiKey = provisioned;
      _cachedApiKey = provisioned;
    }

    // 3. Lanzar tarea.
    const r = await browserUseCloud.callService({
      endpoint: "run_task",
      payload: { task, url, max_steps: Math.min(max_steps, 100) },
      apiKey,
    });

    if (r.status >= 400 || !r.data) {
      return {
        status: "error",
        output: `Browser Use Cloud: fallo al lanzar tarea. HTTP ${r.status}. ${r.raw ? r.raw.slice(0, 500) : ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const taskId = r.data.task_id || r.data.id;
    if (!taskId) {
      return {
        status: "error",
        output: `Browser Use Cloud: no task_id en respuesta. ${JSON.stringify(r.data || {}).slice(0, 300)}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 4. Pollear hasta completar.
    let result = null;
    let taskStatus = null;
    const pollStart = Date.now();

    while (Date.now() - pollStart < MAX_POLL_MS) {
      await sleep(POLL_INTERVAL_MS);
      const pollR = await browserUseCloud.callService({
        endpoint: "get_task",
        payload: { task_id: taskId },
        apiKey,
      });
      if (pollR.data) {
        taskStatus = pollR.data.status;
        if (taskStatus === "completed" || taskStatus === "success" || taskStatus === "done") {
          result = pollR.data;
          break;
        }
        if (taskStatus === "failed" || taskStatus === "error") {
          return {
            status: "error",
            output: `Browser Use Cloud: tarea falló. TaskId: ${taskId}. ${JSON.stringify(pollR.data.error || pollR.data).slice(0, 500)}`,
            latency_ms: Date.now() - startTs,
          };
        }
      }
    }

    if (!result) {
      const msg = taskStatus ? `Estado: ${taskStatus}` : "Polling timeout (300s)";
      return {
        status: "error",
        output: `Browser Use Cloud: ${msg}. TaskId: ${taskId}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 5. Formatear resultado.
    let output = formatResult(result);

    let truncated = false;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    let header = `Browser Use Cloud — ${Date.now() - startTs}ms
` +
                  `TaskId: ${taskId} | Steps: ${result.steps_used || result.step_count || "?"}
` +
                  `${"=".repeat(60)}\n\n`;

    return {
      status: "ok",
      output: header + output + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        task_id: taskId,
        url: url || null,
        steps_used: result.steps_used || result.step_count || null,
        size: output.length,
        truncated,
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

// -----------------------------------------------------------------------------
// autoProvision: flujo math challenge → verify → API key.
// -----------------------------------------------------------------------------
async function autoProvision() {
  try {
    // 1. Obtener challenge.
    const chR = await browserUseCloud.callService({
      endpoint: "signup_challenge",
      payload: {},
      apiKey: null,
    });
    if (chR.status >= 400 || !chR.data) return null;

    const sessionId = chR.data.session_id;
    const question = chR.data.question;
    if (!sessionId || !question) return null;

    // 2. Resolver challenge matemático simple.
    const answer = solveMathChallenge(question);
    if (answer === null) return null;

    // 3. Verificar y obtener key.
    const vR = await browserUseCloud.callService({
      endpoint: "signup_verify",
      payload: { session_id: sessionId, answer },
      apiKey: null,
    });
    if (vR.status >= 400 || !vR.data) return null;

    // La respuesta puede contener la key directa o en un campo anidado.
    return vR.data.api_key || vR.data.key || vR.data.token || (typeof vR.data === "string" ? vR.data : null);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// solveMathChallenge: evalúa expresiones matemáticas simples de forma segura.
// Soporta: +, -, *, /, paréntesis. Rechaza todo lo demás.
// -----------------------------------------------------------------------------
function solveMathChallenge(question) {
  if (!question || typeof question !== "string") return null;

  // Extraer la expresión matemática del texto.
  // Patrones comunes: "What is 2 + 3?" / "Solve: (12 * 4) + 7"
  const match = question.match(/([\d\s+\-*/().]+)/);
  if (!match) return null;

  const expr = match[1].trim();
  // Validar que solo contiene caracteres seguros.
  if (!/^[\d+\-*/().\s]+$/.test(expr)) return null;

  try {
    // Eval en sandbox mínimo — solo operaciones aritméticas.
    const result = Function(`"use strict"; return (${expr})`)();
    if (typeof result === "number" && isFinite(result)) {
      return Math.round(result);
    }
    return null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// formatResult: extrae texto útil del resultado de la tarea.
// -----------------------------------------------------------------------------
function formatResult(data) {
  let parts = [];

  if (data.result) {
    if (typeof data.result === "string") {
      parts.push(data.result);
    } else if (data.result.text) {
      parts.push(data.result.text);
    } else if (data.result.content) {
      parts.push(typeof data.result.content === "string" ? data.result.content : JSON.stringify(data.result.content, null, 2));
    } else if (data.result.extracted_data) {
      parts.push(JSON.stringify(data.result.extracted_data, null, 2));
    } else {
      parts.push(JSON.stringify(data.result, null, 2));
    }
  }

  if (data.success_message) parts.push(data.success_message);
  if (data.error_message) parts.push("ERROR: " + data.error_message);

  // Si hay historial de acciones.
  if (data.actions && Array.isArray(data.actions)) {
    let actionLog = "--- Actions ---\n";
    for (const a of data.actions.slice(-20)) {
      if (a.action || a.type) actionLog += `[${a.action || a.type}] `;
      if (a.description) actionLog += a.description;
      if (a.url) actionLog += ` → ${a.url}`;
      actionLog += "\n";
    }
    parts.push(actionLog);
  }

  // Si hay capturas de pantalla.
  if (data.screenshots && Array.isArray(data.screenshots) && data.screenshots.length > 0) {
    parts.push(`[${data.screenshots.length} screenshot(s) capturadas — disponibles en extra si se necesitan]`);
  }

  return parts.join("\n\n") || JSON.stringify(data, null, 2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { run };
