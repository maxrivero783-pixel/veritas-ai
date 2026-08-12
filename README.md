# VÉRITAS v2.4 — Intelligence OS para IA multi-modelo

> **Una interfaz auto-alojada para investigar, verificar, crear, programar y operar con IA usando Cloudflare, múltiples modelos, skills dinámicas y 43 herramientas integradas.**

Véritas no es solo un chat. Es un **centro de mando**: combina modelos IA, memoria, herramientas OSINT, conectores OAuth, sandbox de código, documentos, scraping, navegación, skills especializadas y una UI vanilla ultraligera para convertir preguntas complejas en resultados verificables.

---

## ✨ Lo que hace que Véritas sea WOOOW

- 🧠 **Orquestación multi-modelo**: 3 roles visibles — Agente, Estratega y Fast — con toggles internos Pensador y Code-first.
- 🧩 **77 skills built-in** en `prompts/`: verificación, OSINT, análisis, código, escritura, media, negocios, diseño, documentos y educación.
- 🛠️ **43 tools registradas** con dispatcher único, validación de argumentos y permisos por rol.
- 🔁 **Rotación de API keys** con cooldown, health checks y estado persistido en D1.
- 🔎 **Investigación y scraping multi-proveedor**: Jina, Tavily, Serper, Firecrawl, ScrapingBee, Spider Cloud, Rover, Browserless, Steel, Browser-use, GDELT y más.
- 🛰️ **OSINT defensivo**: DNS, Shodan, ZoomEye, Intelligence X, GFW, Apify Social/Places, NER y análisis coordinado.
- 🧾 **Document intelligence**: LlamaParse, AssemblyAI, análisis multimodal y repositorio documental en R2.
- 🔐 **OAuth real**: GitHub y Dropbox con tokens cifrados, refresh, auditoría y rate-limit handling.
- 💻 **Sandbox web pro**: previews HTML, 14 plantillas, snapshots, diff, test runner browser-side, error overlay, consola/network capture, export y push a GitHub.
- 🧠 **Memoria cross-chat**: memorias categorizadas con importancia, expiración y deduplicación.
- 👥 **Sesión compartida**: owner + editor, presencia, turnos, heartbeat y polling.
- 🌍 **i18n trilingüe**: Español, English, Français.
- 📴 **Modo offline** con IndexedDB y bundle de chats.
- 🧼 **Cron de limpieza** para purgar datos caducados.
- 🧬 **Entidad viva como telemetría**: canvas emocional/operativo para listening, thinking, searching, tooling, coding, error y offline.
- 🪄 **Prompt Arquitecto**: botón flotante arrastrable para convertir intenciones breves en prompts optimizados por rol.
- ⚡ **Sin build step**: frontend vanilla ES modules + Cloudflare Pages Functions.

---

## 🧰 Funcionalidades completas

### Chat multi-rol

- Selector de rol/categoría: **Agente**, **Estratega** y **Fast**. En Agente existen toggles para **Pensador** y **Code-first**.
- Streaming de respuestas con cancelación mediante `AbortController`.
- Parser de razonamiento interno y parser XML de tools (`<tool_call>` / `<tool_result>`).
- Loop de tools con límite defensivo y persistencia de cada llamada.
- Fallback manual o automático entre modelos según rol.
- Fallback experimental a Estratega permisivo cuando un modelo primario no puede completar una tarea.
- Contadores de tokens, tokens cacheados, truncado configurable y resumen de contexto.
- Auto-título de chats y renombrado manual.
- Búsqueda/filtrado de chats por categoría.

### Prompt Arquitecto

- Botón flotante pequeño, arrastrable y siempre accesible.
- Panel compacto para generar prompts optimizados por rol.
- Usa `z-ai/glm-4.7-flash` vía Puter para convertir una intención breve en un prompt listo para copiar.
- Permite seleccionar rol objetivo, generar, copiar, limpiar y volver a iterar.
- Pensado para sacar máximo provecho de Agente, Estratega, Fast y los modos internos Pensador/Code-first.

### Skills

- 77 skills built-in servidas desde `prompts/*.md`.
- Activación manual o automática según rol.
- Custom skills persistidas por usuario en D1.
- Editor UI para crear, editar, activar/desactivar y borrar skills personalizadas.
- `create_skill` como tool para que el agente pueda crear skills si el usuario lo pide explícitamente.
- Referencias auxiliares en `prompts/references/` cargadas bajo demanda.
- Smoke tests en `prompts/evals.json`.

