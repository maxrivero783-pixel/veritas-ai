import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import exa from '../services/exa.js';

const MAX_OUTPUT_BYTES = 50_000;
const VALID_MODES = ['search', 'contents', 'answer'];
const VALID_TYPES = ['auto', 'neural', 'keyword'];

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    mode = 'search', query, type, numResults, text, urls,
    startPublishedDate, endPublishedDate, includeDomains,
  } = args || {};

  if (!VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" inválido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }
  if (mode !== 'contents' && (!query || typeof query !== 'string')) {
    return { status: 'error', output: `El modo "${mode}" requiere "query" (string).` };
  }
  if (mode === 'contents' && (!Array.isArray(urls) || urls.length === 0)) {
    return { status: 'error', output: 'El modo "contents" requiere "urls" (array de URLs).' };
  }
  if (type && !VALID_TYPES.includes(type)) {
    return { status: 'error', output: `Argumento "type" inválido. Valores: ${VALID_TYPES.join(', ')}` };
  }

  if (discoverKeys(env, 'exa').length === 0) {
    return { status: 'error', output: 'Exa.ai no configurado. Agrega EXA_API_KEY_1 como secreto.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'exa');
    let r;
    if (mode === 'search') {
      r = await exa.callService({ endpoint: 'search', payload: { query, type: type || 'auto', numResults, text: Boolean(text), highlights: true, startPublishedDate, endPublishedDate, includeDomains }, apiKey: key });
    } else if (mode === 'contents') {
      r = await exa.callService({ endpoint: 'contents', payload: { urls }, apiKey: key });
    } else {
      r = await exa.callService({ endpoint: 'answer', payload: { query, text: true }, apiKey: key });
    }

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'exa', index, 60_000, `HTTP ${r.status}`);
      return { status: 'error', output: `Exa ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown'}`, latency_ms: Date.now() - startTs };
    }
    let content = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
    if (content.length > MAX_OUTPUT_BYTES) content = content.slice(0, MAX_OUTPUT_BYTES) + '\n...[truncado]';
    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
