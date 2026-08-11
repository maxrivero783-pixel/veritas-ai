// ==============================================================================
// Véritas v2.2 — /lib/tools/ner_extract.js
// ==============================================================================
// Extracción de entidades nombradas desde texto usando patrones locales.
// SIN autenticación, SIN key rotation.
//
// Interfaz: export async function run(args, ctx)
//   args: { text: string, types?: string[] }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import ner from '../services/ner.js';

const MAX_OUTPUT_BYTES = 30_000;
const MAX_TEXT_LENGTH = 10_000;
const ALLOWED_ROLES = ['agent', 'estratega', 'pensador'];
const VALID_TYPES = ['url', 'email', 'phone', 'ipv4', 'ipv6', 'date', 'hashtag', 'mention', 'crypto_btc', 'crypto_eth', 'iban'];

export const usesKeyRotation = null;

export async function run(args, ctx) {
  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate args
  const { text, types } = args || {};

  if (!text || typeof text !== 'string') {
    return { status: 'error', output: 'Argumento "text" es requerido y debe ser string.' };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    return { status: 'error', output: `Texto excede el máximo de ${MAX_TEXT_LENGTH.toLocaleString()} caracteres (recibido: ${text.length.toLocaleString()}).` };
  }

  if (types !== undefined) {
    if (!Array.isArray(types) || types.length === 0) {
      return { status: 'error', output: 'Argumento "types" debe ser un array no vacío de strings.' };
    }
    const invalid = types.filter(t => !VALID_TYPES.includes(t));
    if (invalid.length > 0) {
      return { status: 'error', output: `Tipos no soportados: ${invalid.join(', ')}. Válidos: ${VALID_TYPES.join(', ')}.` };
    }
  }

  const startTs = Date.now();
  try {
    const payload = { text };
    if (types) payload.types = types;

    const r = await ner.callService({ endpoint: 'extract', payload, apiKey: null });

    if (r.error) {
      return {
        status: 'error',
        output: `NER extraction failed: ${r.error}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const output = formatOutput(r.data);
    const outputBytes = Buffer.byteLength(output, 'utf8');

    if (outputBytes > MAX_OUTPUT_BYTES) {
      const truncated = output.slice(0, MAX_OUTPUT_BYTES);
      return {
        status: 'ok',
        output: truncated + '\n\n[... truncado por límite de salida]',
        latency_ms: Date.now() - startTs,
      };
    }

    return { status: 'ok', output, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

function formatOutput(data) {
  if (!data || !data.entities || data.entities.length === 0) {
    return 'No se encontraron entidades en el texto proporcionado.';
  }

  let out = `Entidades extraídas: ${data.count}\n`;
  out += `Tipos detectados: ${data.types_detected.join(', ')}\n`;
  out += `${'='.repeat(50)}\n\n`;

  // Group by type
  const grouped = {};
  for (const entity of data.entities) {
    if (!grouped[entity.type]) grouped[entity.type] = [];
    grouped[entity.type].push(entity);
  }

  for (const [type, items] of Object.entries(grouped)) {
    out += `[${items[0].label}] (${items.length})\n`;
    for (const item of items) {
      out += `  • ${item.value} (pos ${item.index})\n`;
    }
    out += '\n';
  }

  return out;
}

export default { run };
