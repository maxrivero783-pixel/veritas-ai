// ==============================================================================
// Véritas v2.2 — /lib/keyRotator.js
// ==============================================================================
// Servicio genérico de rotación de claves para pools de APIs externas.
// Diseñado extensible: cualquier servicio futuro se registra en SERVICE_REGISTRY
// y hereda rotación round-robin, cooldown ante rate-limits y telemetría sin
// tocar la lógica de negocio del router.
//
// NO cubre credenciales OAuth por usuario (esas viven en /lib/oauth.js).
//
// API pública:
//   - SERVICE_REGISTRY         : objeto con la configuración de cada servicio.
//   - listServices(env)        : devuelve los nombres de servicios con al menos
//                                una clave configurada en env.
//   - discoverKeys(env, svc)   : descubre dinámicamente las claves del servicio
//                                iterando <PREFIX>_API_KEY_1..N (tope 32).
//   - getKey(env, svc)         : devuelve { key, index, degraded } de la siguiente
//                                clave saludable (round-robin con cursor en D1).
//   - markCooldown(env, svc, idx, durationMs, err?)
//                              : marca una clave en cooldown (429/5xx).
//   - markHealthy(env, svc, idx): desmarca cooldown (200 OK).
//   - withKeyRotation(env, svc, fn)
//                              : envuelve fn(key) con reintento automático.
//   - getPoolStatus(env, svc)  : estado del pool para /api/keys/status (admin).
//   - forceHealthCheck(env, svc): recorre el pool y hace ping al quotaEndpoint.
//
// Estado persistido en D1:
//   - api_key_state  (PRIMARY KEY (service, key_index))
//   - api_key_cursor (PRIMARY KEY service)
// En caso de fallo de D1, fallback a estado en memoria por isolate (con TTL).
// ==============================================================================

/* global crypto */

