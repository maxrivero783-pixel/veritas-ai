// ==============================================================================
// Véritas v2.12 — /lib/fallbackChains.js
// ==============================================================================
// Cadenas de fallback por rol (Sección 3.1.1 del BUILD).
// Mirror frontend del mismo nombre server-side. El frontend, al recibir un
// error `all_keys_rate_limited` o `upstream_error` del modelo primario,
// consulta la cadena del rol actual y ofrece al usuario (o aplica
// automáticamente, según Ajustes) el siguiente modelo disponible.
//
// Comportamiento:
//   - Manual (default): la UI muestra "El modelo X no está disponible.
//     ¿Cambiar a Y?" con botón Aceptar/Cancelar.
//   - Automático: la UI cambia al siguiente modelo sin pedir confirmación;
//     muestra un toast discreto "Cambiado a Y (X caído)".
//   - Al agotar la cadena, ofrecer fallback cruzado entre proveedores
//     (Puter ↔ OpenRouter) según el mapa en Sección 1.1.
//   - Los mensajes del chat indican en metadatos (messages.model) qué modelo
//     se usó en cada turno, para trazabilidad.
// ==============================================================================

// v2.12k — Roles visibles: Agente y Fast (+ Pensador como toggle).
// Proveedor primario: OpenRouter. Fast: Cohere como primario y único (sin Cerebras).
export const FALLBACK_CHAINS = {
  // Agente unificado: Nemotron 3 Super como ejecutor; Ultra/Pensador vía toggle.
  agent: [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "google/gemma-4-31b-it:free",
    "openai/gpt-oss-20b:free",
    "cohere/north-mini-code:free",
  ],
  // Alias interno para chats antiguos de categoría coder (subagentes de código).
  coder: [
    "cohere/north-mini-code:free",
    "poolside/laguna-s-2.1:free",
    "poolside/laguna-xs-2.1:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
  ],
  // Pensador (toggle): Nemotron 3 Ultra orquesta primero; el resto como subagentes.
  pensador: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
  ],
  // Fast (v2.12k): Cohere como primario y único proveedor.
  // v2.13: dos modelos Cohere más como fallback (Command R+ y Command R).
  fast: [
    "cohere/command-a-plus-05-2026",
    "cohere/command-r-plus-08-2024",
    "cohere/command-r-08-2024",
  ],
};

// ------------------------------------------------------------------------------
// v2.13 — ROLE_PARAMS: parámetros de ejecución por rol UI.
// ------------------------------------------------------------------------------
// Fuente de verdad única (frontend Y Worker):
//   - stream:   false ⇒ el proveedor responde en JSON completo (sin SSE).
//   - thinking: "off" ⇒ razonamiento desactivado (en Cohere: thinking:{type:"disabled"}).
// El rol Fast (proveedor Cohere) se parametriza con thinking OFF y SIN streaming
// para entregar respuestas inmediatas.
export const ROLE_PARAMS = {
  agent:    { stream: true,  thinking: "auto" },
  coder:    { stream: true,  thinking: "auto" },
  pensador: { stream: true,  thinking: "on"   },
  fast:     { stream: false, thinking: "off"  },
};

export function getRoleParams(role) {
  return ROLE_PARAMS[role] || { stream: true, thinking: "auto" };
}

// ------------------------------------------------------------------------------
// Provider de cada modelo. Puter eliminado; Cerebras y Cohere asumen el fallback.
// ------------------------------------------------------------------------------
export const MODEL_PROVIDER = {
  "nvidia/nemotron-3-ultra-550b-a55b:free": "openrouter",
  "nvidia/nemotron-3-super-120b-a12b:free": "openrouter",
  "nvidia/nemotron-3-nano-30b-a3b:free": "openrouter",
  "nvidia/nemotron-nano-12b-v2-vl:free": "openrouter",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": "openrouter",
  "google/gemma-4-31b-it:free": "openrouter",
  "openai/gpt-oss-20b:free": "openrouter",
  "cohere/north-mini-code:free": "openrouter",
  "poolside/laguna-s-2.1:free": "openrouter",
  "poolside/laguna-xs-2.1:free": "openrouter",
  "cohere/command-a-plus-05-2026": "cohere",
  "cohere/command-r-plus-08-2024": "cohere",
  "cohere/command-r-08-2024": "cohere",
  "cohere/north-mini-code": "cohere",
};

