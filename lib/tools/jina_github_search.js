import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import jinaGithub from '../services/jina_github.js';

const MAX_OUTPUT_BYTES = 50_000;
const ALLOWED_ROLES = ['agent', 'coder', 'estratega'];
const VALID_MODES = ['search', 'readme'];
const VALID_SORTS = ['best_match', 'indexed', 'updated'];

export async function run(args, ctx) {
  const { env } = ctx;

  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Parse and validate mode
  const { query, owner, repo, mode = 'search', per_page, page, sort } = args || {};
  if (!VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" inválido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }

  // Mode-specific validation
  if (mode === 'readme') {
    if (!owner || typeof owner !== 'string') {
      return { status: 'error', output: 'El modo "readme" requiere el argumento "owner" (string).' };
    }
    if (!repo || typeof repo !== 'string') {
      return { status: 'error', output: 'El modo "readme" requiere el argumento "repo" (string).' };
    }
  }
  if (mode === 'search') {
    if (!query || typeof query !== 'string') {
      return { status: 'error', output: 'El modo "search" requiere el argumento "query" (string).' };
    }
  }

  // Validate per_page
  if (per_page !== undefined) {
    const p = Number(per_page);
    if (!Number.isInteger(p) || p < 1 || p > 30) {
      return { status: 'error', output: 'Argumento "per_page" debe ser entero entre 1 y 30.' };
    }
  }

  // Validate page
  if (page !== undefined) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1 || p > 5) {
      return { status: 'error', output: 'Argumento "page" debe ser entero entre 1 y 5.' };
    }
  }

  // Validate sort
  if (sort !== undefined && !VALID_SORTS.includes(sort)) {
    return { status: 'error', output: `Argumento "sort" inválido. Valores válidos: ${VALID_SORTS.join(', ')}` };
  }

  // Key check
  if (discoverKeys(env, 'jina_github').length === 0) {
    return { status: 'error', output: 'Jina GitHub no configurado. Agrega variables de entorno con prefijo JINA_GITHUB_API_KEY.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'jina_github');

    let payload;
    if (mode === 'readme') {
      payload = { owner, repo };
    } else {
      payload = { query };
      if (per_page) payload.per_page = Number(per_page);
      if (page) payload.page = Number(page);
      if (sort) payload.sort = sort;
    }

    const r = await jinaGithub.callService({ endpoint: mode, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'jina_github', index, 30_000, `HTTP ${r.status}`);
      return {
        status: 'error',
        output: `Jina GitHub ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`,
        latency_ms: Date.now() - startTs,
      };
    }

    // Format output
    let content;
    if (mode === 'readme') {
      content = (typeof r.data === 'object' && r.data.content)
        ? r.data.content
        : (typeof r.data === 'string' ? r.data : r.raw || '');
    } else {
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
