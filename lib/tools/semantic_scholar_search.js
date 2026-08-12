import { clamp, errorOutput, fetchJson, lines, truncate } from "./_publicData.js";

export async function run(args = {}, ctx = {}) {
  if (!args.query?.trim()) return { status: "error", output: "Missing query" };
  const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
  url.searchParams.set("query", args.query.trim());
  url.searchParams.set("limit", clamp(args.limit, 5, 1, 20));
  url.searchParams.set("fields", "title,year,authors,citationCount,url,abstract,venue");
  const headers = { Accept: "application/json" };
  const key = ctx.env?.SEMANTIC_SCHOLAR_API_KEY || ctx.env?.S2_API_KEY;
  if (key) headers["x-api-key"] = key;
  const response = await fetchJson(url, { headers });
  if (!response.ok) return errorOutput("Semantic Scholar", response);
  const output = lines(response.data?.data, (paper, index) =>
    `#${index + 1} ${paper.title || "Sin título"} (${paper.year || "s/f"})\nAutores: ${(paper.authors || []).slice(0, 5).map((author) => author.name).join(", ") || "N/D"}\nCitas: ${paper.citationCount || 0} · Venue: ${paper.venue || "N/D"}\nURL: ${paper.url || "N/D"}\n${paper.abstract ? `Resumen: ${paper.abstract.slice(0, 700)}` : ""}`
  );
  return { status: "ok", output: truncate(`Semantic Scholar — ${args.query}\n${"=".repeat(60)}\n${output || "Sin resultados"}`) };
}

export default { run };
