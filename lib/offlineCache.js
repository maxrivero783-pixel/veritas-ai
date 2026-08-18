// ==============================================================================
// Véritas v2.12 — /lib/offlineCache.js
// ==============================================================================
// Cache en IndexedDB (vía Dexie.js) para modo offline. Implementa la lógica de
// la Sección 17 del BUILD:
//   - Estructura: chats, messages, pending_messages, bundle_metadata.
//   - Sync proactiva cada 5 min cuando hay conexión y pestaña visible.
//   - Detección online/offline (eventos del navegador).
//   - Cola de pending_messages (FIFO al reconectar).
//   - Banner "Modo offline" (lo gestiona app.js; este módulo solo emite eventos).
//   - Tamaño máximo del bundle: 5 MB (server-side limit).
//
// Eventos emitidos vía EventTarget:
//   "offline:online"  → {}
//   "offline:offline" → {}
//   "offline:synced"  → { ts, size, truncated }
//   "offline:pending-queued" → { chat_id, content }
//   "offline:pending-flushed" → { sent: N, failed: N }
// ==============================================================================

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

export class OfflineCacheManager extends EventTarget {
  constructor() {
    super();
    this.db = null;
    this.syncTimer = null;
    this.isOnline = navigator.onLine;
    this.lastSyncTs = 0;
    this.enabled = true;
  }

