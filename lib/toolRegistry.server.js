// ==============================================================================
// Véritas v2.12 — /lib/toolRegistry.server.js
// ==============================================================================
// Mirror server-side del catálogo de tools. El frontend tiene su propio mirror
// en /lib/toolRegistry.js (ETAPA 4) que se hidrata desde GET /api/tools/registry
// (este archivo es la fuente de verdad que sirve ese endpoint).
//
// Responsabilidades:
//   - Declarar las 62 tools con su schema (args) y allowedRoles.
//   - Validar args en runtime (mini-validator de ~50 líneas, sin libs externas).
//   - Mapear tool_name → ruta del handler en /lib/tools/<name>.js.
//   - Exponer isAllowed(toolName, role) para el dispatcher.
//
// Las tools marcadas native: true pueden invocarse vía function calling nativo
// del modelo cuando el proveedor lo soporta. Las native: false usan el protocolo XML
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
//   requiresOauth   : provider OAuth requerido (github | null).
//   usesKeyRotation : nombre del servicio del rotador que el handler usará
//                     internamente (para telemetría / observabilidad).
// ------------------------------------------------------------------------------
export const TOOL_REGISTRY_SERVER = {
  // --- Tools internas de Véritas ---
  search_repository: {
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

  create_skill: {
    description: "Crea una skill personalizada del usuario y la persiste en D1. Úsala solo cuando el usuario pida explícitamente crear una nueva skill reutilizable.",
    native: false,
    handler: null, // inline en functions/api/[[route]].js para reutilizar D1/userEmail
    args: {
      name: { type: "string", required: true },
      description: { type: "string", required: true },
      promptContent: { type: "string", required: true },
      category: { type: "string", required: false, enum: ["verification", "osint", "analysis", "coding", "writing", "research", "data", "media", "productivity", "education", "business", "communication", "design", "document", "security", "meta"] },
      icon: { type: "string", required: false },
      color: { type: "string", required: false },
      needsExternal: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
    usesKeyRotation: null,
  },

  // --- Percepción multimodal (Stack Nemotron) ---
  analyze_media: {
    description: "Analiza contenido multimedia (imagen, PDF, audio, video) usando los modelos Nano del stack Nemotron. El target puede ser una URL pública o una R2 key. Devuelve una descripción textual estructurada.",
    native: false,
    handler: "./tools/analyze_media.js",
    args: {
      target: { type: "string", required: true },
      modality: { type: "string", required: true, enum: ["image", "pdf", "audio", "video"] },
    },
    // v2.12: percepción transversal — el flujo de attachments de Fast/Coder
    // instruye usar analyze_media; antes solo "agent" podía invocarla.
    allowedRoles: ["agent", "coder", "fast"],
    requiresOauth: null,
    usesKeyRotation: null, // el handler llama a /api/chat/perceive que usa su propia rotación
  },

  // --- Búsqueda web (proveedores múltiples con rotación) ---
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

  // --- Scraping puntual de URL ---
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

  // --- Crawling profundo (Firecrawl) ---
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

  // --- Automatización de navegador con LLM ---
  browser_use_browse: {
    description: "Ejecuta una tarea de navegación autónoma descrita en lenguaje natural vía Browser-use hosted API. Latencia alta (10-60s).",
    native: false,
    handler: "./tools/browser_use_browse.js",
    args: {
      task: { type: "string", required: true },
      url: { type: "string", required: false },
      max_steps: { type: "number", required: false, min: 1, max: 100 },
      wait_for_completion: { type: "boolean", required: false },
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
      wait_for_completion: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
    usesKeyRotation: null, // usa auto-provisioning propio, no keyRotator
  },

  // --- Sesiones de navegador persistente (Steel) ---
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

  // --- Cloud scraping / crawling ---
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

  // --- OSINT: Geographic & Social (Apify) ---
  apify_google_places: {
    description: "Búsqueda OSINT en Google Places/Maps. Extrae listings de negocios locales con dirección, teléfono, web, coords, rating y reviews. Lanza actor Apify y espera resultado (latencia 10-60s).",
    native: false,
    handler: "./tools/apify_google_places.js",
    args: {
      query: { type: "string", required: true },
      max_places: { type: "number", required: false, min: 1, max: 20 },
      country: { type: "string", required: false },
      language: { type: "string", required: false },
      wait_for_completion: { type: "boolean", required: false },
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
      wait_for_completion: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "apify",
  },

  // --- Document & Audio Intelligence ---
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
      wait_for_completion: { type: "boolean", required: false },
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
      wait_for_completion: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
    usesKeyRotation: "assemblyai",
  },

  // --- Lote 1: OSINT de infraestructura ---
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

  // --- Lote 2: Búsqueda web alternativa y lectura ---
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

  // --- Lote 3: Código GitHub y sesiones autenticadas ---
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

  // --- Lote 4: Inteligencia global, NER y DNS ---
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

  // --- Sandbox tools ---
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
        enum: ["maplibre-basic", "maplibre-markers", "three-scene", "chartjs-dashboard", "d3-chart", "tailwind-page", "plotly-3d", "osint-report", "timeline-investigation", "entity-graph", "csv-dashboard", "interactive-quiz", "markdown-doc-viewer", "kanban-local"],
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



  // --- Fuentes públicas estructuradas (recuperación v2.4, fase inicial) ---
  semantic_scholar_search: {
    description: "Busca papers, autores y citas en Semantic Scholar Graph API.", native: false,
    handler: "./tools/semantic_scholar_search.js",
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  openalex_search: {
    description: "Busca literatura académica abierta e instituciones en OpenAlex.", native: false,
    handler: "./tools/openalex_search.js",
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 25 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  crossref_search: {
    description: "Busca metadatos bibliográficos y DOI en Crossref.", native: false,
    handler: "./tools/crossref_search.js",
    args: { query: { type: "string", required: true }, rows: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  wikidata_search: {
    description: "Busca entidades estructuradas, aliases y relaciones en Wikidata.", native: false,
    handler: "./tools/wikidata_search.js",
    args: { query: { type: "string", required: true }, language: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  wikipedia_search: {
    description: "Busca contexto enciclopédico y desambiguación en Wikipedia.", native: false,
    handler: "./tools/wikipedia_search.js",
    args: { query: { type: "string", required: true }, language: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },


  hackernews_search: {
    description: "Busca discusiones y señales técnicas en Hacker News vía Algolia.", native: false, handler: "./tools/hackernews_search.js",
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 50 }, tags: { type: "string", required: false } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  nominatim_search: {
    description: "Geocodifica lugares con Nominatim/OpenStreetMap.", native: false, handler: "./tools/nominatim_search.js",
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 10 }, countrycodes: { type: "string", required: false } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  npm_package_info: {
    description: "Consulta metadatos, licencia y dependencias de un paquete npm.", native: false, handler: "./tools/npm_package_info.js",
    args: { package_name: { type: "string", required: true } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  pypi_package_info: {
    description: "Consulta metadatos, licencia y compatibilidad de un paquete PyPI.", native: false, handler: "./tools/pypi_package_info.js",
    args: { package_name: { type: "string", required: true } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },


  // --- Recuperación v2.4: datos públicos adicionales ---
  open_meteo_weather: { description: "Clima actual y pronóstico con Open-Meteo.", native: false, handler: "./tools/open_meteo_weather.js",
    args: { latitude: { type: "number", required: true }, longitude: { type: "number", required: true }, forecast_days: { type: "number", required: false, min: 1, max: 16 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  crtsh_lookup: { description: "Busca certificados y subdominios públicos en crt.sh.", native: false, handler: "./tools/crtsh_lookup.js",
    args: { domain: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 100 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  rdap_lookup: { description: "Consulta RDAP público para dominios, IPs y ASNs.", native: false, handler: "./tools/rdap_lookup.js",
    args: { query: { type: "string", required: true }, type: { type: "string", required: false, enum: ["domain", "ip", "autnum"] } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  cisa_kev_search: { description: "Busca vulnerabilidades explotadas conocidas en CISA KEV.", native: false, handler: "./tools/cisa_kev_search.js",
    args: { query: { type: "string", required: false }, cve: { type: "string", required: false }, vendor: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  nvd_cve_search: { description: "Busca CVEs y detalles de severidad en NVD.", native: false, handler: "./tools/nvd_cve_search.js",
    args: { cve: { type: "string", required: false }, keyword: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 20 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },


  // --- Recuperación v2.4: servicios y fuentes restantes ---
  geonames_search: { description: "Busca lugares con GeoNames.", native: false, handler: "./tools/geonames_search.js",
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 50 }, country: { type: "string", required: false } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  nasa_search: { description: "Busca contenido público en NASA Image and Video Library.", native: false, handler: "./tools/nasa_search.js",
    args: { query: { type: "string", required: true }, media_type: { type: "string", required: false, enum: ["image", "video", "audio"] }, limit: { type: "number", required: false, min: 1, max: 20 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  sec_edgar_search: { description: "Consulta filings recientes de SEC EDGAR.", native: false, handler: "./tools/sec_edgar_search.js",
    args: { ticker: { type: "string", required: false }, cik: { type: "string", required: false } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: null,
  },
  cohere_infer: { description: "Reservado para inferencia auxiliar Cohere.", native: false, handler: "./tools/cohere_infer.js",
    args: { prompt: { type: "string", required: true } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: "cohere",
  },
  cerebras_infer: { description: "Reservado para inferencia auxiliar Cerebras.", native: false, handler: "./tools/cerebras_infer.js",
    args: { prompt: { type: "string", required: true } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: "cerebras",
  },
  email_report: { description: "Envía un reporte opt-in por Brevo.", native: false, handler: "./tools/email_report.js",
    args: { subject: { type: "string", required: false }, title: { type: "string", required: false }, summary: { type: "string", required: false }, text: { type: "string", required: false }, html: { type: "string", required: false }, consent: { type: "boolean", required: true } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null, usesKeyRotation: "brevo",
  },

  // --- GitHub (OAuth del usuario) ---
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


  // --- v2.7.3: CourtListener / AviationStack / Exa / Scrape.do ---
  courtlistener_search: {
    description: "Jurisprudencia y dockets de EE.UU. en CourtListener (Free Law Project): ~8M de opiniones federales/estatales + RECAP/PACER. Modos: search (opiniones/dockets/argumentos), opinion (texto completo por id), citation (verificación de citas legales).",
    native: false,
    handler: "./tools/courtlistener_search.js",
    args: {
      mode: { type: "string", required: false, enum: ["search", "opinion", "citation"] },
      query: { type: "string", required: false },
      type: { type: "string", required: false, enum: ["o", "r", "p"] },
      id: { type: "string", required: false },
      court: { type: "string", required: false },
      filed_after: { type: "string", required: false },
      filed_before: { type: "string", required: false },
      page_size: { type: "number", required: false, min: 1, max: 50 },
    },
    allowedRoles: ["agent", "pensador", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "courtlistener",
  },
  aviationstack_flights: {
    description: "Datos de aviación en tiempo real (AviationStack): estado de vuelos, aeropuertos y aerolíneas. Modos: flights (por número de vuelo/IATA/aerolínea/ruta), airlines, airports. Plan free: HTTP únicamente, ~100 req/mes.",
    native: false,
    handler: "./tools/aviationstack_flights.js",
    args: {
      mode: { type: "string", required: false, enum: ["flights", "airlines", "airports"] },
      flight_iata: { type: "string", required: false },
      flight_icao: { type: "string", required: false },
      flight_number: { type: "string", required: false },
      airline_name: { type: "string", required: false },
      airline_iata: { type: "string", required: false },
      dep_iata: { type: "string", required: false },
      arr_iata: { type: "string", required: false },
      flight_status: { type: "string", required: false, enum: ["scheduled", "active", "landed", "cancelled", "incident", "diverted"] },
      search: { type: "string", required: false },
      iata: { type: "string", required: false },
      limit: { type: "number", required: false, min: 1, max: 100 },
    },
    allowedRoles: ["agent", "pensador", "estratega"],
    requiresOauth: null,
    usesKeyRotation: "aviationstack",
  },
  exa_search: {
    description: "Búsqueda semántica para IA (Exa.ai): resultados por significado, no solo keywords. Modos: search (búsqueda neural/auto/keyword con highlights), contents (extraer texto de URLs), answer (respuesta directa con citas).",
    native: false,
    handler: "./tools/exa_search.js",
    args: {
      mode: { type: "string", required: false, enum: ["search", "contents", "answer"] },
      query: { type: "string", required: false },
      type: { type: "string", required: false, enum: ["auto", "neural", "keyword"] },
      numResults: { type: "number", required: false, min: 1, max: 30 },
      text: { type: "boolean", required: false },
      urls: { type: "array", required: false },
      startPublishedDate: { type: "string", required: false },
      endPublishedDate: { type: "string", required: false },
      includeDomains: { type: "array", required: false },
    },
    allowedRoles: ["agent", "pensador", "estratega", "coder"],
    requiresOauth: null,
    usesKeyRotation: "exa",
  },
  scrapedo_scrape: {
    description: "Scraping con proxies rotativos y anti-bot (Scrape.do). Modos: scrape (extrae cualquier URL como markdown/raw, con render JS opcional y geoCode), google (SERP de Google estructurada). super_proxy=true usa residenciales (10x créditos).",
    native: false,
    handler: "./tools/scrapedo_scrape.js",
    args: {
      mode: { type: "string", required: false, enum: ["scrape", "google"] },
      url: { type: "string", required: false },
      query: { type: "string", required: false },
      render: { type: "boolean", required: false },
      geoCode: { type: "string", required: false },
      output: { type: "string", required: false, enum: ["raw", "markdown"] },
      super_proxy: { type: "boolean", required: false },
      device: { type: "string", required: false, enum: ["desktop", "mobile", "tablet"] },
    },
    allowedRoles: ["agent", "pensador", "estratega", "coder"],
    requiresOauth: null,
    usesKeyRotation: "scrapedo",
  },
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
// importHandler: devuelve el módulo handler de una tool.
// v2.12f: ANTES usaba `import(new URL(tool.handler, import.meta.url))`, que
// funciona en Node local pero FALLA en el bundle de Cloudflare Workers
// (import.meta.url no es una URL absoluta válida ahí ⇒ "Invalid URL string"),
// dejando las 61 tools rotas en producción. Ahora usa un mapa de imports
// ESTÁTICOS (lib/tools/_handlers.js) que el bundler sí resuelve.
// ------------------------------------------------------------------------------
import { HANDLERS } from "./tools/_handlers.js";

export async function importHandler(toolName) {
  const mod = HANDLERS[toolName];
  if (!mod) throw new Error(`No handler for tool: ${toolName}`);
  if (typeof mod.run !== "function") {
    throw new Error(`Handler ${toolName} does not export async function run(args, ctx)`);
  }
  return mod;
}

// ------------------------------------------------------------------------------
// Helpers XML (server-side). El agente emite llamadas de herramienta en XML
// <tool_call name="...">...</tool_call>; aquí las parseamos y construimos los
// <tool_result> para reinyectar en la conversación. Mirror del parser del
// frontend (lib/toolRegistry.js) pero normalizando contra el registry SERVER.
// ------------------------------------------------------------------------------
export function escapeXML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildToolResultXML(name, status, output) {
  const open = "<tool_" + "result";
  const close = "</tool_" + "result>";
  return `${open} name="${escapeXML(name)}" status="${escapeXML(status)}">\n${escapeXML(output)}\n${close}`;
}

function normalizeToolNameServer(n) {
  const low = (n || "").trim().toLowerCase();
  if (TOOL_REGISTRY_SERVER[low]) return low;
  const flat = low.replace(/[_\-\s]+/g, "");
  for (const key of Object.keys(TOOL_REGISTRY_SERVER)) {
    if (key.replace(/[_\-\s]+/g, "") === flat) return key;
  }
  return low;
}

function tryParseJSONArg(s) {
  if (typeof s !== "string") return s;
  const trimmed = s.trim();
  if (trimmed === "") return s;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try { return JSON.parse(trimmed); } catch { return s; }
  }
  return s;
}

export function parseToolCallXML(text) {
  if (!text || typeof text !== "string") return [];
  const open = "<" + "tool_call";
  const close = "<" + "/tool_call>";
  text = text
    .replace(/<toolcall\b/gi, open)
    .replace(/<\/toolcall\s*>/gi, close)
    .replace(/<functi?on_call\b/gi, open)
    .replace(/<\/(functi?on_call)\s*>/gi, close);
  const calls = [];
  const callRegex = new RegExp(open.replace("<", "\\<") + "\\s+name=[\"']([^\"']+)[\"']\\s*>([\\s\\S]*?)" + close.replace("<", "\\<").replace(">", "\\s*>"), "gi");
  let match;
  while ((match = callRegex.exec(text)) !== null) {
    const name = normalizeToolNameServer(match[1]);
    const inner = match[2];
    const args = {};
    const argRegex = /<arg\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/arg>/gi;
    let argMatch;
    while ((argMatch = argRegex.exec(inner)) !== null) {
      const argName = argMatch[1];
      let argVal = argMatch[2].replace(/^\s+/, "").replace(/\s+$/, "");
      args[argName] = tryParseJSONArg(argVal);
    }
    calls.push({ name, args });
  }
  return calls;
}

export default {
  TOOL_REGISTRY_SERVER,
  isAllowed,
  validateArgs,
  publicRegistry,
  importHandler,
  escapeXML,
  buildToolResultXML,
  parseToolCallXML,
};
