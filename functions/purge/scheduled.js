// ==============================================================================
// Véritas v2.3 — /functions/purge/scheduled.js
// ==============================================================================
// Cloudflare Workers Cron Trigger para limpieza periódica.
// Se ejecuta cada 6 horas (configurado en wrangler.toml como [triggers] cron).
//
// Tareas realizadas en cada ejecución:
//   1. Purgar mensajes de chats inactivos (>30 días sin actividad).
//      - Se conservan los últimos 2 mensajes (el último intercambio) para contexto.
//      - El summary_json del chat NO se toca (preserva el resumen).
//      - Se calcula la fecha de corte: NOW - 30 días.
//
//   2. Purgar memorias expiradas (user_memories.expires_at < NOW).
//      - Esto es complementario al filtro en GET /api/memories, que ya
//        excluye las expiradas. El cron limpia el almacenamiento.
//
//   3. Purgar oauth_pending viejos (>15 minutos, como indica schema.sql).
//      - Estos states se generan durante el flujo OAuth PKCE y deberían
//        canjearse en segundos. Si quedan, son abandonados.
//
//   4. Purgar chat_turn_lock expirados (expires_at < NOW).
//      - Bloqueos que no se liberaron correctamente (ej: usuario cerró pestaña).
//
// Notas de D1:
//   - D1 tiene límite de 500 filas afectadas por DELETE sin WHERE rowid.
//   - Para tablas grandes, usamos batch DELETE con LIMIT + loop.
//   - D1 no soporta DELETE con JOIN; usamos subquery.
// ==============================================================================

import { discoverKeys } from '../../lib/keyRotator.js';
import { callService as brevoCall } from '../../lib/services/brevo.js';

const QUOTA_THRESHOLD_PCT = 25;

// Consulta el % restante de cuota de un proveedor (best-effort).
// NOTA (v2.7.1): quotaRemainingPct también existe en lib/quotaGuard.js con firma
// diferente (service, apiKey) vs (env, service, endpoint, parse).
// La de quotaGuard es para el consent gate; la de aquí es para el cron de alertas.
// Se mantienen separadas porque tienen propósitos y firmas distintas.

