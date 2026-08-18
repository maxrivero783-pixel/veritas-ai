// ==============================================================================
// Véritas v2.12 — /lib/tools/llamaparse_parse.js
// ==============================================================================
// Handler para LlamaParse — parsing de PDFs/DOCX a Markdown estructurado.
// Dos modos:
//   url  → parsing directo desde URL pública (un solo POST).
//   file → upload base64 → parse → poll (flujo completo).
//
// Interfaz: export async function run(args, ctx)
//   args: { source_type, url?, file_content?, file_name?, tier?, language? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import llamaparse from "../services/llamaparse.js";

const MAX_OUTPUT_BYTES = 50_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 120_000;

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    source_type = "url",
    url,
    file_content,
    file_name,
    tier = "fast",
    language,
    wait_for_completion = false,
  } = args;

  if (source_type === "url" && !url) {
    return { status: "error", output: "Missing 'url' para source_type=url." };
  }
  if (source_type === "file" && (!file_content || !file_name)) {
    return { status: "error", output: "Missing 'file_content' y/o 'file_name' para source_type=file." };
  }

  const validTiers = ["fast", "balanced", "premium"];
  if (!validTiers.includes(tier)) {
    return { status: "error", output: `Tier debe ser uno de: ${validTiers.join(", ")}` };
  }

  if (discoverKeys(env, "llamaparse").length === 0) {
    return {
      status: "error",
      output: "LlamaParse no está configurado. Configura LLAMA_CLOUD_API_KEY_1 con: wrangler secret put LLAMA_CLOUD_API_KEY_1",
    };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, "llamaparse");
    let jobId = null;

    if (source_type === "url") {
      // Flujo simple: parse directo desde URL.
      const r = await llamaparse.callService({
        endpoint: "parse_url",
        payload: { url, tier, language },
        apiKey: key,
      });

      if (r.status >= 400 || !r.data) {
        await markCooldown(env, "llamaparse", index, 30_000, `LlamaParse URL HTTP ${r.status}`);
        return {
          status: "error",
          output: `LlamaParse falló para ${url}: HTTP ${r.status}. ${r.raw ? r.raw.slice(0, 500) : ""}`,
          latency_ms: Date.now() - startTs,
        };
      }
      jobId = r.data.id;
    } else {
      // Flujo completo: upload → parse.
      // 1. Upload.
      const upR = await llamaparse.callService({
        endpoint: "upload",
        payload: { file_content, file_name },
        apiKey: key,
      });

      if (upR.status >= 400 || !upR.data?.id) {
        await markCooldown(env, "llamaparse", index, 30_000, `LlamaParse upload HTTP ${upR.status}`);
        return {
          status: "error",
          output: `LlamaParse upload falló: HTTP ${upR.status}. ${upR.raw ? upR.raw.slice(0, 500) : ""}`,
          latency_ms: Date.now() - startTs,
        };
      }
      const fileId = upR.data.id;

      // 2. Create parse job.
      const parseR = await llamaparse.callService({
        endpoint: "parse",
        payload: { file_id: fileId, tier, language },
        apiKey: key,
      });

      if (parseR.status >= 400 || !parseR.data?.id) {
        await markCooldown(env, "llamaparse", index, 30_000, `LlamaParse parse HTTP ${parseR.status}`);
        return {
          status: "error",
          output: `LlamaParse parse falló: HTTP ${parseR.status}. ${parseR.raw ? parseR.raw.slice(0, 500) : ""}`,
          latency_ms: Date.now() - startTs,
        };
      }
      jobId = parseR.data.id;
    }

    if (!wait_for_completion) {
      return {
        status: "pending",
        output: `LlamaParse job iniciado. JobId: ${jobId}. Para respetar Cloudflare Free Tier no se espera el resultado en esta request. Reintenta con wait_for_completion=true solo para documentos pequeños o consulta el job externamente.`,
        latency_ms: Date.now() - startTs,
        extra: { job_id: jobId, source_type, url: url || null, file_name: file_name || null, async: true },
      };
    }

    // 3. Pollear hasta que termine.
    let result = null;
    let jobStatus = null;
    const pollStart = Date.now();

    while (Date.now() - pollStart < MAX_POLL_MS) {
      await sleep(POLL_INTERVAL_MS);
      const pollR = await llamaparse.callService({
        endpoint: "get_job",
        payload: { job_id: jobId },
        apiKey: key,
      });
      if (pollR.data) {
        jobStatus = pollR.data.status;
        if (jobStatus === "SUCCESS") {
          result = pollR.data;
          break;
        }
        if (jobStatus === "ERROR") {
          return {
            status: "error",
            output: `LlamaParse job falló. JobId: ${jobId}. Error: ${JSON.stringify(pollR.data.error || pollR.data).slice(0, 500)}`,
            latency_ms: Date.now() - startTs,
          };
        }
      }
    }

    if (!result) {
      const msg = jobStatus ? `Job terminó con estado: ${jobStatus}` : "Polling timeout (120s)";
      return {
        status: "error",
        output: `LlamaParse: ${msg}. JobId: ${jobId}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 4. Extraer markdown del resultado.
    let markdown = "";
    if (result.markdown) {
      markdown = result.markdown;
    } else if (result.result && typeof result.result === "string") {
      markdown = result.result;
    } else if (result.result && result.result.markdown) {
      markdown = result.result.markdown;
    } else {
      markdown = JSON.stringify(result, null, 2);
    }

    let truncated = false;
    if (markdown.length > MAX_OUTPUT_BYTES) {
      markdown = markdown.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    const sourceLabel = source_type === "url" ? url : file_name;
    let header = `LlamaParse — ${sourceLabel} — ${Date.now() - startTs}ms\n` +
                  `Tier: ${tier} | JobId: ${jobId}\n` +
                  `${"=".repeat(60)}\n\n`;

    return {
      status: "ok",
      output: header + markdown + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        source_type,
        url: url || null,
        file_name: file_name || null,
        tier,
        job_id: jobId,
        size: markdown.length,
        truncated,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando LlamaParse: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { run };