  // ------------------------------------------------------------------------------
  // init(): abre la BD Dexie y registra listeners online/offline.
  // ------------------------------------------------------------------------------
  async init() {
    if (typeof Dexie === "undefined") {
      console.warn("[offlineCache] Dexie.js no cargado — modo offline deshabilitado.");
      this.enabled = false;
      return;
    }
    this.db = new Dexie("veritas_offline");
    this.db.version(1).stores({
      chats: "id, user_email, category, updated_at",
      messages: "id, chat_id, created_at, [chat_id+created_at]",
      pending_messages: "++id, chat_id, created_at",
      bundle_metadata: "key",
    });
    await this.db.open();

    // Listeners online/offline.
    window.addEventListener("online", () => this.handleOnline());
    window.addEventListener("offline", () => this.handleOffline());

    // Sync proactiva cada 5 min si hay conexión.
    this.syncTimer = setInterval(() => {
      if (this.isOnline && !document.hidden) this.syncBundle();
    }, SYNC_INTERVAL_MS);

    // Sync al detectar que la pestaña vuelve a estar visible.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.isOnline) this.syncBundle();
    });
  }

  // ------------------------------------------------------------------------------
  // handleOnline(): reconexión detectada.
  // ------------------------------------------------------------------------------
  async handleOnline() {
    this.isOnline = true;
    this.dispatchEvent(new CustomEvent("offline:online"));
    await this.syncBundle();
    await this.flushPendingMessages();
  }

  // ------------------------------------------------------------------------------
  // handleOffline(): conexión perdida.
  // ------------------------------------------------------------------------------
  handleOffline() {
    this.isOnline = false;
    this.dispatchEvent(new CustomEvent("offline:offline"));
  }

  // ------------------------------------------------------------------------------
  // syncBundle(): GET /api/chats/offline-bundle → actualiza IndexedDB.
  // ------------------------------------------------------------------------------
  async syncBundle() {
    if (!this.enabled || !this.isOnline) return;
    try {
      const resp = await fetch("/api/chats/offline-bundle");
      if (!resp.ok) return;
      const bundle = await resp.json();
      const size = bundle.size_bytes || JSON.stringify(bundle).length;
      const truncated = bundle.truncated || size > MAX_BUNDLE_BYTES;

      await this.db.transaction("rw", this.db.chats, this.db.messages, this.db.bundle_metadata, async () => {
        await this.db.chats.clear();
        await this.db.chats.bulkPut(bundle.chats || []);
        await this.db.messages.clear();
        await this.db.messages.bulkPut(bundle.messages || []);
        await this.db.bundle_metadata.put({
          key: "last_sync",
          value: Date.now(),
          size_bytes: size,
          truncated,
        });
      });

      this.lastSyncTs = Date.now();
      this.dispatchEvent(new CustomEvent("offline:synced", {
        detail: { ts: this.lastSyncTs, size, truncated },
      }));
    } catch (e) {
      console.warn("[offlineCache] syncBundle falló:", e.message);
    }
  }

  // ------------------------------------------------------------------------------
  // loadChatsFromCache(): devuelve chats cacheados, ordenados por updated_at DESC.
  // ------------------------------------------------------------------------------
  async loadChatsFromCache() {
    if (!this.db) return [];
    return this.db.chats.orderBy("updated_at").reverse().toArray();
  }

  // ------------------------------------------------------------------------------
  // loadMessagesFromCache(chatId): mensajes cacheados del chat, ordenados.
  // ------------------------------------------------------------------------------
  async loadMessagesFromCache(chatId) {
    if (!this.db) return [];
    return this.db.messages
      .where("chat_id").equals(chatId)
      .sortBy("created_at");
  }

  // ------------------------------------------------------------------------------
  // queuePendingMessage({ chat_id, content, role, model, provider })
  // Encola un mensaje para enviar cuando se recupere la conexión.
  // ------------------------------------------------------------------------------
  async queuePendingMessage(msg) {
    if (!this.db) return;
    await this.db.pending_messages.add({
      chat_id: msg.chat_id,
      content: msg.content,
      role: msg.role || "user",
      model: msg.model || null,
      provider: msg.provider || null,
      created_at: new Date().toISOString(),
    });
    this.dispatchEvent(new CustomEvent("offline:pending-queued", {
      detail: { chat_id: msg.chat_id, content: msg.content },
    }));
  }

  // ------------------------------------------------------------------------------
  // getPendingMessages(): devuelve la cola en orden FIFO.
  // ------------------------------------------------------------------------------
  async getPendingMessages() {
    if (!this.db) return [];
    return this.db.pending_messages.orderBy("id").toArray();
  }

  // ------------------------------------------------------------------------------
  // flushPendingMessages(): envía todos los mensajes pendientes en FIFO.
  // Llama a /api/db/message por cada uno. Si falla, lo deja en cola.
  // ------------------------------------------------------------------------------
  async flushPendingMessages() {
    if (!this.db || !this.isOnline) return { sent: 0, failed: 0 };
    const pending = await this.getPendingMessages();
    let sent = 0, failed = 0;
    for (const msg of pending) {
      try {
        const resp = await fetch("/api/db/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: msg.chat_id,
            role: msg.role,
            content: msg.content,
            model: msg.model,
            provider: msg.provider,
          }),
        });
        if (resp.ok) {
          await this.db.pending_messages.delete(msg.id);
          sent++;
        } else {
          failed++;
          break; // si falla, parar para no saturar.
        }
      } catch (e) {
        failed++;
        break;
      }
    }
    if (sent > 0 || failed > 0) {
      this.dispatchEvent(new CustomEvent("offline:pending-flushed", { detail: { sent, failed } }));
    }
    return { sent, failed };
  }

  // ------------------------------------------------------------------------------
  // getLastSyncTs(): devuelve el timestamp de la última sync exitosa.
  // ------------------------------------------------------------------------------
  async getLastSyncTs() {
    if (!this.db) return 0;
    const row = await this.db.bundle_metadata.get("last_sync");
    return row?.value || 0;
  }

  // ------------------------------------------------------------------------------
  // getCacheSize(): estima el tamaño del cache en bytes.
  // ------------------------------------------------------------------------------
  async getCacheSize() {
    if (!this.db) return 0;
    const row = await this.db.bundle_metadata.get("last_sync");
    return row?.size_bytes || 0;
  }

  // ------------------------------------------------------------------------------
  // purge(): vacía todo el cache.
  // ------------------------------------------------------------------------------
  async purge() {
    if (!this.db) return;
    await this.db.transaction("rw", this.db.chats, this.db.messages, this.db.pending_messages, this.db.bundle_metadata, async () => {
      await this.db.chats.clear();
      await this.db.messages.clear();
      await this.db.pending_messages.clear();
      await this.db.bundle_metadata.clear();
    });
    this.dispatchEvent(new CustomEvent("offline:purged"));
  }

  // ------------------------------------------------------------------------------
  // hasPending(): ¿hay mensajes en cola?
  // ------------------------------------------------------------------------------
  async hasPending() {
    if (!this.db) return false;
    const count = await this.db.pending_messages.count();
    return count > 0;
  }
}

// ------------------------------------------------------------------------------
// Singleton.
// ------------------------------------------------------------------------------
let _instance = null;
export function getOfflineCacheManager() {
  if (!_instance) _instance = new OfflineCacheManager();
  return _instance;
}

export default {
  OfflineCacheManager,
  getOfflineCacheManager,
  SYNC_INTERVAL_MS,
  MAX_BUNDLE_BYTES,
};
