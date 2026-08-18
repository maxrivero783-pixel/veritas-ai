// ==============================================================================
// Véritas v2.2 — /lib/contextManager.js
// ==============================================================================
// Módulo frontend para gestión del contexto enviado al modelo. Implementa la
// "Opción C" del BUILD (Sección 1.4 y 15):
//   - Sliding window configurable (default 8 mensajes).
//   - Generación de resumen acumulativo con GLM-4.5-Flash (Puter, gratis).
//   - Tool result truncation configurable (default 2 KB).
//   - Cálculo de tokens usados/disponibles en tiempo real.
//
// v2.12b: el resumen se genera vía /api/llm/complete (Worker), sin Puter.
// ==============================================================================

import { getContextLimit, getProvider } from "./fallbackChains.js";

// ------------------------------------------------------------------------------
// Estado de settings (cargado desde users.profile_json por app.js).
// Defaults según Sección 1.4.7.
// ------------------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  contextCompression: true,    // toggle compresión (sliding window)
  recentMessages: 8,            // 4-20, default 8
  toolTruncation: true,         // toggle truncar tool results
  toolTruncationLimitKB: 2,     // 0.5-8 KB, default 2
  promptCaching: true,          // toggle OpenRouter caching
  stickyRouting: true,          // toggle session_id
  showChips: true,              // toggle chips cached_tokens
  showCounter: true,            // toggle contador en caja de texto
};

let _settings = { ...DEFAULT_SETTINGS };

export function setSettings(s) {
  _settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export function getSettings() {
  return _settings;
}

// ------------------------------------------------------------------------------
// estimateTokens(text): aproximación 4 chars/token para lenguas latinas,
// 1 char/token para CJK. (Sección 15.5)
// ------------------------------------------------------------------------------
export function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === "string" ? text : JSON.stringify(text);
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;
  const cjkCount = (str.match(cjkRegex) || []).length;
  const latinCount = str.length - cjkCount;
  return Math.ceil(latinCount / 4) + cjkCount;
}

// ------------------------------------------------------------------------------
// getContextTokens(messages): suma de tokens de todos los mensajes.
// ------------------------------------------------------------------------------
export function getContextTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((sum, msg) => {
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((b) => b.text || "").join("\n")
        : JSON.stringify(msg.content || "");
    return sum + estimateTokens(content);
  }, 0);
}

// ------------------------------------------------------------------------------
// getModelContextLimit(modelId): desde fallbackChains.
// ------------------------------------------------------------------------------
export function getModelContextLimit(modelId) {
  return getContextLimit(modelId);
}

// ------------------------------------------------------------------------------
// buildContext({ messages, currentModelId, currentUserMsg, summary, settings })
// Devuelve { context: [...messages], usedTokens, availableTokens, droppedCount }
//
// Lógica:
//   - Si !settings.contextCompression o messages.length <= N: devolver todo.
//   - Si no, dividir en [descartados] + [recientes (últimos N)].
//   - Si hay ≥4 descartados nuevos desde el último resumen, devolver flag
//     needsRegenerateSummary=true (app.js lo ejecuta con Puter).
//   - El contexto final es: [system, summaryMessage, ...recientes, currentUserMsg].
// ------------------------------------------------------------------------------
export function buildContext({ messages, currentModelId, currentUserMsg, summary, systemPrompt }) {
  const settings = _settings;
  const allMessages = messages || [];

  // Sin compresión: enviar todo.
  if (!settings.contextCompression || allMessages.length <= settings.recentMessages) {
    const context = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...allMessages,
      ...(currentUserMsg ? [currentUserMsg] : []),
    ];
    const used = getContextTokens(context);
    const limit = getModelContextLimit(currentModelId);
    return {
      context,
      usedTokens: used,
      availableTokens: Math.max(0, limit - used),
      droppedCount: 0,
      needsRegenerateSummary: false,
    };
  }

  // Con compresión: split.
  const N = settings.recentMessages;
  const droppedMessages = allMessages.slice(0, allMessages.length - N);
  const recentMessages = allMessages.slice(-N);

  // ¿Necesitamos regenerar el resumen? Si hay ≥4 descartados nuevos desde el
  // último lastSummarizedIndex.
  const lastSummarizedIndex = summary?.lastSummarizedIndex || 0;
  const newDroppedCount = droppedMessages.length - lastSummarizedIndex;
  const needsRegenerateSummary = newDroppedCount >= 4;

  const summaryMessage = summary?.text
    ? [{ role: "system", content: `Resumen del histórico de conversación hasta este punto:\n\n${summary.text}` }]
    : [];

  const context = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    ...summaryMessage,
    ...recentMessages,
    ...(currentUserMsg ? [currentUserMsg] : []),
  ];

  const used = getContextTokens(context);
  const limit = getModelContextLimit(currentModelId);
  return {
    context,
    usedTokens: used,
    availableTokens: Math.max(0, limit - used),
    droppedCount: droppedMessages.length,
    needsRegenerateSummary,
    newDroppedCount,
  };
}

