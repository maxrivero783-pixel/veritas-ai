// ==============================================================================
// Véritas v2.2 — /lib/tools/browser_use_browse.js
// ==============================================================================
// Ejecuta una tarea de navegación autónoma descrita en lenguaje natural vía
// Browser-use hosted API. Latencia alta (10-60s típico, hasta 120s timeout).
//
// El handler crea una task con POST /tasks y hace polling hasta finished/failed.
//
// Interfaz: export async function run(args, ctx)
//   args: { task: string, url?: string, max_steps?: number }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import browserUse from "../services/browser_use.js";

const MAX_OUTPUT_BYTES = 30_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const { task, url, max_steps = 25, wait_for_completion = false } = args;
  if (!task) return { status: "error", output: "Missing 'task' argument." };

  if (discoverKeys(env, "browser_use").length === 0) {
    return {
      status: "error",
      output: "Browser-use no está configurado. Configura BROWSER_USE_API_KEY_1 con: wrangler secret put BROWSER_USE_API_KEY_1",
    };
  }

  const startTs = Date.now();
  let key, keyIndex;
  try {
    const k = await getKey(env, "browser_use");
    key = k.key;
    keyIndex = k.index;
  } catch (e) {
    return {
      status: "error",
      output: `No hay claves saludables en el pool de browser_use: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }

  try {
    // callService con endpoint="browse" hace la creación + polling automáticamente.
    const r = await browserUse.callService({
      endpoint: "browse",
      payload: {
        task,
        url,
        max_steps,
        wait_for_completion,
        timeoutMs: 120_000,
      },
      apiKey: key,
    });

    // Si la respuesta inicial es 401/403/429, marcar cooldown y reportar.
    if (r.status === 401 || r.status === 403) {
      await markCooldown(env, "browser_use", keyIndex, 3600_000, `HTTP ${r.status} auth`);
    } else if (r.status === 429 || r.status === 503) {
      await markCooldown(env, "browser_use", keyIndex, 60_000, `HTTP ${r.status}`);
    }

    const latency = Date.now() - startTs;

    if (r.status !== 200 || !r.data) {
      return {
        status: "error",
        output: `Browser-use falló: HTTP ${r.status}. ${r.raw?.slice(0, 500) || ""}`,
        latency_ms: latency,
      };
    }

    const data = r.data;
    if (!wait_for_completion) {
      return {
        status: "pending",
        output: `Browser-use task iniciada — ${latency}ms\nTaskId: ${data.id || data.task_id || "?"}\nPara respetar Cloudflare Free Tier no se espera el resultado en esta request.`,
        latency_ms: latency,
        extra: { task_id: data.id || data.task_id || null, url, task, async: true },
      };
    }
    // Estructura típica: { id, status, output, steps, errors }
    let outputText = `Browser-use task completada — ${latency}ms\n` +
                     `Task: "${task}"\n` +
                     `Status: ${data.status}\n${"=".repeat(60)}\n`;

    if (data.output) outputText += `OUTPUT:\n${data.output}\n\n`;
    if (data.steps && Array.isArray(data.steps) && data.steps.length > 0) {
      outputText += `PASOS (${data.steps.length}):\n`;
      for (const step of data.steps.slice(0, 10)) {
        outputText += `  [${step.step || "?"}] ${step.description || step.action || JSON.stringify(step).slice(0, 200)}\n`;
      }
      if (data.steps.length > 10) outputText += `  ... y ${data.steps.length - 10} pasos más.\n`;
    }
    if (data.errors && data.errors.length > 0) {
      outputText += `\nERRORES:\n${data.errors.map((e) => `  - ${typeof e === "string" ? e : JSON.stringify(e).slice(0, 200)}`).join("\n")}\n`;
    }
    if (r.error) outputText += `\nWARN: ${r.error}\n`;

    if (outputText.length > MAX_OUTPUT_BYTES) {
      outputText = outputText.slice(0, MAX_OUTPUT_BYTES) + `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]`;
    }

    return {
      status: data.status === "failed" || data.status === "error" ? "error" : "ok",
      output: outputText,
      latency_ms: latency,
      extra: {
        task_id: data.id,
        steps_count: data.steps?.length || 0,
        url,
        task,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando Browser-use: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

export default { run };
