// ==============================================================================
// Véritas v2.4 — /lib/tools/send_email.js
// ==============================================================================
// Handler para la tool send_email. Envía emails vía Brevo.
// Permite reenviar informes, archivos y contenido generado a cualquier destinatario.
// ==============================================================================

export async function run(args, ctx) {
  const { callService } = await import('../services/brevo.js');

  const to          = args.to;
  const subject     = args.subject || 'Informe desde Véritas AI';
  const body_html   = args.html || args.body_html || null;
  const body_text   = args.text || args.body_text || null;
  const cc          = args.cc || null;
  const bcc         = args.bcc || null;
  const reply_to    = args.reply_to || null;
  const attachments = args.attachments || null;
  const sender_email = args.sender_email || null;
  const sender_name  = args.sender_name || null;

  // Validar destinatario
  if (!to) {
    return { success: false, error: 'Parametro "to" es obligatorio. Indica el email destinatario.' };
  }

  // Parsear múltiples destinatarios separados por coma
  const toList = String(to)
    .split(',')
    .map(function(e) { return e.trim(); })
    .filter(function(e) { return e.includes('@'); });

  if (!toList.length) {
    return { success: false, error: 'No se encontraron emails válidos en "to".' };
  }

  // Parsear CC/BCC si vienen como strings
  let ccList = null;
  if (cc) {
    ccList = Array.isArray(cc) ? cc : String(cc).split(',').map(function(e) { return e.trim(); });
  }
  let bccList = null;
  if (bcc) {
    bccList = Array.isArray(bcc) ? bcc : String(bcc).split(',').map(function(e) { return e.trim(); });
  }

  // Parsear attachments: soporta array de {name, content_base64} o {name, url}
  let parsedAttachments = null;
  if (attachments) {
    const arr = Array.isArray(attachments) ? attachments : [attachments];
    parsedAttachments = [];
    for (const a of arr) {
      if (a.content_base64) {
        parsedAttachments.push({ name: a.name || 'archivo', content: a.content_base64 });
      } else if (a.url) {
        // Fetch URL y convertir a base64
        try {
          const resp = await fetch(a.url);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            let b64 = '';
            const bytes = new Uint8Array(buf);
            for (let i = 0; i < bytes.length; i++) {
              b64 += String.fromCharCode(bytes[i]);
            }
            b64 = btoa(b64);
            parsedAttachments.push({ name: a.name || 'archivo_descargado', content: b64 });
          }
        } catch (e) {
          // Skip attachment on fetch error
        }
      }
    }
    if (!parsedAttachments.length) parsedAttachments = null;
  }

  // Firma obligatoria de Véritas (evita duplicarla si ya viene en el contenido)
  const FIRMA = '- Remitido por Véritas, la IA especializada en OSINT -';
  let htmlFinal = body_html;
  let textFinal = body_text;
  if (textFinal && !textFinal.includes('Remitido por Véritas')) {
    textFinal = textFinal.replace(/\s+$/, '') + '\n\n' + FIRMA;
  } else if (!textFinal) {
    textFinal = FIRMA;
  }
  if (htmlFinal && !htmlFinal.includes('Remitido por Véritas')) {
    htmlFinal = htmlFinal.replace(/<\/body>/i, '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d1d5db;color:#6b7280;font-size:12px;text-align:center;">' + FIRMA + '</div></body>');
  } else if (htmlFinal && !/<\/body>/i.test(htmlFinal)) {
    htmlFinal = htmlFinal + '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d1d5db;color:#6b7280;font-size:12px;text-align:center;">' + FIRMA + '</div>';
  } else if (!htmlFinal) {
    htmlFinal = '<div style="font-family:Segoe UI,Arial,sans-serif;color:#374151;">' + (textFinal ? textFinal.replace(/\n/g, '<br>') : '') + '</div>';
  }

  // Llamar al servicio Brevo
  const result = await callService(ctx.env, {
    to: toList,
    subject: subject,
    html: htmlFinal,
    text: textFinal,
    cc: ccList,
    bcc: bccList,
    reply_to: reply_to,
    attachments: parsedAttachments,
    sender_email: sender_email,
    sender_name: sender_name,
  });

  if (result.ok) {
    return {
      success: true,
      message: 'Email enviado correctamente a ' + toList.join(', '),
      message_id: result.messageId || null,
      key_used: result.key_used || null,
    };
  }

  return {
    success: false,
    error: result.error || 'Error desconocido al enviar email.',
  };
}
