<div align="center">

<img src="https://img.shields.io/badge/version-2.4-0ea5e9?style=for-the-badge" alt="v2.4"/>
<img src="https://img.shields.io/badge/Cloudflare-Pages_+_Workers-f48220?style=for-the-badge&logo=cloudflare" alt="Cloudflare"/>
<img src="https://img.shields.io/badge/D1_+_R2-Storage-8b5cf6?style=for-the-badge" alt="D1+R2"/>
<img src="https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge" alt="MIT"/>

<h1>VERITAS</h1>
<p><strong>Multi-Role OSINT AI Orchestrator</strong></p>
<p>Orquestador de modelos de IA multi-proveedor con 43 tools OSINT integradas,<br/>pipeline de 5 roles y sandbox con live preview.</p>

<p>
  <a href="#características">Features</a> &bull;
  <a href="#arquitectura">Architecture</a> &bull;
  <a href="#tools">Tools</a> &bull;
  <a href="#roles">Roles</a> &bull;
  <a href="#stack">Stack</a> &bull;
  <a href="#setup">Setup</a>
</p>

</div>

---

## Características

- **5 roles de IA** (Agente, Estratega, Razonamiento, Coder, Fast) con modelos dedicados y cadenas de fallback
- **43 tools OSINT** — web search, scraping, crawling, NER, DNS, Shodan, ZoomEye, IntelX, GDELT, transcripción, parseo de docs, GitHub, Dropbox, email
- **API Key Rotator** — rotación automática entre múltiples keys por servicio con cooldown y telemetría
- **Sandbox Live Preview** — ejecución de código HTML/CSS/JS con preview estilo GLM-5.2
- **Cross-chat Memory** — memorias persistentes en D1 compartidas entre sesiones
- **Percepción Multimodal** — análisis de imágenes, audio, video y documentos
- **Protocolo XML embebido** — function calling para modelos que no lo soportan nativamente
- **OAuth** — integración con GitHub y Dropbox
- **Brevo Email** — reenvío de informes y archivos por email
- **i18n** — interfaz en español/inglés
- **Zero cost AI** — modelos gratuitos vía Puter.js + OpenRouter (Nemotron, Gemini, Claude, GPT, Llama, Qwen, DeepSeek)

