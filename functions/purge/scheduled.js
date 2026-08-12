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

export async function scheduled(event, env, ctx) {
  const now = Date.now();
  const results = {
    ts: new Date().toISOString(),
    messages_purged: 0,
    memories_purged: 0,
    oauth_pending_purged: 0,
    turn_locks_purged: 0,
    backup: null,
  };

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

  console.log("[purge] Ejecución completada:", JSON.stringify(results));

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}
