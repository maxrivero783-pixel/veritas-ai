// ==============================================================================
// Véritas v2.2 — /lib/notifications.js
// ==============================================================================
// NotificationManager — notificaciones push del navegador (Notifications API W3C).
// Implementa la lógica de la Sección 16 del BUILD:
//   - requestPermission() con feedback de estado.
//   - shouldNotify(eventType) con toggles por evento + check document.hidden.
//   - notify(eventType, payload) con buildPayload específico por evento.
//   - 4 eventos: model_response, shared_turn_acquired, shared_new_message,
//     tool_completed.
//   - Comportamiento especial en sesión compartida (Sección 16.5).
// ==============================================================================

const DEFAULT_SETTINGS = {
  enabled: false,
  events: {
    model_response: true,
    shared_turn_acquired: true,
    shared_new_message: true,
    tool_completed: false,
  },
};

const ICON_URL = "https://ik.imagekit.io/csdp6gbr6/17815803429593.png";

// ------------------------------------------------------------------------------
// NotificationManager
// ------------------------------------------------------------------------------
export class NotificationManager {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.lastNotificationTs = 0;
  }

  // ------------------------------------------------------------------------------
  // setSettings(settings): actualiza preferencias (desde users.profile_json).
  // ------------------------------------------------------------------------------
  setSettings(s) {
    this.settings = {
      enabled: !!s?.enabled,
      events: {
        ...DEFAULT_SETTINGS.events,
        ...(s?.events || {}),
      },
    };
  }

  // ------------------------------------------------------------------------------
  // isSupported(): el navegador soporta Notifications API.
  // ------------------------------------------------------------------------------
  isSupported() {
    return typeof window !== "undefined" && "Notification" in window;
  }

  // ------------------------------------------------------------------------------
  // getPermission(): devuelve 'default' | 'granted' | 'denied' | 'unsupported'.
  // ------------------------------------------------------------------------------
  getPermission() {
    if (!this.isSupported()) return "unsupported";
    return Notification.permission;
  }

  // ------------------------------------------------------------------------------
  // requestPermission(): pide permiso al navegador. Devuelve { ok, reason }.
  // ------------------------------------------------------------------------------
  async requestPermission() {
    if (!this.isSupported()) return { ok: false, reason: "unsupported" };
    try {
      const perm = await Notification.requestPermission();
      if (perm === "granted") this.settings.enabled = true;
      return { ok: perm === "granted", reason: perm };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // ------------------------------------------------------------------------------
  // shouldNotify(eventType, opts): decide si notificar.
  // Reglas:
  //   - Master toggle activo.
  //   - Toggle del evento activo.
  //   - Permiso concedido.
  //   - document.hidden (excepto para shared_turn_acquired que es crítico).
  //   - No interrumpir si el usuario está escribiendo (opts.userTyping=true).
  // ------------------------------------------------------------------------------
  shouldNotify(eventType, opts = {}) {
    if (!this.settings.enabled) return false;
    if (!this.settings.events[eventType]) return false;
    if (!this.isSupported() || Notification.permission !== "granted") return false;

    // shared_turn_acquired es crítico: notificar sin importar document.hidden.
    if (eventType === "shared_turn_acquired") {
      if (opts.userTyping) return false; // pero no interrumpir escritura.
      return true;
    }

    // Resto de eventos: solo si la pestaña está oculta.
    if (!document.hidden) return false;

    // Si el usuario está escribiendo, no notificar nuevos mensajes.
    if (opts.userTyping && eventType === "shared_new_message") return false;

    return true;
  }

  // ------------------------------------------------------------------------------
  // notify(eventType, payload): emite la notificación si shouldNotify es true.
  // ------------------------------------------------------------------------------
  notify(eventType, payload = {}, opts = {}) {
    if (!this.shouldNotify(eventType, opts)) return;

    // Rate-limit: no más de 1 notificación por segundo del mismo evento.
    const now = Date.now();
    if (now - this.lastNotificationTs < 1000) return;
    this.lastNotificationTs = now;

    const built = this.buildPayload(eventType, payload);
    if (!built) return;

    try {
      const notif = new Notification(built.title, {
        body: built.body,
        icon: built.icon || ICON_URL,
        tag: built.tag || `veritas-${eventType}`,
        requireInteraction: built.requireInteraction || false,
        silent: false,
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
        if (payload.messageId && typeof window.scrollToMessage === "function") {
          window.scrollToMessage(payload.messageId);
        }
        if (payload.chatId && typeof window.openChat === "function") {
          window.openChat(payload.chatId);
        }
      };

      // Auto-cerrar después de 10s si no es requireInteraction.
      if (!built.requireInteraction) {
        setTimeout(() => notif.close(), 10000);
      }
    } catch (e) {
      console.warn("[notifications] Falló notificación:", e.message);
    }
  }

  // ------------------------------------------------------------------------------
  // buildPayload(eventType, payload): construye { title, body, tag, icon, requireInteraction }.
  // ------------------------------------------------------------------------------
  buildPayload(eventType, payload) {
    switch (eventType) {
      case "model_response":
        return {
          title: "Véritas",
          body: `${payload.model || "Modelo"} respondió en "${payload.chatTitle || "chat"}"`,
          tag: `veritas-response-${payload.chatId || ""}`,
          requireInteraction: false,
        };

      case "shared_turn_acquired":
        return {
          title: "Véritas — Te toca el turno",
          body: `En "${payload.chatTitle || "chat"}"`,
          tag: `veritas-turn-${payload.chatId || ""}`,
          requireInteraction: true, // no auto-cerrar, importante
        };

      case "shared_new_message":
        return {
          title: `Véritas — ${payload.author || "Participante"}`,
          body: `Escribió en "${payload.chatTitle || "chat"}"`,
          tag: `veritas-msg-${payload.chatId || ""}`,
          requireInteraction: false,
        };

      case "tool_completed":
        return {
          title: "Véritas — Tool completada",
          body: `${payload.tool || "Tool"} finalizó (${payload.latency_ms || "?"}ms)`,
          tag: `veritas-tool-${payload.tool || ""}`,
          requireInteraction: false,
        };

      default:
        return null;
    }
  }
}

// ------------------------------------------------------------------------------
// Singleton.
// ------------------------------------------------------------------------------
let _instance = null;
export function getNotificationManager() {
  if (!_instance) _instance = new NotificationManager();
  return _instance;
}

export default {
  NotificationManager,
  getNotificationManager,
  DEFAULT_SETTINGS,
  ICON_URL,
};
