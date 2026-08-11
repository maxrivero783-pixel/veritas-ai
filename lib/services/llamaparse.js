// ==============================================================================
// Véritas v2.4 — /lib/services/llamaparse.js
// ==============================================================================
// Adaptador HTTP para LlamaCloud / LlamaParse.
// Flujo async: POST upload file → POST create parse job → GET poll status.
// Auth: Authorization: Bearer {LLAMA_CLOUD_API_KEY}
// ==============================================================================

const BASE = "https://api.cloud.llamaindex.ai/api";

// -----------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// -----------------------------------------------------------------------------
// endpoint: "upload" | "parse" | "get_job" | "parse_url"
// payload :
//   upload   → { file_content (base64), file_name }
//   parse    → { file_id, tier?, language? }
//   get_job  → { job_id }
//   parse_url→ { url, tier?, language? }
// apiKey   : Bearer token
// -----------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "upload":
      return callUpload(payload, apiKey);
    case "parse":
      return callParse(payload, apiKey);
    case "get_job":
      return callGetJob(payload, apiKey);
    case "parse_url":
      return callParseUrl(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown LlamaParse endpoint: ${endpoint}` };
  }
}

// -----------------------------------------------------------------------------
// callUpload: POST /v1/beta/files — sube archivo para parsing.
// Body: multipart/form-data con el archivo.
// Devuelve { id: "file_xxx" }.
// -----------------------------------------------------------------------------
async function callUpload(payload, apiKey) {
  const { file_content, file_name } = payload;
  if (!file_content || !file_name) {
    return { status: 400, data: null, raw: null, error: "Missing file_content and/or file_name" };
  }

  // Convertir base64 a Uint8Array.
  const bin = Uint8Array.from(atob(file_content), c => c.charCodeAt(0));
  const blob = new Blob([bin]);

  const formData = new FormData();
  formData.append("file", blob, file_name);

  const resp = await fetch(`${BASE}/v1/beta/files`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: formData,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callParse: POST /v2/parse — crea job de parsing para un file_id subido.
// Body: { file_id, tier: "fast"|"balanced"|"premium", language? }
// -----------------------------------------------------------------------------
async function callParse(payload, apiKey) {
  const { file_id, tier = "fast", language } = payload;
  if (!file_id) return { status: 400, data: null, raw: null, error: "Missing file_id" };

  const body = { file_id, tier };
  if (language) body.language = language;

  const resp = await fetch(`${BASE}/v2/parse`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callGetJob: GET /v2/parse/{job_id} — estado del job de parsing.
// -----------------------------------------------------------------------------
async function callGetJob(payload, apiKey) {
  const { job_id } = payload;
  if (!job_id) return { status: 400, data: null, raw: null, error: "Missing job_id" };

  const resp = await fetch(`${BASE}/v2/parse/${job_id}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callParseUrl: POST /v2/parse — parsing directo desde URL pública.
// Body: { url, tier, language? }
// -----------------------------------------------------------------------------
async function callParseUrl(payload, apiKey) {
  const { url, tier = "fast", language } = payload;
  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const body = { url, tier };
  if (language) body.language = language;

  const resp = await fetch(`${BASE}/v2/parse`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
