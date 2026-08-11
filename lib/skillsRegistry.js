// ==============================================================================
// Véritas v2.4 — /lib/skillsRegistry.js
// ==============================================================================
// Registro híbrido de Skills: estáticas (79 built-in) + customs del usuario (D1).
// Las custom skills se cargan desde el backend vía GET /api/skills y se
// fusionan con las estáticas. Un skill-creator puede añadir nuevas.
//
// Flujo de carga dinámica:
//   1. Al iniciar, el frontend llama `loadCustomSkills()` que hace GET /api/skills.
//   2. Las customs se almacenan en `_customSkills[]` (memoria, se recargan por sesión).
//   3. `getAllSkills()` devuelve estáticas + customs fusionadas.
//   4. `getActiveSkills()` filtra por `state.settings.skills.enabled`.
//   5. `buildSkillsPromptBlock()` inyecta el `promptContent` de customs directamente
//      (no leen archivos .md como las estáticas).
//
// Roles y acceso a skills:
//   - agent:    TODAS las skills (79 built-in + customs)
//   - estratega: TODAS las skills
//   - coder:    solo skills relevantes para código
//   - pensador:  skills de análisis, razonamiento y verificación
//   - fast:      skills básicas de utilidad general (sin OSINT pesado)
// ==============================================================================

// ─── Categorías de skills ───────────────────────────────────────────────────

const SKILLS_CATEGORIES = {
  verification:   { label: "Verificación",        color: "#50C878", icon: "\u2705" },
  osint:          { label: "OSINT",               color: "#a78bfa", icon: "\uD83D\uDD0D" },
  analysis:       { label: "Análisis",             color: "#3b82f6", icon: "\uD83D\uDCCA" },
  coding:         { label: "Código",               color: "#f97316", icon: "\uD83D\uDCBB" },
  writing:        { label: "Escritura",            color: "#ec4899", icon: "\u270D\uFE0F" },
  research:       { label: "Investigación",        color: "#8b5cf6", icon: "\uD83D\uDD2E" },
  data:           { label: "Datos",                color: "#06b6d4", icon: "\uD83D\uDCC8" },
  media:          { label: "Media",                color: "#f43f5e", icon: "\uD83C\uDFAC" },
  productivity:   { label: "Productividad",        color: "#10b981", icon: "\u2699" },
  education:      { label: "Educación",            color: "#6366f1", icon: "\uD83C\uDF93" },
  business:       { label: "Negocios",             color: "#eab308", icon: "\uD83D\uDCBC" },
  communication:  { label: "Comunicación",         color: "#14b8a6", icon: "\uD83D\uDCE3" },
  design:         { label: "Diseño",               color: "#d946ef", icon: "\uD83C\uDFAD" },
  document:       { label: "Documentos",           color: "#78716c", icon: "\uD83D\uDCC4" },
  security:       { label: "Seguridad",            color: "#ef4444", icon: "\uD83D\uDD12" },
  meta:           { label: "Meta / Sistema",        color: "#64748b", icon: "\u2699\uFE0F" },
};

const SKILLS_TIER = {
  core:     { label: "Núcleo del producto",     description: "Funciones esenciales de verificación" },
  advanced: { label: "Investigación profunda",  description: "OSINT y análisis avanzado" },
  utility:  { label: "Utilidades transversales", description: "Herramientas complementarias" },
};

/**
 * Definición estática de las 79 skills built-in de Véritas.
 * - `promptPath`: ruta relativa al SKILL.md desde la raíz del proyecto (para Cloudflare).
 * - `inputType`: tipo de entrada que espera la skill.
 * - `outputType`: tipo de salida que produce.
 * - `needsExternal`: si depende de servicios externos (web search, image, etc.).
 * - `references`: archivos adicionales de referencia que el prompt espera.
 * - `allowedRoles`: roles que pueden usar esta skill.
 */
