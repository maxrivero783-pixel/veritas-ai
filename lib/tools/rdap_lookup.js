// ==============================================================================
// Véritas v2.4 — /lib/tools/rdap_lookup.js
// ==============================================================================
// Consulta RDAP público para dominios, IPs y ASNs (WHOIS moderno, pública).
// ==============================================================================

const MAX_OUTPUT = 10000;

export async function run(args) {
  const query = (args.query || '').trim();
  if (!query) return { success: false, error: 'Parametro "query" es obligatorio (dominio, IP o ASN).' };

  const type = ['ip', 'autnum'].includes(args.type) ? args.type : 'domain';

  try {
    const resp = await fetch('https://rdap.org/' + type + '/' + encodeURIComponent(query), {
      headers: { 'Accept': 'application/rdap+json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: 'RDAP HTTP ' + resp.status + ': ' + text.slice(0, 300) };
    }

    const data = await resp.json();

    let output = 'RDAP — ' + query + ' (' + type + ')
';
    if (data.handle) output += 'Handle: ' + data.handle + '
';
    if (data.ldhName) output += 'LDH: ' + data.ldhName + '
';
    if (data.name) output += 'Name: ' + data.name + '
';
    if (data.type) output += 'Tipo: ' + data.type + '
';
    if (data.status) output += 'Status: ' + data.status.join(', ') + '
';

    // Entidades (registrante, admin, etc.)
    if (data.entities && data.entities.length) {
      data.entities.forEach(function(ent) {
        if (ent.roles && ent.vcardArray && ent.vcardArray[1]) {
          let name = '';
          ent.vcardArray[1].forEach(function(v) {
            if (Array.isArray(v) && v[0] === 'fn') name = v[3];
          });
          if (name) output += '
' + ent.roles.join('/') + ': ' + name;
        }
      });
    }

    // IPs específicas
    if (data.ipVersion) output += '
IP Version: ' + data.ipVersion;
    if (data.startAddress) output += '
Rango: ' + data.startAddress + ' - ' + data.endAddress;

    // Fechas
    if (data.events && data.events.length) {
      data.events.forEach(function(ev) {
        if (ev.eventAction && ev.eventDate) output += '
' + ev.eventAction + ': ' + ev.eventDate;
      });
    }

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '
[... truncado]';

    return { success: true, raw: data, handle: data.handle, name: data.ldhName || data.name, status: data.status, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
