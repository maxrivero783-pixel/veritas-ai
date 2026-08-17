// ==============================================================================
// Véritas v2.4 — /app.js
// ==============================================================================
// Cerebro del frontend. Orquesta TODO:
//   - Inicialización: i18n, fallback chains, tool registry, sandbox templates.
//   - Sidebar: submenús, nuevo/renombrar/borrar chat, abrir repo/ajustes.
//   - Canvas 2D: animación de la entidad cybernetic (idle/active/processing).
//   - Chat: enviar mensaje (Puter u OpenRouter según modelo), parser SSE,
//     parser <tool_call> XML, parser <razonamiento_interno>, indicadores.
//   - Tool Caller loop (máx 5 iter), ejecución vía /api/tool/invoke,
//     persistencia de cada iteración en D1.
//   - Sandbox: parsing <file path="...">, árbol, CodeMirror, live preview
//     con throttle 300ms, resolución de imports multi-archivo, CSP del iframe,
//     console+network capture, botones (descargar/copiar/ver navegador/export
//     ZIP/push GitHub).
//   - Ajustes: gestión de perfil, personalización, idioma, mapas, conexiones
//     externas, optimización de tokens, sesión compartida, notificaciones push,
//     modo offline, chats.
//   - Sesión compartida: invitar, join, heartbeat, polling, turnos, escribiendo.
//   - Notificaciones: integración con NotificationManager.
//   - Modo offline: detección, cache, cola pendientes, banner.
//   - Contador de tokens: cálculo en tiempo real, debounce 300ms, colores.
//   - Chips de tokens ahorrados: tras cada respuesta.
//   - Dashboard: semáforos de modelos y APIs, panel del rotador de claves.
// ==============================================================================

import { t, applyI18n, detectInitialLang, getCurrentLang, formatDate } from "./lib/i18n.js";
import { FALLBACK_CHAINS, MODEL_PROVIDER, getNextFallback, isFallbackExhausted, getProvider, getContextLimit, getRoleForModel } from "./lib/fallbackChains.js";
import { TOOL_REGISTRY, isAllowed, parseToolCallXML, parseFallbackToVenice, stripFallbackToVenice, buildToolResultXML, escapeXML, fetchAndHydrate, getTool } from "./lib/toolRegistry.js";
import * as ContextManager from "./lib/contextManager.js";
import { runAgentLoop } from "./lib/agentOrchestrator.js";
import { SharedSessionManager, createShare, revokeShare, joinSession, isRoleShareable } from "./lib/sharedSession.js";
import { getNotificationManager } from "./lib/notifications.js";
import { getOfflineCacheManager } from "./lib/offlineCache.js";
import { getTemplate, listTemplates } from "./lib/sandboxTemplates.js";
import { SKILLS, SKILLS_CATEGORIES, getAllSkills, getActiveSkills, buildSkillsPromptBlock, loadSkillMdContent, loadCustomSkills, mergeCustomSkill, removeCustomSkill, getSkillsForRole } from "./lib/skillsRegistry.js";
import { SYSTEM_PROMPTS, UI_ROLE_TO_PROMPT_KEY } from "./prompts.js";

// ==============================================================================
// ESTADO GLOBAL
// ==============================================================================
const state = {
  user_email: null,
  currentChat: null,           // { id, category, title, is_shared, user_email }
  currentCategory: "agent",    // agent | coder | general
  currentModel: null,
  currentRole: null,
  messages: [],                // array de mensajes del chat actual (en memoria)
  chatSummary: null,           // { text, lastSummarizedIndex, generatedAt }
  chatCachedTotal: 0,          // acumulado de cached_tokens en este chat
  sharedSession: null,         // instancia de SharedSessionManager
  settings: {
    ui_lang: null,
    profile: { name: "", bio: "", prefLang: "auto" },
    personalization: { theme: "dark", readMode: false, persist: true, animations: true },
    maps: { apiKey: "", provider: "maptiler" },
    tokens: { ...ContextManager.DEFAULT_SETTINGS },
    shared: { enable: true, turnDuration: 30, inviteNotif: true },
    notifications: { enabled: false, events: {} },
    offline: { enable: true },
    chats: { autoTitle: true },
    skills: { enabled: [] }, // IDs de skills activas
    fallbackMode: "manual", // manual | automatic
  },
  sandbox: {
    files: {}, // { path: content }
    activeFile: null,
    editor: null,
    previewThrottleTimer: null,
    previewUrl: null,
    consoleEntries: [],
    networkEntries: [],
    testEntries: [],
    snapshots: [],
    lastError: null,
  },
  toggles: { search: false, scrape: false, thinking: false, deepThinking: false, codeFirst: false },
  streamingState: "idle", // idle | processing | thinking
  isOffline: false,
  pendingChatFlush: false,
  abortController: null,  // P0-4: AbortController para cancelar streaming en curso
  chatSearchQuery: "",    // P1-4: filtro activo del buscador de chats (solo título)
  pendingAttachments: [], // ETAPA 5: attachments multimedia pendientes [{ file, r2_key, modality, name, size }]
  repoDocAttachments: [], // Docs del repo adjuntados como contexto [{ doc_number, doc_name, file_size }]
};