// ------------------------------------------------------------------------------
// Mapeo modelId → roleKey (compatibilidad).
// ------------------------------------------------------------------------------
// v2.12v: granularidad de UI (agent/coder/fast). NO usar para seleccionar
// system prompts — para eso está prompts.js:MODEL_TO_ROLE (fuente de verdad).
export const MODEL_TO_UI_ROLE = {
  "nvidia/nemotron-3-ultra-550b-a55b:free": "agent",
  "nvidia/nemotron-3-super-120b-a12b:free": "agent",
  "nvidia/nemotron-3-nano-30b-a3b:free": "agent",
  "nvidia/nemotron-nano-12b-v2-vl:free": "agent",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": "agent",
  "google/gemma-4-31b-it:free": "agent",
  "openai/gpt-oss-20b:free": "agent",
  "cohere/north-mini-code:free": "coder",
  "poolside/laguna-s-2.1:free": "coder",
  "poolside/laguna-xs-2.1:free": "coder",
  "cohere/command-a-plus-05-2026": "fast",
  "cohere/command-r-plus-08-2024": "fast",
  "cohere/command-r-08-2024": "fast",
  "cohere/north-mini-code": "coder",
};

// ------------------------------------------------------------------------------
// Context window por modelo.
// ------------------------------------------------------------------------------
export const MODEL_CONTEXT_LIMIT = {
  "nvidia/nemotron-3-ultra-550b-a55b:free": 1000000,
  "nvidia/nemotron-3-super-120b-a12b:free": 262144,
  "nvidia/nemotron-3-nano-30b-a3b:free": 262144,
  "nvidia/nemotron-nano-12b-v2-vl:free": 131072,
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": 262144,
  "google/gemma-4-31b-it:free": 262144,
  "openai/gpt-oss-20b:free": 131072,
  "cohere/north-mini-code:free": 262144,
  "poolside/laguna-s-2.1:free": 262144,
  "poolside/laguna-xs-2.1:free": 262144,
  "cohere/command-a-plus-05-2026": 131072,
  "cohere/command-r-plus-08-2024": 128000,
  "cohere/command-r-08-2024": 128000,
  "cohere/north-mini-code": 262144,
};

// ------------------------------------------------------------------------------
// Helper: getNextFallback(role, currentModelId)
// Devuelve el siguiente modelo en la cadena, o null si se agotó.
// ------------------------------------------------------------------------------
export function getNextFallback(role, currentModelId) {
  const chain = FALLBACK_CHAINS[role];
  if (!chain) return null;
  const idx = chain.indexOf(currentModelId);
  if (idx === -1 || idx === chain.length - 1) return null;
  return chain[idx + 1];
}

// ------------------------------------------------------------------------------
// Helper: isFallbackExhausted(role, currentModelId)
// Devuelve true si currentModelId es el último de la cadena.
// ------------------------------------------------------------------------------
export function isFallbackExhausted(role, currentModelId) {
  const chain = FALLBACK_CHAINS[role];
  if (!chain) return true;
  return chain[chain.length - 1] === currentModelId;
}

// ------------------------------------------------------------------------------
// Helper: getProvider(modelId)
// ------------------------------------------------------------------------------
export function getProvider(modelId) {
  return MODEL_PROVIDER[modelId] || "openrouter";
}

// ------------------------------------------------------------------------------
// Helper: getContextLimit(modelId)
// ------------------------------------------------------------------------------
export function getContextLimit(modelId) {
  return MODEL_CONTEXT_LIMIT[modelId] || 32000;
}

// ------------------------------------------------------------------------------
// Helper: getRoleForModel(modelId)
// ------------------------------------------------------------------------------
export function getRoleForModel(modelId) {
  return MODEL_TO_UI_ROLE[modelId] || null;
}

export default {
  FALLBACK_CHAINS,
  MODEL_PROVIDER,
  MODEL_TO_UI_ROLE,
  MODEL_CONTEXT_LIMIT,
  ROLE_PARAMS,
  getNextFallback,
  isFallbackExhausted,
  getProvider,
  getContextLimit,
  getRoleForModel,
  getRoleParams,
};
