// ==============================================================================
// Véritas v2.7 — /lib/services/http.js
// ==============================================================================
// fetch con timeout obligatorio (AbortController). Ningún adaptador debe llamar
// a fetch() directo: un proveedor colgado no debe congelar el request del Worker
// (CPU time / duración 30s del free tier) ni impedir el fallback en cascada.
// ==============================================================================

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * fetch con timeout.
 * @param {string|URL} url
 * @param {object} [options]  - mismas opciones que fetch() + timeoutMs
 * @param {number} [options.timeoutMs] - timeout en ms (default 15000)
 * @returns {Promise<Response>}
 */
export async function fetchT(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: extSignal, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let removeExt = null;
  if (extSignal) {
    if (extSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      extSignal.addEventListener("abort", onAbort, { once: true });
      removeExt = () => extSignal.removeEventListener("abort", onAbort);
    }
  }
  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (removeExt) removeExt();
  }
}

export default { fetchT };