// ==============================================================================
// HELPERS DOM
// ==============================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }
function toast(message, type = "info", durationMs = 3000) {
  const container = $("#toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

function setUserEmail() {
  // El Worker valida el header cf-access-user-email; el frontend no lo lee
  // directamente (está en el lado server). Hacemos fetch a /api/status para
  // inferir que estamos autenticados. El email real se obtiene del primer
  // /api/db/message o del perfil.
}

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
async function init() {
  console.log("[Véritas] Inicializando v2.4...");

  // Idioma inicial.
  const initialLang = state.settings.ui_lang || detectInitialLang();
  applyI18n(initialLang);
  $$(`.lang-btn[data-lang="${initialLang}"]`).forEach((b) => b.classList.add("active"));

  // v2.5: tema, UI nueva y comprobación de sesión (email+contraseña).
  setupV25UI();
  const authed = await ensureAuth();
  if (!authed) return;

  // Hidratar tool registry desde el server.
  await fetchAndHydrate();

  // Cargar settings desde el server (users.profile_json).
  await loadSettings();

  // Aplicar settings a submódulos.
  ContextManager.setSettings(state.settings.tokens);
  getNotificationManager().setSettings(state.settings.notifications);

  // Inicializar offline cache.
  const offline = getOfflineCacheManager();
  offline.addEventListener("offline:online", () => {
    state.isOffline = false;
    if (state.streamingState === "offline") setEntityState("idle");
    document.body.classList.remove("is-offline");
    hide($("#offlineBanner"));
    toast(t("toast.connectionRestored"), "success");
  });
  offline.addEventListener("offline:offline", () => {
    state.isOffline = true;
    setEntityState("offline");
    document.body.classList.add("is-offline");
    show($("#offlineBanner"));
    toast(t("toast.connectionLost"), "warning");
  });
  offline.addEventListener("offline:synced", (e) => {
    updateOfflineSyncInfo(e.detail.ts, e.detail.size);
  });
  await offline.init();
  if (state.settings.offline.enable) await offline.syncBundle();

  // Cargar lista de chats del submenú activo.
  await loadChatList();

  // Setup Canvas 2D animation.
  initEntityCanvas();

  // Setup event listeners.
  setupEventListeners();
  updateDeepThinkingVisibility();

  // Setup settings UI.
  setupSettingsUI();

  // Cargar conexiones OAuth.
  await loadConnections();

  // Cargar dashboard.
  await loadDashboard();

  // Detección inicial de online/offline.
  if (!navigator.onLine) {
    state.isOffline = true;
    setEntityState("offline");
    setEntityState("offline");
    document.body.classList.add("is-offline");
    show($("#offlineBanner"));
  }

  // Notificaciones: hook para que sharedSession pueda dispararlas.
  window.addEventListener("shared:event", (e) => {
    const { type, payload } = e.detail;
    getNotificationManager().notify(type, payload, { userTyping: isUserTyping() });
  });

  console.log("[Véritas] Listo.");
}

// ==============================================================================
// CANVAS 2D — Entidad cybernetic (Sección 5 del BUILD)
// ==============================================================================
// Estados:
//   idle       → Punto luminoso distante (estrella), parpadeo lento cada ~3s.
//   active     → Orbe + partículas erráticas (Browniano) orbitando.
//   processing → Partículas aceleran, anillos giratorios concéntricos, orbe glow pulsante.
// Transiciones orgánicas con easeInOutCubic. Al completar respuesta, vuelve a
// erráticas y el glow desvanece en ~800ms.
// prefers-reduced-motion: desactivar partículas, dejar solo orbe estático.
// ==============================================================================

// Easing easeInOutCubic: transición orgánica entre estados.
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Mapeo de estados a nivel numérico para interpolar.
const STATE_LEVEL = { idle: 0, listening: 0.35, offline: 0.2, active: 1, searching: 1.35, tooling: 1.45, coding: 1.55, thinking: 1.75, processing: 2, error: 2 };

function entityPalette(mode) {
  const palettes = {
    idle:      { primary: [80, 200, 120], secondary: [0, 212, 255], bg: [10, 14, 26], fade: 0.18 },
    listening: { primary: [0, 212, 255], secondary: [80, 200, 120], bg: [10, 18, 32], fade: 0.16 },
    active:    { primary: [0, 212, 255], secondary: [80, 200, 120], bg: [10, 14, 26], fade: 0.18 },
    searching: { primary: [0, 150, 255], secondary: [0, 212, 255], bg: [6, 20, 38], fade: 0.14 },
    tooling:   { primary: [167, 139, 250], secondary: [0, 212, 255], bg: [18, 12, 38], fade: 0.14 },
    coding:    { primary: [0, 240, 255], secondary: [80, 200, 120], bg: [5, 18, 30], fade: 0.12 },
    thinking:  { primary: [255, 211, 105], secondary: [80, 200, 120], bg: [24, 18, 8], fade: 0.12 },
    processing:{ primary: [80, 200, 120], secondary: [255, 211, 105], bg: [10, 14, 26], fade: 0.13 },
    error:     { primary: [255, 92, 122], secondary: [255, 179, 71], bg: [34, 8, 18], fade: 0.10 },
    offline:   { primary: [120, 130, 145], secondary: [60, 75, 95], bg: [8, 10, 16], fade: 0.22 },
  };
  return palettes[mode] || palettes.active;
}

function rgb(arr, alpha = 1) { return `rgba(${arr[0]}, ${arr[1]}, ${arr[2]}, ${alpha})`; }

function initEntityCanvas() {
  const canvas = $("#entityCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let W = canvas.width, H = canvas.height;
  let cx = W / 2, cy = H / 2;

  // --- 28 partículas orbitales ---
  const particles = [];
  const NUM_PARTICLES = 28;
  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push({
      angle: Math.random() * Math.PI * 2,
      radius: 28 + Math.random() * 38,
      speed: 0.003 + Math.random() * 0.009,
      size: 0.6 + Math.random() * 1.6,
      opacity: 0.18 + Math.random() * 0.45,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  // --- 6 tentáculos neuronales ---
  const tentacles = [];
  const NUM_TENTACLES = 6;
  const TENT_SEGS = 5;
  for (let i = 0; i < NUM_TENTACLES; i++) {
    tentacles.push({
      angle: (i / NUM_TENTACLES) * Math.PI * 2,
      length: 36 + Math.random() * 24,
      phase: Math.random() * Math.PI * 2,
    });
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // State machine con transición suave.
  let _displayedLevel = 0;
  let _targetLevel = 0;
  let _glowFade = 0;
  const TRANSITION_SPEED = 0.0035;
  const GLOW_FADE_DURATION_MS = 800;

  state._canvasTarget = (lvl) => { _targetLevel = lvl; };
  state._canvasTriggerGlowFade = () => { _glowFade = 1; };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // Tamaño lógico (CSS pixels).
    const targetW = Math.max(120, rect.width);
    const targetH = Math.max(90, rect.height);
    W = targetW; H = targetH;
    cx = W / 2; cy = H / 2;
    // Backing store físico.
    canvas.width = Math.round(targetW * dpr);
    canvas.height = Math.round(targetH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("veritas:resize", resize);
  window.addEventListener("resize", resize);
  setTimeout(resize, 50);

  function draw(timestamp) {
    const mode = state.streamingState || "idle";
    const palette = entityPalette(mode);

    // Transición de nivel.
    const diff = _targetLevel - _displayedLevel;
    if (Math.abs(diff) > 0.001) {
      const step = TRANSITION_SPEED * 16;
      _displayedLevel += Math.sign(diff) * Math.min(Math.abs(diff), step);
    } else {
      _displayedLevel = _targetLevel;
    }
    if (_glowFade > 0) {
      _glowFade = Math.max(0, _glowFade - (16 / GLOW_FADE_DURATION_MS));
    }

    const lvl = _displayedLevel;
    const idleWeight = Math.max(0, 1 - lvl);
    const activeWeight = Math.max(0, Math.min(1, lvl));
    const processingWeight = Math.max(0, lvl - 1);

    // Limpiar con fade (en píxeles físicos vía setTransform identidad).
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgb(palette.bg, palette.fade);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    // --- Estrella de origen (punto lejano) ---
    // En idle: una estrella lejana, pequeña y con parpadeo, que sugiere un
    // punto de señal distante. Conforme sube la actividad, la estrella
    // "crece" y se convierte en el núcleo/orbe central (efecto de zoom).
    const blinkPhase = (Math.sin(timestamp / 3000 * Math.PI * 2) + 1) / 2;
    const idleOpacity = 0.35 + 0.65 * blinkPhase;
    // Profundidad: en idle la estrella está lejos (radio 1.2); en active se acerca.
    const depth = 0.4 + activeWeight * 0.6 + processingWeight * 0.3; // 0.4 → 1.3
    const starR = (1.2 + idleWeight * 0.4) * depth;
    // Pequeño desplazamiento para sugerir un punto lejano en el cielo.
    const starX = cx;
    const starY = cy;

    if (idleWeight > 0.01 || activeWeight > 0.01) {
      // Halo de la estrella.
      const haloR = starR * (8 + processingWeight * 6);
      const haloGrad = ctx.createRadialGradient(starX, starY, 0, starX, starY, haloR);
      const coreAlpha = Math.max(idleWeight * idleOpacity * 0.5, activeWeight * 0.4);
      haloGrad.addColorStop(0, rgb(palette.primary, coreAlpha));
      haloGrad.addColorStop(0.5, rgb(palette.secondary, 0.1 * (activeWeight + processingWeight)));
      haloGrad.addColorStop(1, rgb(palette.primary, 0));
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(starX, starY, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Cruz de estrella sutil (solo en idle).
      if (idleWeight > 0.4 && blinkPhase > 0.55) {
        const flare = (blinkPhase - 0.55) * 2.2 * idleWeight;
        ctx.strokeStyle = rgb(palette.primary, flare * 0.4);
        ctx.lineWidth = 0.7;
        const fLen = starR * 6;
        ctx.beginPath();
        ctx.moveTo(starX - fLen, starY); ctx.lineTo(starX + fLen, starY);
        ctx.moveTo(starX, starY - fLen); ctx.lineTo(starX, starY + fLen);
        ctx.stroke();
      }

      // Núcleo.
      const pulseScale = processingWeight > 0 ? 1 + 0.18 * Math.sin(timestamp / 200) : 1;
      const coreR = Math.max(0.6, starR * pulseScale);
      ctx.fillStyle = rgb(palette.primary, Math.max(0.3, activeWeight + processingWeight * 0.8 + idleWeight * idleOpacity * 0.5));
      ctx.beginPath();
      ctx.arc(starX, starY, coreR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (reducedMotion) { requestAnimationFrame(draw); return; }

    // --- Tentáculos neuronales ---
    // Se dibujan desde el centro hacia afuera como cadenas de segmentos
    // que se curvan con el tiempo. En idle son sutiles; en processing
    // se intensifican y laten.
    const tentIntensity = 0.25 + activeWeight * 0.4 + processingWeight * 0.6;
    ctx.lineCap = "round";
    tentacles.forEach((t) => {
      const baseAngle = t.angle + (activeWeight * 0.2 + processingWeight * 0.5) *
        Math.sin(timestamp / 1400 + t.phase);
      const segLen = (t.length / TENT_SEGS) * (1 + processingWeight * 0.15 * Math.sin(timestamp / 600 + t.phase));
      let px = cx, py = cy;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let s = 0; s < TENT_SEGS; s++) {
        const wob = Math.sin(timestamp / 700 + t.phase + s * 0.7) *
          (3 + s * 2.2) * (0.4 + activeWeight * 0.6 + processingWeight * 0.8);
        const radial = baseAngle + (s / TENT_SEGS) * 0.9 * wob * 0.04 + wob * 0.015;
        const nx = px + Math.cos(radial) * segLen;
        const ny = py + Math.sin(radial) * segLen;
        ctx.lineTo(nx, ny);
        px = nx; py = ny;
      }
      const alpha = tentIntensity * (0.35 + 0.15 * Math.sin(timestamp / 800 + t.phase));
      ctx.strokeStyle = rgb(palette.secondary, alpha);
      ctx.lineWidth = 0.8 + processingWeight * 0.6;
      ctx.stroke();

      // Nodo en la punta.
      ctx.fillStyle = rgb(palette.primary, alpha * 1.2);
      ctx.beginPath();
      ctx.arc(px, py, 1.2 + processingWeight * 0.8, 0, Math.PI * 2);
      ctx.fill();
    });

    // --- Partículas orbitales ---
    const orbitScale = 0.6 + activeWeight * 0.4 + processingWeight * 0.3;
    particles.forEach((p) => {
      const speedMul = 1 + processingWeight * 3.2 + activeWeight * 0.6;
      p.angle += p.speed * speedMul;
      if (activeWeight > 0.3 && processingWeight < 0.3) {
        p.angle += (Math.random() - 0.5) * 0.04 * activeWeight;
      }
      const baseRadius = p.radius * orbitScale;
      const ringMod = processingWeight > 0
        ? Math.sin(timestamp / 500 + p.angle) * 10 * processingWeight
        : Math.sin(timestamp / 1800 + p.wobble) * 2 * idleWeight;
      const r = baseRadius + ringMod;
      const x = cx + Math.cos(p.angle) * r;
      const y = cy + Math.sin(p.angle) * r;

      const cyanComp = activeWeight * (1 - processingWeight);
      const greenComp = processingWeight;
      const idleComp = idleWeight;
      const alpha = (cyanComp * 0.55 + greenComp * 0.95 + idleComp * 0.25) * p.opacity;

      if (alpha > 0.02) {
        const r_col = Math.round(
          palette.secondary[0] * cyanComp +
          palette.primary[0] * Math.max(greenComp, idleComp * 0.5)
        );
        const g_col = Math.round(
          palette.secondary[1] * cyanComp +
          palette.primary[1] * Math.max(greenComp, idleComp * 0.5)
        );
        const b_col = Math.round(
          palette.secondary[2] * cyanComp +
          palette.primary[2] * Math.max(greenComp, idleComp * 0.5)
        );
        ctx.fillStyle = `rgba(${r_col}, ${g_col}, ${b_col}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, p.size * (0.8 + processingWeight * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    requestAnimationFrame(draw);
  }

  state.streamingState = "idle";
  const ind = $("#entityStateIndicator");
  if (ind) ind.dataset.state = "idle";
  requestAnimationFrame(draw);
}

function setEntityState(s) {
  const prev = state.streamingState;
  state.streamingState = s;
  const ind = $("#entityStateIndicator");
  if (ind) ind.dataset.state = s;

  // Actualizar nivel objetivo del canvas para transición suave.
  if (state._canvasTarget) {
    state._canvasTarget(STATE_LEVEL[s] ?? 0);
  }

  // Si salimos de processing → activar glow fade de 800ms.
  if ((prev === "processing" || prev === "tooling" || prev === "searching" || prev === "coding" || prev === "thinking") && s !== prev && state._canvasTriggerGlowFade) {
    state._canvasTriggerGlowFade();
  }
  if (s === "error") {
    setTimeout(() => { if (state.streamingState === "error") setEntityState(state.isOffline ? "offline" : "active"); }, 1400);
  }
}

// ==============================================================================
// P0-4 — Stop streaming (AbortController + toggle Send/Stop button)
// ==============================================================================

// setStreamingMode(true) durante streaming: oculta Send, muestra Stop.
// setStreamingMode(false) al terminar: restaura Send, oculta Stop.
function setStreamingMode(isStreaming) {
  const sendBtn = $("#sendBtn");
  const stopBtn = $("#stopBtn");
  if (!sendBtn || !stopBtn) return;
  sendBtn.hidden = isStreaming;
  stopBtn.hidden = !isStreaming;
}

// stopStreaming(): aborta el AbortController actual. El catch de callPuter/
// callOpenRouter devuelve { aborted: true } y runChatWithTools lo maneja.
function stopStreaming() {
  if (state.abortController) {
    state.abortController.abort();
    // No null aquí — el finally de callPuter/callOpenRouter lo limpia.
  }
  hideStreamingIndicator();
  // No llamamos setStreamingMode(false) aquí; lo hace runChatWithTools al
  // recibir response.aborted. Así evitamos flicker si el abort tarda un frame.
}

// ==============================================================================
// EVENT LISTENERS
// ==============================================================================
function setupEventListeners() {
  // Submenús de chat.
  $$(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".nav-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.currentCategory = tab.dataset.category;
      // P1-extra: actualizar modelo por defecto de la categoría y re-renderizar
      // welcome si no hay chat abierto (para refrescar las tarjetas).
      if (!state.currentChat) {
        state.currentModel = getDefaultModelForCategory(state.currentCategory);
        state.currentRole = resolveUiRoleForCurrentSelection(state.currentModel);
        populateModelSelector();
        renderEmptyState();
        updateDeepThinkingVisibility();
      }
      loadChatList();
    });
  });

  // P1-4: Buscador de chats (solo por título).
  const searchInput = $("#chatSearchInput");
  const searchClear = $("#chatSearchClear");
  if (searchInput) {
    // Debounce 200ms para no recargar la lista en cada tecla.
    const debouncedSearch = debounce((value) => {
      state.chatSearchQuery = value;
      if (searchClear) searchClear.hidden = !value;
      loadChatList();
    }, 200);
    searchInput.addEventListener("input", (e) => debouncedSearch(e.target.value));
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = "";
        searchInput.focus();
      }
      state.chatSearchQuery = "";
      searchClear.hidden = true;
      loadChatList();
    });
  }

  // Nuevo chat.
  $("#newChatBtn")?.addEventListener("click", () => createNewChat());

  // Abrir repo: navegar al tab de repo en Settings.
  $("#openRepoBtn")?.addEventListener("click", () => {
    _repoOffset = 0;
    _repoSearchTerm = "";
    const searchInput = $("#repoSearchInput");
    if (searchInput) searchInput.value = "";
    // Activar tab repo en settings.
    $$(".settings-tab").forEach((t) => t.classList.remove("active"));
    const repoTab = document.querySelector('.settings-tab[data-section="repo"]');
    if (repoTab) repoTab.classList.add("active");
    $$(".settings-section").forEach((s) => hide(s));
    show($("#settings-repo"));
    show($("#settingsModal"));
    loadRepoList();
  });

  // Abrir ajustes.
  $("#openSettingsBtn")?.addEventListener("click", () => show($("#settingsModal")));

  // Cerrar modales.
  $("#closeSettings")?.addEventListener("click", () => hide($("#settingsModal")));
  $("#closeInvite")?.addEventListener("click", () => hide($("#inviteModal")));

  // Click fuera del modal lo cierra.
  $$(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) hide(overlay);
    });
  });

  // Settings tabs.
  $$(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".settings-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      $$(".settings-section").forEach((s) => hide(s));
      show($(`#settings-${tab.dataset.section}`));
    });
  });

  // Idioma.
  $$(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;
      applyI18n(lang);
      state.settings.ui_lang = lang;
      $$(".lang-btn").forEach((b) => b.classList.toggle("active", b === btn));
      saveSettings();
    });
  });

  // Input de mensaje.
  const input = $("#messageInput");
  input?.addEventListener("input", () => {
    if (!state.isOffline && state.streamingState === "idle" && input.value.trim()) setEntityState("listening");
    autoResize(input);
    debouncedUpdateTokenCounter();
    if (state.sharedSession) state.sharedSession.setTyping(true);
  });
  input?.addEventListener("blur", () => {
    if (!state.isOffline && state.streamingState === "listening") setEntityState("idle");
    if (state.sharedSession) state.sharedSession.setTyping(false);
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  initMessageActions();

  // Send button.
  $("#sendBtn")?.addEventListener("click", () => sendMessage());
  // P0-4: Stop button — aborta el streaming en curso.
  $("#stopBtn")?.addEventListener("click", () => stopStreaming());

  // Toggles (search/scrape/thinking).
  // v2.8: Búsqueda + Scraping unificados en un único toggle 🔎.
  $("#searchToggle")?.addEventListener("click", () => {
    toggleButton("search");
    state.toggles.scrape = state.toggles.search;
  });

  // Deep Thinking toggle (solo visible cuando rol === "agent").
  $("#deepThinkingBtn")?.addEventListener("click", () => {
    state.toggles.deepThinking = !state.toggles.deepThinking;
    if (state.currentCategory === "agent" && state.toggles.deepThinking) {
      state.currentModel = "nvidia/nemotron-3-ultra-550b-a55b:free";
      state.currentRole = resolveUiRoleForCurrentSelection(state.currentModel);
      populateModelSelector();
      renderChatHeader();
      setEntityState("thinking");
    }
    const btn = $("#deepThinkingBtn");
    btn.classList.toggle("active", state.toggles.deepThinking);
    btn.setAttribute("aria-pressed", String(state.toggles.deepThinking));
    toast(state.toggles.deepThinking ? "Pensador activado (Nemotron Ultra)" : "Pensador desactivado", "info", 2000);
  });

  // Model selector.
  $("#modelSelector")?.addEventListener("change", (e) => {
    state.currentModel = e.target.value;
    state.currentRole = resolveUiRoleForCurrentSelection(state.currentModel);
    updateTokenCounter();
    updateInviteButtonVisibility();
  });

  // Attach file.
  $("#attachBtn")?.addEventListener("click", () => $("#fileInput").click());
  $("#fileInput")?.addEventListener("change", handleFileAttach);

  // Sandbox buttons.
  $("#sbNew")?.addEventListener("click", () => clearSandbox());
  $("#sbTemplatesBtn")?.addEventListener("click", () => toggleDropdown("#sbTemplatesMenu"));
  $("#sbLibrariesBtn")?.addEventListener("click", () => toggleDropdown("#sbLibrariesMenu"));
  $("#sbSnapshot")?.addEventListener("click", () => createSandboxSnapshot("manual"));
  $("#sbRestore")?.addEventListener("click", () => restoreSandboxSnapshot());
  $("#sbDiff")?.addEventListener("click", () => showSandboxDiff());
  $("#sbRunTests")?.addEventListener("click", () => runSandboxTests());
  $("#sbExportZip")?.addEventListener("click", () => exportZip());
  $("#sbDownload")?.addEventListener("click", () => downloadActiveFile());
  $("#sbCopy")?.addEventListener("click", () => copyActiveFile());
  $("#sbOpenBrowser")?.addEventListener("click", () => openInBrowser());
  $("#sbPushGithub")?.addEventListener("click", () => pushToGithub());
  $("#sbCollapse")?.addEventListener("click", () => toggleSandbox());
  $("#sbRefresh")?.addEventListener("click", () => refreshPreview());
  $("#sbFixWithCoder")?.addEventListener("click", () => repairSandboxWithCoder());
  $("#sbDismissError")?.addEventListener("click", () => hide($("#sandboxErrorOverlay")));
  $("#sbClosePanel")?.addEventListener("click", () => hide($("#sandboxBottomPanel")));
  $$("#sandboxBottomPanel .panel-tab[data-panel]").forEach((btn) => {
    btn.addEventListener("click", () => showSandboxPanel(btn.dataset.panel));
  });
  window.addEventListener("message", handleSandboxMessage);

  // Templates dropdown items.
  $$("#sbTemplatesMenu button").forEach((btn) => {
    btn.addEventListener("click", () => {
      loadTemplate(btn.dataset.template);
      hide($("#sbTemplatesMenu"));
    });
  });

  // Libraries dropdown items.
  $$("#sbLibrariesMenu button").forEach((btn) => {
    btn.addEventListener("click", () => {
      addLibrary(btn.dataset.lib);
      hide($("#sbLibrariesMenu"));
    });
  });

  // Repo upload + search (dentro de Settings).
  const dropZone = $("#repoUploadZone");
  $("#repoFileInput")?.addEventListener("change", (e) => {
    if (e.target.files.length > 0) handleRepoFilesUpload(e.target.files);
  });
  $("#repoSearchInput")?.addEventListener("input", onRepoSearchInput);
  dropZone?.addEventListener("click", () => $("#repoFileInput").click());
  dropZone?.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragover");
    if (e.dataTransfer.files.length > 0) handleRepoFilesUpload(e.dataTransfer.files);
  });

  // Repo attach popover (adjuntar docs del repo al chat).
  $("#repoAttachBtn")?.addEventListener("click", toggleRepoAttachPopover);
  $("#repoAttachClose")?.addEventListener("click", () => { $("#repoAttachPopover").hidden = true; });
  $("#repoAttachConfirm")?.addEventListener("click", confirmRepoAttach);
  $("#repoAttachSearch")?.addEventListener("input", (e) => loadRepoAttachList(e.target.value.trim()));
  // Cerrar popover al click fuera.
  document.addEventListener("click", (e) => {
    const popover = $("#repoAttachPopover");
    const btn = $("#repoAttachBtn");
    if (popover && !popover.hidden && !popover.contains(e.target) && !btn?.contains(e.target)) {
      popover.hidden = true;
    }
  });

  // Conexiones OAuth.
  $("#connectGithub")?.addEventListener("click", () => connectOAuth("github"));
  $("#disconnectGithub")?.addEventListener("click", () => disconnectOAuth("github"));

  // Settings saves.
  $("#saveProfile")?.addEventListener("click", saveProfile);
  $("#saveMaps")?.addEventListener("click", saveMaps);

  // Settings toggles.
  $("#themeSelect")?.addEventListener("change", (e) => {
    document.documentElement.dataset.theme = e.target.value;
    state.settings.personalization.theme = e.target.value;
    saveSettings();
  });
  $("#readModeToggle")?.addEventListener("change", (e) => {
    document.body.classList.toggle("read-mode", e.target.checked);
    state.settings.personalization.readMode = e.target.checked;
    saveSettings();
  });
  $("#animationsToggle")?.addEventListener("change", (e) => {
    state.settings.personalization.animations = e.target.checked;
    saveSettings();
  });
  $("#persistToggle")?.addEventListener("change", (e) => {
    state.settings.personalization.persist = e.target.checked;
    saveSettings();
  });
  $("#purgeBtn")?.addEventListener("click", async () => {
    if (await showConfirm("¿Purgar TODOS los datos? Esta acción es irreversible.", { title: "Purgar datos", danger: true, okLabel: "Purgar" })) {
      localStorage.clear();
      indexedDB.deleteDatabase("veritas_offline");
      location.reload();
    }
  });

  // Optimización de tokens toggles.
  ["optCompress", "optTruncate", "optCaching", "optSticky", "optChips", "optCounter"].forEach((id) => {
    $(`#${id}`)?.addEventListener("change", (e) => {
      const key = id.replace("opt", "").charAt(0).toLowerCase() + id.replace("opt", "").slice(1);
      state.settings.tokens[key] = e.target.checked;
      ContextManager.setSettings(state.settings.tokens);
      saveSettings();
    });
  });
  $("#optRecent")?.addEventListener("input", (e) => {
    $("#optRecentVal").textContent = e.target.value;
    state.settings.tokens.recentMessages = Number(e.target.value);
    ContextManager.setSettings(state.settings.tokens);
    saveSettings();
  });
  $("#optTruncLimit")?.addEventListener("input", (e) => {
    $("#optTruncVal").textContent = e.target.value;
    state.settings.tokens.toolTruncationLimitKB = Number(e.target.value);
    ContextManager.setSettings(state.settings.tokens);
    saveSettings();
  });

  // Notificaciones.
  $("#notifMaster")?.addEventListener("change", async (e) => {
    if (e.target.checked) {
      const r = await getNotificationManager().requestPermission();
      if (r.ok) {
        state.settings.notifications.enabled = true;
        toast(t("settings.notifications.granted"), "success");
      } else if (r.reason === "denied") {
        toast(t("settings.notifications.denied"), "warning", 5000);
        e.target.checked = false;
      } else if (r.reason === "unsupported") {
        toast(t("settings.notifications.unsupported"), "error");
        e.target.checked = false;
      }
    } else {
      state.settings.notifications.enabled = false;
    }
    getNotificationManager().setSettings(state.settings.notifications);
    saveSettings();
  });
  ["notifModelDone", "notifTurn", "notifNewMsg", "notifToolDone"].forEach((id, idx) => {
    const eventMap = ["model_response", "shared_turn_acquired", "shared_new_message", "tool_completed"];
    $(`#${id}`)?.addEventListener("change", (e) => {
      state.settings.notifications.events[eventMap[idx]] = e.target.checked;
      getNotificationManager().setSettings(state.settings.notifications);
      saveSettings();
    });
  });

  // Offline.
  $("#offlineEnable")?.addEventListener("change", (e) => {
    state.settings.offline.enable = e.target.checked;
    saveSettings();
  });
  $("#offlineSyncNow")?.addEventListener("click", async () => {
    await getOfflineCacheManager().syncBundle();
    toast(t("toast.saved"), "success");
  });
  $("#offlinePurge")?.addEventListener("click", async () => {
    if (await showConfirm("¿Purgar cache local?", { title: "Purgar caché", danger: true, okLabel: "Purgar" })) {
      await getOfflineCacheManager().purge();
      updateOfflineSyncInfo(0, 0);
    }
  });

  // Chats.
  $("#chatsAutoTitle")?.addEventListener("change", (e) => {
    state.settings.chats.autoTitle = e.target.checked;
    saveSettings();
  });

  // Shared session.
  $("#sharedEnable")?.addEventListener("change", (e) => {
    state.settings.shared.enable = e.target.checked;
    saveSettings();
  });
  $("#sharedTurnDuration")?.addEventListener("input", (e) => {
    $("#sharedTurnVal").textContent = e.target.value;
    state.settings.shared.turnDuration = Number(e.target.value);
    saveSettings();
  });

  // Invite.
  $("#inviteBtn")?.addEventListener("click", () => show($("#inviteModal")));
  $("#generateShareLink")?.addEventListener("click", generateShareLink);
  $("#copyShareLink")?.addEventListener("click", copyShareLink);
  $("#revokeShareLink")?.addEventListener("click", revokeShareLink);
  $("#sharedLeaveBtn")?.addEventListener("click", () => state.sharedSession?.leave());
  $("#sharedCloseBtn")?.addEventListener("click", () => state.sharedSession?.closeSession());

  // Detectar URL de join (?token=...).
  detectSharedJoinFromURL();

  // i18n change event: re-render contenido dinámico.
  document.addEventListener("veritas:i18n-changed", () => {
    if (state.currentChat) renderChatHeader();
    if (state.messages.length === 0) renderEmptyState();
  });

  // Mobile menu toggle.
  $("#menuToggle")?.addEventListener("click", () => {
    $(".app-layout").classList.toggle("mobile-sidebar-open");
  });
  $("#sandboxToggle")?.addEventListener("click", () => {
    $(".app-layout").classList.toggle("mobile-sandbox-open");
  });
}

function toggleButton(name) {
  const btn = $(`#${name}Toggle`);
  if (!btn) return;
  const active = btn.classList.toggle("active");
  btn.setAttribute("aria-pressed", active);
  state.toggles[name] = active;
}

function providerLabel(p) {
  return p === "cerebras" ? "Cerebras" : p === "cohere" ? "Cohere" : "OpenRouter";
}

function resolveUiRoleForCurrentSelection(modelId = state.currentModel) {
  if (state.currentCategory === "agent") return "agent";
  if (state.currentCategory === "estratega") return "agent";
  if (state.currentCategory === "fast") return "fast";
  return getRoleForModel(modelId) || "agent";
}

function getDefaultModelForCategory(category) {
  return {
    agent: "nvidia/nemotron-3-super-120b-a12b:free",
    estratega: "cerebras/llama3.1-8b",
    fast: "cerebras/llama3.1-8b",
    // Compatibilidad con categorías antiguas persistidas.
    coder: "cohere/north-mini-code:free",
    general: "cerebras/llama3.1-8b",
  }[category] || "nvidia/nemotron-3-super-120b-a12b:free";
}

function getPreferredAgentModel() {
  if (state.toggles.deepThinking) return "nvidia/nemotron-3-ultra-550b-a55b:free";
  if (state.toggles.codeFirst) return "cohere/north-mini-code:free";
  return state.currentModel || "nvidia/nemotron-3-super-120b-a12b:free";
}

function toggleDropdown(sel) {
  const menu = $(sel);
  if (!menu) return;
  menu.hidden = !menu.hidden;
  // Cerrar otros dropdowns.
  $$(`.dropdown-menu:not(${sel})`).forEach((m) => m.hidden = true);
}

// Click fuera de dropdowns los cierra.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".dropdown")) {
    $$(".dropdown-menu").forEach((m) => m.hidden = true);
  }
});

// ==============================================================================
// CHAT LIST (sidebar)
// ==============================================================================
async function loadChatList() {
  const list = $("#chatList");
  if (!list) return;
  list.innerHTML = "";

  // P1-4: aplicar filtro de búsqueda activo (solo por título, case-insensitive).
  const query = (state.chatSearchQuery || "").trim().toLowerCase();
  const applyFilter = (chats) => {
    if (!query) return chats;
    return chats.filter((c) => (c.title || "").toLowerCase().includes(query));
  };

  let chats = [];

  // En offline, cargar desde cache.
  if (state.isOffline) {
    const cached = await getOfflineCacheManager().loadChatsFromCache();
    chats = cached.filter((c) => c.category === state.currentCategory);
  } else {
    try {
      const resp = await fetch(`/api/chats?category=${state.currentCategory}`);
      if (resp.ok) {
        const data = await resp.json();
        chats = data.chats || [];
      } else {
        // Fallback: offline-bundle (trae chats también).
        const bundle = await fetch("/api/chats/offline-bundle").then((r) => r.json()).catch(() => ({ chats: [] }));
        chats = (bundle.chats || []).filter((c) => c.category === state.currentCategory);
      }
    } catch (e) {
      toast(`Error cargando chats: ${e.message}`, "error");
      return;
    }
  }

  // P1-4: aplicar filtro por título.
  const filtered = applyFilter(chats);

  // P1-4: estado vacío si no hay resultados.
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-list-empty";
    empty.textContent = query
      ? t("chat.searchNoResults", { query })
      : t("chat.emptyCategory");
    list.appendChild(empty);
    return;
  }

  filtered.forEach((c) => renderChatItem(c));
}

function renderChatItem(chat) {
  const list = $("#chatList");
  const item = document.createElement("div");
  item.className = "chat-item";
  if (state.currentChat?.id === chat.id) item.classList.add("active");
  item.dataset.chatId = chat.id;

  const provider = getProvider(state.currentModel || "");
  const title = document.createElement("div");
  title.className = "chat-item-title";
  title.textContent = chat.title;
  title.title = chat.title;
  item.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "chat-item-meta";
  const providerChip = document.createElement("span");
  providerChip.className = "chat-item-provider";
  // Determinar provider por el último mensaje del chat.
  providerChip.classList.add(provider);
  providerChip.textContent = providerLabel(provider);
  meta.appendChild(providerChip);
  if (chat.is_shared) {
    const shared = document.createElement("span");
    shared.textContent = "👥";
    meta.appendChild(shared);
  }
  item.appendChild(meta);

  // Actions (rename/delete).
  const actions = document.createElement("div");
  actions.className = "chat-item-actions";
  const renameBtn = document.createElement("button");
  renameBtn.className = "chat-item-action";
  renameBtn.textContent = "✎";
  renameBtn.title = t("toast.renamed");
  renameBtn.addEventListener("click", (e) => { e.stopPropagation(); startRename(item, chat); });
  actions.appendChild(renameBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "chat-item-action";
  deleteBtn.textContent = "🗑";
  deleteBtn.title = "Borrar";
  deleteBtn.addEventListener("click", (e) => { e.stopPropagation(); deleteChat(chat); });
  actions.appendChild(deleteBtn);
  item.appendChild(actions);

  // Click para abrir.
  item.addEventListener("click", () => openChat(chat));

  // Doble click para renombrar.
  title.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startRename(item, chat);
  });

  list.appendChild(item);
}

async function createNewChat() {
  const chatId = crypto.randomUUID();
  const title = t("chat.empty");
  const category = state.currentCategory;
  // Persistir el chat en el backend vía POST /api/chats.
  const chat = {
    id: chatId,
    category,
    title,
    user_email: state.user_email,
    is_shared: 0,
    updated_at: new Date().toISOString(),
  };
  // v2.8.6: el chat solo se persiste al enviar el primer mensaje
  // (evita listas llenas de chats vacíos "Select or create a chat").
  chat._persisted = false;
  state.currentChat = chat;
  state.messages = [];
  state.chatSummary = null;
  state.chatCachedTotal = 0;
  invalidateMemoryCache();

  // Seleccionar modelo por defecto según categoría.
  state.currentModel = getDefaultModelForCategory(category);
  state.currentRole = resolveUiRoleForCurrentSelection(state.currentModel);

  populateModelSelector();
  await loadChatList();
  openChat(chat);
  $("#messageInput")?.focus();

  // v2.8.1: persistencia visible — reabre el último chat activo al entrar.
  if (!state.currentChat && chats.length > 0) {
    const lastId = localStorage.getItem("veritas:lastChat");
    const target = chats.find((c) => c.id === lastId) || chats[0];
    if (target) await openChat(target);
  }
}

async function openChat(chat) {
  try { localStorage.setItem("veritas:lastChat", chat.id); } catch { /* privado */ }
  state.currentChat = chat;
  state.messages = [];
  state.chatSummary = chat.summary_json ? JSON.parse(chat.summary_json) : null;
  state.chatCachedTotal = 0;

  // Marcar activo en sidebar.
  $$(".chat-item").forEach((it) => it.classList.toggle("active", it.dataset.chatId === chat.id));

  // Cargar mensajes.
  if (state.isOffline) {
    state.messages = await getOfflineCacheManager().loadMessagesFromCache(chat.id);
  } else {
    try {
      const resp = await fetch(`/api/chat/${chat.id}/messages?full=true`);
      if (resp.ok) {
        const data = await resp.json();
        state.messages = data.messages || [];
      }
    } catch (e) {
      // Fallback a cache.
      state.messages = await getOfflineCacheManager().loadMessagesFromCache(chat.id);
    }
  }

  // Renderizar.
  renderMessages();
  renderChatHeader();
  populateModelSelector();
  updateTokenCounter();
  updateInviteButtonVisibility();

  // Si es shared, iniciar SharedSessionManager.
  if (chat.is_shared) {
    await startSharedSession();
  }

  // Auto-sugerir título tras primer intercambio.
  if (state.settings.chats.autoTitle && state.messages.length === 2) {
    const firstUser = state.messages.find((m) => m.role === "user");
    const firstAssistant = state.messages.find((m) => m.role === "assistant");
    if (firstUser && firstAssistant && state.currentChat.title === t("chat.empty")) {
      suggestTitle();
    }
  }
}

async function deleteChat(chat) {
  if (!(await showConfirm(`¿Borrar "${chat.title}"?`, { title: "Borrar chat", danger: true, okLabel: "Borrar" }))) return;
  try {
    await fetch(`/api/chat/${chat.id}`, { method: "DELETE" });
    if (state.currentChat?.id === chat.id) {
      state.currentChat = null;
      state.messages = [];
      renderEmptyState();
    }
    await loadChatList();
    toast("Chat borrado", "success");
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}

function startRename(item, chat) {
  const title = item.querySelector(".chat-item-title");
  const oldText = chat.title;
  const input = document.createElement("input");
  input.type = "text";
  input.value = oldText;
  input.maxLength = 100;
  input.className = "chat-item-title editing";
  title.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newText = input.value.trim();
    if (!newText || newText === oldText) {
      input.replaceWith(title);
      return;
    }
    try {
      const resp = await fetch(`/api/chat/${chat.id}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newText }),
      });
      if (resp.ok) {
        chat.title = newText;
        title.textContent = newText;
        toast(t("toast.renamed"), "success");
        if (state.currentChat?.id === chat.id) renderChatHeader();
      } else {
        throw new Error(`HTTP ${resp.status}`);
      }
    } catch (e) {
      toast(t("toast.renameFailed"), "warning");
    }
    input.replaceWith(title);
  };

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); input.blur(); }
    if (e.key === "Escape") { input.value = oldText; input.blur(); }
  });

  // Ctrl+Z para deshacer auto-rename.
  if (chat._autoRenamed) {
    setTimeout(() => {
      const handler = (ev) => {
        if (ev.ctrlKey && ev.key === "z") {
          input.value = oldText;
          document.removeEventListener("keydown", handler);
        }
      };
      document.addEventListener("keydown", handler);
      setTimeout(() => document.removeEventListener("keydown", handler), 10000);
    }, 100);
  }
}

async function suggestTitle() {
  if (!state.currentChat) return;
  try {
    const resp = await fetch(`/api/chat/${state.currentChat.id}/suggest-title`, { method: "POST" });
    if (resp.ok) {
      const data = await resp.json();
      if (data.suggested_title) {
        const st = String(data.suggested_title).trim();
        const leaked = /user wants|wants a|respond|responde|genera|generate|title:|the user/i.test(st) || st.length > 60 || st.length < 3;
        if (leaked) return;
        state.currentChat.title = st;
        state.currentChat._autoRenamed = true;
        renderChatHeader();
        await loadChatList();
      }
    }
  } catch (e) { /* best-effort */ }
}

// ==============================================================================
// MODEL SELECTOR
// ==============================================================================
function populateModelSelector() {
  const sel = $("#modelSelector");
  if (!sel) return;
  sel.innerHTML = "";

  let models = [];

  if (state.currentCategory === "agent") {
    models = [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3-nano-30b-a3b:free",
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-20b:free",
      "cohere/north-mini-code:free",
      "poolside/laguna-s-2.1:free",
      "poolside/laguna-xs-2.1:free",
    ];
  } else if (false) {
    models = [
      "z-ai/glm-4.7-flash",
      "z-ai/glm-4.6v-flash",
      "z-ai/glm-4.5-flash",
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-20b:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
    ];
  } else if (state.currentCategory === "fast") {
    models = ["cerebras/llama3.1-8b", "cerebras/llama-3.3-70b", "cohere/command-r-plus"];
  } else {
    models = [getDefaultModelForCategory(state.currentCategory)];
  }

  models.forEach((m) => {
    const info = getModelDisplayInfo(m);
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = `${info.shortName} — ${info.roleName} (${providerLabel(info.provider)})`;
    if (m === state.currentModel) opt.selected = true;
    sel.appendChild(opt);
  });

  if (!state.currentModel && models.length > 0) {
    state.currentModel = models[0];
    state.currentRole = resolveUiRoleForCurrentSelection(state.currentModel);
  }
}

// ==============================================================================
// CHAT HEADER RENDER
// ==============================================================================
function renderChatHeader() {
  if (!state.currentChat) {
    $("#chatTitle").textContent = t("chat.empty");
    const ct = $("#chatCrumbTitle");
    if (ct) ct.textContent = "Sin título";
    $("#modelChip").textContent = "—";
    hide($("#sharedBanner"));
    return;
  }
  $("#chatTitle").textContent = state.currentChat.title;
  const ct2 = $("#chatCrumbTitle");
  if (ct2) ct2.textContent = state.currentChat.title;
  const modelChip = $("#modelChip");
  const _info = getModelDisplayInfo(state.currentModel);
  modelChip.textContent = `${_info.roleName || "🤖"} · ${_info.shortName}`;
  modelChip.className = `model-chip ${getProvider(state.currentModel)}`;

  // Cached badge.
  const cachedBadge = $("#chatCachedBadge");
  if (state.chatCachedTotal > 0 && state.settings.tokens.showChips) {
    cachedBadge.textContent = `⚡ ${state.chatCachedTotal} cached this chat`;
    show(cachedBadge);
  } else {
    hide(cachedBadge);
  }

  // Shared banner.
  if (state.currentChat.is_shared) {
    show($("#sharedBanner"));
    if (state.currentChat.user_email === state.user_email) {
      show($("#sharedCloseBtn"));
      hide($("#sharedLeaveBtn"));
    } else {
      show($("#sharedLeaveBtn"));
      hide($("#sharedCloseBtn"));
    }
  } else {
    hide($("#sharedBanner"));
  }
}

function renderEmptyState() {
  const container = $("#messagesContainer");
  if (!container) return;
  // v2.8: sin tarjetas ni hero — el área de chat queda limpia.
  container.innerHTML = "";
}

// P1-extra: renderiza las tarjetas de modelo según la categoría activa.
function renderWelcomeModelCards() {
  const cardsContainer = $("#welcomeModelCards");
  if (!cardsContainer) return;

  let models = [];
  if (state.currentCategory === "agent") {
    models = [
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3-nano-30b-a3b:free",
      "google/gemma-4-31b-it:free",
      "openai/gpt-oss-20b:free",
      "cohere/north-mini-code:free",
      "poolside/laguna-s-2.1:free",
      "poolside/laguna-xs-2.1:free",
    ];
  } else if (false) {
    models = ["z-ai/glm-4.7-flash", "z-ai/glm-4.6v-flash", "z-ai/glm-4.5-flash", "google/gemma-4-31b-it:free", "openai/gpt-oss-20b:free"];
  } else if (state.currentCategory === "fast") {
    models = ["cerebras/llama3.1-8b", "cerebras/llama-3.3-70b", "cohere/command-r-plus"];
  } else {
    models = [getDefaultModelForCategory(state.currentCategory)];
  }

  const cardsHtml = models.map((modelId) => {
    const info = getModelDisplayInfo(modelId);
    const isActive = modelId === state.currentModel ? " active" : "";
    return `
      <div class="welcome-model-card${isActive}" role="listitem" tabindex="0"
           data-model="${escapeHTML(modelId)}"
           aria-label="${escapeHTML(info.roleName)} — ${escapeHTML(modelId)}">
        <div class="welcome-card-icon">${info.icon}</div>
        <div class="welcome-card-name">${escapeHTML(info.shortName)}</div>
        <div class="welcome-card-role">${escapeHTML(info.roleName)}</div>
        <span class="welcome-card-provider ${info.provider}">${providerLabel(info.provider)}</span>
      </div>
    `;
  }).join("");

  cardsContainer.innerHTML = cardsHtml;

  // Listeners: click y keyboard (Enter/Space) para accesibilidad.
  cardsContainer.querySelectorAll(".welcome-model-card").forEach((card) => {
    const select = () => {
      const modelId = card.dataset.model;
      state.currentModel = modelId;
      state.currentRole = resolveUiRoleForCurrentSelection(modelId);
      populateModelSelector();
      updateTokenCounter();
      // Re-render para marcar la tarjeta activa.
      cardsContainer.querySelectorAll(".welcome-model-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      // Foco al input para que el usuario empiece a escribir.
      $("#messageInput")?.focus();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
  });
}

// P1-extra: helper que devuelve info de display para cada modelo.
function getModelDisplayInfo(modelId) {
  const provider = getProvider(modelId);
  const map = {
    // Stack Nemotron (Agente)
    "nvidia/nemotron-3-ultra-550b-a55b:free": {
      shortName: "Nemotron Ultra",
      roleName: t("roles.agent"),
      icon: "🧠",
      provider,
    },
    "nvidia/nemotron-3-super-120b-a12b:free": {
      shortName: "Nemotron Super",
      roleName: t("roles.agent"),
      icon: "⚡️",
      provider,
    },
    "nvidia/nemotron-3-nano-30b-a3b:free": {
      shortName: "Nemotron Nano 30B",
      roleName: t("roles.agent"),
      icon: "🧩",
      provider,
    },
    "google/gemma-4-31b-it:free": {
      shortName: "Gemma 4 31B",
      roleName: "🔷 Subagente Analista",
      icon: "🔷",
      provider,
    },
    "openai/gpt-oss-20b:free": {
      shortName: "GPT-OSS 20B",
      roleName: "🔎 Subagente de Investigación",
      icon: "◌",
      provider,
    },
    "nvidia/nemotron-nano-12b-v2-vl:free": {
      shortName: "Nano VL",
      roleName: "Percepción Visual",
      icon: "👁",
      provider,
    },
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {
      shortName: "Nano Omni",
      roleName: "Percepción Omni",
      icon: "🎬",
      provider,
    },
    // Roles standalone
    "cohere/north-mini-code:free": {
      shortName: "North Mini Code",
      roleName: "👾 Subagente de Código",
      icon: "⚙",
      provider,
    },
    "poolside/laguna-s-2.1:free": {
      shortName: "Laguna S 2.1",
      roleName: t("roles.coder"),
      icon: "🛠",
      provider,
    },
    "poolside/laguna-xs-2.1:free": {
      shortName: "Laguna XS 2.1",
      roleName: t("roles.coder"),
      icon: "🔧",
      provider,
    },
    "cerebras/llama3.1-8b": {
      shortName: "Cerebras 8B",
      roleName: "⚡ Explorador Veloz",
      icon: "⚡",
      provider,
    },
    "cerebras/llama-3.3-70b": {
      shortName: "Cerebras 70B",
      roleName: "🏃 Corredor de Fondo",
      icon: "🏃",
      provider,
    },
    "cohere/command-r-plus": {
      shortName: "Command R+",
      roleName: "🧭 Estratega de Ruta",
      icon: "🧭",
      provider,
    },
    "cohere/command-a-03-2025": {
      shortName: "Command A",
      roleName: "🗂️ Archivista Veloz",
      icon: "🗂️",
      provider,
    },
  };
  return map[modelId] || { shortName: modelId, roleName: "", icon: "🤖", provider };
}

// v2.8.1: regenera la última respuesta (trunca servidor y re-envía el user previo).
async function regenerateLastAssistant() {
  let i = state.messages.length - 1;
  while (i >= 0 && state.messages[i].role !== "assistant") i--;
  if (i < 0) return;
  let u = i - 1;
  while (u >= 0 && state.messages[u].role !== "user") u--;
  if (u < 0) return;
  const userMsg = state.messages[u];
  try {
    await fetch(`/api/chat/${encodeURIComponent(state.currentChat.id)}/truncate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ created_at: userMsg.created_at }),
    });
  } catch { /* best-effort */ }
  state.messages = state.messages.slice(0, u);
  renderMessages();
  const input = $("#messageInput");
  input.value = userMsg.content;
  await sendMessage();
}

