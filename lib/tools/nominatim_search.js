import { clamp, errorOutput, fetchJson, lines, truncate } from "./_publicData.js";
export async function run(args = {}) {
  if (!args.query?.trim()) return { status: "error", output: "Missing query" };
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2"); url.searchParams.set("q", args.query.trim());
  url.searchParams.set("limit", clamp(args.limit, 5, 1, 10));
  if (args.countrycodes) url.searchParams.set("countrycodes", args.countrycodes);
  const response = await fetchJson(url, { headers: { "User-Agent": "Veritas/2.4 research tool", Accept: "application/json" } });
  if (!response.ok) return errorOutput("Nominatim", response);
  const output = lines(response.data, (place, index) => `#${index + 1} ${place.display_name}\nLat/lon: ${place.lat}, ${place.lon} · Tipo: ${place.type} · Importancia: ${place.importance}`);
  return { status: "ok", output: truncate(`Nominatim — ${args.query}\n${"=".repeat(60)}\n${output || "Sin resultados"}`), extra: { results: response.data || [] } };
}
export default { run };
