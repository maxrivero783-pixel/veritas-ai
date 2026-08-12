import { clamp, errorOutput, fetchJson, lines, truncate } from "./_publicData.js";
export async function run(args = {}) {
  if (!args.query?.trim()) return { status: "error", output: "Missing query" };
  const url = new URL("https://hn.algolia.com/api/v1/search");
  url.searchParams.set("query", args.query.trim());
  url.searchParams.set("tags", args.tags || "story");
  url.searchParams.set("hitsPerPage", clamp(args.limit, 10, 1, 50));
  const response = await fetchJson(url);
  if (!response.ok) return errorOutput("Hacker News", response);
  const output = lines(response.data?.hits, (hit, index) => `#${index + 1} ${hit.title || hit.story_title || "Sin título"}\nPuntos: ${hit.points || 0} · Comentarios: ${hit.num_comments || 0} · Autor: ${hit.author || "N/D"}\nURL: ${hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`}`);
  return { status: "ok", output: truncate(`Hacker News — ${args.query}\n${"=".repeat(60)}\n${output || "Sin resultados"}`) };
}
export default { run };
