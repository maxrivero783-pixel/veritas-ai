// ==============================================================================
// Véritas v2.2 — /lib/tools/dns_lookup.js
// ==============================================================================
// Consulta DNS vía Google Public DNS API (dns.google/resolve).
// API pública gratuita — SIN autenticación.
//
// Interfaz: export async function run(args, ctx)
//   args: { domain, record_type?, mode? }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import dns from '../services/dns.js';

const MAX_OUTPUT_BYTES = 20_000;
const ALLOWED_ROLES = ['agent', 'estratega', 'pensador', 'fast'];
const VALID_RECORD_TYPES = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'PTR', 'SRV', 'CAA', 'DNSKEY', 'DS'];
const VALID_MODES = ['resolve', 'reversedns', 'dnssec'];

export const usesKeyRotation = null;

export async function run(args, ctx) {
  // Role check
  if (ctx.role && !ALLOWED_ROLES.includes(ctx.role)) {
    return { status: 'error', output: `Rol no permitido: ${ctx.role}. Requiere uno de: ${ALLOWED_ROLES.join(', ')}` };
  }

  // Validate args
  const { domain, record_type, mode = 'resolve' } = args || {};

  if (!domain || typeof domain !== 'string') {
    return { status: 'error', output: 'Argumento "domain" es requerido y debe ser string.' };
  }

  if (!VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" debe ser uno de: ${VALID_MODES.join(', ')}.` };
  }

  // For reversedns, record_type is forced to PTR
  if (mode === 'reversedns') {
    if (record_type && record_type !== 'PTR') {
      return { status: 'error', output: 'En modo "reversedns" el record_type se fuerza a PTR.' };
    }
  }

  if (record_type !== undefined && mode !== 'reversedns') {
    if (!VALID_RECORD_TYPES.includes(record_type)) {
      return { status: 'error', output: `Argumento "record_type" debe ser uno de: ${VALID_RECORD_TYPES.join(', ')}.` };
    }
  }

  // Build payload
  const payload = { domain };
  if (mode !== 'reversedns' && record_type) {
    payload.record_type = record_type;
  }
  // For reversedns, pass as ip field so service knows it's an IP
  if (mode === 'reversedns') {
    payload.ip = domain;
  }

  const startTs = Date.now();
  try {
    const r = await dns.callService({ endpoint: mode, payload, apiKey: null });

    if (r.status >= 400 || r.error) {
      return {
        status: 'error',
        output: `DNS ${mode} failed: HTTP ${r.status} - ${r.error || 'Unknown error'}`,
        latency_ms: Date.now() - startTs,
      };
    }

    const output = formatOutput(r.data, mode);
    const outputBytes = Buffer.byteLength(output, 'utf8');

    if (outputBytes > MAX_OUTPUT_BYTES) {
      return {
        status: 'ok',
        output: output.slice(0, MAX_OUTPUT_BYTES) + '\n\n[... truncado por límite de salida]',
        latency_ms: Date.now() - startTs,
      };
    }

    return { status: 'ok', output, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

function formatOutput(data, mode) {
  if (!data) return 'Sin datos de respuesta DNS.';

  // If it's not a Google DNS JSON response (has no 'Status' field), stringify raw
  if (data.Status === undefined) {
    return JSON.stringify(data, null, 2);
  }

  const statusLabels = {
    0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL',
    3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED',
  };
  const statusLabel = statusLabels[data.Status] || `UNKNOWN(${data.Status})`;

  let out = `DNS ${mode.toUpperCase()} — ${data.Name || '—'}\n`;
  out += `${'='.repeat(50)}\n`;
  out += `Status: ${statusLabel}\n`;
  if (data.Comment) out += `Comment: ${data.Comment}\n`;
  if (data.AD !== undefined) out += `Authenticated Data (DNSSEC): ${data.AD}\n`;
  if (data.CD !== undefined) out += `Checking Disabled: ${data.CD}\n`;
  if (data.RA !== undefined) out += `Recursion Available: ${data.RA}\n`;
  if (data.RD !== undefined) out += `Recursion Desired: ${data.RD}\n`;
  out += `\n`;

  // Answer section
  if (data.Answer && data.Answer.length > 0) {
    out += `Answer (${data.Answer.length} records):\n`;
    for (const rr of data.Answer) {
      out += `  ${rr.name} ${rr.TTL}s IN ${rr.type} → ${rr.data}\n`;
    }
    out += '\n';
  }

  // Authority section
  if (data.Authority && data.Authority.length > 0) {
    out += `Authority (${data.Authority.length} records):\n`;
    for (const rr of data.Authority) {
      out += `  ${rr.name} ${rr.TTL}s IN ${rr.type} → ${rr.data}\n`;
    }
    out += '\n';
  }

  // Additional section
  if (data.Additional && data.Additional.length > 0) {
    out += `Additional (${data.Additional.length} records):\n`;
    for (const rr of data.Additional) {
      out += `  ${rr.name} ${rr.TTL}s IN ${rr.type} → ${rr.data}\n`;
    }
  }

  if ((!data.Answer || data.Answer.length === 0) &&
      (!data.Authority || data.Authority.length === 0)) {
    out += '(sin registros en la respuesta)\n';
  }

  return out;
}

export default { run };
