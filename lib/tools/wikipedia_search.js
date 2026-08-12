import { clamp, errorOutput, fetchJson, lines, truncate } from "./_publicData.js";

export async function run(args = {}) {
  if (!args.query?.trim()) return { status: "error", output: "Missing query" };
  const language = /^[a-z]{2,3}$/i.test(args.language || "") ? args.language : "es";
  const url = new URL(`https://${language}.wikipedia.org/w/rest.php/v1/search/page`);
  url.searchParams.set("q", args.query.trim());
  url.searchParams.set("limit", clamp(args.limit, 5, 1, 20));
  const response = await fetchJson(url, { headers: { "User-Agent": "Veritas/2.4 research tool", Accept: "application/json" } });
  if (!response.ok) return errorOutput("Wikipedia", response);
  const output = lines(response.data?.pages, (page, index) =>
    `#${index + 1} ${page.title || "Sin título"}\n${page.description || ""}\n${(page.excerpt || "").replace(/<[^>]+>/g, "")}\nURL: https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.key || page.title || "")}`
  );
  return { status: "ok", output: truncate(`Wikipedia (${language}) — ${args.query}\n${"=".repeat(60)}\n${output || "Sin resultados"}`) };
}

export default { run };
