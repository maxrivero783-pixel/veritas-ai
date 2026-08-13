// ==============================================================================
// Véritas v2.7 — /lib/tools/cohere_infer.js
// ==============================================================================
// Inferencia auxiliar vía Cohere API v2. Usa key rotation.
// ==============================================================================

import { fetchT } from '../services/http.js';
import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';

export async function run(args = {}, ctx = {}) {
  if (!args.prompt) {
    return { status: 'error', output: 'Missing prompt' };
  }

  if (!discoverKeys(ctx.env, 'cohere').length) {
    return { status: 'error', output: 'Cohere no configurado.' };
  }

  const { key, index } = await getKey(ctx.env, 'cohere');

  const r = await fetchT('https://api.cohere.com/v2/chat', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model || 'command-a-03-2025',
      messages: [{ role: 'user', content: args.prompt }],
      temperature: args.temperature || 0.2,
    }),
  });

  const t = await r.text();

  if (r.status === 429 || r.status >= 500) {
    await markCooldown(ctx.env, 'cohere', index, 60000, `HTTP ${r.status}`);
  }

  if (!r.ok) {
    return { status: 'error', output: `Cohere HTTP ${r.status}: ${t.slice(0, 500)}` };
  }

  const d = JSON.parse(t);
  const output = (d.message?.content || []).map(x => x.text || '').join('') || t;

  return { status: 'ok', output };
}

export default { run };
