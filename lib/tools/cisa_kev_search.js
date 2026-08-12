// Véritas v2.4 — /lib/tools/cisa_kev_search.js
// Busca vulnerabilidades explotadas conocidas en CISA Known Exploited Vulnerabilities.
// JSON feed publico. No requiere keyRotator.

const MAX_OUTPUT = 15000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  const query = (args.cve || args.query || '').trim().toLowerCase();
  const vendor = (args.vendor || '').trim().toLowerCase();
  const limit = clamp(args.limit, 20, 1, 50);

  let resp;
  try {
    resp = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {
      headers: { 'User-Agent': 'Véritas/2.4 OSINT tool' },
    });
  } catch (e) {
    return { success: false, error: 'Error de conexion a CISA: ' + e.message };
  }
  let data;
  try { data = await resp.json(); } catch (e) {
    return { success: false, error: 'Respuesta invalida de CISA.' };
  }
  if (!resp.ok) return { success: false, error: 'CISA HTTP ' + resp.status };

  let vulns = data?.vulnerabilities || [];
  if (query) vulns = vulns.filter(function(v) { return JSON.stringify(v).toLowerCase().includes(query); });
  if (vendor) vulns = vulns.filter(function(v) { return (v.vendorProject || '').toLowerCase().includes(vendor); });
  vulns = vulns.slice(0, limit);

  if (!vulns.length) return { success: true, results: 0, output: 'CISA KEV — sin resultados' + (query ? ' para: ' + query : '') };

  let text = 'CISA KEV — ' + vulns.length + ' vulnerabilidades explotadas\n' + '='.repeat(60) + '\n';
  vulns.forEach(function(v, i) {
    text += '#' + (i + 1) + ' ' + v.cveID + ' — ' + (v.vulnerabilityName || 'N/D') + '\n';
    text += 'Producto: ' + (v.vendorProject || 'N/D') + ' · Fecha agregado: ' + (v.dateAdded || 'N/D') + '\n';
    text += 'Accion requerida: ' + (v.requiredAction || 'N/D') + '\n';
    if (v.dueDate) text += 'Fecha limite: ' + v.dueDate + '\n';
    text += '\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';

  return { success: true, results: vulns.length, output: text.trim() };
}