---

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                    index.html                        │
│              (SPA + Sandbox Preview)                  │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│              functions/api/[[route]].js              │
│           (Cloudflare Worker — entrypoint)            │
│  ┌─────────────────────────────────────────────┐    │
│  │           agentOrchestrator.js               │    │
│  │    Role routing · Fallback chains · LLM call  │    │
│  └──────────────┬──────────────────────────────┘    │
│  ┌──────────────▼──────────────────────────────┐    │
│  │           toolRegistry.server.js             │    │
│  │     43 tools · Schema validation · Roles      │    │
│  └──────────────┬──────────────────────────────┘    │
│  ┌──────────────▼──────────────────────────────┐    │
│  │          lib/tools/*.js (handlers)            │    │
│  │   run(args, ctx) → call lib/services/*.js      │    │
│  └──────────────┬──────────────────────────────┘    │
│  ┌──────────────▼──────────────────────────────┐    │
│  │         lib/services/*.js (adapters)          │    │
│  │      callService() → HTTP → External APIs     │    │
│  └─────────────────────────────────────────────┘    │
│  ┌──────────────────┐ ┌──────────────────────┐      │
│  │  keyRotator.js   │ │   oauth.js            │      │
│  │  14+ services     │ │  GitHub + Dropbox      │      │
│  └──────────────────┘ └──────────────────────┘      │
└─────────────────────────────────────────────────────┘
         │              │              │
    ┌────▼───┐    ┌────▼───┐    ┌─────▼────┐
    │  D1    │    │   R2   │    │ External  │
    │ (SQL)  │    │ (Files)│    │  APIs     │
    └────────┘    └────────┘    └───────────┘
```

---

## Tools (34)

### Búsqueda y Scraping
| Tool | Descripción | Servicio |
|------|-------------|----------|
| `web_search` | Búsqueda web multi-proveedor (Jina / Tavily / Serper) | jina, tavily, serper |
| `scrape_url` | Scraping de URL individual (Jina / ScrapingBee) | jina, scrapingbee |
| `firecrawl_scrape` | Extracción estructurada a Markdown | firecrawl |
| `firecrawl_crawl` | Crawl recursivo multi-página | firecrawl |
| `rover_scrape` | Scraping instantáneo (rtrvr.ai) | rover |
| `spider_cloud_search` | Crawler ultrarrápido + bypass anti-bot | spider_cloud |
| `browserless_execute` | Ejecución en Chromium remoto | browserless |
| `browser_use_browse` | Navegación autónoma NL | browser_use |
| `browser_use_cloud` | Navegador autónomo NL (auto-provisioning) | browser_use_cloud |
| `jina_reader_search` | Lectura URL + búsqueda combinada | jina_reader |
| `gfw_search` | Búsqueda web alternativa GFW | gfw |

### OSINT e Infraestructura
| Tool | Descripción | Servicio |
|------|-------------|----------|
| `shodan_search` | Búsqueda de dispositivos/puertos/CVEs | shodan |
| `zoomeye_search` | Mapeo de superficie de ataque | zoomeye |
| `intelx_search` | Datos filtrados, dark web, leaks | intelx |
| `gdelt_search` | Eventos globales, tendencias, GKG | gdelt |
| `dns_lookup` | Resolución DNS + DNSSEC | dns |
| `ner_extract` | Entidades nombradas (URLs, IPs, emails, crypto) | local |

### Documentos y Media
| Tool | Descripción | Servicio |
|------|-------------|----------|
| `llamaparse_parse` | Parseo PDF/DOCX a Markdown con OCR | llamaparse |
| `assemblyai_transcribe` | Transcripción audio + diarización + sentimiento | assemblyai |
| `analyze_media` | Análisis multimodal (imagen, audio, video) | nemotron |

### Social y Geolocalización
| Tool | Descripción | Servicio |
|------|-------------|----------|
| `apify_google_places` | Listings de negocios en Google Maps | apify |
| `apify_social` | Perfiles/posts en redes sociales | apify |
| `jina_github_search` | Búsqueda de código y repos | jina_github |

### Navegador Persistente
| Tool | Descripción | Servicio |
|------|-------------|----------|
| `steel_session` | Sesiones de navegador Steel.dev | steel |
| `steel_auth_session` | Sesiones autenticadas con proxy/fingerprint | steel_auth |

### Almacenamiento y Archivos
| Tool | Descripción | Servicio |
|------|-------------|----------|
| `read_project_file` | Lee archivo del proyecto en R2 | R2 |
| `write_project_file` | Escribe archivo al proyecto en R2 | R2 |
| `search_repository` | Busca en el repositorio de documentos | D1 |
| `load_template` | Carga plantilla en Sandbox | local |
| `preview_html` | Renderiza HTML en Live Preview | local |
| `fetch_via_proxy` | Llamada HTTP vía proxy del Worker | worker |

### GitHub
| Tool | Descripción | OAuth |
|------|-------------|-------|
| `github_list_repos` | Lista repos del usuario | GitHub |
| `github_read_file` | Lee archivo de repo | GitHub |
| `github_write_file` | Crea/actualiza archivo + commit | GitHub |
| `github_write_files` | Multi-archivo en un commit (Trees API) | GitHub |
| `github_create_branch` | Crea rama | GitHub |
| `github_create_pr` | Crea Pull Request | GitHub |

### Dropbox
| Tool | Descripción | OAuth |
|------|-------------|-------|
| `dropbox_list_folder` | Lista carpeta | Dropbox |
| `dropbox_read_file` | Lee archivo | Dropbox |
| `dropbox_write_file` | Escribe archivo | Dropbox |
| `dropbox_search` | Busca archivos | Dropbox |
| `dropbox_upload_large` | Upload chunked >5MB | Dropbox |

### Comunicaciones
| Tool | Descripción | Servicio |
|------|-------------|----------|
| `send_email` | Envío de emails con HTML/adjuntos vía Brevo | brevo |

---

## Roles

| Rol | Modelo primario | Función | Tools |
|-----|-----------------|---------|-------|
| **Agente** | Nemotron Super 120B | Orquestación general, OSINT | Todas |
| **Estratega** | Claude 3.5 Sonnet | Planificación, análisis profundo | Todas |
| **Razonamiento** | Qwen 3 Coder 32B | Razonamiento lógico, verificación | Todas |
| **Coder** | Claude 3.5 Sonnet | Código, docs, artefactos, web | Subset |
| **Fast** | Gemini 2.5 Flash | Respuestas rápidas, búsqueda | Tavily, Exa, GDELT, Jina |

<details>
<summary>Cadena de fallbacks por rol</summary>

Cada rol tiene una cadena de modelos de respaldo. Si el modelo primario falla (rate limit, timeout, error), el orquestador intenta automáticamente el siguiente en la cadena.

```
Agente:      Super 120B → Ultra 550B → Claude 3.5 → Qwen 3 → Gemini 2.5 → DeepSeek
Estratega:   Claude 3.5 → Super 120B → Qwen 3 → Gemini 2.5 → GPT 4.1
Razonamiento: Qwen 3 → Claude 3.5 → DeepSeek → Super 120B
Coder:       Claude 3.5 → Qwen 3 Coder → Gemini 2.5 → GPT 4.1
Fast:        Gemini 2.5 Flash → Claude 3.5 Haiku → Qwen 3 → Super 120B
```

</details>

---

## Stack

| Componente | Tecnología |
|------------|------------|
| **Frontend** | HTML, CSS, JavaScript vanilla (SPA) |
| **Backend** | Cloudflare Workers (serverless) |
| **Hosting** | Cloudflare Pages |
| **Base de datos** | Cloudflare D1 (SQLite) |
| **Almacenamiento** | Cloudflare R2 (objetos) |
| **IA Models** | Puter.js + OpenRouter (20+ modelos gratuitos) |
| **Email** | Brevo (SMTP API) |
| **Auth** | OAuth 2.0 (GitHub, Dropbox) |

**Dependencias: cero.** Sin build step, sin npm install, sin framework.

---

## Setup

### 1. Clonar

```bash
git clone https://github.com/maxrivero783-pixel/veritas-ai.git
cd veritas-ai
```

### 2. Base de datos

```bash
npx wrangler d1 create veritas-db
```

Copia el `database_id` resultante en `wrangler.toml`.

```bash
npx wrangler d1 execute veritas-db --file=./schema.sql
```

### 3. Variables de entorno

Configura en Cloudflare Dashboard > Workers > Settings > Variables:

**IA Providers (mínimo 1):**

| Variable | Descripción |
|----------|-------------|
| `PUTER_JWT` | JWT de Puter.js (obligatorio) |
| `OPENROUTER_API_KEY_1` | Key de OpenRouter |

**Tool Services (las que necesites):**

| Variable | Tool |
|----------|------|
| `JINA_API_KEY_1` | web_search, scrape_url |
| `TAVILY_API_KEY_1` | web_search |
| `SERPER_API_KEY_1` | web_search |
| `FIRECRAWL_API_KEY_1` | firecrawl_scrape/crawl |
| `SHODAN_API_KEY_1` | shodan_search |
| `ZOOMMEYE_API_KEY_1` | zoomeye_search |
| `INTELX_API_KEY_1` | intelx_search |
| `ASSEMBLYAI_API_KEY_1` | assemblyai_transcribe |
| `LLAMAPARSE_API_KEY_1` | llamaparse_parse |
| `BREVO_API_KEY_1` | send_email |
| `SCRAPINGBEE_API_KEY_1` | scrape_url |
| `ROVER_API_KEY_1` | rover_scrape |
| `SPIDER_CLOUD_API_KEY_1` | spider_cloud_search |
| `BROWSERLESS_API_KEY_1` | browserless_execute |
| `APIFY_API_KEY_1` | apify_google_places, apify_social |

**OAuth (opcional):**

| Variable | Descripción |
|----------|-------------|
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | GitHub |
| `DROPBOX_OAUTH_APP_KEY` / `DROPBOX_OAUTH_APP_SECRET` | Dropbox |

**Email:**

| Variable | Descripción |
|----------|-------------|
| `BREVO_API_KEY_1` | API key de Brevo |
| `BREVO_SENDER_EMAIL` | Email remitente verificado en Brevo |
| `BREVO_SENDER_NAME` | Nombre del remitente |

Soporta rotación: agrega `_2`, `_3`, etc. para múltiples keys por servicio.

> **Compatibilidad Brevo (mismo esquema que los otros workers OSINT):** el adaptador
> acepta `BREVO_API_KEY_1`, o en su defecto `BREVO_API_KEY` / `EMAIL_API_KEY` como
> fallback; el remitente puede venir de `BREVO_SENDER_EMAIL`/`BREVO_SENDER_NAME` o
> `FROM_EMAIL`/`FROM_NAME`. Todos los correos de `send_email` se firman con:
> **- Remitido por Véritas, la IA especializada en OSINT -**

### 4. Deploy

```bash
npx wrangler pages deploy . --project-name=veritas-ai
```

O conecta el repo a Cloudflare Pages para deploy automático.

---

## Estructura del Proyecto

```
veritas-ai/
├── index.html              # SPA principal
├── styles.css              # Estilos
├── app.js                  # Lógica del frontend
├── prompts.js              # Cargador de prompts de rol
├── schema.sql              # Schema D1
├── wrangler.toml           # Configuración Cloudflare
├── _headers                # Headers de seguridad
├── _redirects              # Reglas de redirección
├── functions/
│   ├── api/[[route]].js    # Worker principal
│   └── purge/scheduled.js  # Worker programado
├── lib/
│   ├── agentOrchestrator.js   # Orquestador multi-rol
│   ├── toolRegistry.server.js # Registro de tools (fuente de verdad)
│   ├── toolRegistry.js        # Mirror frontend
│   ├── keyRotator.js          # Rotador de API keys
│   ├── fallbackChains.js      # Cadenas de fallback por rol
│   ├── contextManager.js      # Gestión de contexto
│   ├── oauth.js               # OAuth GitHub/Dropbox
│   ├── i18n.js                # Internacionalización
│   ├── rateLimit.js           # Rate limiting
│   ├── offlineCache.js        # Cache offline
│   ├── notifications.js       # Notificaciones
│   ├── sandboxTemplates.js    # Plantillas del Sandbox
│   ├── sharedSession.js       # Sesión compartida
│   ├── skillsRegistry.js      # Registro de skills
│   ├── services/              # 25 adaptadores HTTP
│   │   ├── jina.js, tavily.js, serper.js, firecrawl.js
│   │   ├── shodan.js, zoomeye.js, intelx.js, gdelt.js
│   │   ├── assemblyai.js, llamaparse.js, ner.js, dns.js
│   │   ├── rover.js, spider_cloud.js, browserless.js
│   │   ├── browser_use.js, browser_use_cloud.js, steel.js, steel_auth.js
│   │   ├── apify.js, scrapingbee.js, gfw.js, brevo.js
│   │   └── oauth/ (github.js, dropbox.js)
│   └── tools/                 # 43 handlers
│       ├── web_search.js, scrape_url.js, firecrawl_scrape.js
│       ├── shodan_search.js, zoomeye_search.js, intelx_search.js
│       ├── gdelt_search.js, dns_lookup.js, ner_extract.js
│       ├── send_email.js, analyze_media.js
│       └── ... (34+ handlers)
├── prompts/                   # 78 system prompts
│   └── veritas_agent_system_prompt.md
└── tools/
    ├── veritas_agent_system_prompt.md
    └── veritas_worker.py
```

---

## Licencia

MIT — Free to use, modify, and distribute.

---

<div align="center">
<p><strong>Véritas AI</strong> — OSINT intelligence, orchestrated.</p>
</div>