function initMessageActions() {
  const container = $("#messagesContainer");
  if (!container) return;
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const msgEl = btn.closest(".message");
    const idx = [...container.querySelectorAll(".message")].indexOf(msgEl);
    const m = state.messages[idx];
    if (!m) return;
    if (btn.dataset.action === "copy-msg") {
      const text = (m.content || "").replace(/<[^>]+>/g, "").trim();
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        () => toast("📋 Respuesta copiada", "success", 1500),
        () => toast("No se pudo copiar", "warning", 1500)
      );
    } else if (btn.dataset.action === "regen-msg") {
      regenerateLastAssistant();
    }
  });
}

function renderMessages() {
  const container = $("#messagesContainer");
  container.innerHTML = "";
  if (state.messages.length === 0) {
    renderEmptyState();
    return;
  }
  state.messages.forEach((m) => renderMessage(m));
  scrollToBottom();
  updateExportButtons();
}

function renderMessage(m) {
  const container = $("#messagesContainer");
  const tpl = $("#messageTemplate");
  const node = tpl.content.cloneNode(true);
  const msg = node.querySelector(".message");
  msg.classList.add(m.role);

  const avatar = node.querySelector(".message-avatar");
  avatar.textContent = (m.role === "user" ? "U" : (m.role === "assistant" ? "V" : "🔧"));

  const author = node.querySelector(".message-author");
  if (m.role === "user") {
    author.textContent = m.author_email ? m.author_email.split("@")[0] : "Tú";
  } else if (m.role === "assistant") {
    author.textContent = m.model || "Asistente";
  } else if (m.role === "tool") {
    author.textContent = "Tool";
  }

  const time = node.querySelector(".message-time");
  if (m.created_at) time.textContent = formatDate(m.created_at, getCurrentLang());

  const provider = node.querySelector(".message-provider");
  if (m.provider) {
    provider.textContent = m.provider;
    provider.hidden = false;
  }

  const body = node.querySelector(".message-body");
  body.innerHTML = sanitizeHTML(formatMessageContent(m.content || ""));

  const thinking = node.querySelector(".message-thinking");
  if (m.thinking_content) {
    thinking.textContent = m.thinking_content;
    thinking.hidden = false;
  }

  const tools = node.querySelector(".message-tools");
  if (m.tools_used && Array.isArray(m.tools_used) && m.tools_used.length > 0) {
    tools.innerHTML = m.tools_used.map((name) => `<span class="tool-chip">🔧 ${name}</span>`).join("");
    tools.hidden = false;
  }

  // v2.8.1: acciones por respuesta (copiar / regenerar).
  if (m.role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML =
      '<button class="msg-action" data-action="copy-msg" title="Copiar respuesta">📋</button>' +
      '<button class="msg-action" data-action="regen-msg" title="Regenerar respuesta">🔄</button>';
    const wrapper = node.querySelector(".message-content-wrapper") || msg;
    wrapper.appendChild(actions);
  }

  // Cached chip.
  const cachedChip = node.querySelector(".message-cached-chip");
  if (m.cached_tokens && m.cached_tokens > 0 && state.settings.tokens.showChips) {
    cachedChip.textContent = `⚡ ${m.cached_tokens} cached`;
    cachedChip.hidden = false;
  }

  container.appendChild(node);
}

// v2.5 — Sanitizador de HTML por whitelist (anti-XSS). El contenido viene del
// LLM (que a su vez puede haber leído webs escaneadas), así que nunca se
// confía en él: se eliminan scripts, iframes, atributos on* y URLs no seguras.
function sanitizeHTML(html) {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    const ALLOWED = new Set(["P","DIV","SPAN","BR","STRONG","B","EM","I","U","A","UL","OL","LI","BLOCKQUOTE","CODE","PRE","H1","H2","H3","H4","H5","H6","TABLE","THEAD","TBODY","TR","TH","TD","IMG","HR","MARK","SUP","SUB","DEL","INS"]);
    const DANGEROUS = new Set(["SCRIPT","IFRAME","OBJECT","EMBED","LINK","META","STYLE","FORM","BASE","TEMPLATE","FRAME","APPLET"]);
    const walk = (node) => {
      Array.from(node.children).forEach((el) => {
        const tag = el.tagName;
        if (DANGEROUS.has(tag)) { el.remove(); return; }
        if (!ALLOWED.has(tag)) {
          while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
          el.remove(); return;
        }
        Array.from(el.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          if (name.indexOf("on") === 0) { el.removeAttribute(attr.name); return; }
          if (name === "href" || name === "src") {
            const v = (attr.value || "").trim().toLowerCase();
            if (v && !(v.indexOf("http://") === 0 || v.indexOf("https://") === 0 || v.indexOf("data:image/") === 0 || v.indexOf("#") === 0 || v.indexOf("/") === 0)) {
              el.removeAttribute(attr.name);
            }
            return;
          }
          if (!["class","id","target","rel","alt","title","colspan","rowspan","style"].includes(name)) {
            el.removeAttribute(attr.name);
          }
        });
        walk(el);
      });
    };
    walk(doc.body);
    return doc.body.innerHTML;
  } catch (e) {
    return String(html).replace(/<[^>]*>/g, "");
  }
}

function formatMessageContent(content) {
  if (!content) return "";
  // v2.8.4: normalizar variantes de markup de tools.
  content = content
    .replace(/<toolcall\b/gi, "<tool_call")
    .replace(/<\/toolcall\s*>/gi, "<\/tool_call>")
    .replace(/<tool-result\b/gi, "<tool_result")
    .replace(/<\/tool-result\s*>/gi, "</tool_result>");
  // P1-1: Markdown rendering completo (vanilla JS, sin libs externas).
  // Estrategia: extraer primero los bloques de código fenced (```...```) y
  // protegerlos de cualquier transformación posterior. Luego procesar el resto
  // del texto (headers, listas, blockquotes, tablas, inline). Finalmente
  // reinsertar los bloques de código y los <tool_result>.

  // 1. Extraer tool_results (ya vienen como XML en el contenido; preservar).
  // Usamos placeholders SIN underscores para evitar colisión con el regex de
  // cursiva _texto_ en renderInline.
  const toolResults = [];
  let s = content.replace(/<tool_result(?:\s+name="([^"]*)")?(?:\s+status="([^"]*)")?\s*>([\s\S]*?)<\/tool_result>/g, (_, name, status, output) => {
    const idx = toolResults.length;
    toolResults.push({ name, status, output });
    return `\x00TR${idx}\x00`;
  });
  // Los tool_calls ya ejecutados nunca se muestran crudos al usuario.
  s = s.replace(/<tool_call[\s\S]*?(?:<\/tool_call>|$)/gi, "");
  s = s.replace(/<tool_result[\s\S]*?(?:<\/tool_result>|$)/gi, "");

  // 2. Extraer code blocks fenced ```lang\n...```.
  const codeBlocks = [];
  s = s.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "", code: code.replace(/\n$/, "") });
    return `\x00CB${idx}\x00`;
  });

  // 3. Escape HTML del resto.
  s = escapeHTML(s);

  // 4. Bloques especiales: separar por líneas dobles para procesar block-level.
  //    Tablas GFM: | col1 | col2 |\n|---|---|\n| a | b |
  const blocks = s.split(/\n\n+/);
  const processedBlocks = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";

    // Tabla GFM.
    if (/^\|.*\|\s*\n\|[\s\-:|]+\|/m.test(trimmed)) {
      return renderTable(trimmed);
    }
    // Header (##, ###, etc.).
    if (/^#{1,6}\s/.test(trimmed)) {
      return trimmed.replace(/^(#{1,6})\s+(.*)$/m, (_, hashes, text) => {
        const level = hashes.length;
        return `<h${level}>${renderInline(text)}</h${level}>`;
      });
    }
    // Blockquote (> ...) — después de escapeHTML, ">" es "&gt;".
    if (/^[ \t]*&gt;\s?/m.test(trimmed)) {
      const inner = trimmed.split("\n").map((l) => l.replace(/^[ \t]*&gt;\s?/, "")).join("\n");
      return `<blockquote>${renderInline(inner).replace(/\n/g, "<br>")}</blockquote>`;
    }
    // Lista desordenada (- o *).
    if (/^[-*]\s+/m.test(trimmed) && !/^---+$/.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => /^[-*]\s+/.test(l)).map((l) => {
        const text = l.replace(/^[-*]\s+/, "");
        return `<li>${renderInline(text)}</li>`;
      });
      return `<ul>${items.join("")}</ul>`;
    }
    // Lista ordenada (1. 2. 3.).
    if (/^\d+\.\s+/m.test(trimmed)) {
      const items = trimmed.split("\n").filter((l) => /^\d+\.\s+/.test(l)).map((l) => {
        const text = l.replace(/^\d+\.\s+/, "");
        return `<li>${renderInline(text)}</li>`;
      });
      return `<ol>${items.join("")}</ol>`;
    }
    // Horizontal rule (--- o ***).
    if (/^(---+|\*\*\*+|___+)$/.test(trimmed)) {
      return "<hr>";
    }
    // Párrafo normal.
    return `<p>${renderInline(trimmed).replace(/\n/g, "<br>")}</p>`;
  });

  s = processedBlocks.join("\n\n");

  // 5. Reinsertar code blocks.
  s = s.replace(/\x00CB(\d+)\x00/g, (_, idx) => {
    const block = codeBlocks[Number(idx)];
    const langAttr = block.lang ? ` data-lang="${block.lang}"` : "";
    return `<pre${langAttr}><code>${escapeHTML(block.code)}</code></pre>`;
  });

  // 6. Reinsertar tool_results como <details>.
  s = s.replace(/\x00TR(\d+)\x00/g, (_, idx) => {
    const tr = toolResults[Number(idx)];
    return `<details class="tool-result"><summary>🔧 ${tr.name} (${tr.status})</summary><pre class="tool-output">${escapeHTML(tr.output)}</pre></details>`;
  });

  return s;
}