### Investigación, OSINT y verificación

- Búsqueda web multi-proveedor.
- Scraping puntual, crawling, lectura web limpia, capturas y navegación headless.
- GDELT para eventos/noticias globales.
- DNS, Shodan, ZoomEye, Intelligence X y GFW.
- Apify para Google Places y redes sociales públicas.
- NER para estructurar personas, organizaciones, lugares, eventos y relaciones.
- Skills especializadas para verificación de afirmaciones, confiabilidad de fuentes, análisis de medios, comportamiento coordinado, grafos de entidades, cronologías y riesgo geopolítico.

### Sandbox y desarrollo

- Sandbox multiarchivo para artefactos HTML/CSS/JS static-first.
- Live preview con `preview_html` e instrumentación de consola, errores, promises y fetch.
- Overlay de errores con acción **Reparar con Coder**.
- La entidad canvas cambia de modo cuando el sandbox busca, ejecuta tools, programa, falla o queda offline.
- Snapshots locales, restauración y diff contra el último snapshot.
- Mini test runner browser-side mediante `window.__veritasTests`.
- 14 plantillas cargables con `load_template`: mapas, 3D, dashboards, grafos, informe OSINT, timeline, CSV dashboard, quiz, Markdown viewer y Kanban.
- Proxy seguro para recursos externos y APIs sin CORS.
- Soporte para generación de dashboards, quizzes HTML, visualizaciones, prototipos UI y artefactos web.
- Integración con GitHub OAuth para leer, escribir, crear ramas y abrir PRs.
- Herramientas para leer/escribir archivos de proyecto en R2.

### Documentos, media y archivos

- Upload/list/download/delete de storage.
- Repositorio documental numerado con búsqueda, descarga, borrado y adjuntos al chat.
- LlamaParse para PDF/DOCX complejos.
- AssemblyAI para transcripción de audio.
- Percepción multimodal para imagen, PDF, audio y video.
- Generación guiada de DOCX/PDF/PPTX/XLSX mediante skills documentales y sandbox.
- Dropbox OAuth para listar, buscar, leer, escribir y subir archivos grandes.

### Memoria y contexto

- Memorias cross-chat por usuario.
- Categorías: personal, tech, preference, fact, etc.
- Importancia, expiración, deduplicación y exclusión del chat actual para evitar feedback loops.
- Inyección de memorias relevantes al system prompt.
- Sliding window, resúmenes y truncado de tool results.

### Colaboración

- Sesiones compartidas owner + editor.
- Share tokens de un solo uso.
- Control de turnos con TTL.
- Heartbeat y presencia.
- Polling de mensajes compartidos.
- Indicadores de autoría y eventos de sesión.

### Offline, notificaciones y UX

- Cache offline con IndexedDB/Dexie.
- Bundle de chats offline y cola de mensajes pendientes.
- Banner de conexión y re-sincronización.
- Notificaciones push del navegador para respuestas, turnos y eventos compartidos.
- i18n en Español, English y Français.
- Tema cybernetic con canvas animado, estados `idle`, `active` y `processing`.
- Respeto a `prefers-reduced-motion`.

### Administración y observabilidad

- Dashboard de estado.
- Endpoints admin para estado de key pools, health checks y reset de cooldown.
- Auditoría de llamadas a tools y APIs externas.
- Guard rail local de R2: aviso al superar ~8GB y bloqueo preventivo cerca de ~9.5GB para proteger el free tier de 10GB.
- Tools largas en modo async/pending por defecto para evitar timeouts en Cloudflare Free Tier; usar `wait_for_completion=true` solo cuando se acepte el riesgo.
- Cron de purga para chats, memorias, OAuth pending y locks expirados.
- Perfil de usuario persistido en D1.

## 🧭 Arquitectura rápida

```txt
Usuario
  ↓
index.html + app.js + lib/*.js
  ↓
Cloudflare Pages Functions: functions/api/[[route]].js
  ↓
D1 ─ chats, mensajes, memorias, skills, OAuth, auditoría, key health
R2 ─ storage, documentos, archivos del proyecto
  ↓
Tools / Services / OAuth adapters
  ↓
Modelos IA + APIs externas autorizadas
```

### Estructura principal

