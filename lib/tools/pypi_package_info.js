// Véritas v2.4 — /lib/tools/pypi_package_info.js
// Consulta metadatos, licencia y compatibilidad de un paquete PyPI.
// API publica. No requiere keyRotator.

export async function run(args = {}) {
  if (!args.package_name?.trim()) return { success: false, error: 'Parametro "package_name" es obligatorio.' };
  const name = args.package_name.trim();

  let resp;
  try { resp = await fetch('https://pypi.org/pypi/' + encodeURIComponent(name) + '/json'); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  if (resp.status === 404) return { success: false, error: 'Paquete no encontrado en PyPI: ' + name };
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'PyPI HTTP ' + resp.status };

  const info = data?.info || {};
  let text = 'PyPI — ' + (info.name || name) + '@' + (info.version || 'N/D') + '\n' + '='.repeat(60) + '\n';
  text += (info.summary || 'Sin descripcion') + '\n\n';
  text += 'Licencia: ' + (info.license || 'N/D') + '\n';
  text += 'Python: ' + (info.requires_python || 'N/D') + '\n';
  text += 'Autor: ' + (info.author || 'N/D') + ' (' + (info.author_email || 'N/D') + ')\n';
  text += 'Proyecto: ' + (info.project_url || info.home_page || 'N/D') + '\n';
  if (info.classifiers?.length) {
    const devStatus = info.classifiers.filter(function(c) { return c.indexOf('Development Status') >= 0; });
    if (devStatus.length) text += 'Estado: ' + devStatus[0] + '\n';
  }

  return { success: true, output: text.trim() };
}
