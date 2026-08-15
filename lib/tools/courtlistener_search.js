import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import courtlistener from '../services/courtlistener.js';

const MAX_OUTPUT_BYTES = 50_000;
const VALID_TYPES = ['o', 'r', 'p'];
const VALID_MODES = ['search', 'opinion', 'citation'];

export async function run(args, ctx) {
  const { env } = ctx;
  const { mode = 'search', query, type, id, court, filed_after, filed_before, page_size } = args || {};

  if (!VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" inválido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }
  if (mode === 'search' && (!query || typeof query !== 'string')) {
    return { status: 'error', output: 'El modo "search" requiere "query" (string).' };
  }
  if (mode === 'opinion' && !id) {
    return { status: 'error', output: 'El modo "opinion" requiere "id" de la opinión.' };
  }
  if (mode === 'citation' && (!query || typeof query !== 'string')) {
    return { status: 'error', output: 'El modo "citation" requiere "query" con el texto de la cita.' };
  }
  if (type && !VALID_TYPES.includes(type)) {
    return { status: 'error', output: `Argumento "type" inválido. Valores: o (opiniones), r (RECAP/dockets), p (argumentos orales).` };
  }

  if (discoverKeys(env, 'courtlistener').length === 0) {
    return { status: 'error', output: 'CourtListener no configurado. Agrega COURTLISTENER_API_TOKEN_1 como secreto.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'courtlistener');
    let r;
    if (mode === 'search') {
      r = await courtlistener.callService({ endpoint: 'search', payload: { query, type: type || 'o', court, filed_after, filed_before, page_size }, apiKey: key });
    } else if (mode === 'opinion') {
      r = await courtlistener.callService({ endpoint: 'opinion', payload: { id }, apiKey: key });
    } else {
      r = await courtlistener.callService({ endpoint: 'citation', payload: { text: query }, apiKey: key });
    }

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'courtlistener', index, 60_000, `HTTP ${r.status}`);
      return { status: 'error', output: `CourtListener ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown'}`, latency_ms: Date.now() - startTs };
    }
    let content = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
    if (content.length > MAX_OUTPUT_BYTES) content = content.slice(0, MAX_OUTPUT_BYTES) + '\n...[truncado]';
    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
