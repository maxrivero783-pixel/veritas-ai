// ==============================================================================
// Véritas v2.2 — /lib/sandboxTemplates.js
// ==============================================================================
// 14 plantillas pre-armadas para el Sandbox. Cada una es una función
//   (params) => { files: [{path, content}], libraries: [{src, type?}] }
//
// `files`: array de archivos a crear en el árbol del sandbox.
// `libraries`: CDNs a inyectar en el <head> del HTML final (opcional, ya que
//              las plantillas ya incluyen sus propios <script>/<link>).
//
// Plantillas:
//   maplibre-basic     — mapa MapLibre GL centrado, tiles OSM raster.
//   maplibre-markers   — mapa MapLibre con marcadores arrastrables.
//   three-scene        — escena Three.js con cámara orbital.
//   chartjs-dashboard  — dashboard con 3 charts (line, bar, doughnut).
//   d3-chart           — force-directed graph D3.js.
//   tailwind-page      — página completa con Tailwind CDN.
//   plotly-3d          — superficie 3D Plotly.js.
// ==============================================================================

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data:; script-src 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://esm.sh; style-src 'unsafe-inline' https:; img-src https: data:; connect-src https:;">`;

// ------------------------------------------------------------------------------
// 1. maplibre-basic
// Params: { center: [lng, lat], zoom: 11 }
// ------------------------------------------------------------------------------
export function maplibreBasic(params = {}) {
  const center = params.center || [-3.7, 40.4]; // Madrid por defecto
  const zoom = params.zoom || 11;
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${CSP_META}
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [${center[0]}, ${center[1]}],
      zoom: ${zoom}
    });
    map.addControl(new maplibregl.NavigationControl());
  </script>
</body>
</html>`;

  return {
    files: [{ path: "index.html", content: html }],
    libraries: [
      { src: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", type: "script" },
      { src: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css", type: "style" },
    ],
  };
}

// ------------------------------------------------------------------------------
// 2. maplibre-markers
// Params: { center, zoom, markers: [{lat, lng, popup}] }
// ------------------------------------------------------------------------------
export function maplibreMarkers(params = {}) {
  const center = params.center || [-3.7, 40.4];
  const zoom = params.zoom || 11;
  const markers = params.markers || [
    { lat: 40.4, lng: -3.7, popup: "Madrid" },
    { lat: 40.45, lng: -3.68, popup: "Chamartín" },
  ];
  const markersJson = JSON.stringify(markers);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${CSP_META}
  <link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #map { position: absolute; top: 0; bottom: 0; width: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const markers = ${markersJson};
    const map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors'
          }
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
      },
      center: [${center[0]}, ${center[1]}],
      zoom: ${zoom}
    });
    map.addControl(new maplibregl.NavigationControl());
    markers.forEach(m => {
      const marker = new maplibregl.Marker({ draggable: true })
        .setLngLat([m.lng, m.lat])
        .addTo(map);
      if (m.popup) {
        marker.setPopup(new maplibregl.Popup({ offset: 25 }).setText(m.popup));
      }
      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        console.log('Marker movido a:', lngLat.lng, lngLat.lat);
      });
    });
  </script>
</body>
</html>`;

  return {
    files: [{ path: "index.html", content: html }],
    libraries: [
      { src: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", type: "script" },
      { src: "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css", type: "style" },
    ],
  };
}

// ------------------------------------------------------------------------------
// 3. three-scene
// Params: { background: "#0a0e1a", meshType: "box" | "sphere" | "torus" }
// ------------------------------------------------------------------------------
export function threeScene(params = {}) {
  const bg = params.background || "#0a0e1a";
  const meshType = params.meshType || "box";
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${CSP_META}
  <script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>
  <style>
    body { margin: 0; overflow: hidden; background: ${bg}; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script>
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("${bg}");
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);
    const geometry = new THREE.${meshType.charAt(0).toUpperCase() + meshType.slice(1)}Geometry(1, 1, 1);
    const material = new THREE.MeshPhongMaterial({ color: 0x50C878, shininess: 100 });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 2);
    scene.add(light);
    const ambient = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambient);
    let isDragging = false, prevX = 0, prevY = 0;
    document.addEventListener('mousedown', (e) => { isDragging = true; prevX = e.clientX; prevY = e.clientY; });
    document.addEventListener('mouseup', () => { isDragging = false; });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      mesh.rotation.y += dx * 0.01;
      mesh.rotation.x += dy * 0.01;
      prevX = e.clientX;
      prevY = e.clientY;
    });
    function animate() {
      requestAnimationFrame(animate);
      if (!isDragging) {
        mesh.rotation.x += 0.005;
        mesh.rotation.y += 0.01;
      }
      renderer.render(scene, camera);
    }
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
    animate();
  </script>
