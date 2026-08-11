// ==============================================================================
// Véritas v2.4 — /lib/services/browserless.js
// ==============================================================================
// Adaptador HTTP para Browserless — clúster headless Chromium remoto.
// No exponemos WebSocket directamente (no viable en Workers); en su lugar
// ofrecemos un endpoint REST de función que envía un script Playwright/Puppeteer
// al servicio Browserless /function y recibe el resultado.
//
// Endpoint REST utilizado:
//   POST /function — ejecuta script en Browserless cloud y devuelve resultado.
//
// Auth: token como query parameter ?token={BROWSERLESS_API_KEY}
// ==============================================================================

const BASE = "https://production-sfo.browserless.io";

// -----------------------------------------------------------------------------
// callService: dispatcher por endpoint.
// -----------------------------------------------------------------------------
// endpoint: "evaluate" | "screenshot" | "pdf" | "content"
// payload :
//   evaluate  → { url, code }                      // ejecuta JS en la página
//   screenshot→ { url, full_page?, selector? }      // captura screenshot
//   pdf       → { url }                             // genera PDF
//   content   → { url }                             // extrae HTML/texto
// apiKey    : token de auth
// -----------------------------------------------------------------------------
export async function callService({ endpoint, payload, apiKey }) {
  switch (endpoint) {
    case "evaluate":
      return callFunction(payload, apiKey);
    case "screenshot":
      return callScreenshot(payload, apiKey);
    case "pdf":
      return callPDF(payload, apiKey);
    case "content":
      return callContent(payload, apiKey);
    default:
      return { status: 400, data: null, raw: null, error: `Unknown Browserless endpoint: ${endpoint}` };
  }
}

// -----------------------------------------------------------------------------
// callFunction: POST /function — ejecuta un script Playwright/Puppeteer en la
// nube de Browserless. El script se envía como string en el body del POST.
// -----------------------------------------------------------------------------
async function callFunction(payload, apiKey) {
  const { url, code } = payload;
  if (!url || !code) {
    return { status: 400, data: null, raw: null, error: "Missing url and/or code" };
  }

  // Construimos un script que Playwright ejecutará en Browserless.
  // El script recibe { page, browser, context } y debe devolver un valor.
  const wrappedCode = `
    const page = await browser.newPage();
    await page.goto("${url.replace(/"/g, '\\"')}", { waitUntil: "domcontentloaded", timeout: 30000 });
    const result = await page.evaluate(async () => {
      ${code}
    });
    await page.close();
    return result;
  `;

  const resp = await fetch(`${BASE}/function?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: wrappedCode,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callScreenshot: captura screenshot de una URL vía /function.
// -----------------------------------------------------------------------------
async function callScreenshot(payload, apiKey) {
  const { url, full_page = false, selector } = payload;
  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const selectorLine = selector ? `if (await page.$("${selector.replace(/"/g, '\\"')}")) { await page.locator("${selector.replace(/"/g, '\\"')}").screenshot({ path: "screenshot.png" }); }` : "";

  const wrappedCode = `
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("${url.replace(/"/g, '\\"')}", { waitUntil: "networkidle", timeout: 30000 });
    ${selectorLine}
    const buf = await page.screenshot({ fullPage: ${full_page} });
    await page.close();
    return buf.toString("base64");
  `;

  const resp = await fetch(`${BASE}/function?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: wrappedCode,
  });

  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("image")) {
    const buf = await resp.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { status: resp.status, data: { image_base64: b64, content_type: contentType }, raw: b64 };
  }

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callPDF: genera PDF de una URL vía /function.
// -----------------------------------------------------------------------------
async function callPDF(payload, apiKey) {
  const { url } = payload;
  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const wrappedCode = `
    const page = await browser.newPage();
    await page.goto("${url.replace(/"/g, '\\"')}", { waitUntil: "networkidle", timeout: 30000 });
    const buf = await page.pdf({ format: "A4" });
    await page.close();
    return buf.toString("base64");
  `;

  const resp = await fetch(`${BASE}/function?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: wrappedCode,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data, raw: text };
}

// -----------------------------------------------------------------------------
// callContent: extrae contenido HTML de una URL vía /function.
// -----------------------------------------------------------------------------
async function callContent(payload, apiKey) {
  const { url } = payload;
  if (!url) return { status: 400, data: null, raw: null, error: "Missing url" };

  const wrappedCode = `
    const page = await browser.newPage();
    await page.goto("${url.replace(/"/g, '\\"')}", { waitUntil: "domcontentloaded", timeout: 30000 });
    const html = await page.content();
    await page.close();
    return html;
  `;

  const resp = await fetch(`${BASE}/function?token=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: wrappedCode,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: resp.status, data, raw: text };
}

export default { callService };
