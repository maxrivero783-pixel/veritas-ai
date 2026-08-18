// ==============================================================================
// Véritas v2.12 — /lib/agentOrchestrator.js
// ==============================================================================
// Orquestador del stack Nemotron para el rol "Agente".
// Expone `runAgentLoop(messages, attachments, opts)` que reemplaza a
// `callModel()` cuando state.currentRole === "agent".
//
// Lógica de decisión:
//   1. Si state.toggles.deepThinking === true → Ultra directamente
//   2. Si el mensaje contiene frases de "investigación profunda" → Ultra
//   3. Si hay attachments multimedia → Nano primero, luego Super con descripción
//   4. Por defecto → Super (ejecutor)
//   5. Si Super emite <escalate_to_ultra> → reenvío a Ultra con contexto acumulado
//   6. Si el modelo primario falla → fallback con nota de transparencia
//
// Retorna el mismo formato que callModel/callOpenRouter:
//   { text, thinking_content, tokens_in, tokens_out, cached_tokens,
//     aborted?, model_used, role_used, fallback_used? }
// ==============================================================================

// ------------------------------------------------------------------------------
// Frases que disparan escalamiento automático a Ultra.
// ------------------------------------------------------------------------------
const ULTRA_TRIGGERS = [
  "investigación profunda",
  "investigacion profunda",
  "exhaustiva",
  "analiza a fondo",
  "reconsidera",
  "deep research",
  "analyze thoroughly",
  "think step by step",
  "cadena de razonamiento",
  "reasoning chain",
  "multi-paso",
  "descomposición",
];

// ------------------------------------------------------------------------------
// detectUltraEscalation(userMessage): true si el mensaje pide reasoning profundo.
// ------------------------------------------------------------------------------
function detectUltraEscalation(userMessage) {
  const lower = (userMessage || "").toLowerCase();
  return ULTRA_TRIGGERS.some((phrase) => lower.includes(phrase));
}

// ------------------------------------------------------------------------------
// detectEscalateToUltra(assistantText): true si el modelo pide escalar.
// ------------------------------------------------------------------------------
function detectEscalateToUltra(assistantText) {
  if (!assistantText) return false;
  return /<escalate_to_ultra>[\s\S]*?<\/escalate_to_ultra>/i.test(assistantText);
}

// ------------------------------------------------------------------------------
// stripEscalateTag(text): elimina la etiqueta del texto final visible.
// ------------------------------------------------------------------------------
function stripEscalateTag(text) {
  return text.replace(/<escalate_to_ultra>[\s\S]*?<\/escalate_to_ultra>/gi, "").trim();
}

// ------------------------------------------------------------------------------
// streamSSE(resp, signal, onDelta, onThinking, onUsage):
// Parsea un SSE stream (igual patrón que callOpenRouter en app.js).
// Devuelve { text, thinking_content, tokens_in, tokens_out, cached_tokens, aborted }.
// ------------------------------------------------------------------------------
async function streamSSE(resp, signal, { onDelta, onThinking }) {
  let text = "";
  let thinkingContent = "";
  let tokens_in = 0, tokens_out = 0, cached_tokens = 0;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstToken = true;

  try {
    while (true) {
      if (signal?.aborted) {
        try { await reader.cancel(); } catch { /* best-effort */ }
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            if (firstToken && onDelta) {
              firstToken = false;
            }
            text += delta.content;
            if (onDelta) onDelta(text);
          }
          if (delta?.reasoning) {
            thinkingContent += delta.reasoning;
            if (onThinking) onThinking(thinkingContent);
          }
          if (json.usage) {
            tokens_in = json.usage.prompt_tokens || 0;
            tokens_out = json.usage.completion_tokens || 0;
            cached_tokens = json.usage.prompt_tokens_details?.cached_tokens || 0;
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch (e) {
    if (signal?.aborted || e?.name === "AbortError") {
      return { text, thinking_content: thinkingContent, tokens_in, tokens_out, cached_tokens, aborted: true };
    }
    throw e;
  }

  return { text, thinking_content: thinkingContent, tokens_in, tokens_out, cached_tokens, aborted: signal?.aborted || false };
}

// ------------------------------------------------------------------------------
// callOrchestrateEndpoint(messages, escalate, signal, opts):
// Llama a POST /api/chat/agent/orchestrate con streaming SSE.
// ------------------------------------------------------------------------------
async function callOrchestrateEndpoint(messages, escalate, signal, { chatId, onDelta, onThinking, skillsBlock, memoryBlock, modelId }) {
  const body = {
    chat_id: chatId,
    messages,
    model: modelId || null,
    escalate: escalate ? "ultra" : null,
    stream: true,
    ...(skillsBlock ? { skills_block: skillsBlock } : {}),
    ...(memoryBlock ? { memory_block: memoryBlock } : {}),
  };

  const resp = await fetch("/api/chat/agent/orchestrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (signal?.aborted) {
    return { text: "", thinking_content: "", tokens_in: 0, tokens_out: 0, cached_tokens: 0, aborted: true };
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw { error: err.error || "orchestrate_error", message: err.message || `HTTP ${resp.status}`, retry_after_ms: err.retry_after_ms };
  }

  // El header X-Veritas-Role nos dice qué modelo realmente respondió.
  const roleUsed = resp.headers.get("x-veritas-role") || null;
  const result = await streamSSE(resp, signal, { onDelta, onThinking });
  result.role_used = roleUsed;
  return result;
}

// ------------------------------------------------------------------------------
// perceiveAttachments(attachments, signal):
// Para cada attachment pendiente, llama a /api/chat/perceive.
// Devuelve array de strings con las descripciones.
// ------------------------------------------------------------------------------
async function perceiveAttachments(attachments, signal) {
  const descriptions = [];
  for (const att of attachments) {
    if (signal?.aborted) break;
    try {
      const resp = await fetch("/api/chat/perceive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attachment_r2_key: att.r2_key,
          modality: att.modality,
        }),
        signal,
      });
      if (!resp.ok) {
        descriptions.push(`[Error al percibir ${att.name}: HTTP ${resp.status}]`);
        continue;
      }
      const data = await resp.json();
      descriptions.push(
        `[Percepción de "${att.name}" (${att.modality}) — modelo: ${data.model}]:\n${data.description}`
      );
    } catch (e) {
      if (signal?.aborted) break;
      descriptions.push(`[Error al percibir ${att.name}: ${e.message}]`);
    }
  }
  return descriptions;
}