// ------------------------------------------------------------------------------
// truncateToolResults(messages): aplica truncado a role="tool" según settings.
// Respeta flag full_requested (no trunca si el modelo pidió full=true).
// ------------------------------------------------------------------------------
export function truncateToolResults(messages) {
  if (!_settings.toolTruncation) return messages;
  const limitBytes = _settings.toolTruncationLimitKB * 1024;

  return messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    if (msg.full_requested) return msg;

    const content = typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content || "");

    if (content.length <= limitBytes) return msg;

    const truncated = content.slice(0, limitBytes);
    const remaining = content.length - limitBytes;
    return {
      ...msg,
      content: `${truncated}\n[... ${remaining} bytes más, pide full=true para verlos]`,
    };
  });
}

// ------------------------------------------------------------------------------
// generateSummary({ droppedMessages, previousSummary })
// Devuelve { text, lastSummarizedIndex, generatedAt }
//
// v2.12b: usa /api/llm/complete (cadena Cerebras → Cohere → OpenRouter) en vez
// del antiguo Puter.ai.chat (eliminado). Si el LLM falla, devuelve un resumen
// trivial (primeras N palabras de cada mensaje).
// ------------------------------------------------------------------------------
export async function generateSummary({ droppedMessages, previousSummary, allMessagesCount }) {
  const formatted = formatMessagesForSummary(droppedMessages);

  const prompt = previousSummary
    ? `Resumen anterior:\n${previousSummary.text}\n\nNuevos mensajes a incorporar al resumen:\n${formatted}\n\nDevuelve un resumen actualizado y conciso (máximo 500 palabras).`
    : `Genera un resumen conciso (máximo 500 palabras) de esta conversación, preservando los hechos clave, decisiones y contexto técnico:\n\n${formatted}`;

  try {
    const resp = await fetch("/api/llm/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, max_tokens: 900, system: "Eres un asistente que resume conversaciones de forma fiel y concisa. Responde solo con el resumen." }),
    });
    if (!resp.ok) throw new Error(`llm/complete HTTP ${resp.status}`);
    const data = await resp.json().catch(() => null);
    const text = ((data && data.text) || "").trim();
    if (!text) throw new Error("Respuesta vacía del LLM");

    return {
      text,
      lastSummarizedIndex: droppedMessages.length,
      generatedAt: Date.now(),
    };
  } catch (e) {
    // Fallback: resumen trivial con primeras palabras de cada mensaje.
    const fallbackText = droppedMessages
      .map((m) => `[${m.role}] ${(typeof m.content === "string" ? m.content : "").slice(0, 200)}`)
      .join("\n")
      .slice(0, 2000);
    return {
      text: `[Resumen automático no disponible (${e.message}). Contenido parcial del histórico:]\n${fallbackText}`,
      lastSummarizedIndex: droppedMessages.length,
      generatedAt: Date.now(),
      fallback: true,
    };
  }
}

function formatMessagesForSummary(messages) {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
      return `[${m.role}] ${content.slice(0, 1000)}`;
    })
    .join("\n\n");
}

// ------------------------------------------------------------------------------
// updateTokenCounter({ messages, currentModelId, currentUserMsg, summary, systemPrompt })
// Devuelve { used, available, limit, level: "ok"|"warning"|"critical" }
// ------------------------------------------------------------------------------
export function computeTokenStatus({ messages, currentModelId, currentUserMsg, summary, systemPrompt }) {
  const { usedTokens, availableTokens } = buildContext({
    messages, currentModelId, currentUserMsg, summary, systemPrompt,
  });
  let level = "ok";
  if (availableTokens < 200) level = "critical";
  else if (availableTokens < 1000) level = "warning";
  return {
    used: usedTokens,
    available: availableTokens,
    limit: getModelContextLimit(currentModelId),
    level,
  };
}

// ------------------------------------------------------------------------------
// Helper: detectar flag full=true en args de un tool_call.
// ------------------------------------------------------------------------------
export function isFullRequested(toolCallArgs) {
  if (!toolCallArgs) return false;
  return toolCallArgs.full === true || toolCallArgs.full === "true";
}

export default {
  DEFAULT_SETTINGS,
  setSettings,
  getSettings,
  estimateTokens,
  getContextTokens,
  getModelContextLimit,
  buildContext,
  truncateToolResults,
  generateSummary,
  computeTokenStatus,
  isFullRequested,
};
