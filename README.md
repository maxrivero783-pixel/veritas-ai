# VÉRITAS v2.13 — Asistente OSINT con IA multi-modelo

> **Una interfaz auto-alojada para investigar, verificar, crear, programar y operar con IA usando Cloudflare, múltiples modelos, skills dinámicas y 61 herramientas integradas.**

Véritas no es solo un chat. Es un **centro de mando**: combina modelos IA, memoria, herramientas OSINT, conectores OAuth, sandbox de código, documentos, scraping, navegación, skills especializadas y una UI vanilla ultraligera para convertir preguntas complejas en resultados verificables.

---

## ✨ Lo que hace que Véritas sea WOOOW

- 🧠 **Orquestación multi-modelo**: 2 roles visibles — **Agente** y **Fast** — con toggle 🧠 Pensador (Nemotron Ultra) y Code-first.
- 🧩 **77 skills built-in** en `prompts/`: verificación, OSINT, análisis, código, escritura, media, negocios, diseño, documentos y educación.
- 🛠️ **61 tools registradas** con dispatcher único, validación de argumentos y permisos por rol.
- 🔁 **Rotación de API keys** con cooldown, health checks y estado persistido en D1.
- 🔎 **Investigación y scraping multi-proveedor**: Jina, Tavily, Serper, Firecrawl, ScrapingBee, Spider Cloud, Rover, Browserless, Steel, Browser-use, GDELT y más.
- 🛰️ **OSINT defensivo**: DNS, Shodan, ZoomEye, Intelligence X, GFW, Apify Social/Places, NER y análisis coordinado.
- 🧾 **Document intelligence**: LlamaParse, AssemblyAI y análisis multimodal. (R2 opcional: sin bucket, los endpoints de storage devuelven 503 claro.)
- 🔐 **OAuth real**: GitHub con tokens cifrados, refresh, auditoría y rate-limit handling.
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

- Selector de rol/categoría: **Agente** y **Fast**. En Agente existen toggles para **🧠 Pensador** y **Code-first**.
- Streaming de respuestas con cancelación mediante `AbortController`.
- Parser de razonamiento interno y parser XML de tools (`<tool_call>` / `<tool_result>`).
- Loop de tools con límite defensivo y persistencia de cada llamada.
- Fallback automático entre modelos según rol (Agente vía OpenRouter; Fast vía Cohere).
- Contadores de tokens, tokens cacheados, truncado configurable y resumen de contexto.
- Auto-título de chats y renombrado manual.
- Búsqueda/filtrado de chats por categoría.

### Prompt Arquitecto

- Botón flotante pequeño, arrastrable y siempre accesible.
- Panel compacto para generar prompts optimizados por rol.
- Usa `/api/llm/complete` (cadena Cohere → OpenRouter) para convertir una intención breve en un prompt listo para copiar.
- Permite seleccionar rol objetivo, generar, copiar, limpiar y volver a iterar.
- Pensado para sacar máximo provecho de Agente y Fast, y los modos internos Pensador/Code-first.

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

### Memoria y contexto