// ------------------------------------------------------------------------------
// renderInline: procesa énfasis inline (negrita, cursiva, código, links).
// Recibe texto YA escapado (post-escapeHTML).
// ------------------------------------------------------------------------------
function renderInline(text) {
  let t = text;
  // Links [text](url) — solo https/http/mailto para evitar javascript:.
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  // Imágenes ![alt](url) — antes que el regex de links.
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img alt="$1" src="$2" loading="lazy" style="max-width:100%;border-radius:8px;margin:6px 0">');
  // Negrita **text** o __text__.
  t = t.replace(/\*\*([^\*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  // Cursiva *text* o _text_ (evitar colisión con negrita: solo si no hay ** adyacente).
  t = t.replace(/(^|[^\*])\*([^\*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  t = t.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  // Strikethrough ~~text~~.
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // Inline code `code` (después de negrita/cursiva para no romper).
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  return t;
}

// ------------------------------------------------------------------------------
// renderTable: renderiza una tabla GFM.
// Recibe el bloque YA escapado. Formato esperado:
//   | H1 | H2 |
//   |----|----|
//   | a  | b  |
// ------------------------------------------------------------------------------
function renderTable(block) {
  const lines = block.split("\n").filter((l) => l.trim() && l.includes("|"));
  if (lines.length < 2) return block; // no es tabla válida
  // Header.
  const headerCells = splitTableRow(lines[0]);
  // Separator (línea 2: |---|---|).
  if (!/^\|[\s\-:|]+$/.test(lines[1].trim())) return block;
  const aligns = splitTableRow(lines[1]).map((cell) => {
    const t = cell.trim();
    if (t.startsWith(":") && t.endsWith(":")) return "center";
    if (t.endsWith(":")) return "right";
    return "left";
  });
  // Body rows (resto).
  const bodyRows = lines.slice(2).map((line) => {
    const cells = splitTableRow(line);
    return `<tr>${cells.map((c, i) => `<td style="text-align:${aligns[i] || "left"}">${renderInline(c)}</td>`).join("")}</tr>`;
  }).join("");

  const headerHtml = headerCells.map((c, i) => `<th style="text-align:${aligns[i] || "left"}">${renderInline(c)}</th>`).join("");
  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function splitTableRow(line) {
  // Quitar | del inicio y final, split por |.
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function escapeHTML(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function scrollToBottom() {
  const c = $("#messagesContainer");
  if (c) c.scrollTop = c.scrollHeight;
}

function isUserTyping() {
  const input = $("#messageInput");
  return input && input === document.activeElement && input.value.length > 0;
}

// ==============================================================================
// ENVIAR MENSAJE + CHAT CON MODELO
// ==============================================================================
async function sendMessage() {
  if (!state.currentChat) await createNewChat();
  const input = $("#messageInput");
  const content = input.value.trim();
  if (!content) return;

  // Si es sesión compartida, adquirir turno primero.
  if (state.sharedSession && state.currentChat.is_shared) {
    const turn = await state.sharedSession.acquireTurn();
    if (!turn.acquired) {
      toast(t("shared.turnHeldBy", { user: turn.held_by, time: formatCountdown(turn.expires_at) }), "warning");
      return;
    }
  }

  // Manejo de attachments pendientes.
  let enrichedContent = content;
  let attachmentsMeta = undefined;
  if (state.pendingAttachments.length > 0) {
    attachmentsMeta = [...state.pendingAttachments];

    if (state.currentCategory === "agent") {
      // El agente pasa los attachments a runAgentLoop que los percibe
      // directamente vía /api/chat/perceive. NO inyectar texto en el mensaje.
      // Los chips se limpian tras la percepción (dentro de runAgentLoop).
    } else {
      // Roles no-agente: inyectar instrucciones de analyze_media como texto.
      const attachmentLines = state.pendingAttachments.map((a) =>
        `[Archivo adjunto: ${a.name} (${a.modality}, ${formatBytes(a.size)}) — R2 key: ${a.r2_key} — Usa la herramienta analyze_media con target="${a.r2_key}" y modality="${a.modality}" para analizar este archivo.]`
      ).join("\n");
      enrichedContent = content + "\n\n" + attachmentLines;
      // Limpiar chips de attachment para roles no-agente.
      state.pendingAttachments = [];
      renderAttachmentChips();
    }
  }

  // Manejo de documentos del repo adjuntados como contexto.
  if (state.repoDocAttachments.length > 0) {
    const repoDocLines = [];
    repoDocLines.push("[Documentos del repositorio adjuntados como contexto:]");
    for (const doc of state.repoDocAttachments) {
      repoDocLines.push(`--- Documento #${doc.doc_number}: ${doc.doc_name} (${formatBytes(doc.file_size)}) ---`);
      // Intentar obtener el texto del documento.
      const docData = await fetchRepoDocContent(doc.doc_number);
      if (docData && docData.text) {
        // Truncar a ~15K chars para no saturar el contexto.
        const maxLen = 15000;
        const docText = docData.text.length > maxLen
          ? docData.text.slice(0, maxLen) + "\n... [truncado, " + docData.text.length + " chars total]"
          : docData.text;
        repoDocLines.push(docText);
      } else {
        repoDocLines.push("(No se pudo cargar el contenido del documento)");
      }
    }
    enrichedContent = content + "\n\n" + repoDocLines.join("\n");
    // Limpiar chips de docs del repo.
    state.repoDocAttachments = [];
    renderRepoDocChips();
  }

  // v2.8.6: persistir el chat la primera vez que se envía un mensaje.
  if (state.currentChat && !state.currentChat._persisted && !state.isOffline) {
    try {
      await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: state.currentChat.id, title: state.currentChat.title, category: state.currentChat.category }),
      });
      state.currentChat._persisted = true;
    } catch { /* best-effort */ }
  }

  // Guardar mensaje user (con contenido enriquecido si hubo attachments).
  const userMsg = {
    id: crypto.randomUUID(),
    chat_id: state.currentChat.id,
    role: "user",
    content: enrichedContent,
    author_email: state.user_email,
    created_at: new Date().toISOString(),
    attachments: attachmentsMeta,
  };
  state.messages.push(userMsg);
  renderMessage(userMsg);
  scrollToBottom();
  input.value = "";
  autoResize(input);

  // Persistir en D1 (best-effort; encolar si offline).
  if (state.isOffline) {
    await getOfflineCacheManager().queuePendingMessage({
      chat_id: state.currentChat.id,
      content,
      role: "user",
    });
  } else {
    fetch("/api/db/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userMsg),
    }).catch(() => {});
  }

  // Tool Caller loop (pasar contenido enriquecido con attachments).
  await runChatWithTools(enrichedContent);

  // Limpiar attachments pendientes tras el loop (el agente los usa vía runAgentLoop).
  if (state.pendingAttachments.length > 0) {
    state.pendingAttachments = [];
    renderAttachmentChips();
  }
  // Limpiar docs del repo (ya inyectados antes del loop).
  if (state.repoDocAttachments.length > 0) {
    state.repoDocAttachments = [];
    renderRepoDocChips();
  }

  // Liberar turno.
  if (state.sharedSession) {
    await state.sharedSession.releaseTurn();
  }
}

// ==============================================================================
// FALLBACK ÉTICO A DOLPHIN
// ==============================================================================
// Cuando un modelo con restricciones de fabricante (Nemotron, Laguna) emite
// <fallback_to_uncensored>, se re-enruta la query al Estratega GLM permisivo vía Puter.
// ==============================================================================

/**
 * Llama al Estratega GLM directamente con la query original del usuario.
 * Usa Puter.js (no pasa por el Worker) con el system prompt estratégico.
 * Streaming: muestra progreso en tiempo real.
 */
// ==============================================================================
// TOOL CALLER LOOP (máx 5 iteraciones)
// ==============================================================================
// v2.8.7: limpia markup interno de tools e instrucciones eco del modelo.
function cleanAgentText(text) {
  if (!text) return "";
  let s = text
    .replace(/<tool_call[\s\S]*?(?:<\/tool_call>|$)/gi, "")
    .replace(/<toolcall[\s\S]*?(?:<\/toolcall>|$)/gi, "")
    .replace(/<tool_result[\s\S]*?(?:<\/tool_result>|$)/gi, "")
    .replace(/^\s*Now (summarize|respond|answer|provide)[^\n]*$/gmi, "")
    .replace(/^\s*preview generated\s*$/gmi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

// v2.8.7: bloques ```html completos -> archivo en Sandbox + preview, y se
// sustituyen por una nota en el texto visible.
function extractSandboxArtifacts(text) {
  if (!text || !/```/.test(text)) return text;
  const re = /```[a-zA-Z]*\n([\s\S]*?)```/g;
  let m;
  let out = text;
  let changed = false;
  const found = [];
  while ((m = re.exec(text)) !== null) found.push(m);
  for (const mm of found) {
    const code = mm[1];
    if (/<html[\s>]|<!DOCTYPE/i.test(code)) {
      state.sandbox.files["index.html"] = code;
      state.sandbox.files["preview_" + (Date.now() % 100000) + ".html"] = code;
      out = out.replace(mm[0], "\n\n*📊 Vista previa generada — ábrela en el panel Sandbox.*\n\n");
      changed = true;
    }
  }
  if (changed) {
    try { renderSandboxTree(); } catch {}
    try { refreshPreview(); } catch {}
    try { showSandbox("sandbox"); } catch {}
  }
  return out;
}

async function runChatWithTools(userContent) {
  // v2.6: máx 3 tools encadenadas por request (protege CPU 10ms y duración 30s del free tier).
  const maxIter = 2; // v2.8.3: máx 2 rondas de tools; luego síntesis final garantizada.
  let iteration = 0;
  let assistantText = "";
  let finalPersisted = false;
  let lastHadTools = false;
  const toolOutputs = [];
  setEntityState("processing");
  showStreamingIndicator(t("stream.processing"), "processing");
  setStreamingMode(true); // P0-4: mostrar Stop, ocultar Send

  while (iteration < maxIter) {
    iteration++;
    lastHadTools = false;
    try {
      const response = await callModel(userContent, assistantText, iteration > 1);

      // P0-4: si el streaming fue abortado por el usuario, guardar partial y salir.
      if (response.aborted) {
        if (response.text && response.text.trim()) {
          assistantText += response.text;
          // Persistir el mensaje partial como assistant.
          const partialModel = response.model || state.currentModel;
          const partialMsg = {
            id: crypto.randomUUID(),
            chat_id: state.currentChat.id,
            role: "assistant",
            content: response.text + "\n\n*[Generación detenida por el usuario]*",
            model: partialModel,
            provider: getProvider(partialModel),
            author_email: state.user_email,
            tokens_in: response.tokens_in || 0,
            tokens_out: response.tokens_out || 0,
            cached_tokens: response.cached_tokens || 0,
            created_at: new Date().toISOString(),
          };
          state.messages.push(partialMsg);
          // best-effort persist
          fetch("/api/db/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(partialMsg),
          }).catch(() => {});
        }
        toast(t("stream.stopped"), "info");
        break;
      }

      // v2.8.7: el rol Agente orquestó tools en el servidor; tratamos su texto
      // (limpio de markup) como respuesta final única y persistimos.
      if (state.currentRole === "agent") {
        let clean = cleanAgentText(response.text);
        clean = extractSandboxArtifacts(clean);
        const finalModel = response.model || state.currentModel;
        const finalMsg = {
          id: crypto.randomUUID(),
          chat_id: state.currentChat.id,
          role: "assistant",
          content: clean || response.text,
          model: finalModel,
          provider: getProvider(finalModel),
          author_email: state.user_email,
          tokens_in: response.tokens_in || 0,
          tokens_out: response.tokens_out || 0,
          cached_tokens: response.cached_tokens || 0,
          thinking_content: response.thinking_content || null,
          created_at: new Date().toISOString(),
        };
        state.messages.push(finalMsg);
        fetch("/api/db/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finalMsg),
        }).catch(() => {});
        finalPersisted = true;
        assistantText = clean || response.text;
        break;
      }

      // ── Fallback ético: <fallback_to_uncensored> ──
      const uncensoredFallback = parseFallbackToVenice(response.text);
      if (uncensoredFallback) {
        // v2.8: sin Estratega/Puter — solo se limpia el marcador y se continúa.
        const strippedText = stripFallbackToVenice(response.text);
        if (strippedText) {
          response.text = strippedText;
          assistantText += strippedText;
        }
        break;
      }

      assistantText += response.text;

      // Parsear tool calls embebidos.
      const toolCalls = parseToolCallXML(response.text);
      // v2.8.5: resultados de tools sin tool_call parseable: al contexto
      // y el modelo los procesa en la siguiente ronda (o sintesis final).
      if (toolCalls.length === 0 && /<tool_result|<tool_call|<toolcall/i.test(response.text)) {
        state.messages.push({
          id: crypto.randomUUID(),
          chat_id: state.currentChat.id,
          role: "tool",
          content: response.text,
          ui_hidden: true,
          created_at: new Date().toISOString(),
        });
        toolOutputs.push({ name: "server_tools", status: "ok", output: response.text.replace(/<[^>]+>/g, " ").slice(0, 4000) });
        lastHadTools = true;
        continue;
      }
      if (toolCalls.length === 0) {
        // No hay más tools; terminar.
        break;
      }

      // Renderizar texto previo al primer tool_call (ya está en response.text).
      // Guardar mensaje assistant con tools_used.
      // Usar response.model si viene del orchestrate (modelo real), si no state.currentModel.
      const resolvedModel = response.model || state.currentModel;
      const assistantMsg = {
        id: crypto.randomUUID(),
        chat_id: state.currentChat.id,
        role: "assistant",
        content: response.text,
        model: resolvedModel,
        provider: getProvider(resolvedModel),
        tools_used: toolCalls.map((c) => c.name),
        author_email: state.user_email,
        tokens_in: response.tokens_in,
        tokens_out: response.tokens_out,
        cached_tokens: response.cached_tokens,
        created_at: new Date().toISOString(),
      };
      state.messages.push(assistantMsg);
      renderMessage(assistantMsg);
      scrollToBottom();

      // Ejecutar tools (resultados en contexto, ocultos en UI).
      lastHadTools = true;
      for (const call of toolCalls) {
        if (!isAllowed(call.name, state.currentRole)) {
          const resultMsg = {
            id: crypto.randomUUID(),
            chat_id: state.currentChat.id,
            role: "tool",
            content: buildToolResultXML(call.name, "forbidden", t("tool.forbidden")),
            ui_hidden: true,
            created_at: new Date().toISOString(),
          };
          state.messages.push(resultMsg);
          continue;
        }
        const collected = await executeToolCall(call);
        if (collected) toolOutputs.push(collected);
      }

      // Si el modelo emitió <file path="...">, actualizar sandbox.
      parseFileBlocks(response.text);

      // Siguiente iteración: el modelo verá los tool_results.
    } catch (e) {
      console.error("[chat] Error en iteración", iteration, e);
      setStreamingMode(false); // P0-4: restaurar Send en caso de error
      // Si es rate_limited, intentar fallback.
      if (e.error === "all_keys_rate_limited" || e.error === "upstream_error" || e.error === "agent_stack_exhausted") {
        await tryFallback(e);
      } else {
        toast(t("toast.error", { message: e.message }), "error");
      }
      break;
    }
  }

  // v2.8.3: Véritas SIEMPRE sintetiza una respuesta final con lo recolectado.
  if (!finalPersisted && lastHadTools) {
    const dump = toolOutputs.slice(-4).map((o) => `【${o.name} · ${o.status}】 ${o.output}`).join("\n").slice(0, 6000);
    const synthPrompt = `Eres Véritas, una única identidad de IA. El usuario preguntó: "${userContent.slice(0, 1500)}".
Se ejecutaron herramientas y estos son sus resultados:
${dump || "(sin resultados útiles)"}
Redacta AHORA la mejor respuesta final posible al usuario, en su idioma, usando esa información aunque sea parcial o haya errores. Si faltan datos, dilo brevemente y da tu mejor aproximación. No emitas tool_calls, ni XML, ni JSON crudo: responde en prosa clara.`;
    try {
      const sr = await fetch("/api/llm/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: synthPrompt, max_tokens: 1600 }),
      });
      const sd = await sr.json().catch(() => null);
      const synthText = (sd && sd.text || "").trim();
      if (synthText) {
        const finalMsg = {
          id: crypto.randomUUID(),
          chat_id: state.currentChat.id,
          role: "assistant",
          content: synthText,
          model: state.currentModel,
          provider: getProvider(state.currentModel),
          author_email: state.user_email,
          created_at: new Date().toISOString(),
        };
        state.messages.push(finalMsg);
        fetch("/api/db/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(finalMsg),
        }).catch(() => {});
        finalPersisted = true;
        assistantText = synthText;
      }
    } catch { /* best-effort */ }
  }

  // v2.8.7: roles no-agente también limpian markup y extraen artefactos.
  if (!finalPersisted && assistantText) {
    assistantText = extractSandboxArtifacts(cleanAgentText(assistantText));
  }

  // v2.8.2: si el loop terminó sin persistir (fallback ético, errores), guardar igual.
  if (!finalPersisted && assistantText && assistantText.trim()) {
    const finalMsg = {
      id: crypto.randomUUID(),
      chat_id: state.currentChat.id,
      role: "assistant",
      content: assistantText,
      model: state.currentModel,
      provider: getProvider(state.currentModel),
      author_email: state.user_email,
      created_at: new Date().toISOString(),
    };
    state.messages.push(finalMsg);
    fetch("/api/db/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalMsg),
    }).catch(() => {});
  }
  if (_streamingMsgEl) { _streamingMsgEl.remove(); _streamingMsgEl = null; }
  clearReasoningStream();
  renderMessages();

  hideStreamingIndicator();
  setEntityState("active");
  setStreamingMode(false); // P0-4: restaurar Send, ocultar Stop

  // Notificación si la pestaña está oculta.
  window.dispatchEvent(new CustomEvent("shared:event", {
    detail: {
      type: "model_response",
      payload: {
        model: state.currentModel,
        chatTitle: state.currentChat.title,
        chatId: state.currentChat.id,
      },
    },
  }));

  // Auto-sugerir título si es primer intercambio.
  if (state.settings.chats.autoTitle && state.messages.length === 2) {
    suggestTitle();
  }

  // Actualizar cached badge.
  if (state.chatCachedTotal > 0 && state.settings.tokens.showChips) {
    show($("#chatCachedBadge"));
    $("#chatCachedBadge").textContent = `⚡ ${state.chatCachedTotal} cached this chat`;
  }

  // v2.3: Fire-and-forget — extraer memorias de la respuesta final.
  // Solo si hay texto de asistente suficiente y Puter está disponible.
  if (assistantText && assistantText.length > 100) {
    extractAndSaveMemories(assistantText).catch(() => {});
  }
}

// ==============================================================================
// CROSS-CHAT MEMORY (v2.3, Gap 2 del audit)
// ==============================================================================
// Carga memorias del usuario desde /api/memories y las inyecta como bloque
// system en el contexto. También extrae memorias nuevas de las respuestas.
// ==============================================================================

/**
 * Carga memorias del usuario (excluyendo las del chat actual) y las formatea
 * como un bloque system inyectable. Fire-and-forget: nunca bloquea el flujo.
 * @returns {Promise<string>} texto formateado o string vacío si no hay memorias.
 */
async function loadCrossChatMemories() {
  try {
    const excludeParam = state.currentChat?.id ? `&exclude_chat=${state.currentChat.id}` : "";
    const resp = await fetch(`/api/memories?limit=30&${excludeParam}`);
    if (!resp.ok) return "";
    const data = await resp.json();
    const memories = data.memories || [];
    if (memories.length === 0) return "";

    // Agrupar por categoría para presentación compacta.
    const grouped = {};
    for (const m of memories) {
      if (!grouped[m.category]) grouped[m.category] = [];
      grouped[m.category].push(m);
    }

    let text = "Información recordada sobre el usuario (de conversaciones anteriores):\n";
    const labels = { personal: "Datos personales", tech: "Contexto técnico", preference: "Preferencias", fact: "Hechos relevantes" };
    for (const [cat, items] of Object.entries(grouped)) {
      text += `\n[${labels[cat] || cat}]\n`;
      for (const item of items) {
        text += `- ${item.content}\n`;
      }
    }

    // Disparar touch para actualizar LRU (fire-and-forget).
    const ids = memories.map((m) => m.id);
    if (ids.length > 0) {
      fetch("/api/memories/touch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      }).catch(() => {});
    }

    return text;
  } catch (e) {
    console.warn("[memory] Error cargando memorias cross-chat:", e);
    return "";
  }
}

/**
 * Extrae posibles memorias de la última respuesta del asistente y las guarda.
 * Usa Puter/GLM-Flash (gratis) para identificar datos dignos de recordar.
 * Fire-and-forget: nunca bloquea el flujo principal.
 */
async function extractAndSaveMemories(lastAssistantText) {
  try {
    if (!lastAssistantText || lastAssistantText.length < 50) return;

    const prompt = `Analiza este mensaje de un asistente de IA. Identifica si hay datos personales, preferencias, o información contextual del usuario que valga la pena recordar para conversaciones futuras.

Importante:
- Solo extrae hechos concretos y relevantes (nombre, rol, preferencias técnicas, datos de proyectos, etc.).
- NO extraigas información genérica o transaccional.
- Si no hay nada digno de recordar, responde exactamente: []

Mensaje del asistente:
${lastAssistantText.slice(-3000)}

Responde SOLO un JSON array de objetos con formato: [{"content": "...", "category": "personal|tech|preference|fact", "importance": 1-5}]
No incluyas nada más que el JSON array.`;

    const llmResp = await fetch("/api/llm/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, max_tokens: 800 }),
    });
    if (!llmResp.ok) return;
    const text = (((await llmResp.json().catch(() => null)) || {}).text || "").trim();
    if (!text || text === "[]" || !text.startsWith("[")) return;

    let memories;
    try { memories = JSON.parse(text); } catch { return; }
    if (!Array.isArray(memories) || memories.length === 0) return;

    // Limitar a 5 memorias por respuesta para evitar spam.
    const batch = memories.slice(0, 5).map((m) => ({
      content: String(m.content || "").slice(0, 2000),
      category: ["personal", "tech", "preference", "fact"].includes(m.category) ? m.category : "fact",
      importance: Math.max(1, Math.min(5, parseInt(m.importance) || 3)),
    })).filter((m) => m.content.length >= 10);

    if (batch.length === 0) return;

    await fetch("/api/memories/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        memories: batch,
        source_chat_id: state.currentChat?.id || null,
      }),
    });
    console.log(`[memory] ${batch.length} memorias extraídas y guardadas`);
  } catch (e) {
    console.warn("[memory] Error extrayendo memorias:", e);
  }
}

// Cache en memoria de las últimas memorias cargadas (evita fetch en cada iteración).
let _cachedMemoriesText = "";
let _cachedMemoriesChatId = null;
let _cachedMemoriesTs = 0;
const MEMORIES_CACHE_TTL = 60_000; // 1 minuto de caché.

/**
 * Devuelve las memorias cross-chat formateadas, con caché por chat.
 */
async function getMemoryContextText() {
  const chatId = state.currentChat?.id;
  const now = Date.now();
  if (_cachedMemoriesChatId === chatId && now - _cachedMemoriesTs < MEMORIES_CACHE_TTL) {
    return _cachedMemoriesText;
  }
  _cachedMemoriesText = await loadCrossChatMemories();
  _cachedMemoriesChatId = chatId;
  _cachedMemoriesTs = now;
  return _cachedMemoriesText;
}

/**
 * Invalida el caché de memorias (ej: al cambiar de chat).
 */
function invalidateMemoryCache() {
  _cachedMemoriesText = "";
  _cachedMemoriesChatId = null;
  _cachedMemoriesTs = 0;
}

async function callModel(userContent, previousAssistantText, isFollowUp) {
  // ── Ruta Agente: orquestar vía agentOrchestrator.js ──
  // runAgentLoop maneja: deepThinking → Ultra, trigger phrases, attachments,
  // escalamiento dinámico <escalate_to_ultra>, fallback entre modelos.
  if (state.currentRole === "agent") {
    // Cargar memorias cross-chat y skills.
    const memoryText = await getMemoryContextText();
    const skillMode = getSkillMode(state.currentRole); // "auto" para agente
    const skillsBlock = skillMode
      ? await buildSkillsPromptBlock(state.settings, state.currentRole, skillMode)
      : "";

    // Construir contexto SIN system prompt — el Worker lo inyecta.
    // Skills y memorias se pasan como campos separados al Worker,
    // NO como mensajes system (antes se filtraban y se perdían).
    const currentUserMsg = { role: "user", content: userContent };
    const { context } = ContextManager.buildContext({
      messages: state.messages,
      currentModelId: state.currentModel,
      currentUserMsg: isFollowUp ? null : currentUserMsg,
      summary: state.chatSummary,
      systemPrompt: null,
    });
    const finalContext = ContextManager.truncateToolResults(context);

    // Crear AbortController para el loop del agente.
    state.abortController = new AbortController();
    setEntityState("processing");
    showStreamingIndicator(t("stream.processing"), "processing");

    let result;
    try {
      result = await runAgentLoop(finalContext, state.pendingAttachments, {
        signal: state.abortController.signal,
        chatId: state.currentChat.id,
        toggles: state.toggles,
        // Pasar skills y memorias para que el Worker los appendee al system prompt.
        skillsBlock: skillsBlock || null,
        memoryBlock: memoryText || null,
        modelId: getPreferredAgentModel(),
        onDelta: (text) => {
          hideStreamingIndicator();
          updateStreamingMessage(text);
        },
        onThinking: (thinkingContent) => {
          showStreamingIndicator(t("stream.thinking"), "thinking");
        },
      });

      // Actualizar cached total.
      if (result.cached_tokens > 0) state.chatCachedTotal += result.cached_tokens;

      // Mostrar banner de transparencia si hubo fallback.
      if (result.fallback_used) {
        const info = getModelDisplayInfo(result.fallback_used);
        toast(t("model.changed", { model: `${info.icon} ${info.shortName}`, old: "" }), "info", 4000);
      }

      // Retornar en el mismo formato que callPuter/callOpenRouter.
      return {
        text: result.text,
        thinking_content: result.thinking_content,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        cached_tokens: result.cached_tokens,
        aborted: result.aborted,
        model: result.model_used,
      };
    } finally {
      state.abortController = null;
    }
  }

  // ── Ruta normal (coder, general): Puter u OpenRouter directo ──
  const provider = getProvider(state.currentModel);

  // Cargar memorias cross-chat para inyectar en contexto.
  const memoryText = await getMemoryContextText();
  const memorySystemMsg = memoryText
    ? [{ role: "system", content: memoryText }]
    : [];

  // Construir contexto con ContextManager.
  // Skills se inyectan vía getSystemPrompt() (async), NO como mensaje separado.
  // Esto elimina la duplicación previa donde skills aparecían twice.
  const currentUserMsg = { role: "user", content: userContent };
  const { context } = ContextManager.buildContext({
    messages: [...memorySystemMsg, ...state.messages],
    currentModelId: state.currentModel,
    currentUserMsg: isFollowUp ? null : currentUserMsg,
    summary: state.chatSummary,
    systemPrompt: await getSystemPrompt(),
  });

  // Aplicar truncado de tool results.
  const finalContext = ContextManager.truncateToolResults(context);

  return await callOpenRouterWithRetry(finalContext);
}

// v2.5 — Reconexión SSE con backoff (hasta 3 intentos) si el stream se corta.
async function callOpenRouterWithRetry(messages) {
  let attempt = 0;
  const maxAttempts = 3;
  for (;;) {
    try {
      const result = await callOpenRouter(messages);
      if (result && result.aborted) return result;
      return result;
    } catch (err) {
      // Rate limit: aviso silencioso, sin reintentos agresivos.
      if (err && err.error === "rate_limited") {
        toast((err && err.message) || "Límite temporal de peticiones. Intenta en unos segundos.", "warning", 4000);
        throw err;
      }
      const isOffline = state && state.isOffline;
      if (isOffline || (err && err.message === "stream_interrupted" && attempt >= maxAttempts - 1)) throw err;
      attempt++;
      if (attempt >= maxAttempts) throw err;
      const wait = Math.min(4000, 1000 * Math.pow(2, attempt - 1));
      toast("Reconectando… (intento " + (attempt + 1) + "/" + maxAttempts + ")", "info", 2500);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function callOpenRouter(messages) {
  setEntityState("processing");
  showStreamingIndicator(t("stream.processing"), "processing");

  // P0-4: AbortController para cancelar el fetch + reader.
  state.abortController = new AbortController();
  const signal = state.abortController.signal;

  let text = "";
  let thinkingContent = "";
  let tokens_in = 0, tokens_out = 0, cached_tokens = 0;

  try {
    const body = {
      model: state.currentModel,
      messages,
      stream: true,
      chat_id: state.currentChat.id,
      is_shared: state.currentChat.is_shared,
      settings: state.settings.tokens,
    };
    if (state.toggles.thinking && state.currentModel.includes("nemotron")) {
      body.reasoning = { effort: "high" };
    }
    // v2.5: caché opt-in de respuestas repetidas (solo chats propios, no compartidos).
    if (!state.currentChat || !state.currentChat.is_shared) {
      body.cache = true;
    }

    const resp = await fetch("/api/chat/openrouter", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-veritas-role": state.currentRole },
      body: JSON.stringify(body),
      signal, // P0-4: abort del fetch inicial
    });

    if (signal.aborted) {
      return { text, thinking_content: thinkingContent, tokens_in, tokens_out, cached_tokens, aborted: true };
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw { error: err.error || "upstream_error", message: err.message || `HTTP ${resp.status}`, retry_after_ms: err.retry_after_ms };
    }

    // Parsear SSE.
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstToken = true;
    let sawDone = false; // v2.5: para detectar cortes del stream

    while (true) {
      // P0-4: check abort antes de cada read.
      if (signal.aborted) {
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
        if (data === "[DONE]") { sawDone = true; continue; }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            if (firstToken) { firstToken = false; hideStreamingIndicator(); }
            text += delta.content;
            updateStreamingMessage(text);
          }
          if (delta?.reasoning) {
            thinkingContent += delta.reasoning;
            updateReasoningStream(thinkingContent);
          }
          if (json.usage) {
            tokens_in = json.usage.prompt_tokens || 0;
            tokens_out = json.usage.completion_tokens || 0;
            cached_tokens = json.usage.prompt_tokens_details?.cached_tokens || 0;
          }
        } catch (e) { /* skip malformed */ }
      }
    }

    // P0-4: si fue abortado, devolver partial sin lanzar error.
    if (signal.aborted) {
      return { text, thinking_content: thinkingContent, tokens_in, tokens_out, cached_tokens, aborted: true };
    }

    // Separar razonamiento embebido.
    const thinkMatch = text.match(/<razonamiento_interno>([\s\S]*?)<\/razonamiento_interno>/);
    if (thinkMatch) {
      if (!thinkingContent) thinkingContent = thinkMatch[1].trim();
      text = text.replace(/<razonamiento_interno>[\s\S]*?<\/razonamiento_interno>/, "").trim();
    }

    // Actualizar cached total.
    if (cached_tokens > 0) state.chatCachedTotal += cached_tokens;

    return { text, thinking_content: thinkingContent, tokens_in, tokens_out, cached_tokens };
  } catch (e) {
    // P0-4: AbortError se lanza cuando el fetch se cancela. Devolver partial.
    if (signal.aborted || e?.name === "AbortError") {
          // v2.5: si el stream terminó sin [DONE] y sin abort manual → corte de red.
    if (!sawDone && !signal.aborted && text.length > 0) {
      throw new Error("stream_interrupted");
    }
return { text, thinking_content: thinkingContent, tokens_in, tokens_out, cached_tokens, aborted: true };
    }
    throw e;
  } finally {
    state.abortController = null;
  }
}

// ==============================================================================
// STREAMING INDICATOR — mini-diálogos rotativos (tema OSINT)
// ==============================================================================
let _rotatingTimer = null;
let _rotatingIdx = 0;
const STREAM_ROTATION_MS = 2400;

function stopRotatingLines() {
  if (_rotatingTimer) {
    clearInterval(_rotatingTimer);
    _rotatingTimer = null;
  }
}

function startRotatingLines(mode) {
  stopRotatingLines();
  const el = $("#streamingText");
  if (!el) return;
  const lines = (mode === "thinking" ? t("stream.linesThinking") : t("stream.linesProcessing")) || [];
  if (!lines.length) return;
  _rotatingIdx = 0;
  const apply = () => {
    el.textContent = lines[_rotatingIdx % lines.length];
    _rotatingIdx++;
  };
  apply();
  _rotatingTimer = setInterval(apply, STREAM_ROTATION_MS);
}

function showStreamingIndicator(text, mode) {
  const ind = $("#streamingIndicator");
  if (!ind) return;
  show(ind);
  if (mode === "processing" || mode === "thinking") {
    startRotatingLines(mode);
  } else {
    stopRotatingLines();
    $("#streamingText").textContent = text || "";
  }
}

function hideStreamingIndicator() {
  stopRotatingLines();
  hide($("#streamingIndicator"));
}

let _streamingMsgEl = null;
let _reasoningEl = null;
// v2.8.3: razonamiento en streaming, colapsado, SOBRE la burbuja de respuesta.
function updateReasoningStream(thinkingText) {
  const container = $("#messagesContainer");
  if (!container) return;
  if (!_reasoningEl) {
    _reasoningEl = document.createElement("details");
    _reasoningEl.className = "reasoning-stream";
    _reasoningEl.innerHTML = '<summary>🧠 Razonamiento en progreso — análisis (desplegar)</summary><pre class="reasoning-body"></pre>';
    container.appendChild(_reasoningEl);
  }
  _reasoningEl.querySelector(".reasoning-body").textContent = thinkingText.slice(-6000);
  scrollToBottom();
}
function clearReasoningStream() {
  if (_reasoningEl) { _reasoningEl.remove(); _reasoningEl = null; }
}

function updateStreamingMessage(text) {
  if (!_streamingMsgEl) {
    const container = $("#messagesContainer");
    const tpl = $("#messageTemplate");
    const node = tpl.content.cloneNode(true);
    _streamingMsgEl = node.querySelector(".message");
    _streamingMsgEl.classList.add("assistant", "streaming");
    _streamingMsgEl.querySelector(".message-avatar").textContent = "V";
    const info = getModelDisplayInfo(state.currentModel);
    _streamingMsgEl.querySelector(".message-author").textContent =
      (info.shortName && info.shortName !== state.currentModel)
        ? `${info.icon} ${info.shortName}`
        : state.currentModel;
    container.appendChild(_streamingMsgEl);
    scrollToBottom();
  }
  _streamingMsgEl.querySelector(".message-body").innerHTML = sanitizeHTML(formatMessageContent(text));
  scrollToBottom();
}

function clearStreamingMessage() {
  _streamingMsgEl = null;
}

// ==============================================================================
// TOOL EXECUTION
// ==============================================================================
function entityStateForTool(toolName) {
  if (/search|scrape|crawl|reader|gdelt|jina|firecrawl|spider|rover/i.test(toolName)) return "searching";
  if (/github|write|preview|template|browserless|browser_use|steel|code|project/i.test(toolName)) return "coding";
  return "tooling";
}

async function executeToolCall(call) {
  // v2.8.1: las tools NO renderizan burbuja propia; el canvas de entidad y
  // los chips 🔧 dentro del mensaje del agente son el único indicador visible.
  const startTs = Date.now();
  setEntityState(entityStateForTool(call.name));
  try {
    const resp = await fetch("/api/tool/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-veritas-role": state.currentRole },
      body: JSON.stringify({ tool: call.name, args: call.args, chat_id: state.currentChat.id }),
    });
    const data = await resp.json();
    const latency = Date.now() - startTs;

    // Detectar marcadores especiales en el output.
    if (data.output && data.output.includes("[[VERITAS_PREVIEW_HTML:")) {
      const match = data.output.match(/\[\[VERITAS_PREVIEW_HTML:([^\]]+)\]\]/);
      if (match) loadPreviewFromR2(match[1]);
    }
    if (data.output && data.output.includes("[[VERITAS_LOAD_TEMPLATE:")) {
      const match = data.output.match(/\[\[VERITAS_LOAD_TEMPLATE:([^:]+):([^\]]+)\]\]/);
      if (match) {
        const [, name, paramsJson] = match;
        try {
          const params = JSON.parse(paramsJson);
          loadTemplate(name, params);
        } catch (e) { /* skip */ }
      }
    }

    // Notificación si tardó >10s y pestaña oculta.
    if (latency > 10000) {
      window.dispatchEvent(new CustomEvent("shared:event", {
        detail: { type: "tool_completed", payload: { tool: call.name, latency_ms: latency } },
      }));
    }
  } catch (e) {
    setEntityState("error");
  }
}

// ==============================================================================
// FALLBACK
// ==============================================================================
async function tryFallback(error) {
  const next = getNextFallback(state.currentRole, state.currentModel);
  if (!next || isFallbackExhausted(state.currentRole, state.currentModel)) {
    toast(t("model.fallbackExhausted"), "error");
    return;
  }

  // v2.8.1: fallback siempre automático y silencioso — sin molestar al usuario.
  state.currentModel = next;
  state.currentRole = resolveUiRoleForCurrentSelection(next);
  populateModelSelector();
  renderChatHeader();
  await runChatWithTools(state.messages[state.messages.length - 1].content);
}

// ==============================================================================
// SANDBOX
// ==============================================================================
function parseFileBlocks(text) {
  const regex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
  let match;
  let found = false;
  const hadFilesBefore = Object.keys(state.sandbox.files).length > 0;
  if (hadFilesBefore && regex.test(text)) {
    createSandboxSnapshot("before-ai-update");
    regex.lastIndex = 0;
  }
  while ((match = regex.exec(text)) !== null) {
    const path = match[1];
    const content = match[2];
    state.sandbox.files[path] = content;
    found = true;
  }
  if (found) {
    renderSandboxTree();
    if (!state.sandbox.activeFile) {
      const firstPath = Object.keys(state.sandbox.files)[0];
      openSandboxFile(firstPath);
    }
    refreshPreview();
    showSandbox();
  }
}

function renderSandboxTree() {
  const tree = $("#sandboxTree");
  if (!tree) return;
  tree.innerHTML = "";
  const paths = Object.keys(state.sandbox.files);
  if (paths.length === 0) {
    tree.innerHTML = `<div class="empty-tree">${t("sandbox.emptyTree")}</div>`;
    return;
  }
  paths.forEach((path) => {
    const item = document.createElement("div");
    item.className = "tree-item";
    if (path === state.sandbox.activeFile) item.classList.add("active");
    const ext = path.split(".").pop().toLowerCase();
    const icon = { html: "🌐", css: "🎨", js: "⚙", json: "📋", md: "📝" }[ext] || "📄";
    item.innerHTML = `<span class="tree-icon">${icon}</span><span>${path}</span>`;
    item.addEventListener("click", () => openSandboxFile(path));
    tree.appendChild(item);
  });
}

function openSandboxFile(path) {
  state.sandbox.activeFile = path;
  $$(".tree-item").forEach((it) => it.classList.remove("active"));
  renderSandboxTree(); // re-render para marcar activo.

  // Actualizar editor.
  const host = $("#sandboxEditorHost");
  if (!host) return;
  host.innerHTML = "";
  const textarea = document.createElement("textarea");
  textarea.value = state.sandbox.files[path] || "";
  host.appendChild(textarea);

  if (typeof CodeMirror !== "undefined") {
    const ext = path.split(".").pop().toLowerCase();
    const mode = { html: "htmlmixed", css: "css", js: "javascript", json: "application/json", md: "markdown", py: "python" }[ext] || "text/plain";
    state.sandbox.editor = CodeMirror.fromTextArea(textarea, {
      mode,
      theme: "material-darker",
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2,
    });
    state.sandbox.editor.on("change", () => {
      state.sandbox.files[path] = state.sandbox.editor.getValue();
      debouncedRefreshPreview();
    });
  }
}

function refreshPreview() {
  if (state.sandbox.previewThrottleTimer) clearTimeout(state.sandbox.previewThrottleTimer);
  state.sandbox.previewThrottleTimer = setTimeout(() => {
    resetSandboxRuntimeState();
    const html = buildSandboxHTML();
    const iframe = $("#sandboxPreview");
    if (iframe) {
      const blob = new Blob([html], { type: "text/html" });
      if (state.sandbox.previewUrl) URL.revokeObjectURL(state.sandbox.previewUrl);
      state.sandbox.previewUrl = URL.createObjectURL(blob);
      iframe.src = state.sandbox.previewUrl;
    }
  }, 300);
}

const debouncedRefreshPreview = debounce(refreshPreview, 300);

function resetSandboxRuntimeState() {
  state.sandbox.consoleEntries = [];
  state.sandbox.networkEntries = [];
  state.sandbox.testEntries = [];
  state.sandbox.lastError = null;
  hide($("#sandboxErrorOverlay"));
  renderSandboxConsole();
  renderSandboxNetwork();
  renderSandboxTests();
}

function buildSandboxHTML() {
  let html = state.sandbox.files["index.html"] || "<!DOCTYPE html><html><body>Sin index.html</body></html>";

  // Inyectar CSP si no está.
  if (!/Content-Security-Policy/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>\n  <meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data:; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://esm.sh; style-src 'unsafe-inline' https:; img-src https: data:; connect-src https:;">`);
    }
  }

  // Reemplazar <link rel="stylesheet" href="styles.css"> con <style> inline.
  html = html.replace(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["']\s*\/?>/gi, (match, href) => {
    const content = state.sandbox.files[href];
    return content ? `<style>\n${content}\n</style>` : match;
  });

  // Reemplazar <script src="app.js"></script> con <script> inline.
  html = html.replace(/<script\s+src=["']([^"']+)["']\s*><\/script>/gi, (match, src) => {
    const content = state.sandbox.files[src];
    return content ? `<script>\n${content}\n</script>` : match;
  });

  return injectSandboxInstrumentation(html);
}

function injectSandboxInstrumentation(html) {
  const script = `<script>
(() => {
  const send = (type, payload) => parent.postMessage({ source: 'veritas-sandbox', type, payload }, '*');
  const serialize = (value) => {
    try {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    } catch { return String(value); }
  };

  ['log', 'info', 'warn', 'error'].forEach((level) => {
    const original = console[level]?.bind(console);
    console[level] = (...args) => {
      send('console', { level, args: args.map(serialize), ts: Date.now() });
      original?.(...args);
    };
  });

  window.addEventListener('error', (event) => {
    send('error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error?.stack || '',
      ts: Date.now(),
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    send('error', {
      message: 'Unhandled promise rejection: ' + serialize(event.reason),
      stack: event.reason?.stack || '',
      ts: Date.now(),
    });
  });

  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = async (...args) => {
      const started = performance.now();
      const url = serialize(args[0]);
      try {
        const response = await originalFetch(...args);
        send('network', { url, status: response.status, ok: response.ok, ms: Math.round(performance.now() - started), ts: Date.now() });
        return response;
      } catch (error) {
        send('network', { url, status: 'ERR', ok: false, error: serialize(error), ms: Math.round(performance.now() - started), ts: Date.now() });
        throw error;
      }
    };
  }

  async function runTests() {
    const tests = Array.isArray(window.__veritasTests) ? window.__veritasTests : [];
    const results = [];
    for (const test of tests) {
      const name = test?.name || 'unnamed test';
      const started = performance.now();
      try {
        const pass = typeof test?.run === 'function' ? await test.run() : false;
        results.push({ name, status: pass ? 'pass' : 'fail', ms: Math.round(performance.now() - started) });
      } catch (error) {
        results.push({ name, status: 'error', error: serialize(error), ms: Math.round(performance.now() - started) });
      }
    }
    send('tests', { results, total: tests.length, ts: Date.now() });
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source === 'veritas-parent' && event.data?.type === 'run-tests') runTests();
  });
  window.addEventListener('load', () => setTimeout(runTests, 50));
  send('ready', { ts: Date.now() });
})();
<\/script>`;

  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${script}\n</body>`);
  return `${html}\n${script}`;
}

function handleSandboxMessage(event) {
  const data = event.data || {};
  if (data.source !== "veritas-sandbox") return;

  switch (data.type) {
    case "console":
      state.sandbox.consoleEntries.push(data.payload);
      renderSandboxConsole();
      break;
    case "network":
      state.sandbox.networkEntries.push(data.payload);
      renderSandboxNetwork();
      break;
    case "tests":
      state.sandbox.testEntries = data.payload?.results || [];
      renderSandboxTests();
      if ((data.payload?.total || 0) > 0) showSandboxPanel("tests");
      break;
    case "error":
      state.sandbox.lastError = data.payload;
      state.sandbox.consoleEntries.push({ level: "error", args: [data.payload.message || "Preview error"], ts: Date.now() });
      renderSandboxConsole();
      showSandboxError(data.payload);
      break;
  }
}

function showSandboxPanel(panel) {
  show($("#sandboxBottomPanel"));
  $$("#sandboxBottomPanel .panel-tab[data-panel]").forEach((btn) => btn.classList.toggle("active", btn.dataset.panel === panel));
  ["console", "network", "tests", "diff"].forEach((name) => {
    const el = $(`#panel${name.charAt(0).toUpperCase() + name.slice(1)}`);
    if (el) el.hidden = name !== panel;
  });
}

function renderSandboxConsole() {
  const el = $("#panelConsole");
  if (!el) return;
  if (state.sandbox.consoleEntries.length === 0) {
    el.innerHTML = `<div class="panel-empty">Console sin eventos todavía.</div>`;
    return;
  }
  el.innerHTML = state.sandbox.consoleEntries.slice(-200).map((entry) => {
    const level = escapeHTML(entry.level || "log");
    const text = escapeHTML((entry.args || []).join(" "));
    return `<div class="sandbox-log ${level}"><span>${level}</span><code>${text}</code></div>`;
  }).join("");
  el.scrollTop = el.scrollHeight;
}

function renderSandboxNetwork() {
  const el = $("#panelNetwork");
  if (!el) return;
  if (state.sandbox.networkEntries.length === 0) {
    el.innerHTML = `<div class="panel-empty">Network sin requests capturadas.</div>`;
    return;
  }
  el.innerHTML = state.sandbox.networkEntries.slice(-200).map((entry) => {
    const ok = entry.ok ? "ok" : "fail";
    return `<div class="sandbox-network ${ok}"><strong>${escapeHTML(entry.status)}</strong><span>${escapeHTML(entry.url)}</span><em>${entry.ms || 0}ms</em></div>`;
  }).join("");
}

function renderSandboxTests() {
  const el = $("#panelTests");
  if (!el) return;
  if (!state.sandbox.testEntries.length) {
    el.innerHTML = `<div class="panel-empty">Define <code>window.__veritasTests</code> en tu artefacto y pulsa Tests.</div>`;
    return;
  }
  const passed = state.sandbox.testEntries.filter((t) => t.status === "pass").length;
  el.innerHTML = `<div class="sandbox-tests-summary">${passed}/${state.sandbox.testEntries.length} tests OK</div>` +
    state.sandbox.testEntries.map((t) => `
      <div class="sandbox-test ${escapeHTML(t.status)}">
        <strong>${t.status === "pass" ? "✅" : "❌"} ${escapeHTML(t.name)}</strong>
        <span>${t.ms || 0}ms</span>
        ${t.error ? `<pre>${escapeHTML(t.error)}</pre>` : ""}
      </div>`).join("");
}

function showSandboxError(err) {
  const overlay = $("#sandboxErrorOverlay");
  const text = $("#sandboxErrorText");
  if (!overlay || !text) return;
  const details = [err.message, err.filename ? `${err.filename}:${err.lineno || "?"}:${err.colno || "?"}` : "", err.stack || ""].filter(Boolean).join("\n");
  text.textContent = details.slice(0, 4000);
  show(overlay);
  showSandboxPanel("console");
}

function runSandboxTests() {
  const iframe = $("#sandboxPreview");
  iframe?.contentWindow?.postMessage({ source: "veritas-parent", type: "run-tests" }, "*");
  showSandboxPanel("tests");
}

function repairSandboxWithCoder() {
  const err = state.sandbox.lastError;
  if (!err) return toast("No hay error capturado", "warning");
  const filesSummary = Object.keys(state.sandbox.files).map((p) => `- ${p}`).join("\n");
  const promptText = `Actúa como Coder de Véritas. Repara el sandbox estático respetando estas reglas: solo HTML/CSS/JS/CDN, sin npm ni backend persistente.\n\nError capturado en Live Preview:\n${err.message || "Error desconocido"}\n${err.filename || ""}:${err.lineno || "?"}:${err.colno || "?"}\n${err.stack || ""}\n\nArchivos actuales:\n${filesSummary}\n\nDevuelve los archivos corregidos usando bloques <file path="...">...</file> y explica brevemente la causa.`;
  const input = $("#messageInput");
  if (input) {
    input.value = promptText;
    autoResize(input);
    input.focus();
  }
  toast("Prompt de reparación preparado para Coder", "info", 4000);
}

function showSandbox(tab = "sandbox") {
  const panel = $("#rightPanel");
  if (panel) panel.hidden = false;
  if (tab === "sandbox") show($("#sandbox"));
  switchRightTab(tab);
  $(".app-layout")?.classList.remove("sandbox-hidden");
}

function showProjectPanel() { showSandbox("project"); }
function showGraphPanel() { showSandbox("graph"); }

function toggleSandbox() {
  const layout = $(".app-layout");
  const panel = $("#rightPanel");
  if (!layout || !panel) return;
  if (layout.classList.contains("sandbox-hidden")) {
    layout.classList.remove("sandbox-hidden");
    panel.hidden = false;
  } else {
    layout.classList.add("sandbox-hidden");
    panel.hidden = true;
  }
}

function switchRightTab(name) {
  const tabs = document.querySelectorAll(".rtab");
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.rtab === name));
  ["sandbox", "project", "graph"].forEach((v) => {
    const el = document.getElementById("view-" + v);
    if (el) el.hidden = v !== name;
  });
  if (name === "project") renderProjectTree();
  if (name === "graph") renderEntityGraph();
}