```txt
.
├── app.js                       # Frontend principal
├── prompts.js                   # System prompts activos por rol/modelo
├── index.html                   # UI
├── styles.css                   # Tema visual
├── schema.sql                   # Esquema D1
├── wrangler.toml                # Configuración Cloudflare
├── functions/
│   ├── api/[[route]].js         # Router Worker/API principal
│   └── purge/scheduled.js       # Cron de limpieza
├── lib/
│   ├── agentOrchestrator.js
│   ├── contextManager.js
│   ├── fallbackChains.js
│   ├── i18n.js
│   ├── keyRotator.js
│   ├── oauth.js
│   ├── skillsRegistry.js
│   ├── toolRegistry.js
│   ├── toolRegistry.server.js
│   ├── services/                # 24 adaptadores HTTP + OAuth
│   └── tools/                   # 43 handlers ejecutables
├── prompts/
│   ├── *.md                     # 77 prompts de skills
│   ├── references/*.md          # Referencias de apoyo
│   ├── evals.json               # Smoke tests de skills
│   └── veritas_agent_system_prompt.md
└── tools/
    ├── veritas_agent_system_prompt.md
    └── veritas_worker.py        # Bridge Python de catálogo actual
```

---

## 🤖 Modelos establecidos

Los modelos se centralizan en `prompts.js` y `lib/fallbackChains.js`.

| Rol | Modelo primario | Provider |
|---|---|---|
| Agente | `nvidia/nemotron-3-super-120b-a12b:free` + `google/gemma-4-31b-it:free` + `openai/gpt-oss-20b:free` | OpenRouter |
| Agente Ultra | `nvidia/nemotron-3-ultra-550b-a55b:free` | OpenRouter |
| Percepción visual | `nvidia/nemotron-nano-12b-v2-vl:free` | OpenRouter |
| Percepción audio/video | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | OpenRouter |
| Estratega | `z-ai/glm-4.7-flash` → `z-ai/glm-4.6v-flash` → `z-ai/glm-4.5-flash` | Puter |
| Code-first dentro de Agente | `cohere/north-mini-code:free` → `poolside/laguna-s-2.1:free` → `poolside/laguna-xs-2.1:free` | OpenRouter |
| Fast / Prompt Arquitecto | `z-ai/glm-4.7-flash` → `z-ai/glm-4.6v-flash` → `z-ai/glm-4.5-flash` | Puter |

> Nota: Véritas ya no asume proveedores “uncensored free” como dependencia estable. El rol Estratega usa GLM con un system prompt permisivo, directo y contextualizado; los modelos externos free rotan demasiado rápido para prometer ausencia de censura.

Fallbacks adicionales permitidos:

- `nvidia/nemotron-3-nano-30b-a3b:free`
- `google/gemma-4-31b-it:free`
- `openai/gpt-oss-20b:free`
- `inclusionai/ling-3.0-flash:free` si vuelve a estar disponible en catálogo free

---

## 🛠️ Tools disponibles: 63

### Núcleo / proyecto

| Tool | Propósito |
|---|---|
| `search_repository` | Buscar documentos en el repositorio del usuario |
| `read_project_file` | Leer archivos del proyecto en R2 |
| `write_project_file` | Escribir archivos del proyecto en R2 |
| `create_skill` | Crear una skill personalizada en D1 |
| `preview_html` | Previsualizar HTML generado |
| `load_template` | Cargar plantillas sandbox |
| `fetch_via_proxy` | Proxy seguro para recursos externos |

### Búsqueda, scraping y navegación

| Tool | Propósito |
|---|---|
| `web_search` | Búsqueda web con Jina → Tavily → Serper |
| `scrape_url` | Lectura puntual de URL |
| `firecrawl_scrape` | Scraping estructurado |
| `firecrawl_crawl` | Crawling recursivo |
| `jina_reader_search` | Lectura/búsqueda con Jina Reader |
| `jina_github_search` | Búsqueda GitHub vía Jina |
| `gdelt_search` | Eventos/noticias globales |
| `rover_scrape` | Scraping/agente cloud Rover |
| `spider_cloud_search` | Search/crawl/screenshot/unblocker |
| `browserless_execute` | Chromium remoto |
| `browser_use_browse` | Navegación autónoma Browser-use |
| `browser_use_cloud` | Navegación autónoma Browser Use Cloud |
| `steel_session` | Sesiones persistentes Steel |
| `steel_auth_session` | Sesiones Steel Auth |

