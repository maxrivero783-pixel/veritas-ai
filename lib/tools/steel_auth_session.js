import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import steelAuth from '../services/steel_auth.js';

const MAX_OUTPUT_BYTES = 50_000;
const ALLOWED_ROLES = ['agent', 'pensador'];
const VALID_ACTIONS = ['create', 'scrape'];

export async function run(args, ctx) {
  const { env } = ctx;

  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate action
  const { action, session_id, url, proxy, geoLocation, headers, cookies, blockAds, fingerprint, extract } = args || {};
  if (!action || !VALID_ACTIONS.includes(action)) {
    return { status: 'error', output: `Argumento "action" es requerido. Valores válidos: ${VALID_ACTIONS.join(', ')}` };
  }

  // Action-specific validation
  if (action === 'scrape') {
    if (!session_id || typeof session_id !== 'string') {
      return { status: 'error', output: 'La acción "scrape" requiere el argumento "session_id" (string).' };
    }
    if (!url || typeof url !== 'string') {
      return { status: 'error', output: 'La acción "scrape" requiere el argumento "url" (string).' };
    }
  }

  // Key check
  if (discoverKeys(env, 'steel_auth').length === 0) {
    return { status: 'error', output: 'Steel Auth no configurado. Agrega variables de entorno con prefijo STEEL_AUTH_API_KEY.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'steel_auth');

    let payload;
    if (action === 'create') {
      payload = {};
      if (proxy) payload.proxy = proxy;
      if (geoLocation) payload.geoLocation = geoLocation;
      if (headers) payload.headers = headers;
      if (cookies) payload.cookies = cookies;
      if (blockAds !== undefined) payload.blockAds = Boolean(blockAds);
      if (fingerprint) payload.fingerprint = fingerprint;
    } else {
      payload = { session_id, url };
      if (extract) payload.extract = extract;
    }

    const r = await steelAuth.callService({ endpoint: action, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      const cd = (r.status === 401 || r.status === 403) ? 3600_000 : 30_000;
      await markCooldown(env, 'steel_auth', index, cd, `HTTP ${r.status}`);
      return {
        status: 'error',
        output: `Steel Auth ${action} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // Format output
    if (action === 'create') {
      const session = r.data;
      let output = `Sesión Steel Auth creada — ${Date.now() - startTs}ms\n`;
      output += `Session ID: ${session.id}\n`;
      output += `Status: ${session.status}\n`;
      if (session.wsEndpoint) output += `WebSocket endpoint: ${session.wsEndpoint}\n`;
      if (session.cdpUrl) output += `CDP URL: ${session.cdpUrl}\n`;
      output += `\nReutiliza session_id="${session.id}" en llamadas posteriores con action="scrape".`;

      return {
        status: 'ok',
        output,
        latency_ms: Date.now() - startTs,
        extra: { session_id: session.id },
      };
    }

    // Scrape mode
    const data = r.data;
    let content = (typeof data === 'object' && data.content)
      ? data.content
      : JSON.stringify(data, null, 2);

    if (Buffer.byteLength(content, 'utf8') > MAX_OUTPUT_BYTES) {
      content = content.slice(0, MAX_OUTPUT_BYTES) + '\n\n[... truncado por límite de salida]';
    }

    let output = `Steel Auth scrape de ${url} — ${Date.now() - startTs}ms\n`;
    output += `Session: ${session_id}\n`;
    if (data.title) output += `Título: ${data.title}\n`;
    if (data.statusCode) output += `HTTP: ${data.statusCode}\n`;
    output += `${'='.repeat(60)}\n${content}`;

    return {
      status: 'ok',
      output,
      latency_ms: Date.now() - startTs,
      extra: {
        session_id,
        url,
        title: data.title || null,
        size: (data.content || '').length,
      },
    };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
