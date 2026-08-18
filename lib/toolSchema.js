// ==============================================================================
// Véritas v2.12 — /lib/toolSchema.js
// ==============================================================================
// Convierte el registro interno de tools (args con type/required/enum/min/max)
// a JSON Schema para FUNCTION-CALLING NATIVO (parámetro `tools` de OpenRouter /
// API compatible OpenAI). Buenas práctica: enums para valores finitos, marcar
// todos los required, additionalProperties:false.
// ==============================================================================

import { describeTool } from "./toolMeta.js";

function argToJsonSchema(spec) {
  const prop = {};
  switch (spec.type) {
    case "number": prop.type = "number"; break;
    case "boolean": prop.type = "boolean"; break;
    case "object": prop.type = "object"; break;
    case "array": prop.type = "array"; prop.items = { type: "string" }; break;
    case "string":
    default: prop.type = "string"; break;
  }
  if (Array.isArray(spec.enum) && spec.enum.length) prop.enum = spec.enum;
  if (typeof spec.min === "number") prop.minimum = spec.min;
  if (typeof spec.max === "number") prop.maximum = spec.max;
  if (spec.description) prop.description = spec.description;
  return prop;
}

// Construye el objeto function-calling de una tool.
export function buildToolFunction(name, tool) {
  const properties = {};
  const required = [];
  for (const [argName, spec] of Object.entries(tool.args || {})) {
    properties[argName] = argToJsonSchema(spec);
    if (spec.required) required.push(argName);
  }
  return {
    type: "function",
    function: {
      name,
      description: describeTool(name, tool.description),
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

// Construye el array `tools` para el request a partir de una lista de nombres.
export function buildToolsArray(names, registry) {
  const out = [];
  for (const n of names) {
    const tool = registry[n];
    if (!tool) continue;
    out.push(buildToolFunction(n, tool));
  }
  return out;
}

export default { buildToolFunction, buildToolsArray, argToJsonSchema };
