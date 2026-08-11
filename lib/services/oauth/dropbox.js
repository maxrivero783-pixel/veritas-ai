// ==============================================================================
// Véritas v2.3 — /lib/services/oauth/dropbox.js
// ==============================================================================
// Adaptador OAuth Dropbox (Authorization Code Flow con PKCE, Scoped access).
// Los tokens expiran en 4 horas. refreshToken hace POST /oauth2/token con
// grant_type=refresh_token.
//
// v2.3: apiCall() ahora maneja rate limits (429) automáticamente con
// retry-backoff. Máximo MAX_RETRIES reintentos. Dropbox usa header Retry-After.
//
// API común con el resto de /lib/services/oauth/*.js (ver github.js para
// documentación de la interfaz).
// ==============================================================================

const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const API_BASE = "https://api.dropboxapi.com/2";
const CONTENT_BASE = "https://content.dropboxapi.com/2";

const DEFAULT_SCOPES = ["files.content.read", "files.content.write", "files.metadata.read"];

// ------------------------------------------------------------------------------
// getAuthUrl: Dropbox soporta PKCE. No usa scopes en la URL; los permisos se
// configuran en el dashboard de la App.
// ------------------------------------------------------------------------------
export function getAuthUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  // scope: Dropbox exige formato "account_info.read files.content.read ..."
  // Los scopes activos deben coincidir con los configurados en el dashboard.
  // Si el caller pasa scopes, los unimos con espacios; si no, usamos defaults.
  const scopeStr = (scopes && scopes.length ? scopes : DEFAULT_SCOPES).join(" ");
  url.searchParams.set("scope", scopeStr);
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  // token_access_type=offline → pide refresh_token.
  url.searchParams.set("token_access_type", "offline");
  return url.toString();
}

// ------------------------------------------------------------------------------
// exchangeCode: POST form-urlencoded al token endpoint.
// Dropbox devuelve JSON con access_token, refresh_token, expires_in (segundos),
// account_id, scope, uid, token_type=bearer.
// ------------------------------------------------------------------------------
export async function exchangeCode({ code, codeVerifier, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }

  if (!data.access_token) {
    const err = new Error(`Dropbox exchangeCode failed: ${data.error_description || data.error || text}`);
    err.status = resp.status;
    err.payload = data;
    throw err;
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null,
    expires_in_sec: data.expires_in ? Number(data.expires_in) : 14400, // default 4h
    scopes: data.scope ? data.scope.split(" ").join(",") : DEFAULT_SCOPES.join(","),
  };
}

// ------------------------------------------------------------------------------
// refreshToken: POST /oauth2/token con grant_type=refresh_token.
// Dropbox NO rota el refresh_token (el mismo se reutiliza indefinidamente hasta
// revocación). Solo el access_token cambia.
// ------------------------------------------------------------------------------
export async function refreshToken({ refreshToken, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }

  if (!data.access_token) {
    const err = new Error(`Dropbox refreshToken failed: ${data.error_description || data.error || text}`);
    err.status = resp.status;
    err.payload = data;
    throw err;
  }

  return {
    access_token: data.access_token,
    refresh_token: refreshToken, // NO se rota en Dropbox
    expires_in_sec: data.expires_in ? Number(data.expires_in) : 14400,
  };
}

// ------------------------------------------------------------------------------
// apiCall: Dropbox tiene 2 bases:
//   - api.dropboxapi.com/2/*      (RPC, body JSON)
//   - content.dropboxapi.com/2/*  (upload/download, body binario)
// El caller decide cuál usar pasando path absoluto o relativo.
// Para llamadas RPC, los argumentos van en header Dropbox-API-Arg.
//
// v2.3: Rate limit handling automático.
// Dropbox devuelve HTTP 429 con header Retry-After (segundos) cuando se excede
// el rate limit. La estrategia es esperar y reintentar hasta MAX_RETRIES veces.
// Nota: para uploads, el retry implica re-enviar el body completo. Esto es
// aceptable porque el body está en memoria (ya viene como string/ArrayBuffer
// del tool handler). Para archivos >150MB se requeriría upload_session_start,
// pero eso está fuera del scope de estas tools.
// ------------------------------------------------------------------------------
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 1000;

export async function apiCall({ accessToken, method = "POST", path, body, headers = {}, apiArg }) {
  // Detectar si es endpoint de contenido (upload/download) o RPC.
  const isContent = path.startsWith("/files/upload")
                  || path.startsWith("/files/download")
                  || path.startsWith("/files/get_thumbnail_v2")
                  || path.startsWith("/files/get_thumbnail");

  const base = isContent ? CONTENT_BASE : API_BASE;
  const url = path.startsWith("http") ? path : base + (path.startsWith("/") ? path : "/" + path);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const init = {
      method,
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        ...headers,
      },
    };

    if (apiArg !== undefined) {
      init.headers["Dropbox-API-Arg"] = JSON.stringify(apiArg);
    }

    if (body !== undefined) {
      if (isContent && typeof body !== "string") {
        // upload: body es binario (string o ArrayBuffer); Content-Type binario.
        init.body = body;
        init.headers["Content-Type"] = "application/octet-stream";
      } else {
        // RPC: body va en Dropbox-API-Arg, no en body. Si el caller pasó body,
        // lo serializamos en apiArg si no se pasó explícitamente.
        if (apiArg === undefined) {
          init.headers["Dropbox-API-Arg"] = JSON.stringify(body);
        } else {
          init.body = typeof body === "string" ? body : JSON.stringify(body);
          init.headers["Content-Type"] = "application/json";
        }
      }
    }

    const resp = await fetch(url, init);

    // v2.3: Rate limit handling — Dropbox devuelve 429 con Retry-After.
    // Dropbox no tiene un header X-RateLimit-Remaining como GitHub; solo 429.
    // También puede devolver 429 si el token necesita refresh (caso raro).
    if (resp.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterSec = parseFloat(resp.headers.get("Retry-After") || "1");
      const waitMs = Math.max(retryAfterSec * 1000, BASE_BACKOFF_MS * (attempt + 1));
      console.log(`[dropbox] Rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    return resp;
  }

  // Teóricamente inalcanzable (MAX_RETRIES agotado), pero por seguridad.
  return new Response(JSON.stringify({ error_summary: "rate_limit", error: { ".tag": "rate_limit" } }), { status: 429 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------------------
// getAccountInfo: POST /users/get_current_account (sin body).
// ------------------------------------------------------------------------------
export async function getAccountInfo({ accessToken }) {
  const resp = await apiCall({
    accessToken,
    method: "POST",
    path: "/users/get_current_account",
    apiArg: {},
  });
  if (!resp.ok) {
    const err = new Error(`Dropbox getAccountInfo failed: HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return {
    login: data.email,
    name: data.name ? data.name.display_name : data.email,
    email: data.email,
    avatar: data.profile_photo_url || null,
    raw: {
      account_id: data.account_id,
      country: data.country,
      account_type: data.account_type ? data.account_type[".tag"] : null,
    },
  };
}

export default {
  getAuthUrl,
  exchangeCode,
  refreshToken,
  apiCall,
  getAccountInfo,
  DEFAULT_SCOPES,
  API_BASE,
  CONTENT_BASE,
};