// ------------------------------------------------------------------------------
// SERVICE_REGISTRY — configuración de cada servicio.
// Añadir aquí nuevos servicios sin tocar el resto del Worker.
// ------------------------------------------------------------------------------
export const SERVICE_REGISTRY = {
  openrouter: {
    secretPrefix: "OPENROUTER_API_KEY",     // wrangler secrets: OPENROUTER_API_KEY_1, _2, _N
    cooldownMs: 60_000,                       // 429 → 60s de cooldown
    maxRetries: 2,                            // reintentos con otra clave antes de fallar
    quotaEndpoint: "https://openrouter.ai/api/v1/key",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  // --- APIs de búsqueda ---
  jina: {
    secretPrefix: "JINA_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    quotaEndpoint: "https://api.jina.ai/v1/api-key/info",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  tavily: {
    secretPrefix: "TAVILY_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    // Tavily no tiene endpoint de cuota público; usamos un ping de búsqueda trivial.
    quotaEndpoint: "https://api.tavily.com/search",
    healthCheckMethod: "POST",
    healthCheckHeaders: () => ({ "Content-Type": "application/json" }),
    healthCheckBody: (key) => JSON.stringify({ api_key: key, query: "ping", max_results: 1 }),
  },
  serper: {
    secretPrefix: "SERPER_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    quotaEndpoint: "https://google.serper.dev/search",
    healthCheckMethod: "POST",
    healthCheckHeaders: (key) => ({ "X-API-KEY": key, "Content-Type": "application/json" }),
    healthCheckBody: () => JSON.stringify({ q: "ping" }),
  },
  // --- APIs de scraping / crawling / browser automation ---
  scrapingbee: {
    secretPrefix: "SCRAPINGBEE_API_KEY",
    cooldownMs: 60_000,
    maxRetries: 1,
    // ScrapingBee tiene /api/v1/usage pero requiere api_key en query.
    quotaEndpoint: "https://app.scrapingbee.com/api/v1/usage",
    healthCheckMethod: "GET",
    healthCheckHeaders: () => ({}),
    healthCheckQuery: (key) => ({ api_key: key }),
  },
  firecrawl: {
    secretPrefix: "FIRECRAWL_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 2,
    quotaEndpoint: "https://api.firecrawl.dev/v1/key",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  browser_use: {
    secretPrefix: "BROWSER_USE_API_KEY",
    cooldownMs: 60_000,                       // tasks largas, cooldown mayor
    maxRetries: 1,
    quotaEndpoint: "https://api.browser-use.com/api/v1/health",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  steel: {
    secretPrefix: "STEEL_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 2,
    quotaEndpoint: "https://api.steel.dev/v1/health",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ "steel-api-key": key }),
  },
  // --- Cloud scraping / crawling ---
  rover: {
    secretPrefix: "ROVER_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    quotaEndpoint: "https://api.rtrvr.ai/mcp",
    healthCheckMethod: "POST",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
    healthCheckBody: () => JSON.stringify({ jsonrpc: "2.0", method: "tools/list", params: {}, id: "ping" }),
  },
  spider_cloud: {
    secretPrefix: "SPIDER_CLOUD_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 2,
    // Spider Cloud no tiene endpoint de health; usamos un search trivial.
    quotaEndpoint: "https://api.spider.cloud/search",
    healthCheckMethod: "POST",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
    healthCheckBody: () => JSON.stringify({ query: "ping", limit: 1 }),
  },
  browserless: {
    secretPrefix: "BROWSERLESS_API_KEY",
    cooldownMs: 60_000,
    maxRetries: 1,
    // Browserless no tiene REST health simple; usamos /function con un ping.
    quotaEndpoint: "https://production-sfo.browserless.io/function",
    healthCheckMethod: "POST",
    healthCheckHeaders: (key) => ({ "Content-Type": "text/plain" }),
    // Para health check el token va en query, no en header.
    healthCheckQuery: (key) => ({ token: key }),
    healthCheckBody: () => "return 'ok';",
  },
  // --- OSINT: Apify actors ---
  apify: {
    secretPrefix: "APIFY_API_TOKEN",
    cooldownMs: 60_000,
    maxRetries: 1,
    // Apify no tiene health check REST simple; usamos GET /v2/acts con el token.
    quotaEndpoint: "https://api.apify.com/v2/acts",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  // --- Document & Audio Intelligence ---
  llamaparse: {
    secretPrefix: "LLAMA_CLOUD_API_KEY",
    cooldownMs: 60_000,
    maxRetries: 1,
    quotaEndpoint: "https://api.cloud.llamaindex.ai/api/v1/beta/files",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  assemblyai: {
    secretPrefix: "ASSEMBLYAI_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    // AssemblyAI: health check con GET /v2/transcript vacío.
    quotaEndpoint: "https://api.assemblyai.com/v2",
    healthCheckMethod: "GET",
    // NOTA: AssemblyAI usa la key RAW sin 'Bearer'.
    healthCheckHeaders: (key) => ({ Authorization: key }),
  },
  // --- Lote 1: OSINT de infraestructura ---
  shodan: {
    secretPrefix: "SHODAN_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    quotaEndpoint: "https://api.shodan.io/api-info?key=PLACEHOLDER",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({}),
    // Shodan no tiene health check dedicado; verificamos con API info.
    healthCheckQuery: (key) => ({ key }),
  },
  zoomeye: {
    secretPrefix: "ZOOMEYE_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    // ZoomEye usa JWT directamente (sin Bearer).
    quotaEndpoint: "https://api.zoomeye.org/resources-info",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `JWT ${key}` }),
  },
  intelx: {
    secretPrefix: "INTELX_API_KEY",
    cooldownMs: 60_000,
    maxRetries: 1,
    // IntelX: verificar con una búsqueda trivial.
    quotaEndpoint: "https://public.intelx.io/intelligent/search",
    healthCheckMethod: "POST",
    healthCheckHeaders: (key) => ({ "x-key": key, "Content-Type": "application/json" }),
    healthCheckBody: () => JSON.stringify({ term: "health_check_ping", maxresults: 1, timeout: 5 }),
  },
  // --- Lote 2: Búsqueda alternativa y lectura ---
  jina_reader: {
    secretPrefix: "JINA_READER_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    quotaEndpoint: "https://r.jina.ai/",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}`, Accept: "text/plain" }),
  },
  gfw: {
    secretPrefix: "GFW_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    quotaEndpoint: "https://api.gfw.tools/search",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
    healthCheckQuery: (key) => ({ q: "ping", n: 1 }),
  },
  // --- Lote 3: Código GitHub y sesiones autenticadas ---
  jina_github: {
    secretPrefix: "JINA_GITHUB_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 1,
    quotaEndpoint: "https://api.jina.ai/v1/github/search",
    healthCheckMethod: "POST",
    healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}`, "Content-Type": "application/json" }),
    healthCheckBody: () => JSON.stringify({ query: "test", per_page: 1 }),
  },
  steel_auth: {
    secretPrefix: "STEEL_AUTH_API_KEY",
    cooldownMs: 30_000,
    maxRetries: 2,
    // Steel auth: mismo health check que steel pero con key diferente.
    quotaEndpoint: "https://api.steel.dev/v1/health",
    healthCheckMethod: "GET",
    healthCheckHeaders: (key) => ({ "steel-api-key": key }),
  },
  brevo: { secretPrefix: "BREVO_API_KEY", cooldownMs: 60_000, maxRetries: 2, quotaEndpoint: "https://api.brevo.com/v3/account", healthCheckMethod: "GET", healthCheckHeaders: (key) => ({ "api-key": key }) },
  cohere: { secretPrefix: "COHERE_API_KEY", cooldownMs: 60_000, maxRetries: 1, quotaEndpoint: "https://api.cohere.com/v2/models", healthCheckMethod: "GET", healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }) },
  cerebras: { secretPrefix: "CEREBRAS_API_KEY", cooldownMs: 60_000, maxRetries: 1, quotaEndpoint: "https://api.cerebras.ai/v1/models", healthCheckMethod: "GET", healthCheckHeaders: (key) => ({ Authorization: `Bearer ${key}` }) },
  // Futuros servicios se añaden aquí sin tocar el core.
};

// ------------------------------------------------------------------------------
// Errores tipados
// ------------------------------------------------------------------------------
export class KeyPoolEmptyError extends Error {
  constructor(service) {
    super(`Key pool empty for service "${service}". Configure <PREFIX>_API_KEY_1 as wrangler secret.`);
    this.name = "KeyPoolEmptyError";
    this.service = service;
  }
}

export class AllKeysCooldownError extends Error {
  constructor(service, retryAfterMs) {
    super(`All keys for service "${service}" are in cooldown. Retry after ${retryAfterMs}ms.`);
    this.name = "AllKeysCooldownError";
    this.service = service;
    this.retryAfterMs = retryAfterMs;
  }
}

// ------------------------------------------------------------------------------
// Cache en memoria por isolate (fallback si D1 falla).
// Las entradas expiran tras MEMORY_TTL_MS.
// ------------------------------------------------------------------------------
const MEMORY_TTL_MS = 5 * 60_000; // 5 min
const _mem = new Map(); // key: `${svc}:${idx}` → { healthy, cooldownUntil, lastUsed, requests, errors, lastError, ts }

function memGet(svc, idx) {
  const k = `${svc}:${idx}`;
  const e = _mem.get(k);
  if (!e) return null;
  if (Date.now() - e.ts > MEMORY_TTL_MS) {
    _mem.delete(k);
    return null;
  }
  return e;
}

function memSet(svc, idx, entry) {
  _mem.set(`${svc}:${idx}`, { ...entry, ts: Date.now() });
}

// ------------------------------------------------------------------------------
// discoverKeys: itera <PREFIX>_API_KEY_1, _2, ..., _N hasta que una no exista.
// Tope en 32 para evitar loops infinitos si el admin se equivoca de patrón.
// Devuelve array de { index, key }.
// ------------------------------------------------------------------------------
const MAX_KEYS_PER_SERVICE = 32;

export function discoverKeys(env, serviceName) {
  const svc = SERVICE_REGISTRY[serviceName];
  if (!svc) throw new Error(`Unknown service: ${serviceName}`);

  const keys = [];
  for (let i = 1; i <= MAX_KEYS_PER_SERVICE; i++) {
    const val = env[`${svc.secretPrefix}_${i}`];
    if (typeof val !== "string" || val.length === 0) break;
    keys.push({ index: i, key: val });
  }
  return keys;
}

// ------------------------------------------------------------------------------
// listServices: devuelve los servicios con al menos una clave configurada.
// ------------------------------------------------------------------------------
export function listServices(env) {
  return Object.keys(SERVICE_REGISTRY).filter((s) => discoverKeys(env, s).length > 0);
}

// ------------------------------------------------------------------------------
// D1 helpers — todas las escrituras son UPSERT para evitar race conditions.
// ------------------------------------------------------------------------------
async function dbGetState(env, serviceName, idx) {
  try {
    const row = await env.DB.prepare(
      `SELECT healthy, cooldown_until, last_used, requests_count, errors_count, last_error
       FROM api_key_state WHERE service = ? AND key_index = ?`
    ).bind(serviceName, idx).first();
    return row;
  } catch (e) {
    // D1 falló; devolver null para que el caller haga fallback a memoria.
    return null;
  }
}

async function dbUpsertState(env, serviceName, idx, patch) {
  // INSERT OR REPLACE preserva los contadores si se proporcionan, si no, los lee primero.
  const existing = await dbGetState(env, serviceName, idx) || {};
  const healthy = patch.healthy !== undefined ? (patch.healthy ? 1 : 0) : (existing.healthy ?? 1);
  const cooldownUntil = patch.cooldownUntil !== undefined ? patch.cooldownUntil : (existing.cooldown_until ?? null);
  const lastUsed = patch.lastUsed !== undefined ? patch.lastUsed : (existing.last_used ?? null);
  const requests = (existing.requests_count ?? 0) + (patch.addRequests || 0);
  const errors = (existing.errors_count ?? 0) + (patch.addErrors || 0);
  const lastError = patch.lastError !== undefined ? patch.lastError : (existing.last_error ?? null);

  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO api_key_state
         (service, key_index, healthy, cooldown_until, last_used, requests_count, errors_count, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(serviceName, idx, healthy, cooldownUntil, lastUsed, requests, errors, lastError).run();
  } catch (e) {
    // D1 falló; actualizar memoria como fallback.
  }

  // Siempre actualizar memoria también (doble bookkeeping barato).
  memSet(serviceName, idx, {
    healthy: !!healthy,
    cooldownUntil: cooldownUntil,
    lastUsed: lastUsed,
    requests: requests,
    errors: errors,
    lastError: lastError,
  });
}

async function dbGetCursor(env, serviceName) {
  try {
    const row = await env.DB.prepare(
      `SELECT last_index FROM api_key_cursor WHERE service = ?`
    ).bind(serviceName).first();
    return row?.last_index ?? 0;
  } catch (e) {
    return 0;
  }
}

async function dbSetCursor(env, serviceName, idx) {
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO api_key_cursor (service, last_index, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`
    ).bind(serviceName, idx).run();
  } catch (e) {
    // no-op
  }
}

