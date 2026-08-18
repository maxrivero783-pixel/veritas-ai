// ==============================================================================
// Véritas v2.12 — /lib/toolMeta.js
// ==============================================================================
// Metadatos estructurados por tool (buenas prácticas 2026: descriptions-as-prompts,
// single-responsibility, metadatos when_to_use/tags/limitations que mejoran la
// selección y la recuperación). Lo usan:
//   - toolRouter.js  → routing por categoría/palabras clave (qué tools inyectar)
//   - toolSchema.js  → function-calling nativo (JSON Schema + descripción rica)
//   - el prompt del Agente → catálogo enriquecido y criterio de selección
// ==============================================================================

// ------------------------------------------------------------------------------
// Categorías. keywords (ES+EN) alimentan el routing por palabras clave.
// ------------------------------------------------------------------------------
export const TOOL_CATEGORIES = {
  web_search: {
    label: "Búsqueda web general",
    keywords: ["buscar", "busca", "search", "google", "noticias", "news", "actualidad", "información", "informacion", "web", "internet", "encuentra", "who", "qué es", "que es", "quién", "quien"],
  },
  page_read: {
    label: "Lectura/scraping de páginas",
    keywords: ["url", "página", "pagina", "leer", "scrape", "scraping", "contenido", "extraer", "html", "markdown", "sitio", "website", "article", "artículo"],
  },
  encyclopedia: {
    label: "Enciclopedias y datos estructurados",
    keywords: ["wikipedia", "wikidata", "enciclopedia", "biografía", "biografia", "entidad", "entity"],
  },
  news_events: {
    label: "Eventos y noticias globales",
    keywords: ["gdelt", "eventos", "events", "cobertura", "tendencia", "protestas", "conflicto", "país", "pais"],
  },
  osint_infra: {
    label: "OSINT técnico: dominios, IPs, certificados, dispositivos",
    keywords: ["dominio", "domain", "dns", "ip", "certificado", "certificate", "whois", "subdominio", "ssl", "shodan", "zoomeye", "puerto", "dispositivo", "iot", "cámara", "camara"],
  },
  cybersec: {
    label: "Ciberseguridad y vulnerabilidades",
    keywords: ["cve", "vulnerabilidad", "vulnerability", "exploit", "brecha", "leak", "fuga", "intelx", "malware", "parche", "zero-day", "zeroday"],
  },
  legal: {
    label: "Legal y regulatorio",
    keywords: ["sec", "edgar", "filing", "corte", "court", "demanda", "lawsuit", "jurisprudencia", "empresa", "financiero", "10-k"],
  },
  academic: {
    label: "Académico y científico",
    keywords: ["paper", "estudio", "investigación", "investigacion", "académico", "academico", "cita", "citation", "doi", "nasa", "ciencia", "journal", "revisión"],
  },
  geo_weather: {
    label: "Geolocalización, clima y vuelos",
    keywords: ["coordenadas", "latitud", "longitud", "clima", "weather", "tiempo", "lugar", "ubicación", "ubicacion", "geocode", "vuelo", "flight", "avión", "avion", "mapa"],
  },
  software: {
    label: "Software y dependencias",
    keywords: ["npm", "pypi", "paquete", "package", "librería", "libreria", "versión", "version", "dependencia", "código", "codigo"],
  },
  text_analysis: {
    label: "Análisis de texto y entidades",
    keywords: ["entidades", "emails", "ips", "extraer", "ner", "urls", "fechas", "parsear texto"],
  },
  github: {
    label: "GitHub (OAuth)",
    keywords: ["github", "repositorio", "repo", "commit", "branch", "pull request", "pr", "código fuente"],
  },
  media_docs: {
    label: "Media, audio y documentos",
    keywords: ["imagen", "image", "foto", "pdf", "audio", "transcrib", "vídeo", "video", "documento", "analizar archivo"],
  },
  project: {
    label: "Proyecto y sandbox",
    keywords: ["proyecto", "archivo", "sandbox", "plantilla", "template", "preview", "skill", "html"],
  },
  browser: {
    label: "Navegación con browser real",
    keywords: ["navegar", "browser", "headless", "screenshot", "render", "javascript", "spa", "interactuar"],
  },
  apify: {
    label: "Redes sociales y mapas (Apify)",
    keywords: ["instagram", "twitter", "tiktok", "facebook", "perfil social", "google maps", "negocio", "reviews", "apify"],
  },
  inference: {
    label: "Inferencia LLM directa",
    keywords: ["cohere", "generar", "resumen ia", "inferencia"],
  },
  misc: {
    label: "Utilidades",
    keywords: ["email", "correo", "gfw", "enviar"],
  },
};

