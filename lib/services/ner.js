// ==============================================================================
// Véritas v2.12 — /lib/services/ner.js
// ==============================================================================
// Extracción local de entidades nombradas (NER) mediante patrones regex.
// No requiere API externa ni autenticación.
//
// Tipos soportados:
//   url, email, phone, ipv4, ipv6, date, hashtag, mention,
//   crypto_btc, crypto_eth, iban
// ==============================================================================

// -- Regex patterns -----------------------------------------------------------
const PATTERNS = {
  url: {
    re: /https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+/gi,
    label: 'URL',
  },
  email: {
    re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    label: 'Email',
  },
  phone: {
    // International formats: +XX ... with digits, spaces, hyphens, parens
    re: /(?:\+?\d[\d\s\-().]{6,}\d)|\b\d{3}[\-\s.]?\d{3}[\-\s.]?\d{4}\b/g,
    label: 'Phone',
  },
  ipv4: {
    re: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    label: 'IPv4',
  },
  ipv6: {
    re: /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,5}(?::[0-9a-fA-F]{1,4}){1,2}|(?:[0-9a-fA-F]{1,4}:){1,4}(?::[0-9a-fA-F]{1,4}){1,3}|(?:[0-9a-fA-F]{1,4}:){1,3}(?::[0-9a-fA-F]{1,4}){1,4}|(?:[0-9a-fA-F]{1,4}:){1,2}(?::[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:(?::[0-9a-fA-F]{1,4}){1,6}|:(?::[0-9a-fA-F]{1,4}){1,7}|::(?:ffff(?::0{1,4})?:)?(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)/g,
    label: 'IPv6',
  },
  date: {
    re: /\b\d{4}[-\/](?:0[1-9]|1[0-2])[-\/](?:0[1-9]|[12]\d|3[01])\b|\b(?:0[1-9]|[12]\d|3[01])[-\/](?:0[1-9]|1[0-2])[-\/]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}\b/gi,
    label: 'Date',
  },
  hashtag: {
    re: /#[\w]{1,139}/g,
    label: 'Hashtag',
  },
  mention: {
    re: /@[\w.]{1,80}/g,
    label: 'Mention',
  },
  crypto_btc: {
    re: /\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,39}|1[a-zA-Z0-9]{25,34}|3[a-zA-Z0-9]{25,34})\b/g,
    label: 'Bitcoin',
  },
  crypto_eth: {
    re: /\b0x[a-fA-F0-9]{40}\b/g,
    label: 'Ethereum',
  },
  iban: {
    re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,}\b/g,
    label: 'IBAN',
  },
};

const ALL_TYPES = Object.keys(PATTERNS);

// -- Dedup helper --------------------------------------------------------------
function dedup(arr) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const k = item.type + ':' + item.value.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

// -- Extract all entities from text --------------------------------------------
function extractAll(text, requestedTypes) {
  const types = (Array.isArray(requestedTypes) && requestedTypes.length > 0)
    ? requestedTypes.filter(t => PATTERNS[t])
    : ALL_TYPES;

  const entities = [];

  for (const type of types) {
    const pattern = PATTERNS[type];
    // Reset regex lastIndex
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(text)) !== null) {
      entities.push({
        type,
        label: pattern.label,
        value: match[0],
        index: match.index,
      });
      // Avoid infinite loops on zero-length matches
      if (match[0].length === 0) pattern.re.lastIndex++;
    }
  }

  // Sort by position in text, then deduplicate
  entities.sort((a, b) => a.index - b.index);
  return dedup(entities);
}

// ------------------------------------------------------------------------------
// callService: dispatcher
// Endpoints soportados:
//   "extract" → payload: { text: string, types?: string[] }
// ------------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case 'extract':
      return callExtract(payload);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown NER endpoint: ${endpoint}` };
  }
}

async function callExtract(payload) {
  const { text, types } = payload;

  if (!text || typeof text !== 'string') {
    return { status: 400, data: null, raw: null, error: 'Missing text' };
  }

  const entities = extractAll(text, types);

  const data = {
    entities,
    count: entities.length,
    types_detected: [...new Set(entities.map(e => e.type))],
  };

  return { status: 200, data, raw: null, error: null };
}

export default { callService };