// ------------------------------------------------------------------------------
// getKey: devuelve la siguiente clave saludable con round-robin.
// ------------------------------------------------------------------------------
export async function getKey(env, serviceName) {
  const pool = discoverKeys(env, serviceName);
  if (pool.length === 0) throw new KeyPoolEmptyError(serviceName);

  const now = Date.now();
  const cursor = await dbGetCursor(env, serviceName);

  // Primera pasada: buscar saludable empezando en cursor+1.
  const healthyCandidates = [];
  const cooledCandidates = [];

  for (let offset = 1; offset <= pool.length; offset++) {
    const idx = ((cursor + offset - 1) % pool.length) + 1;
    const entry = pool.find((p) => p.index === idx);
    const state = await dbGetState(env, serviceName, idx);
    const memState = memGet(serviceName, idx);

    // Combinar estado D1 + memoria (memoria prevalece si es más fresca).
    const cooldownUntil = memState?.cooldownUntil ?? state?.cooldown_until ?? null;
    const healthy = memState?.healthy ?? (state?.healthy === 1) ?? true;

    if (healthy && (cooldownUntil === null || cooldownUntil <= now)) {
      healthyCandidates.push({ ...entry, state });
    } else if (cooldownUntil !== null) {
      cooledCandidates.push({ ...entry, cooldownUntil, state });
    } else {
      // Marcada unhealthy sin cooldown — la tratamos como cooldown corto.
      healthyCandidates.push({ ...entry, state });
    }
  }

  let chosen;
  if (healthyCandidates.length > 0) {
    chosen = healthyCandidates[0];
  } else if (cooledCandidates.length > 0) {
    // Todas en cooldown: devolver la de menor cooldown_until y marcar degraded.
    cooledCandidates.sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    chosen = { ...cooledCandidates[0], degraded: true };
  } else {
    const minRetry = Math.min(...cooledCandidates.map((c) => c.cooldownUntil - now));
    throw new AllKeysCooldownError(serviceName, Math.max(0, minRetry));
  }

  // Avanzar cursor al índice elegido.
  await dbSetCursor(env, serviceName, chosen.index);

  // Registrar last_used + incrementar requests_count.
  await dbUpsertState(env, serviceName, chosen.index, {
    lastUsed: now,
    addRequests: 1,
    healthy: true, // si estaba degraded por uso previo, la marcamos healthy de nuevo al seleccionarla
  });

  return {
    key: chosen.key,
    index: chosen.index,
    degraded: !!chosen.degraded,
  };
}

