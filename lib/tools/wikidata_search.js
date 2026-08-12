import { clamp, errorOutput, fetchJson, lines, truncate } from "./_publicData.js";

export async function run(args = {}) {
  if (!args.query?.trim()) return { status: "error", output: "Missing query" };
  const language = /^[a-z]{2,3}$/i.test(args.language || "") ? args.language : "es";
  const url = new URL("https://www.wikidata.org/w/api.php");
  for (const [key, value] of Object.entries({ action: "wbsearchentities", format: "json", language, uselang: language, search: args.query.trim(), limit: String(clamp(args.limit, 10, 1, 50)), origin: "*" })) url.searchParams.set(key, value);
  const response = await fetchJson(url);
  if (!response.ok) return errorOutput("Wikidata", response);
  const output = lines(response.data?.search, (entity, index) =>
    `#${index + 1} ${entity.label || "Sin etiqueta"} (${entity.id})\n${entity.description || "Sin descripción"}\nURL: ${entity.concepturi || "N/D"}`
  );
  return { status: "ok", output: truncate(`Wikidata — ${args.query}\n${"=".repeat(60)}\n${output || "Sin resultados"}`) };
}

export default { run };
