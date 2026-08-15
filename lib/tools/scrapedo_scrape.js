import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import scrapedo from '../services/scrapedo.js';

const MAX_OUTPUT_BYTES = 60_000;
const VALID_MODES = ['scrape', 'google'];
const VALID_OUTPUT = ['raw', 'markdown'];

export async function run(args, ctx) {
  const { env } = ctx;
  const { mode = 'scrape', url, query, render, geoCode, output, super_proxy, device } = args || {};

  if (!VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" inválido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }
  if (mode === 'scrape' && (!url || typeof url !== 'string')) {
    return { status: 'error', output: 'El modo "scrape" requiere "url" (string).' };
  }
  if (mode === 'google' && (!query || typeof query !== 'string')) {
    return { status: 'error', output: 'El modo "google" requiere "query" (string).' };
  }
  if (output && !VALID_OUTPUT.includes(output)) {
    return { status: 'error', output: `Argumento "output" inválido. Valores: ${VALID_OUTPUT.join(', ')}` };
  }

  if (discoverKeys(env, 'scrapedo').length === 0) {
    return { status: 'error', output: 'Scrape.do no configurado. Agrega SCRAPEDO_API_TOKEN_1 como secreto.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'scrapedo');
    const payload = mode === 'scrape'
      ? { url, render: Boolean(render), geoCode, output: output || 'markdown', super_proxy: Boolean(super_proxy), device }
      : { query };
    const r = await scrapedo.callService({ endpoint: mode, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'scrapedo', index, 60_000, `HTTP ${r.status}`);
      return { status: 'error', output: `Scrape.do ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown'}`, latency_ms: Date.now() - startTs };
    }
    let content = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
    if (content.length > MAX_OUTPUT_BYTES) content = content.slice(0, MAX_OUTPUT_BYTES) + '\n...[truncado]';
    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
