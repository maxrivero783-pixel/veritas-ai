// ==============================================================================
// Véritas v2.12 — /lib/tools/email_report.js
// ==============================================================================
// Tool email_report (opt-in). Envía un informe/respuesta/documento al correo
// del USUARIO AUTENTICADO vía Brevo.
// Fusionado del artefacto v2.4 (consent + user_email) con el adaptador Brevo
// compartido (fallback EMAIL_API_KEY/BREVO_API_KEY + FROM_EMAIL/FROM_NAME) y
// la firma Véritas.
// ==============================================================================

import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import { callService } from '../services/brevo.js';

const FIRMA = '- Remitido por Véritas, la IA especializada en OSINT -';

export async function run(a = {}, c = {}) {
  // --- Validaciones de seguridad (opt-in + usuario autenticado) ---
  if (!a.consent) return { status: 'error', output: 'Consentimiento requerido: consent=true.' };
  if (!c.user_email) return { status: 'error', output: 'No hay usuario autenticado.' };
  if (!a.subject && !a.title) return { status: 'error', output: 'Falta subject o title.' };
  if (!a.summary && !a.text && !a.html) return { status: 'error', output: 'Falta contenido.' };
  if (!discoverKeys(c.env, 'brevo').length) return { status: 'error', output: 'Brevo no configurado.' };

  const subject = a.subject || a.title;
  let textFinal = String(a.text || a.summary || '');
  let htmlFinal = a.html || null;

  // Firma Véritas (sin duplicar si ya viene en el contenido)
  if (textFinal && !textFinal.includes('Remitido por Véritas')) {
    textFinal = textFinal.replace(/\s+$/, '') + '\n\n' + FIRMA;
  } else if (!textFinal) {
    textFinal = FIRMA;
  }
  if (htmlFinal) {
    if (!htmlFinal.includes('Remitido por Véritas')) {
      if (/<\/body>/i.test(htmlFinal)) {
        htmlFinal = htmlFinal.replace(/<\/body>/i, '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d1d5db;color:#6b7280;font-size:12px;text-align:center;">' + FIRMA + '</div></body>');
      } else {
        htmlFinal = htmlFinal + '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #d1d5db;color:#6b7280;font-size:12px;text-align:center;">' + FIRMA + '</div>';
      }
    }
  } else {
    htmlFinal = '<div style="font-family:Segoe UI,Arial,sans-serif;color:#374151;">' + textFinal.replace(/\n/g, '<br>') + '</div>';
  }

  // --- Envío vía adaptador Brevo compartido (rotación + fallbacks) ---
  const result = await callService(c.env, {
    to: c.user_email,
    subject: subject,
    html: htmlFinal,
    text: textFinal,
    sender_email: a.sender_email || null,
    sender_name: a.sender_name || null,
  });

  if (!result.ok) {
    return { status: 'error', output: result.error || 'Error desconocido al enviar email.' };
  }
  return {
    status: 'ok',
    output: `Email enviado a ${c.user_email}.`,
    extra: { message_id: result.messageId || null, key_used: result.key_used || null },
  };
}

export default { run };
