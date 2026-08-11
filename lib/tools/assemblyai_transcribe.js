// ==============================================================================
// Véritas v2.4 — /lib/tools/assemblyai_transcribe.js
// ==============================================================================
// Handler para AssemblyAI — transcripción de audio + inteligencia.
// Flujo: POST /transcript → poll GET /transcript/{id} hasta completar.
// Opcional: razonamiento LLM sobre el transcript vía /v2/llm/gateway.
//
// Interfaz: export async function run(args, ctx)
//   args: { audio_url, features?, prompt? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import assemblyai from "../services/assemblyai.js";

const MAX_OUTPUT_BYTES = 50_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 300_000; // 5 min — transcripts pueden tardar.

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    audio_url,
    speaker_labels = true,
    language,
    speech_model,
    sentiment = false,
    summarization = false,
    topics = false,
    auto_chapters = false,
    pii_redaction = false,
    entity_detection = false,
    prompt,
  } = args;

  if (!audio_url) {
    return { status: "error", output: "Missing 'audio_url'. Proporciona URL del archivo de audio (mp3, wav, m4a, etc.)." };
  }

  if (discoverKeys(env, "assemblyai").length === 0) {
    return {
      status: "error",
      output: "AssemblyAI no está configurado. Configura ASSEMBLYAI_API_KEY_1 con: wrangler secret put ASSEMBLYAI_API_KEY_1",
    };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, "assemblyai");

    // 1. Enviar transcripción.
    const r = await assemblyai.callService({
      endpoint: "transcribe",
      payload: {
        audio_url,
        speaker_labels,
        language,
        speech_model,
        sentiment,
        summarization,
        topics,
        auto_chapters,
        pii_redaction,
        entity_detection,
      },
      apiKey: key,
    });

    if (r.status >= 400 || !r.data?.id) {
      await markCooldown(env, "assemblyai", index, 30_000, `AssemblyAI submit HTTP ${r.status}`);
      return {
        status: "error",
        output: `AssemblyAI: fallo al enviar transcripción. HTTP ${r.status}. ${r.raw ? r.raw.slice(0, 500) : ""}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const transcriptId = r.data.id;

    // 2. Pollear hasta completar.
    let transcript = null;
    let transcriptStatus = null;
    const pollStart = Date.now();

    while (Date.now() - pollStart < MAX_POLL_MS) {
      await sleep(POLL_INTERVAL_MS);
      const pollR = await assemblyai.callService({
        endpoint: "get_transcript",
        payload: { transcript_id: transcriptId },
        apiKey: key,
      });
      if (pollR.data) {
        transcriptStatus = pollR.data.status;
        if (transcriptStatus === "completed") {
          transcript = pollR.data;
          break;
        }
        if (transcriptStatus === "error") {
          return {
            status: "error",
            output: `AssemblyAI: transcripción falló. Id: ${transcriptId}. Error: ${JSON.stringify(pollR.data.error || {}).slice(0, 500)}`,
            latency_ms: Date.now() - startTs,
          };
        }
      }
    }

    if (!transcript) {
      const msg = transcriptStatus ? `Estado: ${transcriptStatus}` : "Polling timeout (300s)";
      return {
        status: "error",
        output: `AssemblyAI: ${msg}. TranscriptId: ${transcriptId}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // 3. Formatear resultado.
    let output = formatTranscript(transcript);

    // 4. Si hay prompt, usar LLM Gateway.
    if (prompt && transcriptId) {
 const llmR = await assemblyai.callService({
        endpoint: "llm_gateway",
        payload: { transcript_id: transcriptId, prompt },
        apiKey: key,
      });
      if (llmR.data && !llmR.error) {
        output += "\n\n--- LLM Gateway Analysis ---\n" +
                  (typeof llmR.data === "string" ? llmR.data : JSON.stringify(llmR.data, null, 2));
      }
    }

    let truncated = false;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = output.slice(0, MAX_OUTPUT_BYTES);
      truncated = true;
    }

    let header = `AssemblyAI — ${audio_url.slice(0, 80)} — ${Date.now() - startTs}ms\n` +
                  `TranscriptId: ${transcriptId}\n` +
                  `Duration: ${transcript.audio_duration ? transcript.audio_duration + 's' : 'N/A'}\n` +
                  `${"=".repeat(60)}\n\n`;

    return {
      status: "ok",
      output: header + output + (truncated ? `\n\n[... truncado a ${MAX_OUTPUT_BYTES} bytes]` : ""),
      latency_ms: Date.now() - startTs,
      extra: {
        transcript_id: transcriptId,
        audio_url,
        duration: transcript.audio_duration,
        size: output.length,
        truncated,
      },
    };
  } catch (e) {
    return {
      status: "error",
      output: `Error llamando AssemblyAI: ${e.message}`,
      latency_ms: Date.now() - startTs,
    };
  }
}

// -----------------------------------------------------------------------------
// formatTranscript: formatea el transcript con texto, speakers, sentimiento.
// -----------------------------------------------------------------------------
function formatTranscript(t) {
  let parts = [];

  // Texto principal.
  if (t.text) {
    parts.push("--- Transcript ---\n" + t.text);
  }

  // Utterances con speaker labels.
  if (t.utterances && t.utterances.length > 0) {
    let speakerBlock = "--- Speaker Diarization ---\n";
    for (const u of t.utterances.slice(0, 100)) {
      let line = `[${u.speaker || "?"}] `;
      if (u.start !== undefined) line += `${formatTime(u.start)} - ${formatTime(u.end)}: `;
      line += u.text || "";
      if (u.sentiment) line += ` [${u.sentiment}]`;
      speakerBlock += line + "\n";
    }
    parts.push(speakerBlock);
  }

  // Sentiment analysis.
  if (t.sentiment_analysis_results && t.sentiment_analysis_results.length > 0) {
    let sentBlock = "--- Sentiment Analysis ---\n";
    for (const s of t.sentiment_analysis_results.slice(0, 30)) {
      sentBlock += `[${s.sentiment}] ${formatTime(s.start)} - ${formatTime(s.end)}: ${(s.text || "").slice(0, 150)}\n`;
    }
    parts.push(sentBlock);
  }

  // Summary.
  if (t.summary) {
    parts.push("--- Summary ---\n" + (typeof t.summary === "string" ? t.summary : JSON.stringify(t.summary, null, 2)));
  }

  // Chapters.
  if (t.chapters && t.chapters.length > 0) {
    let chapBlock = "--- Chapters ---\n";
    for (const c of t.chapters) {
      chapBlock += `Ch ${c.start !== undefined ? formatTime(c.start) : "?"} - ${c.end !== undefined ? formatTime(c.end) : "?"}: ${c.headline || ""}\n${c.summary || ""}\n\n`;
    }
    parts.push(chapBlock);
  }

  // Topics.
  if (t.topics && t.topics.length > 0) {
    parts.push("--- Topics ---\n" + t.topics.map(t => `${t.topic} (relevance: ${t.relevance_score?.toFixed(2)})`).join("\n"));
  }

  return parts.join("\n\n");
}

function formatTime(s) {
  if (s === undefined || s === null) return "?";
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { run };