const SKILLS = [
  // ═══════════════════════════════════════════════════════════════════════════
  // VERIFICACIÓN (core) — Núcleo del producto
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "cross-reference-claim",
    name: "Verificador de afirmaciones",
    description: "Cruza una afirmación contra documentos de referencia y emite un veredicto (corroborado/contradicho/sin evidencia/parcial) por fuente, con nivel de independencia y evidencia.",
    category: "verification",
    tier: "core",
    inputType: "text",
    outputType: "structured_report",
    needsExternal: false,
    promptPath: "prompts/cross-reference-claim.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\u2705",
    color: "#50C878",
  },
  {
    id: "media-literacy-analyzer",
    name: "Analizador de medios",
    description: "Analiza noticias, posts, memes o anuncios para detectar manipulación, framing, sesgos y falacias. Desglose educativo de técnicas de manipulación.",
    category: "verification",
    tier: "core",
    inputType: "text_or_image",
    outputType: "educational_analysis",
    needsExternal: false,
    promptPath: "prompts/media-literacy-analyzer.md",
    references: ["prompts/references/manipulation-techniques.md"],
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    icon: "\uD83D\uDCF0",
    color: "#50C878",
  },
  {
    id: "source-reliability-rater",
    name: "Evaluador de fuentes",
    description: "Evalúa la confiabilidad de un medio, autor o sitio web (credibilidad, historial, sesgo, ownership, transparencia). Devuelve un score 0-100 y perfil de sesgo.",
    category: "verification",
    tier: "core",
    inputType: "url_or_text",
    outputType: "scored_report",
    needsExternal: false,
    promptPath: "prompts/source-reliability-rater.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    icon: "\u2B50",
    color: "#50C878",
  },
  {
    id: "argument-deconstruct",
    name: "Deconstructor de argumentos",
    description: "Descompone un argumento o discurso en premisas, conclusión, falacias lógicas y técnicas de persuasión. Evalúa la solidez del razonamiento.",
    category: "verification",
    tier: "core",
    inputType: "text",
    outputType: "logical_analysis",
    needsExternal: false,
    promptPath: "prompts/argument-deconstruct.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83E\uDDE9",
    color: "#50C878",
  },
  {
    id: "timeline-from-sources",
    name: "Cronología de fuentes",
    description: "Extrae eventos de uno o varios documentos y arma una cronología con fuente y nivel de confianza por evento. Filtrable por entidad.",
    category: "verification",
    tier: "core",
    inputType: "documents",
    outputType: "timeline_json",
    needsExternal: false,
    promptPath: "prompts/timeline-from-sources.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83D\uDCC5",
    color: "#50C878",
  },
  {
    id: "build-entity-graph",
    name: "Grafo de entidades",
    description: "NER + relaciones: genera un grafo de entidades (personas, organizaciones, lugares, eventos) en JSON con visualización interactiva.",
    category: "verification",
    tier: "core",
    inputType: "documents",
    outputType: "entity_graph_json",
    needsExternal: false,
    promptPath: "prompts/build-entity-graph.md",
    references: ["prompts/references/entity-types.md"],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83D\uDD78",
    color: "#50C878",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OSINT (advanced) — Investigación profunda
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "detect-coordinated-behavior",
    name: "Detector de comportamiento coordinado",
    description: "Detecta comportamiento coordinado y bots en listas de cuentas sociales (timestamps, redes de share, sincronía). Informe con indicadores y nivel de sospecha.",
    category: "osint",
    tier: "advanced",
    inputType: "text_list",
    outputType: "investigation_report",
    needsExternal: false,
    promptPath: "prompts/detect-coordinated-behavior.md",
    references: ["prompts/references/indicators-reference.md"],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDD75",
    color: "#a78bfa",
  },
  {
    id: "social-username-correlate",
    name: "Correlador de usernames",
    description: "Busca un username en múltiples plataformas (estilo OSINT). Reporte de correlación cross-plataforma con indicadores de coincidencia.",
    category: "osint",
    tier: "advanced",
    inputType: "text",
    outputType: "osint_report",
    needsExternal: true,
    promptPath: "prompts/social-username-correlate.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDD0D",
    color: "#a78bfa",
  },
  {
    id: "social-profile-analyzer",
    name: "Analizador de perfiles sociales",
    description: "Análisis profundo de un perfil social (persona, marca u organización). Auditoría completa de presencia digital.",
    category: "osint",
    tier: "advanced",
    inputType: "text",
    outputType: "audit_report",
    needsExternal: true,
    promptPath: "prompts/social-profile-analyzer.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDC64",
    color: "#a78bfa",
  },
  {
    id: "geolocate-from-visual-cues",
    name: "Geolocalización visual",
    description: "Geolocaliza una foto por pistas visuales (sombras, arquitectura, señalética). Ranking de hipótesis de ubicación con porcentaje de confianza.",
    category: "osint",
    tier: "advanced",
    inputType: "image",
    outputType: "location_ranking",
    needsExternal: false,
    promptPath: "prompts/geolocate-from-visual-cues.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83C\uDF10",
    color: "#a78bfa",
  },
  {
    id: "influence-operations-analyst",
    name: "Analista de operaciones de influencia",
    description: "Detecta operaciones de influencia, desinformación estatal, propaganda y astroturfing. Informe de detección con evaluación de amenaza.",
    category: "osint",
    tier: "advanced",
    inputType: "text_or_url",
    outputType: "threat_report",
    needsExternal: false,
    promptPath: "prompts/influence-operations-analyst.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\u26A0",
    color: "#a78bfa",
  },
  {
    id: "social-phenomena-analyst",
    name: "Analista de fenómenos sociales",
    description: "Analiza por qué algo se volvió viral, tendencias y movimientos culturales. Análisis multi-perspectiva con contexto sociológico.",
    category: "osint",
    tier: "advanced",
    inputType: "text",
    outputType: "analysis_report",
    needsExternal: false,
    promptPath: "prompts/social-phenomena-analyst.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83D\uDCAC",
    color: "#a78bfa",
  },
  {
    id: "psychological-profile",
    name: "Perfilador psicológico",
    description: "Construye un perfil psicológico de una persona a partir de textos o perfiles de redes sociales (rasgos, apego, narrativa interna).",
    category: "osint",
    tier: "advanced",
    inputType: "text",
    outputType: "profile_report",
    needsExternal: false,
    promptPath: "prompts/psychological-profile.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83E\uDDE0",
    color: "#a78bfa",
  },
  {
    id: "legal-document-analyzer",
    name: "Analizador de documentos legales",
    description: "Analiza contratos y términos de servicio. Extrae cláusulas de riesgo y las traduce a lenguaje claro. No reemplaza asesoría legal.",
    category: "osint",
    tier: "advanced",
    inputType: "text",
    outputType: "legal_analysis",
    needsExternal: false,
    promptPath: "prompts/legal-document-analyzer.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83D\uDCDC",
    color: "#a78bfa",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ANÁLISIS — Análisis profundo y razonamiento
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "conflict-dynamics-analyst",
    name: "Analista de dinámicas de conflicto",
    description: "Analiza conflictos sociales, políticos o organizacionales. Identifica actores, dinámicas de poder, puntos de inflexión y posibles escenarios de evolución.",
    category: "analysis",
    tier: "advanced",
    inputType: "text",
    outputType: "conflict_analysis",
    needsExternal: false,
    promptPath: "prompts/conflict-dynamics-analyst.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83D\uDD0D",
    color: "#3b82f6",
  },
  {
    id: "contentanalysis",
    name: "Analizador de contenido",
    description: "Analiza cualquier contenido textual: temas, tono, estructura, audiencia objetivo, calidad y recomendaciones de mejora.",
    category: "analysis",
    tier: "utility",
    inputType: "text",
    outputType: "content_report",
    needsExternal: false,
    promptPath: "prompts/contentanalysis.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83D\uDCCA",
    color: "#3b82f6",
  },
  {
    id: "geopolitical-risk-analyst",
    name: "Analista de riesgo geopolítico",
    description: "Evalúa riesgos geopolíticos de una región, evento o política. Análisis de actores, intereses, escenarios y recomendaciones estratégicas.",
    category: "analysis",
    tier: "advanced",
    inputType: "text",
    outputType: "risk_report",
    needsExternal: true,
    promptPath: "prompts/geopolitical-risk-analyst.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83C\uDF0D",
    color: "#3b82f6",
  },
  {
    id: "global-logistics-evaluator",
    name: "Evaluador de logística global",
    description: "Evalúa cadenas de suministro, rutas logísticas y operaciones globales. Identifica cuellos de botella, riesgos y optimizaciones.",
    category: "analysis",
    tier: "utility",
    inputType: "text",
    outputType: "logistics_report",
    needsExternal: true,
    promptPath: "prompts/global-logistics-evaluator.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCE6",
    color: "#3b82f6",
  },
  {
    id: "anti-pua",
    name: "Detector de manipulación PUA",
    description: "Detecta tácticas de PUA (Pick-Up Artist) y manipulación emocional en interacciones textuales. Alerta sobre patrones de coerción y gaslighting.",
    category: "analysis",
    tier: "utility",
    inputType: "text",
    outputType: "safety_analysis",
    needsExternal: false,
    promptPath: "prompts/anti-pua.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83D\uDEE1",
    color: "#3b82f6",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INVESTIGACIÓN — Búsqueda y recolección de información
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "web-search",
    name: "Búsqueda web",
    description: "Búsqueda en tiempo real en la web. Encuentra información actualizada, noticias, artículos y datos. Usa tools de búsqueda disponibles.",
    category: "research",
    tier: "utility",
    inputType: "text",
    outputType: "search_results",
    needsExternal: true,
    promptPath: "prompts/web-search.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83D\uDD0D",
    color: "#8b5cf6",
  },
  {
    id: "web-reader",
    name: "Lector de páginas web",
    description: "Extrae y analiza contenido de páginas web (scraping). Extrae título, cuerpo, metadatos y fecha de publicación.",
    category: "research",
    tier: "utility",
    inputType: "url",
    outputType: "extracted_content",
    needsExternal: true,
    promptPath: "prompts/web-reader.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83D\uDCC4",
    color: "#8b5cf6",
  },
  {
    id: "image-search",
    name: "Búsqueda de imágenes",
    description: "Busca imágenes relevantes en la web a partir de una descripción textual. Devuelve URLs directas con captions.",
    category: "research",
    tier: "utility",
    inputType: "text",
    outputType: "image_results",
    needsExternal: true,
    promptPath: "prompts/image-search.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83D\uDBC6",
    color: "#8b5cf6",
  },
  {
    id: "multi-search-engine",
    name: "Multi-buscador",
    description: "Busca simultáneamente en múltiples motores de búsqueda para comparar resultados y obtener cobertura más amplia.",
    category: "research",
    tier: "utility",
    inputType: "text",
    outputType: "comparison_results",
    needsExternal: true,
    promptPath: "prompts/multi-search-engine.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    icon: "\uD83D\uDD0D",
    color: "#8b5cf6",
  },
  {
    id: "ai-news-collectors",
    name: "Recopilador de noticias IA",
    description: "Recopila y resume las últimas noticias sobre inteligencia artificial, LLMs y desarrollo tecnológico relevante.",
    category: "research",
    tier: "utility",
    inputType: "text",
    outputType: "news_digest",
    needsExternal: true,
    promptPath: "prompts/ai-news-collectors.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    icon: "\uD83D\uDCF0",
    color: "#8b5cf6",
  },
  {
    id: "aminer-research",
    name: "Investigador académico (AMiner)",
    description: "Busca y analiza papers académicos, autores y tendencias de investigación. Citaciones, resúmenes y estado del arte.",
    category: "research",
    tier: "utility",
    inputType: "text",
    outputType: "academic_report",
    needsExternal: true,
    promptPath: "prompts/aminer-research.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    icon: "\uD83D\uDCDA",
    color: "#8b5cf6",
  },
  {
    id: "qingyan-research",
    name: "Investigación Qingyan",
    description: "Investigación profunda con metodología estructurada. Recopilación, análisis y síntesis de información compleja.",
    category: "research",
    tier: "utility",
    inputType: "text",
    outputType: "research_report",
    needsExternal: true,
    promptPath: "prompts/qingyan-research.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83D\uDD2E",
    color: "#8b5cf6",
  },
  {
    id: "auto-target-tracker",
    name: "Rastreador automático de objetivos",
    description: "Rastrea y monitorea objetivos de investigación: personas, organizaciones, temas. Alertas de cambios y actualizaciones.",
    category: "research",
    tier: "advanced",
    inputType: "text",
    outputType: "tracking_report",
    needsExternal: true,
    promptPath: "prompts/auto-target-tracker.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDD04",
    color: "#8b5cf6",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CODIFICACIÓN — Desarrollo y código
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "coding-agent",
    name: "Agente de codificación",
    description: "Asistente de programación completo: genera, depura, refactoriza y explica código. Soporta múltiples lenguajes y frameworks.",
    category: "coding",
    tier: "core",
    inputType: "text",
    outputType: "code",
    needsExternal: false,
    promptPath: "prompts/coding-agent.md",
    references: [],
    allowedRoles: ["agent", "coder"],
    icon: "\uD83D\uDCBB",
    color: "#f97316",
  },
  {
    id: "fullstack-dev",
    name: "Desarrollo fullstack",
    description: "Desarrollo web completo: frontend, backend, APIs, bases de datos. Arquitectura, mejores prácticas y deployment.",
    category: "coding",
    tier: "advanced",
    inputType: "text",
    outputType: "code_project",
    needsExternal: false,
    promptPath: "prompts/fullstack-dev.md",
    references: [],
    allowedRoles: ["agent", "coder"],
    icon: "\uD83C\uDFE0",
    color: "#f97316",
  },
  {
    id: "agent-browser",
    name: "Navegador automatizado",
    description: "Automatización de navegador headless para scraping, testing y automatización web. Navega, hace click, escribe y captura páginas.",
    category: "coding",
    tier: "advanced",
    inputType: "text",
    outputType: "browser_action",
    needsExternal: true,
    promptPath: "prompts/agent-browser.md",
    references: [],
    allowedRoles: ["agent", "coder"],
    icon: "\uD83D\uDDA5",
    color: "#f97316",
  },
  {
    id: "web-artifacts-builder",
    name: "Constructor de artefactos web",
    description: "Crea artefactos web interactivos: widgets, visualizaciones, mini-apps. HTML/CSS/JS embebido.",
    category: "coding",
    tier: "utility",
    inputType: "text",
    outputType: "web_artifact",
    needsExternal: false,
    promptPath: "prompts/web-artifacts-builder.md",
    references: [],
    allowedRoles: ["agent", "coder"],
    icon: "\uD83D\uDE80",
    color: "#f97316",
  },
  {
    id: "web-shader-extractor",
    name: "Extractor de shaders web",
    description: "Extrae, analiza y modifica shaders WebGL/GLSL de páginas web. Útil para entender efectos visuales y reproducirlos.",
    category: "coding",
    tier: "utility",
    inputType: "url_or_code",
    outputType: "shader_code",
    needsExternal: false,
    promptPath: "prompts/web-shader-extractor.md",
    references: [],
    allowedRoles: ["agent", "coder"],
    icon: "\uD83C\uDF9E",
    color: "#f97316",
  },
  {
    id: "process-optimizer",
    name: "Optimizador de procesos",
    description: "Analiza y optimiza procesos de desarrollo de software: CI/CD, testing, code review, flujos de trabajo.",
    category: "coding",
    tier: "utility",
    inputType: "text",
    outputType: "optimization_report",
    needsExternal: false,
    promptPath: "prompts/process-optimizer.md",
    references: ["prompts/references/inefficiency-patterns.md"],
    allowedRoles: ["agent", "coder"],
    icon: "\u2699",
    color: "#f97316",
  },
  {
    id: "version-management",
    name: "Gestión de versiones",
    description: "Asistente de Git: commits, branches, merge, conflictos, changelogs. Estrategias de branching y release.",
    category: "coding",
    tier: "utility",
    inputType: "text",
    outputType: "git_commands",
    needsExternal: false,
    promptPath: "prompts/version-management.md",
    references: [],
    allowedRoles: ["agent", "coder"],
    icon: "\uD83D\uDD00",
    color: "#f97316",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCRITURA — Creación de contenido textual
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "blog-writer",
    name: "Redactor de blogs",
    description: "Escribe artículos de blog estructurados, SEO-friendly y atractivos. Adaptable a tono y audiencia específica.",
    category: "writing",
    tier: "utility",
    inputType: "text",
    outputType: "blog_article",
    needsExternal: false,
    promptPath: "prompts/blog-writer.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCDD",
    color: "#ec4899",
  },
  {
    id: "seo-content-writer",
    name: "Redactor SEO",
    description: "Crea contenido optimizado para motores de búsqueda: keywords, meta tags, estructura, densidad semántica y readability.",
    category: "writing",
    tier: "utility",
    inputType: "text",
    outputType: "seo_content",
    needsExternal: true,
    promptPath: "prompts/seo-content-writer.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDD0D",
    color: "#ec4899",
  },
  {
    id: "content-strategy",
    name: "Estrategia de contenido",
    description: "Planifica calendarios editoriales, temas, formatos y distribución de contenido. Alineado con objetivos de negocio.",
    category: "writing",
    tier: "utility",
    inputType: "text",
    outputType: "content_plan",
    needsExternal: false,
    promptPath: "prompts/content-strategy.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83C\uDFAF",
    color: "#ec4899",
  },
  {
    id: "writing-plans",
    name: "Planificador de escritura",
    description: "Crea planes de escritura estructurados: outlines, puntos clave, flujo narrativo y estimaciones de longitud por sección.",
    category: "writing",
    tier: "utility",
    inputType: "text",
    outputType: "writing_plan",
    needsExternal: false,
    promptPath: "prompts/writing-plans.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCCB",
    color: "#ec4899",
  },
  {
    id: "paraphrase-humanized",
    name: "Parafraseo humanizado",
    description: "Parafrasea texto manteniendo el significado pero cambiando la estructura y vocabulario para que suene natural y no generado por IA.",
    category: "writing",
    tier: "utility",
    inputType: "text",
    outputType: "paraphrased_text",
    needsExternal: false,
    promptPath: "prompts/paraphrase-humanized.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83D\uDD04",
    color: "#ec4899",
  },
  {
    id: "transcreation-localization",
    name: "Transcreación y localización",
    description: "Adapta contenido entre idiomas y culturas, no solo traduce. Preserva tono, intención y referencias culturales.",
    category: "writing",
    tier: "utility",
    inputType: "text",
    outputType: "localized_content",
    needsExternal: false,
    promptPath: "prompts/transcreation-localization.md",
    references: ["prompts/references/cultural-adaptation-guide.md"],
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    icon: "\uD83C\uDF10",
    color: "#ec4899",
  },
  {
    id: "doc-coauthoring",
    name: "Coautoría de documentos",
    description: "Colabora en la escritura de documentos: mejora secciones, sugiere cambios, mantiene coherencia de voz y estilo.",
    category: "writing",
    tier: "utility",
    inputType: "text",
    outputType: "document_draft",
    needsExternal: false,
    promptPath: "prompts/doc-coauthoring.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    icon: "\uD83D\uDC65",
    color: "#ec4899",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DATOS — Análisis de datos y finanzas
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "finance",
    name: "Analista financiero",
    description: "Análisis financiero: estados contables, ratios, valuaciones, proyecciones. Interpreta datos de mercado y métricas clave.",
    category: "data",
    tier: "utility",
    inputType: "text_or_data",
    outputType: "financial_report",
    needsExternal: true,
    promptPath: "prompts/finance.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCB0",
    color: "#06b6d4",
  },
  {
    id: "stock-analysis-skill",
    name: "Análisis bursátil",
    description: "Análisis técnico y fundamental de acciones: tendencias, indicadores, riesgo/retorno. No constituye asesoría financiera.",
    category: "data",
    tier: "utility",
    inputType: "text_or_data",
    outputType: "stock_report",
    needsExternal: true,
    promptPath: "prompts/stock-analysis-skill.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCC8",
    color: "#06b6d4",
  },
  {
    id: "market-research-reports",
    name: "Investigación de mercado",
    description: "Elabora informes de investigación de mercado: tamaño, segmentación, competidores, tendencias y oportunidades.",
    category: "data",
    tier: "utility",
    inputType: "text",
    outputType: "market_report",
    needsExternal: true,
    promptPath: "prompts/market-research-reports.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCB3",
    color: "#06b6d4",
  },
  {
    id: "text-to-dashboard",
    name: "Texto a dashboard",
    description: "Convierte datos textuales en especificaciones de dashboard visual: KPIs, gráficos, layout y métricas clave.",
    category: "data",
    tier: "utility",
    inputType: "text_or_data",
    outputType: "dashboard_spec",
    needsExternal: false,
    promptPath: "prompts/text-to-dashboard.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83D\uDCCA",
    color: "#06b6d4",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIA — Imágenes, audio, video
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "image-understand",
    name: "Comprensión de imágenes",
    description: "Analiza imágenes: OCR, clasificación, descripción de contenido, detección de objetos y análisis de composición visual.",
    category: "media",
    tier: "utility",
    inputType: "image",
    outputType: "image_analysis",
    needsExternal: false,
    promptPath: "prompts/image-understand.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    icon: "\uD83D\uDDBC",
    color: "#f43f5e",
  },
  {
    id: "image-generation",
    name: "Generación de imágenes",
    description: "Genera imágenes a partir de descripciones textuales. Control de estilo, tamaño y parámetros artísticos.",
    category: "media",
    tier: "utility",
    inputType: "text",
    outputType: "generated_image",
    needsExternal: true,
    promptPath: "prompts/image-generation.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83C\uDFA8",
    color: "#f43f5e",
  },
  {
    id: "image-edit",
    name: "Edición de imágenes",
    description: "Edita imágenes existentes: variaciones, modificaciones visuales, transforms basadas en instrucciones textuales.",
    category: "media",
    tier: "utility",
    inputType: "image_and_text",
    outputType: "edited_image",
    needsExternal: true,
    promptPath: "prompts/image-edit.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\u270F\uFE0F",
    color: "#f43f5e",
  },
  {
    id: "video-understand",
    name: "Comprensión de video",
    description: "Analiza contenido de video: escenas, acciones, texto en pantalla, audio transcripción. Extrae información clave frame por frame.",
    category: "media",
    tier: "utility",
    inputType: "video",
    outputType: "video_analysis",
    needsExternal: true,
    promptPath: "prompts/video-understand.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador"],
    icon: "\uD83C\uDFAC",
    color: "#f43f5e",
  },
  {
    id: "podcast-generate",
    name: "Generador de podcasts",
    description: "Genera guiones y estructura de podcasts: introducción, segmentos, transiciones, preguntas y cierre.",
    category: "media",
    tier: "utility",
    inputType: "text",
    outputType: "podcast_script",
    needsExternal: false,
    promptPath: "prompts/podcast-generate.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83C\uDF99",
    color: "#f43f5e",
  },
  {
    id: "storyboard-manager",
    name: "Gestor de storyboard",
    description: "Crea storyboards para video o animación: escenas, planos, diálogos, indicaciones de cámara y timing.",
    category: "media",
    tier: "utility",
    inputType: "text",
    outputType: "storyboard",
    needsExternal: false,
    promptPath: "prompts/storyboard-manager.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83C\uDFAC",
    color: "#f43f5e",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCTIVIDAD — Gestión y optimización personal/laboral
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "learn",
    name: "Asistente de aprendizaje",
    description: "Facilita el aprendizaje de cualquier tema: explica conceptos complejos, crea ejercicios, repasa y evalúa comprensión.",
    category: "productivity",
    tier: "utility",
    inputType: "text",
    outputType: "learning_content",
    needsExternal: false,
    promptPath: "prompts/learn.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83C\uDF93",
    color: "#10b981",
  },
  {
    id: "cheat-sheet",
    name: "Generador de cheat sheets",
    description: "Genera hojas de referencia rápidas (cheat sheets) para cualquier tema: comandos, atajos, conceptos clave, sintaxis.",
    category: "productivity",
    tier: "utility",
    inputType: "text",
    outputType: "cheat_sheet",
    needsExternal: false,
    promptPath: "prompts/cheat-sheet.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83D\uDCCB",
    color: "#10b981",
  },
  {
    id: "mindfulness-meditation",
    name: "Mindfulness y meditación",
    description: "Guía sesiones de mindfulness y meditación: ejercicios de respiración, body scan, meditación guiada y técnicas de relajación.",
    category: "productivity",
    tier: "utility",
    inputType: "text",
    outputType: "wellness_guide",
    needsExternal: false,
    promptPath: "prompts/mindfulness-meditation.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    icon: "\uD83E\uDDD8",
    color: "#10b981",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EDUCACIÓN — Enseñanza y evaluación
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "quiz-mastery",
    name: "Generador de quizzes",
    description: "Crea quizzes personalizados: opción múltiple, verdadero/falso, completar, ordenar. Con feedback y explicaciones por pregunta.",
    category: "education",
    tier: "utility",
    inputType: "text",
    outputType: "quiz",
    needsExternal: false,
    promptPath: "prompts/quiz-mastery.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\u2753",
    color: "#6366f1",
  },
  {
    id: "study-buddy",
    name: "Compañero de estudio",
    description: "Compañero de estudio interactivo: explica temas, resuelve dudas, genera ejercicios prácticos y evalúa progreso.",
    category: "education",
    tier: "utility",
    inputType: "text",
    outputType: "study_session",
    needsExternal: false,
    promptPath: "prompts/study-buddy.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83D\uDCD6",
    color: "#6366f1",
  },
  {
    id: "quiz-html",
    name: "Quizzes HTML interactivos",
    description: "Genera quizzes como páginas HTML interactivas con estilos, animaciones y scoring automático.",
    category: "education",
    tier: "utility",
    inputType: "text",
    outputType: "html_quiz",
    needsExternal: false,
    promptPath: "prompts/quiz-html.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83C\uDF10",
    color: "#6366f1",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NEGOCIOS — Estrategia y carrera profesional
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "comm-advisor-camp",
    name: "Asesor de comunicación de campaña",
    description: "Asesora estrategias de comunicación para campañas políticas, sociales o corporativas. Mensajes clave, audiencias y timing.",
    category: "business",
    tier: "utility",
    inputType: "text",
    outputType: "campaign_strategy",
    needsExternal: false,
    promptPath: "prompts/comm-advisor-camp.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCE3",
    color: "#eab308",
  },
  {
    id: "crisis-comm-advisor",
    name: "Asesor de comunicación de crisis",
    description: "Gestiona comunicación en crisis: evaluación de severidad, mensajes clave, stakeholders y plan de acción por fases.",
    category: "business",
    tier: "utility",
    inputType: "text",
    outputType: "crisis_plan",
    needsExternal: false,
    promptPath: "prompts/crisis-comm-advisor.md",
    references: ["prompts/references/crisis-types.md"],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDEA8",
    color: "#eab308",
  },
  {
    id: "marketing-mode",
    name: "Modo marketing",
    description: "Asistente de marketing: copywriting, estrategia de marca, campañas, análisis de competencia y posicionamiento.",
    category: "business",
    tier: "utility",
    inputType: "text",
    outputType: "marketing_plan",
    needsExternal: false,
    promptPath: "prompts/marketing-mode.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCE2",
    color: "#eab308",
  },
  {
    id: "interview-designer",
    name: "Diseñador de entrevistas",
    description: "Diseña entrevistas estructuradas: preguntas por competencia, técnicas de entrevistas, guiones y criterios de evaluación.",
    category: "business",
    tier: "utility",
    inputType: "text",
    outputType: "interview_plan",
    needsExternal: false,
    promptPath: "prompts/interview-designer.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCAC",
    color: "#eab308",
  },
  {
    id: "interview-prep",
    name: "Preparación de entrevistas",
    description: "Prepara candidatos para entrevistas de trabajo: preguntas frecuentes, técnicas STAR, simulación y feedback.",
    category: "business",
    tier: "utility",
    inputType: "text",
    outputType: "prep_session",
    needsExternal: false,
    promptPath: "prompts/interview-prep.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    icon: "\uD83C\uDF93",
    color: "#eab308",
  },
  {
    id: "jd-resume-tailor",
    name: "Adaptador de CV a oferta laboral",
    description: "Adapta un currículum vitae a una descripción de puesto específica: highlights de experiencia, keywords y optimización ATS.",
    category: "business",
    tier: "utility",
    inputType: "documents",
    outputType: "tailored_resume",
    needsExternal: false,
    promptPath: "prompts/jd-resume-tailor.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    icon: "\uD83D\uDCCC",
    color: "#eab308",
  },
  {
    id: "resume-builder",
    name: "Constructor de CV",
    description: "Crea currículums profesionales desde cero: estructura, contenido, diseño y optimización para ATS y reclutadores.",
    category: "business",
    tier: "utility",
    inputType: "text",
    outputType: "resume",
    needsExternal: false,
    promptPath: "prompts/resume-builder.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "fast"],
    icon: "\uD83D\uDCC4",
    color: "#eab308",
  },
  {
    id: "job-intent-tracker",
    name: "Rastreador de intenciones laborales",
    description: "Analiza y rastrea intenciones de cambio laboral: señales de búsqueda activa, patrones de comportamiento y predicción de rotación.",
    category: "business",
    tier: "utility",
    inputType: "text",
    outputType: "intent_analysis",
    needsExternal: true,
    promptPath: "prompts/job-intent-tracker.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDD0D",
    color: "#eab308",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMUNICACIÓN — Presentaciones y comunicación efectiva
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "canvas-design",
    name: "Diseño de canvas",
    description: "Crea diseños de canvas/infografías: layouts, jerarquía visual, paletas de color y composición para presentaciones visuales.",
    category: "communication",
    tier: "utility",
    inputType: "text",
    outputType: "canvas_design",
    needsExternal: false,
    promptPath: "prompts/canvas-design.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83C\uDFA8",
    color: "#14b8a6",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DISEÑO — UI/UX y diseño visual
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "design",
    name: "Diseño visual general",
    description: "Asistente de diseño visual: composición, tipografía, color, layout. Crea especificaciones de diseño para cualquier medio.",
    category: "design",
    tier: "utility",
    inputType: "text",
    outputType: "design_spec",
    needsExternal: false,
    promptPath: "prompts/design.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83C\uDFAD",
    color: "#d946ef",
  },
  {
    id: "visual-design-foundations",
    name: "Fundamentos de diseño visual",
    description: "Enseña y aplica fundamentos de diseño: regla de tercios, jerarquía, balance, contraste, alineación, repetición y proximidad.",
    category: "design",
    tier: "utility",
    inputType: "text",
    outputType: "design_guide",
    needsExternal: false,
    promptPath: "prompts/visual-design-foundations.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83C\uDFA8",
    color: "#d946ef",
  },
  {
    id: "theme-factory",
    name: "Fábrica de temas",
    description: "Genera temas completos de diseño: paletas de color, tipografía, spacing, sombras y componentes UI coherentes.",
    category: "design",
    tier: "utility",
    inputType: "text",
    outputType: "theme_spec",
    needsExternal: false,
    promptPath: "prompts/theme-factory.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83C\uDFAE",
    color: "#d946ef",
  },
  {
    id: "ui-ux-pro-max",
    name: "UI/UX Pro Max",
    description: "Diseño avanzado de interfaces y experiencia de usuario: wireframes, flujos, accesibilidad, usabilidad y patrones de interacción.",
    category: "design",
    tier: "utility",
    inputType: "text",
    outputType: "ux_spec",
    needsExternal: false,
    promptPath: "prompts/ui-ux-pro-max.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83D\uDDA5",
    color: "#d946ef",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DOCUMENTOS — Generación de documentos de oficina
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "docx",
    name: "Generador de documentos Word",
    description: "Crea documentos .docx profesionales: informes, artículos, contratos. Formato, estilos y estructura de secciones.",
    category: "document",
    tier: "utility",
    inputType: "text",
    outputType: "docx_file",
    needsExternal: false,
    promptPath: "prompts/docx.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCC4",
    color: "#78716c",
  },
  {
    id: "pdf",
    name: "Generador de PDF",
    description: "Crea documentos PDF profesionales: reportes, facturas, certificados. Layout, tipografía y elementos gráficos.",
    category: "document",
    tier: "utility",
    inputType: "text",
    outputType: "pdf_file",
    needsExternal: false,
    promptPath: "prompts/pdf.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDFC4",
    color: "#78716c",
  },
  {
    id: "pptx",
    name: "Generador de presentaciones",
    description: "Crea presentaciones PowerPoint profesionales: slides, layouts, diagrams, notas del presentador y transiciones.",
    category: "document",
    tier: "utility",
    inputType: "text",
    outputType: "pptx_file",
    needsExternal: false,
    promptPath: "prompts/pptx.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\uD83D\uDCCA",
    color: "#78716c",
  },
  {
    id: "xlsx",
    name: "Generador de hojas de cálculo",
    description: "Crea hojas de cálculo Excel: tablas, fórmulas, gráficos, pivotes. Formato condicional y análisis de datos.",
    category: "document",
    tier: "utility",
    inputType: "text_or_data",
    outputType: "xlsx_file",
    needsExternal: false,
    promptPath: "prompts/xlsx.md",
    references: [],
    allowedRoles: ["agent", "estratega", "coder"],
    icon: "\uD83D\uDCC8",
    color: "#78716c",
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SEGURIDAD
  // ═══════════════════════════════════════════════════════════════════════════

  // (Las skills de OSINT como detect-coordinated-behavior y social-username-correlate
  //  ya cubren facets de seguridad. No se añaden skills adicionales de seguridad
  //  que no estén en la colección original.)

  // ═══════════════════════════════════════════════════════════════════════════
  // META / SISTEMA — Skills del sistema
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: "skill-creator",
    name: "Creador de skills",
    description: "Crea nuevas skills personalizadas a partir de una descripción del usuario. Genera el prompt, estructura y metadatos de la skill.",
    category: "meta",
    tier: "core",
    inputType: "text",
    outputType: "skill_definition",
    needsExternal: false,
    promptPath: "prompts/skill-creator.md",
    references: [],
    allowedRoles: ["agent", "estratega"],
    icon: "\u2728",
    color: "#64748b",
  },
  {
    id: "skill-finder-cn",
    name: "Buscador de skills",
    description: "Busca y descubre skills disponibles en el repositorio. Recomienda skills relevantes según la tarea del usuario.",
    category: "meta",
    tier: "utility",
    inputType: "text",
    outputType: "skill_recommendations",
    needsExternal: false,
    promptPath: "prompts/skill-finder-cn.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
    icon: "\uD83D\uDD0D",
    color: "#64748b",
  },
  {
    id: "task-review",
    name: "Revisión de tareas",
    description: "Revisa y evalúa tareas completadas. Identifica mejoras, errores y genera reportes de calidad del trabajo realizado.",
    category: "meta",
    tier: "utility",
    inputType: "text",
    outputType: "review_report",
    needsExternal: false,
    promptPath: "prompts/task-review.md",
    references: [],
    allowedRoles: ["agent", "estratega", "pensador", "coder"],
    icon: "\u2705",
    color: "#64748b",
  },
];

