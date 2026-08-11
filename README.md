================================================================================
                              V É R I T A S   v 2 . 4
        Interfaz de Orquestación Multi-Proveedor de Modelos de IA
                  Cloudflare Pages + Workers + D1 + R2
================================================================================

Documento de referencia. Tres partes:
  A) Véritas como Pipeline de IA (descripción del producto)
  B) Capacidades técnicas
  C) Guía de configuración paso a paso

================================================================================
  PARTE A — VÉRITAS COMO PIPELINE DE IA
================================================================================

Véritas es una interfaz web auto-alojada que orquesta modelos de IA gratuitos de
múltiples proveedores (Puter.js + OpenRouter) en una pipeline de 5 roles:
Agente, Estratega, Razonamiento, Coder y Fast. Cada rol está asociado a un
modelo primario y una cadena de fallbacks configurada por rol. La interfaz
orquesta la invocación al modelo, parsea el razonamiento embebido, ejecuta tools
propietarias o externas mediante un protocolo XML embebido cuando el modelo no
soporta function calling nativo, y gestiona un Sandbox con Live Preview estilo
GLM-5.2 para roles Coder y Agente.

La versión 2.2 introdujo el API Key Rotator genérico y el Tool Caller
embebido con 20+ tools. La versión 2.3 añade el Stack Nemotron (modelos
NVIDIA gratuitos vía OpenRouter: Super 120B, Ultra 550B, Nano VL, Nano Omni,
Laguna, Dolphin), un pipeline de agente con orquestador multi-modelo que
soporta escalamiento dinámico a Ultra, percepción multimodal integrada,
cross-chat memory con memorias persistentes en D1, rate limit handling
automático con retry-backoff en todas las tools OAuth (GitHub y Dropbox),
upload de archivos grandes a Dropbox vía upload session (5-150MB), y limpieza
automática de datos caducados via cron trigger cada 6 horas.

Véritas también integra conexiones OAuth seguras a GitHub y Dropbox para
grounding documental y edición de código real. Los tokens del usuario viven
exclusivamente en el Worker, cifrados en reposo con AES-GCM 256. Adicionalmente,
ofrece optimización de tokens (sticky routing, prompt caching defensivo,
sliding window con resumen automático, truncado de tool results), sesión
compartida con control de turnos, notificaciones push del navegador, modo
offline con cache IndexedDB, renombrado manual y auto-sugerido de chats, e
internacionalización trilingüe (Español, English, Français) con cambio en
caliente.

Diagrama del flujo:

  Usuario → Chat UI → Selector de Rol → [Agente | Estratega | Razonamiento | Coder | Fast]
                                                                          |
                                     +------------------------------------+
                                     |
                                     v
                          Tool Caller Loop (max 5 iter)
                                     |
                          +----------+----------+
                          |                     |
                          v                     v
                    Tools internas        Tools OAuth
                    (búsqueda,            (GitHub, Dropbox,
                     scraping,             sandbox proxy)
                     repositorio,
                     firecrawl,
                     browser-use,
                     steel)
                                     |
                                     v
                            Modelo responde
                                     |
                                     v
                    [Live Preview | Persistencia D1 | Push a GitHub]

================================================================================
  PARTE B — CAPACIDADES TÉCNICAS
================================================================================

- Multi-proveedor: Puter.js (Estratega, Fast) + OpenRouter (Agente,
  Razonamiento, Coder) con 5 modelos primarios y 2 fallbacks por rol.

