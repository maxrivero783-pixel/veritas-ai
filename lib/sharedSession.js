// ==============================================================================
// Véritas v2.2 — /lib/sharedSession.js
// ==============================================================================
// Gestión de sesión compartida en el frontend. Implementa la lógica de la
// Sección 14 del BUILD:
//   - Invitar (generar enlace, copiar, revocar).
//   - Heartbeat cada 5s para presencia + indicador "escribiendo".
//   - Polling cada 2s para nuevos mensajes + estado processing.
//   - Adquisición/liberación de turno con TTL.
//   - Indicador "escribiendo" en tiempo real.
//   - Autoría visible por mensaje.
//   - Leave / Close.
//
// El módulo emite eventos vía EventTarget para que app.js reaccione:
//   "shared:new-messages"   → { messages, presence }
//   "shared:turn-acquired"  → { expires_at }
//   "shared:turn-busy"      → { held_by, expires_at }
//   "shared:turn-released"  → {}
//   "shared:participant-joined" → { user_email }
//   "shared:participant-left"   → { user_email }
//   "shared:closed"         → {}
// ==============================================================================

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 5000;
const TURN_COUNTDOWN_TICK_MS = 1000;

export class SharedSessionManager extends EventTarget {
  constructor({ chatId, currentUserEmail, isOwner }) {
    super();
    this.chatId = chatId;
    this.currentUserEmail = currentUserEmail;
    this.isOwner = isOwner;
    this.active = false;
    this.lastTs = 0;
    this.heartbeatsTimer = null;
    this.pollTimer = null;
    this.turnCountdownTimer = null;
    this.turnHeldBy = null;
    this.turnExpiresAt = null;
    this.participants = [];
    this.isTyping = false;
    this.turnDurationMin = 30;
  }