// ==============================================================================
// runAgentLoop: función principal exportada.
// ==============================================================================
/**
 * Ejecuta el loop del agente con el stack Nemotron.
 *
 * @param {Array} messages - Historial de mensajes del contexto (ya construidos por ContextManager).
 * @param {Array} attachments - Attachments pendientes [{ r2_key, modality, name }].
 * @param {object} opts
 * @param {AbortSignal} [opts.signal] - Para cancelar el streaming.
 * @param {string} [opts.chatId] - ID del chat actual.
 * @param {Function} [opts.onDelta] - Callback(text) por cada delta de contenido.
 * @param {Function} [opts.onThinking] - Callback(thinkingContent) por cada delta de reasoning.
 * @param {object} [opts.toggles] - state.toggles (deepThinking, thinking, etc.).
 * @returns {Promise<{text, thinking_content, tokens_in, tokens_out, cached_tokens, aborted?, model_used, role_used, fallback_used?}>}
 */
export async function runAgentLoop(messages, attachments, opts = {}) {
  const { signal, chatId, onDelta, onThinking, toggles = {}, skillsBlock, memoryBlock, modelId: preferredModelId } = opts;

  // --- Paso 1: Percepción de attachments (si hay) ---
  let perceptionBlock = "";
  if (attachments && attachments.length > 0) {
    const descriptions = await perceiveAttachments(attachments, signal);
    if (descriptions.length > 0) {
      perceptionBlock = "\n\n[Contenido percibido de archivos adjuntos]\n" + descriptions.join("\n\n---\n\n");
    }
    // Limpiar attachments pendientes (ya procesados).
    // Nota: el caller (app.js sendMessage) debe limpiar state.pendingAttachments.
  }

  // --- Paso 2: Decidir nivel de escalamiento ---
  const userLastMsg = messages.filter((m) => m.role === "user").pop()?.content || "";
  const deepThinkingActive = toggles.deepThinking === true;
  const autoEscalate = detectUltraEscalation(userLastMsg);
  let escalate = deepThinkingActive || autoEscalate;

  // --- Paso 3: Inyectar percepción en el último mensaje user (si hay) ---
  let finalMessages = messages;
  if (perceptionBlock) {
    finalMessages = messages.map((m, i) => {
      if (m.role === "user" && i === messages.filter((mm) => mm.role === "user").length - 1) {
        return { ...m, content: m.content + perceptionBlock };
      }
      return m;
    });
  }

  // --- Paso 4: Llamada al modelo seleccionado ---
  let result;
  let modelUsed = preferredModelId || (escalate
    ? "nvidia/nemotron-3-ultra-550b-a55b:free"
    : "nvidia/nemotron-3-super-120b-a12b:free");

  try {
    result = await callOrchestrateEndpoint(finalMessages, escalate, signal, {
      chatId,
      onDelta,
      onThinking,
      skillsBlock,
      memoryBlock,
      modelId: modelUsed,
    });
  } catch (e) {
    if (e.error === "all_keys_rate_limited" || e.error === "upstream_error" || e.error === "orchestrate_error") {
      console.warn("[agentOrchestrator] Primario falló, intentando cadena orquestada:", e.message);
      const codeFirst = toggles.codeFirst === true || /cohere|laguna/i.test(modelUsed);
      const candidates = codeFirst
        ? [
            "poolside/laguna-s-2.1:free",
            "poolside/laguna-xs-2.1:free",
            "nvidia/nemotron-3-super-120b-a12b:free",
            "google/gemma-4-31b-it:free",
            "openai/gpt-oss-20b:free",
          ]
        : [
            escalate ? "nvidia/nemotron-3-super-120b-a12b:free" : "nvidia/nemotron-3-ultra-550b-a55b:free",
            "nvidia/nemotron-3-nano-30b-a3b:free",
            "google/gemma-4-31b-it:free",
            "openai/gpt-oss-20b:free",
            "cohere/north-mini-code:free",
          ];

      let lastErr = e;
      for (const candidate of candidates.filter((m) => m && m !== modelUsed)) {
        try {
          modelUsed = candidate;
          result = await callOrchestrateEndpoint(finalMessages, candidate.includes("ultra"), signal, {
            chatId,
            onDelta,
            onThinking,
            skillsBlock,
            memoryBlock,
            modelId: candidate,
          });
          result.fallback_used = candidate;
          break;
        } catch (fallbackErr) {
          lastErr = fallbackErr;
          console.warn(`[agentOrchestrator] Fallback ${candidate} falló:`, fallbackErr.message);
        }
      }

      if (!result) {
        throw {
          error: "agent_stack_exhausted",
          message: `Pool Agente/Pensador/Code-first no disponible: ${e.message}; último fallback: ${lastErr.message}`,
          retry_after_ms: e.retry_after_ms,
        };
      }
    } else {
      throw e;
    }
  }

  if (!result) {
    throw { error: "agent_no_result", message: "El orquestador no devolvió resultado" };
  }

  // --- Paso 5: Detectar escalamiento dinámico de Super a Ultra ---
  if (!escalate && detectEscalateToUltra(result.text)) {
    const escalateReason = (result.text.match(/<escalate_to_ultra>([\s\S]*?)<\/escalate_to_ultra>/i) || [])[1] || "";
    console.log("[agentOrchestrator] Super solicita escalamiento a Ultra:", escalateReason);

    // Limpiar la etiqueta del texto.
    result.text = stripEscalateTag(result.text);

    // Acumular contexto: añadir la respuesta de Super como assistant al contexto.
    const escalatedMessages = [
      ...finalMessages,
      { role: "assistant", content: result.text + `\n[Escalando a Nemotron Ultra por: ${escalateReason.trim()}]` },
    ];

    try {
      const ultraResult = await callOrchestrateEndpoint(escalatedMessages, true, signal, {
        chatId,
        onDelta,
        onThinking,
        skillsBlock,
        memoryBlock,
        modelId: "nvidia/nemotron-3-ultra-550b-a55b:free",
      });
      // Reemplazar el resultado con el de Ultra.
      ultraResult.text = result.text + "\n\n" + ultraResult.text;
      ultraResult.tokens_in += result.tokens_in;
      ultraResult.tokens_out += result.tokens_out;
      ultraResult.cached_tokens += result.cached_tokens;
      ultraResult.escalated = true;
      result = ultraResult;
      modelUsed = "nvidia/nemotron-3-ultra-550b-a55b:free";
    } catch (ultraErr) {
      console.warn("[agentOrchestrator] Escalamiento a Ultra falló, usando respuesta de Super:", ultraErr.message);
      // Mantener la respuesta de Super; no es fatal.
    }
  }

  // --- Paso 6: Separar razonamiento embebido (igual que callOpenRouter) ---
  if (result.text) {
    const thinkMatch = result.text.match(/<razonamiento_interno>([\s\S]*?)<\/razonamiento_interno>/);
    if (thinkMatch) {
      if (!result.thinking_content) result.thinking_content = thinkMatch[1].trim();
      result.text = result.text.replace(/<razonamiento_interno>[\s\S]*?<\/razonamiento_interno>/, "").trim();
    }
  }

  // --- Paso 7: Añadir metadatos ---
  result.model_used = modelUsed;
  result.role_used = result.role_used || (escalate ? "ultra_orchestrator" : "super_executor");

  // Actualizar cached total.
  if (result.cached_tokens > 0) {
    // Importado dinámicamente para evitar circular dependency.
    // El caller (app.js) se encarga de esto.
  }

  return result;
}

// ==============================================================================
// Export default
// ==============================================================================
export default {
  runAgentLoop,
  detectUltraEscalation,
  perceiveAttachments,
};