function clearSandbox() {
  if (Object.keys(state.sandbox.files).length > 0) createSandboxSnapshot("before-clear");
  state.sandbox.files = {};
  state.sandbox.activeFile = null;
  if (state.sandbox.editor) state.sandbox.editor.toTextArea();
  state.sandbox.editor = null;
  $("#sandboxEditorHost").innerHTML = "";
  renderSandboxTree();
  refreshPreview();
}

function loadTemplate(name, params = {}) {
  try {
    if (Object.keys(state.sandbox.files).length > 0) createSandboxSnapshot("before-template");
    const tpl = getTemplate(name, params);
    tpl.files.forEach((f) => { state.sandbox.files[f.path] = f.content; });
    renderSandboxTree();
    if (tpl.files.length > 0) openSandboxFile(tpl.files[0].path);
    refreshPreview();
    showSandbox();
    toast(`Plantilla "${name}" cargada`, "success");
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}

function addLibrary(lib) {
  const urls = {
    leaflet: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    maplibre: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js",
    three: "https://unpkg.com/three@0.160.0/build/three.min.js",
    babylon: "https://cdn.babylonjs.com/babylon.js",
    chartjs: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
    d3: "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js",
    plotly: "https://cdn.plot.ly/plotly-2.27.0.min.js",
    echarts: "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js",
    tailwind: "https://cdn.tailwindcss.com",
    alpine: "https://cdn.jsdelivr.net/npm/alpinejs@3/dist/cdn.min.js",
    htmx: "https://unpkg.com/htmx.org@1.9.10",
    anime: "https://cdn.jsdelivr.net/npm/animejs@3.2.1/lib/anime.min.js",
    gsap: "https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js",
    papaparse: "https://cdn.jsdelivr.net/npm/papaparse@5/papaparse.min.js",
    dexie: "https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.min.js",
    sqljs: "https://cdn.jsdelivr.net/npm/sql.js@1/dist/sql-wasm.js",
    katex: "https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.js",
    mathjs: "https://cdn.jsdelivr.net/npm/mathjs@12/lib/browser/math.min.js",
  };
  const url = urls[lib];
  if (!url) return;
  // Inyectar en el index.html del sandbox.
  let html = state.sandbox.files["index.html"] || "<!DOCTYPE html><html><head></head><body></body></html>";
  if (/<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `<script src="${url}"></script>\n</head>`);
  } else {
    html = `<script src="${url}"></script>\n${html}`;
  }
  state.sandbox.files["index.html"] = html;
  if (state.sandbox.activeFile === "index.html" && state.sandbox.editor) {
    state.sandbox.editor.setValue(html);
  }
  refreshPreview();
  toast(`Librería ${lib} añadida`, "success");
}

function sandboxSnapshotKey() {
  return `veritas:sandbox:snapshots:${state.currentChat?.id || "global"}`;
}

function loadSandboxSnapshots() {
  try {
    state.sandbox.snapshots = JSON.parse(localStorage.getItem(sandboxSnapshotKey()) || "[]");
  } catch {
    state.sandbox.snapshots = [];
  }
}

function persistSandboxSnapshots() {
  try {
    localStorage.setItem(sandboxSnapshotKey(), JSON.stringify(state.sandbox.snapshots.slice(-12)));
  } catch { /* localStorage quota best-effort */ }
}

function createSandboxSnapshot(label = "manual") {
  const paths = Object.keys(state.sandbox.files);
  if (paths.length === 0) return toast("No hay archivos para snapshot", "warning");
  loadSandboxSnapshots();
  const snapshot = {
    id: crypto.randomUUID(),
    label,
    created_at: new Date().toISOString(),
    activeFile: state.sandbox.activeFile,
    files: JSON.parse(JSON.stringify(state.sandbox.files)),
  };
  state.sandbox.snapshots.push(snapshot);
  persistSandboxSnapshots();
  toast(`Snapshot guardado (${paths.length} archivos)`, "success");
  return snapshot;
}

async function restoreSandboxSnapshot() {
  loadSandboxSnapshots();
  if (state.sandbox.snapshots.length === 0) return toast("No hay snapshots", "warning");
  const latest = state.sandbox.snapshots[state.sandbox.snapshots.length - 1];
  const label = `${latest.label} · ${new Date(latest.created_at).toLocaleString()}`;
  if (!(await showConfirm(`Restaurar último snapshot?\n${label}`, { title: "Restaurar snapshot", okLabel: "Restaurar" }))) return;
  state.sandbox.files = JSON.parse(JSON.stringify(latest.files));
  state.sandbox.activeFile = latest.activeFile || Object.keys(state.sandbox.files)[0] || null;
  renderSandboxTree();
  if (state.sandbox.activeFile) openSandboxFile(state.sandbox.activeFile);
  refreshPreview();
  showSandbox();
  toast("Snapshot restaurado", "success");
}

function showSandboxDiff() {
  loadSandboxSnapshots();
  if (state.sandbox.snapshots.length === 0) return toast("No hay snapshot para comparar", "warning");
  const latest = state.sandbox.snapshots[state.sandbox.snapshots.length - 1];
  const diff = buildSandboxDiff(latest.files, state.sandbox.files);
  const panel = $("#panelDiff");
  if (panel) panel.innerHTML = diff || `<div class="panel-empty">Sin cambios desde el último snapshot.</div>`;
  showSandboxPanel("diff");
}

function buildSandboxDiff(before, after) {
  const paths = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
  return paths.map((path) => {
    const a = before?.[path];
    const b = after?.[path];
    if (a === b) return "";
    if (a === undefined) return `<div class="diff-file"><h4>+ ${escapeHTML(path)}</h4><pre>${escapeHTML(String(b)).split("\n").map(l => `+ ${l}`).join("\n")}</pre></div>`;
    if (b === undefined) return `<div class="diff-file"><h4>- ${escapeHTML(path)}</h4><pre>${escapeHTML(String(a)).split("\n").map(l => `- ${l}`).join("\n")}</pre></div>`;
    return `<div class="diff-file"><h4>Δ ${escapeHTML(path)}</h4><pre>${escapeHTML(simpleLineDiff(String(a), String(b)))}</pre></div>`;
  }).filter(Boolean).join("");
}

function simpleLineDiff(before, after) {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const max = Math.max(oldLines.length, newLines.length);
  const out = [];
  for (let i = 0; i < max; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      if (oldLine !== undefined) out.push(`  ${oldLine}`);
    } else {
      if (oldLine !== undefined) out.push(`- ${oldLine}`);
      if (newLine !== undefined) out.push(`+ ${newLine}`);
    }
  }
  return out.join("\n");
}

