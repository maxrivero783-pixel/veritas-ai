import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import jinaReader from '../services/jina_reader.js';

const MAX_OUTPUT_BYTES = 60_000;
const ALLOWED_ROLES = ['agent', 'estratega', 'pensador'];
const VALID_MODES = ['reader', 'search'];

export async function run(args, ctx) {
  const { env } = ctx;

  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate mode
  const { mode, url, query, count } = args || {};
  if (!mode || !VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" es requerido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }

  // Mode-specific validation
  if (mode === 'reader') {
    if (!url || typeof url !== 'string') {
      return { status: 'error', output: 'El modo "reader" requiere el argumento "url" (string).' };
    }
  }
  if (mode === 'search') {
    if (!query || typeof query !== 'string') {
      return { status: 'error', output: 'El modo "search" requiere el argumento "query" (string).' };
    }
  }

  // Validate count
  if (count !== undefined) {
    const c = Number(count);
    if (!Number.isInteger(c) || c < 1 || c > 10) {
      return { status: 'error', output: 'Argumento "count" debe ser entero entre 1 y 10.' };
    }
  }

  // Key check
  if (discoverKeys(env, 'jina_reader').length === 0) {
    return { status: 'error', output: 'Jina Reader no configurado. Agrega variables de entorno con prefijo JINA_READER_API_KEY.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'jina_reader');
    let payload;
    if (mode === 'reader') {
      payload = { url };
    } else {
      payload = { query, count: count || 5 };
    }

    const r = await jinaReader.callService({ endpoint: mode, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'jina_reader', index, 30_000, `HTTP ${r.status}`);
      return {
        status: 'error',
        output: `Jina Reader ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // Format output
    let content;
    if (mode === 'reader') {
      // Reader returns markdown content directly
      content = (typeof r.data === 'object' && r.data.content) ? r.data.content : (typeof r.data === 'string' ? r.data : r.raw || '');
    } else {
      // Search returns JSON results
      content = JSON.stringify(r.data, null, 2);
    }

    if (Buffer.byteLength(content, 'utf8') > MAX_OUTPUT_BYTES) {
      content = content.slice(0, MAX_OUTPUT_BYTES) + '\n\n[... truncado por límite de salida]';
    }

    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
