import { consentGate } from '../quotaGuard.js';
import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import intelx from '../services/intelx.js';

const MAX_OUTPUT_BYTES = 50_000;
const ALLOWED_ROLES = ['agent'];
const VALID_MODES = ['search', 'results', 'phonebook'];

export async function run(args, ctx) {
  // v2.7: autorización requerida por cuota restringida (plan free).
  const gateMsg = await consentGate('intelx_search', args, ctx);
  if (gateMsg) return { status: "ok", output: gateMsg, consent_required: true };
  const { env } = ctx;

  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate args
  const { query, mode, id, maxresults, limit } = args || {};
  if (!query || typeof query !== 'string') {
    return { status: 'error', output: 'Argumento "query" es requerido y debe ser string.' };
  }
  if (!mode || !VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" es requerido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }
  if (mode === 'results' && (!id || typeof id !== 'string')) {
    return { status: 'error', output: 'El modo "results" requiere el argumento "id".' };
  }
  if (maxresults !== undefined) {
    const m = Number(maxresults);
    if (!Number.isInteger(m) || m < 1 || m > 100) {
      return { status: 'error', output: 'Argumento "maxresults" debe ser entero entre 1 y 100.' };
    }
  }
  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1 || l > 100) {
      return { status: 'error', output: 'Argumento "limit" debe ser entero entre 1 y 100.' };
    }
  }

  // Key check
  if (discoverKeys(env, 'intelx').length === 0) {
    return { status: 'error', output: 'Intelligence X no configurado. Agrega variables de entorno con prefijo INTELX_API_KEY.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'intelx');
    const payload = { query };
    if (id) payload.id = id;
    if (maxresults) payload.maxresults = Number(maxresults);
    if (limit !== undefined) payload.limit = Number(limit);

    const r = await intelx.callService({ endpoint: mode, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'intelx', index, 30_000, `HTTP ${r.status}`);
      return { status: 'error', output: `IntelX ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`, latency_ms: Date.now() - startTs };
    }

    let content = JSON.stringify(r.data, null, 2);
    if (content.length > MAX_OUTPUT_BYTES) content = content.slice(0, MAX_OUTPUT_BYTES);

    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
