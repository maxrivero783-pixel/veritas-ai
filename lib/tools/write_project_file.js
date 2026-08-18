// ==============================================================================
// Véritas v2.12 — /lib/tools/write_project_file.js
// ==============================================================================
// Escribe o sobrescribe un archivo en la Carpeta Proyecto del usuario
// (almacenado en R2 bajo prefijo projects/<user_email>/). La IA lo usa para
// persistir archivos generados (código, HTML, JSON, etc.) fuera del Sandbox.
//
// Diferencia con preview_html: preview_html es efímero (carga al iframe del
// Sandbox). write_project_file persiste en R2 y el archivo queda disponible
// para read_project_file y para el futuro modal de Carpeta Proyecto.
//
// Interfaz: export async function run(args, ctx)
//   args: { filename: string, content: string, overwrite?: boolean }
//   ctx:  { env, user_email, chat_id, role }
//   returns: { status, output, latency_ms?, extra? }
// ==============================================================================

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB por archivo (consistente con repo)
const BINARY_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "pdf", "zip", "gz", "tar"];

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { filename, content, overwrite = false } = args;

  if (!filename) return { status: "error", output: "Missing 'filename' argument." };
  if (content === undefined || content === null) {
    return { status: "error", output: "Missing 'content' argument." };
  }
  if (typeof content !== "string") {
    return { status: "error", output: `'content' must be a string, got ${typeof content}.` };
  }

  const startTs = Date.now();
  const safeName = slugify(filename);

  // Validar tamaño.
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > MAX_FILE_SIZE_BYTES) {
    return {
      status: "error",
      output: `Archivo demasiado grande: ${formatBytes(bytes.byteLength)}. Máximo ${formatBytes(MAX_FILE_SIZE_BYTES)} por archivo.`,
      latency_ms: Date.now() - startTs,
    };
  }

  // Validar que no sea extensión binaria (no tiene sentido escribir binario
  // desde un string de texto; el modelo no debe generar PNG/JPG/etc.).
  const ext = safeName.split(".").pop().toLowerCase();
  if (BINARY_EXTS.includes(ext)) {
    return {
      status: "error",
      output: `No se pueden escribir archivos binarios (${ext.toUpperCase()}) desde contenido de texto. ` +
              `El modelo solo puede generar archivos de texto: .html, .css, .js, .ts, .json, .md, .txt, .py, .csv, etc.`,
      latency_ms: Date.now() - startTs,
    };
  }

  const r2Key = `projects/${user_email}/${safeName}`;

  // Verificar si existe (a menos que overwrite=true).
  if (!overwrite) {
    const existing = await env.BUCKET.head(r2Key);
    if (existing) {
      return {
        status: "error",
        output: `El archivo "${safeName}" ya existe en tu Carpeta Proyecto. ` +
                `Vuelve a invocar con overwrite=true para sobrescribirlo.`,
        latency_ms: Date.now() - startTs,
        extra: { filename: safeName, exists: true, size: existing.size },
      };
    }
  }

  // Subir a R2.
  const mimeType = guessMime(ext);
  await env.BUCKET.put(r2Key, bytes, {
    customMetadata: {
      user_email,
      type: "project_file",
      created: new Date().toISOString(),
      chat_id: ctx.chat_id || "",
    },
    httpMetadata: { contentType: mimeType },
  });

  return {
    status: "ok",
    output: `Archivo "${safeName}" ${overwrite ? "sobrescrito" : "creado"} en tu Carpeta Proyecto.\n` +
            `Tamaño: ${formatBytes(bytes.byteLength)} | MIME: ${mimeType}\n` +
            `R2 key: ${r2Key}\n\n` +
            `El archivo está disponible para read_project_file y para descarga desde la Carpeta Proyecto.`,
    latency_ms: Date.now() - startTs,
    extra: {
      filename: safeName,
      r2_key: r2Key,
      size: bytes.byteLength,
      mime_type: mimeType,
      overwritten: !!overwrite,
    },
  };
}

// ------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------
function slugify(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 128);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function guessMime(ext) {
  const mimes = {
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    js: "application/javascript; charset=utf-8",
    mjs: "application/javascript; charset=utf-8",
    ts: "application/typescript; charset=utf-8",
    json: "application/json; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    svg: "image/svg+xml",
    py: "text/x-python; charset=utf-8",
    yml: "application/x-yaml; charset=utf-8",
    yaml: "application/x-yaml; charset=utf-8",
    sh: "application/x-sh; charset=utf-8",
    sql: "application/sql; charset=utf-8",
  };
  return mimes[ext] || "application/octet-stream";
}

export default { run };