async function quotaRemainingPct(env, service, endpoint, parse) {
  try {
    const keys = discoverKeys(env, service);
    if (!keys.length) return null;
    const resp = await fetch(endpoint(keys[0].value), { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data) return null;
    return parse(data);
  } catch { return null; }
}

// Envía email de alerta (con dedupe diario vía notification_events).
async function notifyQuotaLow(env, service, pct) {
  try {
    const dedupeKey = `${service}:${new Date().toISOString().slice(0, 10)}`;
    const existing = await env.DB.prepare(
      "SELECT id FROM notification_events WHERE event_type = 'quota_low' AND dedupe_key = ?"
    ).bind(dedupeKey).first();
    if (existing) return false; // ya notificado hoy

    const recipients = [];
    if (env.ADMIN_EMAILS) recipients.push(...env.ADMIN_EMAILS.split(",").map((e) => e.trim()).filter(Boolean));
    if (env.DEV_USER_EMAIL) recipients.push(env.DEV_USER_EMAIL.trim());
    if (!recipients.length) return false;

    const keys = discoverKeys(env, "brevo");
    if (!keys.length) return false;
    const { key } = await import('../../lib/keyRotator.js').then((m) => m.getKey(env, "brevo"));

    const subject = `⚠️ Cuota baja: ${service} (${pct}% restante) — Véritas`;
    const text = `Véritas AI — Aviso de cuota baja.

El proveedor ${service} tiene solo ${pct}% de cuota restante en su plan gratuito.
Cuando se agote, las herramientas que dependen de él dejarán de funcionar hasta el próximo ciclo.

Recomendado:
- Revisar el dashboard de uso en Véritas (Ajustes → Dashboard).
- Considerar añadir otra key (${service.toUpperCase()}_API_KEY_2) o migrar a plan de pago.

— Remitido por Véritas, la IA especializada en OSINT -`;
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;color:#374151;"><h3 style="color:#b45309;">⚠️ Cuota baja: ${service}</h3><p>El proveedor <strong>${service}</strong> tiene solo <strong>${pct}%</strong> de cuota restante en su plan gratuito.</p><p>Cuando se agote, las herramientas que dependen de él dejarán de funcionar hasta el próximo ciclo.</p><p>Revisa el dashboard de uso (Ajustes → Dashboard) o añade otra key (<code>${service.toUpperCase()}_API_KEY_2</code>).</p><hr style="border:0;border-top:1px solid #d1d5db;"><p style="color:#6b7280;font-size:12px;">— Remitido por Véritas, la IA especializada en OSINT -</p></div>`;

    const result = await brevoCall({
      endpoint: "send_email",
      apiKey: key,
      payload: {
        sender: { name: env.BREVO_SENDER_NAME || "Véritas", email: env.BREVO_SENDER_EMAIL || "no-reply@veritas.local" },
        to: recipients.map((email) => ({ email })),
        subject,
        textContent: text,
        htmlContent: html,
        tags: ["veritas", "quota-alert"],
      },
    });

    if (result.status >= 200 && result.status < 300) {
      await env.DB.prepare(
        "INSERT INTO notification_events (user_email, event_type, dedupe_key, status, provider, recipient, subject) VALUES (?, 'quota_low', ?, 'sent', 'brevo', ?, ?)"
      ).bind(recipients[0], dedupeKey, recipients[0], subject).run();
      return true;
    }
    return false;
  } catch { return false; }
}

// Comprueba cuotas de los proveedores clave y alerta si están bajas.
async function checkQuotaAlerts(env) {
  const alerts = [];
  // Consultar con la primera key de cada servicio (endpoints de cuota fiables).
  // v2.7.3 — headers como función de la key (antes se evaluaba `k` fuera de
  // scope al construir el array → ReferenceError "k is not defined").
  const simple = [
    ["firecrawl", (k) => `https://api.firecrawl.dev/v1/key`, (k) => ({ Authorization: `Bearer ${k}` }), (d) => { const u = d.creditsUsed, l = d.maxCredits; return u != null && l ? Math.round(((l - u) / l) * 100) : null; }],
    ["jina", (k) => `https://api.jina.ai/v1/api-key/info`, (k) => ({ Authorization: `Bearer ${k}` }), (d) => { const u = d.used_credits ?? d.usedCredits, l = d.total_credits ?? d.totalCredits; return u != null && l ? Math.round(((l - u) / l) * 100) : null; }],
    ["shodan", (k) => `https://api.shodan.io/api-info?key=${k}`, () => ({}), (d) => { const u = d.usage?.query_credits, l = d.usage_limits?.query_credits; return u != null && l ? Math.round(((l - u) / l) * 100) : null; }],
  ];
  for (const [service, endpoint, headersFor, parse] of simple) {
    try {
      const keys = discoverKeys(env, service);
      if (!keys.length) continue;
      const resp = await fetch(endpoint(keys[0].value), { headers: headersFor(keys[0].value), signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const data = await resp.json().catch(() => null);
      if (!data) continue;
      const pct = parse(data);
      if (pct != null && pct < QUOTA_THRESHOLD_PCT) {
        const sent = await notifyQuotaLow(env, service, pct);
        alerts.push({ service, pct, notified: sent });
      }
    } catch { /* skip */ }
  }
  return alerts;
}

async function runPurge(env) {
  const now = Date.now();
  const results = {
    ts: new Date().toISOString(),
    messages_purged: 0,
    memories_purged: 0,
    oauth_pending_purged: 0,
    turn_locks_purged: 0,
    audit_logs_purged: 0,
    backup: null,
    quota_alerts: [],
  };

  // --------------------------------------------------------------------------
  // 0a. Alertas de cuota baja (cada 6h; email con dedupe diario).
  // --------------------------------------------------------------------------
  try {
    results.quota_alerts = await checkQuotaAlerts(env);
  } catch (e) {
    results.quota_alerts = "error: " + (e && e.message ? e.message : String(e));
  }

  // --------------------------------------------------------------------------
  // 0. Backup diario de D1 → R2 (una vez al día, 03:00 UTC). Retención 30 días.
  // --------------------------------------------------------------------------
  try {
    const h = new Date().getUTCHours();
    if (h === 3 && env.DB && env.BUCKET) {
      const tables = ["users", "chats", "messages", "repo_documents", "external_connections", "user_memories", "user_skills", "notification_events", "async_jobs"];
      const dump = {};
      for (const t of tables) {
        try {
          const res = await env.DB.prepare(`SELECT * FROM ${t}`).all();
          dump[t] = res.results || [];
        } catch { dump[t] = []; }
      }
      const dateStr = new Date().toISOString().slice(0, 10);
      const key = `backups/veritas-${dateStr}.json`;
      await env.BUCKET.put(key, JSON.stringify({ backup_at: new Date().toISOString(), tables: dump }), {
        httpMetadata: { contentType: "application/json" },
      });
      // Retención: borrar backups de hace más de 30 días.
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const listed = await env.BUCKET.list({ prefix: "backups/" });
      for (const obj of listed.objects || []) {
        const day = obj.key.replace("backups/veritas-", "").replace(".json", "");
        if (day < cutoff) await env.BUCKET.delete(obj.key);
      }
      results.backup = { key, tables: Object.keys(dump).length };
    } else {
      results.backup = "skip";
    }
  } catch (e) {
    results.backup = "error: " + (e && e.message ? e.message : String(e));
  }

  // --------------------------------------------------------------------------
  // 1. Purgar mensajes de chats inactivos (>30 días).
  // --------------------------------------------------------------------------
  // Estrategia: encontrar chats con updated_at > 30 días atrás, y para cada
  // uno, borrar mensajes ANTES de los últimos 2, conservando el contexto mínimo.
  // Si el chat tiene ≤2 mensajes, no se toca.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Encontrar chats inactivos que tengan >2 mensajes.
    const staleChats = await env.DB.prepare(`
      SELECT c.id, COUNT(m.id) as msg_count
      FROM chats c
      INNER JOIN messages m ON m.chat_id = c.id
      WHERE c.updated_at < ?
      GROUP BY c.id
      HAVING msg_count > 2
    `).bind(thirtyDaysAgo).all();

    for (const chat of (staleChats.results || [])) {
      // Encontrar el ID del 2° mensaje más reciente (para conservar los últimos 2).
      const keepAfter = await env.DB.prepare(`
        SELECT id FROM messages
        WHERE chat_id = ?
        ORDER BY created_at DESC
        LIMIT 1 OFFSET 1
      `).bind(chat.id).first();

      if (!keepAfter) continue;

      // Borrar todos los mensajes con created_at ANTERIOR al 2° más reciente.
      // Esto conserva los 2 últimos mensajes del chat.
      const del = await env.DB.prepare(`
        DELETE FROM messages
        WHERE chat_id = ? AND id != ? AND created_at < (
          SELECT created_at FROM messages WHERE id = ?
        )
      `).bind(chat.id, keepAfter.id, keepAfter.id).run();

      results.messages_purged += del.meta.changes || 0;
    }
  } catch (e) {
    console.error("[purge] Error purgando mensajes:", e);
  }

  // --------------------------------------------------------------------------
  // 2. Purgar memorias expiradas.
  // --------------------------------------------------------------------------
  try {
    // Borrar en lotes de 500 (límite D1).
    let totalDeleted = 0;
    let batch;
    do {
      batch = await env.DB.prepare(`
        DELETE FROM user_memories WHERE expires_at IS NOT NULL AND expires_at < ?
        AND id IN (
          SELECT id FROM user_memories WHERE expires_at IS NOT NULL AND expires_at < ? LIMIT 500
        )
      `).bind(now, now).run();
      totalDeleted += batch.meta.changes || 0;
    } while ((batch.meta.changes || 0) >= 500);

    results.memories_purged = totalDeleted;
  } catch (e) {
    console.error("[purge] Error purgando memorias:", e);
  }

  // --------------------------------------------------------------------------
  // 3. Purgar oauth_pending viejos (>15 minutos).
  // --------------------------------------------------------------------------
  try {
    const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const del = await env.DB.prepare(
      `DELETE FROM oauth_pending WHERE created_at < ?`
    ).bind(fifteenMinAgo).run();
    results.oauth_pending_purged = del.meta.changes || 0;
  } catch (e) {
    console.error("[purge] Error purgando oauth_pending:", e);
  }

  // --------------------------------------------------------------------------
  // 4. Purgar chat_turn_lock expirados.
  // --------------------------------------------------------------------------
  try {
    const del = await env.DB.prepare(
      `DELETE FROM chat_turn_lock WHERE expires_at < ?`
    ).bind(now).run();
    results.turn_locks_purged = del.meta.changes || 0;
  } catch (e) {
    console.error("[purge] Error purgando turn locks:", e);
  }

  // --------------------------------------------------------------------------
  // 5. Purgar tablas de auditoría (>90 días) — evita agotar D1 free (5GB/5M filas).
  //    openrouter_calls, tool_calls, external_api_calls crecen sin techo.
  //    D1 limita DELETE a 500 filas sin rowid: usamos batch DELETE con LIMIT + loop.
  // --------------------------------------------------------------------------
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const auditTables = [
      { table: "openrouter_calls", col: "ts" },
      { table: "tool_calls", col: "ts" },
      { table: "external_api_calls", col: "ts" },
    ];
    for (const t of auditTables) {
      let total = 0;
      for (;;) {
        const batch = await env.DB.prepare(
          `DELETE FROM ${t.table} WHERE ${t.col} < ? AND id IN (SELECT id FROM ${t.table} WHERE ${t.col} < ? LIMIT 500)`
        ).bind(cutoff, cutoff).run();
        const changes = batch.meta.changes || 0;
        total += changes;
        if (changes < 500) break;
      }
      results.audit_logs_purged += total;
      if (total > 0) console.log(`[purge] ${t.table}: purgadas ${total} filas (>90 días)`);
    }
  } catch (e) {
    console.error("[purge] Error purgando tablas de auditoría:", e);
  }

  console.log("[purge] Ejecución completada:", JSON.stringify(results));

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}


// ------------------------------------------------------------------------------
// v2.7.2 — Cloudflare Pages NO soporta Cron Triggers ni el export `scheduled`
// (eso es solo de Workers). Por eso la purga se expone también como endpoint
// HTTP protegido, invocable por un programador externo cada 6 horas:
//
//   GET/POST /purge/scheduled   + header "x-purge-secret" (o ?secret=...)
//
// El programador puede ser GitHub Actions (ver .github/workflows/cron-purge.yml)
// o un servicio tipo cron-job.org. Requiere env.PURGE_SECRET configurado.
// ------------------------------------------------------------------------------
export async function scheduled(event, env, ctx) {
  // Se conserva por si en el futuro se migra a un Worker con Cron Trigger.
  return runPurge(env);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const provided = request.headers.get("x-purge-secret") || url.searchParams.get("secret") || "";
  if (!env.PURGE_SECRET || provided !== env.PURGE_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized", message: "Falta o es inválido x-purge-secret." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "no_db", message: "D1 no está configurado." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  return runPurge(env);
}
