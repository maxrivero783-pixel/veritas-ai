// ==============================================================================
// Véritas v2.7 — /lib/tools/cerebras_infer.js
// ==============================================================================
// Inferencia auxiliar vía Cerebras API. Usa key rotation.
// ==============================================================================

import { fetchT } from '../services/http.js';
import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';

export async function run(args = {}, ctx = {}) {
  if (!args.prompt) {
    return { status: 'error', output: 'Missing prompt' };
  }

  if (!discoverKeys(ctx.env, 'cerebras').length) {
    return { status: 'error', output: 'Cerebras no configurado.' };
  }

  const { key, index } = await getKey(ctx.env, 'cerebras');

  const r = await fetchT('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model || 'llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: args.prompt }],
      temperature: args.temperature || 0.2,
    }),
  });

  const t = await r.text();

  if (r.status === 429 || r.status >= 500) {
    await markCooldown(ctx.env, 'cerebras', index, 60000, `HTTP ${r.status}`);
  }

  if (!r.ok) {
    return { status: 'error', output: `Cerebras HTTP ${r.status}: ${t.slice(0, 500)}` };
  }

  const d = JSON.parse(t);
  const output = d.choices?.[0]?.message?.content || t;

  return { status: 'ok', output };
}

export default { run };