</body>
</html>`;

  return {
    files: [{ path: "index.html", content: html }],
    libraries: [{ src: "https://unpkg.com/three@0.160.0/build/three.min.js", type: "script" }],
  };
}

// ------------------------------------------------------------------------------
// 4. chartjs-dashboard
// Params: { data: { labels, line, bar, doughnut } }
// ------------------------------------------------------------------------------
export function chartjsDashboard(params = {}) {
  const data = params.data || {
    labels: ["Ene", "Feb", "Mar", "Abr", "May", "Jun"],
    line: [12, 19, 15, 25, 22, 30],
    bar: [50, 60, 45, 70, 55, 80],
    doughnut: [30, 40, 30],
  };
  const dataJson = JSON.stringify(data);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${CSP_META}
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    body { margin: 0; padding: 16px; background: #0a0e1a; color: #e6f0ff; font-family: system-ui, sans-serif; }
    .dashboard { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 1200px; margin: 0 auto; }
    .chart-card { background: #111729; border-radius: 12px; padding: 16px; }
    .chart-card h3 { margin: 0 0 12px; color: #50C878; font-size: 14px; }
    .full-width { grid-column: 1 / -1; }
    canvas { max-height: 240px; }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="chart-card full-width">
      <h3>Tendencia (Línea)</h3>
      <canvas id="lineChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Barras</h3>
      <canvas id="barChart"></canvas>
    </div>
    <div class="chart-card">
      <h3>Distribución (Doughnut)</h3>
      <canvas id="doughnutChart"></canvas>
    </div>
  </div>
  <script>
    const data = ${dataJson};
    new Chart(document.getElementById('lineChart'), {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{ label: 'Valor', data: data.line, borderColor: '#50C878', backgroundColor: 'rgba(80,200,120,0.1)', tension: 0.3 }]
      }
    });
    new Chart(document.getElementById('barChart'), {
      type: 'bar',
      data: {
        labels: data.labels,
        datasets: [{ label: 'Valor', data: data.bar, backgroundColor: '#00d4ff' }]
      }
    });
    new Chart(document.getElementById('doughnutChart'), {
      type: 'doughnut',
      data: {
        labels: ['A', 'B', 'C'],
        datasets: [{ data: data.doughnut, backgroundColor: ['#50C878', '#00d4ff', '#ffb347'] }]
      }
    });
  </script>
</body>
</html>`;

  return {
    files: [{ path: "index.html", content: html }],
    libraries: [{ src: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js", type: "script" }],
  };
}

// ------------------------------------------------------------------------------
// 5. d3-chart (force-directed graph)
// Params: { nodes: [{id, group}], links: [{source, target, value}] }
// ------------------------------------------------------------------------------
export function d3Chart(params = {}) {
  const graph = params.nodes && params.links
    ? params
    : {
        nodes: [
          { id: "A", group: 1 }, { id: "B", group: 1 }, { id: "C", group: 2 },
          { id: "D", group: 2 }, { id: "E", group: 3 },
        ],
        links: [
          { source: "A", target: "B", value: 1 }, { source: "A", target: "C", value: 1 },
          { source: "B", target: "D", value: 1 }, { source: "C", target: "D", value: 1 },
          { source: "D", target: "E", value: 2 },
        ],
      };
  const graphJson = JSON.stringify(graph);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${CSP_META}
  <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
  <style>
    body { margin: 0; background: #0a0e1a; font-family: system-ui, sans-serif; }
    svg { display: block; width: 100vw; height: 100vh; }
    .link { stroke: #475569; stroke-opacity: 0.6; }
    .node { stroke: #fff; stroke-width: 1.5px; }
    text { fill: #e6f0ff; font-size: 12px; pointer-events: none; }
  </style>
</head>
<body>
  <svg></svg>
  <script>
    const graph = ${graphJson};
    const svg = d3.select("svg");
    const width = window.innerWidth, height = window.innerHeight;
    svg.attr("viewBox", [0, 0, width, height]);
    const color = d3.scaleOrdinal(d3.schemeCategory10);
    const link = svg.append("g").selectAll("line").data(graph.links).join("line").attr("class", "link").attr("stroke-width", d => Math.sqrt(d.value) * 2);
    const node = svg.append("g").selectAll("circle").data(graph.nodes).join("circle")
      .attr("class", "node").attr("r", 8).attr("fill", d => color(d.group)).call(drag());
    const labels = svg.append("g").selectAll("text").data(graph.nodes).join("text").text(d => d.id);
    const simulation = d3.forceSimulation(graph.nodes)
      .force("link", d3.forceLink(graph.links).id(d => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2));
    simulation.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y);
      node.attr("cx", d => d.x).attr("cy", d => d.y);
      labels.attr("x", d => d.x + 10).attr("y", d => d.y + 4);
    });
    function drag() {
      function dragstarted(event, d) { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
      function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
      function dragended(event, d) { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }
      return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
    }
  </script>
</body>
</html>`;

  return {
    files: [{ path: "index.html", content: html }],
    libraries: [{ src: "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js", type: "script" }],
  };
}

// ------------------------------------------------------------------------------
// 6. tailwind-page
// Params: { title: "Mi Página", color: "#50C878" }
// ------------------------------------------------------------------------------
export function tailwindPage(params = {}) {
  const title = params.title || "Mi Página";
  const color = params.color || "#50C878";
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  ${CSP_META}
  <script src="https://cdn.tailwindcss.com"></script>
  <title>${title}</title>
</head>
<body class="bg-gray-900 text-white">
  <header class="py-20" style="background: linear-gradient(135deg, ${color}22, transparent);">
    <div class="container mx-auto px-6 text-center">
      <h1 class="text-5xl font-bold mb-4" style="color: ${color};">${title}</h1>
      <p class="text-xl text-gray-300">Página generada con Tailwind CSS y Véritas v2.2</p>
      <button class="mt-8 px-8 py-3 rounded-lg font-semibold transition" style="background: ${color}; color: #0a0e1a;">Empezar</button>
    </div>
  </header>
  <section class="py-16">
    <div class="container mx-auto px-6">
      <h2 class="text-3xl font-bold mb-8 text-center">Características</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div class="bg-gray-800 p-6 rounded-xl">
          <div class="text-4xl mb-4">⚡</div>
          <h3 class="text-xl font-semibold mb-2">Rápido</h3>
          <p class="text-gray-400">Tailwind CSS en CDN para prototipado inmediato.</p>
        </div>
        <div class="bg-gray-800 p-6 rounded-xl">
          <div class="text-4xl mb-4">🎨</div>
          <h3 class="text-xl font-semibold mb-2">Personalizable</h3>
          <p class="text-gray-400">Color de acento: ${color}</p>
        </div>
        <div class="bg-gray-800 p-6 rounded-xl">
          <div class="text-4xl mb-4">📱</div>
          <h3 class="text-xl font-semibold mb-2">Responsive</h3>
          <p class="text-gray-400">Mobile-first con breakpoints de Tailwind.</p>
        </div>
      </div>
    </div>
  </section>
  <footer class="py-8 text-center text-gray-500 border-t border-gray-800">
    <p>© 2025 ${title} — Generado por Véritas v2.2</p>
  </footer>
</body>
</html>`;

  return {
    files: [{ path: "index.html", content: html }],
    libraries: [{ src: "https://cdn.tailwindcss.com", type: "script" }],
  };
}

// ------------------------------------------------------------------------------
// 7. plotly-3d
// Params: { equation: "z = sin(sqrt(x^2+y^2))" }
// ------------------------------------------------------------------------------
export function plotly3d(params = {}) {
  const equation = params.equation || "z = sin(sqrt(x^2+y^2))";
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${CSP_META}
  <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
  <style>
    body { margin: 0; background: #0a0e1a; color: #e6f0ff; font-family: system-ui, sans-serif; }
    #plot { width: 100vw; height: 100vh; }
    .header { position: absolute; top: 16px; left: 16px; z-index: 10; }
    .header h1 { margin: 0; font-size: 18px; color: #50C878; }
    .header p { margin: 4px 0 0; font-size: 13px; color: #94a3b8; font-family: monospace; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Superficie 3D</h1>
    <p>${equation}</p>
  </div>
  <div id="plot"></div>
  <script>
    function f(x, y) {
      return Math.sin(Math.sqrt(x * x + y * y));
    }
    const N = 50;
    const x = [], y = [], z = [];
    for (let i = 0; i < N; i++) {
      x.push(-5 + (10 * i / (N - 1)));
      y.push(-5 + (10 * i / (N - 1)));
    }
    for (let i = 0; i < N; i++) {
      const row = [];
      for (let j = 0; j < N; j++) {
        row.push(f(x[i], y[j]));
      }
      z.push(row);
    }
    Plotly.newPlot('plot', [{
      type: 'surface',
      x: x, y: y, z: z,
      colorscale: [[0, '#00d4ff'], [0.5, '#50C878'], [1, '#ffb347']],
    }], {
      paper_bgcolor: '#0a0e1a',
      plot_bgcolor: '#0a0e1a',
      font: { color: '#e6f0ff' },
      margin: { l: 0, r: 0, b: 0, t: 0 },
      scene: {
        xaxis: { gridcolor: '#475569' },
        yaxis: { gridcolor: '#475569' },
        zaxis: { gridcolor: '#475569' },
      }
    }, { responsive: true });
  </script>
</body>
</html>`;

  return {
    files: [{ path: "index.html", content: html }],
    libraries: [{ src: "https://cdn.plot.ly/plotly-2.27.0.min.js", type: "script" }],
  };
}


// ------------------------------------------------------------------------------
// Investigación y productividad — templates static-first para Agente/Coder
// ------------------------------------------------------------------------------
function wrapArtifact(title, body, script = "") {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${CSP_META}
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; --bg:#07111f; --panel:#101d31; --line:#263850; --text:#e6f0ff; --muted:#9fb0c6; --eme:#50C878; --cyan:#00d4ff; --amber:#ffb347; --red:#ff5c7a; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: radial-gradient(circle at top left, #16345a, var(--bg) 45%); color: var(--text); }
    header { padding: 28px; border-bottom: 1px solid var(--line); background: rgba(16,29,49,.72); backdrop-filter: blur(8px); }
    h1 { margin: 0 0 8px; letter-spacing: -.02em; }
    p { color: var(--muted); line-height: 1.55; }
    main { padding: 24px; display: grid; gap: 18px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .card { background: rgba(16,29,49,.82); border: 1px solid var(--line); border-radius: 16px; padding: 18px; box-shadow: 0 16px 50px rgba(0,0,0,.22); }
    .metric { font-size: 34px; color: var(--eme); font-weight: 800; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 12px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--cyan); background: rgba(0,212,255,.08); }
    input, textarea, button, select { font: inherit; border-radius: 10px; border: 1px solid var(--line); background: #0b1627; color: var(--text); padding: 10px 12px; }
    button { cursor: pointer; background: linear-gradient(135deg, var(--eme), #1b9e67); color: #04100a; font-weight: 800; border: none; }
    .tag { display:inline-block; padding: 4px 8px; border-radius: 999px; background: rgba(80,200,120,.12); color: var(--eme); font-size: 12px; }
    .warn { color: var(--amber); } .bad { color: var(--red); } .good { color: var(--eme); }
    pre { white-space: pre-wrap; background:#07111f; border:1px solid var(--line); border-radius:12px; padding:14px; overflow:auto; }
  </style>
</head>
<body>
  <header><h1>${title}</h1><p>Artefacto Véritas static-first. Edita datos y estructura en el sandbox.</p></header>
  <main>${body}</main>
  <script>${script}
    window.__veritasTests = [
      { name: 'Tiene título principal', run: () => !!document.querySelector('h1') },
      { name: 'Tiene contenido principal', run: () => document.querySelectorAll('main .card, main table, main section').length > 0 }
    ];
  </script>
</body>
</html>`;
}

export function osintReport() {
  const body = `<section class="grid">
    <div class="card"><span class="tag">Resumen</span><h2>Hipótesis central</h2><p>Define aquí la pregunta de investigación, alcance, fuentes y nivel de confianza.</p></div>
    <div class="card"><span class="tag">Confianza</span><div class="metric">72%</div><p>Confianza agregada basada en evidencia disponible.</p></div>
    <div class="card"><span class="tag">Limitaciones</span><p>Datos faltantes, sesgos de fuente, cuotas o información no verificada.</p></div>
  </section>
  <section class="card"><h2>Matriz de fuentes</h2><table><thead><tr><th>Fuente</th><th>Hallazgo</th><th>Confianza</th></tr></thead><tbody><tr><td>Fuente 1</td><td>Hallazgo clave</td><td class="good">Alta</td></tr><tr><td>Fuente 2</td><td>Dato contextual</td><td class="warn">Media</td></tr></tbody></table></section>`;
  return { files: [{ path: "index.html", content: wrapArtifact("Informe OSINT", body) }], libraries: [] };
}

export function timelineInvestigation() {
  const body = `<section class="card"><h2>Timeline</h2><div id="timeline"></div></section>`;
  const script = `const events = [{date:'2026-01-05', title:'Evento inicial', confidence:'alta'}, {date:'2026-02-12', title:'Cambio de narrativa', confidence:'media'}, {date:'2026-03-01', title:'Evidencia nueva', confidence:'baja'}];
    document.getElementById('timeline').innerHTML = events.map(e => '<div class="card"><strong>'+e.date+'</strong><h3>'+e.title+'</h3><span class="tag">'+e.confidence+'</span></div>').join('');`;
  return { files: [{ path: "index.html", content: wrapArtifact("Cronología de investigación", body, script) }], libraries: [] };
}

export function entityGraphTemplate() {
  const body = `<section class="card"><h2>Grafo de entidades</h2><svg id="graph" viewBox="0 0 640 360" width="100%" height="360"></svg></section>`;
  const script = `const svg=document.getElementById('graph'); const nodes=[['Persona',120,120],['Org',320,90],['Evento',500,210],['Lugar',260,260]]; const edges=[[0,1],[1,2],[2,3],[0,3]]; edges.forEach(([a,b])=>{const A=nodes[a],B=nodes[b]; svg.innerHTML += '<line x1="'+A[1]+'" y1="'+A[2]+'" x2="'+B[1]+'" y2="'+B[2]+'" stroke="#50C878" opacity=".6"/>';}); nodes.forEach(n=>{svg.innerHTML += '<circle cx="'+n[1]+'" cy="'+n[2]+'" r="34" fill="#101d31" stroke="#00d4ff"/><text x="'+n[1]+'" y="'+(n[2]+5)+'" text-anchor="middle" fill="#e6f0ff">'+n[0]+'</text>';});`;
  return { files: [{ path: "index.html", content: wrapArtifact("Grafo de entidades", body, script) }], libraries: [] };
}

export function csvDashboard() {
  const body = `<section class="card"><h2>CSV Dashboard</h2><textarea id="csv" rows="6">region,value\nNorte,42\nSur,31\nEste,55\nOeste,24</textarea><br><button id="render">Renderizar</button></section><section class="card"><h2>Tabla</h2><div id="table"></div></section>`;
  const script = `function render(){const rows=document.getElementById('csv').value.trim().split('\n').map(r=>r.split(',')); document.getElementById('table').innerHTML='<table>'+rows.map((r,i)=>'<tr>'+r.map(c=>(i?'<td>':'<th>')+c+(i?'</td>':'</th>')).join('')+'</tr>').join('')+'</table>'; } document.getElementById('render').onclick=render; render();`;
  return { files: [{ path: "index.html", content: wrapArtifact("Dashboard CSV", body, script) }], libraries: [] };
}

export function interactiveQuiz() {
  const body = `<section class="card"><h2>Quiz</h2><div id="quiz"></div><button id="check">Calificar</button><p id="score"></p></section>`;
  const script = `const questions=[{q:'¿Véritas usa skills?',a:'sí'},{q:'¿El sandbox es static-first?',a:'sí'}]; document.getElementById('quiz').innerHTML=questions.map((x,i)=>'<label>'+x.q+'<input data-i="'+i+'"></label><br>').join(''); document.getElementById('check').onclick=()=>{let ok=0; document.querySelectorAll('[data-i]').forEach(inp=>{if(inp.value.trim().toLowerCase()===questions[inp.dataset.i].a) ok++;}); document.getElementById('score').textContent=ok+'/'+questions.length+' correctas';};`;
  return { files: [{ path: "index.html", content: wrapArtifact("Quiz interactivo", body, script) }], libraries: [] };
}

export function markdownDocViewer() {
  const body = `<section class="grid"><div class="card"><h2>Markdown</h2><textarea id="md" rows="12"># Documento\n\n- Punto clave\n- Evidencia\n- Siguiente paso</textarea></div><div class="card"><h2>Preview</h2><div id="out"></div></div></section>`;
  const script = `function render(){let s=document.getElementById('md').value; s=s.replace(/^# (.*)$/gm,'<h1>$1</h1>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^- (.*)$/gm,'<li>$1</li>').replace(/\n/g,'<br>'); document.getElementById('out').innerHTML=s;} document.getElementById('md').oninput=render; render();`;
  return { files: [{ path: "index.html", content: wrapArtifact("Visor Markdown", body, script) }], libraries: [] };
}

export function kanbanLocal() {
  const body = `<section class="grid" id="board"></section>`;
  const script = `const cols=['Backlog','En curso','Hecho']; const tasks={Backlog:['Definir alcance'], 'En curso':['Investigar fuentes'], Hecho:['Crear sandbox']}; function render(){board.innerHTML=cols.map(c=>'<div class="card"><h2>'+c+'</h2>'+(tasks[c]||[]).map(t=>'<p class="tag">'+t+'</p>').join('<br>')+'<br><input placeholder="Nueva tarea"><button onclick="addTask(\\''+c+'\\', this.previousElementSibling.value)">+</button></div>').join('');} function addTask(c,v){if(v){tasks[c].push(v); render();}} render();`;
  return { files: [{ path: "index.html", content: wrapArtifact("Kanban local", body, script) }], libraries: [] };
}

// ------------------------------------------------------------------------------
// Dispatcher: getTemplate(name, params)
// ------------------------------------------------------------------------------
const TEMPLATES = {
  "maplibre-basic": maplibreBasic,
  "maplibre-markers": maplibreMarkers,
  "three-scene": threeScene,
  "chartjs-dashboard": chartjsDashboard,
  "d3-chart": d3Chart,
  "tailwind-page": tailwindPage,
  "plotly-3d": plotly3d,
  "osint-report": osintReport,
  "timeline-investigation": timelineInvestigation,
  "entity-graph": entityGraphTemplate,
  "csv-dashboard": csvDashboard,
  "interactive-quiz": interactiveQuiz,
  "markdown-doc-viewer": markdownDocViewer,
  "kanban-local": kanbanLocal,
};

export function getTemplate(name, params = {}) {
  const fn = TEMPLATES[name];
  if (!fn) throw new Error(`Unknown template: ${name}`);
  return fn(params);
}

export function listTemplates() {
  return Object.keys(TEMPLATES);
}

export const CSP_META_TAG = CSP_META;

export default {
  maplibreBasic,
  maplibreMarkers,
  threeScene,
  chartjsDashboard,
  d3Chart,
  tailwindPage,
  plotly3d,
  osintReport,
  timelineInvestigation,
  entityGraphTemplate,
  csvDashboard,
  interactiveQuiz,
  markdownDocViewer,
  kanbanLocal,
  getTemplate,
  listTemplates,
  CSP_META_TAG,
};
