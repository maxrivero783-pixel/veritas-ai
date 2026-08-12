// ==============================================================================
// Véritas v2.4 — /lib/tools/npm_package_info.js
// ==============================================================================
// Consulta metadatos, licencia y dependencias de un paquete npm (pública).
// ==============================================================================

const MAX_OUTPUT = 10000;

export async function run(args) {
  const name = args.name || args.package || args.query;
  if (!name) return { success: false, error: 'Parametro "name" es obligatorio (nombre del paquete npm).' };

  try {
    const resp = await fetch('https://registry.npmjs.org/' + encodeURIComponent(name).replace(/^%40/, '@'), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) {
      return { success: false, error: 'Paquete no encontrado: ' + name + ' (HTTP ' + resp.status + ')' };
    }

    const data = await resp.json();
    const latest = data['dist-tags'] && data['dist-tags'].latest;
    const latestVer = latest ? data.versions[latest] : null;

    let output = 'npm — ' + name;
    if (data.description) output += '\n' + data.description;
    output += '\nÚltima versión: ' + (latest || 'N/D');
    if (latestVer && latestVer.license) output += ' | Licencia: ' + latestVer.license;
    if (data.time && data.time[latest]) output += '\nPublicada: ' + data.time[latest];
    if (latestVer && latestVer.homepage) output += '\nWeb: ' + latestVer.homepage;
    if (latestVer && latestVer.repository && latestVer.repository.url) output += '\nRepo: ' + latestVer.repository.url.replace(/^git\+/, '');
    if (data.maintainers && data.maintainers.length) {
      output += '\nMaintainers: ' + data.maintainers.map(function(m) { return m.name; }).join(', ');
    }
    if (latestVer && latestVer.dependencies) {
      const deps = Object.keys(latestVer.dependencies);
      output += '\nDependencias (' + deps.length + '): ' + deps.slice(0, 20).join(', ');
      if (deps.length > 20) output += ' +' + (deps.length - 20) + ' más';
    }
    if (data.readme && data.readme.length > 200) {
      output += '\n\nREADME (primeros 1500 chars):\n' + data.readme.replace(/<[^>]*>/g, '').replace(/#\s*/g, '').slice(0, 1500);
    }

    if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + '\n[... truncado]';

    return {
      success: true,
      package: name,
      latest_version: latest,
      license: latestVer && latestVer.license,
      description: data.description,
      homepage: latestVer && latestVer.homepage,
      dependencies: latestVer && latestVer.dependencies ? Object.keys(latestVer.dependencies) : [],
      output: output,
    };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}
