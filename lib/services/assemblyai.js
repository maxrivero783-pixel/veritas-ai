import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.2 — /lib/services/assemblyai.js
// ==============================================================================
// Adaptador HTTP para AssemblyAI — transcripción de audio + inteligencia.
// Auth: Authorization: {ASSEMBLYAI_API_KEY} (SIN prefijo 'Bearer'!)
// Endpoints:
//   POST /v2/transcript       → enviar audio para transcripción async.
//   GET  /v2/transcript/{id}  → pollear estado de transcripción.
//   POST /v2/llm/gateway      → razonamiento LLM sobre transcript.
// ==============================================================================

const BASE = "https://api.assemblyai.com/v2";

// -----------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// -----------------------------------------------------------------------------
// endpoint: "transcribe" | "get_transcript" | "llm_gateway"
// payload :
//   transcribe    → { audio_url, speaker_labels?, language?, speech_model?, 
//                      sentiment?, summarization?, topics?, auto_chapters?, 
//                      pii_redaction?, entity_detection? }
//   get_transcript→ { transcript_id }
//   llm_gateway   → { transcript_id, prompt }
// apiKey         : raw key SIN Bearer.
// -----------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "transcribe":
      return callTranscribe(payload, apiKey);
    case "get_transcript":
      return callGetTranscript(payload, apiKey);
    case "llm_gateway":
      return callLlmGateway(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown AssemblyAI endpoint: ${endpoint}` };
  }
}

// -----------------------------------------------------------------------------
// buildHeaders: auth header SIN 'Bearer'.
// -----------------------------------------------------------------------------
function buildHeaders(apiKey, extra = {}) {
  return { "Authorization": apiKey, "Content-Type": "application/json", ...extra };
}

// -----------------------------------------------------------------------------
// callTranscribe: POST /v2/transcript — envía audio para transcripción async.
// -----------------------------------------------------------------------------
async function callTranscribe(payload, apiKey) {
  const {
    audio_url,
    speaker_labels = true,
    language,
    speech_model,
    sentiment,
    summarization,
    topics,
    auto_chapters,
    pii_redaction,
    entity_detection,
  } = payload;

  if (!audio_url) return { status: 400, data: null, raw: null, error: "Missing audio_url" };

  const body = { audio_url, speaker_labels };
  if (language) body.language = language;
  if (speech_model) body.speech_model = speech_model;
  if (sentiment) body.sentiment_analysis = true;
  if (summarization) body.summarization = true;
  if (topics) body.topic_detection = true;
  if (auto_chapters) body.auto_chapters = true;
  if (pii_redaction) body.redact_pii = true;
  if (entity_detection) body.entity_detection = true;

  const resp = await fetchT(`${BASE}/transcript`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callGetTranscript: GET /v2/transcript/{id} — estado de transcripción.
// -----------------------------------------------------------------------------
async function callGetTranscript(payload, apiKey) {
  const { transcript_id } = payload;
  if (!transcript_id) return { status: 400, data: null, raw: null, error: "Missing transcript_id" };

  const resp = await fetchT(`${BASE}/transcript/${transcript_id}`, {
    method: "GET",
    headers: buildHeaders(apiKey, { "Content-Type": undefined }),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callLlmGateway: POST /v2/llm/gateway — razonamiento LLM sobre transcript.
// -----------------------------------------------------------------------------
async function callLlmGateway(payload, apiKey) {
  const { transcript_id, prompt } = payload;
  if (!transcript_id || !prompt) {
    return { status: 400, data: null, raw: null, error: "Missing transcript_id and/or prompt" };
  }

  const body = { transcript_id, prompt };

  const resp = await fetchT(`${BASE}/llm/gateway`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
