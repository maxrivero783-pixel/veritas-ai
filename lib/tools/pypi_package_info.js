import { errorOutput, fetchJson, truncate } from "./_publicData.js";
export async function run(args = {}) {
  if (!args.package_name?.trim()) return { status: "error", output: "Missing package_name" };
  const response = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(args.package_name.trim())}/json`);
  if (!response.ok) return errorOutput("PyPI", response);
  const info = response.data?.info || {};
  return { status: "ok", output: truncate(`PyPI — ${info.name || args.package_name}@${info.version || "N/D"}\n${"=".repeat(60)}\n${info.summary || "Sin descripción"}\nLicencia: ${info.license || "N/D"}\nPython: ${info.requires_python || "N/D"}\nProyecto: ${info.project_url || info.home_page || "N/D"}`) };
}
export default { run };