// ------------------------------------------------------------------------------
// tool → categoría. Cubre las 61 tools del registro.
// ------------------------------------------------------------------------------
export const TOOL_CATEGORY = {
  // Búsqueda web
  web_search: "web_search", exa_search: "web_search", hackernews_search: "web_search",
  // Lectura de páginas
  scrape_url: "page_read", jina_reader_search: "page_read", firecrawl_scrape: "page_read",
  firecrawl_crawl: "page_read", rover_scrape: "page_read", scrapedo_scrape: "page_read", fetch_via_proxy: "page_read",
  // Enciclopedias
  wikipedia_search: "encyclopedia", wikidata_search: "encyclopedia",
  // Eventos
  gdelt_search: "news_events",
  // OSINT infra
  dns_lookup: "osint_infra", crtsh_lookup: "osint_infra", rdap_lookup: "osint_infra",
  shodan_search: "osint_infra", zoomeye_search: "osint_infra",
  // Ciberseguridad
  nvd_cve_search: "cybersec", cisa_kev_search: "cybersec", intelx_search: "cybersec", gfw_search: "cybersec",
  // Legal
  sec_edgar_search: "legal", courtlistener_search: "legal",
  // Académico
  semantic_scholar_search: "academic", openalex_search: "academic", crossref_search: "academic", nasa_search: "academic",
  // Geo/clima/vuelos
  geonames_search: "geo_weather", nominatim_search: "geo_weather", open_meteo_weather: "geo_weather", aviationstack_flights: "geo_weather",
  // Software
  npm_package_info: "software", pypi_package_info: "software", jina_github_search: "software",
  // Texto
  ner_extract: "text_analysis",
  // GitHub
  github_list_repos: "github", github_read_file: "github", github_write_file: "github",
  github_write_files: "github", github_create_branch: "github", github_create_pr: "github",
  // Media/documentos
  analyze_media: "media_docs", assemblyai_transcribe: "media_docs", llamaparse_parse: "media_docs",
  // Proyecto/sandbox
  search_repository: "project", read_project_file: "project", write_project_file: "project",
  create_skill: "project", preview_html: "project", load_template: "project",
  // Browser
  browser_use_browse: "browser", browser_use_cloud: "browser", steel_session: "browser",
  steel_auth_session: "browser", browserless_execute: "browser", spider_cloud_search: "browser",
  // Apify
  apify_google_places: "apify", apify_social: "apify",
  // Inferencia
  cohere_infer: "inference",
  // Misc
  email_report: "misc",
};

