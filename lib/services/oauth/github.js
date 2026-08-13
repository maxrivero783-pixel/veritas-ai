import { fetchT } from '../http.js';
// ==============================================================================
// Véritas v2.3 — /lib/services/oauth/github.js
// ==============================================================================
// Adaptador OAuth GitHub (Authorization Code Flow con PKCE).
// Los tokens de GitHub App no expiran (hasta revocación). refreshToken es no-op.
//
// v2.3: apiCall() ahora maneja rate limits (403 + X-RateLimit-Remaining: 0, o 429)
// automáticamente con retry-backoff. Máximo MAX_RETRIES reintentos.
//
// API común que deben implementar todos los adaptadores /lib/services/oauth/*.js:
//   getAuthUrl({ clientId, redirectUri, scopes, state, codeChallenge })
//       → string URL a la que el Worker hace 302.
//   exchangeCode({ code, codeVerifier, clientId, clientSecret, redirectUri })
//       → { access_token, refresh_token?, expires_in_sec?, scopes }
//   refreshToken({ refreshToken, clientId, clientSecret })
//       → { access_token, refresh_token?, expires_in_sec? }  (GitHub: no-op)
//   apiCall({ accessToken, method, path, body, headers })
//       → Response del upstream (con status, headers, body).
//   getAccountInfo({ accessToken })
//       → { login, name, email, avatar }  para guardar en external_connections.
// ==============================================================================

const AUTH_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_BASE = "https://api.github.com";

const DEFAULT_SCOPES = ["repo", "user:email"];

// ------------------------------------------------------------------------------
// getAuthUrl
// ------------------------------------------------------------------------------
export function getAuthUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  const scopeStr = (scopes && scopes.length ? scopes : DEFAULT_SCOPES).join(" ");
  url.searchParams.set("scope", scopeStr);
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

// ------------------------------------------------------------------------------
// exchangeCode: POST al token endpoint con code + code_verifier (PKCE).
// GitHub devuelve JSON si pedimos Accept: application/json.
// ------------------------------------------------------------------------------
export async function exchangeCode({ code, codeVerifier, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const resp = await fetchT(TOKEN_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // GitHub a veces devuelve querystring en lugar de JSON; parsear.
    data = Object.fromEntries(new URLSearchParams(text));
  }

  if (!data.access_token) {
    const err = new Error(`GitHub exchangeCode failed: ${data.error || text}`);
    err.status = resp.status;
    err.payload = data;
    throw err;
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || null, // GitHub no emite refresh_token
    expires_in_sec: data.expires_in ? Number(data.expires_in) : null, // null = no expira
    scopes: data.scope ? data.scope.split(" ").join(",") : DEFAULT_SCOPES.join(","),
  };
}

// ------------------------------------------------------------------------------
// refreshToken: GitHub no usa refresh tokens. No-op que devuelve el token
// recibido. Si el token fue revocado, la próxima apiCall dará 401 y el
// caller (lib/oauth.js) marcará la conexión como invalid.
// ------------------------------------------------------------------------------
export async function refreshToken({ refreshToken, clientId, clientSecret }) {
  return {
    access_token: refreshToken, // sin cambio
    refresh_token: refreshToken,
    expires_in_sec: null, // GitHub tokens no expiran
  };
}

// ------------------------------------------------------------------------------
// apiCall: hace una llamada a api.github.com con Authorization: token <token>.
// `path` puede ser relativo ("/user/repos") o absoluto ("https://...").
// ------------------------------------------------------------------------------
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 1000;

export async function apiCall({ accessToken, method = "GET", path, body, headers = {} }) {
  const url = path.startsWith("http") ? path : API_BASE + (path.startsWith("/") ? path : "/" + path);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const init = {
      method,
      headers: {
        "Authorization": `token ${accessToken}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Véritas/2.3",
        ...headers,
      },
    };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    const resp = await fetchT(url, init);

    // v2.3: Rate limit handling — GitHub usa dos patrones:
    //   1. HTTP 403 + header X-RateLimit-Remaining: 0 (secondary rate limit)
    //   2. HTTP 429 + header Retry-After (abuse rate limit)
    // Límites: 5,000 req/hora (autenticado), 30 req/min para search.
    const rateLimitRemaining = resp.headers.get("X-RateLimit-Remaining");
    if (resp.status === 403 && rateLimitRemaining !== null && parseInt(rateLimitRemaining) === 0 && attempt < MAX_RETRIES) {
      const resetEpoch = parseInt(resp.headers.get("X-RateLimit-Reset") || "0") * 1000;
      const waitMs = Math.max(resetEpoch - Date.now() + 500, BASE_BACKOFF_MS * (attempt + 1));
      console.log(`[github] Rate limited (403, remaining=0), retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (resp.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = parseInt(resp.headers.get("Retry-After") || "0") * 1000;
      const waitMs = Math.max(retryAfter, BASE_BACKOFF_MS * (attempt + 1));
      console.log(`[github] Rate limited (429), retry ${attempt + 1}/${MAX_RETRIES} after ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    return resp;
  }

  // Teóricamente inalcanzable (MAX_RETRIES agotado), pero por seguridad.
  return new Response(JSON.stringify({ message: "GitHub rate limit: max retries exceeded" }), { status: 429 });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------------------------
// getAccountInfo: GET /user → metadatos para external_connections.
// ------------------------------------------------------------------------------
export async function getAccountInfo({ accessToken }) {
  const resp = await apiCall({ accessToken, method: "GET", path: "/user" });
  if (!resp.ok) {
    const err = new Error(`GitHub getAccountInfo failed: HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  return {
    login: data.login,
    name: data.name || data.login,
    email: data.email || null,
    avatar: data.avatar_url || null,
    raw: { id: data.id, html_url: data.html_url },
  };
}

export default {
  getAuthUrl,
  exchangeCode,
  refreshToken,
  apiCall,
  getAccountInfo,
  DEFAULT_SCOPES,
};
