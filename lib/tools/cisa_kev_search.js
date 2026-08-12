// ==============================================================================
// Véritas v2.4 — /lib/tools/cisa_kev_search.js
// ==============================================================================
// Busca vulnerabilidades explotadas conocidas en CISA KEV (pública, sin key).
// Cache en memoria por 1 hora.
// ==============================================================================

const MAX_OUTPUT = 15000;
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 3600000; // 1 hora

export async function run(args) {
  const query = (args.query || args.cve || '').toLowerCase();
  const vendor = (args.vendor || '').toLowerCase();
  const limit = Math.min(Math.max(Math.floor(Number(args.limit)) || 20, 1), 50);

  try {
    // Obtener/actualizar cache
    if (!_cache || Date.now() - _cacheTs > CACHE_TTL) {
      const resp = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) return { success: false, error: 'CISA KEV HTTP ' + resp.status };
      const data = await resp.json();
      _cache = (data.vulnerabilities || []).map(function(v) {
        return {
          cveID: v.cveID || '',
          vendorProject: v.vendorProject || '',
          product: v.product || '',
          vulnerabilityName: v.vulnerabilityName || '',
          dateAdded: v.dateAdded || '',
          shortDescription: v.shortDescription || '',
          requiredAction: v.requiredAction || '',
          dueDate: v.dueDate || '',
          notes: v.notes || '',
        };
      });
      _cacheTs = Date.now();
    }

    let results = _cache;

    // Filtrar por query
    if (query) {
      results = results.filter(function(v) {
        return v.cveID.toLowerCase().includes(query) ||
          v.vulnerabilityName.toLowerCase().includes(query) ||
          v.shortDescription.toLowerCase().includes(query) ||
          v.product.toLowerCase().includes(query);
      });
    }

    // Filtrar por vendor
    if (vendor) {
      results = results.filter(function(v) {
        return v.vendorProject.toLowerCase().includes(vendor);
      });
    }

    const sliced = results.slice(0, limit);

    if (!sliced.length) {
      return { success: true, results: [], message: 'Sin resultados en CISA KEV.' };
    }

    let output = 'CISA KEV — ' + sliced.length + ' vulnerabilidades' + (query ? ' para "' + query + '"' : '') + ' (DB: ' + _cache.length + ' total)\n';
    sliced.forEach(function(v, i) {
      output += '\n#' + (i + 1) + ' ' + v.cveID + ' — ' + v.vulnerabilityName;
      if (v.vendorProject) output += '\n  Vendor: ' + v.vendorProject + ' | Producto: ' + v.product;
      output += '\n  Acción requerida: ' + v.requiredAction;
      if (v.dueDate) output += ' | Fecha límite: ' + v.dueDate;
      if (v.shortDescription) output += '\n  ' + v.shortDescription.slice(0, 200);
    });

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return { success: true, results: sliced, count: sliced.length, total: _cache.length, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
