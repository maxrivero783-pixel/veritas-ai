// ==============================================================================
// Véritas v2.12 — /lib/quotaGuard.js
// ==============================================================================
// Guard de consentimiento para tools con cuota restringida en plan free
// (Apify, IntelX, Shodan). Cuando el modelo invoca una de estas tools SIN
// consentimiento previo, el guard devuelve un texto que instruye al modelo a:
//   1) advertir al usuario de la cuota restringida,
//   2) explicar los usos de la herramienta,
//   3) pedir autorización textual (sí/no),
// y solo tras la confirmación, reinvocar con consent:true.
// ==============================================================================

const QUOTA_CACHE_TTL_MS = 10 * 60 * 1000;
const _quotaCache = {}; // service -> { ts, pct }

// Consulta el % restante de cuota (best-effort, con caché). Devuelve null si no se puede saber.
async function quotaRemainingPct(service, apiKey) {
  const now = Date.now();
  const cached = _quotaCache[service];
  if (cached && now - cached.ts < QUOTA_CACHE_TTL_MS) return cached.pct;
  let pct = null;
  try {
    let url = null, headers = {};
    if (service === "shodan") {
      url = `https://api.shodan.io/api-info?key=${encodeURIComponent(apiKey)}`;
    } else if (service === "firecrawl") {
      url = "https://api.firecrawl.dev/v1/key";
      headers = { Authorization: `Bearer ${apiKey}` };
    } else if (service === "jina") {
      url = "https://api.jina.ai/v1/api-key/info";
      headers = { Authorization: `Bearer ${apiKey}` };
    }
    if (!url) return null;
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data) return null;
    if (service === "shodan") {
      const used = data.usage?.query_credits, limit = data.usage_limits?.query_credits;
      if (used != null && limit) pct = Math.round(((limit - used) / limit) * 100);
    } else if (service === "firecrawl") {
      const used = data.creditsUsed, limit = data.maxCredits;
      if (used != null && limit) pct = Math.round(((limit - used) / limit) * 100);
    } else if (service === "jina") {
      const used = data.used_credits ?? data.usedCredits, limit = data.total_credits ?? data.totalCredits;
      if (used != null && limit) pct = Math.round(((limit - used) / limit) * 100);
    }
  } catch { pct = null; }
  _quotaCache[service] = { ts: now, pct };
  return pct;
}

// Descripción breve de cada herramienta para el aviso al usuario.
const USOS = {
  apify_social: "extraer perfiles y publicaciones de redes sociales para análisis OSINT",
  apify_google_places: "consultar listings y datos de negocios en Google Maps",
  intelx_search: "buscar en datos filtrados, dark web y leaks (IntelX)",
  shodan_search: "buscar dispositivos, puertos y CVEs expuestos en internet (Shodan)",
};

function buildAdvertencia(service, uso, pctTxt) {
  return "[AUTORIZACION_REQUERIDA]\n" +
    "La herramienta " + service + " consume una cuota RESTRINGIDA en el plan gratuito. Su uso habitual: " + uso + ".\n" +
    "Antes de ejecutarla debes:\n" +
    "1) Advertir al usuario de que la cuota de " + service + " es limitada" + pctTxt + ".\n" +
    "2) Explicarle brevemente para qué se usaría en su petición actual.\n" +
    "3) Preguntarle textualmente si autoriza su uso (sí/no).\n" +
    "NO ejecutes la herramienta hasta que el usuario confirme explícitamente.\n" +
    "Cuando el usuario confirme, vuelve a invocarla con el argumento consent:true.";
}

/**
 * Comprueba si la tool requiere autorización.
 * @returns {null|string} null = puede ejecutarse; string = mensaje que debe devolver la tool
 */
// Mapeo tool -> servicio del rotador de keys (SERVICE_REGISTRY).
const TOOL_TO_SERVICE = {
  apify_social: "apify",
  apify_google_places: "apify",
  intelx_search: "intelx",
  shodan_search: "shodan",
};

export async function consentGate(service, args, ctx) {
  // Si el usuario ya autorizó explícitamente, se ejecuta.
  if (args && args.consent === true) return null;

  const svcName = TOOL_TO_SERVICE[service] || service;

  // Descubrir si hay key configurada (si no, la tool ya avisará por su cuenta).
  const { discoverKeys } = await import('./keyRotator.js');
  const keys = discoverKeys(ctx && ctx.env, svcName);
  if (!keys.length) return null; // sin key: la tool lanza su propio aviso de configuración

  // Consultar cuota con el nombre de servicio correcto (shodan -> api-info, etc.)
  let pctTxt = "";
  try {
    const pct = await quotaRemainingPct(svcName, keys[0].value);
    if (pct != null) pctTxt = " (queda aproximadamente " + pct + "%)";
  } catch { /* sin cuota */ }

  return buildAdvertencia(service, USOS[service] || "realizar consultas OSINT", pctTxt);
}

export default { consentGate };