// ─── SKILL .MD CONTENT CACHE ──────────────────────────────────────────────
// Cache de contenido .md cargado para skills estáticas.
// Se popula lazy (al primera necesidad) o eagerly (al activar una skill).
const _mdContentCache = new Map(); // skillId → string (contenido del .md)

/**
 * Carga el contenido del .md de una skill estática y lo cachea en _mdContentCache
 * y en la propiedad _promptContent del objeto skill in-place.
 * Si la skill ya tiene _promptContent o es custom, no hace nada.
 * Si el fetch falla (archivo no existe), deja _promptContent vacío.
 *
 * @param {Object} skill - objeto de skill estática (de SKILLS array)
 * @returns {Promise<boolean>} true si se cargó contenido, false si no.
 */
async function loadSkillMdContent(skill) {
  if (skill._isCustom || !skill.promptPath || skill._promptContent) return false;
  if (_mdContentCache.has(skill.id)) {
    skill._promptContent = _mdContentCache.get(skill.id);
    return true;
  }
  try {
    const resp = await fetch(`/${skill.promptPath}`);
    if (!resp.ok) {
      console.warn(`[skillsRegistry] .md no encontrado: ${skill.promptPath}`);
      return false;
    }
    const content = await resp.text();
    const trimmed = content.trim();
    if (trimmed) {
      skill._promptContent = trimmed;
      _mdContentCache.set(skill.id, trimmed);
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`[skillsRegistry] Error cargando .md ${skill.promptPath}:`, e);
    return false;
  }
}