async function exportZip() {
  if (typeof JSZip === "undefined") return toast("JSZip no cargado", "error");
  const zip = new JSZip();
  for (const [path, content] of Object.entries(state.sandbox.files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "veritas-sandbox.zip";
  a.click();
  URL.revokeObjectURL(url);
  toast(t("sandbox.zipReady"), "success");
}

function downloadActiveFile() {
  if (!state.sandbox.activeFile) return toast("Sin archivo activo", "warning");
  const content = state.sandbox.files[state.sandbox.activeFile];
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.sandbox.activeFile.split("/").pop();
  a.click();
  URL.revokeObjectURL(url);
  toast(t("sandbox.downloaded"), "success");
}

async function copyActiveFile() {
  if (!state.sandbox.activeFile) return toast("Sin archivo activo", "warning");
  const content = state.sandbox.files[state.sandbox.activeFile];
  try {
    await navigator.clipboard.writeText(content);
    toast(t("sandbox.copied"), "success");
  } catch (e) {
    toast("No se pudo copiar", "error");
  }
}

function openInBrowser() {
  if (!state.sandbox.activeFile) return toast("Sin archivo activo", "warning");
  const html = buildSandboxHTML();
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

async function pushToGithub() {
  // Requiere conexión GitHub activa.
  const files = Object.entries(state.sandbox.files).map(([path, content]) => ({ path, content }));
  if (files.length === 0) return toast("Sin archivos", "warning");

  const owner = prompt("Owner (usuario/organización GitHub):");
  if (!owner) return;
  const repo = prompt("Repo:");
  if (!repo) return;
  const branch = prompt("Branch (default: main):") || "main";
  const message = prompt("Commit message:") || "Update from Véritas Sandbox";

  try {
    const resp = await fetch("/api/tool/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-veritas-role": state.currentRole },
      body: JSON.stringify({
        tool: "github_write_files",
        args: { owner, repo, branch, files, message },
      }),
    });
    const data = await resp.json();
    if (data.status === "ok") {
      toast(t("sandbox.pushedGithub"), "success");
    } else {
      setEntityState("error");
      toast(`Error: ${data.output}`, "error", 5000);
    }
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}

async function loadPreviewFromR2(filename) {
  // Cargar HTML desde R2 vía endpoint de descarga.
  try {
    const resp = await fetch(`/api/storage/download/${filename}`);
    if (resp.ok) {
      const html = await resp.text();
      state.sandbox.files["index.html"] = html;
      renderSandboxTree();
      openSandboxFile("index.html");
      refreshPreview();
      showSandbox();
    }
  } catch (e) { /* skip */ }
}

// ==============================================================================
// SHARED SESSION
// ==============================================================================
async function startSharedSession() {
  if (!state.currentChat?.is_shared) return;
  if (state.sharedSession) state.sharedSession.stop();
  state.sharedSession = new SharedSessionManager({
    chatId: state.currentChat.id,
    currentUserEmail: state.user_email,
    isOwner: state.currentChat.user_email === state.user_email,
  });
  state.sharedSession.turnDurationMin = state.settings.shared.turnDuration;
  state.sharedSession.addEventListener("shared:new-messages", (e) => {
    e.detail.messages.forEach((m) => {
      state.messages.push(m);
      renderMessage(m);
    });
    scrollToBottom();
    // Notificación.
    const lastMsg = e.detail.messages[e.detail.messages.length - 1];
    if (lastMsg && lastMsg.role === "user" && lastMsg.author_email !== state.user_email) {
      window.dispatchEvent(new CustomEvent("shared:event", {
        detail: { type: "shared_new_message", payload: { author: lastMsg.author_email, chatTitle: state.currentChat.title, chatId: state.currentChat.id } },
      }));
    }
  });
  state.sharedSession.addEventListener("shared:turn-acquired", (e) => {
    toast(t("shared.turnYours", { time: formatCountdown(e.detail.expires_at) }), "success");
  });
  state.sharedSession.addEventListener("shared:turn-busy", (e) => {
    toast(t("shared.turnHeldBy", { user: e.detail.held_by, time: formatCountdown(e.detail.expires_at) }), "info");
  });
  state.sharedSession.addEventListener("shared:turn-countdown", (e) => {
    $("#sharedTurnInfo").textContent = (e.detail.held_by === state.user_email
      ? t("shared.turnYours", { time: e.detail.formatted })
      : t("shared.turnHeldBy", { user: e.detail.held_by, time: e.detail.formatted }));
  });
  state.sharedSession.addEventListener("shared:turn-released", () => {
    $("#sharedTurnInfo").textContent = "";
  });
  state.sharedSession.addEventListener("shared:presence", (e) => {
    renderSharedParticipants(e.detail.presence);
  });
  state.sharedSession.addEventListener("shared:left", () => {
    toast(t("shared.left"), "info");
    if (state.currentChat) {
      state.currentChat.is_shared = 0;
      renderChatHeader();
    }
    state.sharedSession = null;
  });
  state.sharedSession.addEventListener("shared:closed", () => {
    toast(t("shared.closed"), "info");
    if (state.currentChat) {
      state.currentChat.is_shared = 0;
      renderChatHeader();
    }
    state.sharedSession = null;
  });

  await state.sharedSession.start();
}

function renderSharedParticipants(presence) {
  const container = $("#sharedParticipants");
  if (!container) return;
  container.innerHTML = "";
  presence.forEach((p) => {
    const avatar = document.createElement("div");
    avatar.className = `participant-avatar ${p.online ? "" : "offline"}`;
    avatar.textContent = (p.user_email || "?").charAt(0).toUpperCase();
    avatar.title = p.user_email + (p.is_typing ? " (escribiendo)" : "");
    container.appendChild(avatar);
    if (p.is_typing && p.user_email !== state.user_email) {
      show($("#typingIndicator"));
      $("#typingUser").textContent = p.user_email.split("@")[0];
    }
  });
  // Si nadie está escribiendo, ocultar indicador.
  const anyTyping = presence.some((p) => p.is_typing && p.user_email !== state.user_email);
  if (!anyTyping) hide($("#typingIndicator"));
}

function updateInviteButtonVisibility() {
  const btn = $("#inviteBtn");
  if (!btn) return;
  const shareable = state.currentChat && isRoleShareable(state.currentRole);
  show(btn); // Lo dejamos visible para roles shareables; hidden para otros.
  btn.hidden = !shareable;
}

async function generateShareLink() {
  if (!state.currentChat) return;
  const r = await createShare(state.currentChat.id);
  if (r.error) return toast(`Error: ${r.error}`, "error");
  $("#shareLinkInput").value = r.share_url;
  show($("#shareLinkBox"));
  show($("#revokeShareLink"));
}

async function copyShareLink() {
  const input = $("#shareLinkInput");
  try {
    await navigator.clipboard.writeText(input.value);
    toast(t("shared.copyOk"), "success");
  } catch (e) {
    input.select();
    document.execCommand("copy");
    toast(t("shared.copyOk"), "success");
  }
}

async function revokeShareLink() {
  if (!state.currentChat) return;
  const r = await revokeShare(state.currentChat.id);
  if (r.error) return toast(`Error: ${r.error}`, "error");
  toast("Enlace revocado", "success");
  hide($("#shareLinkBox"));
  hide($("#revokeShareLink"));
}

async function detectSharedJoinFromURL() {
  const match = location.pathname.match(/^\/chat\/([^/]+)\/join/) || location.hash.match(/join\/([^?]+)/);
  if (!match) return;
  const chatId = match[1];
  const token = new URLSearchParams(location.search).get("token");
  if (!token) return;
  const r = await joinSession(chatId, token);
  if (r.error) {
    toast(t("shared.invalidToken"), "error");
    return;
  }
  toast(t("shared.joined"), "success");
  // Cargar el chat.
  // Necesitamos fetch el chat desde el backend; como no hay endpoint explícito,
  // usamos el offline-bundle para encontrarlo.
  const bundle = await fetch("/api/chats/offline-bundle").then((r) => r.json()).catch(() => ({ chats: [] }));
  const chat = (bundle.chats || []).find((c) => c.id === chatId);
  if (chat) openChat(chat);
}

function formatCountdown(expiresAt) {
  if (!expiresAt) return "00:00";
  const remaining = Math.max(0, expiresAt - Date.now());
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

// ==============================================================================
// SKILL MODE POR ROL
// ==============================================================================
// Agente y Coder deciden usar skills autónomamente (mode="auto").
// Fast no recibe skills. El resto solo si el usuario lo solicita (mode="manual").
function getSkillMode(role) {
  if (role === "agent" || role === "coder") return "auto";
  if (role === "fast") return null;
  return "manual";
}

// ==============================================================================
// TOKEN COUNTER
// ==============================================================================
async function getSystemPrompt() {
  // Resolver el system prompt real para el rol UI actual.
  // Esto se usa en rutas que NO pasan por el Worker (Puter) o donde el Worker
  // actúa como passthrough (/api/chat/openrouter) y no reemplaza el system message.
  const promptKey = UI_ROLE_TO_PROMPT_KEY[state.currentRole];
  const realPrompt = promptKey ? SYSTEM_PROMPTS[promptKey] : null;
  const base = realPrompt || `[System prompt no disponible para el rol ${state.currentRole}.]`;
  const mode = getSkillMode(state.currentRole);
  if (!mode) return base; // fast: sin skills
  const skillsBlock = await buildSkillsPromptBlock(state.settings, state.currentRole, mode);
  return skillsBlock ? base + "\n\n" + skillsBlock : base;
}

// Versión sync de getSystemPrompt (sin skills) para el token counter.
function __getBaseSystemPrompt() {
  const promptKey = UI_ROLE_TO_PROMPT_KEY[state.currentRole];
  return (promptKey ? SYSTEM_PROMPTS[promptKey] : null)
    || `[System prompt no disponible para el rol ${state.currentRole}.]`;
}

function updateTokenCounter() {
  if (!state.settings.tokens.showCounter) {
    hide($("#tokenCounter"));
    return;
  }
  show($("#tokenCounter"));
  const status = ContextManager.computeTokenStatus({
    messages: state.messages,
    currentModelId: state.currentModel,
    currentUserMsg: { role: "user", content: $("#messageInput")?.value || "" },
    summary: state.chatSummary,
    systemPrompt: __getBaseSystemPrompt(),
  });
  $("#tokenUsed").textContent = status.used;
  $("#tokenAvailable").textContent = status.available;
  $("#tokenCounter").className = `token-counter ${status.level}`;
}

const debouncedUpdateTokenCounter = debounce(updateTokenCounter, 300);

// ==============================================================================
// OAUTH CONNECTIONS
// ==============================================================================
async function loadConnections() {
  try {
    const resp = await fetch("/api/oauth/connections");
    if (!resp.ok) return;
    const data = await resp.json();
    (data.connections || []).forEach((c) => updateConnectionUI(c));
  } catch (e) { /* best-effort */ }
}

function updateConnectionUI(conn) {
  const card = document.querySelector(`.connection-card[data-provider="${conn.provider}"]`);
  if (!card) return;
  const status = card.querySelector(".conn-status");
  const account = card.querySelector(".conn-account");
  const connectBtn = card.querySelector(`#connect${conn.provider.charAt(0).toUpperCase() + conn.provider.slice(1)}`);
  const disconnectBtn = card.querySelector(`#disconnect${conn.provider.charAt(0).toUpperCase() + conn.provider.slice(1)}`);

  if (conn.invalid) {
    status.textContent = t("connections.invalid");
    status.className = "conn-status invalid";
    show(account); account.textContent = "Reconectar";
    show(disconnectBtn); hide(connectBtn);
  } else {
    status.textContent = t("connections.connected", { account: conn.account_metadata?.login || conn.account_metadata?.email || "" });
    status.className = "conn-status connected";
    if (conn.account_metadata) {
      show(account);
      account.textContent = `${conn.account_metadata.name || conn.account_metadata.login || conn.account_metadata.email}`;
    }
    show(disconnectBtn); hide(connectBtn);
  }
}

function connectOAuth(provider) {
  // Redirigir al endpoint start del Worker.
  toast(t("connections.redirecting", { provider }), "info");
  window.location.href = `/api/oauth/${provider}/start`;
}

async function disconnectOAuth(provider) {
  if (!(await showConfirm(`¿Desconectar ${provider}?`, { title: "Desconectar", danger: true, okLabel: "Desconectar" }))) return;
  try {
    await fetch(`/api/oauth/${provider}/disconnect`, { method: "POST" });
    const card = document.querySelector(`.connection-card[data-provider="${provider}"]`);
    if (card) {
      card.querySelector(".conn-status").textContent = t("connections.disconnected");
      card.querySelector(".conn-status").className = "conn-status";
      hide(card.querySelector(".conn-account"));
      show(card.querySelector(`#connect${provider.charAt(0).toUpperCase() + provider.slice(1)}`));
      hide(card.querySelector(`#disconnect${provider.charAt(0).toUpperCase() + provider.slice(1)}`));
    }
    toast("Desconectado", "success");
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}

// ==============================================================================
// REPO UPLOAD (multi-archivo)
// ==============================================================================
function handleRepoFilesUpload(fileList) {
  const files = Array.from(fileList);
  const maxSize = 5 * 1024 * 1024;
  const overLimit = files.filter((f) => f.size > maxSize);
  if (overLimit.length > 0) {
    toast(t("repo.tooLarge") + ` (${overLimit.map((f) => f.name).join(", ")})`, "error");
    return;
  }
  // Mostrar meta para primer archivo como referencia.
  show($("#repoUploadMeta"));
  $("#repoDocName").value = files.length === 1 ? files[0].name : "";
  show($("#repoConfirmUpload"));

  // Si es un solo archivo, confirmar directamente con el nombre original.
  if (files.length === 1) {
    $("#repoConfirmUpload").onclick = () => uploadSingleFile(files[0]);
  } else {
    // Múltiples: confirmar sube todos.
    $("#repoDocName").readOnly = true;
    $("#repoDocName").value = `${files.length} archivos seleccionados`;
    $("#repoConfirmUpload").onclick = async () => {
      hide($("#repoUploadMeta"));
      hide($("#repoConfirmUpload"));
      $("#repoDocName").readOnly = false;
      let ok = 0, fail = 0;
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("doc_name", file.name);
          const resp = await fetch("/api/repo/upload", { method: "POST", body: formData });
          if (resp.ok) ok++; else fail++;
        } catch { fail++; }
      }
      if (fail === 0) toast(`${ok} ${t("repo.uploaded")}`, "success");
      else toast(`${ok} OK, ${fail} errores`, fail > 0 ? "error" : "success");
      _repoOffset = 0;
      loadRepoList();
    };
  }
}

async function uploadSingleFile(file) {
  const docName = $("#repoDocName").value || file.name;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("doc_name", docName);
  try {
    const resp = await fetch("/api/repo/upload", { method: "POST", body: formData });
    if (resp.ok) {
      toast(t("repo.uploaded"), "success");
      hide($("#repoUploadMeta"));
      hide($("#repoConfirmUpload"));
      _repoOffset = 0;
      loadRepoList();
    } else {
      throw new Error(`HTTP ${resp.status}`);
    }
  } catch (e) {
    toast(`Error: ${e.message}`, "error");
  }
}

let _repoOffset = 0;
const _repoPageSize = 50;
let _repoSearchTerm = "";
let _repoTotal = 0;

async function loadRepoList(append = false) {
  try {
    const params = new URLSearchParams({ limit: _repoPageSize, offset: _repoOffset });
    if (_repoSearchTerm) params.set("search", _repoSearchTerm);
    const resp = await fetch(`/api/repo/list?${params}`);
    if (!resp.ok) return;
    const data = await resp.json();
    const list = $("#repoList");
    if (!append) list.innerHTML = "";

    // Calcular total (usar total de la respuesta si existe, sino acumular).
    if (data.total !== undefined) _repoTotal = data.total;

    (data.documents || []).forEach((doc) => {
      const li = document.createElement("li");
      li.dataset.docNumber = doc.doc_number;
      li.innerHTML = `
        <span class="repo-doc-number">#${doc.doc_number}</span>
        <span class="repo-doc-name" title="${doc.doc_name}">${doc.doc_name}</span>
        <span class="repo-doc-meta">${formatBytes(doc.file_size)}</span>
        <button class="repo-btn-download" title="${t('repo.download') || 'Descargar'}">⬇</button>
        <button class="repo-btn-delete" title="${t('repo.delete') || 'Borrar'}">🗑</button>
      `;
      li.querySelector(".repo-btn-download").addEventListener("click", () =>
        downloadRepoDoc(doc.doc_number, doc.doc_name)
      );
      li.querySelector(".repo-btn-delete").addEventListener("click", function () {
        deleteRepoDoc(doc.doc_number, this);
      });
      list.appendChild(li);
    });

    // Usage bar.
    const totalSize = data.total_size || 0;
    const pct = Math.min(100, (totalSize / (10 * 1024 * 1024 * 1024)) * 100);
    $("#repoUsageFill").style.width = `${pct}%`;
    $("#repoUsageText").textContent = t("repo.usage", { used: (totalSize / 1024 / 1024 / 1024).toFixed(2) });

    // Botón "cargar más".
    let loadMoreBtn = $("#repoLoadMore");
    if (data.has_more) {
      if (!loadMoreBtn) {
        loadMoreBtn = document.createElement("button");
        loadMoreBtn.id = "repoLoadMore";
        loadMoreBtn.className = "action-btn repo-load-more";
        loadMoreBtn.textContent = t("repo.loadMore") || "Cargar más";
        loadMoreBtn.addEventListener("click", () => {
          _repoOffset += _repoPageSize;
          loadRepoList(true);
        });
        list.parentNode.insertBefore(loadMoreBtn, list.nextSibling);
      }
      loadMoreBtn.hidden = false;
    } else if (loadMoreBtn) {
      loadMoreBtn.hidden = true;
    }

    // Info de total.
    const countEl = $("#repoCountInfo");
    if (countEl) {
      countEl.textContent = `${_repoTotal} documento${_repoTotal !== 1 ? "s" : ""}`;
    }
  } catch (e) { /* best-effort */ }
}

function onRepoSearchInput(e) {
  _repoSearchTerm = e.target.value.trim();
  _repoOffset = 0;
  const loadMoreBtn = $("#repoLoadMore");
  if (loadMoreBtn) loadMoreBtn.remove();
  loadRepoList();
}

async function downloadRepoDoc(docNumber, docName) {
  try {
    const resp = await fetch(`/api/repo/download/${docNumber}`);
    if (!resp.ok) { toast(`Error: ${resp.status}`, "error"); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = docName || `documento_${docNumber}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) { toast(`Error: ${e.message}`, "error"); }
}

async function deleteRepoDoc(docNumber, btn) {
  if (!(await showConfirm("¿Borrar documento?", { title: "Borrar documento", danger: true, okLabel: "Borrar" }))) return;
  try {
    const resp = await fetch("/api/repo/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doc_number: Number(docNumber) }),
    });
    if (!resp.ok) { toast(`Error: ${resp.status}`, "error"); return; }
    btn.closest("li").remove();
    toast(t("repo.deleted"), "success");
    // Recargar lista para actualizar barra y conteo.
    _repoOffset = 0;
    loadRepoList();
  } catch (e) { toast(`Error: ${e.message}`, "error"); }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ==============================================================================
// REPO ATTACH — Popover para adjuntar docs del repo al chat
// ==============================================================================
let _repoAttachSelected = new Set();
let _repoAttachDocs = [];

function toggleRepoAttachPopover() {
  const popover = $("#repoAttachPopover");
  if (!popover) return;
  if (!popover.hidden) {
    popover.hidden = true;
    return;
  }
  loadRepoAttachList();
  popover.hidden = false;
  const search = $("#repoAttachSearch");
  if (search) { search.value = ""; search.focus(); }
}

async function loadRepoAttachList(filter = "") {
  const list = $("#repoAttachList");
  if (!list) return;
  list.innerHTML = "<li>Cargando...</li>";
  try {
    const params = new URLSearchParams({ limit: 50, offset: 0 });
    if (filter) params.set("search", filter);
    const resp = await fetch(`/api/repo/list?${params}`);
    if (!resp.ok) { list.innerHTML = ""; return; }
    const data = await resp.json();
    _repoAttachDocs = data.documents || [];
    renderRepoAttachList();
  } catch { list.innerHTML = ""; }
}

function renderRepoAttachList() {
  const list = $("#repoAttachList");
  if (!list) return;
  list.innerHTML = "";
  if (_repoAttachDocs.length === 0) {
    list.innerHTML = '<li style="color:var(--text-muted);cursor:default;">Sin documentos</li>';
    return;
  }
  _repoAttachDocs.forEach((doc) => {
    const li = document.createElement("li");
    const isSelected = _repoAttachSelected.has(doc.doc_number);
    if (isSelected) li.classList.add("selected");
    li.innerHTML = `
      <span class="repo-attach-check">${isSelected ? "\u2713" : ""}</span>
      <span class="repo-attach-name" title="${doc.doc_name}">#${doc.doc_number} ${doc.doc_name}</span>
      <span class="repo-attach-size">${formatBytes(doc.file_size)}</span>
    `;
    li.addEventListener("click", () => {
      if (_repoAttachSelected.has(doc.doc_number)) {
        _repoAttachSelected.delete(doc.doc_number);
      } else {
        _repoAttachSelected.add(doc.doc_number);
      }
      renderRepoAttachList();
      updateRepoAttachCount();
    });
    list.appendChild(li);
  });
  updateRepoAttachCount();
}

function updateRepoAttachCount() {
  const countEl = $("#repoAttachCount");
  if (countEl) {
    const n = _repoAttachSelected.size;
    countEl.textContent = `${n} seleccionado${n !== 1 ? "s" : ""}`;
  }
}

function confirmRepoAttach() {
  if (_repoAttachSelected.size === 0) {
    toast(t("repo.noDocsSelected") || "Selecciona al menos un documento", "warning");
    return;
  }
  for (const doc of _repoAttachDocs) {
    if (_repoAttachSelected.has(doc.doc_number)) {
      if (!state.repoDocAttachments.some((a) => a.doc_number === doc.doc_number)) {
        state.repoDocAttachments.push({
          doc_number: doc.doc_number,
          doc_name: doc.doc_name,
          file_size: doc.file_size,
        });
      }
    }
  }
  _repoAttachSelected.clear();
  $("#repoAttachPopover").hidden = true;
  renderRepoDocChips();
}

function removeRepoDocAttachment(docNumber) {
  state.repoDocAttachments = state.repoDocAttachments.filter((a) => a.doc_number !== docNumber);
  renderRepoDocChips();
}

function renderRepoDocChips() {
  const container = $("#repoDocChips");
  if (!container) return;
  if (state.repoDocAttachments.length === 0) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  container.innerHTML = state.repoDocAttachments.map((a) =>
    `<span class="repo-doc-chip" data-doc-number="${a.doc_number}">
      <span class="repo-doc-chip-name" title="${a.doc_name}">#${a.doc_number} ${a.doc_name}</span>
      <span class="repo-doc-chip-remove" data-doc-number="${a.doc_number}">\u2715</span>
    </span>`
  ).join("");
  container.querySelectorAll(".repo-doc-chip-remove").forEach((btn) => {
    btn.addEventListener("click", () => removeRepoDocAttachment(Number(btn.dataset.docNumber)));
  });
}

async function fetchRepoDocContent(docNumber) {
  try {
    const resp = await fetch("/api/repo/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: String(docNumber) }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

// ==============================================================================
// DASHBOARD
// ==============================================================================
async function loadDashboard() {
  try {
    const resp = await fetch("/api/status");
    if (!resp.ok) return;
    const data = await resp.json();
    const grid = $("#dashboardModels");
    grid.innerHTML = "";

    // v2.8 — Cerebras/Cohere como fallback (tarjetas informativas).
    ["Cerebras", "Cohere"].forEach((name) => {
      grid.innerHTML += `<div class="dashboard-card"><div class="dashboard-card-name">${name}</div><div class="dashboard-card-status status-amber">⚡ Fallback</div></div>`;
    });

    // OpenRouter.
    const orStatus = data.openrouter;
    const orClass = orStatus?.available ? "status-green" : "status-red";
    const orIcon = orStatus?.available ? "🟢" : "🔴";
    grid.innerHTML += `<div class="dashboard-card"><div class="dashboard-card-name">OpenRouter</div><div class="dashboard-card-status ${orClass}">${orIcon} ${orStatus?.latency_ms || "?"}ms</div></div>`;

    if (data.openrouter_pool_degraded) {
      grid.innerHTML += `<div class="dashboard-card"><div class="dashboard-card-name">OpenRouter Pool</div><div class="dashboard-card-status status-amber">🟡 Degraded</div></div>`;
    }

    // Services con claves.
    (data.services || []).forEach((s) => {
      grid.innerHTML += `<div class="dashboard-card"><div class="dashboard-card-name">${s.name}</div><div class="dashboard-card-status status-green">🔑 Configurado</div></div>`;
    });

    // Si admin, cargar keys panel.
    // No sabemos si somos admin desde el frontend; lo intentamos y ocultamos si 403.
    loadKeysDashboard();
    loadUsageDashboard();
  } catch (e) { /* best-effort */ }
}

// v2.6 — Dashboard de uso de modelos y tools (admin). /api/usage
async function loadUsageDashboard() {
  const panel = $("#usageDashboard");
  if (!panel) return;
  panel.innerHTML = '<p class="usage-loading">Cargando uso…</p>';

  // v2.7: aviso de cuotas bajas (banner en el propio Véritas).
  try {
    const qresp = await fetch("/api/quota");
    if (qresp.ok) {
      const qdata = await qresp.json();
      if (qdata.low_quota_services && qdata.low_quota_services.length) {
        const low = (qdata.quotas || []).filter((q) => q.remaining_pct < 25);
        let warn = '<div class="quota-warning">⚠️ <strong>Cuotas bajas:</strong> ';
        warn += low.map((q) => `${q.service} (${q.remaining_pct}%)`).join(", ");
        warn += '. <span class="quota-hint">Se notificará por email al operador. Revisa el plan o añade otra key.</span></div>';
        panel.innerHTML = warn + panel.innerHTML;
      }
    }
  } catch { /* sin cuota visible */ }

  try {
    const resp = await fetch("/api/usage?days=7");
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      panel.innerHTML = `<p class="usage-error">${escapeHTML((err && err.error) || "Sin permisos de admin")}</p>`;
      return;
    }
    const data = await resp.json();
    let html = "";

    // Barras por día (modelos + tools)
    const days = data.daily || [];
    const maxCalls = Math.max(1, ...days.map((d) => Number(d.model_calls) || 0));
    html += '<h4>Llamadas de modelo por día</h4><div class="usage-bars">';
    for (const d of days) {
      const h = Math.round((Number(d.model_calls) / maxCalls) * 60);
      html += `<div class="usage-bar-col" title="${escapeHTML(d.day)}: ${d.model_calls} llamadas">
                 <div class="usage-bar" style="height:${h}px"></div>
                 <span class="usage-bar-label">${escapeHTML(String(d.day).slice(5))}</span>
               </div>`;
    }
    html += "</div>";

    // Totales
    const totalIn = days.reduce((a, d) => a + (Number(d.tokens_in) || 0), 0);
    const totalOut = days.reduce((a, d) => a + (Number(d.tokens_out) || 0), 0);
    html += `<p class="usage-totals">Tokens (7d): <strong>${totalIn.toLocaleString()}</strong> in · <strong>${totalOut.toLocaleString()}</strong> out · <strong>${data.daily.length}</strong> días con actividad</p>`;

    // Por modelo
    html += '<h4>Uso por modelo</h4><table class="usage-table"><tr><th>Modelo</th><th>Llamadas</th><th>Tokens in</th><th>Tokens out</th><th>Errores</th></tr>';
    for (const m of (data.by_model || []).slice(0, 12)) {
      html += `<tr><td>${escapeHTML(m.model)}</td><td>${m.calls}</td><td>${Number(m.tokens_in).toLocaleString()}</td><td>${Number(m.tokens_out).toLocaleString()}</td><td class="${m.errors ? "usage-err" : ""}">${m.errors}</td></tr>`;
    }
    html += "</table>";

    // Por tool
    html += '<h4>Uso por tool</h4><table class="usage-table"><tr><th>Tool</th><th>Llamadas</th><th>Errores</th><th>Lat. media</th></tr>';
    for (const t of (data.by_tool || []).slice(0, 15)) {
      html += `<tr><td>${escapeHTML(t.tool_name)}</td><td>${t.calls}</td><td class="${t.errors ? "usage-err" : ""}">${t.errors}</td><td>${Math.round(Number(t.avg_latency_ms))}ms</td></tr>`;
    }
    html += "</table>";

    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = `<p class="usage-error">Error: ${escapeHTML(e.message)}</p>`;
  }
}

async function loadKeysDashboard() {
  try {
    const resp = await fetch("/api/keys/services");
    if (!resp.ok) return;
    const data = await resp.json();
    const keysPanel = $("#dashboardKeys");
    const keysTitle = document.querySelector('h4[data-i18n="settings.dashboard.keys"]');

    for (const svc of data.services || []) {
      const statusResp = await fetch(`/api/keys/status?service=${svc}`);
      if (statusResp.status === 403) {
        // No admin: ocultar panel completo.
        hide(keysPanel);
        if (keysTitle) hide(keysTitle);
        return;
      }
      if (!statusResp.ok) continue;
      const status = await statusResp.json();
      const badge = status.degraded ? "🟡 DEGRADED" : "🟢 OK";
      keysPanel.innerHTML += `<div class="dashboard-card"><div class="dashboard-card-name">${svc}</div><div class="dashboard-card-status">${badge} (${status.keys?.length || 0} keys)</div></div>`;
    }
    show(keysPanel);
    if (keysTitle) show(keysTitle);
  } catch (e) { /* best-effort */ }
}

// ==============================================================================
// SETTINGS LOAD/SAVE
// ==============================================================================
async function loadSettings() {
  // Cargar perfil desde el backend (GET /api/profile) y mergear con localStorage.
  try {
    const saved = localStorage.getItem("veritas_settings");
    if (saved) {
      state.settings = { ...state.settings, ...JSON.parse(saved) };
    }
    // Cargar desde el server si hay conexión.
    if (!state.isOffline) {
      const resp = await fetch("/api/profile");
      if (resp.ok) {
        const data = await resp.json();
        if (data.profile && Object.keys(data.profile).length > 0) {
          // El server guarda TODO bajo profile_json; ahí están ui_lang,
          // personalization, tokens, etc. Mergear con lo que ya tenemos.
          state.settings = { ...state.settings, ...data.profile };
        }
      }
    }
    applySettingsToUI();
  } catch (e) { /* use defaults */ }
}

async function saveSettings() {
  try {
    localStorage.setItem("veritas_settings", JSON.stringify(state.settings));
    // Persistir en el server (PUT /api/profile) con merge.
    if (!state.isOffline) {
      await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_json: state.settings }),
      });
    }
  } catch (e) { /* best-effort */ }
}

function applySettingsToUI() {
  // Tema.
  document.documentElement.dataset.theme = state.settings.personalization.theme;
  $("#themeSelect").value = state.settings.personalization.theme;
  $("#readModeToggle").checked = state.settings.personalization.readMode;
  document.body.classList.toggle("read-mode", state.settings.personalization.readMode);
  $("#animationsToggle").checked = state.settings.personalization.animations;
  $("#persistToggle").checked = state.settings.personalization.persist;

  // Tokens.
  $("#optCompress").checked = state.settings.tokens.contextCompression;
  $("#optRecent").value = state.settings.tokens.recentMessages;
  $("#optRecentVal").textContent = state.settings.tokens.recentMessages;
  $("#optTruncate").checked = state.settings.tokens.toolTruncation;
  $("#optTruncLimit").value = state.settings.tokens.toolTruncationLimitKB;
  $("#optTruncVal").textContent = state.settings.tokens.toolTruncationLimitKB;
  $("#optCaching").checked = state.settings.tokens.promptCaching;
  $("#optSticky").checked = state.settings.tokens.stickyRouting;
  $("#optChips").checked = state.settings.tokens.showChips;
  $("#optCounter").checked = state.settings.tokens.showCounter;

  // Shared.
  $("#sharedEnable").checked = state.settings.shared.enable;
  $("#sharedTurnDuration").value = state.settings.shared.turnDuration;
  $("#sharedTurnVal").textContent = state.settings.shared.turnDuration;

  // Notif.
  $("#notifMaster").checked = state.settings.notifications.enabled;
  $("#notifModelDone").checked = state.settings.notifications.events?.model_response !== false;
  $("#notifTurn").checked = state.settings.notifications.events?.shared_turn_acquired !== false;
  $("#notifNewMsg").checked = state.settings.notifications.events?.shared_new_message !== false;
  $("#notifToolDone").checked = state.settings.notifications.events?.tool_completed === true;

  // Offline.
  $("#offlineEnable").checked = state.settings.offline.enable;

  // Chats.
  $("#chatsAutoTitle").checked = state.settings.chats.autoTitle;
}

function setupSettingsUI() {
  // Skills UI — carga dinámica de custom skills desde D1.
  loadCustomSkills().then(() => {
    renderSkillsList();
  }).catch(() => {
    renderSkillsList(); // Fallback a estáticas solas.
  });
  setupSkillsUI();
  updateSkillsIndicator();
}

// ==============================================================================
// SKILLS UI
// ==============================================================================
function renderSkillsList(filter = "all", search = "") {
  const grid = $("#skillsGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const enabled = new Set(state.settings.skills.enabled || []);
  const query = search.toLowerCase().trim();

  const filtered = getAllSkills().filter((s) => {
    if (filter !== "all" && s.category !== filter) return false;
    if (query && !s.name.toLowerCase().includes(query) && !s.description.toLowerCase().includes(query)) return false;
    return true;
  });

  // Determinar skills disponibles para el rol actual.
  const roleSkills = new Set(getSkillsForRole(state.currentRole).map(s => s.id));

  for (const skill of filtered) {
    const isOn = enabled.has(skill.id);
    const cat = SKILLS_CATEGORIES[skill.category] || {};
    const isCustom = !!skill._isCustom;
    const isAccessible = !skill.allowedRoles || roleSkills.has(skill.id);
    const card = document.createElement("div");
    card.className = `skill-card ${isOn ? "active" : ""} ${isCustom ? "custom" : ""} ${!isAccessible ? "skill-locked" : ""}`;
    card.dataset.skillId = skill.id;
    card.style.setProperty("--skill-color", skill.color);

    card.innerHTML = `
      <div class="skill-card-header">
        <span class="skill-icon">${skill.icon}</span>
        <span class="skill-name">${skill.name}</span>
        ${isCustom ? '<span class="skill-custom-badge">Custom</span>' : ''}
        ${!isAccessible ? '<span class="skill-locked-badge" title="No disponible para el rol actual">\uD83D\uDD12</span>' : ''}
        <label class="skill-toggle" title="${isOn ? "Desactivar" : "Activar"}">
          <input type="checkbox" ${isOn ? "checked" : ""} ${!isAccessible ? 'disabled' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="skill-desc">${skill.description}</p>
      <div class="skill-meta">
        <span class="skill-tier" style="color:${cat.color}">${cat.icon} ${cat.label}</span>
        <span class="skill-tier-badge">${skill.tier}</span>
        ${skill.needsExternal ? '<span class="skill-external" title="Requiere servicios externos">\u26A1</span>' : ""}
        ${isCustom ? '<span class="skill-custom-actions"><button class="icon-btn skill-edit-btn" title="Editar">\u270F</button><button class="icon-btn skill-delete-btn" title="Eliminar">\uD83D\uDDD1</button></span>' : ""}
      </div>
    `;

    // Toggle activate/deactivate.
    const checkbox = card.querySelector('input[type="checkbox"]');
    checkbox.addEventListener("change", () => {
      const id = skill.id;
      const set = new Set(state.settings.skills.enabled || []);
      if (checkbox.checked) set.add(id); else set.delete(id);
      state.settings.skills.enabled = [...set];
      card.classList.toggle("active", checkbox.checked);
      updateSkillsIndicator();
      saveSettings();
    });

    // Botón editar (solo customs).
    const editBtn = card.querySelector(".skill-edit-btn");
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSkillEditor(skill);
      });
    }

    // Botón eliminar (solo customs, con confirmación).
    const deleteBtn = card.querySelector(".skill-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!(await showConfirm(`¿Eliminar la skill "${skill.name}"?`, { title: "Eliminar skill", danger: true, okLabel: "Eliminar" }))) return;
        try {
          const resp = await fetch(`/api/skills/${encodeURIComponent(skill.id)}`, { method: "DELETE" });
          if (resp.ok) {
            const set = new Set(state.settings.skills.enabled || []);
            set.delete(skill.id);
            state.settings.skills.enabled = [...set];
            removeCustomSkill(skill.id);
            renderSkillsList(
              document.querySelector("[data-skill-filter].active")?.dataset.skillFilter || "all",
              $("#skillsSearchInput")?.value || ""
            );
            updateSkillsIndicator();
            saveSettings();
            toast(`Skill "${skill.name}" eliminada`, "success");
          } else {
            toast(`Error al eliminar: ${resp.status}`, "error");
          }
        } catch (err) {
          toast(`Error: ${err.message}`, "error");
        }
      });
    }

    grid.appendChild(card);
  }

  // Contador.
  const countEl = $("#skillsCount");
  if (countEl) {
    const all = getAllSkills();
    const total = all.length;
    const customCount = all.filter(s => s._isCustom).length;
    const active = enabled.size;
    countEl.textContent = `${active}/${total} skills activas` + (customCount > 0 ? ` (${customCount} custom)` : "");
  }
}

function setupSkillsUI() {
  // Filtros de categoría.
  $$("[data-skill-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(`[data-skill-filter]`).forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderSkillsList(btn.dataset.skillFilter, $("#skillsSearchInput")?.value || "");
    });
  });

  // Búsqueda.
  const searchInput = $("#skillsSearchInput");
  if (searchInput) {
    const debounced = debounce((val) => {
      const activeFilter = document.querySelector("[data-skill-filter].active")?.dataset.skillFilter || "all";
      renderSkillsList(activeFilter, val);
    }, 200);
    searchInput.addEventListener("input", (e) => debounced(e.target.value));
  }

  // Botón "Nueva Skill".
  const newBtn = $("#newSkillBtn");
  if (newBtn) {
    newBtn.addEventListener("click", () => openSkillEditor(null));
  }
}

/**
 * Abre el modal de creación/edición de skill custom.
 * @param {Object|null} skill — Si es null, es creación. Si es un objeto, es edición.
 */
async function openSkillEditor(skill) {
  const modal = $("#skillEditorModal");
  if (!modal) return;

  const isEdit = !!skill;
  $("#skillEditorTitle").textContent = isEdit ? "Editar Skill" : "Nueva Skill";
  $("#skillEditorName").value = isEdit ? skill.name : "";
  $("#skillEditorDesc").value = isEdit ? skill.description : "";
  $("#skillEditorCategory").value = isEdit ? skill.category : "utility";
  $("#skillEditorIcon").value = isEdit ? skill.icon : "";
  $("#skillEditorColor").value = isEdit ? skill.color : "#f59e0b";
  $("#skillEditorExternal").checked = isEdit ? !!skill.needsExternal : false;
  $("#skillEditorPrompt").value = isEdit ? (skill._promptContent || "") : "";
  $("#skillEditorId").value = isEdit ? skill.id : "";

  // Si es edición, cargar el promptContent completo desde el backend.
  if (isEdit && !skill._promptContent) {
    try {
      const resp = await fetch("/api/skills");
      if (resp.ok) {
        const data = await resp.json();
        const found = (data.skills || []).find(s => s.id === skill.id);
        if (found && found._promptContent) {
          $("#skillEditorPrompt").value = found._promptContent;
        }
      }
    } catch { /* usar lo que hay */ }
  }

  modal.hidden = false;
}

/**
 * Guarda la skill del editor (crear o actualizar).
 */
async function saveSkillFromEditor() {
  const name = $("#skillEditorName").value.trim();
  const description = $("#skillEditorDesc").value.trim();
  const category = $("#skillEditorCategory").value;
  const icon = $("#skillEditorIcon").value || "\u2728";
  const color = $("#skillEditorColor").value || "#f59e0b";
  const needsExternal = $("#skillEditorExternal").checked;
  const promptContent = $("#skillEditorPrompt").value.trim();
  const existingId = $("#skillEditorId").value;

  if (!name) { toast("El nombre es obligatorio", "warning"); return; }
  if (!description) { toast("La descripción es obligatoria", "warning"); return; }
  if (!promptContent) { toast("El contenido del prompt es obligatorio", "warning"); return; }

  const body = { name, description, category, icon, color, needsExternal, promptContent };

  try {
    let resp;
    if (existingId) {
      // PUT /api/skills/:id
      resp = await fetch(`/api/skills/${encodeURIComponent(existingId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      // POST /api/skills
      resp = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ message: resp.statusText }));
      toast(`Error: ${err.message || resp.status}`, "error");
      return;
    }

    const data = await resp.json();
    const savedSkill = data.skill || data;
    savedSkill._promptContent = promptContent;

    // Actualizar cache local.
    mergeCustomSkill(savedSkill);

    // Cerrar modal y re-renderizar.
    $("#skillEditorModal").hidden = true;
    renderSkillsList(
      document.querySelector("[data-skill-filter].active")?.dataset.skillFilter || "all",
      $("#skillsSearchInput")?.value || ""
    );
    updateSkillsIndicator();
    toast(existingId ? "Skill actualizada" : "Skill creada", "success");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
}

/** Cierra el modal de editor de skill. */window.saveSkillFromEditor = saveSkillFromEditor;

function closeSkillEditor() {
  $("#skillEditorModal").hidden = true;
}
window.closeSkillEditor = closeSkillEditor;

function updateSkillsIndicator() {
  const badge = $("#skillsActiveIndicator");
  if (!badge) return;
  const count = (state.settings.skills.enabled || []).length;
  if (count > 0) {
    badge.hidden = false;
    badge.textContent = `${count} skill${count > 1 ? "s" : ""}`;
  } else {
    badge.hidden = true;
  }
}


async function saveProfile() {
  state.settings.profile.name = $("#profileName").value;
  state.settings.profile.bio = $("#profileBio").value;
  state.settings.profile.prefLang = $("#profileLang").value;
  await saveSettings();
  toast(t("toast.saved"), "success");
}

async function saveMaps() {
  state.settings.maps.apiKey = $("#mapsApiKey").value;
  state.settings.maps.provider = $("#mapsProvider").value;
  await saveSettings();
  toast(t("toast.saved"), "success");
}

function updateOfflineSyncInfo(ts, size) {
  if (ts === 0) {
    $("#offlineLastSync").textContent = t("settings.offline.neverSynced");
    $("#offlineSize").textContent = `Cache: 0 MB / 5 MB`;
  } else {
    const minutes = Math.floor((Date.now() - ts) / 60000);
    $("#offlineLastSync").textContent = t("settings.offline.lastSync", { minutes });
    $("#offlineSize").textContent = t("settings.offline.cacheSize", { size: (size / 1024 / 1024).toFixed(1) });
  }
}

// ==============================================================================
// FILE ATTACH (chat)
// ==============================================================================
async function handleFileAttach(e) {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      toast(`${file.name}: archivo demasiado grande (máx 20MB para multimedia)`, "warning");
      continue;
    }
    // Detectar modalidad.
    const modality = detectModality(file.type, file.name);
    if (!modality) {
      toast(`${file.name}: tipo no soportado (imagen, PDF, audio, video)`, "warning");
      continue;
    }

    // Subir a R2 vía /api/storage/upload.
    const formData = new FormData();
    formData.append("file", file);
    try {
      const resp = await fetch("/api/storage/upload", { method: "POST", body: formData });
      if (resp.ok) {
        const data = await resp.json();
        state.pendingAttachments.push({
          r2_key: data.r2_key,
          modality,
          name: file.name,
          size: file.size,
          mime_type: file.type,
        });
        renderAttachmentChips();
        if (data.usage?.warning) {
          const pct = Math.round((data.usage.projected_ratio || data.usage.usage_ratio || 0) * 100);
          toast(`R2 cerca del límite free tier: ${pct}% usado. Considera borrar multimedia antigua.`, "warning", 6000);
        }
      } else {
        const err = await resp.json().catch(() => ({}));
        toast(`Error subiendo ${file.name}: ${err.message || resp.status}`, "error", 7000);
      }
    } catch (err) {
      toast(`Error subiendo ${file.name}: ${err.message}`, "error");
    }
  }
  e.target.value = "";
}

// Detecta la modalidad de un archivo a partir de su MIME type o extensión.
function detectModality(mimeType, fileName) {
  if (!mimeType && fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (["png","jpg","jpeg","gif","webp","bmp","svg"].includes(ext)) return "image";
    if (ext === "pdf") return "pdf";
    if (["mp3","wav","ogg","m4a","flac","aac","webm"].includes(ext)) return "audio";
    if (["mp4","webm","avi","mov","mkv"].includes(ext)) return "video";
    return null;
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

// Icono por modalidad para los chips de preview.
function modalityIcon(modality) {
  const icons = { image: "🖼", pdf: "📄", audio: "🎵", video: "🎬" };
  return icons[modality] || "📎";
}

// Renderiza los chips de attachments pendientes.
function renderAttachmentChips() {
  const container = $("#attachmentChips");
  if (!container) return;
  if (state.pendingAttachments.length === 0) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  container.innerHTML = state.pendingAttachments.map((a, i) =>
    `<span class="attachment-chip" data-index="${i}" title="${a.name} (${formatBytes(a.size)})">
      ${modalityIcon(a.modality)} ${escapeHTML(a.name)}
      <button class="attachment-chip-remove" data-index="${i}" aria-label="Remove">✕</button>
    </span>`
  ).join("");
  // Listeners para eliminar chips.
  container.querySelectorAll(".attachment-chip-remove").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const idx = parseInt(btn.dataset.index, 10);
      state.pendingAttachments.splice(idx, 1);
      renderAttachmentChips();
    });
  });
}