### OSINT e infraestructura

| Tool | Propósito |
|---|---|
| `dns_lookup` | DNS lookup |
| `shodan_search` | Shodan search |
| `zoomeye_search` | ZoomEye search |
| `intelx_search` | Intelligence X search |
| `apify_google_places` | Google Places/Maps vía Apify |
| `apify_social` | Redes sociales públicas vía Apify |
| `gfw_search` | Global Fishing Watch / marítimo |
| `ner_extract` | Extracción de entidades |

### Documentos, audio y media

| Tool | Propósito |
|---|---|
| `analyze_media` | Imagen/PDF/audio/video |
| `llamaparse_parse` | PDF/DOCX complejo a Markdown |
| `assemblyai_transcribe` | Transcripción/análisis de audio |

### OAuth: GitHub y Dropbox

| Provider | Tools |
|---|---|
| GitHub | `github_list_repos`, `github_read_file`, `github_write_file`, `github_write_files`, `github_create_branch`, `github_create_pr` |
| Dropbox | `dropbox_list_folder`, `dropbox_read_file`, `dropbox_write_file`, `dropbox_search`, `dropbox_upload_large` |

---

## 🧠 Skills

Las skills viven en `prompts/` y son cargadas por `lib/skillsRegistry.js`.

- **77 skills built-in**.
- **7 referencias** en `prompts/references/`.
- **Custom skills** persistidas en D1 (`user_skills`).
- Carga lazy por `fetch('/prompts/<skill>.md')`.
- Inyección al system prompt mediante `<veritas_skills>`.

Categorías:

```txt
verification, osint, analysis, coding, writing, research, data, media,
productivity, education, business, communication, design, document,
security, meta
```

---

## 🔐 Seguridad y privacidad

- Tokens OAuth cifrados con AES-GCM 256.
- Auditoría de llamadas externas en D1.
- SSRF guard en proxy de artefactos.
- Rate-limit handling en OAuth y rotador de keys.
- Validación de tool args en servidor.
- Control de roles por tool.
- Separación de OAuth usuario vs API keys de servicio.
- No hay secrets commiteados: se cargan por `wrangler secret put`.

---

## 🚀 Instalación local

### 1. Requisitos

- Node.js 18+
- Cuenta Cloudflare
- Wrangler CLI
- Git

```bash
npm install -g wrangler
```

### 2. Crear recursos Cloudflare

```bash
wrangler d1 create veritas-db
wrangler r2 bucket create veritas-storage
```

Actualiza `wrangler.toml`:

```toml
database_id = "<ID_REAL_DE_D1>"
GITHUB_OAUTH_CLIENT_ID = "<CLIENT_ID>"
DROPBOX_OAUTH_APP_KEY = "<APP_KEY>"
```

### 3. Crear esquema D1

```bash
wrangler d1 execute veritas-db --file schema.sql
```

### 4. Variables locales

Crea `.dev.vars` para desarrollo local:

```dotenv
DEV_USER_EMAIL=dev@veritas.local
ADMIN_EMAILS=dev@veritas.local
OPENROUTER_API_KEY_1=sk-or-v1-...
OAUTH_ENCRYPTION_KEY=<32 bytes hex>
GITHUB_OAUTH_CLIENT_SECRET=...
DROPBOX_OAUTH_APP_SECRET=...
```

### 5. Ejecutar

```bash
wrangler pages dev .
```

---

## 🔑 Secrets soportados

Todos los pools usan sufijo `_1`, `_2`, `_N`.

```txt
OPENROUTER_API_KEY_N
JINA_API_KEY_N
TAVILY_API_KEY_N
SERPER_API_KEY_N
SCRAPINGBEE_API_KEY_N
FIRECRAWL_API_KEY_N
BROWSER_USE_API_KEY_N
BROWSER_USE_CLOUD_API_KEY o BROWSER_USE_CLOUD_API_KEY_1
STEEL_API_KEY_N
STEEL_AUTH_API_KEY_N
ROVER_API_KEY_N
SPIDER_CLOUD_API_KEY_N
BROWSERLESS_API_KEY_N
APIFY_API_TOKEN_N
LLAMA_CLOUD_API_KEY_N
ASSEMBLYAI_API_KEY_N
SHODAN_API_KEY_N
ZOOMEYE_API_KEY_N
INTELX_API_KEY_N
JINA_READER_API_KEY_N
JINA_GITHUB_API_KEY_N
GFW_API_KEY_N
```