/**
 * Carga el contenido .md de un array de skills en paralelo.
 * @param {Array} skills
 * @returns {Promise<void>}
 */
async function loadSkillsMdContent(skills) {
  await Promise.all(skills.map(s => loadSkillMdContent(s)));
}

// ─── CUSTOM SKILLS (dinámicas desde D1) ─────────────────────────────────────

/** @type {Array} Skills personalizadas cargadas desde GET /api/skills */
let _customSkills = [];

/**
 * Carga las skills personalizadas del usuario desde el backend.
 * Debe llamarse al iniciar la app (en init o setupSettingsUI).
 *
 * @param {string} userSkillId (opcional) si se pasa, solo recarga esa skill.
 * @returns {Array} Lista de custom skills cargadas.
 */
async function loadCustomSkills(userSkillId) {
  try {
    const resp = await fetch("/api/skills");
    if (!resp.ok) {
      console.warn("[skillsRegistry] Error cargando custom skills:", resp.status);
      return _customSkills;
    }
    const data = await resp.json();
    _customSkills = (data.skills || []).map((s) => {
      return {
        id: s.id,
        name: s.name || "Sin nombre",
        description: s.description || "",
        category: s.category || "utility",
        tier: s.tier || "utility",
        inputType: s.inputType || "text",
        outputType: s.outputType || "analysis_report",
        needsExternal: !!s.needsExternal,
        promptPath: null,
        references: s.references || [],
        allowedRoles: s.allowedRoles || ["agent", "estratega", "pensador", "coder", "fast"],
        icon: s.icon || "\u2728",
        color: s.color || "#f59e0b",
        _isCustom: true,
        _promptContent: s._promptContent || "",
      };
    });
    return _customSkills;
  } catch (e) {
    console.warn("[skillsRegistry] Error cargando custom skills:", e);
    return _customSkills;
  }
}

