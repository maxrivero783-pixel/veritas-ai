// ==============================================================================
// Véritas v2.12 — /lib/toolRegistry.js (frontend)
// ==============================================================================
// Mirror frontend del catálogo de tools. Compatible con /lib/toolRegistry.server.js
// (ETAPA 2). Se hidrata desde GET /api/tools/registry al iniciar la app.
//
// El frontend usa este catálogo para:
//   - Validar que los <tool_call> emitidos por el modelo existen.
//   - Comprobar allowedRoles antes de invocar /api/tool/invoke.
//   - Mostrar descripciones humanas en la UI.
//   - Parsear el protocolo XML embebido.
// ==============================================================================

// ------------------------------------------------------------------------------
// Catálogo seed (se hidrata desde el server al iniciar). Tiene la misma forma
// que publicRegistry() de toolRegistry.server.js.
// ------------------------------------------------------------------------------
export const TOOL_REGISTRY = {
  // --- Tools internas ---
  search_repository: {
    description: "Busca documento en el repositorio del usuario por número o nombre.",
    native: false,
    args: { query: { type: "string", required: true } },
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    requiresOauth: null,
  },
  read_project_file: {
    description: "Lee un archivo de la Carpeta Proyecto del usuario en R2.",
    native: false,
    args: { filename: { type: "string", required: true } },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
  },
  write_project_file: {
    description: "Escribe o sobrescribe un archivo en la Carpeta Proyecto del usuario en R2. Persiste archivos generados por la IA fuera del Sandbox.",
    native: false,
    args: {
      filename: { type: "string", required: true },
      content: { type: "string", required: true },
      overwrite: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
  },

  create_skill: {
    description: "Crea una skill personalizada del usuario y la persiste en D1. Úsala solo cuando el usuario pida explícitamente crear una nueva skill reutilizable.",
    native: false,
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
  },

  // --- Percepción multimodal (Stack Nemotron) ---
  analyze_media: {
    description: "Analiza contenido multimedia (imagen, PDF, audio, video) usando los modelos Nano del stack Nemotron. El target puede ser una URL pública o una R2 key. Devuelve una descripción textual estructurada.",
    native: false,
    args: {
      target: { type: "string", required: true },
      modality: { type: "string", required: true, enum: ["image", "pdf", "audio", "video"] },
    },
    allowedRoles: ["agent", "coder", "fast"],
    requiresOauth: null,
  },

  // --- Búsqueda web ---
  web_search: {
    description: "Búsqueda web. Proveedores: Jina → Tavily → Serper.",
    native: true, // GLM-Flash la invoca nativa; otros vía XML embebido.
    args: {
      query: { type: "string", required: true },
      max_results: { type: "number", required: false, min: 1, max: 20 },
    },
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    requiresOauth: null,
  },

  // --- Scraping ---
  scrape_url: {
    description: "Scraping de URL. Jina r.jina.ai → ScrapingBee.",
    native: false,
    args: {
      url: { type: "string", required: true },
      render_js: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
  },
  firecrawl_scrape: {
    description: "Scraping estructurado vía Firecrawl. Devuelve markdown limpio.",
    native: false,
    args: {
      url: { type: "string", required: true },
      formats: { type: "array", items: "string", required: false },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
  },
  firecrawl_crawl: {
    description: "Crawl recursivo de un sitio (hasta N páginas) vía Firecrawl.",
    native: false,
    args: {
      url: { type: "string", required: true },
      limit: { type: "number", required: false, min: 1, max: 50 },
      max_depth: { type: "number", required: false, min: 1, max: 5 },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
  },
  browser_use_browse: {
    description: "Navegación autónoma vía Browser-use hosted. Latencia alta (10-60s).",
    native: false,
    args: {
      task: { type: "string", required: true },
      url: { type: "string", required: false },
      max_steps: { type: "number", required: false, min: 1, max: 100 },
      wait_for_completion: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
  },
  browser_use_cloud: {
    description: "Agente navegador autónomo NL vía Browser Use Cloud. Alternativa con auto-provisioning de keys. Latencia 10-300s.",
    native: false,
    args: {
      task: { type: "string", required: true },
      url: { type: "string", required: false },
      max_steps: { type: "number", required: false, min: 1, max: 100 },
      wait_for_completion: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
  },
  steel_session: {
    description: "Sesiones de navegador persistente en Steel.dev.",
    native: false,
    args: {
      action: { type: "string", required: true, enum: ["create", "release", "scrape"] },
      session_id: { type: "string", required: false },
      url: { type: "string", required: false },
    },
    allowedRoles: ["agent", "pensador"],
    requiresOauth: null,
  },
  rover_scrape: {
    description: "Scraper cloud MCP-native (rtrvr.ai). Modo scrape: extracción instantánea de URL a Markdown. Modo agent: agente web multi-paso con prompt NL.",
    native: false,
    args: {
      mode: { type: "string", required: false, enum: ["scrape", "agent"] },
      url: { type: "string", required: false },
      prompt: { type: "string", required: false },
      max_steps: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "fast"],
    requiresOauth: null,
  },
  spider_cloud_search: {
    description: "Crawler ultra-rápido Spider Cloud. Modos: search, crawl, screenshot, unblocker.",
    native: false,
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
  },
  browserless_execute: {
    description: "Ejecuta código en clúster headless Chromium remoto (Browserless). Modos: evaluate, screenshot, pdf, content.",
    native: false,
    args: {
      mode: { type: "string", required: false, enum: ["evaluate", "screenshot", "pdf", "content"] },
      url: { type: "string", required: true },
      code: { type: "string", required: false },
      full_page: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
  },
  apify_google_places: {
    description: "Búsqueda OSINT en Google Places/Maps. Extrae listings de negocios locales con dirección, teléfono, web, coords, rating y reviews.",
    native: false,
    args: {
      query: { type: "string", required: true },
      max_places: { type: "number", required: false, min: 1, max: 20 },
      country: { type: "string", required: false },
      language: { type: "string", required: false },
      wait_for_completion: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "estratega", "fast"],
    requiresOauth: null,
  },
  apify_social: {
    description: "Scraping de perfiles/posts públicos en redes sociales (Facebook, Instagram, TikTok, Twitter, Threads).",
    native: false,
    args: {
      platform: { type: "string", required: true, enum: ["facebook_posts", "instagram_profile", "instagram_posts", "tiktok_profile", "twitter_profile", "threads_profile"] },
      target: { type: "string", required: true },
      results_limit: { type: "number", required: false, min: 1, max: 20 },
      wait_for_completion: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
  },
  llamaparse_parse: {
    description: "Parsea documentos PDF/DOCX complejos a Markdown estructurado. Acepta URL pública o archivo base64. Tiers: fast, balanced, premium.",
    native: false,
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
  },
  assemblyai_transcribe: {
    description: "Transcripción de audio + inteligencia. 99+ idiomas, diarización, sentimiento, resumen, topics, chapters, PII, LLM gateway.",
    native: false,
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
  },

  // --- Lote 1: OSINT de infraestructura ---
  shodan_search: {
    description: "Búsqueda OSINT de infraestructura en Shodan. Modos: search, host, exploits. Datos técnicos, banners, vulnerabilidades.",
    native: false,
    args: {
      query: { type: "string", required: true },
      mode: { type: "string", required: true, enum: ["search", "host", "exploits"] },
      ip: { type: "string", required: false },
      page: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
  },
  zoomeye_search: {
    description: "Búsqueda OSINT de infraestructura en ZoomEye. Modos: search, host, ip.",
    native: false,
    args: {
      query: { type: "string", required: true },
      mode: { type: "string", required: true, enum: ["search", "host", "ip"] },
      ip: { type: "string", required: false },
      page: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
  },
  intelx_search: {
    description: "Búsqueda OSINT en Intelligence X. Modos: search, results, phonebook. Datos filtrados, dark web, leaks.",
    native: false,
    args: {
      query: { type: "string", required: true },
      mode: { type: "string", required: true, enum: ["search", "results", "phonebook"] },
      id: { type: "string", required: false },
      maxresults: { type: "number", required: false, min: 1, max: 100 },
      limit: { type: "number", required: false, min: 1, max: 100 },
    },
    allowedRoles: ["agent", "estratega"],
    requiresOauth: null,
  },

  // --- Lote 2: Búsqueda web alternativa y lectura ---
  jina_reader_search: {
    description: "Lectura de URLs a Markdown y búsqueda web vía Jina Reader (r.jina.ai). Modos: reader, search.",
    native: false,
    args: {
      mode: { type: "string", required: true, enum: ["reader", "search"] },
      url: { type: "string", required: false },
      query: { type: "string", required: false },
      count: { type: "number", required: false, min: 1, max: 10 },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
  },
  gfw_search: {
    description: "Búsqueda web alternativa vía GFW API. Motor de búsqueda general.",
    native: false,
    args: {
      query: { type: "string", required: true },
      page: { type: "number", required: false, min: 1, max: 10 },
      count: { type: "number", required: false, min: 1, max: 20 },
    },
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    requiresOauth: null,
  },

  // --- Lote 3: Código GitHub y sesiones autenticadas ---
  jina_github_search: {
    description: "Búsqueda de código y READMEs en GitHub vía Jina. Modos: search, readme.",
    native: false,
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
  },
  steel_auth_session: {
    description: "Sesiones de navegador autenticadas en Steel.dev con proxy, cookies, fingerprints.",
    native: false,
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
  },

  // --- Lote 4: Inteligencia global, NER y DNS ---
  gdelt_search: {
    description: "Búsqueda en GDELT Project. Modos: events, gkg, trends. API pública gratuita.",
    native: false,
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
  },
  ner_extract: {
    description: "Extracción de entidades nombradas (NER) de texto. URLs, emails, IPs, fechas, crypto. Local, sin API.",
    native: false,
    args: {
      text: { type: "string", required: true },
      types: { type: "array", items: "string", required: false },
    },
    allowedRoles: ["agent", "estratega", "pensador"],
    requiresOauth: null,
  },
  dns_lookup: {
    description: "Resolución DNS y análisis de dominios vía Google DNS. Modos: resolve, reversedns, dnssec.",
    native: false,
    args: {
      domain: { type: "string", required: true },
      record_type: { type: "string", required: false, enum: ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "PTR", "SRV", "CAA", "DNSKEY", "DS"] },
      mode: { type: "string", required: false, enum: ["resolve", "reversedns", "dnssec"] },
    },
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    requiresOauth: null,
  },

  // --- Sandbox ---
  preview_html: {
    description: "Carga HTML en el Live Preview del Sandbox.",
    native: false,
    args: { html: { type: "string", required: true } },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
  },
  load_template: {
    description: "Inserta plantilla pre-armada. Plantillas: maplibre-basic, maplibre-markers, three-scene, chartjs-dashboard, d3-chart, tailwind-page, plotly-3d.",
    native: false,
    args: {
      name: { type: "string", required: true, enum: ["maplibre-basic", "maplibre-markers", "three-scene", "chartjs-dashboard", "d3-chart", "tailwind-page", "plotly-3d"] },
      params: { type: "object", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
  },
  fetch_via_proxy: {
    description: "HTTP a API externa vía proxy del Worker. Evita CORS. Inyecta API key si la URL pertenece a un servicio del rotador.",
    native: false,
    args: {
      url: { type: "string", required: true },
      method: { type: "string", required: false, enum: ["GET", "POST", "PUT", "DELETE"] },
      headers: { type: "object", required: false },
      body: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: null,
  },



  // --- Fuentes públicas estructuradas (recuperación v2.4, fase inicial) ---
  semantic_scholar_search: {
    description: "Busca papers, autores y citas en Semantic Scholar Graph API.", native: false,
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  openalex_search: {
    description: "Busca literatura académica abierta e instituciones en OpenAlex.", native: false,
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 25 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  crossref_search: {
    description: "Busca metadatos bibliográficos y DOI en Crossref.", native: false,
    args: { query: { type: "string", required: true }, rows: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  wikidata_search: {
    description: "Busca entidades estructuradas, aliases y relaciones en Wikidata.", native: false,
    args: { query: { type: "string", required: true }, language: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  wikipedia_search: {
    description: "Busca contexto enciclopédico y desambiguación en Wikipedia.", native: false,
    args: { query: { type: "string", required: true }, language: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 20 } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },


  hackernews_search: {
    description: "Busca discusiones y señales técnicas en Hacker News vía Algolia.", native: false,
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 50 }, tags: { type: "string", required: false } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  nominatim_search: {
    description: "Geocodifica lugares con Nominatim/OpenStreetMap.", native: false,
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 10 }, countrycodes: { type: "string", required: false } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  npm_package_info: {
    description: "Consulta metadatos, licencia y dependencias de un paquete npm.", native: false,
    args: { package_name: { type: "string", required: true } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  pypi_package_info: {
    description: "Consulta metadatos, licencia y compatibilidad de un paquete PyPI.", native: false,
    args: { package_name: { type: "string", required: true } },
    allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },


  // --- Recuperación v2.4: datos públicos adicionales ---
  open_meteo_weather: { description: "Clima actual y pronóstico con Open-Meteo.", native: false,
    args: { latitude: { type: "number", required: true }, longitude: { type: "number", required: true }, forecast_days: { type: "number", required: false, min: 1, max: 16 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  crtsh_lookup: { description: "Busca certificados y subdominios públicos en crt.sh.", native: false,
    args: { domain: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 100 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  rdap_lookup: { description: "Consulta RDAP público para dominios, IPs y ASNs.", native: false,
    args: { query: { type: "string", required: true }, type: { type: "string", required: false, enum: ["domain", "ip", "autnum"] } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  cisa_kev_search: { description: "Busca vulnerabilidades explotadas conocidas en CISA KEV.", native: false,
    args: { query: { type: "string", required: false }, cve: { type: "string", required: false }, vendor: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 50 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  nvd_cve_search: { description: "Busca CVEs y detalles de severidad en NVD.", native: false,
    args: { cve: { type: "string", required: false }, keyword: { type: "string", required: false }, limit: { type: "number", required: false, min: 1, max: 20 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },


  // --- Recuperación v2.4: servicios y fuentes restantes ---
  geonames_search: { description: "Busca lugares con GeoNames.", native: false,
    args: { query: { type: "string", required: true }, limit: { type: "number", required: false, min: 1, max: 50 }, country: { type: "string", required: false } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  nasa_search: { description: "Busca contenido público en NASA Image and Video Library.", native: false,
    args: { query: { type: "string", required: true }, media_type: { type: "string", required: false, enum: ["image", "video", "audio"] }, limit: { type: "number", required: false, min: 1, max: 20 } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  sec_edgar_search: { description: "Consulta filings recientes de SEC EDGAR.", native: false,
    args: { ticker: { type: "string", required: false }, cik: { type: "string", required: false } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  cohere_infer: { description: "Reservado para inferencia auxiliar Cohere.", native: false,
    args: { prompt: { type: "string", required: true } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },
  email_report: { description: "Envía un reporte opt-in por Brevo.", native: false,
    args: { subject: { type: "string", required: false }, title: { type: "string", required: false }, summary: { type: "string", required: false }, text: { type: "string", required: false }, html: { type: "string", required: false }, consent: { type: "boolean", required: true } }, allowedRoles: ["agent", "estratega", "fast"], requiresOauth: null,
  },

  // --- GitHub ---
  github_list_repos: {
    description: "Lista los repositorios del usuario conectado en GitHub.",
    native: false,
    args: { affiliation: { type: "string", required: false } },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
  },
  github_read_file: {
    description: "Lee un archivo de un repo GitHub del usuario.",
    native: false,
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      path: { type: "string", required: true },
      branch: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
  },
  github_write_file: {
    description: "Crea o actualiza un archivo en un repo GitHub. Crea commit.",
    native: false,
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
  },
  github_write_files: {
    description: "Escribe múltiples archivos en un repo GitHub en un solo commit (Trees API).",
    native: false,
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      branch: { type: "string", required: true },
      files: { type: "array", items: "object", required: true },
      message: { type: "string", required: true },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
  },
  github_create_branch: {
    description: "Crea una nueva rama en un repo GitHub.",
    native: false,
    args: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      branch_name: { type: "string", required: true },
      from_branch: { type: "string", required: false },
    },
    allowedRoles: ["agent", "coder"],
    requiresOauth: "github",
  },
  github_create_pr: {
    description: "Crea un Pull Request en un repo GitHub.",
    native: false,
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
  },


  // --- v2.7.3: CourtListener / AviationStack / Exa / Scrape.do ---
  courtlistener_search: {
    description: "Jurisprudencia y dockets de EE.UU. (CourtListener): opiniones, RECAP/PACER y verificación de citas.",
    native: false,
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
  },
  aviationstack_flights: {
    description: "Vuelos en tiempo real, aeropuertos y aerolíneas (AviationStack).",
    native: false,
    args: {
      mode: { type: "string", required: false, enum: ["flights", "airlines", "airports"] },
      flight_iata: { type: "string", required: false },
      flight_number: { type: "string", required: false },
      airline_name: { type: "string", required: false },
      dep_iata: { type: "string", required: false },
      arr_iata: { type: "string", required: false },
      flight_status: { type: "string", required: false },
      search: { type: "string", required: false },
      iata: { type: "string", required: false },
      limit: { type: "number", required: false, min: 1, max: 100 },
    },
    allowedRoles: ["agent", "pensador", "estratega"],
    requiresOauth: null,
  },
  exa_search: {
    description: "Búsqueda semántica para IA (Exa.ai): search neural, extracción de contenido y respuestas con citas.",
    native: false,
    args: {
      mode: { type: "string", required: false, enum: ["search", "contents", "answer"] },
      query: { type: "string", required: false },
      type: { type: "string", required: false, enum: ["auto", "neural", "keyword"] },
      numResults: { type: "number", required: false, min: 1, max: 30 },
      text: { type: "boolean", required: false },
      urls: { type: "array", required: false },
    },
    allowedRoles: ["agent", "pensador", "estratega", "coder"],
    requiresOauth: null,
  },
  scrapedo_scrape: {
    description: "Scraping anti-bot con proxies rotativos (Scrape.do): cualquier URL a markdown o SERP de Google.",
    native: false,
    args: {
      mode: { type: "string", required: false, enum: ["scrape", "google"] },
      url: { type: "string", required: false },
      query: { type: "string", required: false },
      render: { type: "boolean", required: false },
      geoCode: { type: "string", required: false },
      output: { type: "string", required: false, enum: ["raw", "markdown"] },
      super_proxy: { type: "boolean", required: false },
    },
    allowedRoles: ["agent", "pensador", "estratega", "coder"],
    requiresOauth: null,
  },
};

// ------------------------------------------------------------------------------
// isAllowed(toolName, role): valida que el rol puede invocar la tool.
// ------------------------------------------------------------------------------
export function isAllowed(toolName, role) {
  const tool = TOOL_REGISTRY[toolName];
  if (!tool) return false;
  if (!role) return true;
  return tool.allowedRoles.includes(role);
}

// ------------------------------------------------------------------------------
// getTool(toolName): devuelve el objeto de la tool o null.
// ------------------------------------------------------------------------------
export function getTool(toolName) {
  return TOOL_REGISTRY[toolName] || null;
}

// ------------------------------------------------------------------------------
// listTools(): devuelve array de nombres de tools.
// ------------------------------------------------------------------------------
export function listTools() {
  return Object.keys(TOOL_REGISTRY);
}

// ------------------------------------------------------------------------------
// listToolsForRole(role): devuelve tools permitidas para un rol.
// ------------------------------------------------------------------------------
export function listToolsForRole(role) {
  return Object.entries(TOOL_REGISTRY)
    .filter(([_, tool]) => tool.allowedRoles.includes(role))
    .map(([name]) => name);
}

// ------------------------------------------------------------------------------
// hydrateFromServer(registry): reemplaza el catálogo seed con la versión
// descargada de GET /api/tools/registry.
// ------------------------------------------------------------------------------
export function hydrateFromServer(registry) {
  if (!registry || typeof registry !== "object") return;
  for (const [name, tool] of Object.entries(registry)) {
    TOOL_REGISTRY[name] = tool;
  }
}

// ------------------------------------------------------------------------------
// fetchAndHydrate(): llama al endpoint y actualiza el catálogo.
// ------------------------------------------------------------------------------
export async function fetchAndHydrate() {
  try {
    const resp = await fetch("/api/tools/registry");
    if (!resp.ok) return;
    const data = await resp.json();
    if (data && data.tools) {
      hydrateFromServer(data.tools);
    }
  } catch (e) {
    console.warn("[toolRegistry] No se pudo hidratar desde el server, usando seed:", e.message);
  }
}

// ------------------------------------------------------------------------------
// Parser del protocolo XML embebido: <tool_call name="...">...</tool_call>
// Devuelve array de { name, args: {...} }.
// Es robusto a espacios en blanco y mayúsculas en name/arg name.
// Soporta argumentos multi-línea.
// ------------------------------------------------------------------------------
// v2.8.4: los modelos a veces emiten variantes (<toolcall>, nombres sin
// guiones). Normalizamos antes de parsear para que el agente nunca pierda
// una llamada a tool por sintaxis.
function normalizeToolName(n) {
  const low = (n || "").trim().toLowerCase();
  if (TOOL_REGISTRY[low]) return low;
  const flat = low.replace(/[_\-\s]+/g, "");
  for (const key of Object.keys(TOOL_REGISTRY)) {
    if (key.replace(/[_\-\s]+/g, "") === flat) return key;
  }
  return low;
}

export function parseToolCallXML(text) {
  if (!text || typeof text !== "string") return [];
  text = text
    .replace(/<toolcall\b/gi, "<tool_call")
    .replace(/<\/toolcall\s*>/gi, "<\/tool_call>")
    .replace(/<functi?on_call\b/gi, "<tool_call")
    .replace(/<\/(functi?on_call)\s*>/gi, "<\/tool_call>");
  const calls = [];
  const callRegex = /<tool_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/tool_call>/gi;
  let match;
  while ((match = callRegex.exec(text)) !== null) {
    const name = normalizeToolName(match[1]);
    const inner = match[2];
    const args = {};
    const argRegex = /<arg\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/arg>/gi;
    let argMatch;
    while ((argMatch = argRegex.exec(inner)) !== null) {
      const argName = argMatch[1];
      let argVal = argMatch[2];
      // Trim solo los extremos (preservar contenido multi-línea interior).
      argVal = argVal.replace(/^\s+/, "").replace(/\s+$/, "");
      // Intentar parsear como JSON si parece (objetos, arrays, números, booleans).
      argVal = tryParseJSON(argVal);
      args[argName] = argVal;
    }
    calls.push({ name, args });
  }
  return calls;
}

function tryParseJSON(s) {
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


// ------------------------------------------------------------------------------
// escapeXML(s): escapa < > & " ' para incrustar en <tool_result>.
// ------------------------------------------------------------------------------
export function escapeXML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ------------------------------------------------------------------------------
// buildToolResultXML(name, status, output): construye el bloque <tool_result>
// para reinyectar el resultado de una tool en la conversación.
// ------------------------------------------------------------------------------
export function buildToolResultXML(name, status, output) {
  return `<tool_result name="${escapeXML(name)}" status="${escapeXML(status)}">\n${escapeXML(output)}\n</tool_result>`;
}

export default {
  TOOL_REGISTRY,
  isAllowed,
  getTool,
  listTools,
  listToolsForRole,
  hydrateFromServer,
  fetchAndHydrate,
  parseToolCallXML,
  escapeXML,
  buildToolResultXML,
};
