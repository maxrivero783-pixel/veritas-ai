// ==============================================================================
// Véritas v2.4 — /lib/tools/sec_edgar_search.js
// ==============================================================================
// Consulta filings recientes de SEC EDGAR para empresas públicas estadounidenses.
// API pública, requiere User-Agent. rate limit: 10 req/seg.
// ==============================================================================

const MAX_OUTPUT = 12000;

export async function run(args, ctx) {
  const ticker = (args.ticker || '').toUpperCase().trim();
  const cik = args.cik;
  if (!ticker && !cik) return { success: false, error: 'Parametro "ticker" o "cik" es obligatorio.' };

  const agent = (ctx && ctx.env && ctx.env.SEC_USER_AGENT) || 'Véritas AI research veritas@ai.dev';

  try {
    // Resolver ticker a CIK si es necesario
    let resolvedCik = cik;
    if (!resolvedCik && ticker) {
      const mapResp = await fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: { 'User-Agent': agent, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (mapResp.ok) {
        const mapData = await mapResp.json();
        Object.values(mapData).forEach(function(entry) {
          if (entry.ticker && entry.ticker.toUpperCase() === ticker) resolvedCik = String(entry.cik_str);
        });
      }
    }
    if (!resolvedCik) return { success: false, error: 'Ticker/CIK no encontrado: ' + (ticker || cik) };

    const padCik = String(resolvedCik).padStart(10, '0');
    const resp = await fetch('https://data.sec.gov/submissions/CIK' + padCik + '.json', {
      headers: { 'User-Agent': agent, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { success: false, error: 'SEC EDGAR HTTP ' + resp.status };
    const data = await resp.json();

    const name = data.name || 'N/D';
    const filings = data.filings && data.filings.recent || {};
    const forms = filings.form || [];
    const dates = filings.filingDate || [];
    const docs = filings.primaryDocument || [];
    const limit = Math.min(forms.length, 15);

    let output = 'SEC EDGAR — ' + name + ' (CIK ' + padCik + ')
';
    const results = [];

    for (let i = 0; i < limit; i++) {
      const entry = {
        form: forms[i],
        date: dates[i],
        document: docs[i],
        url: 'https://www.sec.gov/Archives/edgar/data/' + padCik + '/' + docs[i],
      };
      results.push(entry);
      output += '
' + forms[i] + ' · ' + dates[i] + ' · ' + docs[i];
    }

    return { success: true, company: name, cik: padCik, results: results, count: results.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
