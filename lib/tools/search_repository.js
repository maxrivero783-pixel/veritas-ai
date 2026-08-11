// ==============================================================================
// Véritas v2.4 — /lib/tools/search_repository.js
// ==============================================================================
// Busca un documento en el repositorio del usuario por número o nombre,
// recupera el contenido de R2 y extrae texto (PDF/HTML/MD/código/plano).
//
// Interfaz (común a todos los handlers en /lib/tools/):
//   export async function run(args, ctx)
//   args: { query: string }
//   ctx:  { env, user_email, chat_id, role }
//   returns: { status: "ok"|"error", output: string, latency_ms?: number }
// ==============================================================================

export async function run(args, ctx) {
  const { env, user_email } = ctx;
  const { query } = args;
  if (!query) return { status: "error", output: "Missing 'query' argument." };

  const startTs = Date.now();

  // Buscar por número o nombre parcial.
  const asNum = Number(query);
  let row;
  if (!Number.isNaN(asNum)) {
    row = await env.DB.prepare(
      `SELECT doc_number, doc_name, r2_key, file_size, mime_type FROM repo_documents
        WHERE user_email = ? AND doc_number = ?`
    ).bind(user_email, asNum).first();
  }
  if (!row) {
    row = await env.DB.prepare(
      `SELECT doc_number, doc_name, r2_key, file_size, mime_type FROM repo_documents
        WHERE user_email = ? AND doc_name LIKE ?
        ORDER BY created_at DESC LIMIT 1`
    ).bind(user_email, `%${query}%`).first();
  }

  if (!row) {
    return {
      status: "ok",
      output: `En el repositorio no existe tal documento. Por favor súbelo desde el menú Repositorio (drag & drop o botón de subida), o adjúntalo directamente al chat si prefieres procesarlo solo en este turno.`,
      latency_ms: Date.now() - startTs,
    };
  }

  // Recuperar de R2.
  const obj = await env.BUCKET.get(row.r2_key);
  if (!obj) {
    return {
      status: "error",
      output: `Documento #${row.doc_number} ("${row.doc_name}") está registrado en D1 pero su archivo no se encuentra en R2 (r2_key=${row.r2_key}). Posible inconsistencia: sube el documento de nuevo o contacta al admin.`,
      latency_ms: Date.now() - startTs,
    };
  }

  const buf = await obj.arrayBuffer();
  const text = await extractText(buf, row.doc_name, row.mime_type);

  const header = `Documento #${row.doc_number}: ${row.doc_name}\n` +
                 `Tamaño: ${formatBytes(row.file_size || buf.byteLength)} | MIME: ${row.mime_type || "desconocido"}\n` +
                 `${"=".repeat(60)}\n`;

  return {
    status: "ok",
    output: header + text,
    latency_ms: Date.now() - startTs,
    extra: { doc_number: row.doc_number, doc_name: row.doc_name, size: row.file_size },
  };
}

// ------------------------------------------------------------------------------
// extractText: extrae texto según extensión/MIME.
// En Workers no hay pdf-parse nativo; hacemos best-effort para PDF (extrae texto
// entre streams BT/ET). Para HTML quitamos tags. El resto se sirve como texto.
// ------------------------------------------------------------------------------
async function extractText(buf, name, mimeType) {
  const ext = (name || "").split(".").pop().toLowerCase();
  const text = new TextDecoder("utf-8").decode(buf);

  if (ext === "html" || mimeType === "text/html") {
    return text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (ext === "pdf") {
    // Best-effort: extraer texto entre paréntesis Tj/TJ (operadores PDF).
    // No es completo pero cubre PDFs simples sin streams comprimidos.
    const matches = text.match(/\(([^()\\]{1,})\)\s*Tj|\[(.*?)\]\s*TJ/g) || [];
    const extracted = matches
      .map((m) => m.replace(/\(|\)|Tj|TJ|\[|\]/g, "").replace(/<[^>]+>/g, ""))
      .join(" ")
      .trim();
    if (extracted.length > 50) {
      return `[PDF — extracción parcial en Worker]\n${extracted.slice(0, 50000)}`;
    }
    // Si no se pudo extraer texto, devolver el raw filtrado (puede tener basura).
    return `[PDF — extracción limitada en Worker. Contenido parcial del raw stream:]\n${text.replace(/[^\x20-\x7E\n\r\t]+/g, " ").slice(0, 20000)}`;
  }

  // .txt, .md, .py, .js, .ts, .csv, .json, .log, etc → texto plano.
  return text;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default { run };
