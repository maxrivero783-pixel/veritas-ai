import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import gfw from '../services/gfw.js';

const MAX_OUTPUT_BYTES = 40_000;
const ALLOWED_ROLES = ['agent', 'estratega', 'pensador', 'fast'];

export async function run(args, ctx) {
  const { env } = ctx;

  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate args
  const { query, page, count } = args || {};
  if (!query || typeof query !== 'string') {
    return { status: 'error', output: 'Argumento "query" es requerido y debe ser string.' };
  }

  if (page !== undefined) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1 || p > 10) {
      return { status: 'error', output: 'Argumento "page" debe ser entero entre 1 y 10.' };
    }
  }

  if (count !== undefined) {
    const c = Number(count);
    if (!Number.isInteger(c) || c < 1 || c > 20) {
      return { status: 'error', output: 'Argumento "count" debe ser entero entre 1 y 20.' };
    }
  }

  // Key check
  if (discoverKeys(env, 'gfw').length === 0) {
    return { status: 'error', output: 'GFW no configurado. Agrega variables de entorno con prefijo GFW_API_KEY.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'gfw');
    const payload = { query };
    if (page) payload.page = Number(page);
    if (count) payload.count = Number(count);

    const r = await gfw.callService({ endpoint: 'search', payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'gfw', index, 30_000, `HTTP ${r.status}`);
      return {
        status: 'error',
        output: `GFW search failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`,
        latency_ms: Date.now() - startTs,
      };
    }

    let content = JSON.stringify(r.data, null, 2);
    if (Buffer.byteLength(content, 'utf8') > MAX_OUTPUT_BYTES) {
      content = content.slice(0, MAX_OUTPUT_BYTES) + '\n\n[... truncado por límite de salida]';
    }

    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