OAuth / sistema:

```txt
GITHUB_OAUTH_CLIENT_SECRET
DROPBOX_OAUTH_APP_SECRET
OAUTH_ENCRYPTION_KEY
DEV_USER_EMAIL
ADMIN_EMAILS
```

Ejemplo:

```bash
wrangler secret put OPENROUTER_API_KEY_1
wrangler secret put OAUTH_ENCRYPTION_KEY
```

---

## 🧪 Verificación de integridad

Comandos útiles:

```bash
# Sintaxis de módulos JS
for f in $(find . -name '*.js' -not -path './.git/*'); do
  cp "$f" /tmp/check.mjs && node --check /tmp/check.mjs || exit 1
done

# Validar JSON de evals
python3 -m json.tool prompts/evals.json >/dev/null

# Validar worker Python bridge
python3 -m py_compile tools/veritas_worker.py
```

Validaciones que este repo debe cumplir:

- `lib/toolRegistry.js` y `lib/toolRegistry.server.js` sincronizados.
- Todo handler declarado debe existir y exportar `run`.
- Todo service adapter debe exportar `callService`.
- Todo prompt declarado por `skillsRegistry` debe existir en `prompts/`.
- Ninguna skill debe depender de tools o modelos fuera de Véritas.

---

## 🧱 Filosofía del proyecto

Véritas apunta a ser un **sistema operativo personal para IA verificable**:

1. **Investigar** con fuentes y trazabilidad.
2. **Razonar** con modelos especializados.
3. **Crear** documentos, código, dashboards, campañas, diseños y artefactos.
4. **Actuar** mediante tools controladas y OAuth autorizado.
5. **Recordar** preferencias y contexto sin perder privacidad.
6. **Colaborar** en sesiones compartidas.
7. **Escalar** de respuestas rápidas a investigación profunda sin cambiar de herramienta.

---

## 🗺️ Roadmap sugerido

- [x] Entidad canvas como telemetría emocional/operativa.
- [x] Guard rail local para R2 free tier.
- [x] Modo async/pending para tools largas.
- [ ] Panel visual de salud de tools y cuotas por servicio.
- [ ] Generador visual de workflows multi-tool.
- [ ] Modo “investigación reproducible” con bitácora exportable.
- [ ] Evaluador automático de skills usando `prompts/evals.json`.
- [ ] Marketplace local de skills importables/exportables.
- [ ] Observabilidad avanzada con Cloudflare Logs.
- [ ] Export de investigaciones a PDF/DOCX/PPTX desde el sandbox.

---

## Licencia

Ver `LICENSE`.

---

**Véritas v2.4** — IA con herramientas, memoria, criterio y trazabilidad.  
**Menos humo. Más evidencia. Más poder.**


---

## 📧 Email (Brevo) — compatible con el resto de workers OSINT

La tool `email_report` envía informes/respuestas/documentos al **correo del usuario autenticado**
(opt-in: requiere `consent=true`). Configura en el dashboard (Settings → Variables):

| Variable | Descripción |
|----------|-------------|
| `BREVO_API_KEY_1` (o `EMAIL_API_KEY` / `BREVO_API_KEY`) | API key de Brevo — acepta el mismo esquema que OSINT-Scoop/Science |
| `BREVO_SENDER_EMAIL` (o `FROM_EMAIL`) | Remitente verificado en Brevo |
| `BREVO_SENDER_NAME` (o `FROM_NAME`) | Nombre del remitente (default: Véritas) |

Todos los correos se firman con: **- Remitido por Véritas, la IA especializada en OSINT -**

> **Nota de fusión v2.4:** este proyecto integra la selección de modelos y las
> herramientas públicas del artefacto de rescate (`V-ritas-main.zip`) con los
> fixes de consistencia de la sesión: versión 2.4.0 unificada, sin placeholders,
> OAuth documentado (GITHUB_OAUTH_CLIENT_ID / DROPBOX_OAUTH_APP_KEY), adiós a
> Dolphin (Estratega = GLM-4.7 Flash), mini-diálogos rotativos OSINT y lema
> "Información es ventaja. La ventaja es tuya."