// ------------------------------------------------------------------------------
// Metadatos por tool: when_to_use, tags, limitations, example. Los usa el
// router (recuperación) y el enriquecedor de descripciones.
// ------------------------------------------------------------------------------
export const TOOL_META = {
  web_search: { when_to_use: "Para hallar información actual o amplia en la web cuando no conoces la URL.", tags: ["search", "google", "news"], limitations: "Requiere clave Jina/Tavily/Serper.", example: 'web_search(query="elecciones 2026")' },
  exa_search: { when_to_use: "Búsqueda semántica/neuronal; mejor para conceptos que para palabras exactas.", tags: ["search", "semantic"], limitations: "Requiere clave Exa.", example: 'exa_search(query="técnicas OSINT con IA")' },
  hackernews_search: { when_to_use: "Discusiones y proyectos tech/seguridad en Hacker News.", tags: ["tech", "forums"], limitations: "Solo contenido de HN.", example: 'hackernews_search(query="osint")' },
  scrape_url: { when_to_use: "Extraer el texto/markdown de una URL concreta que ya conoces.", tags: ["scrape", "markdown"], limitations: "Páginas con mucho JS pueden requerir render.", example: 'scrape_url(url="https://ejemplo.com/articulo")' },
  jina_reader_search: { when_to_use: "Lectura limpia de una URL vía Jina Reader (sin clave si el pool lo permite).", tags: ["scrape", "reader"], limitations: "Sin render JS.", example: 'jina_reader_search(url="https://ejemplo.com")' },
  firecrawl_scrape: { when_to_use: "Scraping con render JS y extracción estructurada.", tags: ["scrape", "js"], limitations: "Consume créditos Firecrawl.", example: 'firecrawl_scrape(url="https://spa-app.com")' },
  firecrawl_crawl: { when_to_use: "Rastrear múltiples páginas de un sitio.", tags: ["crawl"], limitations: "Consume créditos.", example: 'firecrawl_crawl(url="https://ejemplo.com")' },
  rover_scrape: { when_to_use: "Scraping alternativo cuando fallan otros proveedores.", tags: ["scrape"], limitations: "Requiere clave Rover.", example: 'rover_scrape(url="...")' },
  scrapedo_scrape: { when_to_use: "Scraping con proxy residencial para sitios protegidos.", tags: ["scrape", "proxy"], limitations: "Requiere clave Scrape.do.", example: 'scrapedo_scrape(url="...")' },
  fetch_via_proxy: { when_to_use: "Llamada HTTP genérica vía proxy del Worker (evita CORS), inyecta claves del rotador.", tags: ["http", "proxy"], limitations: "Solo HTTPS; anti-SSRF.", example: 'fetch_via_proxy(url="https://api.open-meteo.com/...")' },
  wikipedia_search: { when_to_use: "Artículos enciclopédicos y contexto general verificable.", tags: ["encyclopedia"], limitations: "No es información de última hora.", example: 'wikipedia_search(query="Cuba")' },
  wikidata_search: { when_to_use: "Entidades y relaciones estructuradas (Q-ids, propiedades).", tags: ["knowledge-graph"], limitations: "Devuelve datos crudos.", example: 'wikidata_search(query="Fidel Castro")' },
  gdelt_search: { when_to_use: "Eventos mundiales, tono y cobertura mediática (gratis, sin clave).", tags: ["events", "news"], limitations: "Ruido alto; filtra por timespan.", example: 'gdelt_search(query="protestas", mode="events", timespan="1w")' },
  dns_lookup: { when_to_use: "Registros DNS (A, MX, TXT, NS) de un dominio.", tags: ["dns", "osint"], limitations: "Solo dominios válidos.", example: 'dns_lookup(domain="ejemplo.com", record_type="MX")' },
  crtsh_lookup: { when_to_use: "Certificados TLS emitidos (descubre subdominios).", tags: ["certificates", "osint"], limitations: "crt.sh puede ser lento.", example: 'crtsh_lookup(domain="ejemplo.com")' },
  rdap_lookup: { when_to_use: "Whois/registro de dominios e IPs (RDAP).", tags: ["whois", "osint"], limitations: "Algunos TLD sin RDAP.", example: 'rdap_lookup(query="ejemplo.com")' },
  shodan_search: { when_to_use: "Dispositivos, puertos y servicios expuestos en internet.", tags: ["shodan", "iot"], limitations: "Requiere clave + consentimiento.", example: 'shodan_search(query="apache country:CU")' },
  zoomeye_search: { when_to_use: "Alternativa a Shodan para ciberespacio expuesto.", tags: ["zoomeye", "iot"], limitations: "Requiere clave.", example: 'zoomeye_search(query="nginx")' },
  nvd_cve_search: { when_to_use: "CVEs oficiales del NIST por id o palabra clave.", tags: ["cve", "nvd"], limitations: "Rate limit sin clave NVD.", example: 'nvd_cve_search(keyword="log4j")' },
  cisa_kev_search: { when_to_use: "Vulnerabilidades explotadas activamente (CISA KEV).", tags: ["kev", "exploit"], limitations: "Solo el catálogo KEV.", example: 'cisa_kev_search(query="ransomware")' },
  intelx_search: { when_to_use: "Datos filtrados/fugas (Intelligence X).", tags: ["leaks", "breach"], limitations: "Requiere clave + consentimiento.", example: 'intelx_search(query="dominio.com")' },
  gfw_search: { when_to_use: "Detección de censura/bloqueos (Great Firewall).", tags: ["censorship"], limitations: "Cobertura limitada.", example: 'gfw_search(query="...")' },
  sec_edgar_search: { when_to_use: "Filings SEC (10-K, 8-K) de empresas de EE. UU.", tags: ["sec", "finance"], limitations: "Solo empresas con filings SEC.", example: 'sec_edgar_search(query="Apple")' },
  courtlistener_search: { when_to_use: "Jurisprudencia y casos de cortes de EE. UU.", tags: ["legal", "cases"], limitations: "Solo EE. UU.", example: 'courtlistener_search(query="copyright")' },
  semantic_scholar_search: { when_to_use: "Papers y citas (Semantic Scholar).", tags: ["papers"], limitations: "Rate limit.", example: 'semantic_scholar_search(query="transformers")' },
  openalex_search: { when_to_use: "Catálogo académico abierto (OpenAlex).", tags: ["papers", "open"], limitations: "", example: 'openalex_search(query="climate")' },
  crossref_search: { when_to_use: "Metadatos y DOIs (Crossref).", tags: ["doi"], limitations: "", example: 'crossref_search(query="genomics")' },
  nasa_search: { when_to_use: "Documentos y datos de la NASA.", tags: ["nasa", "space"], limitations: "Solo contenido NASA.", example: 'nasa_search(query="artemis")' },
  geonames_search: { when_to_use: "Lugares y coordenadas (GeoNames).", tags: ["geo", "places"], limitations: "Requiere usuario GeoNames.", example: 'geonames_search(query="Havana")' },
  nominatim_search: { when_to_use: "Geocodificación abierta (OpenStreetMap Nominatim).", tags: ["geo", "geocode"], limitations: "Uso responsable (1 req/s).", example: 'nominatim_search(query="Mexico City")' },
  open_meteo_weather: { when_to_use: "Clima actual y pronóstico por coordenadas (gratis).", tags: ["weather"], limitations: "Requiere latitude/longitude.", example: 'open_meteo_weather(latitude=23.1, longitude=-82.4)' },
  aviationstack_flights: { when_to_use: "Estado de vuelos y aerolíneas.", tags: ["flights"], limitations: "Requiere clave AviationStack.", example: 'aviationstack_flights(flight_iata="CU123")' },
  npm_package_info: { when_to_use: "Metadatos de paquetes npm.", tags: ["npm"], limitations: "", example: 'npm_package_info(package="react")' },
  pypi_package_info: { when_to_use: "Metadatos de paquetes PyPI.", tags: ["pypi", "python"], limitations: "", example: 'pypi_package_info(package="requests")' },
  jina_github_search: { when_to_use: "Búsqueda de código/repos en GitHub vía Jina.", tags: ["github", "code"], limitations: "", example: 'jina_github_search(query="osint framework")' },
  ner_extract: { when_to_use: "Extraer URLs, emails, IPs, fechas, etc. de un texto dado.", tags: ["ner", "entities"], limitations: "Trabaja sobre el texto que le pases.", example: 'ner_extract(text="contacto: a@b.com")' },
  analyze_media: { when_to_use: "Describir imagen/PDF/audio/vídeo (URL o R2 key) vía modelos Nano.", tags: ["vision", "multimodal"], limitations: "R2 desactivado ⇒ usa URLs públicas.", example: 'analyze_media(target="https://.../foto.jpg", modality="image")' },
  assemblyai_transcribe: { when_to_use: "Transcribir audio a texto.", tags: ["audio", "transcription"], limitations: "Requiere clave AssemblyAI.", example: 'assemblyai_transcribe(audio_url="https://.../audio.mp3")' },
  llamaparse_parse: { when_to_use: "Parsear PDFs/documentos complejos a texto estructurado.", tags: ["pdf", "parse"], limitations: "Requiere clave LlamaCloud.", example: 'llamaparse_parse(url="https://.../doc.pdf")' },
  search_repository: { when_to_use: "Buscar en tus chats/documentos guardados.", tags: ["project"], limitations: "", example: 'search_repository(query="informe")' },
  read_project_file: { when_to_use: "Leer un archivo del proyecto/sandbox.", tags: ["project"], limitations: "", example: 'read_project_file(path="index.html")' },
  write_project_file: { when_to_use: "Escribir/sobrescribir un archivo del proyecto.", tags: ["project"], limitations: "", example: 'write_project_file(path="out.html", content="...")' },
  create_skill: { when_to_use: "Crear una skill personalizada si el usuario lo pide explícitamente.", tags: ["skill"], limitations: "Solo a petición del usuario.", example: 'create_skill(name="...", description="...", promptContent="...")' },
  preview_html: { when_to_use: "Registrar HTML para vista previa en el Sandbox.", tags: ["sandbox", "html"], limitations: "", example: 'preview_html(html="<html>...")' },
  load_template: { when_to_use: "Insertar una plantilla pre-armada en el Sandbox.", tags: ["sandbox", "template"], limitations: "name debe ser una de las 14 plantillas.", example: 'load_template(name="osint-report")' },
  browser_use_browse: { when_to_use: "Navegar una página con un browser real (interacción/JS).", tags: ["browser"], limitations: "Requiere clave Browser-use.", example: 'browser_use_browse(url="...")' },
  browser_use_cloud: { when_to_use: "Browser en la nube para tareas multi-paso.", tags: ["browser", "cloud"], limitations: "Requiere clave.", example: 'browser_use_cloud(task="...")' },
  steel_session: { when_to_use: "Sesión de browser persistente (Steel).", tags: ["browser"], limitations: "Requiere clave Steel.", example: 'steel_session()' },
  steel_auth_session: { when_to_use: "Sesión Steel con auth para sitios con login.", tags: ["browser", "auth"], limitations: "Requiere clave.", example: 'steel_auth_session()' },
  browserless_execute: { when_to_use: "Ejecutar acciones de browser vía Browserless.", tags: ["browser"], limitations: "Requiere clave.", example: 'browserless_execute(...)' },
  spider_cloud_search: { when_to_use: "Búsqueda/crawl en la nube (Spider).", tags: ["crawl", "cloud"], limitations: "Requiere clave.", example: 'spider_cloud_search(query="...")' },
  apify_google_places: { when_to_use: "Listings y datos de negocios en Google Maps.", tags: ["maps", "business"], limitations: "Requiere clave Apify + consentimiento.", example: 'apify_google_places(query="cafeterias Habana")' },
  apify_social: { when_to_use: "Perfiles/publicaciones de redes sociales.", tags: ["social", "osint"], limitations: "Requiere clave Apify + consentimiento.", example: 'apify_social(profile="usuario")' },
  cohere_infer: { when_to_use: "Inferencia LLM directa vía Cohere.", tags: ["llm"], limitations: "Requiere clave Cohere.", example: 'cohere_infer(prompt="...")' },
  email_report: { when_to_use: "Enviar un informe por email vía Brevo.", tags: ["email"], limitations: "Requiere clave Brevo + remitente verificado.", example: 'email_report(to="...", subject="...", body="...")' },
  github_list_repos: { when_to_use: "Listar repos del usuario conectado (OAuth GitHub).", tags: ["github", "oauth"], limitations: "Requiere conexión GitHub.", example: 'github_list_repos()' },
  github_read_file: { when_to_use: "Leer un archivo de un repo (OAuth GitHub).", tags: ["github", "oauth"], limitations: "Requiere conexión GitHub.", example: 'github_read_file(repo="...", path="README.md")' },
  github_write_file: { when_to_use: "Escribir un archivo en un repo (OAuth GitHub).", tags: ["github", "oauth"], limitations: "Requiere conexión GitHub.", example: 'github_write_file(repo="...", path="...", content="...")' },
  github_write_files: { when_to_use: "Escribir varios archivos en un repo en un commit.", tags: ["github", "oauth"], limitations: "Requiere conexión GitHub.", example: 'github_write_files(repo="...", files=[...])' },
  github_create_branch: { when_to_use: "Crear una rama en un repo (OAuth GitHub).", tags: ["github", "oauth"], limitations: "Requiere conexión GitHub.", example: 'github_create_branch(repo="...", branch="feat/x")' },
  github_create_pr: { when_to_use: "Crear un pull request (OAuth GitHub).", tags: ["github", "oauth"], limitations: "Requiere conexión GitHub.", example: 'github_create_pr(repo="...", head="...", base="main")' },
};

