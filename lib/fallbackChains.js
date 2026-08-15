// ==============================================================================
// Véritas v2.2 — /lib/fallbackChains.js
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

// v2.8 — Sin Puter. Roles visibles: Agente y Fast (+ Pensador como toggle).
// Proveedor primario: OpenRouter. Fallback final: Cerebras → Cohere.
export const FALLBACK_CHAINS = {
  // Agente unificado: Nemotron 3 Super como ejecutor; Ultra/Pensador vía toggle.
  agent: [
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "google/gemma-4-31b-it:free",
    "openai/gpt-oss-20b:free",
    "cohere/north-mini-code:free",
    "cerebras/llama-3.3-70b",
    "cohere/command-r-plus",
  ],
  // Alias interno para chats antiguos de categoría coder (subagentes de código).
  coder: [
    "cohere/north-mini-code:free",
    "poolside/laguna-s-2.1:free",
    "poolside/laguna-xs-2.1:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "cerebras/llama-3.3-70b",
    "cohere/command-r-plus",
  ],
  // Pensador (toggle): Nemotron 3 Ultra orquesta primero; el resto como subagentes.
  pensador: [
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3-nano-30b-a3b:free",
    "cerebras/llama-3.3-70b",
    "cohere/command-r-plus",
  ],
  // Fast: ligero y rápido; Cerebras primario con Cohere de fallback.
  fast: [
    "cerebras/llama3.1-8b",
    "cerebras/llama-3.3-70b",
    "cohere/command-r-plus",
    "cohere/command-a-03-2025",
  ],
};

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
  "cerebras/llama3.1-8b": "cerebras",
  "cerebras/llama-3.3-70b": "cerebras",
  "cohere/command-r-plus": "cohere",
  "cohere/command-a-03-2025": "cohere",
};

// ------------------------------------------------------------------------------
// Mapeo modelId → roleKey (compatibilidad).
// ------------------------------------------------------------------------------
export const MODEL_TO_ROLE = {
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
  "cerebras/llama3.1-8b": "fast",
  "cerebras/llama-3.3-70b": "fast",
  "cohere/command-r-plus": "fast",
  "cohere/command-a-03-2025": "fast",
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
  "cerebras/llama3.1-8b": 131072,
  "cerebras/llama-3.3-70b": 131072,
  "cohere/command-r-plus": 128000,
  "cohere/command-a-03-2025": 256000,
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
  return MODEL_TO_ROLE[modelId] || null;
}

export default {
  FALLBACK_CHAINS,
  MODEL_PROVIDER,
  MODEL_TO_ROLE,
  MODEL_CONTEXT_LIMIT,
  getNextFallback,
  isFallbackExhausted,
  getProvider,
  getContextLimit,
  getRoleForModel,
};
