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

export const FALLBACK_CHAINS = {
  // Agente: stack Nemotron (Ultra orquesta, Super ejecuta). Si Nemotron cae,
  // GLM-Flash y Dolphin como auxiliares declarados, luego fallback global.
  agent: [
    "nvidia/nemotron-3-super-120b-a12b:free",                 // primario: ejecutor por defecto
    "nvidia/nemotron-3-ultra-550b-a55b:free",                 // escalamiento: orquestador
    "z-ai/glm-4.5-flash",                                      // auxiliar 1 (declarar parcial)
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", // auxiliar 2 (declarar parcial)
    "nousresearch/hermes-3-llama-3.1-405b:free",              // fallback global 1
    "qwen/qwen3-next-80b-a3b-instruct:free",                  // fallback global 2
  ],
  // Coder: Laguna primario, fallback a Qwen (buen en código) y Hermes.
  coder: [
    "poolside/laguna-m.1:free",                               // primario (OpenRouter)
    "qwen/qwen3-next-80b-a3b-instruct:free",                  // fallback 1 (OpenRouter)
    "nousresearch/hermes-3-llama-3.1-405b:free",              // fallback 2 (OpenRouter)
  ],
  // Estratega: Dolphin primario (Puter), fallback a OpenRouter.
  estratega: [
    "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", // primario (Puter)
    "nousresearch/hermes-3-llama-3.1-405b:free",              // fallback 1 (OpenRouter)
    "qwen/qwen3-next-80b-a3b-instruct:free",                  // fallback 2 (OpenRouter)
  ],
  // Pensador: Nemotron 3 Super primario (mismo modelo que el ejecutor del Agente,
  // pero usado standalone para razonamiento profundo). Fallback a Ultra, luego global.
  pensador: [
    "nvidia/nemotron-3-super-120b-a12b:free",                 // primario
    "nvidia/nemotron-3-ultra-550b-a55b:free",                 // fallback 1 (Ultra tiene más contexto)
    "nousresearch/hermes-3-llama-3.1-405b:free",              // fallback 2
    "qwen/qwen3-next-80b-a3b-instruct:free",                  // fallback 3
  ],
  // Fast: GLM-Flash primario (Puter), fallback a Qwen.
  fast: [
    "z-ai/glm-4.5-flash",                                     // primario (Puter)
    "qwen/qwen3-next-80b-a3b-instruct:free",                  // fallback 1 (OpenRouter)
  ],
};

// ------------------------------------------------------------------------------
// Provider de cada modelo (para saber si cambiar de proveedor al hacer fallback).
// ------------------------------------------------------------------------------
export const MODEL_PROVIDER = {
  // Stack Nemotron (Agente)
  "nvidia/nemotron-3-ultra-550b-a55b:free": "openrouter",
  "nvidia/nemotron-3-super-120b-a12b:free": "openrouter",
  "nvidia/nemotron-nano-12b-v2-vl:free": "openrouter",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": "openrouter",
  // Roles standalone
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free": "puter",
  "poolside/laguna-m.1:free": "openrouter",
  "z-ai/glm-4.5-flash": "puter",
  // Fallback global
  "nousresearch/hermes-3-llama-3.1-405b:free": "openrouter",
  "qwen/qwen3-next-80b-a3b-instruct:free": "openrouter",
};

// ------------------------------------------------------------------------------
// Mapeo modelId → roleKey (para resolver el rol a partir del modelo activo).
// Mirror del MODEL_TO_ROLE de prompts.js.
// ------------------------------------------------------------------------------
export const MODEL_TO_ROLE = {
  // Stack Nemotron → todos mapean a "agent" (el orquestador decide cuál usar)
  "nvidia/nemotron-3-ultra-550b-a55b:free": "agent",
  "nvidia/nemotron-3-super-120b-a12b:free": "agent", // también usado como "pensador" (lo decide el frontend por categoría)
  "nvidia/nemotron-nano-12b-v2-vl:free": "agent",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": "agent",
  // Roles standalone
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free": "estratega",
  "poolside/laguna-m.1:free": "coder",
  "z-ai/glm-4.5-flash": "fast",
  // Fallback global (el rol real lo decide el chat)
  "nousresearch/hermes-3-llama-3.1-405b:free": "agent",
  "qwen/qwen3-next-80b-a3b-instruct:free": "agent",
};

// ------------------------------------------------------------------------------
// Context window por modelo (para el contador de tokens, Sección 1.4.6).
// ------------------------------------------------------------------------------
export const MODEL_CONTEXT_LIMIT = {
  // Stack Nemotron
  "nvidia/nemotron-3-ultra-550b-a55b:free": 1000000,        // hasta 1M tokens
  "nvidia/nemotron-3-super-120b-a12b:free": 262144,         // 256K
  "nvidia/nemotron-nano-12b-v2-vl:free": 131072,           // 128K
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": 131072, // 128K
  // Roles standalone
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free": 32768, // 32K-33K
  "poolside/laguna-m.1:free": 262144,                      // 256K
  "z-ai/glm-4.5-flash": 131072,                            // 128K
  // Fallback global
  "nousresearch/hermes-3-llama-3.1-405b:free": 131072,    // 128K-131K
  "qwen/qwen3-next-80b-a3b-instruct:free": 262144,         // 256K nativo (→ 1M con YaRN)
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