// ------------------------------------------------------------------------------
// markCooldown / markHealthy
// ------------------------------------------------------------------------------
export async function markCooldown(env, serviceName, idx, durationMs, errMsg) {
  const until = Date.now() + durationMs;
  await dbUpsertState(env, serviceName, idx, {
    healthy: false,
    cooldownUntil: until,
    addErrors: 1,
    lastError: errMsg ? String(errMsg).slice(0, 500) : null,
  });
}

export async function markHealthy(env, serviceName, idx) {
  await dbUpsertState(env, serviceName, idx, {
    healthy: true,
    cooldownUntil: null,
  });
}

// ------------------------------------------------------------------------------
// withKeyRotation: envuelve fn(key) con reintento automático.
// fn debe devolver un objeto Response (o algo con .status). Si status es 429 o
// 5xx, marca cooldown y reintenta con la siguiente clave. Si status es 200,
// marca healthy.
// Devuelve { response, keyIndex, attempts } o lanza AllKeysCooldownError.
// ------------------------------------------------------------------------------
export async function withKeyRotation(env, serviceName, fn) {
  const svc = SERVICE_REGISTRY[serviceName];
  if (!svc) throw new Error(`Unknown service: ${serviceName}`);

  const maxAttempts = svc.maxRetries + 1;
  let lastResponse = null;
  let lastKeyIndex = null;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attempts++;
    const { key, index, degraded } = await getKey(env, serviceName);
    lastKeyIndex = index;

    let response;
    try {
      response = await fn(key);
    } catch (e) {
      // Error de red (no HTTP): marcar cooldown corto y reintentar.
      await markCooldown(env, serviceName, index, svc.cooldownMs, e.message);
      lastResponse = null;
      if (attempt === maxAttempts) throw e;
      continue;
    }

    lastResponse = response;
    const status = response?.status ?? 0;

    if (status === 429 || status === 503) {
      // Rate limited o upstream unavailable — cooldown y reintento.
      const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
      const dur = retryAfter || svc.cooldownMs;
      await markCooldown(env, serviceName, index, dur, `HTTP ${status}`);
      if (attempt === maxAttempts) {
        // Último intento; devolvemos el response para que el caller decida.
        return { response, keyIndex: index, attempts, degraded: true };
      }
      continue;
    }

    if (status >= 500) {
      // Error de servidor — cooldown medio y reintento.
      await markCooldown(env, serviceName, index, Math.floor(svc.cooldownMs / 2), `HTTP ${status}`);
      if (attempt === maxAttempts) {
        return { response, keyIndex: index, attempts, degraded: true };
      }
      continue;
    }

    if (status >= 200 && status < 300) {
      await markHealthy(env, serviceName, index);
    } else if (status === 401 || status === 403) {
      // Auth error — clave probablemente inválida. Cooldown largo.
      await markCooldown(env, serviceName, index, svc.cooldownMs * 5, `HTTP ${status} auth`);
    }

    // Cualquier otro status (4xx no auth): devolver tal cual, no reintenta.
    return { response, keyIndex: index, attempts, degraded };
  }

  return { response: lastResponse, keyIndex: lastKeyIndex, attempts, degraded: true };
}

