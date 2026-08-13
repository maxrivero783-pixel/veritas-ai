import { consentGate } from '../quotaGuard.js';
import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import shodan from '../services/shodan.js';

const MAX_OUTPUT_BYTES = 50_000;
const ALLOWED_ROLES = ['agent', 'estratega'];
const VALID_MODES = ['search', 'host', 'exploits'];

export async function run(args, ctx) {
  // v2.7: autorización requerida por cuota restringida (plan free).
  const gateMsg = await consentGate('shodan_search', args, ctx);
  if (gateMsg) return { status: "ok", output: gateMsg, consent_required: true };
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
  if (mode === 'host' && (!ip || typeof ip !== 'string')) {
    return { status: 'error', output: 'El modo "host" requiere el argumento "ip".' };
  }
  if (page !== undefined) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1 || p > 10) {
      return { status: 'error', output: 'Argumento "page" debe ser entero entre 1 y 10.' };
    }
  }

  // Key check
  if (discoverKeys(env, 'shodan').length === 0) {
    return { status: 'error', output: 'Shodan no configurado. Agrega variables de entorno con prefijo SHODAN_API_KEY.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'shodan');
    const payload = { query };
    if (ip) payload.ip = ip;
    if (page) payload.page = Number(page);

    const r = await shodan.callService({ endpoint: mode, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'shodan', index, 30_000, `HTTP ${r.status}`);
      return { status: 'error', output: `Shodan ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`, latency_ms: Date.now() - startTs };
    }

    let content = JSON.stringify(r.data, null, 2);
    if (content.length > MAX_OUTPUT_BYTES) content = content.slice(0, MAX_OUTPUT_BYTES);

    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
