// ==============================================================================
// Véritas v2.12 — /lib/tools/web_search.js
// ==============================================================================
// Búsqueda web con fallback encadenado: Jina (s.jina.ai) → Tavily → Serper.
// El rotador de claves selecciona la siguiente clave saludable de cada pool.
//
// Interfaz: export async function run(args, ctx)
//   args: { query: string, max_results?: number }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from "../keyRotator.js";
import jina from "../services/jina.js";
import tavily from "../services/tavily.js";
import serper from "../services/serper.js";

export async function run(args, ctx) {
  const { env } = ctx;
  const { query, max_results = 5 } = args;
  if (!query) return { status: "error", output: "Missing 'query' argument." };

  const startTs = Date.now();
  const errors = [];

  // 1. Jina s.jina.ai
  if (discoverKeys(env, "jina").length > 0) {
    try {
      const { key, index } = await getKey(env, "jina");
      const r = await jina.callService({
        endpoint: "search",
        payload: { query, num: max_results },
        apiKey: key,
      });
      if (r.status === 200 && r.data) {
        const results = normalizeJina(r.data, max_results);
        return {
          status: "ok",
          output: formatResults("Jina", query, results),
          latency_ms: Date.now() - startTs,
          extra: { provider: "jina", count: results.length, key_index: index },
        };
      }
      await markCooldown(env, "jina", index, 30_000, `web_search HTTP ${r.status}`);
      errors.push(`jina: HTTP ${r.status}`);
    } catch (e) {
      errors.push(`jina: ${e.message}`);
    }
  }

  // 2. Tavily
  if (discoverKeys(env, "tavily").length > 0) {
    try {
      const { key, index } = await getKey(env, "tavily");
      const r = await tavily.callService({
        endpoint: "search",
        payload: { query, max_results, include_answer: true },
        apiKey: key,
      });
      if (r.status === 200 && r.data) {
        const results = normalizeTavily(r.data, max_results);
        return {
          status: "ok",
          output: formatResults("Tavily", query, results, r.data.answer),
          latency_ms: Date.now() - startTs,
          extra: { provider: "tavily", count: results.length, key_index: index },
        };
      }
      await markCooldown(env, "tavily", index, 30_000, `web_search HTTP ${r.status}`);
      errors.push(`tavily: HTTP ${r.status}`);
    } catch (e) {
      errors.push(`tavily: ${e.message}`);
    }
  }

  // 3. Serper
  if (discoverKeys(env, "serper").length > 0) {
    try {
      const { key, index } = await getKey(env, "serper");
      const r = await serper.callService({
        endpoint: "search",
        payload: { q: query, num: max_results },
        apiKey: key,
      });
      if (r.status === 200 && r.data) {
        const results = normalizeSerper(r.data, max_results);
        return {
          status: "ok",
          output: formatResults("Serper", query, results),
          latency_ms: Date.now() - startTs,
          extra: { provider: "serper", count: results.length, key_index: index },
        };
      }
      await markCooldown(env, "serper", index, 30_000, `web_search HTTP ${r.status}`);
      errors.push(`serper: HTTP ${r.status}`);
    } catch (e) {
      errors.push(`serper: ${e.message}`);
    }
  }

  return {
    status: "error",
    output: `Todos los proveedores de búsqueda fallaron para: "${query}".\nErrores: ${errors.join("; ")}. ` +
            `Verifica que al menos uno de los pools (JINA_API_KEY_1, TAVILY_API_KEY_1, SERPER_API_KEY_1) tenga claves configuradas.`,
    latency_ms: Date.now() - startTs,
  };
}

// ------------------------------------------------------------------------------
// Normalizadores por proveedor → formato común { title, url, snippet, score? }
// ------------------------------------------------------------------------------
function normalizeJina(data, max) {
  const results = data.data || data.results || [];
  return results.slice(0, max).map((r, i) => ({
    title: r.title || "(sin título)",
    url: r.url || r.link || "",
    snippet: (r.content || r.description || r.snippet || "").slice(0, 500),
    score: r.score || (1 - i * 0.05),
  }));
}

function normalizeTavily(data, max) {
  if (!data.results) return [];
  return data.results.slice(0, max).map((r, i) => ({
    title: r.title || "(sin título)",
    url: r.url || "",
    snippet: (r.content || r.snippet || "").slice(0, 500),
    score: r.score || (1 - i * 0.05),
  }));
}

function normalizeSerper(data, max) {
  const out = [];
  if (data.knowledgeGraph) {
    out.push({
      title: data.knowledgeGraph.title || "(sin título)",
      url: data.knowledgeGraph.website || "",
      snippet: (data.knowledgeGraph.description || "").slice(0, 500),
      score: 1.0,
    });
  }
  if (data.organic) {
    for (const r of data.organic.slice(0, max)) {
      out.push({
        title: r.title || "(sin título)",
        url: r.link || "",
        snippet: (r.snippet || "").slice(0, 500),
        score: 1 - (r.position || 0) * 0.05,
      });
    }
  }
  return out.slice(0, max);
}

function formatResults(provider, query, results, aiAnswer) {
  let out = `Búsqueda web vía ${provider} para: "${query}"\n${"=".repeat(60)}\n`;
  if (aiAnswer) {
    out += `Resumen IA: ${aiAnswer}\n\n`;
  }
  if (results.length === 0) {
    out += "(sin resultados)\n";
  } else {
    results.forEach((r, i) => {
      out += `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}\n\n`;
    });
  }
  return out;
}

export default { run };