- Memorias cross-chat por usuario.
- Categorías: `personal`, `tech`, `preference`, `fact`.
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
│   ├── services/                # 29 adaptadores HTTP + OAuth
│   └── tools/                   # 61 handlers ejecutables + 2 helpers (_handlers, _publicData)
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
| Agente | `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter |
| Agente 🧠 Pensador (Ultra) | `nvidia/nemotron-3-ultra-550b-a55b:free` | OpenRouter |
| Percepción visual | `nvidia/nemotron-nano-12b-v2-vl:free` | OpenRouter |
| Percepción audio/video | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | OpenRouter |
| Code-first dentro de Agente | `cohere/north-mini-code:free` → `poolside/laguna-s-2.1:free` → `poolside/laguna-xs-2.1:free` | OpenRouter |
| Fast | `cohere/command-a-plus-05-2026` → `cohere/north-mini-code` | Cohere |

> Nota (v2.12k): roles activos **Agente** y **Fast** (Pensador como toggle). Agente orquesta tools en el server (máx. 2 rondas) vía OpenRouter; Fast usa Cohere (Command A+ primario) con system prompt corto orientado a búsqueda.
>
> Nota (v2.13): Fast queda **parametrizado** vía `ROLE_PARAMS` (`lib/fallbackChains.js`): `thinking:"off"` y `stream:false`, reforzados server-side por el Worker. En el rol Fast se ocultan los botones ✨ Skills, 🧠 Pensador y 👥 Compartir sesión. Los botones de adjuntar (📎) y búsqueda (🔍) muestran emoji en vez de texto.
>
> Nota (v2.13b): cadena Fast reordenada para **thinking off real**: primario `command-r-plus-08-2024` (modelo no-thinking); `command-a-plus-05-2026` (rechaza `thinking:{type:"disabled"}` con 422, siempre razona) queda como fallback de emergencia y `command-r-08-2024` cierra la cadena.
>
> Nota (v2.13c): el toggle 🔍 Búsqueda+Scraping se oculta en el rol Agente (su system prompt ya es SEARCH-FIRST: siempre busca con tools antes de responder); Fast lo conserva junto a 📎. Cambiar de pestaña/rol limpia la vista del chat abierto (`closeChatView`): detiene generación y sesión compartida, vacía mensajes y muestra el estado vacío.

Fallbacks adicionales permitidos:

- `nvidia/nemotron-3-nano-30b-a3b:free`
- `google/gemma-4-31b-it:free`
- `openai/gpt-oss-20b:free`
- `inclusionai/ling-3.0-flash:free` si vuelve a estar disponible en catálogo free

---

## 🛠️ Tools disponibles: 61

### Búsqueda web general

| Tool | Propósito |
|---|---|
| `exa_search` | Búsqueda semántica para IA (Exa.ai): resultados por significado, no solo keywords. Modos: search (búsqueda neural/auto/k |
| `hackernews_search` | Busca discusiones y señales técnicas en Hacker News vía Algolia. |
| `web_search` | Búsqueda web. Proveedores en orden de preferencia: Jina → Tavily → Serper. |

### Lectura/scraping de páginas

| Tool | Propósito |
|---|---|
| `fetch_via_proxy` | Llamada HTTP a una API externa desde el iframe del Sandbox vía proxy del Worker. Evita CORS. Si la URL pertenece a un se |
| `firecrawl_crawl` | Crawl recursivo de un sitio web completo (hasta N páginas) vía Firecrawl. |
| `firecrawl_scrape` | Scraping de URL con extracción estructurada vía Firecrawl. Devuelve markdown limpio. |
| `jina_reader_search` | Lectura de URLs a Markdown limpio y búsqueda web combinada vía Jina Reader (r.jina.ai). Modo reader: extrae contenido co |
| `rover_scrape` | Scraper cloud MCP-native (rtrvr.ai). Modo scrape: extracción instantánea de URL a Markdown. Modo agent: agente web multi |
| `scrape_url` | Scraping de una sola URL. Proveedores: Jina r.jina.ai → ScrapingBee. |
| `scrapedo_scrape` | Scraping con proxies rotativos y anti-bot (Scrape.do). Modos: scrape (extrae cualquier URL como markdown/raw, con render |

### Enciclopedias y datos estructurados

| Tool | Propósito |
|---|---|
| `wikidata_search` | Busca entidades estructuradas, aliases y relaciones en Wikidata. |
| `wikipedia_search` | Busca contexto enciclopédico y desambiguación en Wikipedia. |

### Eventos y noticias globales

| Tool | Propósito |
|---|---|
| `gdelt_search` | Búsqueda en GDELT Project (global events database). Modos: events (eventos globales con actores, temas, ubicaciones), gk |

### OSINT técnico: dominios, IPs, certificados, dispositivos

| Tool | Propósito |
|---|---|
| `crtsh_lookup` | Busca certificados y subdominios públicos en crt.sh. |
| `dns_lookup` | Resolución DNS y análisis de dominios vía Google DNS API. Modos: resolve (consulta A/AAAA/MX/NS/TXT/CNAME/SOA/PTR/SRV/CA |
| `rdap_lookup` | Consulta RDAP público para dominios, IPs y ASNs. |
| `shodan_search` | Búsqueda OSINT de infraestructura en Shodan. Modos: search (dispositivos/puertos/servicios), host (detalle de IP), explo |
| `zoomeye_search` | Búsqueda OSINT de infraestructura en ZoomEye. Modos: search (web/host search), host (dispositivos), ip (detalle de IP).  |

### Ciberseguridad y vulnerabilidades

| Tool | Propósito |
|---|---|
| `cisa_kev_search` | Busca vulnerabilidades explotadas conocidas en CISA KEV. |
| `gfw_search` | Búsqueda web alternativa vía GFW API. Motor de búsqueda general como respaldo/alternativa a Jina/Tavily/Serper. Resultad |
| `intelx_search` | Búsqueda OSINT en Intelligence X (IntelX). Modos: search (busqueda inteligente de datos filtrados), results (resultados  |
| `nvd_cve_search` | Busca CVEs y detalles de severidad en NVD. |

### Legal y regulatorio

| Tool | Propósito |
|---|---|
| `courtlistener_search` | Jurisprudencia y dockets de EE.UU. en CourtListener (Free Law Project): ~8M de opiniones federales/estatales + RECAP/PAC |
| `sec_edgar_search` | Consulta filings recientes de SEC EDGAR. |

### Académico y científico

| Tool | Propósito |
|---|---|
| `crossref_search` | Busca metadatos bibliográficos y DOI en Crossref. |
| `nasa_search` | Busca contenido público en NASA Image and Video Library. |
| `openalex_search` | Busca literatura académica abierta e instituciones en OpenAlex. |
| `semantic_scholar_search` | Busca papers, autores y citas en Semantic Scholar Graph API. |

### Geolocalización, clima y vuelos

| Tool | Propósito |
|---|---|
| `aviationstack_flights` | Datos de aviación en tiempo real (AviationStack): estado de vuelos, aeropuertos y aerolíneas. Modos: flights (por número |
| `geonames_search` | Busca lugares con GeoNames. |
| `nominatim_search` | Geocodifica lugares con Nominatim/OpenStreetMap. |
| `open_meteo_weather` | Clima actual y pronóstico con Open-Meteo. |

### Software y dependencias

| Tool | Propósito |
|---|---|
| `jina_github_search` | Búsqueda de código y repositorios GitHub vía Jina. Modos: search (busqueda de código), readme (lectura de README markdow |
| `npm_package_info` | Consulta metadatos, licencia y dependencias de un paquete npm. |
| `pypi_package_info` | Consulta metadatos, licencia y compatibilidad de un paquete PyPI. |

### Análisis de texto y entidades

| Tool | Propósito |
|---|---|
| `ner_extract` | Extracción de entidades nombradas (NER) de texto. Extrae URLs, emails, teléfonos, IPs (v4/v6), fechas, hashtags, mencion |

### GitHub (OAuth)

| Tool | Propósito |
|---|---|
| `github_create_branch` | Crea una nueva rama en un repo GitHub. |
| `github_create_pr` | Crea un Pull Request en un repo GitHub. |
| `github_list_repos` | Lista los repositorios del usuario conectado en GitHub. |
| `github_read_file` | Lee un archivo de un repo GitHub del usuario. |
| `github_write_file` | Crea o actualiza un archivo en un repo GitHub del usuario. Crea commit. |
| `github_write_files` | Escribe múltiples archivos en un repo GitHub en un solo commit (Trees API). |

### Media, audio y documentos

| Tool | Propósito |
|---|---|
| `analyze_media` | Analiza contenido multimedia (imagen, PDF, audio, video) usando los modelos Nano del stack Nemotron. El target puede ser |
| `assemblyai_transcribe` | Transcripción de audio a texto + inteligencia. 99+ idiomas, diarización de speakers, sentimiento, resumen, topics, chapt |
| `llamaparse_parse` | Parsea documentos PDF/DOCX complejos a Markdown estructurado. Extrae tablas, OCR, ecuaciones. Acepta URL pública o archi |

### Proyecto y sandbox

| Tool | Propósito |
|---|---|
| `create_skill` | Crea una skill personalizada del usuario y la persiste en D1. Úsala solo cuando el usuario pida explícitamente crear una |
| `load_template` | Inserta una plantilla pre-armada en el Sandbox con parámetros. |
| `preview_html` | Carga HTML en el Live Preview del Sandbox. |
| `read_project_file` | Lee un archivo de la Carpeta Proyecto del usuario en R2. |
| `search_repository` | Busca documento en el repositorio del usuario por número o nombre. |
| `write_project_file` | Escribe o sobrescribe un archivo en la Carpeta Proyecto del usuario en R2. Persiste archivos generados por la IA (código |

### Navegación con browser real

| Tool | Propósito |
|---|---|
| `browser_use_browse` | Ejecuta una tarea de navegación autónoma descrita en lenguaje natural vía Browser-use hosted API. Latencia alta (10-60s) |
| `browser_use_cloud` | Agente navegador autónomo NL vía Browser Use Cloud API. Alternativa a browser_use_browse con auto-provisioning de keys.  |
| `browserless_execute` | Ejecuta código en clúster headless Chromium remoto (Browserless). Modos: evaluate (ejecuta JS en página), screenshot (ca |
| `spider_cloud_search` | Crawler ultra-rápido Spider Cloud. Modos: search (búsqueda + crawling combinado), crawl (multi-página paralelo), screens |
| `steel_auth_session` | Sesiones de navegador autenticadas en Steel.dev con proxy, cookies, fingerprints custom. Modos: create (crea sesión con  |
| `steel_session` | Crea/release/scrape sesiones de navegador persistente en Steel.dev. |

### Redes sociales y mapas (Apify)

| Tool | Propósito |
|---|---|
| `apify_google_places` | Búsqueda OSINT en Google Places/Maps. Extrae listings de negocios locales con dirección, teléfono, web, coords, rating y |
| `apify_social` | Scraping de perfiles/posts públicos en redes sociales. Plataformas: facebook_posts, instagram_profile, instagram_posts,  |

### Inferencia LLM directa

| Tool | Propósito |
|---|---|
| `cohere_infer` | Reservado para inferencia auxiliar Cohere. |

### Utilidades

| Tool | Propósito |
|---|---|
| `email_report` | Envía un reporte opt-in por Brevo. |

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
```