- API Key Rotator: pools numerados con cooldown automático ante 429/5xx,
  round-robin con cursor persistido en D1 (tabla api_key_cursor), estado de
  salud en tabla api_key_state, observabilidad vía /api/keys/* (solo admin).

- Tool Caller embebido: protocolo XML <tool_call>...</tool_call> para modelos
  sin function calling nativo. Loop con límite de 5 iteraciones (configurable),
  timeout de 30s por tool, persistencia de cada iteración en D1.

- 23 tools disponibles: search_repository, read_project_file, write_project_file,
  analyze_media, web_search, scrape_url, firecrawl_scrape, firecrawl_crawl,
  browser_use_browse, steel_session, preview_html, load_template, fetch_via_proxy,
  github_list_repos, github_read_file, github_write_file, github_write_files,
  github_create_branch, github_create_pr, dropbox_list_folder,
  dropbox_read_file, dropbox_write_file, dropbox_search, dropbox_upload_large.

- Sandbox unificado: live preview multi-archivo con CodeMirror 6, 7 plantillas
  pre-armadas (maplibre-basic, maplibre-markers, three-scene, chartjs-dashboard,
  d3-chart, tailwind-page, plotly-3d), librerías CDN (Leaflet, MapLibre, Three,
  Babylon, Chart.js, D3, Plotly, ECharts, Tailwind, Alpine, htmx, Anime, GSAP,
  PapaParse, Dexie, SQL.js, KaTeX, math.js), proxy HTTP para APIs sin CORS,
  export ZIP, push a GitHub, panel Console+Network para auto-debug.

- i18n trilingüe: Español (default), English, Français con cambio en caliente
  vía data-i18n + applyI18n(lang). Auto-detección de navigator.language en
  primera visita. Pluralización vía Intl.PluralRules.

- OAuth seguro: tokens AES-GCM 256 cifrados en D1 (tabla external_connections),
  refresh transparente (Dropbox cada 4h, GitHub no-op), auditoría completa en
  tabla external_api_calls, detección de revocación (401 → invalid=1),
  rate limit handling automático con retry-backoff en los adaptadores OAuth
  (github.js y dropbox.js) con mensajes amigables al usuario (MAX_RETRIES=2,
  BASE_BACKOFF_MS=1000ms).

- Optimización de tokens: sticky routing por chat (session_id = chat_id),
  caching defensivo con cache_control: ephemeral (ttl: 1h en sesiones
  compartidas), sliding window configurable (4-20 mensajes, default 8) con
  resumen acumulativo generado por GLM-4.5-Flash, truncado de tool results
  (0.5-8 KB, default 2 KB), chips de cached_tokens, contador usado/disponible
  en tiempo real con debounce 300ms.

- Stack Nemotron: modelos NVIDIA gratuitos vía OpenRouter. Agente usa
  Nemotron Super 120B (primario) con escalamiento automático a Nemotron Ultra
  550B (trigger manual o automático por frases clave). Percepción multimodal
  vía Nano VL (imagen/PDF) y Nano Omni (audio/video). Estratega y Pensador
  usan Nemotron, Fast usa GLM-4.5-Flash vía Puter. Fallback entre modelos
  del stack cuando el primario falla.

- Cross-chat memory: memorias del usuario persistentes en D1 (tabla
  user_memories) con categorías (personal, tech, preference, fact), dedup
  por fingerprint, importancia 1-5, expiración configurable, acceso por
  chat con exclusión del chat actual (feedback loop prevention). Extracción
  automática fire-and-forget vía GLM-Flash al final de cada respuesta.

- Cron de limpieza (functions/purge/scheduled.js): ejecuta cada 6 horas,
  purga mensajes de chats inactivos >30 días (conservando últimos 2),
  memorias expiradas, OAuth pendientes >15 min, y locks de turnos expirados.

- Dropbox upload session: tool dropbox_upload_large para archivos 5-150MB
  con chunks de 8MB (upload_session/start → append_v2 → finish).

- Sesión compartida: máximo 2 usuarios (owner + editor), control de turnos con
  TTL configurable (default 30 min), polling de 2s para mensajes nuevos,
  heartbeat de 5s para presencia, indicador "escribiendo" en tiempo real,
  autoría visible por mensaje, share_token UUID v4 de uso único.

- Notificaciones push (Notifications API W3C, sin dependencias externas):
  5 eventos (model_response, shared_turn_acquired, shared_new_message,
  tool_completed) con toggles por evento y requireInteraction en turnos.

- Modo offline: cache IndexedDB vía Dexie.js, sync proactiva cada 5 min,
  cola de pending_messages (FIFO al reconectar), banner "Modo offline",
  solo lectura (sin tools ni OAuth), límite 5 MB por bundle.

- Renombrado de chats: doble click en sidebar para edición in-place (1-100
  chars, sanitización HTML), auto-sugerencia con GLM-4.5-Flash tras primer
  intercambio (toggle en Ajustes, Ctrl+Z para deshacer en 10s).

- Cloudflare nativo: D1 (SQLite) para metadatos, R2 (objetos) para Carpeta
  Proyecto y Repositorio de Documentos, Workers (compute) para router y
  lógica de backend, Pages (hosting) para frontend estático, Access
  (Zero Trust) para auth por email allowlist.

- Animación Canvas 2D: entidad cybernetic con estados Idle/Active/Processing,
  transiciones con easeInOutCubic, soporte prefers-reduced-motion.

- Sin frameworks frontend, sin build step. Vanilla JS ES6+ con módulos. Todo
  funciona abriendo index.html vía Pages sin bundler.

================================================================================
  PARTE C — GUÍA DE CONFIGURACIÓN PASO A PASO
================================================================================

Esta guía permite a cualquier usuario con conocimientos básicos de terminal
desplegar su propia instancia de Véritas.

--------------------------------------------------------------------------------
  Paso 1 — Requisitos previos
--------------------------------------------------------------------------------

- Cuenta Cloudflare (Free tier suficiente).
- Node.js 18+ y npm.
- wrangler CLI:  npm install -g wrangler
- git.
- Cuenta en OpenRouter (gratuita): https://openrouter.ai/
- Puter.js no requiere cuenta (SDK frontend gratuito).
- Cuentas en GitHub y Dropbox (gratuitas) para conexiones OAuth.
- API keys opcionales según qué tools se quieran activar:
    * Jina AI:      https://jina.ai/
    * Tavily:       https://tavily.com/
    * Serper:       https://serper.dev/
    * ScrapingBee:  https://www.scrapingbee.com/
    * Firecrawl:    https://www.firecrawl.dev/
    * Browser-use:  https://browser-use.com/  (API hosted)
    * Steel.dev:    https://steel.dev/

--------------------------------------------------------------------------------
  Paso 2 — Fork/clone del repo
--------------------------------------------------------------------------------

  git clone https://github.com/<tu-usuario>/veritas.git
  cd veritas

--------------------------------------------------------------------------------
  Paso 3 — Crear D1 database y ejecutar schema.sql
--------------------------------------------------------------------------------

  wrangler d1 create veritas-db
  # Anota el database_id que devuelve el comando.

  wrangler d1 execute veritas-db --file=./schema.sql
  # En remoto:
  wrangler d1 execute veritas-db --remote --file=./schema.sql

--------------------------------------------------------------------------------
  Paso 4 — Crear bucket R2
--------------------------------------------------------------------------------

  wrangler r2 bucket create veritas-storage

--------------------------------------------------------------------------------
  Paso 5 — Configurar wrangler.toml
--------------------------------------------------------------------------------

Editar /wrangler.toml y reemplazar los placeholders:

  - database_id            → el ID devuelto por `wrangler d1 create`.
  - account_id             → tu Account ID de Cloudflare (dashboard).
  - GITHUB_OAUTH_CLIENT_ID → Client ID de la GitHub App (ver paso 8).
  - DROPBOX_OAUTH_APP_KEY  → App key de la Dropbox App (ver paso 9).

--------------------------------------------------------------------------------
  Paso 6 — Configurar Cloudflare Access (Zero Trust)
--------------------------------------------------------------------------------

  1. Ir a https://one.dash.cloudflare.com/ → Access → Applications.
  2. Crear aplicación protegiendo:  veritas.<sub>.pages.dev
  3. Política de acceso: permitir por email allowlist.
  4. En "Public paths" (bypass), añadir:
       /api/oauth/*/start
       /api/oauth/*/callback
     (El flujo OAuth no debe ser interceptado por Access. El Worker valida
      internamente con state en D1, que solo se genera si el usuario estaba
      autenticado al iniciar el flujo.)

--------------------------------------------------------------------------------
  Paso 7 — Secrets del Worker (API Key Rotator v2.2)
--------------------------------------------------------------------------------

Cada servicio soporta múltiples claves numeradas. El rotador descubre las
claves dinámicamente iterando <PREFIX>_API_KEY_1, _2, ..., _N (tope 32). Mínimo
1 clave por servicio; recomendado 2-3 para OpenRouter dada la inestabilidad del
free tier.

Patrón de naming:  <SERVICE_PREFIX>_API_KEY_<N>   donde <N> es entero 1-indexed.

  # OpenRouter (pool)
  wrangler secret put OPENROUTER_API_KEY_1
  wrangler secret put OPENROUTER_API_KEY_2     # opcional pero recomendado
  wrangler secret put OPENROUTER_API_KEY_3     # opcional

  # Búsqueda (cada una con su pool)
  wrangler secret put JINA_API_KEY_1
  wrangler secret put TAVILY_API_KEY_1
  wrangler secret put SERPER_API_KEY_1

  # Scraping / crawling / browser automation
  wrangler secret put SCRAPINGBEE_API_KEY_1
  wrangler secret put FIRECRAWL_API_KEY_1
  wrangler secret put BROWSER_USE_API_KEY_1
  wrangler secret put STEEL_API_KEY_1

  # OAuth (ver pasos 8 y 9 para obtener estos valores)
  wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
  wrangler secret put DROPBOX_OAUTH_APP_SECRET
  wrangler secret put OAUTH_ENCRYPTION_KEY      # generar con: openssl rand -hex 32

  # Configuración
  wrangler secret put DEV_USER_EMAIL            # solo desarrollo local
  wrangler secret put ADMIN_EMAILS              # CSV de emails admin para /api/keys/*

Lista completa de secrets (15+):

  1.  OPENROUTER_API_KEY_1            (obligatorio)
  2.  OPENROUTER_API_KEY_2            (recomendado)
  3.  OPENROUTER_API_KEY_3            (opcional)
  4.  JINA_API_KEY_1                  (opcional, habilita web_search vía Jina)
  5.  TAVILY_API_KEY_1                (opcional, habilita web_search vía Tavily)
  6.  SERPER_API_KEY_1                (opcional, habilita web_search vía Serper)
  7.  SCRAPINGBEE_API_KEY_1           (opcional, habilita scrape_url con render_js)
  8.  FIRECRAWL_API_KEY_1             (opcional, habilita firecrawl_scrape/crawl)
  9.  BROWSER_USE_API_KEY_1           (opcional, habilita browser_use_browse)
  10. STEEL_API_KEY_1                 (opcional, habilita steel_session)
  11. GITHUB_OAUTH_CLIENT_SECRET      (obligatorio para conexiones GitHub)
  12. DROPBOX_OAUTH_APP_SECRET        (obligatorio para conexiones Dropbox)
  13. OAUTH_ENCRYPTION_KEY            (obligatorio, 32 bytes hex)
  14. DEV_USER_EMAIL                  (solo local dev)
  15. ADMIN_EMAILS                    (CSV, para endpoints /api/keys/*)

CRÍTICO: NINGUNA clave jamás debe commitearse ni exponerse al frontend. Si por
error se commitea una clave:
  1. git rm --cached <archivo>
  2. Añadir a .gitignore
  3. Commit + push
  4. ROTAR la clave filtrada inmediatamente en el proveedor (asumir comprometida).
  5. Actualizar con:  wrangler secret put <NOMBRE_SECRET>
  6. Considerar git filter-repo o BFG Repo Cleaner para borrar del histórico.

Para añadir más claves a un pool en el futuro: crear un nuevo
<PREFIX>_API_KEY_<N+1>. El rotador lo detecta automáticamente al siguiente
deploy.

--------------------------------------------------------------------------------
  Paso 8 — Crear GitHub App (OAuth para conexiones externas)
--------------------------------------------------------------------------------

URL: https://github.com/settings/apps/new

Configuración:
  - Nombre:                     Véritas (o el que prefieras)
  - Homepage URL:               https://veritas.<sub>.pages.dev
  - Callback URL:               https://veritas.<sub>.pages.dev/api/oauth/github/callback
  - Webhook:                    DESACTIVAR (desmarcar "Active")
  - Permissions:
      Repository → Contents:        Read & Write
      Repository → Metadata:        Read-only (por defecto)
      Repository → Pull requests:   Read & Write (opcional, para github_create_pr)
      Account     → Email addresses: Read-only
  - Where can this app be installed: "Any account"
    (recomendado para que cualquier usuario conecte su propia cuenta)

Tras crear:
  - Copiar Client ID    → wrangler.toml [vars] GITHUB_OAUTH_CLIENT_ID
  - Generar Client Secret → wrangler secret put GITHUB_OAUTH_CLIENT_SECRET

Los tokens de GitHub App no expiran (hasta revocación). No se necesita refresh.

--------------------------------------------------------------------------------
  Paso 9 — Crear Dropbox App (OAuth para conexiones externas)
--------------------------------------------------------------------------------

URL: https://www.dropbox.com/developers/apps/create

Configuración:
  - API:                  Dropbox API
  - Type:                 Scoped access
  - Access:               App folder (recomendado, sandboxed a /Apps/Véritas/)
                          o Full Dropbox si prefieres acceso a toda la cuenta.
  - Pestaña Permissions:  activar
        files.content.read
        files.content.write
        files.metadata.read
    Guardar.
  - Pestaña Settings:
        Redirect URI:  https://veritas.<sub>.pages.dev/api/oauth/dropbox/callback
        Activar PKCE (require code challenge).

Tras crear:
  - Copiar App key    → wrangler.toml [vars] DROPBOX_OAUTH_APP_KEY
  - Copiar App secret → wrangler secret put DROPBOX_OAUTH_APP_SECRET

Los tokens de Dropbox expiran en 4 horas. El adaptador dropbox.js hace refresh
transparente antes de cada llamada si faltan <60s para expirar.

--------------------------------------------------------------------------------
  Paso 10 — Estructura del repo en GitHub
--------------------------------------------------------------------------------

  veritas/
  ├── README.txt
  ├── schema.sql
  ├── wrangler.toml
  ├── .gitignore
  ├── prompts.js
  ├── index.html
  ├── styles.css
  ├── app.js
  ├── functions/
  │   └── api/
  │       └── [[route]].js          # Worker router principal
  └── lib/
      ├── i18n.js
      ├── fallbackChains.js
      ├── toolRegistry.js
      ├── toolRegistry.server.js
      ├── keyRotator.js
      ├── oauth.js
      ├── contextManager.js
      ├── sharedSession.js
      ├── notifications.js
      ├── offlineCache.js
      ├── sandboxTemplates.js
      ├── tools/
      │   ├── search_repository.js
      │   ├── read_project_file.js
      │   ├── web_search.js
      │   ├── scrape_url.js
      │   ├── firecrawl_scrape.js
      │   ├── firecrawl_crawl.js
      │   ├── browser_use_browse.js
      │   ├── steel_session.js
      │   ├── preview_html.js
      │   ├── load_template.js
      │   ├── fetch_via_proxy.js
      │   ├── github_list_repos.js
      │   ├── github_read_file.js
      │   ├── github_write_file.js
      │   ├── github_write_files.js
      │   ├── github_create_branch.js
      │   ├── github_create_pr.js
      │   ├── dropbox_list_folder.js
      │   ├── dropbox_read_file.js
      │   ├── dropbox_write_file.js
      │   ├── dropbox_search.js
      │   └── dropbox_upload_large.js
      └── services/
          ├── jina.js
          ├── tavily.js
          ├── serper.js
          ├── scrapingbee.js
          ├── firecrawl.js
          ├── browser_use.js
          ├── steel.js
          └── oauth/
              ├── github.js
              └── dropbox.js

--------------------------------------------------------------------------------
  Paso 11 — Deploy
--------------------------------------------------------------------------------

  # Opción A: deploy por CLI
  wrangler pages deploy . --project-name veritas

  # Opción B: conectar el repo a Cloudflare Pages con:
  #     Build command:    (vacío)
  #     Output directory: /
  # Pages detecta /functions/api/[[route]].js como Worker automáticamente.

--------------------------------------------------------------------------------
  Paso 12 — Verificación post-deploy (smoke tests)
--------------------------------------------------------------------------------

  [ ] Login Access funciona (página pide email).
  [ ] Crear chat en submenú "Agent" → mandar mensaje (Nemotron Super).
  [ ] Activar "Pensamiento Profundo" → escalar a Nemotron Ultra.
  [ ] Crear chat en submenú "General" → mandar mensaje a GLM-4.5-Flash (Puter).
  [ ] Crear chat en submenú "Coder" → activar Sandbox con Laguna.
  [ ] Subir documento al Repositorio (drag&drop).
  [ ] En un chat Agente, invocar search_repository por número → devuelve texto.
  [ ] Activar Sandbox con plantilla maplibre-basic → mapa se renderiza.
  [ ] Conectar GitHub en Ajustes → Conexiones externas → cuenta aparece.
  [ ] Push a GitHub desde Sandbox → commit aparece en el repo.
  [ ] Conectar Dropbox → leer un documento vía dropbox_read_file.
  [ ] Subir archivo grande (>5MB) a Dropbox vía dropbox_upload_large.
  [ ] Verificar que las memorias cruzadas funcionan entre chats distintos.
  [ ] /api/keys/status?service=openrouter (con email admin) → devuelve pool.
  [ ] Dashboard de Ajustes muestra semáforos de modelos.

--------------------------------------------------------------------------------
  Paso 13 — Troubleshooting común
--------------------------------------------------------------------------------

- "429 from OpenRouter"
  El rotador ya reintenta automáticamente con otra clave. Si el error llega al
  frontend significa que TODAS las claves del pool están en cooldown.
  Soluciones: añadir más claves (OPENROUTER_API_KEY_N), esperar al cooldown
  (60s por defecto), o cambiar a modelo Puter (dolphin/glm-flash).

- "all_keys_rate_limited"
  Mismo caso que 429. Revisar /api/keys/status?service=openrouter (admin) para
  ver el estado del pool. Si todas están en cooldown, esperar o forzar reset
  con POST /api/keys/cooldown/reset { service, key_index }.

- "cf-access-user-email missing"
  La política de Cloudflare Access no está inyectando el header. Revisar que
  la aplicación Access protege el dominio correcto y que la política de email
  allowlist incluye al usuario. En dev local, configurar DEV_USER_EMAIL como
  wrangler secret.

- "Stream se corta" / respuestas truncadas
  Revisar que el Worker no hace buffering del body. Cache-Control debe ser
  no-cache y Connection: keep-alive en la Response del stream. El Worker debe
  usar TransformStream que reenvía chunks tal cual (no buffer).

- "Tool caller: límite de iteraciones alcanzado"
  El modelo entró en loop de tools. Subir el límite en Ajustes → Avanzado
  (default 5, máximo recomendado 10), o revisar el system prompt del rol: la
  instrucción "Tras emitir un <tool_call>, DETÉN tu generación y espera al
  <tool_result>" debe estar presente.

- "tool_not_found" al invocar /api/tool/invoke
  El handler /lib/tools/<name>.js no está desplegado. Verificar que el archivo
  existe, que se importa en el dispatcher de /functions/api/[[route]].js, y
  que el deploy de Pages subió la carpeta lib/tools/ completa.

- "OAuth callback da 401"
  El Client Secret o Redirect URI no coinciden. Verificar valores en dashboard
  GitHub/Dropbox vs wrangler secret / wrangler.toml. Para Dropbox, confirmar
  que PKCE está activado y que el redirect_uri incluye el path /callback exacto.

- "Sandbox preview no carga librerías"
  Verificar CSP del meta tag dentro del HTML inyectado en el iframe. Debe
  permitir: script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com
  https://cdn.jsdelivr.net https://esm.sh. Confirmar que las URLs CDN están
  correctamente escritas (sin versiones inexistentes).

- "Token de Dropbox expira y la tool falla"
  El adaptador dropbox.js hace refresh transparente si faltan <60s para
  expirar. Si la tool sigue fallando con 401, marcar external_connections.invalid=1
  y notificar al usuario en la UI para reconectar.

- "GitHub/Dropbox rate limit" (HTTP 429)
  Los adaptadores OAuth reintentan automáticamente hasta 2 veces con backoff
  escalonado. Si se agotan los reintentos, el tool devuelve un mensaje amigable
  indicando al usuario que espere. Para GitHub: 5,000 req/hora autenticado.
  Para Dropbox: el header Retry-After indica cuánto esperar.

- "Cross-chat memory no funciona"
  Verificar que la tabla user_memories existe en D1 (schema.sql). Las memorias
  se extraen automáticamente con GLM-Flash tras respuestas >100 caracteres.
  Pueden verificarse en el network tab: GET /api/memories.

- "Sesión compartida no permite invitar"
  Solo disponible si el modelo activo es Agente (owl-alpha), Estratega
  (dolphin-mistral) o Razonamiento (nemotron-ultra). En Coder y Fast el botón
  "Invitar" no aparece. Si el usuario cambia de modelo en un chat compartido,
  se ejecuta automáticamente DELETE /api/chat/:chatId/share.

- "Modo offline no carga chats antiguos"
  El cache IndexedDB se sincroniza cada 5 min cuando hay conexión. Si nunca se
  ha sync'eado (primera visita), no habrá cache. Forzar sync con botón
  "Sincronizar ahora" en Ajustes → Avanzado → Modo offline.

- "Notificaciones push no aparecen"
  Verificar en Ajustes → Avanzado → Notificaciones push que el permiso del
  navegador está concedido. Si el usuario bloqueó el diálogo, debe hacer click
  en el candado de la URL y permitir notificaciones manualmente. Las
  notificaciones solo se disparan cuando document.hidden === true.

- "cached_tokens chip no aparece"
  El chip solo se muestra si cached_tokens > 0. Si el modelo subyacente no
  soporta caching (NVIDIA NIM, Poolside, Nous free), OpenRouter ignora el campo
  cache_control silenciosamente y cached_tokens será 0. Es comportamiento
  esperado, no un bug.

--------------------------------------------------------------------------------
  Paso 14 — Novedades v2.4 sobre v2.2
--------------------------------------------------------------------------------

- Stack Nemotron: reemplaza owl-alpha/dolphin-mistral/nemotron-ultra con
  modelos NVIDIA gratuitos organizados en pipeline Agente/Estratega/Pensador/Fast.
- analyze_media: tool #22 para percepción multimodal (imagen, PDF, audio, video).
- dropbox_upload_large: tool #23 para archivos 5-150MB con upload session.
- Rate limit handling automático en GitHub y Dropbox (retry-backoff en adaptadores
  OAuth + mensajes amigables en tools).
- Cross-chat memory: memorias persistentes con extracción automática vía GLM-Flash.
- Cron de limpieza: purga automática de mensajes, memorias y datos caducados.
- Nuevo deploy necesario: ejecutar schema.sql para la tabla user_memories.

--------------------------------------------------------------------------------
  Paso 15 — Roadmap v2.4 (sugerido)
--------------------------------------------------------------------------------

- Caché de respuestas idénticas (hash del contexto + modelo).
- Exportación de chats a Markdown / PDF.
- Rate-limiting por usuario en el Worker (no solo por clave).
- Balanceo de carga inteligente del rotador (Least-Used en vez de Round-Robin).
- Google Drive como cuarta conexión OAuth.
- Service Worker + Web Push API para notificaciones cuando el navegador
  está cerrado (requiere VAPID keys y push server).
- Sistema de favoritos / starring de mensajes para priorizarlos en el
  pruning del bundle offline.
- Compartir chats como URL pública de solo lectura (read-only guest).

================================================================================
                              FIN DEL README.txt
================================================================================