/**
 * Agrega o reemplaza una custom skill en el cache local.
 * @param {Object} skill
 */
function mergeCustomSkill(skill) {
  const idx = _customSkills.findIndex((s) => s.id === skill.id);
  if (idx >= 0) {
    _customSkills[idx] = { ..._customSkills[idx], ...skill, _isCustom: true };
  } else {
    _customSkills.push({
      ...skill,
      category: skill.category || "utility",
      tier: skill.tier || "utility",
      inputType: skill.inputType || "text",
      outputType: skill.outputType || "analysis_report",
      needsExternal: !!skill.needsExternal,
      promptPath: null,
      references: skill.references || [],
      allowedRoles: skill.allowedRoles || ["agent", "estratega", "pensador", "coder", "fast"],
      icon: skill.icon || "\u2728",
      color: skill.color || "#f59e0b",
      _isCustom: true,
      _promptContent: skill._promptContent || "",
    });
  }
}

/**
 * Elimina una custom skill del cache local.
 * @param {string} skillId
 */
function removeCustomSkill(skillId) {
  _customSkills = _customSkills.filter((s) => s.id !== skillId);
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

const ALL_ROLES = ["agent", "coder", "estratega", "pensador", "fast"];

/**
 * Obtiene la lista completa de skills (estáticas + custom).
 * @returns {Array}
 */
function getAllSkills() {
  return [...SKILLS, ..._customSkills];
}

/**
 * Obtiene una skill por ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
function getSkillById(id) {
  return SKILLS.find((s) => s.id === id) || _customSkills.find((s) => s.id === id);
}

/**
 * Filtra skills por tier.
 * @param {string} tier
 * @returns {Array}
 */
function getSkillsByTier(tier) {
  return getAllSkills().filter((s) => s.tier === tier);
}

/**
 * Filtra skills por categoría.
 * @param {string} category
 * @returns {Array}
 */
function getSkillsByCategory(category) {
  return getAllSkills().filter((s) => s.category === category);
}

/**
 * Filtra skills por rol. Si el rol no existe o es null, devuelve todas.
 * @param {string} role
 * @returns {Array}
 */
function getSkillsForRole(role) {
  if (!role) return getAllSkills();
  return getAllSkills().filter(
    (s) => s.allowedRoles && s.allowedRoles.includes(role)
  );
}

/**
 * Devuelve solo las skills activas para un rol específico.
 * @param {Object} userSettings - state.settings del usuario.
 * @param {string} [role] - rol actual (agent, coder, estratega, etc.)
 * @returns {Array}
 */
function getActiveSkills(userSettings, role) {
  const enabledIds = userSettings?.skills?.enabled || [];
  let pool = getAllSkills().filter((s) => enabledIds.includes(s.id));
  // Filtrar por rol si se especifica.
  if (role) {
    pool = pool.filter((s) => s.allowedRoles && s.allowedRoles.includes(role));
  }
  return pool;
}

/**
 * Construye el bloque <veritas_skills> para inyectar en el system prompt.
 * Ahora es async porque carga contenido .md de skills estáticas.
 *
 * @param {Object} userSettings - state.settings del usuario.
 * @param {string} [role] - rol actual del modelo.
 * @param {string} [mode="auto"] - "auto" (Agente/Coder deciden usar)
 *   o "manual" (solo si el usuario lo solicita explícitamente).
 * @returns {Promise<string>} Texto a inyectar en el system prompt.
 */
async function buildSkillsPromptBlock(userSettings, role, mode = "auto") {
  const active = getActiveSkills(userSettings, role);
  if (active.length === 0) return "";

  // Cargar contenido .md para skills estáticas que aún no tengan _promptContent.
  await loadSkillsMdContent(active);

  const isManual = mode === "manual";
  const lines = [
    "",
    "<veritas_skills>",
    `El usuario tiene ${active.length} skill(s) activa(s) para el rol ${role || "todos"}.`,
    isManual
      ? "Solo debes usar una skill si el usuario la menciona explícitamente por nombre o si el contenido de su mensaje hace referencia directa a la skill. No apliques skills automáticamente."
      : "Cuando el contenido del usuario sea relevante para alguna de estas skills, actúa según sus directivas.",
    "",
  ];

  for (const skill of active) {
    const refNote = (skill.references && skill.references.length > 0)
      ? ` Referencias: ${skill.references.map(r => r.split("/").pop()).join(", ")}.`
      : "";
    const extNote = skill.needsExternal
      ? " [Requiere servicios externos de búsqueda/web — usa las tools disponibles si son aplicables.]"
      : "";

    lines.push(`  <skill id="${skill.id}">`);

    // Si la skill tiene _promptContent (custom o .md cargado), inyectar completo.
    if (skill._promptContent) {
      lines.push(`    Nombre: ${skill.name}`);
      lines.push(`    Descripción: ${skill.description}${refNote}${extNote}`);
      lines.push(`    Directiva:`);
      for (const pLine of skill._promptContent.split("\n")) {
        lines.push(`      ${pLine}`);
      }
    } else {
      // Fallback: solo nombre + descripción (el .md no estaba disponible).
      lines.push(`    ${skill.name}: ${skill.description}${refNote}${extNote}`);
    }

    lines.push(`  </skill>`);
    lines.push("");
  }

  lines.push("Instrucciones de comportamiento:");
  if (isManual) {
    lines.push("- Solo aplica una skill si el usuario la solicita o menciona explícitamente.");
    lines.push("- Si el usuario no menciona ninguna skill, responde normalmente.");
    lines.push("- Si aplica una skill, sigue su directiva y estructura de output.");
  } else {
    lines.push("- Identifica automáticamente cuál skill(s) aplica(n) según el input del usuario.");
    lines.push("- Si aplica una skill, sigue su directiva y estructura de output.");
    lines.push("- Si múltiples skills aplican, combínalas o prioriza la más relevante.");
  }
  lines.push("- Si ninguna skill aplica, responde normalmente con tu comportamiento estándar.");
  lines.push("</veritas_skills>");
  lines.push("");

  return lines.join("\n");
}

export {
  SKILLS,
  SKILLS_CATEGORIES,
  SKILLS_TIER,
  ALL_ROLES,
  getAllSkills,
  getSkillById,
  getSkillsByTier,
  getSkillsByCategory,
  getSkillsForRole,
  getActiveSkills,
  buildSkillsPromptBlock,
  loadSkillMdContent,
  loadSkillsMdContent,
  loadCustomSkills,
  mergeCustomSkill,
  removeCustomSkill,
};

export default {
  SKILLS,
  SKILLS_CATEGORIES,
  SKILLS_TIER,
  ALL_ROLES,
  getAllSkills,
  getSkillById,
  getSkillsByTier,
  getSkillsByCategory,
  getSkillsForRole,
  getActiveSkills,
  buildSkillsPromptBlock,
  loadSkillMdContent,
  loadSkillsMdContent,
  loadCustomSkills,
  mergeCustomSkill,
  removeCustomSkill,
};
