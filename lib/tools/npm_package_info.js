// Véritas v2.4 — /lib/tools/npm_package_info.js
// Consulta metadatos, licencia y dependencias de un paquete npm.
// API publica. No requiere keyRotator.

export async function run(args = {}) {
  if (!args.package_name?.trim()) return { success: false, error: 'Parametro "package_name" es obligatorio.' };
  const name = args.package_name.trim();

  let resp;
  try { resp = await fetch('https://registry.npmjs.org/' + encodeURIComponent(name)); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  if (resp.status === 404) return { success: false, error: 'Paquete no encontrado en npm: ' + name };
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'npm HTTP ' + resp.status };

  const latest = data['dist-tags']?.latest || 'unknown';
  const ver = data.versions?.[latest] || {};
  const deps = Object.keys(ver.dependencies || {});
  const depsStr = deps.length ? deps.slice(0, 30).join(', ') : 'Ninguna';

  let text = 'npm — ' + (data.name || name) + '@' + latest + '\n' + '='.repeat(60) + '\n';
  text += (data.description || 'Sin descripcion') + '\n\n';
  text += 'Licencia: ' + (ver.license || data.license || 'N/D') + '\n';
  text += 'Ultima version: ' + latest + '\n';
  if (data.time?.[latest]) text += 'Publicada: ' + data.time[latest] + '\n';
  text += 'Dependencias (' + deps.length + '): ' + depsStr + '\n';
  text += 'Homepage: ' + (data.homepage || 'N/D') + '\n';
  text += 'Repo: ' + (data.repository?.url || 'N/D') + '\n';

  return { success: true, output: text.trim() };
}
