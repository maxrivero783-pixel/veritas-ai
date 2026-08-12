// Véritas v2.4 — /lib/tools/nvd_cve_search.js
// Busca CVEs y detalles de severidad en NVD (NIST).
// API publica (mejor rate limit con API key opcional). No requiere keyRotator.

const MAX_OUTPUT = 15000;
function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}, ctx = {}) {
  const cve = (args.cve || '').trim();
  const keyword = (args.keyword || '').trim();
  if (!cve && !keyword) return { success: false, error: 'Parametro "cve" o "keyword" es obligatorio.' };

  const limit = clamp(args.limit, 10, 1, 20);
  const url = new URL('https://services.nvd.nist.gov/rest/json/cves/2.0');
  url.searchParams.set(cve ? 'cveId' : 'keywordSearch', cve || keyword);
  url.searchParams.set('resultsPerPage', String(limit));

  const headers = { Accept: 'application/json', 'User-Agent': 'Véritas/2.4 OSINT tool' };
  if (ctx.env?.NVD_API_KEY) headers['apiKey'] = ctx.env.NVD_API_KEY;

  let resp;
  try { resp = await fetch(url.toString(), { headers }); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'NVD HTTP ' + resp.status + ': ' + JSON.stringify(data).slice(0, 200) };

  const vulns = data?.vulnerabilities || [];
  if (!vulns.length) return { success: true, results: 0, output: 'NVD — sin resultados para: ' + (cve || keyword) };

  let text = 'NVD — ' + (cve || keyword) + '\n' + '='.repeat(60) + '\n';
  vulns.forEach(function(v, i) {
    const c = v.cve;
    const desc = c.descriptions?.find(function(d) { return d.lang === 'es'; }) || c.descriptions?.find(function(d) { return d.lang === 'en'; }) || {};
    const metrics = c.metrics;
    let severity = 'N/D';
    if (metrics?.cvssMetricV31?.length) {
      const cvss = metrics.cvssMetricV31[0].cvssData;
      severity = 'CVSS ' + (cvss.baseScore || 'N/D') + ' (' + (cvss.baseSeverity || 'N/D') + ')';
    } else if (metrics?.cvssMetricV2?.length) {
      severity = 'CVSS v2 ' + (metrics.cvssMetricV2[0].cvssData?.baseScore || 'N/D');
    }
    text += '#' + (i + 1) + ' ' + c.id + ' — ' + severity + '\n';
    text += (desc.value || 'Sin descripcion').slice(0, 300) + '\n\n';
  });
  if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n[... truncado]';

  return { success: true, results: vulns.length, output: text.trim() };
}
