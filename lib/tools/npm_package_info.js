import { errorOutput, fetchJson, truncate } from "./_publicData.js";
export async function run(args = {}) {
  if (!args.package_name?.trim()) return { status: "error", output: "Missing package_name" };
  const response = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(args.package_name.trim())}`);
  if (!response.ok) return errorOutput("npm", response);
  const data = response.data || {}; const latest = data["dist-tags"]?.latest; const version = data.versions?.[latest] || {};
  return { status: "ok", output: truncate(`npm — ${data.name || args.package_name}@${latest || "N/D"}\n${"=".repeat(60)}\n${data.description || "Sin descripción"}\nLicencia: ${version.license || data.license || "N/D"}\nDependencias: ${Object.keys(version.dependencies || {}).slice(0, 30).join(", ") || "Ninguna"}\nHomepage: ${data.homepage || "N/D"}`) };
}
export default { run };
