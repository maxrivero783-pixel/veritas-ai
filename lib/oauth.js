// ==============================================================================
// Véritas v2.12 — /lib/oauth.js
// ==============================================================================
// Helper común para OAuth de conexiones externas (GitHub y futuros proveedores).
// Cubre:
//   - Cifrado AES-GCM 256 de tokens en reposo (tabla external_connections).
//   - Resolución de conexión válida para un usuario + provider, con refresh
//     transparente si el token está a <60s de expirar.
//   - Auditoría de llamadas a APIs externas (tabla external_api_calls).
//   - Detección de revocación (401 → marcar invalid=1).
//
// NO cubre pools de claves server-side (eso está en /lib/keyRotator.js).
//
// Dependencias: Web Crypto API (disponible nativamente en Workers runtime).
// ==============================================================================

/* global crypto */

import { getOAuthAdapter } from "./services/oauth/_adapters.js";

// ------------------------------------------------------------------------------
// Errores tipados
// ------------------------------------------------------------------------------
export class OAuthNotConnectedError extends Error {
  constructor(provider, userEmail) {
    super(`User ${userEmail} has no active connection for provider ${provider}.`);
    this.name = "OAuthNotConnectedError";
    this.provider = provider;
    this.userEmail = userEmail;
  }
}

export class OAuthInvalidError extends Error {
  constructor(provider, userEmail) {
    super(`Connection for ${provider} of ${userEmail} was revoked. User must reconnect in Settings.`);
    this.name = "OAuthInvalidError";
    this.provider = provider;
    this.userEmail = userEmail;
  }
}

// ------------------------------------------------------------------------------
// encryptToken / decryptToken — AES-GCM 256.
// Formato del ciphertext almacenado: base64(iv || ciphertext || tag)
// donde iv es de 12 bytes y el tag va al final (estándar AES-GCM en Web Crypto).
// ------------------------------------------------------------------------------
const IV_BYTES = 12;
const KEY_BYTES = 32; // 256 bits

async function deriveKey(env) {
  const raw = env.OAUTH_ENCRYPTION_KEY;
  if (!raw) throw new Error("OAUTH_ENCRYPTION_KEY secret missing. Run: wrangler secret put OAUTH_ENCRYPTION_KEY");
  // Acepta hex (64 chars) o UTF-8; en hex, decodificamos a bytes.
  let keyBytes;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    keyBytes = hexToBytes(raw);
  } else {
    keyBytes = new TextEncoder().encode(raw);
    if (keyBytes.length !== KEY_BYTES) {
      // Si no son 32 bytes, derivamos con SHA-256 para garantizar el tamaño.
      keyBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
    }
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(env, plaintext) {
  if (!plaintext) return null;
  const key = await deriveKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  const ciphertext = new Uint8Array(ciphertextBuf);
  // Concatenar iv + ciphertext (este último ya incluye el tag GCM al final).
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return bytesToBase64(combined);
}

export async function decryptToken(env, base64) {
  if (!base64) return null;
  const key = await deriveKey(env);
  const combined = base64ToBytes(base64);
  if (combined.length < IV_BYTES + 16) throw new Error("Ciphertext too short"); // 16 = GCM tag
  const iv = combined.slice(0, IV_BYTES);
  const ciphertext = combined.slice(IV_BYTES);
  const plaintextBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintextBuf);
}

