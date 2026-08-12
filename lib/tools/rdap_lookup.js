// Véritas v2.4 — /lib/tools/rdap_lookup.js
// Consulta RDAP publico para dominios, IPs y ASNs (WHOIS moderno).
// API publica. No requiere keyRotator.

const MAX_OUTPUT = 10000;

export async function run(args = {}) {
  if (!args.query?.trim()) return { success: false, error: 'Parametro "query" es obligatorio.' };
  const query = args.query.trim();
  const type = ['ip', 'autnum'].includes(args.type) ? args.type : 'domain';

  let resp;
  try {
    resp = await fetch('https://rdap.org/' + type + '/' + encodeURIComponent(query), {
      headers: { Accept: 'application/rdap+json', 'User-Agent': 'Véritas/2.4 OSINT tool' },
    });
  } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }

  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) {
    const msg = data?.description || data?.error || ('HTTP ' + resp.status);
    return { success: false, error: 'RDAP: ' + msg };
  }

  let text = 'RDAP — ' + query + ' (tipo: ' + type + ')\n' + '='.repeat(60) + '\n';
  text += 'Handle: ' + (data.handle || 'N/D') + '\n';
  text += 'Nombre: ' + (data.ldhName || data.name || 'N/D') + '\n';
  text += 'Estado: ' + ((data.status || []).join(', ') || 'N/D') + '\n';
  text += 'Tipo: ' + ((data.objectClassName || []).join(', ') || data.objectClassName || 'N/D') + '\n';

  if (data.entities?.length) {
    text += '\n-- Entidades --\n';
    data.entities.forEach(function(e) {
      const roles = (e.roles || []).join(', ');
      const name = e.vcardArray?.[1]?.find(function(v) { return v[0] === 'fn'; })?.[3] || e.handle || 'N/D';
      text += '  ' + name + ' (' + roles + ')\n';
    });
  }

  if (data.events?.length) {
    text += '\n-- Eventos --\n';
    data.events.forEach(function(e) {
      text += '  ' + (e.eventAction || 'N/D') + ': ' + (e.eventDate || 'N/D') + '\n';
    });
  }

  if (data.links?.length) text += '\nLinks: ' + data.links.map(function(l) { return l.value || l.href; }).join(', ') + '\n';

  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';
  return { success: true, output: text.trim() };
}
