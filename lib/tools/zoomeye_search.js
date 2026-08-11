import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import zoomeye from '../services/zoomeye.js';

const MAX_OUTPUT_BYTES = 50_000;
const ALLOWED_ROLES = ['agent', 'estratega'];
const VALID_MODES = ['search', 'host', 'ip'];

export async function run(args, ctx) {
  const { env } = ctx;

  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate args
  const { query, mode, ip, page } = args || {};
  if (!query || typeof query !== 'string') {
    return { status: 'error', output: 'Argumento "query" es requerido y debe ser string.' };
  }
  if (!mode || !VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" es requerido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }
  if (mode === 'ip' && (!ip || typeof ip !== 'string')) {
    return { status: 'error', output: 'El modo "ip" requiere el argumento "ip".' };
  }
  if (page !== undefined) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1 || p > 10) {
      return { status: 'error', output: 'Argumento "page" debe ser entero entre 1 y 10.' };
    }
  }

  // Key check
  if (discoverKeys(env, 'zoomeye').length === 0) {
    return { status: 'error', output: 'ZoomEye no configurado. Agrega variables de entorno con prefijo ZOOMEYE_API_KEY.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'zoomeye');
    const payload = { query };
    if (ip) payload.ip = ip;
    if (page) payload.page = Number(page);

    const r = await zoomeye.callService({ endpoint: mode, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'zoomeye', index, 30_000, `HTTP ${r.status}`);
      return { status: 'error', output: `ZoomEye ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`, latency_ms: Date.now() - startTs };
    }

    let content = JSON.stringify(r.data, null, 2);
    if (content.length > MAX_OUTPUT_BYTES) content = content.slice(0, MAX_OUTPUT_BYTES);

    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