// ------------------------------------------------------------------------------
// getToolCategory / getToolMeta
// ------------------------------------------------------------------------------
export function getToolCategory(name) {
  return TOOL_CATEGORY[name] || "misc";
}
export function getToolMeta(name) {
  return TOOL_META[name] || { when_to_use: "", tags: [], limitations: "", example: "" };
}

// ------------------------------------------------------------------------------
// describeTool: descripción enriquecida estilo prompt (qué hace / cuándo usarla /
// limitación / ejemplo), apuntando a <200 caracteres por buena práctica. Se usa
// en el catálogo del Agente y en el JSON Schema de function-calling nativo.
// ------------------------------------------------------------------------------
export function describeTool(name, baseDescription) {
  const meta = getToolMeta(name);
  const base = (baseDescription || "").replace(/\s+/g, " ").trim();
  let parts = [];
  if (base) parts.push(base);
  if (meta.when_to_use) parts.push("Úsala " + meta.when_to_use.charAt(0).toLowerCase() + meta.when_to_use.slice(1));
  if (meta.limitations) parts.push(meta.limitations);
  let desc = parts.join(" ").replace(/\s+/g, " ").trim();
  if (desc.length > 220) desc = desc.slice(0, 217).trim() + "…";
  return desc;
}

export default { TOOL_CATEGORIES, TOOL_CATEGORY, TOOL_META, getToolCategory, getToolMeta, describeTool };