// ------------------------------------------------------------------------------
// Helpers de conversión
// ------------------------------------------------------------------------------
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBytes(b64) {
  // Soporta base64 url-safe sustituyendo - → + y _ → /
  const normalized = b64.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(normalized);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------------------------
// getValidConnection: devuelve { accessToken, refreshToken?, scopes, metadata,
// expiresAt } listo para usar por el adaptador. Si el token expira en <60s,
// hace refresh transparente y actualiza la fila en D1.
//
// Lanza OAuthNotConnectedError si no hay fila, OAuthInvalidError si invalid=1.
// ------------------------------------------------------------------------------
const REFRESH_THRESHOLD_MS = 60_000; // 60s antes de expirar

export async function getValidConnection(env, userEmail, provider) {
  const row = await env.DB.prepare(
    `SELECT access_token_encrypted, refresh_token_encrypted, scopes, expires_at,
            account_metadata, invalid
       FROM external_connections
      WHERE user_email = ? AND provider = ?`
  ).bind(userEmail, provider).first();

  if (!row) throw new OAuthNotConnectedError(provider, userEmail);
  if (row.invalid === 1) throw new OAuthInvalidError(provider, userEmail);

  const accessToken = await decryptToken(env, row.access_token_encrypted);
  const refreshToken = row.refresh_token_encrypted
    ? await decryptToken(env, row.refresh_token_encrypted)
    : null;

  const expiresAt = row.expires_at; // epoch ms o null (GitHub)

  // Si expira pronto y hay refresh token, refrescar transparentemente.
  if (expiresAt !== null && expiresAt - Date.now() < REFRESH_THRESHOLD_MS && refreshToken) {
    try {
      const refreshed = await refreshProviderToken(env, provider, refreshToken, {
        clientId: getClientId(env, provider),
        clientSecret: getClientSecret(env, provider),
      });
      const newAccessEnc = await encryptToken(env, refreshed.access_token);
      const newRefreshEnc = refreshed.refresh_token
        ? await encryptToken(env, refreshed.refresh_token)
        : row.refresh_token_encrypted; // mantener el anterior si el provider no rotó
      const newExpiresAt = Date.now() + (refreshed.expires_in_sec * 1000);

      await env.DB.prepare(
        `UPDATE external_connections
            SET access_token_encrypted = ?,
                refresh_token_encrypted = ?,
                expires_at = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE user_email = ? AND provider = ?`
      ).bind(newAccessEnc, newRefreshEnc, newExpiresAt, userEmail, provider).run();

      return {
        accessToken: refreshed.access_token,
        refreshToken: refreshToken, // lógica del provider decide si rotar
        scopes: row.scopes,
        metadata: row.account_metadata,
        expiresAt: newExpiresAt,
      };
    } catch (e) {
      // Si el refresh falló con 401, marcar invalid. Si no, devolver el token
      // viejo (quizá aún válido unos segundos) y dejar que el caller lo maneje.
      if (String(e.message).includes("401") || String(e.message).toLowerCase().includes("invalid_grant")) {
        await markConnectionInvalid(env, userEmail, provider);
        throw new OAuthInvalidError(provider, userEmail);
      }
      // Devolver token viejo; el caller verá el 401 del upstream y lo reportará.
    }
  }

  return {
    accessToken,
    refreshToken,
    scopes: row.scopes,
    metadata: row.account_metadata,
    expiresAt,
  };
}

// ------------------------------------------------------------------------------
// refreshProviderToken: despacha al adaptador del provider.
// Devuelve { access_token, refresh_token?, expires_in_sec }.
// ------------------------------------------------------------------------------
async function refreshProviderToken(env, provider, refreshToken, oauthCreds) {
  // v2.12i: mapa estático de adaptadores (el import dinámico con template
  // literal no se bundlea en Cloudflare Workers).
  const adapter = getOAuthAdapter(provider);
  if (!adapter) throw new Error(`Unknown OAuth provider: ${provider}`);
  const result = await adapter.refreshToken({
    refreshToken,
    clientId: oauthCreds.clientId,
    clientSecret: oauthCreds.clientSecret,
  });
  // GitHub.refreshToken es no-op (los tokens no expiran).
  return {
    access_token: result.access_token,
    refresh_token: result.refresh_token || null,
    expires_in_sec: result.expires_in_sec || 14400, // default 4h
  };
}

function getClientId(env, provider) {
  if (provider === "github") return env.GITHUB_OAUTH_CLIENT_ID;
  throw new Error(`Unknown provider: ${provider}`);
}

function getClientSecret(env, provider) {
  if (provider === "github") return env.GITHUB_OAUTH_CLIENT_SECRET;
  throw new Error(`Unknown provider: ${provider}`);
}

// ------------------------------------------------------------------------------
// markConnectionInvalid: marca una conexión como revocada (401 del upstream).
// El usuario verá el estado en Ajustes → Conexiones externas y podrá reconectar.
// ------------------------------------------------------------------------------
export async function markConnectionInvalid(env, userEmail, provider) {
  await env.DB.prepare(
    `UPDATE external_connections SET invalid = 1, updated_at = CURRENT_TIMESTAMP
      WHERE user_email = ? AND provider = ?`
  ).bind(userEmail, provider).run();
}

// ------------------------------------------------------------------------------
// auditExternalCall: registra una llamada a API externa OAuth en la tabla
// external_api_calls (auditoría).
// ------------------------------------------------------------------------------
export async function auditExternalCall(env, userEmail, provider, action, target, status, latencyMs) {
  try {
    await env.DB.prepare(
      `INSERT INTO external_api_calls (user_email, provider, action, target, status, latency_ms, ts)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(userEmail, provider, action, target, status, latencyMs).run();
  } catch (e) {
    // La auditoría no debe romper el flujo principal.
  }
}

// ------------------------------------------------------------------------------
// Helper: genera state aleatorio (32 bytes hex) y code_verifier PKCE.
// ------------------------------------------------------------------------------
export function generateOAuthState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generatePkceVerifier() {
  // PKCE code_verifier: 43-128 chars de [A-Z / a-z / 0-9 / - . _ ~]
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += charset[bytes[i] % charset.length];
  return out.slice(0, 96); // 96 chars dentro del rango permitido
}

export async function computePkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64(new Uint8Array(digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, ""); // base64url sin padding
}

// ------------------------------------------------------------------------------
// upsertConnection: guarda o actualiza la conexión del usuario tras el callback.
// Llamado por el router en /api/oauth/:provider/callback.
// ------------------------------------------------------------------------------
export async function upsertConnection(env, userEmail, provider, payload) {
  const accessEnc = await encryptToken(env, payload.access_token);
  const refreshEnc = payload.refresh_token ? await encryptToken(env, payload.refresh_token) : null;
  const expiresAt = payload.expires_in_sec
    ? Date.now() + payload.expires_in_sec * 1000
    : null; // GitHub: null (no expira)

  await env.DB.prepare(
    `INSERT OR REPLACE INTO external_connections
       (user_email, provider, access_token_encrypted, refresh_token_encrypted,
        scopes, expires_at, account_metadata, invalid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(
    userEmail,
    provider,
    accessEnc,
    refreshEnc,
    payload.scopes || null,
    expiresAt,
    payload.account_metadata ? JSON.stringify(payload.account_metadata) : null
  ).run();
}

// ------------------------------------------------------------------------------
// rateLimitMessage: devuelve un mensaje amigable para el usuario cuando se
// agotan los reintentos automáticos de rate limit en el adaptador OAuth.
// Los tools llaman esta función al recibir un 429 del adaptador.
// ------------------------------------------------------------------------------
export function rateLimitMessage(provider) {
  if (provider === "github") {
    return "GitHub rate limit alcanzado tras reintentos automáticos. " +
           "Limites: 5,000 req/hora (autenticado), 30 req/min para search. " +
           "Espera unos minutos antes de volver a intentar.";
  }
  return `Rate limit alcanzado en ${provider}. Espera y vuelve a intentar.`;
}

export default {
  encryptToken,
  decryptToken,
  getValidConnection,
  markConnectionInvalid,
  auditExternalCall,
  generateOAuthState,
  generatePkceVerifier,
  computePkceChallenge,
  upsertConnection,
  OAuthNotConnectedError,
  OAuthInvalidError,
  rateLimitMessage,
};
