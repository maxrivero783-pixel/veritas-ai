// ==============================================================================
// Véritas v2.4 — /lib/toolRegistry.server.js
// ==============================================================================
// Mirror server-side del catálogo de tools. El frontend tiene su propio mirror
// en /lib/toolRegistry.js (ETAPA 4) que se hidrata desde GET /api/tools/registry
// (este archivo es la fuente de verdad que sirve ese endpoint).
//
// Responsabilidades:
//   - Declarar las 43 tools con su schema (args) y allowedRoles.
//   - Validar args en runtime (mini-validator de ~50 líneas, sin libs externas).
//   - Mapear tool_name → ruta del handler en /lib/tools/<name>.js.
//   - Exponer isAllowed(toolName, role) para el dispatcher.
//
// Las tools marcadas native: true se invocan vía function calling nativo del
// modelo (GLM-Flash para web_search). Las native: false usan el protocolo XML
// embebido. El Worker no distingue entre ambas en el dispatcher /api/tool/invoke;
// la distinción la hace el frontend al construir el body de la llamada al modelo.
// ==============================================================================

// ------------------------------------------------------------------------------
// TOOL_REGISTRY_SERVER — fuente de verdad.
// Cada entrada tiene:
//   description     : string legible para el modelo.
//   native          : bool (function calling nativo del modelo vs XML embebido).
//   handler         : ruta relativa del handler en /lib/tools/<name>.js.
//   args            : { argName: { type, required, enum?, items?, max? } }.
//   allowedRoles    : array de roles que pueden invocarla.
//   requiresOauth   : provider OAuth requerido (github | dropbox | null).
//   usesKeyRotation : nombre del servicio del rotador que el handler usará
//                     internamente (para telemetría / observabilidad).
// ------------------------------------------------------------------------------
export const TOOL_REGISTRY_SERVER = {
  // --- Tools internas de Véritas ---  search_repository: {
    description: "Busca documento en el repositorio del usuario por número o nombre.",
    native: false,
    handler: "./tools/search_repository.js",
    args: {
      query: { type: "string", required: true },
    },
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  read_project_file: {
    description: "Lee un archivo de la Carpeta Proyecto del usuario en R2.",
    native: false,
    handler: "./tools/read_project_file.js",
    args: {
      filename: { type: "string", required: true },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  write_project_file: {
    description: "Escribe o sobrescribe un archivo en la Carpeta Proyecto del usuario en R2. Persiste archivos generados por la IA (código, HTML, JSON, etc.) fuera del Sandbox.",
    native: false,
    handler: "./tools/write_project_file.js",
    args: {
      filename: { type: "string", required: true },
      content: { type: "string", required: true },
      overwrite: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  analyze_media: {
    description: "Analiza contenido multimedia (imagen, PDF, audio, video) usando los modelos Nano del stack Nemotron. El target puede ser una URL pública o una R2 key. Devuelve una descripción textual estructurada.",
    native: false,
    handler: "./tools/analyze_media.js",
    args: {
      target: { type: "string", required: true },
      modality: { type: "string", required: true, enum: ["image", "pdf", "audio", "video"] },
    },
    allowedRoles: ["agent"],
    requiresOauth: null,
    usesKeyRotation: null, // el handler llama a /api/chat/perceive que usa su propia rotación
  },
  web_search: {
    description: "Búsqueda web. Proveedores en orden de preferencia: Jina → Tavily → Serper.",
    native: true, // GLM-Flash la invoca nativa; otros roles vía XML embebido.
    handler: "./tools/web_search.js",
    args: {
      query: { type: "string", required: true },
      max_results: { type: "number", required: false, min: 1, max: 20 },
    },
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    requiresOauth: null,
    usesKeyRotation: "tavily", // el handler intenta Jina → Tavily → Serper
  },
  scrape_url: {
    description: "Scraping de una sola URL. Proveedores: Jina r.jina.ai → ScrapingBee.",
    native: false,
    handler: "./tools/scrape_url.js",
    args: {
      url: { type: "string", required: true },
      render_js: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "scrapingbee",
  },
  firecrawl_scrape: {
    description: "Scraping de URL con extracción estructurada vía Firecrawl. Devuelve markdown limpio.",
    native: false,
    handler: "./tools/firecrawl_scrape.js",
    args: {
      url: { type: "string", required: true },
      formats: { type: "array", items: "string", required: false },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "firecrawl",
  },
  firecrawl_crawl: {
    description: "Crawl recursivo de un sitio web completo (hasta N páginas) vía Firecrawl.",
    native: false,
    handler: "./tools/firecrawl_crawl.js",
    args: {
      url: { type: "string", required: true },
      limit: { type: "number", required: false, min: 1, max: 50 },
      max_depth: { type: "number", required: false, min: 1, max: 5 },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "firecrawl",
  },
  browser_use_browse: {
    description: "Ejecuta una tarea de navegación autónoma descrita en lenguaje natural vía Browser-use hosted API. Latencia alta (10-60s).",
    native: false,
    handler: "./tools/browser_use_browse.js",
    args: {
      task: { type: "string", required: true },
      url: { type: "string", required: false },
      max_steps: { type: "number", required: false, min: 1, max: 100 },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "browser_use",
  },
  browser_use_cloud: {
    description: "Agente navegador autónomo NL vía Browser Use Cloud API. Alternativa a browser_use_browse con auto-provisioning de keys. Para tareas complejas multi-tab, logins, SaaS. Latencia 10-300s.",
    native: false,
    handler: "./tools/browser_use_cloud.js",
    args: {
      task: { type: "string", required: true },
      url: { type: "string", required: false },
      max_steps: { type: "number", required: false, min: 1, max: 100 },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
    usesKeyRotation: null, // usa auto-provisioning propio, no keyRotator
  },
  steel_session: {
    description: "Crea/release/scrape sesiones de navegador persistente en Steel.dev.",
    native: false,
    handler: "./tools/steel_session.js",
    args: {
      action: { type: "string", required: true, enum: ["create", "release", "scrape"] },
      session_id: { type: "string", required: false },
      url: { type: "string", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "steel",
  },
  rover_scrape: {
    description: "Scraper cloud MCP-native (rtrvr.ai). Modo scrape: extracción instantánea de URL a Markdown. Modo agent: agente web multi-paso con prompt NL. Ultra-rápido para páginas estáticas.",
    native: false,
    handler: "./tools/rover_scrape.js",
    args: {
      mode: { type: "string", required: false, enum: ["scrape", "agent"] },
      url: { type: "string", required: false },
      prompt: { type: "string", required: false },
      max_steps: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "fast"],
    requiresOauth: null,
    usesKeyRotation: "rover",
  },
  spider_cloud_search: {
    description: "Crawler ultra-rápido Spider Cloud. Modos: search (búsqueda + crawling combinado), crawl (multi-página paralelo), screenshot (captura visual), unblocker (bypass anti-bot Cloudflare).",
    native: false,
    handler: "./tools/spider_cloud_search.js",
    args: {
      mode: { type: "string", required: false, enum: ["search", "crawl", "screenshot", "unblocker"] },
      query: { type: "string", required: false },
      url: { type: "string", required: false },
      limit: { type: "number", required: false, min: 1, max: 20 },
      return_format: { type: "string", required: false, enum: ["markdown", "html", "raw"] },
      domain: { type: "string", required: false },
    },
    allowedRoles: ["agent", "fast", "coder"],
    requiresOauth: null,
    usesKeyRotation: "spider_cloud",
  },
  browserless_execute: {
    description: "Ejecuta código en clúster headless Chromium remoto (Browserless). Modos: evaluate (ejecuta JS en página), screenshot (captura visual), pdf (genera PDF), content (extrae HTML).",
    native: false,
    handler: "./tools/browserless_execute.js",
    args: {
      mode: { type: "string", required: false, enum: ["evaluate", "screenshot", "pdf", "content"] },
      url: { type: "string", required: true },
      code: { type: "string", required: false },
      full_page: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: "browserless",
  },
  apify_google_places: {
    description: "Búsqueda OSINT en Google Places/Maps. Extrae listings de negocios locales con dirección, teléfono, web, coords, rating y reviews. Lanza actor Apify y espera resultado (latencia 10-60s).",
    native: false,
    handler: "./tools/apify_google_places.js",
    args: {
      query: { type: "string", required: true },
      max_places: { type: "number", required: false, min: 1, max: 20 },
      country: { type: "string", required: false },
      language: { type: "string", required: false },
    },
    allowedRoles: ["agent", "estratega", "fast"],
    requiresOauth: null,
    usesKeyRotation: "apify",
  },
  apify_social: {
    description: "Scraping de perfiles/posts públicos en redes sociales. Plataformas: facebook_posts, instagram_profile, instagram_posts, tiktok_profile, twitter_profile, threads_profile. Solo perfiles públicos.",
    native: false,
    handler: "./tools/apify_social.js",
    args: {
      platform: { type: "string", required: true, enum: ["facebook_posts", "instagram_profile", "instagram_posts", "tiktok_profile", "twitter_profile", "threads_profile"] },
      target: { type: "string", required: true },
      results_limit: { type: "number", required: false, min: 1, max: 20 },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "apify",
  },
  llamaparse_parse: {
    description: "Parsea documentos PDF/DOCX complejos a Markdown estructurado. Extrae tablas, OCR, ecuaciones. Acepta URL pública o archivo base64. Tiers: fast, balanced, premium. Flujo async (10-60s).",
    native: false,
    handler: "./tools/llamaparse_parse.js",
    args: {
      source_type: { type: "string", required: false, enum: ["url", "file"] },
      url: { type: "string", required: false },
      file_content: { type: "string", required: false },
      file_name: { type: "string", required: false },
      tier: { type: "string", required: false, enum: ["fast", "balanced", "premium"] },
      language: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "llamaparse",
  },
  assemblyai_transcribe: {
    description: "Transcripción de audio a texto + inteligencia. 99+ idiomas, diarización de speakers, sentimiento, resumen, topics, chapters, PII redaction, entity detection. Opcional: razonamiento LLM sobre el transcript. Flujo async (10-300s).",
    native: false,
    handler: "./tools/assemblyai_transcribe.js",
    args: {
      audio_url: { type: "string", required: true },
      speaker_labels: { type: "boolean", required: false },
      language: { type: "string", required: false },
      speech_model: { type: "string", required: false, enum: ["best", "nano"] },
      sentiment: { type: "boolean", required: false },
      summarization: { type: "boolean", required: false },
      topics: { type: "boolean", required: false },
      auto_chapters: { type: "boolean", required: false },
      pii_redaction: { type: "boolean", required: false },
      entity_detection: { type: "boolean", required: false },
      prompt: { type: "string", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "assemblyai",
  },
  shodan_search: {
    description: "Búsqueda OSINT de infraestructura en Shodan. Modos: search (dispositivos/puertos/servicios), host (detalle de IP), exploits (CVEs asociados). Datos técnicos de redes, banners, vulnerabilidades.",
    native: false,
    handler: "./tools/shodan_search.js",
    args: {
      query: { type: "string", required: true },
      mode: { type: "string", required: true, enum: ["search", "host", "exploits"] },
      ip: { type: "string", required: false },
      page: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "shodan",
  },
  zoomeye_search: {
    description: "Búsqueda OSINT de infraestructura en ZoomEye. Modos: search (web/host search), host (dispositivos), ip (detalle de IP). Ciberseguridad y mapeo de superficie de ataque.",
    native: false,
    handler: "./tools/zoomeye_search.js",
    args: {
      query: { type: "string", required: true },
      mode: { type: "string", required: true, enum: ["search", "host", "ip"] },
      ip: { type: "string", required: false },
      page: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "zoomeye",
  },
  intelx_search: {
    description: "Búsqueda OSINT en Intelligence X (IntelX). Modos: search (busqueda inteligente de datos filtrados), results (resultados por ID), phonebook (phonebook lookup). Datos filtrados, dark web, leaks.",
    native: false,
    handler: "./tools/intelx_search.js",
    args: {
      query: { type: "string", required: true },
      mode: { type: "string", required: true, enum: ["search", "results", "phonebook"] },
      id: { type: "string", required: false },
      maxresults: { type: "number", required: false, min: 1, max: 100 },
      limit: { type: "number", required: false, min: 1, max: 100 },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "intelx",
  },
  jina_reader_search: {
    description: "Lectura de URLs a Markdown limpio y búsqueda web combinada vía Jina Reader (r.jina.ai). Modo reader: extrae contenido con alt text, links, imágenes. Modo search: búsqueda web con resúmenes.",
    native: false,
    handler: "./tools/jina_reader_search.js",
    args: {
      mode: { type: "string", required: true, enum: ["reader", "search"] },
      url: { type: "string", required: false },
      query: { type: "string", required: false },
      count: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "jina_reader",
  },
  gfw_search: {
    description: "Búsqueda web alternativa vía GFW API. Motor de búsqueda general como respaldo/alternativa a Jina/Tavily/Serper. Resultados web con metadatos.",
    native: false,
    handler: "./tools/gfw_search.js",
    args: {
      query: { type: "string", required: true },
      page: { type: "number", required: false, min: 1, max: 10 },
      count: { type: "number", required: false, min: 1, max: 20 },
    },
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    requiresOauth: null,
    usesKeyRotation: "gfw",
  },
  jina_github_search: {
    description: "Búsqueda de código y repositorios GitHub vía Jina. Modos: search (busqueda de código), readme (lectura de README markdown). Útil para encontrar implementaciones, librerías y documentación.",
    native: false,
    handler: "./tools/jina_github_search.js",
    args: {
      query: { type: "string", required: false },
      mode: { type: "string", required: false, enum: ["search", "readme"] },
      owner: { type: "string", required: false },
      repo: { type: "string", required: false },
      per_page: { type: "number", required: false, min: 1, max: 30 },
      page: { type: "number", required: false, min: 1, max: 5 },
      sort: { type: "string", required: false, enum: ["best_match", "indexed", "updated"] },
    },
    allowedRoles: ["agent", "coder", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "jina_github",
  },
  steel_auth_session: {
    description: "Sesiones de navegador autenticadas en Steel.dev con proxy, cookies, fingerprints custom. Modos: create (crea sesión con opciones de anonimato), scrape (scrape con sesión existente). Para sitios con login, geo-spoofing, bypass de fingerprinting.",
    native: false,
    handler: "./tools/steel_auth_session.js",
    args: {
      action: { type: "string", required: true, enum: ["create", "scrape"] },
      session_id: { type: "string", required: false },
      url: { type: "string", required: false },
      proxy: { type: "string", required: false },
      geoLocation: { type: "string", required: false },
      headers: { type: "object", required: false },
      cookies: { type: "array", items: "object", required: false },
      blockAds: { type: "boolean", required: false },
      fingerprint: { type: "object", required: false },
      extract: { type: "object", required: false },
    },
    allowedRoles: ["agent", "pensador", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "steel_auth",
  },
  gdelt_search: {
    description: "Búsqueda en GDELT Project (global events database). Modos: events (eventos globales con actores, temas, ubicaciones), gkg (Global Knowledge Graph: artículos, temas, tono), trends (tendencias temporales). API pública gratuita, sin autenticación.",
    native: false,
    handler: "./tools/gdelt_search.js",
    args: {
      query: { type: "string", required: true },
      mode: { type: "string", required: true, enum: ["events", "gkg", "trends"] },
      maxrecords: { type: "number", required: false, min: 1, max: 250 },
      timespan: { type: "string", required: false },
      format: { type: "string", required: false, enum: ["json", "html", "csv"] },
      sort: { type: "string", required: false, enum: ["DateDesc", "DateAsc", "SizeDesc"] },
    },
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  ner_extract: {
    description: "Extracción de entidades nombradas (NER) de texto. Extrae URLs, emails, teléfonos, IPs (v4/v6), fechas, hashtags, menciones, direcciones crypto, IBANs. Procesamiento local, sin API externa, latencia mínima.",
    native: false,
    handler: "./tools/ner_extract.js",
    args: {
      text: { type: "string", required: true },
      types: { type: "array", items: "string", required: false },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  dns_lookup: {
    description: "Resolución DNS y análisis de dominios vía Google DNS API. Modos: resolve (consulta A/AAAA/MX/NS/TXT/CNAME/SOA/PTR/SRV/CAA), reversedns (IP a hostname), dnssec (validación DNSSEC). API pública gratuita.",
    native: false,
    handler: "./tools/dns_lookup.js",
    args: {
      domain: { type: "string", required: true },
      record_type: { type: "string", required: false, enum: ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "PTR", "SRV", "CAA", "DNSKEY", "DS"] },
      mode: { type: "string", required: false, enum: ["resolve", "reversedns", "dnssec"] },
    },
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  preview_html: {
    description: "Carga HTML en el Live Preview del Sandbox.",
    native: false,
    handler: "./tools/preview_html.js",
    args: {
      html: { type: "string", required: true },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  load_template: {
    description: "Inserta una plantilla pre-armada en el Sandbox con parámetros.",
    native: false,
    handler: "./tools/load_template.js",
    args: {
      name: {
        type: "string", required: true,
        enum: ["maplibre-basic", "maplibre-markers", "three-scene", "chartjs-dashboard", "d3-chart", "tailwind-page", "plotly-3d"],
      },
      params: { type: "object", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  fetch_via_proxy: {
    description: "Llamada HTTP a una API externa desde el iframe del Sandbox vía proxy del Worker. Evita CORS. Si la URL pertenece a un servicio del rotador, el Worker inyecta la API key.",
    native: false,
    handler: "./tools/fetch_via_proxy.js",
    args: {
      url: { type: "string", required: true },
      method: { type: "string", required: false, enum: ["GET", "POST", "PUT", "DELETE"] },
      headers: { type: "object", required: false },
      body: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null, // el handler decide según URL
  },
  github_list_repos: {
    description: "Lista los repositorios del usuario conectado en GitHub.",
    native: false,
    handler: "./tools/github_list_repos.js",
    args: { affiliation: { type: "string", required: false } },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
    usesKeyRotation: null,
  },
  github_read_file: {
    description: "Lee un archivo de un repo GitHub del usuario.",
    native: false,
    handler: "./tools/github_read_file.js",
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      path: { type: "string", required: true },
      branch: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
    usesKeyRotation: null,
  },
  github_write_file: {
    description: "Crea o actualiza un archivo en un repo GitHub del usuario. Crea commit.",
    native: false,
    handler: "./tools/github_write_file.js",
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      path: { type: "string", required: true },
      content: { type: "string", required: true },
      message: { type: "string", required: true },
      branch: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
    usesKeyRotation: null,
  },
  github_write_files: {
    description: "Escribe múltiples archivos en un repo GitHub en un solo commit (Trees API).",
    native: false,
    handler: "./tools/github_write_files.js",
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      branch: { type: "string", required: true },
      files: { type: "array", items: "object", required: true },
      message: { type: "string", required: true },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
    usesKeyRotation: null,
  },
  github_create_branch: {
    description: "Crea una nueva rama en un repo GitHub.",
    native: false,
    handler: "./tools/github_create_branch.js",
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      branch_name: { type: "string", required: true },
      from_branch: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
    usesKeyRotation: null,
  },
  github_create_pr: {
    description: "Crea un Pull Request en un repo GitHub.",
    native: false,
    handler: "./tools/github_create_pr.js",
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      title: { type: "string", required: true },
      body: { type: "string", required: false },
      head: { type: "string", required: true },
      base: { type: "string", required: true },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
    usesKeyRotation: null,
  },
  dropbox_list_folder: {
    description: "Lista el contenido de una carpeta en Dropbox del usuario.",
    native: false,
    handler: "./tools/dropbox_list_folder.js",
    args: { path: { type: "string", required: false } },
    allowedRoles: ["agent", "pensador", "coder"],
    requiresOauth: "dropbox",
    usesKeyRotation: null,
  },
  dropbox_read_file: {
    description: "Lee un archivo de Dropbox del usuario. Extrae texto (PDF, HTML, MD, código).",
    native: false,
    handler: "./tools/dropbox_read_file.js",
    args: { path: { type: "string", required: true } },
    allowedRoles: ["agent", "pensador", "coder"],
    requiresOauth: "dropbox",
    usesKeyRotation: null,
  },
  dropbox_write_file: {
    description: "Crea o sobrescribe un archivo en Dropbox del usuario.",
    native: false,
    handler: "./tools/dropbox_write_file.js",
    args: {
      path: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "dropbox",
    usesKeyRotation: null,
  },
  dropbox_search: {
    description: "Busca archivos en Dropbox del usuario por nombre o contenido.",
    native: false,
    handler: "./tools/dropbox_search.js",
    args: {
      query: { type: "string", required: true },
      path: { type: "string", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: "dropbox",
    usesKeyRotation: null,
  },
  dropbox_upload_large: {
    description: "Sube archivos grandes a Dropbox usando upload sessions (para archivos >5MB). Para archivos menores usa dropbox_write_file.",
    native: false,
    handler: "./tools/dropbox_upload_large.js",
    args: {
      path: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "dropbox",
    usesKeyRotation: null,
  send_email: {
    description: "Envía un email a uno o múltiples destinatarios vía Brevo. Soporta HTML, texto plano, CC, BCC, reply-to y adjuntos (base64 o URL). Para reenviar informes, archivos generados o contenido a terceros.",
    native: false,
    handler: "./tools/send_email.js",
    args: {
      to: { type: "string", required: true },
      subject: { type: "string", required: false },
      html: { type: "string", required: false },
      text: { type: "string", required: false },
      cc: { type: "string", required: false },
      bcc: { type: "string", required: false },
      reply_to: { type: "string", required: false },
      attachments: { type: "array", required: false, items: "object" },
      sender_email: { type: "string", required: false },
      sender_name: { type: "string", required: false },
    },
    allowedRoles: ["agent", "strategist", "coder"],
    requiresOauth: null,
    usesKeyRotation: "BREVO",
  },
  // --- Investigacion academica (publicas, sin API key) ---
  semantic_scholar_search: {
    description: "Busca papers, autores y citas en Semantic Scholar Graph API. API publica gratuita.",
    native: false,
    handler: "./tools/semantic_scholar_search.js",
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  openalex_search: {
    description: "Busca literatura academica abierta e instituciones en OpenAlex.",
    native: false,
    handler: "./tools/openalex_search.js",
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 25 } },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  crossref_search: {
    description: "Busca metadatos bibliograficos y DOI en Crossref.",
    native: false,
    handler: "./tools/crossref_search.js",
    args: { query: { type: "string", required: true }, rows: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  wikipedia_search: {
    description: "Busca contexto enciclopedico en Wikipedia. Multi-idioma.",
    native: false,
    handler: "./tools/wikipedia_search.js",
    args: { query: { type: "string", required: true }, language: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "strategist", "coder", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  wikidata_search: {
    description: "Busca entidades estructuradas, aliases y relaciones en Wikidata.",
    native: false,
    handler: "./tools/wikidata_search.js",
    args: { query: { type: "string", required: true }, language: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  hackernews_search: {
    description: "Busca discusiones tecnicas en Hacker News via Algolia.",
    native: false,
    handler: "./tools/hackernews_search.js",
    args: { query: { type: "string", required: true }, tags: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  nominatim_search: {
    description: "Geocodifica lugares con Nominatim/OpenStreetMap.",
    native: false,
    handler: "./tools/nominatim_search.js",
    args: { query: { type: "string", required: true }, countrycodes: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 10 } },
    allowedRoles: ["agent", "strategist", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  crtsh_lookup: {
    description: "Busca certificados SSL y subdominios en crt.sh (Certificate Transparency).",
    native: false,
    handler: "./tools/crtsh_lookup.js",
    args: { domain: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 100 } },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  rdap_lookup: {
    description: "Consulta RDAP publico para dominios, IPs y ASNs (WHOIS moderno).",
    native: false,
    handler: "./tools/rdap_lookup.js",
    args: { query: { type: "string", required: true }, type: { type: "string", required: false } },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  cisa_kev_search: {
    description: "Busca vulnerabilidades explotadas en CISA KEV catalog.",
    native: false,
    handler: "./tools/cisa_kev_search.js",
    args: { cve: { type: "string", required: false }, query: { type: "string", required: false }, vendor: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  nvd_cve_search: {
    description: "Busca CVEs y severidad en NVD (NIST).",
    native: false,
    handler: "./tools/nvd_cve_search.js",
    args: { cve: { type: "string", required: false }, keyword: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  sec_edgar_search: {
    description: "Consulta filings SEC EDGAR por ticker o CIK.",
    native: false,
    handler: "./tools/sec_edgar_search.js",
    args: { ticker: { type: "string", required: false }, cik: { type: "string", required: false } },
    allowedRoles: ["agent", "strategist", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  geonames_search: {
    description: "Busca lugares con GeoNames. Requiere GEONAMES_USERNAME.",
    native: false,
    handler: "./tools/geonames_search.js",
    args: { query: { type: "string", required: true }, country: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  nasa_search: {
    description: "Busca contenido en NASA Image and Video Library.",
    native: false,
    handler: "./tools/nasa_search.js",
    args: { query: { type: "string", required: true }, media_type: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  open_meteo_weather: {
    description: "Clima actual y pronostico con Open-Meteo. Requiere lat/lon.",
    native: false,
    handler: "./tools/open_meteo_weather.js",
    args: { latitude: { type: "number", required: true }, longitude: { type: "number", required: true }, forecast_days: { type: "number", required: false, min: 1, max: 16 } },
    allowedRoles: ["agent", "strategist", "coder", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  npm_package_info: {
    description: "Metadatos, licencia y dependencias de un paquete npm.",
    native: false,
    handler: "./tools/npm_package_info.js",
    args: { package_name: { type: "string", required: true } },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  pypi_package_info: {
    description: "Metadatos, licencia y compatibilidad de un paquete PyPI.",
    native: false,
    handler: "./tools/pypi_package_info.js",
    args: { package_name: { type: "string", required: true } },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  semantic_scholar_search: {
    description: "Busca papers, autores y citas en Semantic Scholar Graph API.",
    native: false,
    handler: "./tools/semantic_scholar_search.js",
    args: {
      query: {"type": "string", "required": true},
      limit: {"type": "number", "required": false, "min": 1, "max": 20},
    },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  openalex_search: {
    description: "Busca literatura academica abierta e instituciones en OpenAlex API.",
    native: false,
    handler: "./tools/openalex_search.js",
    args: {
      query: {"type": "string", "required": true},
      limit: {"type": "number", "required": false, "min": 1, "max": 25},
      type: {"type": "string", "required": false, "enum": ["works", "authors", "institutions", "sources", "topics"]},
    },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  crossref_search: {
    description: "Busca metadatos bibliograficos y DOI en Crossref.",
    native: false,
    handler: "./tools/crossref_search.js",
    args: {
      query: {"type": "string", "required": true},
      rows: {"type": "number", "required": false, "min": 1, "max": 20},
    },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  wikipedia_search: {
    description: "Busca contexto enciclopedico y desambiguacion en Wikipedia REST API.",
    native: false,
    handler: "./tools/wikipedia_search.js",
    args: {
      query: {"type": "string", "required": true},
      language: {"type": "string", "required": false},
      limit: {"type": "number", "required": false, "min": 1, "max": 5},
    },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  wikidata_search: {
    description: "Busca entidades estructuradas, aliases y relaciones en Wikidata.",
    native: false,
    handler: "./tools/wikidata_search.js",
    args: {
      query: {"type": "string", "required": true},
      language: {"type": "string", "required": false},
      limit: {"type": "number", "required": false, "min": 1, "max": 20},
    },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  hackernews_search: {
    description: "Busca discusiones y senales tecnicas en Hacker News via Algolia API.",
    native: false,
    handler: "./tools/hackernews_search.js",
    args: {
      query: {"type": "string", "required": true},
      limit: {"type": "number", "required": false, "min": 1, "max": 20},
      tags: {"type": "string", "required": false, "enum": ["story", "comment", "poll", "ask_hn", "show_hn"]},
    },
    allowedRoles: ["agent", "strategist", "fast"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  nominatim_search: {
    description: "Geocodifica lugares con Nominatim/OpenStreetMap.",
    native: false,
    handler: "./tools/nominatim_search.js",
    args: {
      query: {"type": "string", "required": true},
      limit: {"type": "number", "required": false, "min": 1, "max": 10},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  npm_package_info: {
    description: "Consulta metadatos, licencia y dependencias de un paquete npm.",
    native: false,
    handler: "./tools/npm_package_info.js",
    args: {
      name: {"type": "string", "required": true},
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  pypi_package_info: {
    description: "Consulta metadatos, licencia y compatibilidad de un paquete PyPI.",
    native: false,
    handler: "./tools/pypi_package_info.js",
    args: {
      name: {"type": "string", "required": true},
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  crtsh_lookup: {
    description: "Busca certificados y subdominios publicos en crt.sh (certificate transparency).",
    native: false,
    handler: "./tools/crtsh_lookup.js",
    args: {
      query: {"type": "string", "required": true},
      limit: {"type": "number", "required": false, "min": 1, "max": 500},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  open_meteo_weather: {
    description: "Clima actual y pronostico con Open-Meteo. Requiere lat/lon.",
    native: false,
    handler: "./tools/open_meteo_weather.js",
    args: {
      latitude: {"type": "number", "required": true},
      longitude: {"type": "number", "required": true},
      forecast_days: {"type": "number", "required": false, "min": 1, "max": 16},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  cisa_kev_search: {
    description: "Busca vulnerabilidades explotadas conocidas en CISA KEV. Cache 1h.",
    native: false,
    handler: "./tools/cisa_kev_search.js",
    args: {
      query: {"type": "string", "required": false},
      cve: {"type": "string", "required": false},
      vendor: {"type": "string", "required": false},
      limit: {"type": "number", "required": false, "min": 1, "max": 50},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  nvd_cve_search: {
    description: "Busca CVEs y detalles de severidad en NVD. Opcional: NVD_API_KEY_1.",
    native: false,
    handler: "./tools/nvd_cve_search.js",
    args: {
      cve: {"type": "string", "required": false},
      keyword: {"type": "string", "required": false},
      limit: {"type": "number", "required": false, "min": 1, "max": 20},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  sec_edgar_search: {
    description: "Consulta filings recientes de SEC EDGAR para empresas publicas US.",
    native: false,
    handler: "./tools/sec_edgar_search.js",
    args: {
      ticker: {"type": "string", "required": false},
      cik: {"type": "string", "required": false},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  geonames_search: {
    description: "Busca lugares con GeoNames. Requiere GEONAMES_USERNAME.",
    native: false,
    handler: "./tools/geonames_search.js",
    args: {
      query: {"type": "string", "required": true},
      country: {"type": "string", "required": false},
      limit: {"type": "number", "required": false, "min": 1, "max": 50},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  nasa_search: {
    description: "Busca contenido publico en NASA Image and Video Library.",
    native: false,
    handler: "./tools/nasa_search.js",
    args: {
      query: {"type": "string", "required": true},
      media_type: {"type": "string", "required": false, "enum": ["image", "audio"]},
      limit: {"type": "number", "required": false, "min": 1, "max": 20},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
  rdap_lookup: {
    description: "Consulta RDAP publico para dominios, IPs y ASNs (WHOIS moderno).",
    native: false,
    handler: "./tools/rdap_lookup.js",
    args: {
      query: {"type": "string", "required": true},
      type: {"type": "string", "required": false, "enum": ["domain", "ip", "autnum"]},
    },
    allowedRoles: ["agent", "strategist"],
    requiresOauth: null,
    usesKeyRotation: null,
  },
};
};

// ------------------------------------------------------------------------------
// isAllowed: verifica si un rol puede invocar una tool.
// ------------------------------------------------------------------------------
export function isAllowed(toolName, role) {
  const tool = TOOL_REGISTRY_SERVER[toolName];
  if (!tool) return false;
  if (!role) return true; // si el caller no especifica rol, permitir (el router valida aparte)
  return tool.allowedRoles.includes(role);
}

// ------------------------------------------------------------------------------
// validateArgs: mini-validator de args contra el schema.
// Devuelve { ok: true } o { ok: false, error: string }.
// ------------------------------------------------------------------------------
export function validateArgs(toolName, args) {
  const tool = TOOL_REGISTRY_SERVER[toolName];
  if (!tool) return { ok: false, error: `Unknown tool: ${toolName}` };

  args = args || {};
  for (const [argName, schema] of Object.entries(tool.args)) {
    const value = args[argName];

    if (value === undefined || value === null) {
      if (schema.required) return { ok: false, error: `Missing required arg: ${argName}` };
      continue;
    }

    // Validación de tipo
    const t = schema.type;
    if (t === "string" && typeof value !== "string") {
      return { ok: false, error: `Arg ${argName} must be string, got ${typeof value}` };
    }
    if (t === "number" && typeof value !== "number") {
      // Aceptar strings numéricos y coercer.
      if (typeof value === "string" && !Number.isNaN(Number(value))) {
        args[argName] = Number(value);
      } else {
        return { ok: false, error: `Arg ${argName} must be number, got ${typeof value}` };
      }
    }
    if (t === "boolean" && typeof value !== "boolean") {
      if (value === "true") args[argName] = true;
      else if (value === "false") args[argName] = false;
      else return { ok: false, error: `Arg ${argName} must be boolean, got ${typeof value}` };
    }
    if (t === "array" && !Array.isArray(value)) {
      return { ok: false, error: `Arg ${argName} must be array, got ${typeof value}` };
    }
    if (t === "object" && (typeof value !== "object" || Array.isArray(value))) {
      return { ok: false, error: `Arg ${argName} must be object, got ${typeof value}` };
    }

    // Enum
    if (schema.enum && !schema.enum.includes(args[argName])) {
      return { ok: false, error: `Arg ${argName} must be one of: ${schema.enum.join(", ")}` };
    }

    // Min/max para numbers
    if (t === "number") {
      if (schema.min !== undefined && args[argName] < schema.min) {
        return { ok: false, error: `Arg ${argName} must be >= ${schema.min}` };
      }
      if (schema.max !== undefined && args[argName] > schema.max) {
        return { ok: false, error: `Arg ${argName} must be <= ${schema.max}` };
      }
    }

    // Items type para arrays
    if (t === "array" && schema.items) {
      for (const item of value) {
        if (schema.items === "object") {
          if (typeof item !== "object" || Array.isArray(item)) {
            return { ok: false, error: `Items of ${argName} must be objects` };
          }
        } else if (typeof item !== schema.items) {
          return { ok: false, error: `Items of ${argName} must be ${schema.items}` };
        }
      }
    }
  }

  return { ok: true, args };
}

// ------------------------------------------------------------------------------
// publicRegistry: versión segura para enviar al frontend (GET /api/tools/registry).
// Omite el path del handler y el servicio de rotación (internos).
// ------------------------------------------------------------------------------
export function publicRegistry() {
  const out = {};
  for (const [name, tool] of Object.entries(TOOL_REGISTRY_SERVER)) {
    out[name] = {
      description: tool.description,
      native: tool.native,
      args: tool.args,
      allowedRoles: tool.allowedRoles,
      requiresOauth: tool.requiresOauth,
    };
  }
  return out;
}

// ------------------------------------------------------------------------------
// importHandler: carga dinámica del handler. Recibe el módulo URL absoluta
// desde la raíz del Worker. Usado por el dispatcher en el router.
// ------------------------------------------------------------------------------
const _handlerCache = new Map();

export async function importHandler(toolName) {
  if (_handlerCache.has(toolName)) return _handlerCache.get(toolName);
  const tool = TOOL_REGISTRY_SERVER[toolName];
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  // El path es relativo a este archivo (/lib/toolRegistry.server.js).
  // Resolvemos a absoluta dentro del bundle del Worker.
  const url = new URL(tool.handler, import.meta.url);
  const mod = await import(url);
  if (typeof mod.run !== "function") {
    throw new Error(`Handler ${toolName} does not export async function run(args, ctx)`);
  }
  _handlerCache.set(toolName, mod);
  return mod;
}

export default {
  TOOL_REGISTRY_SERVER,
  isAllowed,
  validateArgs,
  publicRegistry,
  importHandler,
};
