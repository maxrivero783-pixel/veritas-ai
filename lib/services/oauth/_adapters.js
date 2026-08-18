// ==============================================================================
// Véritas v2.12 — /lib/services/oauth/_adapters.js
// ==============================================================================
// Mapa ESTÁTICO de adaptadores OAuth (bundleable en Cloudflare Workers).
// v2.12i: los `import(`.../${provider}.js`)` dinámicos con template literal no
// se resuelven en el bundle del Worker ("No such module"), rompiendo el flujo
// OAuth en producción. Este mapa usa imports estáticos que el bundler sí traza.
// Para añadir un proveedor futuro: importar aquí y añadir la entrada al mapa.
// ==============================================================================

import github from "./github.js";

export const OAUTH_ADAPTERS = {
  github,
};

export function getOAuthAdapter(provider) {
  return OAUTH_ADAPTERS[provider] || null;
}

export default OAUTH_ADAPTERS;