  // ------------------------------------------------------------------------------
  // start(): arranca heartbeat + polling.
  // ------------------------------------------------------------------------------
  async start() {
    if (this.active) return;
    this.active = true;
    this.lastTs = Date.now();
    await this.heartbeat();
    await this.poll();
    this.heartbeatsTimer = setInterval(() => this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    this.pollTimer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
    this.turnCountdownTimer = setInterval(() => this.updateTurnCountdown(), TURN_COUNTDOWN_TICK_MS);
  }

  // ------------------------------------------------------------------------------
  // stop(): detiene todos los timers.
  // ------------------------------------------------------------------------------
  stop() {
    this.active = false;
    if (this.heartbeatsTimer) clearInterval(this.heartbeatsTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.turnCountdownTimer) clearInterval(this.turnCountdownTimer);
    this.heartbeatsTimer = null;
    this.pollTimer = null;
    this.turnCountdownTimer = null;
  }

  // ------------------------------------------------------------------------------
  // heartbeat(): POST /api/chat/:chatId/heartbeat con is_typing flag.
  // ------------------------------------------------------------------------------
  async heartbeat() {
    if (!this.active) return;
    try {
      await fetch(`/api/chat/${this.chatId}/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_typing: this.isTyping }),
      });
    } catch (e) { /* best-effort */ }
  }

  // ------------------------------------------------------------------------------
  // setTyping(isTyping): actualiza el flag y envía heartbeat inmediato.
  // ------------------------------------------------------------------------------
  setTyping(isTyping) {
    if (this.isTyping === isTyping) return;
    this.isTyping = isTyping;
    this.heartbeat();
  }

  // ------------------------------------------------------------------------------
  // poll(): GET /api/chat/:chatId/messages?since=lastTs
  // Devuelve nuevos mensajes + presencia + estado processing.
  // ------------------------------------------------------------------------------
  async poll() {
    if (!this.active) return;
    try {
      const resp = await fetch(`/api/chat/${this.chatId}/messages?since=${this.lastTs}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const now = Date.now();

      // Procesar mensajes nuevos.
      if (data.messages && data.messages.length > 0) {
        const newMsgs = data.messages.filter((m) => {
          const msgTs = new Date(m.created_at).getTime();
          if (msgTs > this.lastTs) {
            this.lastTs = msgTs;
            return true;
          }
          return false;
        });
        if (newMsgs.length > 0) {
          this.dispatchEvent(new CustomEvent("shared:new-messages", { detail: { messages: newMsgs } }));
        }
      }

      // Procesar presencia.
      this.participants = data.presence || [];
      this.dispatchEvent(new CustomEvent("shared:presence", { detail: { presence: this.participants } }));
    } catch (e) { /* best-effort */ }
  }

  // ------------------------------------------------------------------------------
  // acquireTurn(): POST /api/chat/:chatId/turn/acquire
  // Devuelve { acquired, expires_at?, held_by?, error? }
  // ------------------------------------------------------------------------------
  async acquireTurn() {
    try {
      const resp = await fetch(`/api/chat/${this.chatId}/turn/acquire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttl_min: this.turnDurationMin }),
      });
      if (!resp.ok) return { acquired: false, error: `HTTP ${resp.status}` };
      const data = await resp.json();
      if (data.acquired) {
        this.turnHeldBy = this.currentUserEmail;
        this.turnExpiresAt = data.expires_at;
        this.dispatchEvent(new CustomEvent("shared:turn-acquired", { detail: { expires_at: data.expires_at } }));
      } else {
        this.turnHeldBy = data.held_by;
        this.turnExpiresAt = data.expires_at;
        this.dispatchEvent(new CustomEvent("shared:turn-busy", { detail: { held_by: data.held_by, expires_at: data.expires_at } }));
      }
      return data;
    } catch (e) {
      return { acquired: false, error: e.message };
    }
  }

  // ------------------------------------------------------------------------------
  // releaseTurn(): POST /api/chat/:chatId/turn/release
  // ------------------------------------------------------------------------------
  async releaseTurn() {
    try {
      await fetch(`/api/chat/${this.chatId}/turn/release`, { method: "POST" });
      this.turnHeldBy = null;
      this.turnExpiresAt = null;
      this.dispatchEvent(new CustomEvent("shared:turn-released"));
    } catch (e) { /* best-effort */ }
  }

  // ------------------------------------------------------------------------------
  // updateTurnCountdown(): emite evento con el countdown actual.
  // ------------------------------------------------------------------------------
  updateTurnCountdown() {
    if (!this.turnExpiresAt) return;
    const remaining = Math.max(0, this.turnExpiresAt - Date.now());
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000);
    const formatted = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    this.dispatchEvent(new CustomEvent("shared:turn-countdown", {
      detail: { remaining_ms: remaining, formatted, expires_at: this.turnExpiresAt, held_by: this.turnHeldBy },
    }));

    // Si el turno expiró y lo teníamos nosotros, notificar.
    if (remaining === 0 && this.turnHeldBy === this.currentUserEmail) {
      this.dispatchEvent(new CustomEvent("shared:turn-expired"));
      this.turnHeldBy = null;
      this.turnExpiresAt = null;
    }
  }

  // ------------------------------------------------------------------------------
  // leave(): POST /api/chat/:chatId/leave y detener.
  // ------------------------------------------------------------------------------
  async leave() {
    try {
      await fetch(`/api/chat/${this.chatId}/leave`, { method: "POST" });
    } catch (e) { /* best-effort */ }
    this.stop();
    this.dispatchEvent(new CustomEvent("shared:left"));
  }

  // ------------------------------------------------------------------------------
  // closeSession() (solo owner): DELETE /api/chat/:chatId/share
  // ------------------------------------------------------------------------------
  async closeSession() {
    if (!this.isOwner) return { error: "not_owner" };
    try {
      await fetch(`/api/chat/${this.chatId}/share`, { method: "DELETE" });
      this.stop();
      this.dispatchEvent(new CustomEvent("shared:closed"));
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }
}

// ------------------------------------------------------------------------------
// Helpers estáticos (no requieren instancia).
// ------------------------------------------------------------------------------

// createShare(chatId): POST /api/chat/:chatId/share → devuelve { share_url }
export async function createShare(chatId) {
  const resp = await fetch(`/api/chat/${chatId}/share`, { method: "POST" });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: err.error || `HTTP ${resp.status}` };
  }
  return await resp.json();
}

// revokeShare(chatId): POST /api/chat/:chatId/share/revoke
export async function revokeShare(chatId) {
  const resp = await fetch(`/api/chat/${chatId}/share/revoke`, { method: "POST" });
  return resp.ok ? { ok: true } : { error: `HTTP ${resp.status}` };
}

// joinSession(chatId, token): GET /api/chat/:chatId/join?token=...
export async function joinSession(chatId, token) {
  const resp = await fetch(`/api/chat/${chatId}/join?token=${encodeURIComponent(token)}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { error: err.error || `HTTP ${resp.status}` };
  }
  return await resp.json();
}

// getParticipants(chatId): GET /api/chat/:chatId/participants
export async function getParticipants(chatId) {
  const resp = await fetch(`/api/chat/${chatId}/participants`);
  if (!resp.ok) return { error: `HTTP ${resp.status}` };
  return await resp.json();
}

// isRoleShareable(role): v2.12 — la elegibilidad real se decide por CATEGORÍA
// del chat en el servidor (agent y general). Se conserva por compatibilidad:
// los roles vigentes que comparten sesión son agent (Agente/Pensador) y fast
// en chats de categoría general.
export function isRoleShareable(role) {
  return ["agent", "fast"].includes(role);
}

export default {
  SharedSessionManager,
  createShare,
  revokeShare,
  joinSession,
  getParticipants,
  isRoleShareable,
};