// Muestra/oculta el botón de Pensamiento Profundo según la categoría.
function updateDeepThinkingVisibility() {
  const btn = $("#deepThinkingBtn");
  const codeBtn = $("#codeFirstToggle");
  const visible = state.currentCategory === "agent";
  if (btn) btn.hidden = !visible;
  if (codeBtn) codeBtn.hidden = !visible;
  if (!visible) {
    state.toggles.deepThinking = false;
    state.toggles.codeFirst = false;
    if (btn) { btn.classList.remove("active"); btn.setAttribute("aria-pressed", "false"); }
    if (codeBtn) { codeBtn.classList.remove("active"); codeBtn.setAttribute("aria-pressed", "false"); }
  }
}

// ==============================================================================
// PROMPT CRAFT — Botón flotante arrastrable + generador de prompts vía GLM
// ==============================================================================
// Widget autónomo: no depende del estado del chat principal. Usa Puter.js
// directamente con GLM-4.7-Flash para generar prompts optimizados por rol.
(function initPromptCraft() {
  const $ = (s) => document.querySelector(s);

  // --- Referencias DOM ---
  const fab      = $("#promptCraftFab");
  const panel    = $("#promptCraftPanel");
  const roleSel  = $("#promptCraftRole");
  const input    = $("#promptCraftInput");
  const sendBtn  = $("#promptCraftSend");
  const copyBtn  = $("#promptCraftCopy");
  const refreshBtn = $("#promptCraftRefresh");
  const closeBtn = $("#promptCraftClose");
  const outputEl = $("#promptCraftOutput");
  const resultEl = $("#promptCraftResult");

  let panelOpen = false;
  let isGenerating = false;
  let lastGeneratedPrompt = "";

  // --- Capacidades por rol (extraídas de los system prompts) ---
  const ROLE_CAPABILITIES = {
    agent: {
      name: "Agente",
      model: "Nemotron 3 Super/Ultra via OpenRouter",
      strengths: [
        "OSINT e inteligencia de fuentes abiertas",
        "Búsqueda web (múltiples engines), scraping, análisis de contenido",
        "Cadena de razonamiento multi-paso con tool calls",
        "Construcción de grafos de entidades y correlación de datos",
        "Verificación cruzada de claims y fuentes",
        "Escalamiento automático a Ultra para investigación profunda",
        "Percepción visual vía Nano VL (imágenes, diagramas)",
        "Integración con GitHub para repositorio de evidencia",
      ],
      tips: [
        "Especifica entidades concretas (nombres, URLs, fechas) cuando sea posible",
        "Indica qué tipo de fuentes prefieres (académicas, noticias, redes sociales, documentos oficiales)",
        "Para investigaciones complejas, menciona 'investigación profunda' para activar el modo Ultra",
        "Puedes pedir que use herramientas específicas: web_search, scrape_url, github_read_file, etc.",
      ],
    },
    coder: {
      name: "Agente · Code-first",
      model: "Cohere North Mini Code → Poolside Laguna S/XS 2.1 via OpenRouter",
      strengths: [
        "Ingeniería de software completa: construir, editar y depurar código",
        "Generación de artefactos con Live Preview (HTML/CSS/JS en sandbox)",
        "Plantillas pre-armadas: MapLibre, Three.js, Chart.js, D3, Tailwind, Plotly",
        "Operaciones con GitHub: crear branches, PRs, leer/escribir archivos",
        "Código funcional al primer intento (filosofía de código sobre explicación)",
        "Fetch vía proxy para APIs con restricciones CORS",
        "Fallback a GLM Flash para parches pequeños o lookups puntuales",
      ],
      tips: [
        "Describe qué quieres construir con el mayor detalle técnico posible",
        "Menciona librerías específicas si las necesitas (React, D3, Tailwind, etc.)",
        "Si editas código existente, pega el código o indica el archivo del proyecto",
        "Para aplicaciones complejas, desglosa en componentes o vistas",
        "Menciona si necesitas que sea responsive, accesible, o con animaciones específicas",
      ],
    },
    estratega: {
      name: "Estratega",
      model: "GLM 4.7 Flash vía Puter (prompt estratégico permisivo)",
      strengths: [
        "Análisis estratégico profundo con modo permisivo",
        "Contexto warfare/inteligencia/contrainteligencia",
        "Evaluación de escenarios y análisis de actores",
        "Razonamiento multi-nivel: táctico, operativo y estratégico",
        "Ciclo de inteligencia completo (6 fases: dirección, recolección, procesamiento, análisis, difusión, retroalimentación)",
        "Crítica de arquitectura y evaluación de trade-offs",
        "Búsqueda web nativa como tool",
        "Receptor de fallback ético (procesa queries que otros modelos rechazan)",
      ],
      tips: [
        "Sé directo — GLM responde mejor con objetivos estratégicos claros y contexto explícito",
        "Para análisis geopolíticos o de conflictos, menciona las partes involucradas",
        "Puedes pedir análisis en múltiples niveles (táctico/operativo/estratégico)",
        "Si necesitas reducir rechazos, formula la tarea como análisis estratégico legítimo, factual y contextualizado",
        "Para investigaciones largas, pide que siga el ciclo de inteligencia completo",
      ],
    },
    pensador: {
      name: "Agente · Pensador",
      model: "Nemotron 3 Ultra via OpenRouter",
      strengths: [
        "Razonamiento profundo con cadena de pensamiento (thinking tokens)",
        "Análisis exhaustivo paso a paso",
        "Descomposición de problemas complejos",
        "Verificación y validación de hipótesis",
        "Síntesis de información de múltiples fuentes",
        "Evaluación crítica de argumentos",
        "Generación de conexiones no obvias entre conceptos",
        "OSINT con profundidad analítica superior al Agente",
      ],
      tips: [
        "Usa frases como 'analiza a fondo', 'razonamiento paso a paso', 'descomposición' para activar el modo completo",
        "Para problemas complejos, presenta los datos disponibles y pide análisis multi-paso",
        "Si necesitas comparar opciones, presenta todas las alternativas explícitamente",
        "Menciona 'investigación profunda' para forzar escalamiento a Ultra",
        "Puedes pedir que evalúe desde múltiples perspectivas o marcos teóricos",
      ],
    },
    fast: {
      name: "Fast",
      model: "GLM 4.7 Flash → 4.6V Flash → 4.5 Flash vía Puter",
      strengths: [
        "Respuestas rápidas con baja latencia",
        "Reformulación, resumen, clasificación y extracción ligera",
        "Prompt Arquitecto y micro-tareas de productividad",
        "Degradación automática entre modelos GLM Flash",
      ],
      tips: [
        "Pide salidas breves y concretas",
        "Usa Fast para borradores, títulos, resúmenes o clasificación",
        "Evita tareas que requieran crawling, múltiples tools o análisis profundo",
      ],
    },
  };

  // --- Drag del FAB (mouse + touch) ---
  let dragging = false;
  let dragStartX, dragStartY, fabStartLeft, fabStartTop;
  let wasDragged = false;

  function onDragStart(e) {
    e.preventDefault();
    dragging = true;
    wasDragged = false;
    const point = e.touches ? e.touches[0] : e;
    const rect = fab.getBoundingClientRect();
    dragStartX = point.clientX;
    dragStartY = point.clientY;
    fabStartLeft = rect.left;
    fabStartTop = rect.top;
    fab.style.left = fabStartLeft + "px";
    fab.style.top = fabStartTop + "px";
    fab.style.right = "auto";
    fab.style.bottom = "auto";
    fab.classList.add("dragging");
  }

  function onDragMove(e) {
    if (!dragging) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - dragStartX;
    const dy = point.clientY - dragStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) wasDragged = true;
    fab.style.left = Math.max(0, Math.min(window.innerWidth - 48, fabStartLeft + dx)) + "px";
    fab.style.top = Math.max(0, Math.min(window.innerHeight - 48, fabStartTop + dy)) + "px";
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    fab.classList.remove("dragging");
  }

  fab.addEventListener("mousedown", onDragStart);
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragEnd);
  fab.addEventListener("touchstart", onDragStart, { passive: false });
  document.addEventListener("touchmove", onDragMove, { passive: false });
  document.addEventListener("touchend", onDragEnd);

  // --- Toggle panel ---
  function positionPanel() {
    const fabRect = fab.getBoundingClientRect();
    const pw = 370;
    const gap = 12;
    const spaceLeft = fabRect.left;
    const spaceRight = window.innerWidth - fabRect.right;
    if (spaceLeft >= pw + gap) {
      panel.style.left = (fabRect.left - pw - gap) + "px";
      panel.style.right = "auto";
    } else if (spaceRight >= pw + gap) {
      panel.style.left = (fabRect.right + gap) + "px";
      panel.style.right = "auto";
    } else {
      panel.style.left = Math.max(8, (fabRect.left + fabRect.width / 2) - pw / 2) + "px";
      panel.style.right = "auto";
    }
    const panelH = 520;
    const top = fabRect.top - panelH - gap;
    panel.style.top = top > 8 ? top + "px" : (fabRect.bottom + gap) + "px";
  }

  function togglePanel() {
    if (wasDragged) { wasDragged = false; return; }
    panelOpen = !panelOpen;
    if (panelOpen) {
      positionPanel();
      panel.hidden = false;
      fab.classList.add("active");
      input.focus();
    } else {
      panel.hidden = true;
      fab.classList.remove("active");
    }
  }

  function closePanel() {
    panelOpen = false;
    panel.hidden = true;
    fab.classList.remove("active");
  }

  fab.addEventListener("click", togglePanel);
  closeBtn.addEventListener("click", closePanel);
  window.addEventListener("resize", () => { if (panelOpen) positionPanel(); });

  // --- Generar prompt con GLM ---
  async function generatePrompt() {
    const role = roleSel.value;
    const brief = input.value.trim();
    if (!brief || isGenerating) return;

    const cap = ROLE_CAPABILITIES[role];
    if (!cap) return;

    isGenerating = true;
    sendBtn.disabled = true;
    copyBtn.disabled = true;
    outputEl.hidden = false;
    resultEl.innerHTML = '<div class="prompt-craft-loading"><div class="spinner"></div>Generando prompt optimizado...</div>';

    const metaPrompt = `Eres un experto en redacción de prompts para IA. Tu tarea es generar UN prompt optimizado que extraiga el máximo provecho de un rol específico de un sistema multi-modelo llamado Véritas.

ROL DESTINO: "${cap.name}" (modelo: ${cap.model})

CAPACIDADES DEL ROL:
${cap.strengths.map(s => "- " + s).join("\n")}

CONSEJOS PARA ESTE ROL:
${cap.tips.map(t => "- " + t).join("\n")}

INTENCIÓN DEL USUARIO (breve):
"${brief}"

REGLAS:
1. Genera UN ÚNICO prompt listo para copiar y pegar. No añadas prefijos tipo "Prompt:", comillas ni formato markdown.
2. El prompt debe ser detallado, específico y estructurado — no una simple reformulación de la intención del usuario.
3. Incluye contexto, restricciones, formato de salida deseado y cualquier directiva que maximice la calidad de la respuesta.
4. Si aplica, menciona herramientas específicas que el rol puede usar.
5. El idioma del prompt debe coincidir con el idioma en que el usuario escribió su intención.
6. Responde SOLO con el prompt generado. Nada más.`;

    try {
      const llmResp = await fetch("/api/llm/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: metaPrompt, max_tokens: 1500 }),
      });
      const llmData = await llmResp.json().catch(() => null);
      const text = ((llmData && llmData.text) || "").trim();
      if (!text) throw new Error((llmData && (llmData.detail || llmData.error)) || "Respuesta vacía");

      lastGeneratedPrompt = text;
      resultEl.textContent = text;
      copyBtn.disabled = false;
    } catch (err) {
      resultEl.textContent = `Error: ${err.message}`;
      copyBtn.disabled = true;
    } finally {
      isGenerating = false;
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", generatePrompt);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generatePrompt(); }
  });

  // --- Copiar ---
  function showToast(msg) {
    const t = document.createElement("div");
    t.className = "prompt-craft-toast";
    t.textContent = msg;
    const fabRect = fab.getBoundingClientRect();
    t.style.left = fabRect.left + "px";
    t.style.transform = "translateX(-50%)";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  copyBtn.addEventListener("click", async () => {
    if (!lastGeneratedPrompt) return;
    try {
      await navigator.clipboard.writeText(lastGeneratedPrompt);
      showToast("Prompt copiado");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = lastGeneratedPrompt;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast("Prompt copiado");
    }
  });

  // --- Refrescar ---
  refreshBtn.addEventListener("click", () => {
    input.value = "";
    outputEl.hidden = true;
    resultEl.textContent = "";
    lastGeneratedPrompt = "";
    copyBtn.disabled = true;
    input.focus();
  });
})();

