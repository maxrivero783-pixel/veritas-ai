-- ============================================================================
-- Véritas v2.12v — Migración OPCIONAL: eliminar columna code_verifier (PKCE).
-- ----------------------------------------------------------------------------
-- GitHub OAuth Apps NO soportan PKCE; el código ya ignora challenge/verifier.
-- Esta migración elimina la columna para limpieza. ES OPCIONAL: dejar la
-- columna es inofensivo (el Worker la escribe pero nadie la lee).
--
-- ⚠️ Aplicar SOLO si se quiere consistencia total. En D1:
--   wrangler d1 execute veritas-db --remote --file=docs/migrations/2026-08-18-drop-pkce-oauth_pending.sql
--
-- Si se aplica, el código debe dejar de insertar code_verifier (ver P3 del
-- informe). Mientras NO se aplique, el Worker sigue insertando el verifier
-- (necesario porque la columna es NOT NULL). No romper nada en ninguno de los
-- dos estados.
-- ============================================================================
CREATE TABLE IF NOT EXISTS oauth_pending_new (
  state TEXT PRIMARY KEY,
  user_email TEXT NOT NULL,
  provider TEXT NOT NULL,
  redirect_after TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO oauth_pending_new (state, user_email, provider, redirect_after, created_at)
  SELECT state, user_email, provider, redirect_after, created_at FROM oauth_pending;
DROP TABLE oauth_pending;
ALTER TABLE oauth_pending_new RENAME TO oauth_pending;
CREATE INDEX IF NOT EXISTS idx_oauth_pending_user ON oauth_pending(user_email, created_at);
