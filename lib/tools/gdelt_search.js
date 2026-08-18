// ==============================================================================
// Véritas v2.12 — /lib/tools/gdelt_search.js
// ==============================================================================
// Búsqueda en GDELT Project API (eventos globales, GKG, tendencias).
// API pública gratuita — SIN autenticación.
//
// Interfaz: export async function run(args, ctx)
//   args: { query, mode, maxrecords?, timespan?, format?, sort? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import gdelt from '../services/gdelt.js';

const MAX_OUTPUT_BYTES = 50_000;
const ALLOWED_ROLES = ['agent', 'estratega', 'pensador', 'fast'];
const VALID_MODES = ['events', 'gkg', 'trends'];
const VALID_FORMATS = ['json', 'html', 'csv'];
const VALID_SORTS = ['DateDesc', 'DateAsc', 'SizeDesc'];
const TIMESPAN_RE = /^\d+[dhm]$/;

export const usesKeyRotation = null;

export async function run(args, ctx) {
  const { env } = ctx;

  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate args
  const { query, mode, maxrecords, timespan, format, sort } = args || {};

  if (!query || typeof query !== 'string') {
    return { status: 'error', output: 'Argumento "query" es requerido y debe ser string.' };
  }

  if (!mode || !VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" es requerido y debe ser uno de: ${VALID_MODES.join(', ')}.` };
  }

  if (maxrecords !== undefined) {
    const n = Number(maxrecords);
    if (!Number.isInteger(n) || n < 1 || n > 250) {
      return { status: 'error', output: 'Argumento "maxrecords" debe ser entero entre 1 y 250.' };
    }
  }

  if (timespan !== undefined) {
    if (typeof timespan !== 'string' || !TIMESPAN_RE.test(timespan)) {
      return { status: 'error', output: 'Argumento "timespan" debe ser string con formato N[d|h|m] (ej: "1d", "7d", "30d").' };
    }
  }

  if (format !== undefined && !VALID_FORMATS.includes(format)) {
    return { status: 'error', output: `Argumento "format" debe ser uno de: ${VALID_FORMATS.join(', ')}.` };
  }

  if (sort !== undefined && !VALID_SORTS.includes(sort)) {
    return { status: 'error', output: `Argumento "sort" debe ser uno de: ${VALID_SORTS.join(', ')}.` };
  }

  // Build payload
  const payload = { query };
  if (maxrecords !== undefined) payload.maxrecords = Number(maxrecords);
  if (timespan !== undefined) payload.timespan = timespan;
  if (format !== undefined) payload.format = format;

  // mode-specific params
  if (mode === 'events') {
    if (sort !== undefined) payload.sort = sort;
  }

  // trends has its own maxrecords default
  if (mode === 'trends') {
    if (maxrecords === undefined) payload.maxrecords = 10;
    if (timespan === undefined) payload.timespan = '30d';
  }

  const startTs = Date.now();
  try {
    const r = await gdelt.callService({ endpoint: mode, payload, apiKey: null });

    if (r.status >= 400 || r.error) {
      return {
        status: 'error',
        output: `GDELT ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`,
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
