// ==============================================================================
// Véritas v2.4 — /lib/tools/nvd_cve_search.js
// ==============================================================================
// Busca CVEs y detalles de severidad en NVD REST API v2.
// Funciona sin API key (rate limitado a 5 req/30s sin key, 50 con key).
// ==============================================================================

const MAX_OUTPUT = 15000;

export async function run(args, ctx) {
  const cve = args.cve;
  const keyword = args.keyword || args.query;
  if (!cve && !keyword) return { success: false, error: 'Parametro "cve" o "keyword" es obligatorio.' };

  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 10, 1), 20);

  try {
    const params = new URLSearchParams({ resultsPerPage: String(limit) });
    if (cve) {
      params.set('cveId', cve);
    } else {
      params.set('keywordSearch', keyword);
    }

    const headers = { 'Accept': 'application/json' };
    // NVD API key opcional para mayor rate limit
    const apiKey = ctx && ctx.env && (ctx.env.NVD_API_KEY || ctx.env.NVD_API_KEY_1);
    if (apiKey) headers['apiKey'] = apiKey;

    const resp = await fetch('https://services.nvd.nist.gov/rest/json/cves/2.0?' + params.toString(), {
      headers: headers,
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return { success: false, error: 'NVD HTTP ' + resp.status + ': ' + text.slice(0, 300) };
    }

    const data = await resp.json();
    const vulns = data.vulnerabilities || [];

    if (!vulns.length) {
      return { success: true, results: [], message: 'Sin resultados en NVD.' };
    }

    let output = 'NVD — ' + (cve || keyword) + ' (' + (data.totalResults || 0) + ' total)\n';
    const results = [];

    vulns.forEach(function(v, i) {
      const c = v.cve || {};
      const id = c.id || '';
      const desc = c.descriptions && c.descriptions.find(function(d) { return d.lang === 'es' || d.lang === 'en'; });
      const text = desc ? desc.value : '';
      const metrics = c.metrics || {};

      let severity = '';
      if (metrics.cvssMetricV31 && metrics.cvssMetricV31[0]) {
        const cvss = metrics.cvssMetricV31[0].cvssData;
        severity = 'CVSS ' + cvss.baseScore + ' (' + cvss.baseSeverity + ') ' + cvss.vectorString;
      } else if (metrics.cvssMetricV2 && metrics.cvssMetricV2[0]) {
        const cvss = metrics.cvssMetricV2[0].cvssData;
        severity = 'CVSS v2 ' + cvss.baseScore;
      }

      output += '\n#' + (i + 1) + ' ' + id;
      if (severity) output += ' | ' + severity;
      if (text) output += '\n  ' + text.slice(0, 300);

      results.push({ id: id, description: text.slice(0, 500), severity: severity });
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: results, count: results.length, total: data.totalResults || 0, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