// ==============================================================================
// HELPERS
// ==============================================================================
function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
}

function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// --- Token de sesión en todos los fetch a /api ---
(function patchFetchWithToken() {
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/") === 0) {
      const token = localStorage.getItem("veritas_token");
      if (token) {
        init = init || {};
        const h = new Headers(init.headers || {});
        if (!h.has("Authorization")) h.set("Authorization", "Bearer " + token);
        init.headers = h;
      }
    }
    return orig(input, init);
  };
})();

// ==============================================================================
// BOOT
// ==============================================================================
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Exponer para debugging y para notificaciones onclick.

// ==============================================================================
// v2.5 — Auth (email+contraseña), modal, búsqueda en conversación, export,
//        tema claro/oscuro y onboarding de 5 pasos.
// ==============================================================================

function showAppLayout(show) {
  const chip = $("#sidebarUserChip");
  if (chip) {
    chip.hidden = !show;
    const nm = $("#sidebarUserName");
    const email = state.user_email || localStorage.getItem("veritas_user") || "";
    if (nm && email) nm.textContent = email.split("@")[0];
  }
  const layout = document.querySelector(".app-layout");
  if (layout) layout.style.display = show ? "" : "none";
  const auth = $("#authView");
  if (auth) auth.hidden = show;
}

async function ensureAuth() {
  try {
    const _tok = localStorage.getItem("veritas_token");
    const resp = await fetch("/api/auth/me", {
      headers: { Accept: "application/json", ...(_tok ? { Authorization: "Bearer " + _tok } : {}) },
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => ({}));
      if (data && data.user) { showAppLayout(true); return true; }
    }
  } catch (e) { /* sin red: se intenta seguir con lo local */ }
  showAppLayout(false);
  return false;
}

async function handleAuthSubmit(mode) {
  const email = ($("#authEmail").value || "").trim();
  const password = $("#authPassword").value || "";
  const errEl = $("#authError");
  errEl.hidden = true;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { errEl.textContent = "Email inválido."; errEl.hidden = false; return; }
  if (password.length < 8) { errEl.textContent = "La contraseña debe tener al menos 8 caracteres."; errEl.hidden = false; return; }
  try {
    const resp = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { errEl.textContent = (data && data.message) || "Error de autenticación."; errEl.hidden = false; return; }
    localStorage.setItem("veritas_token", data.token);
    localStorage.setItem("veritas_user", data.user);
    showAppLayout(true);
    $("#authPassword").value = "";
    maybeShowOnboarding();
    location.reload();
  } catch (e) {
    errEl.textContent = "Error de conexión: " + e.message;
    errEl.hidden = false;
  }
}

// --- Modal de confirmación (sustituye a confirm()) ---
function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    const root = $("#modalRoot");
    if (!root) { resolve(window.confirm(message)); return; }
    $("#modalTitle").textContent = opts.title || "Confirmar";
    $("#modalMessage").textContent = message;
    const ok = $("#modalOkBtn");
    ok.textContent = opts.okLabel || "Confirmar";
    ok.className = "auth-btn" + (opts.danger ? " danger" : "");
    root.hidden = false;
    const done = (val) => {
      root.hidden = true;
      ok.onclick = null; $("#modalCancelBtn").onclick = null; $("#modalOverlay").onclick = null;
      resolve(val);
    };
    ok.onclick = () => done(true);
    $("#modalCancelBtn").onclick = () => done(false);
    $("#modalOverlay").onclick = (e) => { if (e.target === $("#modalOverlay")) done(false); };
    ok.focus();
  });
}

// --- Tema claro/oscuro ---
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("veritas_theme", theme);
}
function initTheme() {
  const saved = localStorage.getItem("veritas_theme");
  const theme = saved || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme(theme);
  const btn = $("#themeToggleBtn");
  if (btn) btn.textContent = theme === "light" ? "🌙" : "🌓";
}

// --- Búsqueda dentro de la conversación (Ctrl+F) ---
let _searchMarks = [];
function clearSearchMarks() {
  _searchMarks.forEach((m) => { const p = m.parentNode; if (p) { p.replaceChild(document.createTextNode(m.textContent), m); p.normalize(); } });
  _searchMarks = [];
}
function searchInChat(query) {
  clearSearchMarks();
  const countEl = $("#chatSearchCount");
  if (!query || query.length < 2) { if (countEl) countEl.hidden = true; return; }
  const q = query.toLowerCase();
  const bodies = document.querySelectorAll(".message-body");
  let total = 0;
  bodies.forEach((body) => {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const text = node.nodeValue || "";
      const lower = text.toLowerCase();
      if (lower.indexOf(q) === -1) return;
      const frag = document.createDocumentFragment();
      let idx = 0;
      for (;;) {
        const pos = lower.indexOf(q, idx);
        if (pos === -1) { frag.appendChild(document.createTextNode(text.slice(idx))); break; }
        frag.appendChild(document.createTextNode(text.slice(idx, pos)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(pos, pos + q.length);
        frag.appendChild(mark);
        _searchMarks.push(mark);
        total++;
        idx = pos + q.length;
      }
      node.parentNode.replaceChild(frag, node);
    });
  });
  if (countEl) { countEl.textContent = total ? total + " resultados" : "Sin resultados"; countEl.hidden = false; }
  if (total && _searchMarks[0]) _searchMarks[0].scrollIntoView({ behavior: "smooth", block: "center" });
}

// --- Exportar conversación (Markdown / JSON) ---
function buildMarkdownExport() {
  const lines = [
    "# Véritas — Conversación",
    "**Fecha:** " + new Date().toLocaleString(),
    "**Modelo:** " + (state.currentModel || "—"),
    "",
  ];
  (state.messages || []).forEach((m) => {
    const role = m.role === "user" ? "👤 Usuario" : (m.role === "assistant" ? "🛡️ Véritas" : "🔧 Tool");
    lines.push("## " + role + (m.model ? " (" + m.model + ")" : ""));
    if (m.tools_used) lines.push("*Tools: " + (Array.isArray(m.tools_used) ? m.tools_used.join(", ") : m.tools_used) + "*");
    lines.push("");
    lines.push(String(m.content || "").replace(/\n{3,}/g, "\n\n"));
    lines.push("");
  });
  return lines.join("\n");
}
function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 300);
}
function exportChatMarkdown() {
  if (!state.messages || !state.messages.length) { toast("No hay mensajes que exportar", "warning"); return; }
  const title = (state.currentChat && state.currentChat.title) || "conversacion";
  downloadBlob("veritas-" + title.replace(/[^\w-]+/g, "_") + ".md", buildMarkdownExport(), "text/markdown;charset=utf-8");
  toast("Conversación exportada (Markdown)", "success");
}
function exportChatJSON() {
  if (!state.messages || !state.messages.length) { toast("No hay mensajes que exportar", "warning"); return; }
  const payload = { exported_at: new Date().toISOString(), chat: state.currentChat || null, model: state.currentModel, messages: state.messages };
  downloadBlob("veritas-export-" + Date.now() + ".json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  toast("Conversación exportada (JSON)", "success");
}
function updateExportButtons() {
  const has = state.messages && state.messages.length > 0;
  if ($("#exportMdBtn")) $("#exportMdBtn").hidden = !has;
  if ($("#exportJsonBtn")) $("#exportJsonBtn").hidden = !has;
}

// --- Onboarding de 5 pasos ---
function maybeShowOnboarding() {
  if (localStorage.getItem("veritas_onboarding_v1")) return;
  const ov = $("#onboardingOverlay");
  if (!ov) return;
  let step = 0;
  const total = 5;
  const slides = ov.querySelectorAll(".onboarding-slide");
  const dots = $("#onboardingDots");
  dots.innerHTML = "";
  for (let i = 0; i < total; i++) { const d = document.createElement("span"); d.className = "dot" + (i === 0 ? " active" : ""); dots.appendChild(d); }
  const render = () => {
    slides.forEach((sl, i) => sl.classList.toggle("active", i === step));
    dots.querySelectorAll(".dot").forEach((d, i) => d.classList.toggle("active", i === step));
    $("#onbPrev").disabled = step === 0;
    $("#onbNext").textContent = step === total - 1 ? "Comenzar" : "Siguiente ›";
  };
  ov.hidden = false;
  render();
  const finish = () => { ov.hidden = true; localStorage.setItem("veritas_onboarding_v1", "1"); };
  $("#onbNext").onclick = () => { if (step < total - 1) { step++; render(); } else finish(); };
  $("#onbPrev").onclick = () => { if (step > 0) { step--; render(); } };
  $("#onbSkip").onclick = finish;
}

// --- Setup v2.5 ---
function setupV25UI() {
  initTheme();
  $("#themeToggleBtn")?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    $("#themeToggleBtn").textContent = next === "light" ? "🌙" : "🌓";
  });
  $("#authForm")?.addEventListener("submit", (e) => { e.preventDefault(); handleAuthSubmit("login"); });
  $("#authRegisterBtn")?.addEventListener("click", () => handleAuthSubmit("register"));
  $("#exportMdBtn")?.addEventListener("click", exportChatMarkdown);
  $("#exportJsonBtn")?.addEventListener("click", exportChatJSON);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      const t = e.target;
      const inInput = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (inInput) return;
      e.preventDefault();
      const input = $("#chatSearchInput");
      if (input) { input.hidden = false; input.focus(); input.select(); }
    }
  });
  $("#chatSearchInput")?.addEventListener("input", (e) => searchInChat(e.target.value.trim()));
  $("#chatSearchInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.target.value = ""; e.target.hidden = true;
      clearSearchMarks();
      if ($("#chatSearchCount")) $("#chatSearchCount").hidden = true;
    }
  });

  // === v2.7.1 OSINT/sci-fi UI: sidebar colapsable + right-panel tabs + breadcrumb ===
  initCollapsibleSidebar();
  initRightPanelTabs();
  initChatBreadcrumb();
  initContextTicker();
}

// ----------------------------------------------------------------------
// Sidebar colapsable (mantiene entityCanvas visible)
// ----------------------------------------------------------------------
function initCollapsibleSidebar() {
  const layout = $(".app-layout");
  const collapseBtn = $("#sidebarCollapseBtn");
  const expandBtn = $("#sidebarExpandBtn");
  if (!layout) return;
  const apply = (collapsed) => layout.classList.toggle("sidebar-collapsed", collapsed);
  try {
    const saved = localStorage.getItem("veritas:sidebar-collapsed") === "1";
    if (saved) apply(true);
  } catch {}
  collapseBtn?.addEventListener("click", () => { apply(true); try { localStorage.setItem("veritas:sidebar-collapsed", "1"); } catch {} });
  expandBtn?.addEventListener("click", () => { apply(false); try { localStorage.removeItem("veritas:sidebar-collapsed"); } catch {} });
  // El canvas debe redibujarse al colapsar (cambio de tamaño).
  const ro = new ResizeObserver(() => window.dispatchEvent(new Event("veritas:resize")));
  ro.observe($("#entityCanvas"));
}

// ----------------------------------------------------------------------
// Right panel: pestañas Sandbox / Proyecto / Grafo
// ----------------------------------------------------------------------
function initRightPanelTabs() {
  document.querySelectorAll(".rtab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.rtab;
      if (!name) return;
      // Asegurarse de que el panel derecho esté visible.
      const panel = $("#rightPanel");
      if (panel) panel.hidden = false;
      $(".app-layout")?.classList.remove("sandbox-hidden");
      switchRightTab(name);
    });
  });
  $("#rightPanelCollapse")?.addEventListener("click", () => toggleSandbox());
}

// ----------------------------------------------------------------------
// Breadcrumb de operación editable (título del chat)
// ----------------------------------------------------------------------
function initChatBreadcrumb() {
  const crumbTitle = $("#chatCrumbTitle");
  if (!crumbTitle) return;
  crumbTitle.addEventListener("blur", () => {
    const newTitle = crumbTitle.textContent.trim();
    if (newTitle && state.currentChatId) {
      state.chats[state.currentChatId] = state.chats[state.currentChatId] || {};
      state.chats[state.currentChatId].title = newTitle;
      const titleEl = $("#chatTitle");
      if (titleEl) titleEl.textContent = newTitle;
      renderChatList();
      // Persistir best-effort (fire and forget)
      fetch(`/api/chats/${encodeURIComponent(state.currentChatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      }).catch(() => {});
    }
  });
  crumbTitle.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); crumbTitle.blur(); }
    if (e.key === "Escape") { crumbTitle.blur(); }
  });
}

// ----------------------------------------------------------------------
// Context ticker (tokens, herramientas, fallback)
// ----------------------------------------------------------------------
function initContextTicker() {
  const tCtx = $("#tickerCtx");
  const tTools = $("#tickerTools");
  const tFallback = $("#tickerFallback");
  if (!tCtx) return;
  const computeToolsCount = () => {
    try {
      if (window.__VERITAS_TOOLS_COUNT__) return window.__VERITAS_TOOLS_COUNT__;
      // TOOL_REGISTRY es un Map; tras fetchAndHydrate tendrá el conteo real.
      if (typeof TOOL_REGISTRY !== "undefined") {
        if (TOOL_REGISTRY instanceof Map) return TOOL_REGISTRY.size;
        if (TOOL_REGISTRY && typeof TOOL_REGISTRY === "object") return Object.keys(TOOL_REGISTRY).length;
      }
    } catch {}
    return 18;
  };
  const update = () => {
    const used = (state.tokenUsage?.total_tokens || 0);
    const avail = (state.settings?.tokens?.contextWindow || 200000);
    if (tCtx) tCtx.textContent = `ctx ${(used/1000).toFixed(1)}k/${Math.round(avail/1000)}k`;
    if (tTools) tTools.textContent = `${computeToolsCount()} tools disponibles`;
    if (tFallback) {
      const last = state.lastProvider || "Estratega";
      tFallback.textContent = `Fallback: ${last}`;
    }
  };
  update();
  document.addEventListener("veritas:tokens-updated", update);
  document.addEventListener("veritas:chat-loaded", update);
  setInterval(update, 5000);
}

// ----------------------------------------------------------------------
// Project tree (pestaña Proyecto del panel derecho)
// ----------------------------------------------------------------------
const PROJECT_TREE_BASE = [
  { name: "docs/", type: "folder" },
  { name: "README.md", type: "md", indent: 1 },
  { name: "ARCHITECTURE.md", type: "md", indent: 1 },
  { name: "functions/", type: "folder" },
  { name: "chat.js", type: "file", indent: 1 },
  { name: "tools.js", type: "file", indent: 1 },
  { name: "sandbox.js", type: "file", indent: 1 },
  { name: "lib/", type: "folder" },
  { name: "memory.js", type: "file", indent: 1 },
  { name: "keyRotation.js", type: "file", indent: 1 },
  { name: "prompts/", type: "folder" },
  { name: "osint/", type: "folder", indent: 1 },
  { name: "verification.md", type: "md", indent: 2 },
  { name: "entity_graph.md", type: "md", indent: 2 },
  { name: "tools/", type: "folder" },
  { name: "webSearch.js", type: "file", indent: 1 },
  { name: "registryLookup.js", type: "file", indent: 1 },
  { name: "index.html", type: "file" },
  { name: "app.js", type: "file" },
  { name: "styles.css", type: "file" },
  { name: "schema.sql", type: "file" },
  { name: "wrangler.toml", type: "file" },
];

function _treeIcon(type) {
  const folder = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const md = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  const file = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
  return type === "folder" ? folder : (type === "md" ? md : file);
}

function renderProjectTree() {
  const root = $("#projectTree");
  if (!root || root.dataset.rendered === "1") return;
  // Mezclar archivos reales del sandbox con el árbol base.
  const sandboxFiles = Object.keys(state.sandbox?.files || {}).map((p) => ({ name: p, type: "file", indent: Math.min(3, p.split("/").length - 1) }));
  const all = [...PROJECT_TREE_BASE];
  if (sandboxFiles.length) {
    all.push({ name: "sandbox-output/", type: "folder" });
    sandboxFiles.forEach((f) => all.push({ ...f, indent: (f.indent || 0) + 1 }));
  }
  root.innerHTML = all.map((f) => {
    const indent = f.indent ? `<span class="tree-indent"></span>`.repeat(f.indent) : "";
    return `<div class="tree-row ${f.type}">${indent}${_treeIcon(f.type)}<span>${f.name}</span></div>`;
  }).join("");
  root.dataset.rendered = "1";
}

// ----------------------------------------------------------------------
// Entity graph (pestaña Grafo del panel derecho)
// ----------------------------------------------------------------------
let _entityGraphRendered = false;
function _collectEntityNodes() {
  // Agregar entidades detectadas desde perfiles/memoria si están disponibles.
  const nodes = [];
  const edges = [];
  try {
    const profiles = state.entityProfiles || (window.veritas?.state?.entityProfiles);
    if (Array.isArray(profiles)) {
      profiles.slice(0, 20).forEach((p, i) => {
        nodes.push({
          id: p.id || p.name || `e${i}`,
          label: p.name || p.id || `Entidad ${i+1}`,
          type: p.type || "entity",
        });
      });
    }
  } catch {}
  return { nodes, edges };
}

function renderEntityGraph() {
  const svg = $("#entityGraphSvg");
  const empty = $("#entityGraphEmpty");
  const meta = $("#entityGraphMeta");
  if (!svg) return;
  const { nodes, edges } = _collectEntityNodes();
  const W = 400, H = 320;
  if (!nodes.length) {
    if (empty) empty.hidden = false;
    if (meta) meta.textContent = "0 nodos · 0 relaciones";
    if (!_entityGraphRendered) {
      // Placeholder sutil con un nodo central.
      svg.innerHTML = `
        <circle cx="${W/2}" cy="${H/2}" r="10" fill="#35f2a0" opacity="0.15"/>
        <circle cx="${W/2}" cy="${H/2}" r="3" fill="#35f2a0" opacity="0.6"/>
        <text x="${W/2}" y="${H/2 + 28}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="#6c8480">entity_graph · a la espera de datos</text>
      `;
      _entityGraphRendered = true;
    }
    return;
  }
  if (empty) empty.hidden = true;
  // Layout circular simple.
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 40;
  const pos = nodes.map((_, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R };
  });
  const colorFor = (type) => {
    if (/sancion|ofac|sdn/i.test(type)) return "#ff4d5e";
    if (/empresa|mercantil|org/i.test(type)) return "#3fd1ff";
    if (/persona|individuo/i.test(type)) return "#35f2a0";
    if (/fuente|registro/i.test(type)) return "#b98cff";
    return "#35f2a0";
  };
  let out = "";
  edges.forEach(([a, b]) => {
    const ia = nodes.findIndex((n) => n.id === a);
    const ib = nodes.findIndex((n) => n.id === b);
    if (ia < 0 || ib < 0) return;
    out += `<line x1="${pos[ia].x}" y1="${pos[ia].y}" x2="${pos[ib].x}" y2="${pos[ib].y}" stroke="#2a3944" stroke-width="1"/>`;
  });
  if (!edges.length && nodes.length > 1) {
    // Conectar al centro (nodo 0) como anillo.
    for (let i = 1; i < nodes.length; i++) {
      out += `<line x1="${pos[0].x}" y1="${pos[0].y}" x2="${pos[i].x}" y2="${pos[i].y}" stroke="#1f332b" stroke-width="0.8" stroke-dasharray="2 3"/>`;
    }
  }
  nodes.forEach((n, i) => {
    const c = colorFor(n.type);
    out += `<circle cx="${pos[i].x}" cy="${pos[i].y}" r="6" fill="${c}" opacity="0.9">
      <title>${n.label} (${n.type})</title>
    </circle>`;
    out += `<text x="${pos[i].x}" y="${pos[i].y + 16}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="8" fill="#a9bdb8">${n.label.slice(0, 20)}${n.label.length > 20 ? "…" : ""}</text>`;
  });
  svg.innerHTML = out;
  if (meta) meta.textContent = `${nodes.length} nodos · ${edges.length} relaciones`;
  _entityGraphRendered = true;
}

window.veritas = { state, toast, scrollToMessage: (id) => {
  const el = document.querySelector(`[data-msg-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
}, openChat };
