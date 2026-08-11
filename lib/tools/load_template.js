// ==============================================================================
// Véritas v2.4 — /lib/tools/load_template.js
// ==============================================================================
// Inserta una plantilla pre-armada en el Sandbox con parámetros.
//
// Las 7 plantillas viven en /lib/sandboxTemplates.js (ETAPA 5, frontend). Para
// el handler server-side, devolvemos un manifiesto con los nombres de archivo
// y placeholders que el frontend debe rellenar. El frontend tiene las funciones
// (params) => { files: [{path, content}], libraries: [...] } que generan el
// contenido real.
//
// El protocolo: el frontend detecta en el output el marcador
//   [[VERITAS_LOAD_TEMPLATE:<name>:<params_json>]]
// y ejecuta la función correspondiente de sandboxTemplates.js.
//
// Interfaz: export async function run(args, ctx)
//   args: { name: string, params?: object }
//   ctx:  { env, user_email, chat_id, role }
// ==============================================================================

const TEMPLATES = {
  "maplibre-basic": {
    description: "Mapa MapLibre GL centrado en coordenadas dadas, tiles OSM raster.",
    params: { center: "[-3.7, 40.4]", zoom: "11" },
    files: ["index.html"],
    libraries: ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"],
    stylesheets: ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"],
  },
  "maplibre-markers": {
    description: "Mapa MapLibre con marcadores arrastrables.",
    params: { center: "[-3.7, 40.4]", zoom: "11", markers: "[]" },
    files: ["index.html"],
    libraries: ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"],
    stylesheets: ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"],
  },
  "three-scene": {
    description: "Escena Three.js con cámara orbital y mesh por defecto.",
    params: { background: "#0a0e1a", meshType: "box" },
    files: ["index.html"],
    libraries: ["https://unpkg.com/three@0.160.0/build/three.min.js"],
    stylesheets: [],
  },
  "chartjs-dashboard": {
    description: "Dashboard con 3 charts (line, bar, doughnut) responsive.",
    params: { data: "{}" },
    files: ["index.html"],
    libraries: ["https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"],
    stylesheets: [],
  },
  "d3-chart": {
    description: "Gráfico D3.js force-directed graph.",
    params: { nodes: "[]", links: "[]" },
    files: ["index.html"],
    libraries: ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"],
    stylesheets: [],
  },
  "tailwind-page": {
    description: "Página completa con Tailwind CDN y secciones hero/features/footer.",
    params: { title: "Mi Página", color: "#50C878" },
    files: ["index.html"],
    libraries: ["https://cdn.tailwindcss.com"],
    stylesheets: [],
  },
  "plotly-3d": {
    description: "Superficie 3D Plotly.js.",
    params: { equation: "z = sin(sqrt(x^2+y^2))" },
    files: ["index.html"],
    libraries: ["https://cdn.plot.ly/plotly-2.27.0.min.js"],
    stylesheets: [],
  },
};

export async function run(args, ctx) {
  const { name, params = {} } = args;
  if (!name) return { status: "error", output: "Missing 'name' argument." };

  const template = TEMPLATES[name];
  if (!template) {
    return {
      status: "error",
      output: `Plantilla desconocida: "${name}". Plantillas disponibles: ${Object.keys(TEMPLATES).join(", ")}.`,
    };
  }

  const startTs = Date.now();
  const paramsJson = JSON.stringify(params);

  return {
    status: "ok",
    output:
      `Plantilla "${name}" cargada en el Sandbox.\n` +
      `Descripción: ${template.description}\n` +
      `Archivos a generar: ${template.files.join(", ")}\n` +
      `Librerías CDN: ${template.libraries.length} cargadas.\n\n` +
      `[[VERITAS_LOAD_TEMPLATE:${name}:${paramsJson}]]`,
    latency_ms: Date.now() - startTs,
    extra: {
      template_name: name,
      files: template.files,
      libraries: template.libraries,
      stylesheets: template.stylesheets,
      params,
    },
  };
}

export { TEMPLATES };
export default { run };
