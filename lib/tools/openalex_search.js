import { clamp, errorOutput, fetchJson, lines, truncate } from "./_publicData.js";

export async function run(args = {}, ctx = {}) {
  if (!args.query?.trim()) return { status: "error", output: "Missing query" };
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", args.query.trim());
  url.searchParams.set("per-page", clamp(args.limit, 5, 1, 25));
  if (ctx.env?.OPENALEX_MAILTO) url.searchParams.set("mailto", ctx.env.OPENALEX_MAILTO);
  const response = await fetchJson(url);
  if (!response.ok) return errorOutput("OpenAlex", response);
  const output = lines(response.data?.results, (work, index) =>
    `#${index + 1} ${work.display_name || "Sin título"} (${work.publication_year || "s/f"})\nDOI: ${work.doi || "N/D"} · Citas: ${work.cited_by_count || 0}\nFuente: ${work.primary_location?.source?.display_name || "N/D"}\nURL: ${work.id || "N/D"}`
  );
  return { status: "ok", output: truncate(`OpenAlex — ${args.query}\n${"=".repeat(60)}\n${output || "Sin resultados"}`) };
}

export default { run };
