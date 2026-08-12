import { clamp, errorOutput, fetchJson, lines, truncate } from "./_publicData.js";

export async function run(args = {}, ctx = {}) {
  if (!args.query?.trim()) return { status: "error", output: "Missing query" };
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", args.query.trim());
  url.searchParams.set("rows", clamp(args.rows, 5, 1, 20));
  if (ctx.env?.CROSSREF_MAILTO) url.searchParams.set("mailto", ctx.env.CROSSREF_MAILTO);
  const response = await fetchJson(url);
  if (!response.ok) return errorOutput("Crossref", response);
  const output = lines(response.data?.message?.items, (work, index) => {
    const year = work.issued?.["date-parts"]?.[0]?.[0] || "s/f";
    return `#${index + 1} ${(work.title || ["Sin título"])[0]} (${year})\nDOI: ${work.DOI || "N/D"} · Tipo: ${work.type || "N/D"}\nEditorial: ${work.publisher || "N/D"}\nURL: ${work.URL || "N/D"}`;
  });
  return { status: "ok", output: truncate(`Crossref — ${args.query}\n${"=".repeat(60)}\n${output || "Sin resultados"}`) };
}

export default { run };
