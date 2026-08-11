// ==============================================================================
// Véritas v2.4 — /lib/tools/read_project_file.js
// ==============================================================================
// Lee un archivo de la Carpeta Proyecto del usuario (almacenado en R2 bajo
// prefijo projects/<user_email>/). Devuelve el contenido como texto.
//
// Interfaz: export async function run(args, ctx)
//   args: { filename: string }
//   ctx:  { env, user_email, chat_id, role }
//   returns: { status, output, latency_ms? }
// ==============================================================================

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { filename } = args;
  if (!filename) return { status: "error", output: "Missing 'filename' argument." };

  const startTs = Date.now();
  const safeName = slugify(filename);
  const r2Key = `projects/${user_email}/${safeName}`;

  const obj = await env.BUCKET.get(r2Key);
  if (!obj) {
    // Listar archivos disponibles para ayudar al usuario a corregir el nombre.
    const list = await env.BUCKET.list({ prefix: `projects/${user_email}/`, limit: 50 });
    const available = list.objects.map((o) => o.key.replace(`projects/${user_email}/`, ""));
    const hint = available.length > 0
      ? `Archivos disponibles en tu Carpeta Proyecto:\n${available.map((n) => `  - ${n}`).join("\n")}`
      : "Tu Carpeta Proyecto está vacía. Sube archivos desde el Sandbox o la UI.";
    return {
      status: "ok",
      output: `El archivo "${filename}" no existe en tu Carpeta Proyecto (R2 key intentada: ${r2Key}).\n\n${hint}`,
      latency_ms: Date.now() - startTs,
    };
  }

  const buf = await obj.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(buf);
  const ext = safeName.split(".").pop().toLowerCase();

  // Para archivos binarios (imágenes, etc.), advertir en lugar de devolver basura.
  const binaryExts = ["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "pdf", "zip", "gz", "tar"];
  if (binaryExts.includes(ext)) {
    return {
      status: "ok",
      output: `Archivo: ${safeName} (${formatBytes(buf.byteLength)}, binario ${ext.toUpperCase()})\n` +
              `Nota: este es un archivo binario; no se puede representar como texto plano en el contexto del modelo. ` +
              `Si necesitas procesar su contenido, conviértelo a texto/HTML/JSON primero.`,
      latency_ms: Date.now() - startTs,
    };
  }

  const header = `Archivo: ${safeName} (${formatBytes(buf.byteLength)})\n${"=".repeat(60)}\n`;
  return {
    status: "ok",
    output: header + text,
    latency_ms: Date.now() - startTs,
    extra: { filename: safeName, size: buf.byteLength },
  };
}

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

export default { run };
