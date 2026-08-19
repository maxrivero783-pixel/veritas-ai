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
    // v2.12x: devolver resumen limpio (títulos/URLs/fragmentos), no el JSON crudo
    // (evita requestId/resolvedSearchType en el contexto y en la respuesta).
    const output = formatResults(mode, query, r.data);
    return { status: 'ok', output, latency_ms: Date.now() - startTs, extra: { mode, count: (r.data?.results || []).length } };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

// Normaliza la respuesta de Exa a markdown legible según el modo.
function formatResults(mode, query, data) {
  if (mode === 'answer') {
    return `Respuesta Exa: ${data?.answer || data?.text || '(sin respuesta)'}`;
  }
  if (mode === 'contents') {
    const items = data?.results || [];
    return items.map((r) => `## ${r.title || r.url}\n${r.text || ''}`).join('\n\n') || '(sin contenido)';
  }
  // search
  const results = data?.results || [];
  let out = `Búsqueda Exa para: "${query}"\n${'='.repeat(60)}\n`;
  if (!results.length) return out + '(sin resultados)\n';
  results.forEach((r, i) => {
    const snippet = (Array.isArray(r.highlights) && r.highlights.length)
      ? r.highlights.join(' … ')
      : (r.text || '').slice(0, 300);
    out += `${i + 1}. ${r.title || r.url}\n   URL: ${r.url}\n   ${snippet}\n\n`;
  });
  return out;
}

export default { run };
