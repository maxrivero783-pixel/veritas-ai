import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.2 — /lib/services/rover.js
// ==============================================================================
// Adaptador HTTP para Rover (rtrvr.ai) — MCP-native cloud scraper.
// Interfaz: JSON-RPC 2.0 sobre POST https://api.rtrvr.ai/mcp
// Tools MCP soportados:
//   cloud_scrape  → extracción instantánea de página a Markdown
//   cloud_agent   → agente web multi-paso con prompt en lenguaje natural
// Auth: Authorization: Bearer {ROVER_API_KEY}
// ==============================================================================

const MCP_ENDPOINT = "https://api.rtrvr.ai/mcp";

// -----------------------------------------------------------------------------
// callService: dispatcher por tool MCP.
// -----------------------------------------------------------------------------
// endpoint: "scrape" | "agent"
// payload :
//   scrape → { url, prompt? }
//   agent  → { url?, prompt, max_steps? }
// apiKey  : clave Bearer
// -----------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "scrape":
      return callMCP("cloud_scrape", payload, apiKey);
    case "agent":
      return callMCP("cloud_agent", payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Rover endpoint: ${endpoint}` };
  }
}

// -----------------------------------------------------------------------------
// callMCP: envía un JSON-RPC 2.0 tools/call al endpoint MCP de Rover.
// -----------------------------------------------------------------------------
async function callMCP(toolName, payload, apiKey) {
  const rpcId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const rpcBody = {
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      name: toolName,
      arguments: payload,
    },
    id: rpcId,
  };

  const resp = await fetchT(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(rpcBody),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  // JSON-RPC 2.0: si la respuesta contiene un error, lo propagamos.
  if (data && data.error) {
    return { status: resp.status >= 400 ? resp.status : 500, data, raw: text, error: data.error.message || JSON.stringify(data.error) };
  }

  return { status: resp.status, data, raw: text };
}

export default { callService };