function parseRetryAfter(headerVal) {
  if (!headerVal) return null;
  const asNum = Number(headerVal);
  if (!Number.isNaN(asNum) && asNum > 0) {
    return asNum * 1000; // segundos → ms
  }
  const asDate = Date.parse(headerVal);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
}

// ------------------------------------------------------------------------------
// getPoolStatus: estado del pool para /api/keys/status (admin). Nunca expone
// el valor de las claves, solo índices y salud.
// ------------------------------------------------------------------------------
export async function getPoolStatus(env, serviceName) {
  const pool = discoverKeys(env, serviceName);
  if (pool.length === 0) {
    return { service: serviceName, keys: [], degraded: true, empty: true };
  }

  const now = Date.now();
  const keys = [];
  let anyHealthy = false;

  for (const { index } of pool) {
    const state = await dbGetState(env, serviceName, index) || {};
    const memState = memGet(serviceName, index);
    const cooldownUntil = memState?.cooldownUntil ?? state.cooldown_until ?? null;
    const healthy = memState?.healthy ?? (state.healthy === 1) ?? true;
    const inCooldown = cooldownUntil !== null && cooldownUntil > now;
    if (healthy && !inCooldown) anyHealthy = true;

    keys.push({
      index,
      healthy: healthy && !inCooldown,
      cooldown_until: cooldownUntil,
      cooldown_remaining_ms: inCooldown ? cooldownUntil - now : 0,
      last_used: state.last_used ?? null,
      requests_count: state.requests_count ?? 0,
      errors_count: state.errors_count ?? 0,
      last_error: state.last_error ?? null,
    });
  }

  return {
    service: serviceName,
    keys,
    degraded: !anyHealthy,
    empty: false,
  };
}

