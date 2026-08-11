// ==============================================================================
// Véritas v2.4 — /lib/services/brevo.js
// ==============================================================================
// Adaptador HTTP para Brevo (ex-Sendinblue) Transactional Email API v3.
// Soporta envío de emails con HTML, texto plano y adjuntos base64.
// Usa keyRotator para rotar entre BREVO_API_KEY_1, _2, etc.
// ==============================================================================

const BREVO_BASE = 'https://api.brevo.com/v3';

/**
 * Llama a la Brevo Transactional Email API.
 *
 * @param {object} env   - Entorno Cloudflare (env.BREVO_API_KEY_1, etc.)
 * @param {object} params
 * @param {string} params.to          - Email destinatario (o array de strings)
 * @param {string} params.subject     - Asunto del email
 * @param {string} [params.html]      - Cuerpo HTML del email
 * @param {string} [params.text]      - Cuerpo texto plano (fallback si no hay html)
 * @param {string} [params.sender_email] - Email remitente (default: env.BREVO_SENDER_EMAIL)
 * @param {string} [params.sender_name]  - Nombre remitente (default: env.BREVO_SENDER_NAME)
 * @param {Array}  [params.attachments] - Array de {name, content (base64)}
 * @param {Array}  [params.cc]         - Array de emails CC
 * @param {Array}  [params.bcc]        - Array de emails BCC
 * @param {string} [params.reply_to]   - Email de reply-to
 * @returns {Promise<object>} Resultado de la API Brevo
 */
export async function callService(env, params) {
  const { discoverKeys, getKey, markCooldown } = await import('../keyRotator.js');

  // Descubrir keys disponibles (rotador BREVO_API_KEY_1..N)
  let keys = discoverKeys(env, 'BREVO');
  // Fallback al esquema de los otros workers OSINT: EMAIL_API_KEY / BREVO_API_KEY planas.
  if (!keys.length) {
    const flat = env && (env.EMAIL_API_KEY || env.BREVO_API_KEY);
    if (flat && typeof flat === 'string' && flat.length) {
      keys = [{ index: 1, key: flat }];
    }
  }
  if (!keys.length) {
    return { ok: false, error: 'BREVO_API_KEY no configurada. Agrega BREVO_API_KEY_1 (o EMAIL_API_KEY / BREVO_API_KEY) en Variables de entorno.' };
  }

  // Remitente: BREVO_SENDER_* o FROM_EMAIL/FROM_NAME (esquema compartido con los otros workers)
  const senderEmail = params.sender_email || (env && (env.BREVO_SENDER_EMAIL || env.FROM_EMAIL)) || null;
  const senderName  = params.sender_name  || (env && (env.BREVO_SENDER_NAME || env.FROM_NAME)) || 'Véritas AI';

  if (!senderEmail) {
    return { ok: false, error: 'BREVO_SENDER_EMAIL no configurado. Define el email remitente verificado en Brevo.' };
  }

  // Normalizar destinatario a array
  const toList = Array.isArray(params.to) ? params.to : [params.to];
  const recipients = toList
    .filter(function(e) { return e && e.includes('@'); })
    .map(function(e) { return { email: e.trim() }; });

  if (!recipients.length) {
    return { ok: false, error: 'No hay destinatarios válidos.' };
  }

  // Construir payload Brevo
  let body = {
    sender: { name: senderName, email: senderEmail },
    to: recipients,
    subject: params.subject || '(sin asunto)',
  };

  if (params.html) {
    body.htmlContent = params.html;
  }
  if (params.text) {
    body.textContent = params.text;
  }
  if (!params.html && !params.text) {
    body.textContent = '(sin contenido)';
  }
  if (params.cc && params.cc.length) {
    body.cc = params.cc.filter(function(e) { return e && e.includes('@'); }).map(function(e) { return { email: e.trim() }; });
  }
  if (params.bcc && params.bcc.length) {
    body.bcc = params.bcc.filter(function(e) { return e && e.includes('@'); }).map(function(e) { return { email: e.trim() }; });
  }
  if (params.reply_to) {
    body.replyTo = { email: params.reply_to.trim() };
  }
  if (params.attachments && params.attachments.length) {
    body.attachment = params.attachments.map(function(a) {
      return { name: a.name || 'archivo', content: a.content };
    });
  }

  // Intentar con cada key (rotación)
  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].value;
    const keyIndex = keys[i].index;

    try {
      let response = await fetch(BREVO_BASE + '/smtp/email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': key,
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // Rate limit (429) → cooldown y siguiente key
      if (response.status === 429) {
        markCooldown(env, 'BREVO', keyIndex, 60 * 60 * 1000, 'rate_limit_429');
        lastError = 'Rate limit (429). Key ' + (keyIndex + 1) + ' en cooldown 1h.';
        continue;
      }

      // Auth error (401/403) → marcar cooldown largo
      if (response.status === 401 || response.status === 403) {
        markCooldown(env, 'BREVO', keyIndex, 24 * 60 * 60 * 1000, 'auth_error_' + response.status);
        lastError = 'Auth error (' + response.status + '). Key ' + (keyIndex + 1) + ' deshabilitada 24h.';
        continue;
      }

      let data;
      try { data = await response.json(); } catch (e) { data = null; }

      if (response.ok) {
        return {
          ok: true,
          messageId: data && data.messageId ? data.messageId : null,
          status: response.status,
          key_used: keyIndex + 1,
        };
      }

      // Otro error de API
      lastError = (data && data.message) ? data.message : ('HTTP ' + response.status);
      if (response.status >= 500) {
        // Server error → no marcar cooldown, reintentar siguiente key
        continue;
      }
      // 4xx client error (no 401/403/429) → no reintentar, es error del request
      break;

    } catch (err) {
      lastError = 'Error de conexión: ' + (err.message || err);
      continue;
    }
  }

  return { ok: false, error: lastError || 'Todas las keys de Brevo fallaron.' };
}
