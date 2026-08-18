// ==============================================================================
// Véritas v2.12 — /lib/toolRouter.js
// ==============================================================================
// Tool routing (buenas prácticas 2026: "categories + keyword routing" para
// 10-30 tools). En vez de inyectar las 61 tools en cada request (anti-patrón:
// la precisión de selección cae con >10-15), selecciona el subconjunto
// relevante (5-15) según la consulta del usuario.
//
// routeTools(query, role, opts) → [{ name, score, category }] ordenado.
//   - Puntúa categorías por solapamiento de palabras clave (ES+EN).
//   - Puntúa tools por categoría + tags + tokens del nombre.
//   - Siempre garantiza un núcleo básico (web_search, scrape_url, wikipedia,
//     gdelt, exa) si el rol lo permite, y completa con los mejores matches.
// ==============================================================================

import { TOOL_REGISTRY_SERVER, isAllowed } from "./toolRegistry.server.js";
import { TOOL_CATEGORIES, TOOL_CATEGORY, TOOL_META, getToolCategory } from "./toolMeta.js";

const CORE_TOOLS = ["web_search", "scrape_url", "wikipedia_search", "gdelt_search", "exa_search"];

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // sin acentos para matching
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1);
}

// Puntúa cada categoría contra la consulta.
export function scoreCategories(query) {
  const qNorm = String(query || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const scores = {};
  for (const [cat, def] of Object.entries(TOOL_CATEGORIES)) {
    let score = 0;
    for (const kw of def.keywords || []) {
      const kwNorm = kw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (qNorm.includes(kwNorm)) score += kwNorm.split(" ").length > 1 ? 3 : 1;
    }
    scores[cat] = score;
  }
  return scores;
}

// Selecciona el subconjunto de tools relevantes para la consulta.
export function routeTools(query, role, opts = {}) {
  const { maxTools = 12, minTools = 5 } = opts;
  const qTokens = new Set(tokenize(query));
  const catScores = scoreCategories(query);

  const scored = [];
  for (const [name, tool] of Object.entries(TOOL_REGISTRY_SERVER)) {
    if (role && !isAllowed(name, role)) continue;
    const cat = getToolCategory(name);
    const meta = TOOL_META[name] || {};
    let score = catScores[cat] || 0;
    for (const tag of meta.tags || []) if (qTokens.has(String(tag).toLowerCase())) score += 2;
    for (const tok of name.split("_")) if (tok.length > 3 && qTokens.has(tok)) score += 2;
    scored.push({ name, score, category: cat });
  }
  scored.sort((a, b) => b.score - a.score);

  const byName = Object.fromEntries(scored.map((s) => [s.name, s]));
  const selected = [];
  const add = (name) => {
    if (byName[name] && !selected.some((s) => s.name === name)) selected.push(byName[name]);
  };

  // Núcleo básico siempre disponible (si el rol lo permite).
  for (const c of CORE_TOOLS) add(c);

  // Mejores matches con score > 0.
  for (const s of scored) {
    if (selected.length >= maxTools) break;
    if (s.score > 0) add(s.name);
  }

  // Si no llegamos al mínimo, completa con los mejor puntuados (aunque score 0).
  for (const s of scored) {
    if (selected.length >= minTools) break;
    add(s.name);
  }

  return selected.slice(0, maxTools);
}

export default { routeTools, scoreCategories, CORE_TOOLS };
