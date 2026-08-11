// ==============================================================================
// Véritas v2.4 — /lib/services/browser_use.js
// ==============================================================================
// Adaptador HTTP para Browser-use hosted API.
// Endpoint: https://api.browser-use.com/api/v1/
// Auth: Authorization: Bearer <api_key>
//
// Flujo: POST /tasks para crear una tarea autónoma → poll GET /task/{id} cada
// 2s hasta status === "finished" → devolver { output, steps, errors }.
// ==============================================================================

const BASE = "https://api.browser-use.com/api/v1";
const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 120_000; // 2 min — las tasks largas pueden tardar 60s

// ------------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// Endpoints soportados:
//   "browse"   → payload: { task, url?, max_steps?, wait_for_completion? }
//   "task_status" → payload: { id }  (polling manual)
//   "health"   → payload: {}  (GET /health)
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "browse":
      return callBrowse(payload, apiKey);
    case "task_status":
      return callTaskStatus(payload, apiKey);
    case "health":
      return callHealth(apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown browser_use endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// browse: crea una task y hace polling hasta que termine (o timeout).
// Body de creación: { task, url?, max_steps? }
// Respuesta de creación: { id, status: "queued" }
// ------------------------------------------------------------------------------
async function callBrowse(payload, apiKey) {
  const { task, url, max_steps = 25, wait_for_completion = true, timeoutMs = DEFAULT_TIMEOUT_MS } = payload;
  if (!task) return { status: 400, data: null, raw: null, error: "Missing task" };

  const createBody = { task };
  if (url) createBody.url = url;
  if (max_steps) createBody.max_steps = max_steps;

  const createResp = await fetch(`${BASE}/tasks`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });
  const createText = await createResp.text();
  let createData;
  try { createData = JSON.parse(createText); } catch { createData = null; }

  if (!createResp.ok || !createData || !createData.id) {
    return { status: createResp.status, data: createData, raw: createText, error: "Failed to create task" };
  }

  if (!wait_for_completion) {
    // Caller hace polling manualmente.
    return { status: 200, data: createData, raw: createText };
  }

  // Polling hasta finished/failed/timeout.
  const deadline = Date.now() + timeoutMs;
  let lastStatus = createData;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const pollResp = await callTaskStatus({ id: createData.id }, apiKey);
    if (pollResp.status !== 200 || !pollResp.data) {
      lastStatus = pollResp.data || lastStatus;
      continue;
    }
    lastStatus = pollResp.data;
    const st = lastStatus.status;
    if (st === "finished" || st === "completed" || st === "done") {
      return { status: 200, data: lastStatus, raw: JSON.stringify(lastStatus) };
    }
    if (st === "failed" || st === "error") {
      return { status: 200, data: lastStatus, raw: JSON.stringify(lastStatus), error: lastStatus.error || "Task failed" };
    }
    // si no terminó, seguir polleando
  }
  return {
    status: 200,
    data: lastStatus,
    raw: JSON.stringify(lastStatus),
    error: `Task ${createData.id} timed out after ${timeoutMs}ms`,
    timed_out: true,
  };
}

// ------------------------------------------------------------------------------
// task_status: GET /task/{id}
// Devuelve { id, status, output?, steps?, errors? }
// ------------------------------------------------------------------------------
async function callTaskStatus(payload, apiKey) {
  const { id } = payload;
  if (!id) return { status: 400, data: null, raw: null, error: "Missing id" };

  const resp = await fetch(`${BASE}/task/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// health: GET /health
// ------------------------------------------------------------------------------
async function callHealth(apiKey) {
  const resp = await fetch(`${BASE}/health`, {
    method: "GET",
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { status: text }; }
  return { status: resp.status, data, raw: text };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default { callService };