### 5. Ejecutar

```bash
wrangler pages dev .
```

---

## 🔑 Secrets soportados

Todos los pools usan sufijo `_1`, `_2`, `_N`. Desde v2.12i el rotador también
acepta la primera clave **sin sufijo** (p. ej. `COHERE_API_KEY` además de
`COHERE_API_KEY_1`), para evitar que una clave configurada sin el `_1` quede
sin detectar. Para verificar qué claves ve realmente el Worker (nombres, nunca
valores): `GET /api/keys/diagnose` (solo admin).

```txt
OPENROUTER_API_KEY_N
COHERE_API_KEY_N          ← LLM rol Fast (Command A+ / North Mini Code)
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
EXA_API_KEY_N
SCRAPEDO_API_TOKEN_N
COURTLISTENER_API_TOKEN_N
AVIATIONSTACK_API_KEY_N
BREVO_API_KEY_N
```

OAuth / sistema:

```txt
GITHUB_OAUTH_CLIENT_SECRET
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

**Véritas v2.12** — IA con herramientas, memoria, criterio y trazabilidad.  
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

> **Nota histórica de fusión (v2.4):** este proyecto integró la selección de modelos y las
> herramientas públicas del artefacto de rescate (`V-ritas-main.zip`) con los
> fixes de consistencia de la sesión. Evolución posterior: Dropbox eliminado en v2.8;
> Puter/GLM/Estratega eliminados en v2.9+; Cerebras eliminado en v2.12k (Fast = Cohere).
> Lema: "Información es ventaja. La ventaja es tuya."

---

## 🔀 Prioridad de proveedores (por plan free)

El dispatcher usa los proveedores en orden según **generosidad del plan free** y **efectividad** (v2.6):

### Búsqueda web (`/api/search` → web_search)
| Orden | Proveedor | Plan free | Nota |
|---|---|---|---|
| 1º | **Jina** | 1M tokens/mes (~generoso) | Primaria: plan más amplio |
| 2º | **Tavily** | 1.000 créditos/mes | Respaldo |
| 3º | **Serper** | 2.500 créditos (única vez) | Último recurso |

### Scraping (`/api/scrape` → scrape_url)
| Orden | Proveedor | Plan free | Nota |
|---|---|---|---|
| 1º | **Firecrawl** | 500 créditos/mes | Primaria: extracción estructurada (markdown) + render JS (`waitFor`) |
| 2º | **Jina Reader** | Gratis (sin consumo de créditos) | Respaldo sin JS; texto plano |
| 3º | **ScrapingBee** | 1.000 créditos/mes | Último respaldo (con o sin JS) |

> Si el proveedor primario falla (status != 200 o excepción), se marca cooldown 30s
> y se salta al siguiente. Configura las keys con `FIRECRAWL_API_KEY_1`,
> `JINA_API_KEY_1`, `TAVILY_API_KEY_1`, `SERPER_API_KEY_1`, `SCRAPINGBEE_API_KEY_1`.
>
> Nota (v2.13d): **Prompt Arquitecto** (`/api/llm/complete`) pasa a OpenRouter con modelo gratuito y ligero como primario: `nvidia/nemotron-3-nano-30b-a3b:free` → `openai/gpt-oss-20b:free` → Command A+ como último recurso. Corregido el parseo del formato nativo Cohere (`message.content`), que antes se descartaba.
>
> Nota (v2.13f): **adjuntos sin R2**. Imágenes y PDF se perciben INLINE: el navegador los convierte a data URL y `/api/chat/perceive` los pasa al modelo VL (`nvidia/nemotron-nano-12b-v2-vl:free`) sin tocar almacenamiento. Límite 8 MB. Audio/video se rechazan con aviso claro (necesitarían R2 para URL pública). El flujo R2 (r2_key/analyze_media) se conserva por si el despliegue configura el bucket en el futuro.
>
> Nota (v2.13g): diagnóstico de reportes "Agente/Arquitecto no responden + toast R2": reproducido en navegador limpio y TODO funciona en producción; la causa es caché del navegador con build anterior (el toast R2 solo existe en el código viejo). Medidas: chip de versión visible en el sidebar (`v2.13g`) y cache busting por query en el script de la app (`/app.js?v=213g`); actualizar el query en cada release.
>
> Nota (v2.13h): raíz probable de "todo falla solo en mi cuenta": sesión expirada a mitad de uso sin manejo de 401 (la app quedaba muda). Añadido: manejo global de 401 (aviso + pantalla de login), mensaje explícito de sesión expirada en `ensureAuth`, y panel de Diagnóstico 🩺 (click en el chip de versión del sidebar) con build/usuario/eventos de red/errores JS y botón de copiar.
