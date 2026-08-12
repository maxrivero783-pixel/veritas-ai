// Véritas v2.4 — /lib/tools/sec_edgar_search.js
// Consulta filings recientes de SEC EDGAR para empresas publicas estadounidenses.
// API publica (requiere User-Agent). No requiere keyRotator.

const MAX_OUTPUT = 12000;

function pad(n) { return String(n).padStart(10, '0'); }

export async function run(args = {}, ctx = {}) {
  const ticker = (args.ticker || '').trim().toUpperCase();
  const cik = args.cik ? String(args.cik).trim() : null;
  if (!ticker && !cik) return { success: false, error: 'Parametro "ticker" o "cik" es obligatorio.' };

  const ua = ctx.env?.SEC_USER_AGENT || 'Véritas/2.4 research tool contact@example.com';
  const headers = { 'User-Agent': ua, Accept: 'application/json' };

  let resolvedCik = cik;
  if (!resolvedCik) {
    let tResp;
    try { tResp = await fetch('https://www.sec.gov/files/company_tickers.json', { headers }); } catch (e) { return { success: false, error: 'Error buscando ticker: ' + e.message }; }
    let tData;
    try { tData = await tResp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida al buscar ticker.' }; }
    const entry = Object.values(tData || {}).find(function(x) { return x.ticker?.toUpperCase() === ticker; });
    if (!entry) return { success: false, error: 'Ticker no encontrado en SEC: ' + ticker };
    resolvedCik = entry.cik_str;
  }

  let resp;
  try {
    resp = await fetch('https://data.sec.gov/submissions/CIK' + pad(resolvedCik) + '.json', { headers });
  } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'SEC EDGAR HTTP ' + resp.status };

  const d = data;
  const f = d.filings?.recent || {};
  const count = Math.min((f.form || []).length, 15);

  let text = 'SEC EDGAR — ' + (d.name || ticker) + '\n' + '='.repeat(60) + '\n';
  text += 'CIK: ' + pad(resolvedCik) + '\nSIC: ' + (d.sic || 'N/D') + ' — ' + (d.sicDescription || 'N/D') + '\n';
  text += 'Ticker: ' + (d.ticker || ticker) + '\nEstado: ' + (d.stateOfIncorporation || 'N/D') + '\n\n';
  text += '-- Ultimos filings --\n';
  for (let i = 0; i < count; i++) {
    const form = f.form?.[i] || 'N/D';
    const date = f.filingDate?.[i] || 'N/D';
    const doc = f.primaryDocument?.[i] || 'N/D';
    const link = 'https://www.sec.gov/Archives/edgar/data/' + resolvedCik + '/' + (f.accessionNumber?.[i] || '').replace(/-/g, '') + '/' + doc;
    text += (i + 1) + '. ' + form + ' · ' + date + ' · ' + doc + '\n   ' + link + '\n';
  }

  return { success: true, output: text.trim() };
}
