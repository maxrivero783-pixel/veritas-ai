import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.12 — /lib/services/browser_use_cloud.js
// ==============================================================================
// Adaptador HTTP para Browser Use Cloud — agente navegador autónomo NL.
// Endpoints:
//   POST /v1/run-task              → lanza tarea de navegación autónoma.
//   GET  /v1/task/{id}             → pollea estado y resultado.
//   POST /cloud/signup/challenge   → obtiene math challenge para auto-signup.
//   POST /cloud/signup/verify      → verifica challenge y obtiene API key.
// Auth: Header X-Browser-Use-API-Key (o auto-provisioned).
// ==============================================================================

const BASE = "https://api.browser-use.com";

// -----------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// -----------------------------------------------------------------------------
// endpoint: "run_task" | "get_task" | "signup_challenge" | "signup_verify"
// payload :
//   run_task         → { task, url?, max_steps?, session_id? }
//   get_task         → { task_id }
//   signup_challenge → { email? }
//   signup_verify    → { session_id, answer }
// apiKey           : API key o null para auto-provisioning.
// -----------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "run_task":
      return callRunTask(payload, apiKey);
    case "get_task":
      return callGetTask(payload, apiKey);
    case "signup_challenge":
      return callSignupChallenge(payload);
    case "signup_verify":
      return callSignupVerify(payload);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Browser Use Cloud endpoint: ${endpoint}` };
  }
}

// -----------------------------------------------------------------------------
// callRunTask: POST /v1/run-task — lanza tarea de navegación.
// -----------------------------------------------------------------------------
async function callRunTask(payload, apiKey) {
  const { task, url, max_steps = 50, session_id } = payload;
  if (!task) return { status: 400, data: null, raw: null, error: "Missing task" };

  const body = { task };
  if (url) body.url = url;
  if (max_steps) body.max_steps = max_steps;
  if (session_id) body.session_id = session_id;

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-Browser-Use-API-Key"] = apiKey;

  const resp = await fetchT(`${BASE}/v1/run-task`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callGetTask: GET /v1/task/{id} — estado de una tarea.
// -----------------------------------------------------------------------------
async function callGetTask(payload, apiKey) {
  const { task_id } = payload;
  if (!task_id) return { status: 400, data: null, raw: null, error: "Missing task_id" };

  const headers = {};
  if (apiKey) headers["X-Browser-Use-API-Key"] = apiKey;

  const resp = await fetchT(`${BASE}/v1/task/${task_id}`, {
    method: "GET",
    headers,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callSignupChallenge: POST /cloud/signup/challenge — obtiene math challenge.
// -----------------------------------------------------------------------------
async function callSignupChallenge(payload) {
  const body = {};
  if (payload.email) body.email = payload.email;

  const resp = await fetchT(`${BASE}/cloud/signup/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callSignupVerify: POST /cloud/signup/verify — verifica answer, obtiene key.
// -----------------------------------------------------------------------------
async function callSignupVerify(payload) {
  const { session_id, answer } = payload;
  if (!session_id || answer === undefined) {
    return { status: 400, data: null, raw: null, error: "Missing session_id and/or answer" };
  }

  const resp = await fetchT(`${BASE}/cloud/signup/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, answer }),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
