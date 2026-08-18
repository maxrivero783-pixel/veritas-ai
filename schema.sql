-- ==============================================================================
-- Véritas v2.12 — Esquema D1 (SQLite sobre Cloudflare D1)
-- ==============================================================================
-- Este script es idempotente: todas las sentencias usan IF NOT EXISTS.
-- Aplicar con:
--   wrangler d1 execute veritas-db --file=./schema.sql            (local)
--   wrangler d1 execute veritas-db --remote --file=./schema.sql   (remoto)
--
-- Convenciones:
--   - Fechas: DATETIME en UTC (DEFAULT CURRENT_TIMESTAMP).
--   - Epochs: INTEGER en milisegundos (Date.now() desde JS).
--   - JSON:   almacenado como TEXT; parseado en el Worker/frontend.
--   - Borrados en cascada: ON DELETE CASCADE en FKs a chats(id).
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- users: perfil del usuario (aislado por email de Cloudflare Access)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  password_hash TEXT,                                 -- PBKDF2-SHA256 (hex), si el usuario usa login propio
  password_salt TEXT,                                 -- salt aleatorio (hex) por usuario
  profile_json TEXT,                                  -- JSON con nombre, preferencias, ui_lang, maps_api_key_encrypted, etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sesiones de login por email+contraseña (token opaco, 7 días)
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Rate limiting silencioso por usuario (ventanas por scope)
CREATE TABLE IF NOT EXISTS rate_limits (
  scope_key TEXT PRIMARY KEY,                         -- "rl:<scope>:<email>:<window>"
  count INTEGER DEFAULT 1,
  window_start INTEGER NOT NULL
);


-- ------------------------------------------------------------------------------
-- chats: cabecera de cada conversación
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,                                -- UUID v4 generado en el frontend
  user_email TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('agent','coder','general')),
  title TEXT NOT NULL,
  summary_json TEXT,                                  -- v2.2: resumen acumulativo para sliding window
  is_shared INTEGER NOT NULL DEFAULT 0,               -- v2.2: 1 si el chat es sesión compartida
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_email, updated_at DESC);


-- ------------------------------------------------------------------------------
-- messages: cada turno del chat (user / assistant / tool / system)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,                                -- UUID v4
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
  model TEXT,                                         -- model id usado en este turno (trazabilidad)
  -- v2.12: ampliar providers reales (Cerebras/Cohere). El Worker además hace
  -- fallback a NULL si una DB antigua solo admite puter/openrouter, así el
  -- mensaje nunca se pierde. NULL permitido (CHECK no aplica a NULL).
  provider TEXT CHECK(provider IN ('puter','openrouter','cerebras','cohere')),
  content TEXT,                                       -- contenido textual visible
  thinking_content TEXT,                              -- razonamiento embebido (<razonamiento_interno>) o delta.reasoning
  tools_used TEXT,                                    -- JSON array de tool names invocadas en este mensaje
  author_email TEXT,                                  -- v2.2: quién envió el mensaje (sesiones compartidas)
  tokens_in INTEGER,                                  -- v2.2: tokens del prompt enviado
  tokens_out INTEGER,                                 -- v2.2: tokens de la respuesta
  cached_tokens INTEGER DEFAULT 0,                    -- v2.2: tokens servidos desde caché (prompt_tokens_details.cached_tokens)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_email, created_at);


