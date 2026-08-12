// ==============================================================================
// Véritas v2.3 — /lib/rateLimit.js
// ==============================================================================
// Helper compartido para detectar y reportar rate limits de APIs externas.
// Usado por GitHub tools (Gap 4) y Dropbox tools (Gap 6).
//
// Los tools llaman a checkRateLimit(response, provider) después de cada apiCall.
// Si el rate limit está agotado, devuelve un objeto con rateLimited=true que el
// tool puede usar para retornar un error estructurado al LLM.
//
// GitHub headers:  x-ratelimit-remaining, x-ratelimit-reset, x-ratelimit-limit,
//                  x-ratelimit-used
// Dropbox headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
// ==============================================================================

/**
 * Analiza los headers de rate limit de una respuesta HTTP.
 *
 * @param {Response} resp — Response de fetch()
 * @param {'github'|'dropbox'} provider
 * @returns {{ rateLimited: boolean, remaining: number|null, limit: number|null,
 *             resetAt: number|null, waitSeconds: number|null, used: number|null }}
 */
export function checkRateLimit(resp, provider) {
  if (!resp || !resp.headers) {
    return { rateLimited: false, remaining: null, limit: null, resetAt: null, waitSeconds: null, used: null };
  }

  const h = resp.headers;

  if (provider === 'github') {
    const remaining = parseInt(h.get('x-ratelimit-remaining'), 10);
    const resetAt = parseInt(h.get('x-ratelimit-reset'), 10);
    const limit = parseInt(h.get('x-ratelimit-limit'), 10);
    const used = parseInt(h.get('x-ratelimit-used'), 10);

    if (isNaN(remaining) || isNaN(resetAt)) {
      return { rateLimited: false, remaining: null, limit: null, resetAt: null, waitSeconds: null, used: null };
    }

    const now = Math.floor(Date.now() / 1000);
    const waitSeconds = Math.max(0, resetAt - now);

    // GitHub devuelve 403 o 429 cuando el rate limit se agota.
    const exhausted = (remaining <= 0) && (resp.status === 403 || resp.status === 429);

    return { rateLimited: exhausted, remaining, limit, resetAt, waitSeconds, used };
  }

  if (provider === 'dropbox') {
    const remaining = parseInt(h.get('x-ratelimit-remaining'), 10);
    const limit = parseInt(h.get('x-ratelimit-limit'), 10);
    const resetAt = parseInt(h.get('x-ratelimit-reset'), 10);

    if (isNaN(remaining)) {
      return { rateLimited: false, remaining: null, limit: null, resetAt: null, waitSeconds: null, used: null };
    }

    // Dropbox usa un formato de timestamp que puede ser epoch seconds o un string.
    let resetEpoch = resetAt;
    if (isNaN(resetEpoch) || resetAt === 0) {
      // Fallback: esperar un minuto por defecto.
      resetEpoch = Math.floor(Date.now() / 1000) + 60;
    }

    const now = Math.floor(Date.now() / 1000);
    const waitSeconds = Math.max(0, resetEpoch - now);

    // Dropbox devuelve 429 cuando el rate limit se agota.
    const exhausted = (remaining <= 0) && resp.status === 429;

    return { rateLimited: exhausted, remaining, limit, resetAt: resetEpoch, waitSeconds, used: null };
  }

  // Provider desconocido.
  return { rateLimited: false, remaining: null, limit: null, resetAt: null, waitSeconds: null, used: null };
}

/**
 * Genera un mensaje de error legible para el LLM cuando el rate limit está agotado.
 *
 * @param {'github'|'dropbox'} provider
 * @param {{ waitSeconds: number, remaining: number, limit: number, resetAt: number }} info
 * @param {string} action — descripción de la acción que falló (ej: "list_repos")
 * @returns {string}
 */
export function rateLimitErrorMessage(provider, info, action) {
  const providerLabel = provider === 'github' ? 'GitHub' : 'Dropbox';
  const waitMin = Math.ceil(info.waitSeconds / 60);
  const resetTime = new Date(info.resetAt * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return (
    `Rate limit agotado en ${providerLabel} para la acción "${action}".\n` +
    `Peticiones restantes: ${info.remaining}/${info.limit}.\n` +
    `El rate limit se resetea a las ${resetTime} (en ~${waitMin} minutos).\n` +
    `El usuario debe esperar antes de intentar más operaciones en ${providerLabel}.\n` +
    `Sugiere al usuario que espere o realice otra tarea mientras tanto.`
  );
}

/**
 * Retorna un objeto de resultado con status "rate_limited" para el tool caller.
 *
 * @param {'github'|'dropbox'} provider
 * @param {{ waitSeconds: number, remaining: number, limit: number, resetAt: number }} info
 * @param {string} action
 * @param {number} latencyMs
 * @returns {{ status: string, output: string, latency_ms: number, extra: object }}
 */
export function rateLimitResult(provider, info, action, latencyMs) {
  return {
    status: 'rate_limited',
    output: rateLimitErrorMessage(provider, info, action),
    latency_ms: latencyMs,
    extra: {
      rate_limited: true,
      provider,
      remaining: info.remaining,
      limit: info.limit,
      reset_at: info.resetAt,
      wait_seconds: info.waitSeconds,
    },
  };
}

export default { checkRateLimit, rateLimitErrorMessage, rateLimitResult };