// ------------------------------------------------------------------------------
// forceHealthCheck: para cada clave del pool, hace una petición trivial al
// quotaEndpoint y actualiza su estado.
// ------------------------------------------------------------------------------
export async function forceHealthCheck(env, serviceName) {
  const svc = SERVICE_REGISTRY[serviceName];
  if (!svc) throw new Error(`Unknown service: ${serviceName}`);
  const pool = discoverKeys(env, serviceName);
  const results = [];

  for (const { index, key } of pool) {
    const start = Date.now();
    try {
      const url = new URL(svc.quotaEndpoint);
      const query = svc.healthCheckQuery ? svc.healthCheckQuery(key) : {};
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

      const resp = await fetch(url.toString(), {
        method: svc.healthCheckMethod,
        headers: svc.healthCheckHeaders(key),
        body: svc.healthCheckBody ? svc.healthCheckBody(key) : undefined,
      });

      const ok = resp.status >= 200 && resp.status < 300;
      if (ok) {
        await markHealthy(env, serviceName, index);
      } else if (resp.status === 401 || resp.status === 403) {
        await markCooldown(env, serviceName, index, svc.cooldownMs * 24, `health HTTP ${resp.status}`); // 1 día
      } else {
        await markCooldown(env, serviceName, index, svc.cooldownMs, `health HTTP ${resp.status}`);
      }
      results.push({ index, ok, status: resp.status, latency_ms: Date.now() - start });
    } catch (e) {
      await markCooldown(env, serviceName, index, svc.cooldownMs, `health error: ${e.message}`);
      results.push({ index, ok: false, status: 0, latency_ms: Date.now() - start, error: e.message });
    }
  }

  return { service: serviceName, results };
}

// ------------------------------------------------------------------------------
// resetCooldown: quita el cooldown manualmente (admin).
// ------------------------------------------------------------------------------
export async function resetCooldown(env, serviceName, idx) {
  await dbUpsertState(env, serviceName, idx, {
    healthy: true,
    cooldownUntil: null,
  });
}

// ------------------------------------------------------------------------------
// Export default para compatibilidad.
// ------------------------------------------------------------------------------
export default {
  SERVICE_REGISTRY,
  discoverKeys,
  listServices,
  getKey,
  markCooldown,
  markHealthy,
  withKeyRotation,
  getPoolStatus,
  forceHealthCheck,
  resetCooldown,
  KeyPoolEmptyError,
  AllKeysCooldownError,
};
