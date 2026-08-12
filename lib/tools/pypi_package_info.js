// ==============================================================================
// Véritas v2.4 — /lib/tools/pypi_package_info.js
// ==============================================================================
// Consulta metadatos, licencia y compatibilidad de un paquete PyPI (pública).
// ==============================================================================

const MAX_OUTPUT = 10000;

export async function run(args) {
  const name = args.name || args.package || args.query;
  if (!name) return { success: false, error: 'Parametro "name" es obligatorio (nombre del paquete PyPI).' };

  try {
    const resp = await fetch('https://pypi.org/pypi/' + encodeURIComponent(name) + '/json', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      return { success: false, error: 'Paquete no encontrado: ' + name + ' (HTTP ' + resp.status + ')' };
    }

    const data = await resp.json();
    const info = data.info || {};
    const releases = data.releases || {};
    const versions = Object.keys(releases).sort().reverse();

    let output = 'PyPI — ' + name;
    if (info.summary) output += '\n' + info.summary;
    output += '\nÚltima versión: ' + (info.version || 'N/D');
    if (info.license) output += ' | Licencia: ' + info.license;
    if (info.author) output += '\nAutor: ' + info.author;
    if (info.classifiers && info.classifiers.length) {
      const pythonVers = info.classifiers.filter(function(c) { return c.indexOf('Programming Language :: Python ::') === 0; });
      if (pythonVers.length) output += '\nPython: ' + pythonVers.map(function(c) { return c.split('::').pop().trim(); }).join(', ');
    }
    if (info.project_url) output += '\nWeb: ' + info.project_url;
    if (info.package_url) output += '\nPyPI: ' + info.package_url;
    if (info.requires_dist && info.requires_dist.length) {
      output += '\nDependencias (' + info.requires_dist.length + '): ' + info.requires_dist.slice(0, 20).join(', ');
      if (info.requires_dist.length > 20) output += ' +' + (info.requires_dist.length - 20) + ' más';
    }
    if (versions.length > 1) {
      output += '\nVersiones recientes: ' + versions.slice(0, 5).join(', ');
    }
    if (info.description && info.description.length > 100) {
      output += '\n\nDescripción (primeros 1000 chars):\n' + info.description.replace(/<[^>]*>/g, '').replace(/[#`=*_~]/g, '').slice(0, 1000);
    }

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return {
      success: true,
      package: name,
      version: info.version,
      license: info.license,
      summary: info.summary,
      author: info.author,
      python_versions: versions.slice(0, 10),
      dependencies: info.requires_dist || [],
      output: output,
    };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
