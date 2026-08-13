import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.2 — /lib/services/dns.js
// ==============================================================================
// Adaptador HTTP para Google Public DNS (dns.google).
// API pública gratuita — NO requiere autenticación.
//
// Endpoints cubiertos:
//   - "resolve"    → GET https://dns.google/resolve?name=...&type=...
//   - "reversedns" → GET https://dns.google/resolve?name=...&type=PTR
//   - "dnssec"     → GET https://dns.google/resolve?name=...&type=...&do=true
// ==============================================================================

const DNS_BASE = 'https://dns.google/resolve';

export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case 'resolve':
      return callResolve(payload, false);
    case 'reversedns':
      return callReverseDNS(payload);
    case 'dnssec':
      return callResolve(payload, true);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown DNS endpoint: ${endpoint}` };
  }
}

// ------------------------------------------------------------------------------
// Standard DNS resolution (with optional DNSSEC validation)
// GET https://dns.google/resolve?name={domain}&type={type}[&do=true]
// ------------------------------------------------------------------------------
async function callResolve(payload, dnssec) {
  const { domain, record_type = 'A' } = payload;

  if (!domain || typeof domain !== 'string') {
    return { status: 400, data: null, raw: null, error: 'Missing domain' };
  }

  const safeType = sanitizeRecordType(record_type);

  let url = `${DNS_BASE}?name=${encodeURIComponent(domain)}`;
  url += `&type=${encodeURIComponent(safeType)}`;
  if (dnssec) url += '&do=true';

  const resp = await fetchT(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Reverse DNS lookup
// GET https://dns.google/resolve?name={ip}&type=PTR
// ------------------------------------------------------------------------------
async function callReverseDNS(payload) {
  const { domain, ip } = payload;

  // Accept either domain or ip field
  const target = ip || domain;
  if (!target || typeof target !== 'string') {
    return { status: 400, data: null, raw: null, error: 'Missing IP address (use domain or ip field)' };
  }

  let url = `${DNS_BASE}?name=${encodeURIComponent(target)}`;
  url += '&type=PTR';

  const resp = await fetchT(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { content: text }; }
  return { status: resp.status, data, raw: text };
}

// ------------------------------------------------------------------------------
// Sanitize record type to prevent injection
// ------------------------------------------------------------------------------
function sanitizeRecordType(type) {
  const ALLOWED = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'PTR', 'SRV', 'CAA', 'DNSKEY', 'DS'];
  const upper = String(type).toUpperCase();
  return ALLOWED.includes(upper) ? upper : 'A';
}

export default { callService };