-- ------------------------------------------------------------------------------
-- repo_documents: índice del Repositorio de Documentos del usuario (en R2)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS repo_documents (
  doc_number INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  doc_name TEXT NOT NULL,                             -- nombre original, configurable al subir
  r2_key TEXT NOT NULL,                               -- clave en R2: repo/<user_email>/<doc_number>_<slug>
  file_size INTEGER,
  mime_type TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_repo_user ON repo_documents(user_email, doc_number);
CREATE INDEX IF NOT EXISTS idx_repo_name ON repo_documents(user_email, doc_name);


-- ------------------------------------------------------------------------------
-- openrouter_calls: telemetría opcional de uso de OpenRouter
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openrouter_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  model TEXT NOT NULL,
  key_index INTEGER,                                  -- v2.2: índice de la clave usada (no el valor)
  status INTEGER,                                     -- HTTP status devuelto por upstream
  tokens_in INTEGER,
  tokens_out INTEGER,
  cached_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_orcalls_user ON openrouter_calls(user_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_orcalls_model ON openrouter_calls(model, ts DESC);


-- ------------------------------------------------------------------------------
-- api_key_state: estado del pool de claves por servicio (rotador v2.2)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_key_state (
  service TEXT NOT NULL,                              -- 'openrouter' | 'jina' | 'tavily' | 'serper' | 'scrapingbee' | 'firecrawl' | 'browser_use' | 'steel'
  key_index INTEGER NOT NULL,                         -- 1-indexed
  healthy INTEGER NOT NULL DEFAULT 1,                 -- 0/1
  cooldown_until INTEGER,                             -- epoch ms; NULL si no está en cooldown
  last_used INTEGER,                                  -- epoch ms
  requests_count INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,                                    -- mensaje del último error (truncado)
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service, key_index)
);
CREATE INDEX IF NOT EXISTS idx_keystate_service ON api_key_state(service, healthy);


-- ------------------------------------------------------------------------------
-- api_key_cursor: cursor round-robin por servicio (rotador v2.2)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_key_cursor (
  service TEXT PRIMARY KEY,
  last_index INTEGER NOT NULL DEFAULT 0,              -- último índice usado; rotador avanza a last_index+1
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- ------------------------------------------------------------------------------
-- tool_calls: auditoría de tool calls (modo embebido y nativo)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  chat_id TEXT,
  message_id TEXT,                                    -- mensaje assistant que disparó la tool
  tool_name TEXT NOT NULL,
  args_json TEXT,                                     -- JSON de los args (puede truncarse para auditoría)
  status TEXT NOT NULL,                               -- 'ok' | 'error' | 'forbidden' | 'timeout'
  output_preview TEXT,                                -- primeros 2 KB del output, para debug
  latency_ms INTEGER,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_toolcalls_user ON tool_calls(user_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_toolcalls_chat ON tool_calls(chat_id, ts);
CREATE INDEX IF NOT EXISTS idx_toolcalls_tool ON tool_calls(tool_name, ts DESC);


-- ------------------------------------------------------------------------------
-- oauth_pending: state + PKCE durante flujo OAuth (se borra al canjear)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_pending (
  state TEXT PRIMARY KEY,                             -- 32 bytes hex
  user_email TEXT NOT NULL,
  provider TEXT NOT NULL,                             -- 'github'
  code_verifier TEXT NOT NULL,                        -- PKCE code_verifier (43-128 chars)
  redirect_after TEXT,                                -- path del frontend al que volver tras callback
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_user ON oauth_pending(user_email, created_at);
-- Auto-purgar states viejos: el Worker debe DELETE WHERE created_at < datetime('now','-15 minutes')
-- en cada invocación del callback para evitar acumulación.


-- ------------------------------------------------------------------------------
-- external_connections: tokens OAuth del usuario, cifrados AES-GCM 256
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_connections (
  user_email TEXT NOT NULL,
  provider TEXT NOT NULL,                             -- 'github'
  access_token_encrypted TEXT NOT NULL,               -- base64(iv || ciphertext)
  refresh_token_encrypted TEXT,                       -- base64(iv || ciphertext); NULL si no aplica (GitHub)
  scopes TEXT,                                        -- CSV de scopes autorizados
  expires_at INTEGER,                                 -- epoch ms; NULL si no expira (GitHub)
  account_metadata TEXT,                              -- JSON: { login, name, email, avatar }
  invalid INTEGER NOT NULL DEFAULT 0,                 -- 1 si el token fue revocado (401 de la API)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_email, provider),
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_extconn_user ON external_connections(user_email);


-- ------------------------------------------------------------------------------
-- external_api_calls: auditoría de llamadas a APIs externas OAuth
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_api_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  provider TEXT NOT NULL,
  action TEXT NOT NULL,                               -- 'read_file', 'write_file', 'list_folder', etc.
  target TEXT,                                        -- repo/path del recurso tocado
  status INTEGER,                                     -- HTTP status
  latency_ms INTEGER,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_extcalls_user ON external_api_calls(user_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_extcalls_provider ON external_api_calls(provider, ts DESC);


-- ------------------------------------------------------------------------------
-- chat_participants: sesión compartida (owner + 1 editor)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_participants (
  chat_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  role TEXT NOT NULL,                                 -- 'owner' | 'editor'
  share_token TEXT,                                   -- UUID v4 (solo para invitados pendientes de canjear)
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (chat_id, user_email),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chatpart_chat ON chat_participants(chat_id);
CREATE INDEX IF NOT EXISTS idx_chatpart_user ON chat_participants(user_email);
CREATE INDEX IF NOT EXISTS idx_chatpart_share ON chat_participants(share_token);


-- ------------------------------------------------------------------------------
-- chat_turn_lock: bloqueo de turno en sesiones compartidas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_turn_lock (
  chat_id TEXT PRIMARY KEY,
  held_by_user_email TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,                       -- epoch ms
  expires_at INTEGER NOT NULL,                        -- epoch ms (acquired_at + 30 min default)
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (held_by_user_email) REFERENCES users(email) ON DELETE CASCADE
);


-- ------------------------------------------------------------------------------
-- chat_presence: heartbeat de presencia en sesiones compartidas
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_presence (
  chat_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  last_heartbeat INTEGER NOT NULL,                    -- epoch ms; se considera offline si > 10s
  is_typing INTEGER NOT NULL DEFAULT 0,               -- 0/1
  PRIMARY KEY (chat_id, user_email),
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_presence_chat ON chat_presence(chat_id, last_heartbeat);


-- ------------------------------------------------------------------------------
-- user_memories: memoria cross-chat del usuario (v2.3, Gap 2 del audit)
-- ------------------------------------------------------------------------------
-- Hechos clave, preferencias y contexto aprendido por el sistema a lo largo
-- de múltiples conversaciones. Se inyecta como contexto en buildContext().
--
-- Puntos de写入 (fire-and-forget desde el frontend tras cada respuesta):
--   1. Después de cada respuesta del modelo, si la conversación contiene datos
--      personales o preferencias explícitas, el frontend llama POST /api/memories.
--   2. El sistema puede sugerir memorias nuevas desde el resumen generado por
--      generateSummary().
--
-- Estrategia de almacenamiento:
--   - Cada fila = un hecho atómico (una preferencia, un dato personal, un
--     contexto técnico, etc.).
--   - category permite filtrar (personal, tech, preference, fact).
--   - importance 1-5 controla qué memorias se priorizan cuando hay muchas.
--   - access_count + last_accessed permiten LRU suave para limpieza.
--   - source_chat_id: para trazabilidad y para excluir la memoria del chat
--     que la originó (evitar feedback loop).
--   - expires_at: NULL = permanente; epoch ms para memorias temporales.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'fact' CHECK(category IN ('personal','tech','preference','fact')),
  content TEXT NOT NULL,                             -- el hecho en lenguaje natural
  source_chat_id TEXT,                               -- chat donde se originó (nullable)
  importance INTEGER NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed INTEGER,                             -- epoch ms
  expires_at INTEGER,                                -- epoch ms; NULL = permanente
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON user_memories(user_email, importance DESC, last_accessed DESC);
CREATE INDEX IF NOT EXISTS idx_memories_category ON user_memories(user_email, category);
CREATE INDEX IF NOT EXISTS idx_memories_expires ON user_memories(user_email, expires_at) WHERE expires_at IS NOT NULL;


-- ------------------------------------------------------------------------------
-- user_skills: skills personalizadas creadas por el usuario (v2.3, carga dinámica)
-- ------------------------------------------------------------------------------
-- Skills adicionales a las 77 estáticas del registry. Se crean/editan/borran
-- desde Settings > Skills, o autónomamente por el modelo vía la tool create_skill.
--
-- El frontend carga estas skills vía GET /api/skills y las fusiona con
-- getAllSkills() para mostrarlas en la UI y para buildSkillsPromptBlock().
--
-- Campos:
--   id: slug único autogenerado (kebab-case del nombre)
--   skill_json: objeto completo con la misma forma que SKILLS[] estáticas
--     { name, description, category, tier, inputType, outputType,
--       needsExternal, promptContent, icon, color, references,
--       allowedRoles }
--   prompt_content: el texto del system prompt de la skill (se inyecta directo
--     en buildSkillsPromptBlock en vez de leer un archivo .md)
--   is_active: 0/1, permite desactivar sin borrar
--   ordering: para ordenar manualmente en la UI
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_skills (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  skill_json TEXT NOT NULL,
  prompt_content TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  ordering INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_userskills_user ON user_skills(user_email, is_active, ordering);
CREATE INDEX IF NOT EXISTS idx_userskills_id ON user_skills(user_email, id);


-- ==============================================================================
-- FIN DEL SCHEMA
-- ==============================================================================
-- Notas:
--  * D1 es SQLite: respeta tipos TEXT/INTEGER/REAL. No hay BOOLEAN (usar INTEGER 0/1).
--  * No hay arrays nativos: serializar como JSON o CSV en columnas TEXT.
--  * Los AUTOINCREMENT solo en INTEGER PRIMARY KEY.
--  * Para añadir columnas en el futuro, usar ALTER TABLE (D1 soporta subconjunto
--    de SQLite ALTER TABLE). Para cambios mayores, crear tabla nueva y migrar.
--  * El Worker debe hacer UPSERT (INSERT OR REPLACE) en api_key_state,
--    api_key_cursor y external_connections para evitar race conditions.
-- ==============================================================================

-- v2.4 notification audit and future async reconciliation
CREATE TABLE IF NOT EXISTS notification_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_email TEXT NOT NULL, event_type TEXT NOT NULL, dedupe_key TEXT, status TEXT NOT NULL, provider TEXT DEFAULT 'brevo', recipient TEXT, subject TEXT, error TEXT, ts DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_notification_events_user ON notification_events(user_email, ts DESC);
CREATE INDEX IF NOT EXISTS idx_notification_events_dedupe ON notification_events(user_email, dedupe_key, ts DESC);
-- Caché de resultados de tools de solo lectura (TTL por created_at)
CREATE TABLE IF NOT EXISTS tool_cache (
  cache_key TEXT PRIMARY KEY,                         -- sha256(tool_name + args_json)
  user_email TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  result_json TEXT NOT NULL,
  status INTEGER DEFAULT 200,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_cache_created ON tool_cache(created_at);

CREATE TABLE IF NOT EXISTS llm_cache (
  cache_key TEXT PRIMARY KEY,                         -- sha256(modelo + mensajes)
  user_email TEXT NOT NULL,
  response_text TEXT NOT NULL,
  response_json TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_cache_user ON llm_cache(user_email, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_cache_created ON llm_cache(created_at);

CREATE TABLE IF NOT EXISTS async_jobs (id TEXT PRIMARY KEY, user_email TEXT NOT NULL, chat_id TEXT, tool_name TEXT NOT NULL, provider_job_id TEXT, status TEXT NOT NULL DEFAULT 'pending', args_json TEXT, result_json TEXT, notify_email INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_async_jobs_user ON async_jobs(user_email, created_at DESC);


-- ------------------------------------------------------------------------------
-- notification_devices: devices registered for polling-based push (v3.0)
-- Replaces FCM — pure Cloudflare Workers + D1, zero Google dependency.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_devices (
  device_id TEXT PRIMARY KEY,                         -- UUID generated on device first launch
  user_email TEXT NOT NULL,
  device_name TEXT DEFAULT 'Android',
  last_poll_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_devices_user ON notification_devices(user_email);

-- notifications: queue for polling-based push delivery
-- Uses AUTOINCREMENT seq for monotonic cursor (UUID v4 is not chronologically ordered).
CREATE TABLE IF NOT EXISTS notifications (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,               -- monotonic cursor for polling (seq > ?)
  id TEXT NOT NULL UNIQUE,                            -- UUID for external references / deep links
  user_email TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info' CHECK(type IN ('info','warning','success','error','osint')),
  deep_link TEXT,                                   -- optional: veritas://chat/... to open on tap
  data_json TEXT,                                   -- optional: extra JSON payload
  delivered INTEGER NOT NULL DEFAULT 0,              -- 1 = sent to at least one device
  delivered_at DATETIME,
  read INTEGER NOT NULL DEFAULT 0,                   -- 1 = user opened / dismissed
  read_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_user_delivered ON notifications(user_email, delivered, seq ASC);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);
