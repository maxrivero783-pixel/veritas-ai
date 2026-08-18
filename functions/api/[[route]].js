// ==============================================================================
// Véritas v2.12 — /functions/api/[[route]].js
// ==============================================================================
// Router principal del Worker. Cloudflare Pages detecta este archivo como
// Worker automáticamente (Pages Functions con catch-all route /api/*).
//
// Cubre TODOS los endpoints de las secciones 6.1 a 6.9 del BUILD:
//   6.1  search, scrape, storage (upload/list/download/delete),
//        repo (upload/get/list/delete), db/message, status
//   6.2  chat/openrouter (streaming SSE, rotador, sticky, caching, truncation,
//        persistencia de métricas)
//   6.3  status (actualizado)
//   6.4  keys (status, health, cooldown reset, services) — admin
//   6.5  tool/invoke (dispatcher), tools/registry
//   6.6  oauth (start, callback, disconnect, connections, account),
//        artifact/proxy, sandbox/templates
//   6.7  sesión compartida (share, revoke, join, participants, heartbeat,
//        messages, turn acquire/release, leave, delete share)
//   6.8  chat rename, suggest-title
//   6.9  chats/offline-bundle, chat messages?full=true
//
// Auth: Cloudflare Access inyecta el header `cf-access-user-email`. En dev
// local, fallback a env.DEV_USER_EMAIL. Validación en cada endpoint.
// ==============================================================================

import {
  SERVICE_REGISTRY,
  listServices,
  discoverKeys,
  getKey,
  markCooldown,
  markHealthy,
  withKeyRotation,
  getPoolStatus,
  forceHealthCheck,
  resetCooldown,
  KeyPoolEmptyError,
  AllKeysCooldownError,
} from "../../lib/keyRotator.js";

import {
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
} from "../../lib/oauth.js";

import {
  TOOL_REGISTRY_SERVER,
  isAllowed,
  validateArgs,
  publicRegistry,
  importHandler,
  parseToolCallXML,
  buildToolResultXML,
} from "../../lib/toolRegistry.server.js";

import { SYSTEM_PROMPTS, ROLE_TO_MODEL, MODEL_TO_ROLE, UI_ROLE_TO_PROMPT_KEY, LITE_AGENT_PROMPT } from "../../prompts.js";
import { getProvider, MODEL_PROVIDER } from "../../lib/fallbackChains.js";

// ------------------------------------------------------------------------------
// Whitelist de modelos OpenRouter permitidos (Sección 3.1 del BUILD).
// ------------------------------------------------------------------------------
const OPENROUTER_WHITELIST = new Set([
  // Stack Nemotron 3
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  // General permissive/free and code-first fallbacks
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-20b:free",
  "cohere/north-mini-code:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
]);

// ------------------------------------------------------------------------------
// Contexto por request (para CORS y helpers sin pasar request por todas partes).
// ------------------------------------------------------------------------------
let _ctxRequest = null;
let _ctxEnv = null;

function setCtx(req, env) { _ctxRequest = req; _ctxEnv = env; }

// Devuelve el Origin permitido ("DENY" si viene de otro sitio, null si no hay Origin).
function allowedOrigin() {
  const req = _ctxRequest;
  if (!req) return null;
  const origin = req.headers.get("Origin");
  if (!origin) return null; // mismo-origen (fetch interno) → sin ACAO, sin bloqueo
  try {
    const originHost = new URL(origin).host;
    const selfHost = new URL(req.url).host;
    const appOrigin = (_ctxEnv && _ctxEnv.APP_ORIGIN) || "";
    if (originHost === selfHost) return origin;
    if (appOrigin && origin === appOrigin) return origin;
    return "DENY";
  } catch { return "DENY"; }
}

// ------------------------------------------------------------------------------
// Helper: extraer user_email. Fuentes en orden:
//   1) Sesión de login (Authorization: Bearer <token> o header x-veritas-token)
//   2) Header Cloudflare Access (cf-access-user-email) — compatibilidad
//   3) DEV_USER_EMAIL (dev local)
// ------------------------------------------------------------------------------
async function getUserEmail(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (request.headers.get("x-veritas-token") || "");
  if (token && env.DB) {
    try {
      const row = await env.DB.prepare(
        "SELECT s.user_email FROM sessions s WHERE s.token = ? AND s.expires_at > ?"
      ).bind(token, Date.now()).first();
      if (row && row.user_email) return String(row.user_email).toLowerCase();
    } catch { /* sesión inválida o D1 no disponible */ }
  }
  const fromHeader = request.headers.get("cf-access-user-email");
  if (fromHeader && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromHeader)) return fromHeader.toLowerCase();
  if (env.DEV_USER_EMAIL) return env.DEV_USER_EMAIL.toLowerCase();
  return null;
}

// ------------------------------------------------------------------------------
// Helper: respuestas JSON estándar (CORS restringido al propio origen).
// ------------------------------------------------------------------------------
function json(data, status = 200, extraHeaders = {}) {
  const ao = allowedOrigin();
  if (ao === "DENY") {
    return new Response(JSON.stringify({ error: "forbidden_origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(ao ? { "Access-Control-Allow-Origin": ao, "Vary": "Origin" } : {}),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-veritas-token, cf-access-user-email, x-veritas-role",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    ...extraHeaders,
  };
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(error, status, extra = {}) {
  return json({ error, ...extra }, status);
}

// ------------------------------------------------------------------------------
// Auth por email+contraseña (PBKDF2-SHA256 vía Web Crypto) + sesiones en D1.
// ------------------------------------------------------------------------------
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return { hash: bufToHex(bits), salt: bufToHex(salt) };
}
function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return bufToHex(b);
}
async function createSession(env, email) {
  const token = newToken();
  const expires = Date.now() + 7 * 24 * 3600 * 1000; // 7 días
  await env.DB.prepare("INSERT INTO sessions (token, user_email, expires_at) VALUES (?, ?, ?)")
    .bind(token, email, expires).run();
  return { token, expires_at: expires };
}
async function destroySession(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : (request.headers.get("x-veritas-token") || "");
  if (token && env.DB) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
}

// ------------------------------------------------------------------------------
// Rate limiting silencioso por usuario (D1). Devuelve { limited, retryAfterSec }.
// ------------------------------------------------------------------------------
async function rateLimit(env, userEmail, scope, limit, windowSec) {
  if (!env.DB || !userEmail) return { limited: false };
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${scope}:${userEmail}:${win}`;
  try {
    await env.DB.prepare(
      "INSERT INTO rate_limits (scope_key, count, window_start) VALUES (?, 1, ?) " +
      "ON CONFLICT(scope_key) DO UPDATE SET count = count + 1"
    ).bind(key, win * windowSec).run();
    const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE scope_key = ?").bind(key).first();
    const count = row ? Number(row.count) : 1;
    if (count > limit) {
      return { limited: true, retryAfterSec: Math.max(1, (win + 1) * windowSec - Math.floor(Date.now() / 1000)) };
    }
    return { limited: false };
  } catch {
    return { limited: false }; // fail-open silencioso
  }
}

// ------------------------------------------------------------------------------
// Caché de respuestas LLM (D1, TTL 24h). Opt-in con cache:true en el body.
// ------------------------------------------------------------------------------
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufToHex(digest);
}
async function llmCacheGet(env, key, userEmail) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT response_text, response_json FROM llm_cache WHERE cache_key = ? AND user_email = ? AND created_at > ?"
    ).bind(key, userEmail || "", Date.now() - 24 * 3600 * 1000).first();
    if (!row) return null;
    return { text: row.response_text, json: row.response_json ? JSON.parse(row.response_json) : null };
  } catch { return null; }
}
// ------------------------------------------------------------------------------
// Caché de resultados de tools de solo lectura (D1, TTL 15 min por defecto).
// ------------------------------------------------------------------------------
const TOOL_CACHE_TTL_MS = 15 * 60 * 1000;
// v2.7.3 — Tools cuya salida es PRIVADA por usuario (GitHub OAuth, archivos de
// proyecto en R2, repo documental). Su caché se saltea por user_email para
// evitar leak entre usuarios; el resto (datos públicos) sigue compartida.
const TOOL_CACHE_USER_SCOPED = new Set([
  "github_list_repos", "github_read_file", "read_project_file", "search_repository",
]);
const TOOL_CACHE_ALLOWLIST = new Set([
  "web_search", "scrape_url", "gdelt_search", "dns_lookup", "ner_extract",
  "wikipedia_search", "wikidata_search", "semantic_scholar_search", "openalex_search",
  "crossref_search", "nasa_search", "nvd_cve_search", "cisa_kev_search", "crtsh_lookup",
  "rdap_lookup", "geonames_search", "nominatim_search", "open_meteo_weather",
  "hackernews_search", "pypi_package_info", "npm_package_info", "sec_edgar_search",
  "shodan_search", "zoomeye_search", "intelx_search", "gfw_search", "jina_reader_search",
  "jina_github_search", "rover_scrape", "github_list_repos", "github_read_file",
  "search_repository",
  "read_project_file", "firecrawl_scrape", "exa_search", "scrapedo_scrape",
  "courtlistener_search", "aviationstack_flights",
]);

async function toolCacheGet(env, key) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT result_json FROM tool_cache WHERE cache_key = ? AND created_at > ?"
    ).bind(key, Date.now() - TOOL_CACHE_TTL_MS).first();
    if (!row) return null;
    try { return JSON.parse(row.result_json); } catch { return null; }
  } catch { return null; }
}
async function toolCacheSet(env, key, userEmail, toolName, result) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO tool_cache (cache_key, user_email, tool_name, result_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(cache_key) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at"
    ).bind(key, userEmail, toolName, JSON.stringify(result), 200, Date.now()).run();
  } catch { /* best-effort */ }
}

async function llmCacheSet(env, key, text, responseJson, model, userEmail) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO llm_cache (cache_key, user_email, response_text, response_json, model, created_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(cache_key) DO UPDATE SET response_text = excluded.response_text, response_json = excluded.response_json, model = excluded.model, created_at = excluded.created_at"
    ).bind(key, userEmail || "", text || "", responseJson ? JSON.stringify(responseJson) : null, model || "", Date.now()).run();
  } catch { /* best-effort */ }
}

// ------------------------------------------------------------------------------
// Helper: admin check (para endpoints /api/keys/*).
// ------------------------------------------------------------------------------
function isAdmin(userEmail, env) {
  if (!userEmail || !env.ADMIN_EMAILS) return false;
  const admins = env.ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase());
  return admins.includes(userEmail);
}

// ------------------------------------------------------------------------------
// Helper: slugify para nombres de archivo en R2 (anti path traversal).
// ------------------------------------------------------------------------------
function slugify(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 128);
}

// ------------------------------------------------------------------------------
// Helper: rutas públicas (bypass de auth — usadas por callbacks OAuth).
// ------------------------------------------------------------------------------
function isPublicPath(path) {
  // OAuth: flujo de autorización (start/callback) es público.
  if (/^\/api\/oauth\/[^/]+\/(start|callback)$/.test(path)) return true;
  // Auth: registro, login y logout NO requieren sesión previa.
  if (/^\/api\/auth\/(register|login|logout|me)$/.test(path)) return true;
  return false;
}

// ------------------------------------------------------------------------------
// CORS preflight.
// ------------------------------------------------------------------------------
function handleCORS() {
  const ao = allowedOrigin();
  if (ao === "DENY") return new Response(null, { status: 403 });
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-veritas-token, cf-access-user-email, x-veritas-role",
    "Access-Control-Max-Age": "86400",
    ...(ao ? { "Access-Control-Allow-Origin": ao, "Vary": "Origin" } : {}),
  };
  return new Response(null, { status: 204, headers });
}

// ==============================================================================
// MAIN ENTRY POINT
// ==============================================================================

// ------------------------------------------------------------------------------
// Auth: registro y login con email+contraseña.
// Registro: habilitado por defecto; desactívalo con env.ALLOW_REGISTRATION === "false".
// ------------------------------------------------------------------------------
async function handleAuthRegister(request, env) {
  if (env.ALLOW_REGISTRATION === "false") return errorResponse("registration_disabled", 403, { message: "El registro está deshabilitado." });
  if (!env.DB) return errorResponse("no_db", 503, { message: "D1 no está configurado." });
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse("invalid_email", 400, { message: "Email inválido." });
  if (password.length < 8) return errorResponse("weak_password", 400, { message: "La contraseña debe tener al menos 8 caracteres." });
  const existing = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first().catch(() => null);
  if (existing) return errorResponse("email_taken", 409, { message: "Ese email ya está registrado." });
  const { hash, salt } = await hashPassword(password, null);
  try {
    await env.DB.prepare("INSERT INTO users (email, password_hash, password_salt) VALUES (?, ?, ?)")
      .bind(email, hash, salt).run();
  } catch (e) {
    return errorResponse("register_failed", 500, { message: e.message });
  }
  const session = await createSession(env, email);
  return json({ ok: true, user: email, token: session.token, expires_at: session.expires_at }, 201);
}

async function handleAuthLogin(request, env) {
  if (!env.DB) return errorResponse("no_db", 503, { message: "D1 no está configurado." });
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = await env.DB.prepare("SELECT email, password_hash, password_salt FROM users WHERE email = ?")
    .bind(email).first().catch(() => null);
  if (!user || !user.password_hash || !user.password_salt) {
    return errorResponse("invalid_credentials", 401, { message: "Email o contraseña incorrectos." });
  }
  const { hash } = await hashPassword(password, user.password_salt);
  if (hash !== user.password_hash) {
    return errorResponse("invalid_credentials", 401, { message: "Email o contraseña incorrectos." });
  }
  const session = await createSession(env, email);
  return json({ ok: true, user: email, token: session.token, expires_at: session.expires_at });
}

// ------------------------------------------------------------------------------
// Exportar datos del usuario (chats + mensajes + memorias) en JSON.
// ------------------------------------------------------------------------------
async function handleExportData(request, env) {
  if (!env.DB) return errorResponse("no_db", 503, { message: "D1 no está configurado." });
  const userEmail = await getUserEmail(request, env);
  if (!userEmail) return errorResponse("unauthorized", 401);
  try {
    const chats = await env.DB.prepare(
      "SELECT id, title, category, model, created_at, updated_at FROM chats WHERE user_email = ? ORDER BY updated_at DESC"
    ).bind(userEmail).all();
    const messages = await env.DB.prepare(
      "SELECT chat_id, role, model, provider, content, thinking_content, tools_used, tokens_in, tokens_out, created_at FROM messages WHERE author_email = ? ORDER BY created_at ASC"
    ).bind(userEmail).all();
    const memories = await env.DB.prepare(
      "SELECT id, content, tags, importance, created_at FROM user_memories WHERE user_email = ? ORDER BY created_at DESC"
    ).bind(userEmail).all();
    const payload = {
      exported_at: new Date().toISOString(),
      app: "Véritas AI",
      version: "2.4",
      user: userEmail,
      chats: (chats.results || []).map((c) => ({ ...c, messages: (messages.results || []).filter((m) => m.chat_id === c.id) })),
      memories: memories.results || [],
    };
    return json(payload, 200, { "Content-Disposition": 'attachment; filename="veritas-export.json"' });
  } catch (e) {
    return errorResponse("export_failed", 500, { message: e.message });
  }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  setCtx(request, env);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return handleCORS();

  // Auth pública: registro y login NO requieren sesión.
  if (path === "/api/auth/register" && method === "POST") return await handleAuthRegister(request, env);
  if (path === "/api/auth/login" && method === "POST") return await handleAuthLogin(request, env);
  if (path === "/api/auth/logout" && method === "POST") {
    await destroySession(env, request);
    return json({ ok: true });
  }
  if (path === "/api/auth/me" && method === "GET") {
    const me = await getUserEmail(request, env);
    if (!me) return errorResponse("unauthorized", 401, { message: "No hay sesión activa." });
    return json({ user: me });
  }
  if (path === "/api/export" && method === "GET") return await handleExportData(request, env);

  // Auth (sesión de login, o header Cloudflare Access, o dev fallback).
  const userEmail = await getUserEmail(request, env);
  if (!isPublicPath(path) && !userEmail) {
    return errorResponse("unauthorized", 401, {
      message: "No autenticado. Inicia sesión con email y contraseña (o configura Cloudflare Access / DEV_USER_EMAIL).",
    });
  }

  // Dispatch por path.
  try {
    // v2.7.2 — R2 opcional: si no hay binding BUCKET, devolver 503 claro en
    // las rutas de archivo en vez de romper con "env.BUCKET undefined".
    if (routeNeedsBucket(path) && !hasBucket(env)) return r2UnavailableResponse();

    // 6.1 — search / scrape / storage / repo / db / status
    if (path === "/api/search" && method === "POST") return await handleSearch(request, env, userEmail);
    if (path === "/api/scrape" && method === "POST") return await handleScrape(request, env, userEmail);
    if (path === "/api/storage/upload" && method === "POST") return await handleStorageUpload(request, env, userEmail);
    if (path === "/api/storage/list" && method === "GET") return await handleStorageList(env, userEmail);
    if (path.startsWith("/api/storage/download/") && method === "GET") return await handleStorageDownload(path, env, userEmail);
    if (path.startsWith("/api/storage/delete/") && method === "DELETE") return await handleStorageDelete(path, env, userEmail);
    if (path === "/api/repo/upload" && method === "POST") return await handleRepoUpload(request, env, userEmail);
    if (path === "/api/repo/get" && method === "POST") return await handleRepoGet(request, env, userEmail);
    if (path.startsWith("/api/repo/download/") && method === "GET") return await handleRepoDownload(path, env, userEmail);
    if (path === "/api/repo/list" && method === "GET") return await handleRepoList(request, env, userEmail);
    if (path === "/api/repo/delete" && method === "DELETE") return await handleRepoDelete(request, env, userEmail);
    if (path === "/api/db/message" && method === "POST") return await handleDbMessage(request, env, userEmail);

    // --- Chats CRUD (P0-3: endpoints faltantes de v2.0) ---
    if (path === "/api/chats" && method === "GET") return await handleChatsList(request, env, userEmail);
    if (path === "/api/chats" && method === "POST") return await handleChatsCreate(request, env, userEmail);
    if (path.match(/^\/api\/chat\/[^/]+$/) && method === "DELETE") {
      const chatId = path.split("/")[3];
      return await handleChatDelete(chatId, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+$/) && method === "PUT") {
      const chatId = path.split("/")[3];
      return await handleChatUpdate(chatId, request, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/truncate$/) && method === "POST") {
      const chatId = path.split("/")[3];
      const body = await request.json().catch(() => ({}));
      if (!body.created_at) return errorResponse("missing_created_at", 400);
      const del = await env.DB.prepare(
        "DELETE FROM messages WHERE chat_id = ? AND created_at >= ?"
      ).bind(chatId, body.created_at).run();
      return json({ ok: true, deleted: del.meta.changes });
    }

    // --- Profile (P0-3) ---
    if (path === "/api/profile" && method === "GET") return await handleProfileGet(env, userEmail);
    if (path === "/api/profile" && method === "PUT") return await handleProfileUpdate(request, env, userEmail);

    // --- Account (P0-3) ---
    if (path === "/api/account" && method === "DELETE") return await handleAccountDelete(env, userEmail);

    // --- Memories (v2.3, cross-chat memory) ---
    if (path === "/api/memories" && method === "GET") return await handleMemoriesList(request, env, userEmail);
    if (path === "/api/memories" && method === "POST") return await handleMemoryCreate(request, env, userEmail);
    if (path === "/api/memories/batch" && method === "POST") return await handleMemoryBatchCreate(request, env, userEmail);
    if (path === "/api/memories/touch" && method === "POST") return await handleMemoriesTouch(request, env, userEmail);
    const memoryIdMatch = path.match(/^\/api\/memories\/(\d+)$/);
    if (memoryIdMatch) {
      if (method === "PATCH") return await handleMemoryUpdate(parseInt(memoryIdMatch[1]), request, env, userEmail);
      if (method === "DELETE") return await handleMemoryDelete(parseInt(memoryIdMatch[1]), env, userEmail);
    }

    // --- Repo search + write (P0-3) ---
    if (path === "/api/repo/search" && method === "POST") return await handleRepoSearch(request, env, userEmail);
    if (path === "/api/repo/write" && method === "POST") return await handleRepoWrite(request, env, userEmail);

    // 6.2 — chat/openrouter (streaming proxy con rotador)
    if (path === "/api/chat/openrouter" && method === "POST") return await handleChatOpenRouter(request, env, userEmail);

    // 6.3 — status
    if (path === "/api/status" && method === "GET") return await handleStatus(env, userEmail);
    if (path === "/api/llm/complete" && method === "POST") return await handleLLMComplete(request, env, userEmail);

    // 6.4 — keys management (admin)
    if (path === "/api/keys/status" && method === "GET") return await handleKeysStatus(request, env, userEmail);
    if (path === "/api/usage" && method === "GET") return await handleUsage(request, env, userEmail);
    if (path === "/api/quota" && method === "GET") return await handleQuota(request, env, userEmail);
    if (path === "/api/keys/health" && method === "POST") return await handleKeysHealth(request, env, userEmail);
    if (path === "/api/keys/cooldown/reset" && method === "POST") return await handleKeysCooldownReset(request, env, userEmail);
    if (path === "/api/keys/services" && method === "GET") return await handleKeysServices(env, userEmail);

    // 6.5 — tool invoke + tools registry
    if (path === "/api/tool/invoke" && method === "POST") return await handleToolInvoke(request, env, userEmail);
    if (path === "/api/tools/registry" && method === "GET") return await handleToolsRegistry();

    // 6.6 — oauth + artifact proxy + sandbox templates
    if (path === "/api/oauth/connections" && method === "GET") return await handleOAuthConnections(env, userEmail);
    if (path === "/api/oauth/:provider/account") {} // handled below with regex
    const oauthStart = path.match(/^\/api\/oauth\/([^/]+)\/start$/);
    if (oauthStart && method === "GET") return await handleOAuthStart(oauthStart[1], request, env, userEmail);
    const oauthCallback = path.match(/^\/api\/oauth\/([^/]+)\/callback$/);
    if (oauthCallback && method === "GET") return await handleOAuthCallback(oauthCallback[1], request, env);
    const oauthDisconnect = path.match(/^\/api\/oauth\/([^/]+)\/disconnect$/);
    if (oauthDisconnect && method === "POST") return await handleOAuthDisconnect(oauthDisconnect[1], env, userEmail);
    const oauthAccount = path.match(/^\/api\/oauth\/([^/]+)\/account$/);
    if (oauthAccount && method === "GET") return await handleOAuthAccount(oauthAccount[1], env, userEmail);

    if (path === "/api/artifact/proxy" && method === "POST") return await handleArtifactProxy(request, env, userEmail);
    if (path === "/api/sandbox/templates" && method === "GET") return await handleSandboxTemplates();

    // 6.7 — sesión compartida
    const shareMatch = path.match(/^\/api\/chat\/([^/]+)\/share$/);
    if (shareMatch) {
      if (method === "POST") return await handleShareCreate(shareMatch[1], request, env, userEmail);
      if (method === "DELETE") return await handleShareClose(shareMatch[1], env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/share\/revoke$/) && method === "POST") {
      const chatId = path.split("/")[3];
      return await handleShareRevoke(chatId, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/join$/) && method === "GET") {
      const chatId = path.split("/")[3];
      return await handleShareJoin(chatId, url, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/participants$/) && method === "GET") {
      const chatId = path.split("/")[3];
      return await handleParticipants(chatId, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/heartbeat$/) && method === "POST") {
      const chatId = path.split("/")[3];
      return await handleHeartbeat(chatId, request, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/messages$/) && method === "GET") {
      const chatId = path.split("/")[3];
      return await handleMessagesPolling(chatId, url, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/turn\/acquire$/) && method === "POST") {
      const chatId = path.split("/")[3];
      return await handleTurnAcquire(chatId, request, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/turn\/release$/) && method === "POST") {
      const chatId = path.split("/")[3];
      return await handleTurnRelease(chatId, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/leave$/) && method === "POST") {
      const chatId = path.split("/")[3];
      return await handleLeave(chatId, env, userEmail);
    }

    // 6.8 — rename + suggest-title
    if (path.match(/^\/api\/chat\/[^/]+\/rename$/) && method === "PATCH") {
      const chatId = path.split("/")[3];
      return await handleRename(chatId, request, env, userEmail);
    }
    if (path.match(/^\/api\/chat\/[^/]+\/suggest-title$/) && method === "POST") {
      const chatId = path.split("/")[3];
      return await handleSuggestTitle(chatId, env, userEmail);
    }

    // 6.9 — offline bundle
    if (path === "/api/chats/offline-bundle" && method === "GET") return await handleOfflineBundle(env, userEmail);

    // 6.10 — Agente: orquestación y percepción (Stack Nemotron)
    if (path === "/api/chat/agent/orchestrate" && method === "POST") return await handleAgentOrchestrate(request, env, userEmail);
    if (path === "/api/chat/perceive" && method === "POST") return await handlePerceive(request, env, userEmail);

    // 6.11 — Skills CRUD (custom user skills, carga dinámica)
    if (path === "/api/skills" && method === "GET") return await handleSkillsList(env, userEmail);
    if (path === "/api/skills" && method === "POST") return await handleSkillCreate(request, env, userEmail);
    const skillIdMatch = path.match(/^\/api\/skills\/([^/]+)$/);
    if (skillIdMatch) {
      if (method === "PUT") return await handleSkillUpdate(skillIdMatch[1], request, env, userEmail);
      if (method === "DELETE") return await handleSkillDelete(skillIdMatch[1], env, userEmail);
    }

    // 6.12 — Notifications (polling-based, no FCM/Google dependency)
    if (path === "/api/notifications/register" && method === "POST") return await handleNotificationDeviceRegister(request, env, userEmail);
    if (path === "/api/notifications/unregister" && method === "POST") return await handleNotificationDeviceUnregister(request, env, userEmail);
    if (path === "/api/notifications/poll" && method === "GET") return await handleNotificationPoll(request, env, userEmail);
    if (path === "/api/notifications" && method === "GET") return await handleNotificationsList(request, env, userEmail);
    if (path === "/api/notifications/ack" && method === "POST") return await handleNotificationAck(request, env, userEmail);

    // 404
    return errorResponse("not_found", 404, { path, method });
  } catch (e) {
    // Errores tipados del rotador.
    if (e instanceof KeyPoolEmptyError) {
      return errorResponse("key_pool_empty", 503, { service: e.service, message: e.message });
    }
    if (e instanceof AllKeysCooldownError) {
      return errorResponse("all_keys_rate_limited", 503, { service: e.service, retry_after_ms: e.retryAfterMs });
    }
    if (e instanceof OAuthNotConnectedError) {
      return errorResponse("oauth_not_connected", 403, { provider: e.provider, message: e.message });
    }
    if (e instanceof OAuthInvalidError) {
      return errorResponse("oauth_invalid", 401, { provider: e.provider, message: e.message });
    }
    console.error("Unhandled error:", e);
    return errorResponse("internal_error", 500, { message: e.message || String(e) });
  }
}

// ==============================================================================
// 6.1 — SEARCH (proxy a Jina → Tavily → Serper con fallback encadenado)
// ==============================================================================
async function handleSearch(request, env, userEmail) {
  // Rate limiting silencioso (20 req/min).
  const rl = await rateLimit(env, userEmail, "search", 20, 60);
  if (rl.limited) return errorResponse("rate_limited", 429, { message: "Límite temporal de búsquedas alcanzado.", retry_after_sec: rl.retryAfterSec });
  const { query, max_results = 5 } = await request.json().catch(() => ({}));
  if (!query) return errorResponse("missing_query", 400);

  // v2.6: orden por generosidad del plan free — Jina (1M tokens/mes) →
  // Tavily (1.000 créditos/mes) → Serper (2.500 créditos única vez).
  return await searchFallback(query, max_results, env);
}

async function searchFallback(query, maxResults, env) {
  const errors = [];
  // Jina
  if (discoverKeys(env, "jina").length > 0) {
    try {
      const { key } = await getKey(env, "jina");
      const mod = await import("../../lib/services/jina.js");
      const r = await mod.callService({ endpoint: "search", payload: { query, num: maxResults }, apiKey: key });
      if (r.status === 200 && r.data) {
        return json({ provider: "jina", results: normalizeJinaSearch(r.data), raw: r.data });
      }
      await markCooldown(env, "jina", (await getKey(env, "jina")).index, 30_000, `search ${r.status}`);
      errors.push({ provider: "jina", status: r.status });
    } catch (e) { errors.push({ provider: "jina", error: e.message }); }
  }
  // Tavily
  if (discoverKeys(env, "tavily").length > 0) {
    try {
      const { key } = await getKey(env, "tavily");
      const mod = await import("../../lib/services/tavily.js");
      const r = await mod.callService({ endpoint: "search", payload: { query, max_results: maxResults }, apiKey: key });
      if (r.status === 200 && r.data) {
        return json({ provider: "tavily", results: normalizeTavilySearch(r.data), raw: r.data });
      }
      errors.push({ provider: "tavily", status: r.status });
    } catch (e) { errors.push({ provider: "tavily", error: e.message }); }
  }
  // Serper
  if (discoverKeys(env, "serper").length > 0) {
    try {
      const { key } = await getKey(env, "serper");
      const mod = await import("../../lib/services/serper.js");
      const r = await mod.callService({ endpoint: "search", payload: { q: query, num: maxResults }, apiKey: key });
      if (r.status === 200 && r.data) {
        return json({ provider: "serper", results: normalizeSerperSearch(r.data), raw: r.data });
      }
      errors.push({ provider: "serper", status: r.status });
    } catch (e) { errors.push({ provider: "serper", error: e.message }); }
  }
  return errorResponse("all_search_providers_failed", 503, { errors });
}

function normalizeJinaSearch(data) {
  if (!data) return [];
  const results = data.data || data.results || [];
  return results.slice(0, 20).map((r, i) => ({
    title: r.title || "",
    url: r.url || r.link || "",
    snippet: r.content || r.description || r.snippet || "",
    score: r.score || (1 - i * 0.05),
  }));
}

function normalizeTavilySearch(data) {
  if (!data || !data.results) return [];
  const out = data.results.slice(0, 20).map((r, i) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.content || r.snippet || "",
    score: r.score || (1 - i * 0.05),
  }));
  if (data.answer) out.unshift({ title: "AI Answer", url: "", snippet: data.answer, score: 1.0 });
  return out;
}

function normalizeSerperSearch(data) {
  if (!data) return [];
  const out = [];
  if (data.knowledgeGraph) {
    out.push({ title: data.knowledgeGraph.title || "", url: data.knowledgeGraph.website || "", snippet: data.knowledgeGraph.description || "", score: 1.0 });
  }
  if (data.organic) {
    for (const r of data.organic.slice(0, 20)) {
      out.push({ title: r.title || "", url: r.link || "", snippet: r.snippet || "", score: 1 - (r.position || 0) * 0.05 });
    }
  }
  return out;
}

// ==============================================================================
// 6.1 — SCRAPE (Jina r.jina.ai → ScrapingBee)
// ==============================================================================
async function handleScrape(request, env, userEmail) {
  // Rate limiting silencioso (15 req/min).
  const rl = await rateLimit(env, userEmail, "scrape", 15, 60);
  if (rl.limited) return errorResponse("rate_limited", 429, { message: "Límite temporal de scraping alcanzado.", retry_after_sec: rl.retryAfterSec });
  const { url: targetUrl, render_js = false } = await request.json().catch(() => ({}));
  if (!targetUrl) return errorResponse("missing_url", 400);

  // v2.6: orden por efectividad y generosidad del plan free:
  //   Firecrawl (500 créditos/mes, extracción estructurada + render JS) → primaria
  //   Jina Reader (gratis, sin consumo de créditos) → respaldo sin JS
  //   ScrapingBee (1.000 créditos/mes, render JS) → último respaldo
  if (discoverKeys(env, "firecrawl").length > 0) {
    try {
      const { key } = await getKey(env, "firecrawl");
      const mod = await import("../../lib/services/firecrawl.js");
      const payload = { url: targetUrl, formats: ["markdown"], onlyMainContent: true };
      if (render_js) payload.waitFor = 2000;
      const r = await mod.callService({ endpoint: "scrape", payload, apiKey: key });
      if (r.status === 200 && r.data) {
        const content = (r.data && (r.data.markdown || r.data.content)) || r.raw || "";
        if (content) {
          return json({ provider: "firecrawl", content, url: targetUrl, render_js: !!render_js });
        }
      }
      await markCooldown(env, "firecrawl", (await getKey(env, "firecrawl")).index, 30_000, `scrape ${r.status}`);
    } catch (e) { /* fall through */ }
  }

  // Jina Reader (gratis; no consume créditos; sin render JS)
  if (discoverKeys(env, "jina").length > 0) {
    try {
      const { key } = await getKey(env, "jina");
      const mod = await import("../../lib/services/jina.js");
      const r = await mod.callService({ endpoint: "reader", payload: { url: targetUrl }, apiKey: key });
      if (r.status === 200 && r.data) {
        return json({ provider: "jina", content: r.data.content || r.raw, url: targetUrl, render_js: false, warning: render_js ? "render_js no disponible en Jina Reader; se usó texto plano." : undefined });
      }
    } catch (e) { /* fall through */ }
  }

  // ScrapingBee (respaldo; con o sin JS)
  if (discoverKeys(env, "scrapingbee").length > 0) {
    try {
      const { key } = await getKey(env, "scrapingbee");
      const mod = await import("../../lib/services/scrapingbee.js");
      const r = await mod.callService({
        endpoint: "scrape",
        payload: { url: targetUrl, render_js: !!render_js },
        apiKey: key,
      });
      if (r.status === 200 && r.data) {
        return json({ provider: "scrapingbee", content: r.data.content || r.raw, url: targetUrl, render_js: !!render_js });
      }
    } catch (e) { /* fall through */ }
  }

  // Último intento: Jina incluso con render_js (mejor que nada)
  if (render_js && discoverKeys(env, "jina").length > 0) {
    try {
      const { key } = await getKey(env, "jina");
      const mod = await import("../../lib/services/jina.js");
      const r = await mod.callService({ endpoint: "reader", payload: { url: targetUrl }, apiKey: key });
      if (r.status === 200 && r.data) {
        return json({ provider: "jina", content: r.data.content || r.raw, url: targetUrl, warning: "render_js requested but Firecrawl/ScrapingBee unavailable; used Jina Reader (no JS render)." });
      }
    } catch (e) { /* fall through */ }
  }

  return json({ provider: "none", error: "No se pudo scrapear con ningún proveedor (configura FIRECRAWL_API_KEY_1, JINA_API_KEY_1 o SCRAPINGBEE_API_KEY_1)." }, 502);
}

// ==============================================================================
// 6.1 — STORAGE (Carpeta Proyecto en R2)
// ==============================================================================
const R2_FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024;
const R2_SOFT_WARN_BYTES = 8 * 1024 * 1024 * 1024;
const R2_HARD_GUARD_BYTES = Math.floor(9.5 * 1024 * 1024 * 1024);

// v2.7: uso TOTAL del bucket (todos los usuarios) con caché de 5 min.
// Protege el límite real de 10GB del free tier, no solo el uso por usuario.
let _bucketUsageCache = { ts: 0, bytes: 0 };
async function estimateBucketTotalUsage(env) {
  const now = Date.now();
  if (_bucketUsageCache.ts && now - _bucketUsageCache.ts < 5 * 60 * 1000) {
    return { total_bytes: _bucketUsageCache.bytes, cached: true };
  }
  let totalBytes = 0;
  try {
    let cursor = undefined;
    do {
      const list = await env.BUCKET.list({ limit: 1000, cursor });
      totalBytes += (list.objects || []).reduce((sum, o) => sum + (o.size || 0), 0);
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  } catch { /* best effort */ }
  _bucketUsageCache = { ts: now, bytes: totalBytes };
  return { total_bytes: totalBytes, cached: false };
}

async function estimateUserR2Usage(env, userEmail) {
  let projectBytes = 0;
  try {
    let cursor = undefined;
    do {
      const list = await env.BUCKET.list({ prefix: `projects/${userEmail}/`, limit: 1000, cursor });
      projectBytes += (list.objects || []).reduce((sum, o) => sum + (o.size || 0), 0);
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  } catch { /* best effort */ }

  let repoBytes = 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COALESCE(SUM(file_size), 0) AS total_size FROM repo_documents WHERE user_email = ?`
    ).bind(userEmail).first();
    repoBytes = row?.total_size || 0;
  } catch { /* best effort */ }

  const totalBytes = projectBytes + repoBytes;
  return {
    project_bytes: projectBytes,
    repo_bytes: repoBytes,
    total_bytes: totalBytes,
    free_tier_bytes: R2_FREE_TIER_BYTES,
    usage_ratio: totalBytes / R2_FREE_TIER_BYTES,
    warning: totalBytes >= R2_SOFT_WARN_BYTES,
  };
}

function r2QuotaError(projectedUsage) {
  return errorResponse("r2_quota_guard", 413, {
    message: "El archivo superaría el guard rail local de R2 (~9.5GB). Libera espacio o migra a plan pago antes de subir más multimedia.",
    usage: projectedUsage,
  });
}

// v2.7.2 — R2 opcional: si el despliegue no tiene binding BUCKET (R2 no
// disponible / no contratado), las funciones de archivo devuelven 503 con un
// mensaje claro y el resto de la app (chat, LLM, herramientas) sigue operando.
function hasBucket(env) {
  return Boolean(env && env.BUCKET);
}
function r2UnavailableResponse() {
  return errorResponse("r2_unavailable", 503, {
    message: "Almacenamiento de archivos desactivado: este despliegue no tiene R2 configurado (binding BUCKET). Chat, LLM y herramientas funcionan con normalidad.",
  });
}
// Rutas que necesitan R2 sí o sí (subir/bajar/borrar archivos y repo documental).
function routeNeedsBucket(path) {
  return (
    path === "/api/storage/upload" ||
    path === "/api/storage/list" ||
    path.startsWith("/api/storage/download/") ||
    path.startsWith("/api/storage/delete/") ||
    path === "/api/repo/upload" ||
    path === "/api/repo/get" ||
    path.startsWith("/api/repo/download/") ||
    path === "/api/repo/delete" ||
    path === "/api/repo/write"
  );
}

async function handleStorageUpload(request, env, userEmail) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "undefined") return errorResponse("missing_file", 400);

  const filename = slugify(file.name);
  const r2Key = `projects/${userEmail}/${filename}`;
  const buf = await file.arrayBuffer();
  const usage = await estimateUserR2Usage(env, userEmail);
  const projectedUsage = { ...usage, projected_total_bytes: usage.total_bytes + buf.byteLength, projected_ratio: (usage.total_bytes + buf.byteLength) / R2_FREE_TIER_BYTES };
  if (projectedUsage.projected_total_bytes > R2_HARD_GUARD_BYTES) return r2QuotaError(projectedUsage);

  // v2.7: guard rail a nivel de bucket total (compartido entre usuarios).
  const bucketUsage = await estimateBucketTotalUsage(env);
  if (bucketUsage.total_bytes + buf.byteLength > R2_HARD_GUARD_BYTES) {
    return errorResponse("r2_bucket_quota_guard", 413, {
      message: "El bucket compartido de R2 está al límite del free tier (~9.5GB). Libera espacio o migra a plan pago.",
      bucket_total_bytes: bucketUsage.total_bytes,
      free_tier_bytes: R2_FREE_TIER_BYTES,
    });
  }

  await env.BUCKET.put(r2Key, buf, {
    customMetadata: { user_email: userEmail, original_name: file.name, mime_type: file.type || "application/octet-stream" },
  });
  return json({ ok: true, filename, r2_key: r2Key, size: buf.byteLength, usage: projectedUsage });
}

async function handleStorageList(env, userEmail) {
  const list = await env.BUCKET.list({ prefix: `projects/${userEmail}/`, limit: 1000 });
  const items = list.objects.map((o) => ({
    filename: o.key.replace(`projects/${userEmail}/`, ""),
    size: o.size,
    uploaded: o.uploaded.toISOString(),
  }));
  return json({ files: items, usage: await estimateUserR2Usage(env, userEmail) });
}

async function handleStorageDownload(path, env, userEmail) {
  const filename = slugify(decodeURIComponent(path.split("/api/storage/download/")[1] || ""));
  if (!filename) return errorResponse("missing_filename", 400);
  const r2Key = `projects/${userEmail}/${filename}`;
  const obj = await env.BUCKET.get(r2Key);
  if (!obj) return errorResponse("not_found", 404, { filename });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function handleStorageDelete(path, env, userEmail) {
  const filename = slugify(decodeURIComponent(path.split("/api/storage/delete/")[1] || ""));
  if (!filename) return errorResponse("missing_filename", 400);
  const r2Key = `projects/${userEmail}/${filename}`;
  await env.BUCKET.delete(r2Key);
  return json({ ok: true, deleted: filename });
}

// ==============================================================================
// 6.1 — REPO (Documentos del usuario, R2 + D1)
// ==============================================================================
async function handleRepoUpload(request, env, userEmail) {
  const formData = await request.formData();
  const file = formData.get("file");
  const docName = formData.get("doc_name") || (file ? file.name : "untitled");
  if (!file) return errorResponse("missing_file", 400);

  const buf = await file.arrayBuffer();
  if (buf.byteLength > 5 * 1024 * 1024) return errorResponse("file_too_large", 400, { max_bytes: 5_242_880 });
  const usage = await estimateUserR2Usage(env, userEmail);
  const projectedUsage = { ...usage, projected_total_bytes: usage.total_bytes + buf.byteLength, projected_ratio: (usage.total_bytes + buf.byteLength) / R2_FREE_TIER_BYTES };
  if (projectedUsage.projected_total_bytes > R2_HARD_GUARD_BYTES) return r2QuotaError(projectedUsage);

  // v2.7: guard rail a nivel de bucket total (compartido entre usuarios).
  const bucketUsage = await estimateBucketTotalUsage(env);
  if (bucketUsage.total_bytes + buf.byteLength > R2_HARD_GUARD_BYTES) {
    return errorResponse("r2_bucket_quota_guard", 413, {
      message: "El bucket compartido de R2 está al límite del free tier (~9.5GB). Libera espacio o migra a plan pago.",
      bucket_total_bytes: bucketUsage.total_bytes,
      free_tier_bytes: R2_FREE_TIER_BYTES,
    });
  }

  // Insertar en D1 para obtener doc_number autoincremental.
  const ins = await env.DB.prepare(
    `INSERT INTO repo_documents (user_email, doc_name, r2_key, file_size, mime_type) VALUES (?, ?, ?, ?, ?)`
  ).bind(userEmail, docName, "pending", buf.byteLength, file.type || "application/octet-stream").run();
  const docNumber = ins.meta.last_row_id;
  const r2Key = `repo/${userEmail}/${docNumber}_${slugify(docName)}`;
  await env.BUCKET.put(r2Key, buf, {
    customMetadata: { user_email: userEmail, doc_number: String(docNumber), doc_name: docName },
  });
  await env.DB.prepare(
    `UPDATE repo_documents SET r2_key = ? WHERE doc_number = ? AND user_email = ?`
  ).bind(r2Key, docNumber, userEmail).run();

  return json({ ok: true, doc_number: docNumber, doc_name: docName, r2_key: r2Key, size: buf.byteLength, usage: projectedUsage });
}

async function handleRepoGet(request, env, userEmail) {
  const { query } = await request.json().catch(() => ({}));
  if (!query) return errorResponse("missing_query", 400);

  // Buscar por número o nombre parcial.
  const asNum = Number(query);
  let row;
  if (!Number.isNaN(asNum)) {
    row = await env.DB.prepare(
      `SELECT * FROM repo_documents WHERE user_email = ? AND doc_number = ?`
    ).bind(userEmail, asNum).first();
  }
  if (!row) {
    row = await env.DB.prepare(
      `SELECT * FROM repo_documents WHERE user_email = ? AND doc_name LIKE ? ORDER BY created_at DESC LIMIT 1`
    ).bind(userEmail, `%${query}%`).first();
  }
  if (!row) return errorResponse("doc_not_found", 404, { query });

  const obj = await env.BUCKET.get(row.r2_key);
  if (!obj) return errorResponse("r2_object_missing", 500, { r2_key: row.r2_key });
  const buf = await obj.arrayBuffer();
  const text = await extractText(buf, row.doc_name, row.mime_type);
  return json({
    doc_number: row.doc_number,
    doc_name: row.doc_name,
    text,
    size: row.file_size,
    mime_type: row.mime_type,
  });
}

async function handleRepoList(request, env, userEmail) {
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit")) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset")) || 0);
  const search = (url.searchParams.get("search") || "").trim();

  let sql = `SELECT doc_number, doc_name, file_size, mime_type, created_at FROM repo_documents WHERE user_email = ?`;
  const binds = [userEmail];
  if (search) {
    sql += ` AND doc_name LIKE ?`;
    binds.push(`%${search}%`);
  }
  sql += ` ORDER BY doc_number DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  // Total count + total size para paginación y barra de uso.
  let countSql = `SELECT COUNT(*) AS total, COALESCE(SUM(file_size), 0) AS total_size FROM repo_documents WHERE user_email = ?`;
  const countBinds = [userEmail];
  if (search) {
    countSql += ` AND doc_name LIKE ?`;
    countBinds.push(`%${search}%`);
  }

  const [result, countResult] = await Promise.all([
    env.DB.prepare(sql).bind(...binds).all(),
    env.DB.prepare(countSql).bind(...countBinds).first(),
  ]);

  return json({
    documents: result.results || [],
    total: countResult?.total || 0,
    total_size: countResult?.total_size || 0,
    limit,
    offset,
    has_more: (offset + (result.results || []).length) < (countResult?.total || 0),
  });
}

// GET /api/repo/download/:docNumber — descarga archivo crudo (blob con Content-Disposition)
async function handleRepoDownload(path, env, userEmail) {
  const docNumber = parseInt(path.split("/").pop(), 10);
  if (Number.isNaN(docNumber)) return errorResponse("invalid_doc_number", 400);

  const row = await env.DB.prepare(
    `SELECT r2_key, doc_name, mime_type FROM repo_documents WHERE user_email = ? AND doc_number = ?`
  ).bind(userEmail, docNumber).first();
  if (!row) return errorResponse("doc_not_found", 404);

  const obj = await env.BUCKET.get(row.r2_key);
  if (!obj) return errorResponse("r2_object_missing", 500, { r2_key: row.r2_key });

  const contentType = row.mime_type || "application/octet-stream";
  const safeName = slugify(row.doc_name);
  return new Response(obj.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Content-Length": String(obj.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function handleRepoDelete(request, env, userEmail) {
  const { doc_number } = await request.json().catch(() => ({}));
  if (!doc_number) return errorResponse("missing_doc_number", 400);
  const row = await env.DB.prepare(
    `SELECT r2_key FROM repo_documents WHERE user_email = ? AND doc_number = ?`
  ).bind(userEmail, doc_number).first();
  if (!row) return errorResponse("doc_not_found", 404);
  await env.BUCKET.delete(row.r2_key);
  await env.DB.prepare(
    `DELETE FROM repo_documents WHERE user_email = ? AND doc_number = ?`
  ).bind(userEmail, doc_number).run();
  return json({ ok: true, deleted: doc_number });
}

// ------------------------------------------------------------------------------
// extractText: extrae texto de PDF/HTML/MD/código/plano.
// En Workers no hay pdf-parse; hacemos best-effort: HTML → strip tags, resto →
// texto plano. Para PDF se recomienda subir .txt o .md paralelamente.
// ------------------------------------------------------------------------------
async function extractText(buf, name, mimeType) {
  const ext = (name || "").split(".").pop().toLowerCase();
  const text = new TextDecoder("utf-8").decode(buf);
  if (ext === "html" || mimeType === "text/html") {
    return text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (ext === "pdf") {
    // Best-effort: extraer texto entre streams BT/ET (Tj/TJ operators). No es completo.
    return `[PDF — extracción limitada en Worker. Contenido parcial:]\n${text.replace(/[^\x20-\x7E\n\r\t]+/g, " ").slice(0, 50000)}`;
  }
  // .txt, .md, .py, .js, .ts, .csv, .json → texto plano.
  return text;
}

// ==============================================================================
// P0-3 — CHATS CRUD (endpoints faltantes de v2.0)
// ==============================================================================

// GET /api/chats?category=&search=  — lista chats del usuario
async function handleChatsList(request, env, userEmail) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const search = url.searchParams.get("search");

  // v2.12: incluir también chats compartidos donde el usuario es participante
  // (editor). Antes solo veía sus propios chats y perdía acceso al chat
  // compartido tras el join (el token de invitación es de un solo uso).
  let sql = `SELECT DISTINCT c.id, c.user_email, c.category, c.title, c.summary_json, c.is_shared, c.updated_at
             FROM chats c
             LEFT JOIN chat_participants cp ON cp.chat_id = c.id AND cp.user_email = ?
             WHERE (c.user_email = ? OR cp.user_email = ?)`;
  const binds = [userEmail, userEmail, userEmail];
  if (category && ["agent", "coder", "general"].includes(category)) {
    sql += ` AND c.category = ?`;
    binds.push(category);
  }
  if (search) {
    sql += ` AND c.title LIKE ?`;
    binds.push(`%${search}%`);
  }
  sql += ` ORDER BY c.updated_at DESC LIMIT 200`;

  const result = await env.DB.prepare(sql).bind(...binds).all();
  return json({ chats: result.results || [] });
}

// POST /api/chats  { title, category }  — crea chat explícitamente
async function handleChatsCreate(request, env, userEmail) {
  const { title, category, id } = await request.json().catch(() => ({}));
  if (!title || !category) return errorResponse("missing_fields", 400, { required: ["title", "category"] });
  if (!["agent", "coder", "general"].includes(category)) {
    return errorResponse("invalid_category", 400, { allowed: ["agent", "coder", "general"] });
  }
  const chatId = id || crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO chats (id, user_email, category, title, is_shared) VALUES (?, ?, ?, ?, 0)`
  ).bind(chatId, userEmail, category, String(title).slice(0, 200)).run();

  // Asegurar que el usuario existe en D1 (INSERT OR IGNORE).
  await env.DB.prepare(`INSERT OR IGNORE INTO users (email) VALUES (?)`).bind(userEmail).run();

  return json({
    ok: true,
    chat: { id: chatId, user_email: userEmail, category, title, is_shared: 0, updated_at: new Date().toISOString() },
  });
}

// DELETE /api/chat/:id  — elimina chat + mensajes (cascada automática por FK)
async function handleChatDelete(chatId, env, userEmail) {
  // Verificar ownership: solo el owner del chat (o editor en sesión compartida).
  const chat = await env.DB.prepare(
    `SELECT user_email FROM chats WHERE id = ?`
  ).bind(chatId).first();
  if (!chat) return errorResponse("chat_not_found", 404, { chat_id: chatId });

  const isOwner = chat.user_email === userEmail;
  const isEditor = await env.DB.prepare(
    `SELECT 1 FROM chat_participants WHERE chat_id = ? AND user_email = ? AND role = 'editor'`
  ).bind(chatId, userEmail).first();
  if (!isOwner && !isEditor) return errorResponse("not_authorized", 403);

  // ON DELETE CASCADE limpia messages, chat_participants, chat_turn_lock, chat_presence.
  await env.DB.prepare(`DELETE FROM chats WHERE id = ?`).bind(chatId).run();
  return json({ ok: true, deleted: chatId });
}

// PUT /api/chat/:id  { title?, category? }  — actualiza chat
async function handleChatUpdate(chatId, request, env, userEmail) {
  const { title, category } = await request.json().catch(() => ({}));
  const chat = await env.DB.prepare(
    `SELECT user_email FROM chats WHERE id = ?`
  ).bind(chatId).first();
  if (!chat) return errorResponse("chat_not_found", 404);
  if (chat.user_email !== userEmail) return errorResponse("not_owner", 403);

  const updates = [];
  const binds = [];
  if (title !== undefined) {
    updates.push("title = ?");
    binds.push(String(title).slice(0, 200));
  }
  if (category !== undefined) {
    if (!["agent", "coder", "general"].includes(category)) {
      return errorResponse("invalid_category", 400, { allowed: ["agent", "coder", "general"] });
    }
    updates.push("category = ?");
    binds.push(category);
  }
  if (updates.length === 0) return errorResponse("no_fields", 400);
  updates.push("updated_at = CURRENT_TIMESTAMP");
  binds.push(chatId);

  await env.DB.prepare(`UPDATE chats SET ${updates.join(", ")} WHERE id = ?`).bind(...binds).run();
  return json({ ok: true, chat_id: chatId });
}

// ==============================================================================
// P0-3 — PROFILE (users.profile_json)
// ==============================================================================

// GET /api/profile
async function handleProfileGet(env, userEmail) {
  await env.DB.prepare(`INSERT OR IGNORE INTO users (email) VALUES (?)`).bind(userEmail).run();
  const row = await env.DB.prepare(
    `SELECT email, profile_json, created_at FROM users WHERE email = ?`
  ).bind(userEmail).first();
  let profile = {};
  if (row?.profile_json) {
    try { profile = JSON.parse(row.profile_json); } catch {}
  }
  return json({
    email: userEmail,
    profile,
    created_at: row?.created_at || null,
  });
}

// PUT /api/profile  { profile_json: object }  — merge con existente
async function handleProfileUpdate(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const newProfile = body.profile_json || body.profile || body;
  if (typeof newProfile !== "object") return errorResponse("invalid_profile", 400);

  await env.DB.prepare(`INSERT OR IGNORE INTO users (email) VALUES (?)`).bind(userEmail).run();
  const row = await env.DB.prepare(
    `SELECT profile_json FROM users WHERE email = ?`
  ).bind(userEmail).first();
  let existing = {};
  if (row?.profile_json) {
    try { existing = JSON.parse(row.profile_json); } catch {}
  }
  const merged = { ...existing, ...newProfile };
  await env.DB.prepare(
    `UPDATE users SET profile_json = ? WHERE email = ?`
  ).bind(JSON.stringify(merged), userEmail).run();
  return json({ ok: true, profile: merged });
}

// ==============================================================================
// P0-3 — ACCOUNT DELETE
// ==============================================================================

// DELETE /api/account  — elimina TODA la data del usuario
// (chats, messages, repo_documents, oauth, external_connections, etc.).
// ON DELETE CASCADE en users(email) limpia todo lo demás.
async function handleAccountDelete(env, userEmail) {
  // Borrar archivos R2 del usuario (projects + repo).
  try {
    const projectsList = await env.BUCKET.list({ prefix: `projects/${userEmail}/`, limit: 1000 });
    for (const obj of projectsList.objects) await env.BUCKET.delete(obj.key);
    const repoList = await env.BUCKET.list({ prefix: `repo/${userEmail}/`, limit: 1000 });
    for (const obj of repoList.objects) await env.BUCKET.delete(obj.key);
  } catch (e) { /* best-effort */ }

  // Borrar fila en users → cascada limpia chats, messages, repo_documents,
  // chat_participants, chat_turn_lock, chat_presence, oauth_pending, external_connections,
  // user_memories.
  await env.DB.prepare(`DELETE FROM users WHERE email = ?`).bind(userEmail).run();
  // external_api_calls no tiene FK a users; limpiar manualmente.
  await env.DB.prepare(`DELETE FROM external_api_calls WHERE user_email = ?`).bind(userEmail).run();
  await env.DB.prepare(`DELETE FROM tool_calls WHERE user_email = ?`).bind(userEmail).run();
  await env.DB.prepare(`DELETE FROM openrouter_calls WHERE user_email = ?`).bind(userEmail).run();

  return json({ ok: true, deleted_account: userEmail });
}

// ==============================================================================
// MEMORIES — cross-chat memory (v2.3, Gap 2 del audit)
// ==============================================================================
// CRUD para user_memories. El frontend usa estos endpoints para:
//   - Guardar hechos aprendidos de conversaciones (POST)
//   - Recuperar memorias relevantes para inyectar en el contexto (GET)
//   - Gestionar memorias manualmente (DELETE, PATCH)
//
// Todos los endpoints requieren auth (cf-access-user-email).
// ==============================================================================

// GET /api/memories?category=...&limit=...&exclude_chat=...  — listar memorias
async function handleMemoriesList(request, env, userEmail) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");  // filtrar por categoría
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);
  const excludeChat = url.searchParams.get("exclude_chat"); // excluir memorias de este chat

  let query = `SELECT id, category, content, source_chat_id, importance, access_count, last_accessed, expires_at, created_at FROM user_memories WHERE user_email = ?`;
  const binds = [userEmail];

  // Filtrar memorias no expiradas.
  query += ` AND (expires_at IS NULL OR expires_at > ?)`;
  binds.push(Date.now());

  if (category) {
    const validCategories = ["personal", "tech", "preference", "fact"];
    if (!validCategories.includes(category)) return errorResponse("invalid_category", 400, { allowed: validCategories });
    query += ` AND category = ?`;
    binds.push(category);
  }

  if (excludeChat) {
    query += ` AND (source_chat_id IS NULL OR source_chat_id != ?)`;
    binds.push(excludeChat);
  }

  // Ordenar: importancia DESC, luego más accedidas primero.
  query += ` ORDER BY importance DESC, last_accessed DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await env.DB.prepare(query).bind(...binds).all();
  return json({ ok: true, memories: results || [], count: (results || []).length });
}

// POST /api/memories  { content, category?, importance?, source_chat_id?, expires_at? }
async function handleMemoryCreate(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const { content, category, importance, source_chat_id, expires_at } = body;

  if (!content || typeof content !== "string") return errorResponse("missing_content", 400);
  if (content.length > 2000) return errorResponse("content_too_long", 400, { max: 2000 });

  const validCategories = ["personal", "tech", "preference", "fact"];
  const cat = validCategories.includes(category) ? category : "fact";
  const imp = Math.max(1, Math.min(5, parseInt(importance) || 3));

  // Evitar duplicados exactos (mismo usuario + mismo contenido truncado a 100 chars).
  const contentFingerprint = content.trim().slice(0, 100);
  const existing = await env.DB.prepare(
    `SELECT id FROM user_memories WHERE user_email = ? AND substr(content, 1, 100) = ?`
  ).bind(userEmail, contentFingerprint).first();
  if (existing) {
    return json({ ok: true, duplicate: true, memory_id: existing.id });
  }

  const result = await env.DB.prepare(
    `INSERT INTO user_memories (user_email, category, content, source_chat_id, importance, expires_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(userEmail, cat, content.trim().slice(0, 2000), source_chat_id || null, imp, expires_at || null).run();

  return json({ ok: true, memory_id: result.meta.last_row_id }, 201);
}

// PATCH /api/memories/:id  { content?, category?, importance? }
async function handleMemoryUpdate(memoryId, request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const { content, category, importance } = body;

  // Verificar ownership.
  const existing = await env.DB.prepare(
    `SELECT id FROM user_memories WHERE id = ? AND user_email = ?`
  ).bind(memoryId, userEmail).first();
  if (!existing) return errorResponse("memory_not_found", 404);

  const updates = [];
  const binds = [];
  if (content !== undefined) {
    updates.push("content = ?");
    binds.push(String(content).slice(0, 2000));
  }
  if (category !== undefined) {
    const validCategories = ["personal", "tech", "preference", "fact"];
    if (!validCategories.includes(category)) return errorResponse("invalid_category", 400, { allowed: validCategories });
    updates.push("category = ?");
    binds.push(category);
  }
  if (importance !== undefined) {
    const imp = Math.max(1, Math.min(5, parseInt(importance) || 3));
    updates.push("importance = ?");
    binds.push(imp);
  }
  if (updates.length === 0) return errorResponse("no_fields", 400);

  binds.push(memoryId, userEmail);
  await env.DB.prepare(
    `UPDATE user_memories SET ${updates.join(", ")} WHERE id = ? AND user_email = ?`
  ).bind(...binds).run();

  return json({ ok: true, memory_id: parseInt(memoryId) });
}

// DELETE /api/memories/:id
async function handleMemoryDelete(memoryId, env, userEmail) {
  const result = await env.DB.prepare(
    `DELETE FROM user_memories WHERE id = ? AND user_email = ?`
  ).bind(memoryId, userEmail).run();
  if (result.meta.changes === 0) return errorResponse("memory_not_found", 404);
  return json({ ok: true, deleted: parseInt(memoryId) });
}

// POST /api/memories/batch  { memories: [{ content, category?, importance? }] }
async function handleMemoryBatchCreate(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const { memories, source_chat_id } = body;

  if (!Array.isArray(memories) || memories.length === 0) return errorResponse("missing_memories_array", 400);
  if (memories.length > 20) return errorResponse("batch_too_large", 400, { max: 20 });

  const validCategories = ["personal", "tech", "preference", "fact"];
  const inserted = [];
  let duplicates = 0;

  for (const m of memories) {
    if (!m.content || typeof m.content !== "string") continue;
    const content = m.content.trim().slice(0, 2000);
    if (!content) continue;

    const cat = validCategories.includes(m.category) ? m.category : "fact";
    const imp = Math.max(1, Math.min(5, parseInt(m.importance) || 3));

    // Deduplicación por fingerprint.
    const fp = content.slice(0, 100);
    const exists = await env.DB.prepare(
      `SELECT id FROM user_memories WHERE user_email = ? AND substr(content, 1, 100) = ?`
    ).bind(userEmail, fp).first();
    if (exists) { duplicates++; continue; }

    const r = await env.DB.prepare(
      `INSERT INTO user_memories (user_email, category, content, source_chat_id, importance) VALUES (?, ?, ?, ?, ?)`
    ).bind(userEmail, cat, content, source_chat_id || null, imp).run();
    inserted.push(r.meta.last_row_id);
  }

  return json({ ok: true, inserted: inserted.length, duplicates, memory_ids: inserted });
}

// POST /api/memories/touch  { ids: [1, 2, ...] }  — actualizar access_count + last_accessed
async function handleMemoriesTouch(request, env, userEmail) {
  const { ids } = await request.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse("missing_ids", 400);
  if (ids.length > 100) return errorResponse("batch_too_large", 400, { max: 100 });

  const now = Date.now();
  // D1 no soporta VALUES() multi-row en UPDATE, así que hacemos loop.
  // Con ≤100 IDs esto es aceptable (100 queries en paralelo).
  const promises = ids.map((id) =>
    env.DB.prepare(
      `UPDATE user_memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ? AND user_email = ?`
    ).bind(now, id, userEmail).run()
  );
  await Promise.all(promises);

  return json({ ok: true, touched: ids.length });
}

// ==============================================================================
// P0-3 — REPO SEARCH + WRITE (faltantes de v2.0)
// ==============================================================================

// POST /api/repo/search  { query, content_search? }  — busca en nombres + opcionalmente en contenido
async function handleRepoSearch(request, env, userEmail) {
  const { query, content_search = false } = await request.json().catch(() => ({}));
  if (!query) return errorResponse("missing_query", 400);

  // Búsqueda LIKE en nombres de documentos.
  const byName = await env.DB.prepare(
    `SELECT doc_number, doc_name, file_size, mime_type, created_at, 1 AS match_type
       FROM repo_documents
      WHERE user_email = ? AND doc_name LIKE ?
      ORDER BY created_at DESC LIMIT 50`
  ).bind(userEmail, `%${query}%`).all();

  let byContent = [];
  if (content_search && hasBucket(env)) {
    // Buscar en contenido de documentos de texto (.txt, .md, .py, .js, .ts, .csv, .json, .html).
    const textDocs = await env.DB.prepare(
      `SELECT doc_number, doc_name, file_size, mime_type, r2_key, created_at
         FROM repo_documents
        WHERE user_email = ?
          AND (mime_type LIKE 'text/%' OR mime_type IN ('application/json','application/javascript','application/typescript'))
        ORDER BY doc_number DESC LIMIT 50`
    ).bind(userEmail).all();

    const queryLower = query.toLowerCase();
    const promises = (textDocs.results || []).map(async (doc) => {
      try {
        const obj = await env.BUCKET.get(doc.r2_key);
        if (!obj) return null;
        const buf = await obj.arrayBuffer();
        const text = new TextDecoder("utf-8").decode(buf).toLowerCase();
        if (text.includes(queryLower)) {
          // Encontrar contexto alrededor del match.
          const idx = text.indexOf(queryLower);
          const start = Math.max(0, idx - 60);
          const end = Math.min(text.length, idx + query.length + 60);
          const snippet = (idx > 60 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
          return { ...doc, match_type: 2, snippet };
        }
      } catch { /* skip */ }
      return null;
    });
    byContent = (await Promise.all(promises)).filter(Boolean);
  }

  // Merge: priorizar matches por nombre, luego por contenido.
  const nameResults = byName.results || [];
  const contentNumbers = new Set(byContent.map((d) => d.doc_number));
  const merged = [
    ...nameResults,
    ...byContent.filter((d) => !contentNumbers.has(d.doc_number) || !nameResults.some((n) => n.doc_number === d.doc_number)),
  ];

  return json({
    query,
    results: merged,
    total_by_name: nameResults.length,
    total_by_content: byContent.length,
  });
}

// POST /api/repo/write  { filename, content, overwrite }  — escribe documento al repo
async function handleRepoWrite(request, env, userEmail) {
  const { filename, content, overwrite = false } = await request.json().catch(() => ({}));
  if (!filename || content === undefined) return errorResponse("missing_fields", 400, { required: ["filename", "content"] });

  const buf = new TextEncoder().encode(content);
  if (buf.byteLength > 5 * 1024 * 1024) return errorResponse("file_too_large", 400, { max_bytes: 5_242_880 });

  // Si overwrite=false, verificar que no exista.
  const existing = await env.DB.prepare(
    `SELECT doc_number FROM repo_documents WHERE user_email = ? AND doc_name = ?`
  ).bind(userEmail, filename).first();
  if (existing && !overwrite) {
    return errorResponse("file_exists", 409, { filename, doc_number: existing.doc_number });
  }

  // Calcular uso total del usuario (100 MB límite).
  const usage = await env.DB.prepare(
    `SELECT COALESCE(SUM(file_size), 0) AS total FROM repo_documents WHERE user_email = ?`
  ).bind(userEmail).first();
  if ((usage?.total || 0) + buf.byteLength > 100 * 1024 * 1024) {
    return errorResponse("quota_exceeded", 400, { used: usage?.total || 0, limit: 104857600 });
  }

  if (existing && overwrite) {
    // Actualizar contenido en R2 (misma r2_key) y metadatos.
    const r2Key = `repo/${userEmail}/${existing.doc_number}_${slugify(filename)}`;
    await env.BUCKET.put(r2Key, buf, {
      customMetadata: { user_email: userEmail, doc_number: String(existing.doc_number), doc_name: filename },
    });
    await env.DB.prepare(
      `UPDATE repo_documents SET file_size = ?, mime_type = ? WHERE doc_number = ? AND user_email = ?`
    ).bind(buf.byteLength, guessMime(filename), existing.doc_number, userEmail).run();
    return json({ ok: true, doc_number: existing.doc_number, doc_name: filename, r2_key: r2Key, size: buf.byteLength, overwritten: true });
  }

  // Crear nuevo.
  const ins = await env.DB.prepare(
    `INSERT INTO repo_documents (user_email, doc_name, r2_key, file_size, mime_type) VALUES (?, ?, ?, ?, ?)`
  ).bind(userEmail, filename, "pending", buf.byteLength, guessMime(filename)).run();
  const docNumber = ins.meta.last_row_id;
  const r2Key = `repo/${userEmail}/${docNumber}_${slugify(filename)}`;
  await env.BUCKET.put(r2Key, buf, {
    customMetadata: { user_email: userEmail, doc_number: String(docNumber), doc_name: filename },
  });
  await env.DB.prepare(
    `UPDATE repo_documents SET r2_key = ? WHERE doc_number = ? AND user_email = ?`
  ).bind(r2Key, docNumber, userEmail).run();
  return json({ ok: true, doc_number: docNumber, doc_name: filename, r2_key: r2Key, size: buf.byteLength });
}

function guessMime(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  const map = {
    txt: "text/plain", md: "text/markdown", pdf: "application/pdf", csv: "text/csv",
    json: "application/json", html: "text/html", py: "text/x-python", js: "application/javascript",
    ts: "application/typescript",
  };
  return map[ext] || "application/octet-stream";
}

// ==============================================================================
// 6.1 — DB MESSAGE (autoguardado continuo)
// ==============================================================================
async function handleDbMessage(request, env, userEmail) {
  const { chat_id, role, content, model, provider, thinking_content, tools_used, author_email, tokens_in, tokens_out, cached_tokens, message_id } = await request.json().catch(() => ({}));
  if (!chat_id || !role || !content) return errorResponse("missing_fields", 400);

  // v2.12d: validar que el chat existe antes del INSERT. Sin esto, un chat_id
  // inexistente violaba la FK messages.chat_id y devolvía un 500 genérico.
  const chatExists = await env.DB.prepare(`SELECT id FROM chats WHERE id = ?`).bind(chat_id).first();
  if (!chatExists) return errorResponse("chat_not_found", 404, { chat_id });

  const msgId = message_id || crypto.randomUUID();
  // v2.12: persistir el provider REAL (openrouter, cerebras, cohere…).
  // En DBs antiguas el CHECK solo admite puter/openrouter: si el INSERT falla
  // por constraint, reintentar con NULL para no perder el mensaje.
  // v2.12g: INSERT OR IGNORE hace la inserción IDEMPOTENTE por message_id: el
  // cliente puede reintentar sin miedo a duplicar (fortalece la persistencia).
  const insertMessage = (prov) => env.DB.prepare(
    `INSERT OR IGNORE INTO messages (id, chat_id, role, model, provider, content, thinking_content, tools_used, author_email, tokens_in, tokens_out, cached_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    msgId, chat_id, role, model || null, prov, content,
    thinking_content || null, tools_used ? JSON.stringify(tools_used) : null,
    author_email || userEmail, tokens_in || null, tokens_out || null, cached_tokens || 0
  ).run();
  let insertResult;
  try {
    insertResult = await insertMessage(provider || null);
  } catch (e) {
    if (provider && /constraint|check/i.test(String(e.message || e))) {
      insertResult = await insertMessage(null); // DB sin migrar: sacrificar trazabilidad, no el mensaje.
    } else {
      throw e;
    }
  }
  const created = (insertResult?.meta?.changes ?? 0) > 0;

  // Touch chat updated_at.
  await env.DB.prepare(
    `UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?`
  ).bind(chat_id, userEmail).run();

  // --- Notificación push al otro participante en sesiones compartidas ---
  // Solo para mensajes de rol 'user' (la respuesta del modelo la verá al abrir el chat).
  // Fire-and-forget: no penaliza la latencia del autoguardado.
  if (role === 'user') {
    (async () => {
      try {
        const chatRow = await env.DB.prepare(
          `SELECT is_shared FROM chats WHERE id = ?`
        ).bind(chat_id).first();
        if (!chatRow || chatRow.is_shared !== 1) return;

        const senderEmail = author_email || userEmail;
        const otherParticipant = await env.DB.prepare(
          `SELECT cp.user_email
           FROM chat_participants cp
           WHERE cp.chat_id = ? AND cp.user_email IS NOT NULL AND cp.user_email != ?
           LIMIT 1`
        ).bind(chat_id, senderEmail).first();
        if (!otherParticipant) return;

        // Construir nombre del remitente para el cuerpo de la notificación.
        let senderName = 'Un participante';
        try {
          const senderRow = await env.DB.prepare(
            `SELECT profile_json FROM users WHERE email = ?`
          ).bind(senderEmail).first();
          if (senderRow?.profile_json) {
            const p = JSON.parse(senderRow.profile_json);
            senderName = p?.name || senderEmail.split('@')[0];
          }
        } catch {}

        const preview = content.length > 120 ? content.slice(0, 120) + '…' : content;

        insertNotification(env, otherParticipant.user_email, {
          title: 'Nuevo mensaje en sesión compartida',
          body: `${senderName}: ${preview}`,
          type: 'info',
          deep_link: `veritas://chat/${chat_id}`,
        }).catch(() => {});
      } catch {}
    })();
  }

  return json({ ok: true, message_id: msgId, created });
}

// ==============================================================================
// 6.2 — CHAT/OPENROUTER (streaming proxy con rotador + sticky + caching)
// ==============================================================================
async function handleChatOpenRouter(request, env, userEmail) {
  const clientBody = await request.json().catch(() => ({}));
  const { model, messages, stream = true, tools, reasoning, chat_id, is_shared, settings = {} } = clientBody;

  if (!model || (!OPENROUTER_WHITELIST.has(model) && !MODEL_PROVIDER[model])) {
    return errorResponse("model_not_allowed", 400, { model, whitelist: [...OPENROUTER_WHITELIST] });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse("missing_messages", 400);
  }

  // Rate limiting silencioso por usuario (30 req/min).
  const rl = await rateLimit(env, userEmail, "chat", 30, 60);
  if (rl.limited) {
    return errorResponse("rate_limited", 429, { message: "Límite temporal de peticiones alcanzado. Intenta en unos segundos.", retry_after_sec: rl.retryAfterSec });
  }

  // Caché opt-in (cache:true, solo no-stream y no compartido): 24h.
  const useCache = clientBody.cache === true && !is_shared && !stream;
  let cacheKey = null;
  if (useCache) {
    cacheKey = await sha256Hex(userEmail + "|" + model + "|" + JSON.stringify(messages));
    const hit = await llmCacheGet(env, cacheKey, userEmail);
    if (hit) return json({ ...(hit.json || { cached_text: hit.text }), cached: true, model, from_cache: true });
  }

  // --- Construir body upstream ---
  const upstreamBody = { ...clientBody };
  delete upstreamBody.chat_id;
  delete upstreamBody.is_shared;
  delete upstreamBody.settings;

  // --- System prompt: resolver e inyectar el correcto para el modelo ---
  // El frontend envía un system prompt basado en su módulo prompts.js (que puede
  // carecer de BASE_SYSTEM_PROMPT si el admin no lo bundleó en el frontend).
  // El Worker tiene la versión completa (con BASE_SYSTEM_PROMPT real), así que
  // reemplazamos el system message para garantizar identidad completa.
  const uiRole = request.headers.get("x-veritas-role") || null;
  const promptKey = uiRole ? UI_ROLE_TO_PROMPT_KEY[uiRole] : null;
  // Fallback: resolver desde el modelId directamente.
  const resolvedKey = promptKey || MODEL_TO_ROLE[model];
  let systemPrompt = SYSTEM_PROMPTS[resolvedKey] || SYSTEM_PROMPTS.super_executor;
  // v2.8.7: reglas de conducta inmutables — una identidad, una respuesta limpia.
  const CONDUCT = "\n\n<reglas_veritas>\n- Eres una unica identidad: Veritas. Las herramientas son internas; NUNCA muestres bloques tool_call/tool_result, JSON crudo de herramientas, ni instrucciones internas en tu respuesta.\n- Entrega UNA unica respuesta final en el idioma del usuario integrando los resultados.\n- Si generas HTML o graficos, emitelos SOLO dentro de un bloque <file path=\"preview.html\">...</file> y no repitas el codigo en tu respuesta.\n- Si una herramienta falla o no hay datos, responde con tu mejor aproximacion indicando brevemente la limitacion.\n</reglas_veritas>";
  if (systemPrompt && Array.isArray(upstreamBody.messages)) {
    const firstMsg = upstreamBody.messages[0];
    if (firstMsg && firstMsg.role === "system") {
      // Reemplazar el system message existente (placeholder o versión frontend)
      // con la versión completa del Worker que incluye BASE_SYSTEM_PROMPT.
      upstreamBody.messages[0] = { role: "system", content: systemPrompt };
    } else {
      // No hay system message — prepend el del Worker.
      upstreamBody.messages.unshift({ role: "system", content: systemPrompt });
    }
  }

  // v2.8/v2.11 — proveedor según el modelo (OpenRouter primario; Cerebras/Cohere directo).
  const upstreamProvider = getProvider(model);

  // ID del modelo que se envía upstream (sin prefijo de proveedor).
  let modelId = model.replace(/^cerebras\//, "").replace(/^cohere\//, "");

  // Sticky routing (Sección 1.4.1) — solo OpenRouter lo entiende.
  if (upstreamProvider === "openrouter" && settings.stickyRouting !== false && chat_id) {
    upstreamBody.session_id = chat_id;
  }

  // Caching defensivo (Sección 1.4.2) — cache_control es específico de OpenRouter/Anthropic.
  if (upstreamProvider === "openrouter" && settings.promptCaching !== false) {
    upstreamBody.messages = injectCacheControl(upstreamBody.messages, is_shared);
  }

  // Tool result truncation (Sección 1.4.4).
  if (settings.toolTruncation !== false) {
    const limitKB = settings.toolTruncationLimitKB || 2;
    upstreamBody.messages = truncateToolResults(upstreamBody.messages, limitKB * 1024);
  }

  // Sanear el body para proveedores no-OpenRouter: eliminar campos propietarios
  // (cache, session_id, reasoning) que Cerebras/Cohere rechazarían con 400.
  delete upstreamBody.cache;
  if (upstreamProvider !== "openrouter") {
    delete upstreamBody.session_id;
    delete upstreamBody.reasoning;
    // Contenido de mensajes como string plano (sin bloques cache_control).
    if (Array.isArray(upstreamBody.messages)) {
      upstreamBody.messages = upstreamBody.messages.map((m) => {
        if (Array.isArray(m.content)) {
          return { ...m, content: m.content.map((b) => b.text || "").join("\n") };
        }
        return m;
      });
    }
  }

  // --- Llamar upstream con rotador de claves ---
  const startTs = Date.now();
  let keyIndexUsed = null;
  let degraded = false;
  let upstreamResp = null;

  upstreamBody.model = modelId;
  try {
    const result = await withKeyRotation(env, upstreamProvider, async (key) => {
      const accept = stream ? "text/event-stream" : "application/json";
      let url, headers;
      if (upstreamProvider === "cerebras") {
        url = "https://api.cerebras.ai/v1/chat/completions";
        headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": accept };
      } else if (upstreamProvider === "cohere") {
        url = "https://api.cohere.com/v2/chat";
        headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json", "Accept": accept };
      } else {
        url = "https://openrouter.ai/api/v1/chat/completions";
        headers = {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.PAGES_URL || "https://veritas.pages.dev",
          "X-Title": "Véritas",
          "Accept": accept,
        };
      }
      return await fetch(url, { method: "POST", headers, body: JSON.stringify(upstreamBody) });
    });
    upstreamResp = result.response;
    keyIndexUsed = result.keyIndex;
    degraded = result.degraded;
  } catch (e) {
    if (e instanceof AllKeysCooldownError) {
      // Notificar al usuario que el servicio de LLM no está disponible ahora
      insertNotification(env, userEmail, {
        title: "Servicio LLM no disponible",
        body: "Todas las claves del proveedor están en cooldown. El chat se reanudará automáticamente en unos minutos.",
        type: "warning",
        deep_link: clientBody.chat_id ? `veritas://chat/${clientBody.chat_id}` : null,
      }).catch(() => {});
      throw e;
    }
    // v2.12: sin claves configuradas el error tipado debe llegar al handler
    // global (503 key_pool_empty), no disfrazarse de upstream_error 502.
    if (e instanceof KeyPoolEmptyError) throw e;
    return errorResponse("upstream_error", 502, { message: e.message });
  }

  if (!upstreamResp) {
    return errorResponse("upstream_no_response", 502);
  }

  // Si el upstream sigue en error tras reintentos, devolver JSON estructurado.
  if (upstreamResp.status === 429 || upstreamResp.status === 503) {
    return errorResponse("all_keys_rate_limited", 503, {
      retry_after_ms: SERVICE_REGISTRY.openrouter.cooldownMs,
      model,
    });
  }
  if (upstreamResp.status >= 500) {
    return errorResponse("upstream_error", upstreamResp.status, { model });
  }
  if (upstreamResp.status === 401 || upstreamResp.status === 403) {
    return errorResponse("auth_error", upstreamResp.status, { model });
  }
  if (upstreamResp.status >= 400) {
    const errText = await upstreamResp.text();
    return errorResponse("upstream_error", upstreamResp.status, { model, body: errText.slice(0, 1000) });
  }

  // --- Logging de telemetría (opcional, best-effort) ---
  logOpenRouterCall(env, userEmail, model, keyIndexUsed, upstreamResp.status, startTs).catch(() => {});

  // --- Stream passthrough ---
  if (stream) {
    // TransformStream para interceptar el último evento (usage) y persistirlo.
    const ts = new TransformStream({
      async transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });

    // Pipe upstream → cliente. El frontend parsea SSE y manda de vuelta usage
    // vía /api/db/message (tokens_in/out/cached_tokens).
    const headers = new Headers(upstreamResp.headers);
    headers.set("Cache-Control", "no-cache");
    headers.set("Connection", "keep-alive");
    headers.set("Content-Type", "text/event-stream");
    headers.set("X-Veritas-Key-Index", String(keyIndexUsed));
    if (degraded) headers.set("X-Veritas-Degraded", "1");

    return new Response(upstreamResp.body.pipeThrough(ts), { status: 200, headers });
  }

  // Non-streaming: devolver JSON tal cual + header con key_index (+ caché).
  const respHeaders = new Headers();
  respHeaders.set("Content-Type", "application/json");
  respHeaders.set("X-Veritas-Key-Index", String(keyIndexUsed));
  if (degraded) respHeaders.set("X-Veritas-Degraded", "1");
  const rawNonStream = await upstreamResp.text();
  let upstreamData = null;
  try { upstreamData = JSON.parse(rawNonStream); } catch { /* no-JSON */ }
  if (useCache && cacheKey && upstreamData) {
    await llmCacheSet(env, cacheKey, upstreamData.choices && upstreamData.choices[0] && upstreamData.choices[0].message && upstreamData.choices[0].message.content || "", upstreamData, model, userEmail);
  }
  if (upstreamData && upstreamData.usage) {
    await logOpenRouterCall(env, userEmail, model, keyIndexUsed, upstreamResp.status, startTs, {
      tokens_in: upstreamData.usage.prompt_tokens, tokens_out: upstreamData.usage.completion_tokens,
      cached_tokens: (upstreamData.usage.prompt_tokens_details && upstreamData.usage.prompt_tokens_details.cached_tokens) || 0,
    });
  }
  if (upstreamData) return json(upstreamData, 200, { "X-Veritas-Key-Index": String(keyIndexUsed), ...(degraded ? { "X-Veritas-Degraded": "1" } : {}) });
  return new Response(rawNonStream, { status: 200, headers: respHeaders });
}

// ------------------------------------------------------------------------------
// injectCacheControl: transforma messages[0] (system) a array con cache_control.
// ------------------------------------------------------------------------------
function injectCacheControl(messages, isShared) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const sys = messages[0];
  if (!sys || sys.role !== "system") return messages;

  const originalText = typeof sys.content === "string"
    ? sys.content
    : Array.isArray(sys.content)
      ? sys.content.map((b) => b.text || "").join("\n")
      : "";

  const cacheControl = { type: "ephemeral" };
  if (isShared) cacheControl.ttl = "1h";

  return [
    {
      role: "system",
      content: [
        { type: "text", text: originalText },
        {
          type: "text",
          text: "[Configuración fija de Véritas — permanente para este chat]",
          cache_control: cacheControl,
        },
      ],
    },
    ...messages.slice(1),
  ];
}

function truncateToolResults(messages, limitBytes) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (msg.role !== "tool") return msg;
    if (msg.full_requested) return msg;
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    if (content.length <= limitBytes) return msg;
    const truncated = content.slice(0, limitBytes);
    const remaining = content.length - limitBytes;
    return { ...msg, content: `${truncated}\n[... ${remaining} bytes más, pide full=true para verlos]` };
  });
}

async function logOpenRouterCall(env, userEmail, model, keyIndex, status, startTs, tokens) {
  try {
    const t = tokens || {};
    await env.DB.prepare(
      `INSERT INTO openrouter_calls (user_email, model, key_index, status, latency_ms, tokens_in, tokens_out, cached_tokens, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(userEmail, model, keyIndex, status, Date.now() - startTs, t.tokens_in || null, t.tokens_out || null, t.cached_tokens || null).run();
  } catch (e) { /* best-effort */ }
}

// ==============================================================================
// 6.3 — STATUS (Dashboard)
// ==============================================================================

// ------------------------------------------------------------------------------
// v2.8 — /api/llm/complete: completación stateless ligera (Prompt Arquitecto,
// extracción de memorias, micro-tareas). Sin persistencia ni tools.
// Prueba Cerebras → Cohere → OpenRouter con rotación de keys por proveedor.
// ------------------------------------------------------------------------------

async function handleLLMComplete(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const prompt = body.prompt;
  if (!prompt || typeof prompt !== "string") return errorResponse("missing_prompt", 400);
  const maxTokens = Math.min(4000, Math.max(64, Number(body.max_tokens) || 1200));
  const chain = [
    ["cerebras", "gpt-oss-120b", "https://api.cerebras.ai/v1/chat/completions"],
    ["cohere", "command-a-plus-05-2026", "https://api.cohere.com/v2/chat"],
    ["openrouter", "openai/gpt-oss-20b:free", "https://openrouter.ai/api/v1/chat/completions"],
  ];
  const messages = [
    { role: "system", content: body.system || "Eres un asistente útil. Responde solo lo pedido, sin formato extra." },
    { role: "user", content: prompt },
  ];
  let lastErr = null;
  for (const [provider, modelId, url] of chain) {
    try {
      const result = await withKeyRotation(env, provider, async (key) => {
        const headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
        if (provider === "openrouter") {
          headers["HTTP-Referer"] = env.PAGES_URL || "https://veritas.pages.dev";
          headers["X-Title"] = "Véritas";
        }
        return await fetch(url, {
          method: "POST", headers,
          body: JSON.stringify({ model: modelId, messages, stream: false, max_tokens: maxTokens }),
        });
      });
      const resp = result.response;
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "";
        if (text) return json({ text, model: modelId, provider });
      }
      lastErr = `HTTP ${resp.status}`;
    } catch (e) { lastErr = e.message; }
  }
  return errorResponse("all_providers_failed", 502, { detail: lastErr });
}

async function handleStatus(env, userEmail) {
  const services = listServices(env);
  const openrouterPool = services.includes("openrouter") ? await getPoolStatus(env, "openrouter") : null;

  // Ping OpenRouter si hay claves (HEAD request al endpoint de completions).
  let openrouterAvailable = null;
  if (openrouterPool && !openrouterPool.empty) {
    try {
      const start = Date.now();
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "HEAD",
      });
      openrouterAvailable = { available: resp.status < 500, latency_ms: Date.now() - start, status: resp.status };
    } catch (e) {
      openrouterAvailable = { available: false, error: e.message };
    }
  }

  // v2.11: sin Puter. Estado de pools LLM (OpenRouter/Cerebras/Cohere) + servicios.
  const llmPools = {};
  for (const svc of ["openrouter", "cerebras", "cohere"]) {
    if (services.includes(svc)) {
      try { llmPools[svc] = await getPoolStatus(env, svc); } catch { llmPools[svc] = { error: "pool_status_failed" }; }
    }
  }
  return json({
    storage: {
      provider: "r2",
      available: hasBucket(env),
      note: hasBucket(env) ? "R2 operativo." : "R2 no configurado: funciones de archivo desactivadas; el resto de la app funciona.",
    },
    openrouter: openrouterAvailable,
    openrouter_pool_degraded: openrouterPool ? openrouterPool.degraded : null,
    llm_pools: llmPools,
    services: services.map((s) => ({ name: s, registered: true })),
    ts: new Date().toISOString(),
  });
}

// ==============================================================================
// 6.4 — KEYS MANAGEMENT (admin)
// ==============================================================================
async function handleKeysStatus(request, env, userEmail) {
  if (!isAdmin(userEmail, env)) return errorResponse("admin_required", 403);
  const url = new URL(request.url);
  const service = url.searchParams.get("service");
  if (!service) {
    // Devolver estado de todos los servicios.
    const all = {};
    for (const svc of Object.keys(SERVICE_REGISTRY)) {
      try { all[svc] = await getPoolStatus(env, svc); } catch (e) { all[svc] = { error: e.message }; }
    }
    return json({ services: all });
  }
  const status = await getPoolStatus(env, service);
  return json(status);
}

// ------------------------------------------------------------------------------
// Cuota de proveedores: consulta el quotaEndpoint y extrae % restante.
// Devuelve null si el servicio no expone cuota (o no hay endpoint fiable).
// ------------------------------------------------------------------------------
async function getQuotaRemaining(env, service) {
  const svc = SERVICE_REGISTRY[service];
  if (!svc || !svc.quotaEndpoint) return null;
  const keys = discoverKeys(env, service);
  if (!keys.length) return null;
  const key = keys[0].value;
  try {
    const url = new URL(svc.quotaEndpoint);
    if (svc.healthCheckQuery) {
      const q = svc.healthCheckQuery(key);
      for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
    }
    const resp = await fetch(url.toString(), {
      method: svc.healthCheckMethod,
      headers: svc.healthCheckHeaders(key),
      body: svc.healthCheckBody ? svc.healthCheckBody(key) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    if (!data) return null;
    return parseQuotaData(service, data);
  } catch { return null; }
}

// Mapeo best-effort del formato de cuota de cada proveedor.
function parseQuotaData(service, data) {
  let used = null, limit = null;
  switch (service) {
    case "firecrawl":
      used = data.creditsUsed ?? data.credits_used ?? null;
      limit = data.maxCredits ?? data.max_credits ?? null;
      break;
    case "jina":
      used = data.used_credits ?? data.usedCredits ?? data.usage?.used ?? null;
      limit = data.total_credits ?? data.totalCredits ?? data.usage?.limit ?? null;
      break;
    case "openrouter":
      used = data.data?.usage ?? null;
      limit = data.data?.limit ?? null;
      break;
    case "shodan":
      used = data.usage?.query_credits ?? null;
      limit = data.usage_limits?.query_credits ?? null;
      break;
    case "scrapingbee":
      used = data.usage?.pages?.used ?? data.usage?.used ?? null;
      limit = data.usage?.pages?.total ?? data.usage?.total ?? null;
      break;
    default:
      return null;
  }
  if (used == null || !limit) return null;
  const usedN = Number(used), limitN = Number(limit);
  if (!limitN) return null;
  return {
    service,
    used: usedN,
    limit: limitN,
    remaining: Math.max(0, limitN - usedN),
    remaining_pct: Math.round(((limitN - usedN) / limitN) * 100),
  };
}

// ------------------------------------------------------------------------------
// /api/quota — Estado de cuotas de proveedores (admin).
// ------------------------------------------------------------------------------
async function handleQuota(request, env, userEmail) {
  if (!isAdmin(userEmail, env)) return errorResponse("admin_required", 403);
  const services = ["firecrawl", "jina", "openrouter", "shodan", "scrapingbee", "tavily", "serper"];
  const out = [];
  for (const svc of services) {
    const q = await getQuotaRemaining(env, svc);
    if (q) out.push(q);
  }
  const low = out.filter((q) => q.remaining_pct < 25).map((q) => q.service);
  return json({ quotas: out, low_quota_services: low, checked_at: new Date().toISOString() });
}

// ------------------------------------------------------------------------------
// /api/usage — Dashboard de uso de modelos y tools (admin, últimos N días).
// ------------------------------------------------------------------------------
async function handleUsage(request, env, userEmail) {
  if (!isAdmin(userEmail, env)) return errorResponse("admin_required", 403);
  if (!env.DB) return errorResponse("no_db", 503, { message: "D1 no está configurado." });
  const url = new URL(request.url);
  const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days") || "7", 10)));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  try {
    // Por día: llamadas de modelo, tools y tokens
    const daily = await env.DB.prepare(
      `SELECT substr(ts, 1, 10) AS day,
              COUNT(*) AS model_calls,
              COALESCE(SUM(tokens_in), 0) AS tokens_in,
              COALESCE(SUM(tokens_out), 0) AS tokens_out,
              COALESCE(SUM(cached_tokens), 0) AS cached_tokens
       FROM openrouter_calls WHERE ts >= ? GROUP BY day ORDER BY day`
    ).bind(since).all();

    const toolDaily = await env.DB.prepare(
      `SELECT substr(ts, 1, 10) AS day, COUNT(*) AS tool_calls
       FROM tool_calls WHERE ts >= ? GROUP BY day ORDER BY day`
    ).bind(since).all();

    // Por modelo
    const byModel = await env.DB.prepare(
      `SELECT model, COUNT(*) AS calls, COALESCE(SUM(tokens_in), 0) AS tokens_in,
              COALESCE(SUM(tokens_out), 0) AS tokens_out,
              COALESCE(SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END), 0) AS errors
       FROM openrouter_calls WHERE ts >= ? GROUP BY model ORDER BY calls DESC`
    ).bind(since).all();

    // Por tool
    const byTool = await env.DB.prepare(
      `SELECT tool_name, COUNT(*) AS calls,
              COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
              COALESCE(AVG(latency_ms), 0) AS avg_latency_ms
       FROM tool_calls WHERE ts >= ? GROUP BY tool_name ORDER BY calls DESC`
    ).bind(since).all();

    return json({
      days,
      since,
      daily: daily.results || [],
      tool_daily: toolDaily.results || [],
      by_model: byModel.results || [],
      by_tool: byTool.results || [],
    });
  } catch (e) {
    return errorResponse("usage_failed", 500, { message: e.message });
  }
}

async function handleKeysHealth(request, env, userEmail) {
  if (!isAdmin(userEmail, env)) return errorResponse("admin_required", 403);
  const url = new URL(request.url);
  const service = url.searchParams.get("service");
  if (!service) return errorResponse("missing_service", 400);
  const result = await forceHealthCheck(env, service);
  return json(result);
}

async function handleKeysCooldownReset(request, env, userEmail) {
  if (!isAdmin(userEmail, env)) return errorResponse("admin_required", 403);
  const { service, key_index } = await request.json().catch(() => ({}));
  if (!service || !key_index) return errorResponse("missing_params", 400);
  await resetCooldown(env, service, Number(key_index));
  return json({ ok: true, service, key_index });
}

async function handleKeysServices(env, userEmail) {
  // Público (no admin): solo nombres de servicios registrados.
  return json({ services: Object.keys(SERVICE_REGISTRY) });
}

// ==============================================================================
// 6.5 — TOOL INVOKE (dispatcher único)
// ==============================================================================
async function handleToolInvoke(request, env, userEmail) {
  // Rate limiting silencioso (60 req/min — las tools se invocan en ráfaga).
  const rl = await rateLimit(env, userEmail, "tool", 60, 60);
  if (rl.limited) return errorResponse("rate_limited", 429, { message: "Límite temporal de invocación alcanzado.", retry_after_sec: rl.retryAfterSec });
  const body = await request.json().catch(() => ({}));
  const { tool: toolName, args } = body;
  const role = request.headers.get("x-veritas-role") || body.role || null;

  if (!toolName) return errorResponse("missing_tool", 400);
  if (!TOOL_REGISTRY_SERVER[toolName]) return errorResponse("tool_not_found", 404, { tool: toolName });
  if (!isAllowed(toolName, role)) return errorResponse("forbidden", 403, { tool: toolName, role, allowed: TOOL_REGISTRY_SERVER[toolName].allowedRoles });

  const validation = validateArgs(toolName, args || {});
  if (!validation.ok) return errorResponse("invalid_args", 400, { tool: toolName, error: validation.error });

  // OAuth check.
  const meta = TOOL_REGISTRY_SERVER[toolName];
  if (meta.requiresOauth) {
    const row = await env.DB.prepare(
      `SELECT invalid FROM external_connections WHERE user_email = ? AND provider = ?`
    ).bind(userEmail, meta.requiresOauth).first();
    if (!row) {
      return json({
        status: "forbidden",
        output: `Conecta tu cuenta de ${meta.requiresOauth} en Ajustes → Conexiones externas.`,
        latency_ms: 0,
      });
    }
    if (row.invalid === 1) {
      return json({
        status: "forbidden",
        output: `Tu conexión de ${meta.requiresOauth} fue revocada. Reconéctala en Ajustes → Conexiones externas.`,
        latency_ms: 0,
      });
    }
  }

  // Caché de tools de solo lectura (TTL 15 min). Desactivar con no_cache:true.
  const useToolCache = body.no_cache !== true && TOOL_CACHE_ALLOWLIST.has(toolName);
  let toolCacheKey = null;
  if (useToolCache) {
    const _userScoped = TOOL_CACHE_USER_SCOPED.has(toolName) ? userEmail + "|" : "";
    toolCacheKey = await sha256Hex(toolName + "|" + _userScoped + JSON.stringify(validation.args || {}));
    const hit = await toolCacheGet(env, toolCacheKey);
    if (hit) {
      return json({ ...hit, from_cache: true, cached_at: new Date().toISOString() });
    }
  }

  // Ejecutar handler.
  const startTs = Date.now();
  try {
    // --- Inline handler para create_skill (escribe directamente en D1) ---
    if (toolName === "create_skill") {
      return await handleInlineCreateSkill(validation.args, env, userEmail);
    }

    const handler = await importHandler(toolName);
    const ctx = { env, user_email: userEmail, chat_id: body.chat_id || null, role };
    const result = await Promise.race([
      handler.run(validation.args, ctx),
      new Promise((_, reject) => setTimeout(() => reject(new Error("tool_timeout")), 30_000)),
    ]);
    const latency = Date.now() - startTs;

    // Persistir en tool_calls (auditoría).
    persistToolCall(env, userEmail, body.chat_id, toolName, validation.args, result, latency).catch(() => {});

    // Caché del resultado si la tool es de solo lectura y salió bien.
    if (useToolCache && toolCacheKey && result && result.status === "ok") {
      await toolCacheSet(env, toolCacheKey, userEmail, toolName, {
        status: result.status,
        output: result.output,
        ...(result.extra || {}),
      });
    }

    return json({
      status: result.status || "ok",
      output: result.output,
      latency_ms: latency,
      ...(result.extra || {}),
    });
  } catch (e) {
    const latency = Date.now() - startTs;
    persistToolCall(env, userEmail, body.chat_id, toolName, validation.args, { status: "error", output: e.message }, latency).catch(() => {});

    // Notificar al usuario si fue un error de timeout o provider agotado
    const errMsg = e.message || String(e);
    const isTimeout = /timeout/i.test(errMsg);
    const isPoolEmpty = e instanceof KeyPoolEmptyError || e instanceof AllKeysCooldownError || /pool.*empty|all.*keys.*cooldown/i.test(errMsg);
    if (isTimeout || isPoolEmpty) {
      insertNotification(env, userEmail, {
        title: isPoolEmpty ? "Servicio temporalmente no disponible" : "Herramienta tardó demasiado",
        body: isPoolEmpty
          ? `Todas las claves de ${toolName} están en cooldown. Intenta en unos minutos.`
          : `La herramienta ${toolName} excedió el tiempo límite (30s). Inténtalo de nuevo.`,
        type: "error",
        deep_link: body.chat_id ? `veritas://chat/${body.chat_id}` : null,
      }).catch(() => {});
    }

    return json({ status: "error", output: errMsg, latency_ms: latency });
  }
}

/**
 * Inline handler para la tool create_skill.
 * Reutiliza la misma lógica de handleSkillCreate pero dentro del dispatcher de tools.
 */
async function handleInlineCreateSkill(args, env, userEmail) {
  const { name, description, category, icon, color, needsExternal, promptContent } = args;
  const startTs = Date.now();

  const id = skillSlugify(name);
  if (!id) return json({ status: "error", output: "Cannot generate skill ID from name" });

  // Colisión con built-ins (misma lista que handleSkillCreate).
  const STATIC_IDS = new Set([
    "cross-reference-claim", "media-literacy-analyzer", "source-reliability-rater",
    "argument-deconstruct", "timeline-from-sources", "build-entity-graph",
    "detect-coordinated-behavior", "social-username-correlate", "social-profile-analyzer",
    "geolocate-from-visual-cues", "influence-operations-analyst", "social-phenomena-analyst",
    "psychological-profile", "legal-document-analyzer",
    "conflict-dynamics-analyst", "contentanalysis", "geopolitical-risk-analyst",
    "global-logistics-evaluator", "anti-pua", "web-search", "web-reader",
    "image-search", "multi-search-engine", "ai-news-collectors", "aminer-research",
    "qingyan-research", "auto-target-tracker", "coding-agent", "fullstack-dev",
    "agent-browser", "web-artifacts-builder", "web-shader-extractor",
    "process-optimizer", "version-management", "blog-writer", "seo-content-writer",
    "content-strategy", "writing-plans", "paraphrase-humanized",
    "transcreation-localization", "doc-coauthoring", "finance",
    "stock-analysis-skill", "market-research-reports", "text-to-dashboard",
    "image-understand", "image-generation", "image-edit", "video-understand",
    "podcast-generate", "storyboard-manager", "learn", "cheat-sheet",
    "mindfulness-meditation", "quiz-mastery", "study-buddy", "quiz-html",
    "comm-advisor-camp", "crisis-comm-advisor", "marketing-mode",
    "interview-designer", "interview-prep", "jd-resume-tailor", "resume-builder",
    "job-intent-tracker", "canvas-design", "design", "visual-design-foundations",
    "theme-factory", "ui-ux-pro-max", "docx", "pdf", "pptx", "xlsx",
    "skill-creator", "skill-finder-cn", "task-review",
  ]);
  if (STATIC_IDS.has(id)) {
    return json({ status: "error", output: `Skill ID "${id}" conflicts with a built-in skill`, latency_ms: Date.now() - startTs });
  }

  // Verificar si ya existe una custom con ese ID.
  const existing = await env.DB.prepare(
    `SELECT id FROM user_skills WHERE id = ? AND user_email = ? AND is_active = 1`
  ).bind(id, userEmail).first();
  if (existing) {
    return json({ status: "error", output: `Ya existe una skill con ID "${id}"`, latency_ms: Date.now() - startTs });
  }

  // Obtener ordering máximo.
  const maxOrder = await env.DB.prepare(
    `SELECT COALESCE(MAX(ordering), -1) as max_o FROM user_skills WHERE user_email = ?`
  ).bind(userEmail).first();
  const ordering = (maxOrder?.max_o ?? -1) + 1;

  const skillData = {
    name: String(name).trim(),
    description: String(description).trim(),
    category: category || "utility",
    tier: "utility",
    inputType: "text",
    outputType: "analysis_report",
    needsExternal: !!needsExternal,
    promptPath: null,
    references: [],
    icon: icon || "\u2728",
    color: color || "#f59e0b",
    allowedRoles: ["agent", "estratega", "pensador", "coder", "fast"],
  };

  await env.DB.prepare(
    `INSERT INTO user_skills (id, user_email, skill_json, prompt_content, is_active, ordering)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).bind(id, userEmail, JSON.stringify(skillData), (promptContent || "").trim(), ordering).run();

  skillData.id = id;
  skillData._isCustom = true;
  skillData._promptContent = (promptContent || "").trim();

  return json({
    status: "ok",
    output: `Skill "${skillData.name}" creada exitosamente con ID "${id}". Ya está disponible para el usuario.`,
    skill: skillData,
    latency_ms: Date.now() - startTs,
  });
}

async function persistToolCall(env, userEmail, chatId, toolName, args, result, latencyMs) {
  try {
    const outputPreview = String(result.output || "").slice(0, 2048);
    await env.DB.prepare(
      `INSERT INTO tool_calls (user_email, chat_id, tool_name, args_json, status, output_preview, latency_ms, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      userEmail, chatId || null, toolName,
      JSON.stringify(args).slice(0, 8192),
      result.status || "error",
      outputPreview,
      latencyMs
    ).run();
  } catch (e) { /* best-effort */ }
}

async function handleToolsRegistry() {
  return json({ tools: publicRegistry() });
}

// ==============================================================================
// 6.6 — OAUTH (start, callback, disconnect, connections, account)
// ==============================================================================
async function handleOAuthStart(provider, request, env, userEmail) {
  if (provider !== "github") return errorResponse("unknown_provider", 400, { provider });
  const adapter = (await import(`../../lib/services/oauth/${provider}.js`)).default;
  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) return errorResponse("client_id_missing", 500, { provider });

  const state = generateOAuthState();
  const verifier = generatePkceVerifier();
  const challenge = await computePkceChallenge(verifier);

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = `${origin}/api/oauth/${provider}/callback`;

  await env.DB.prepare(
    `INSERT INTO oauth_pending (state, user_email, provider, code_verifier, created_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(state, userEmail, provider, verifier).run();

  // Purgar states viejos (>15 min) en cada start.
  env.DB.prepare(`DELETE FROM oauth_pending WHERE created_at < datetime('now','-15 minutes')`).run().catch(() => {});

  const authUrl = adapter.getAuthUrl({
    clientId,
    redirectUri,
    scopes: adapter.DEFAULT_SCOPES,
    state,
    codeChallenge: challenge,
  });

  return Response.redirect(authUrl, 302);
}

async function handleOAuthCallback(provider, request, env) {
  if (provider !== "github") return errorResponse("unknown_provider", 400);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const frontendBase = `${url.protocol}//${url.host}`;
  if (error) return Response.redirect(`${frontendBase}/ajustes/conexiones?status=error&provider=${provider}&error=${encodeURIComponent(error)}`, 302);
  if (!code || !state) return Response.redirect(`${frontendBase}/ajustes/conexiones?status=error&provider=${provider}&error=missing_code_or_state`, 302);

  const pending = await env.DB.prepare(
    `SELECT user_email, code_verifier FROM oauth_pending WHERE state = ?`
  ).bind(state).first();
  if (!pending) return Response.redirect(`${frontendBase}/ajustes/conexiones?status=error&provider=${provider}&error=invalid_state`, 302);

  await env.DB.prepare(`DELETE FROM oauth_pending WHERE state = ?`).bind(state).run();

  const adapter = (await import(`../../lib/services/oauth/${provider}.js`)).default;
  const clientId = env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET;
  const redirectUri = `${frontendBase}/api/oauth/${provider}/callback`;

  try {
    const tokens = await adapter.exchangeCode({
      code,
      codeVerifier: pending.code_verifier,
      clientId,
      clientSecret,
      redirectUri,
    });

    let accountMetadata = null;
    try {
      accountMetadata = await adapter.getAccountInfo({ accessToken: tokens.access_token });
    } catch (e) { /* best-effort */ }

    await upsertConnection(env, pending.user_email, provider, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in_sec: tokens.expires_in_sec,
      scopes: tokens.scopes,
      account_metadata: accountMetadata,
    });

    return Response.redirect(`${frontendBase}/ajustes/conexiones?status=ok&provider=${provider}`, 302);
  } catch (e) {
    return Response.redirect(`${frontendBase}/ajustes/conexiones?status=error&provider=${provider}&error=${encodeURIComponent(e.message)}`, 302);
  }
}

async function handleOAuthDisconnect(provider, env, userEmail) {
  if (provider !== "github") return errorResponse("unknown_provider", 400);
  // Nota: la revocación en GitHub es best-effort (el usuario puede revocar
     // desde GitHub → Settings → Applications); aquí basta borrar la fila local.
  await env.DB.prepare(
    `DELETE FROM external_connections WHERE user_email = ? AND provider = ?`
  ).bind(userEmail, provider).run();
  return json({ ok: true, disconnected: provider });
}

async function handleOAuthConnections(env, userEmail) {
  const result = await env.DB.prepare(
    `SELECT provider, scopes, expires_at, account_metadata, invalid, created_at, updated_at
       FROM external_connections WHERE user_email = ?`
  ).bind(userEmail).all();
  const connections = (result.results || []).map((r) => ({
    provider: r.provider,
    scopes: r.scopes ? r.scopes.split(",") : [],
    expires_at: r.expires_at,
    account_metadata: r.account_metadata ? JSON.parse(r.account_metadata) : null,
    invalid: r.invalid === 1,
    connected_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return json({ connections });
}

async function handleOAuthAccount(provider, env, userEmail) {
  if (provider !== "github") return errorResponse("unknown_provider", 400);
  const row = await env.DB.prepare(
    `SELECT account_metadata, invalid FROM external_connections WHERE user_email = ? AND provider = ?`
  ).bind(userEmail, provider).first();
  if (!row) return errorResponse("not_connected", 404, { provider });
  return json({
    provider,
    account: row.account_metadata ? JSON.parse(row.account_metadata) : null,
    invalid: row.invalid === 1,
  });
}

// ==============================================================================
// 6.6 — ARTIFACT PROXY (para el iframe del Sandbox)
// ==============================================================================
async function handleArtifactProxy(request, env, userEmail) {
  const { url: targetUrl, method = "GET", headers = {}, body } = await request.json().catch(() => ({}));
  if (!targetUrl) return errorResponse("missing_url", 400);

  let parsed;
  try { parsed = new URL(targetUrl); } catch { return errorResponse("invalid_url", 400); }
  if (parsed.protocol !== "https:") return errorResponse("ssrf_blocked", 400, { reason: "Only HTTPS allowed" });

  // Anti-SSRF: bloquear IPs internas.
  const hostname = parsed.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname) ||
      hostname.startsWith("10.") || hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname.endsWith(".internal")) {
    return errorResponse("ssrf_blocked", 400, { hostname });
  }

  // Lista blanca opcional desde wrangler.toml.
  if (env.ARTIFACT_PROXY_ALLOWED_HOSTS) {
    const allowed = env.ARTIFACT_PROXY_ALLOWED_HOSTS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(hostname)) {
      return errorResponse("host_not_allowed", 403, { hostname, allowed });
    }
  }

  // Si la URL pertenece a un servicio del rotador, inyectar API key automáticamente.
  const serviceForHost = matchServiceByHost(hostname);
  let injectedKey = null;
  let keyIndex = null;
  if (serviceForHost) {
    try {
      const k = await getKey(env, serviceForHost);
      injectedKey = k.key;
      keyIndex = k.index;
    } catch (e) { /* no key available */ }
  }

  const finalHeaders = { ...headers };
  if (injectedKey) {
    // Inyectar según convención del servicio.
    if (serviceForHost === "scrapingbee") parsed.searchParams.set("api_key", injectedKey);
    else if (serviceForHost === "serper") finalHeaders["X-API-KEY"] = injectedKey;
    else if (serviceForHost === "steel") finalHeaders["steel-api-key"] = injectedKey;
    else finalHeaders["Authorization"] = `Bearer ${injectedKey}`;
  }

  const start = Date.now();
  try {
    const resp = await fetch(parsed.toString(), {
      method,
      headers: finalHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });
    const text = await resp.text();
    const latency = Date.now() - start;
    // Auditoría si la URL pertenece a un servicio del rotador.
    if (serviceForHost && keyIndex !== null) {
      auditExternalCall(env, userEmail, serviceForHost, "proxy", parsed.host, resp.status, latency).catch(() => {});
    }
    return new Response(text, {
      status: resp.status,
      headers: {
        "Content-Type": resp.headers.get("Content-Type") || "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Veritas-Proxy-Latency": String(latency),
        "X-Veritas-Proxy-Service": serviceForHost || "none",
      },
    });
  } catch (e) {
    return errorResponse("proxy_failed", 502, { message: e.message });
  }
}

function matchServiceByHost(hostname) {
  if (hostname.endsWith("jina.ai") || hostname === "r.jina.ai" || hostname === "s.jina.ai") return "jina";
  if (hostname.endsWith("tavily.com") || hostname === "api.tavily.com") return "tavily";
  if (hostname.endsWith("serper.dev") || hostname === "google.serper.dev") return "serper";
  if (hostname.endsWith("scrapingbee.com") || hostname === "app.scrapingbee.com") return "scrapingbee";
  if (hostname.endsWith("firecrawl.dev") || hostname === "api.firecrawl.dev") return "firecrawl";
  if (hostname.endsWith("browser-use.com") || hostname === "api.browser-use.com") return "browser_use";
  if (hostname.endsWith("steel.dev") || hostname === "api.steel.dev") return "steel";
  if (hostname.endsWith("openrouter.ai")) return "openrouter";
  return null;
}

// ==============================================================================
// 6.6 — SANDBOX TEMPLATES
// ==============================================================================
async function handleSandboxTemplates() {
  // El catálogo real está en /lib/sandboxTemplates.js (ETAPA 5).
  // v2.12: lista completa de 14 (antes solo 7; el menú del Sandbox ya
  // ofrecía las demás y el modelo podía pedirlas sin que el endpoint las
  // anunciara).
  return json({
    templates: [
      { name: "maplibre-basic", description: "Mapa MapLibre GL centrado en coordenadas dadas, tiles OSM raster." },
      { name: "maplibre-markers", description: "Mapa MapLibre con marcadores arrastrables." },
      { name: "three-scene", description: "Escena Three.js con cámara orbital y mesh por defecto." },
      { name: "chartjs-dashboard", description: "Dashboard con 3 charts (line, bar, doughnut) responsive." },
      { name: "d3-chart", description: "Gráfico D3.js force-directed graph." },
      { name: "tailwind-page", description: "Página completa con Tailwind CDN y secciones hero/features/footer." },
      { name: "plotly-3d", description: "Superficie 3D Plotly.js." },
      { name: "osint-report", description: "Informe OSINT estructurado: resumen, hallazgos, fuentes y confianza." },
      { name: "timeline-investigation", description: "Línea de tiempo vertical de eventos de una investigación." },
      { name: "entity-graph", description: "Grafo de entidades y relaciones con leyenda." },
      { name: "csv-dashboard", description: "Dashboard que carga y grafica un CSV (tabla + charts)." },
      { name: "interactive-quiz", description: "Quiz interactivo con puntuación y feedback." },
      { name: "markdown-doc-viewer", description: "Visor de documentos Markdown renderizado." },
      { name: "kanban-local", description: "Tablero Kanban local con columnas y tarjetas arrastrables." },
    ],
  });
}

// ==============================================================================
// 6.7 — SESIÓN COMPARTIDA
// ==============================================================================
async function handleShareCreate(chatId, request, env, userEmail) {
  // Solo el owner puede crear share.
  const chat = await env.DB.prepare(
    `SELECT id, user_email, is_shared, category FROM chats WHERE id = ? AND user_email = ?`
  ).bind(chatId, userEmail).first();
  if (!chat) return errorResponse("chat_not_found", 404, { chat_id: chatId });

  if (!["agent", "general"].includes(chat.category)) {
    return errorResponse("category_not_shareable", 400, { category: chat.category });
  }

  const shareToken = crypto.randomUUID();
  // v2.12d: la invitación pendiente se guarda en la column share_token de la
  // fila del OWNER. Antes se insertaba una fila con user_email=NULL, pero el
  // schema exige user_email NOT NULL (PK + FK) ⇒ el INSERT fallaba y la
  // generación de enlaces de invitación estaba ROTA en producción.
  // Crear un share nuevo reemplaza el token previo (el enlace viejo caduca).
  await env.DB.prepare(
    `INSERT OR REPLACE INTO chat_participants (chat_id, user_email, role, share_token, joined_at)
     VALUES (?, ?, 'owner', ?, CURRENT_TIMESTAMP)`
  ).bind(chatId, userEmail, shareToken).run();

  await env.DB.prepare(
    `UPDATE chats SET is_shared = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(chatId).run();

  const url = new URL(request.url);
  const shareUrl = `${url.protocol}//${url.host}/chat/${chatId}/join?token=${shareToken}`;
  return json({ ok: true, share_url: shareUrl, share_token: shareToken });
}

async function handleShareRevoke(chatId, env, userEmail) {
  // Solo el owner.
  const owner = await env.DB.prepare(
    `SELECT user_email FROM chat_participants WHERE chat_id = ? AND role = 'owner'`
  ).bind(chatId).first();
  if (!owner || owner.user_email !== userEmail) return errorResponse("not_owner", 403);

  // v2.12d: revocar = limpiar el token pendiente de la fila del owner
  // (antes borraba filas con user_email=NULL que nunca podían existir).
  await env.DB.prepare(
    `UPDATE chat_participants SET share_token = NULL
      WHERE chat_id = ? AND user_email = ? AND role = 'owner'`
  ).bind(chatId, userEmail).run();
  return json({ ok: true });
}

async function handleShareJoin(chatId, url, env, userEmail) {
  const token = url.searchParams.get("token");
  if (!token) return errorResponse("missing_token", 400);

  // v2.12d: quien YA es editor recupera acceso aunque el token esté canjeado
  // (el token es de un solo uso, pero su acceso persiste en chat_participants).
  const existingEditor = await env.DB.prepare(
    `SELECT user_email FROM chat_participants WHERE chat_id = ? AND role = 'editor'`
  ).bind(chatId).first();
  if (existingEditor && existingEditor.user_email === userEmail) {
    return json({ ok: true, chat_id: chatId, role: "editor", already_joined: true });
  }

  // v2.12d: el token pendiente vive en la fila del OWNER (share_token), no en
  // una fila con user_email=NULL (imposible: el schema exige NOT NULL).
  const pending = await env.DB.prepare(
    `SELECT user_email FROM chat_participants WHERE chat_id = ? AND share_token = ? AND role = 'owner'`
  ).bind(chatId, token).first();
  if (!pending) return errorResponse("invalid_or_used_token", 404);

  // El propio owner abriendo su enlace: ya está dentro.
  if (pending.user_email === userEmail) {
    return json({ ok: true, chat_id: chatId, role: "owner", already_joined: true });
  }

  // Ya hay otro editor ⇒ sesión llena.
  if (existingEditor) {
    return errorResponse("session_full", 409, { message: "Sesión compartida llena." });
  }

  // Canjear: limpiar el token de la fila del owner y crear la fila del editor.
  await env.DB.prepare(
    `UPDATE chat_participants SET share_token = NULL
      WHERE chat_id = ? AND share_token = ? AND role = 'owner'`
  ).bind(chatId, token).run();
  await env.DB.prepare(
    `INSERT INTO chat_participants (chat_id, user_email, role, joined_at) VALUES (?, ?, 'editor', CURRENT_TIMESTAMP)`
  ).bind(chatId, userEmail).run();

  // Notificar al owner de la sesión compartida (fire-and-forget)
  const ownerRow = await env.DB.prepare(
    `SELECT user_email FROM chat_participants WHERE chat_id = ? AND role = 'owner' AND user_email IS NOT NULL`
  ).bind(chatId).first();
  if (ownerRow && ownerRow.user_email !== userEmail) {
    insertNotification(env, ownerRow.user_email, {
      title: "Sesión compartida: alguien se unió",
      body: `Un usuario se unió a tu sesión compartida como editor.`,
      type: "info",
      deep_link: `veritas://chat/${chatId}`,
    }).catch(() => {});
  }

  return json({ ok: true, chat_id: chatId, role: "editor" });
}

async function handleShareClose(chatId, env, userEmail) {
  const owner = await env.DB.prepare(
    `SELECT user_email FROM chat_participants WHERE chat_id = ? AND role = 'owner'`
  ).bind(chatId).first();
  if (!owner || owner.user_email !== userEmail) return errorResponse("not_owner", 403);

  // Antes de borrar participantes, notificar al editor (si hay uno activo).
  const editorRow = await env.DB.prepare(
    `SELECT user_email FROM chat_participants WHERE chat_id = ? AND role = 'editor' AND user_email IS NOT NULL`
  ).bind(chatId).first();

  await env.DB.prepare(`DELETE FROM chat_participants WHERE chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`DELETE FROM chat_turn_lock WHERE chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(`DELETE FROM chat_presence WHERE chat_id = ?`).bind(chatId).run();
  await env.DB.prepare(
    `UPDATE chats SET is_shared = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(chatId).run();

  // Notificar al editor que la sesión fue cerrada (fire-and-forget).
  if (editorRow) {
    insertNotification(env, editorRow.user_email, {
      title: 'Sesión compartida cerrada',
      body: 'El owner cerró la sesión compartida. Ya no puedes acceder al chat.',
      type: 'warning',
      deep_link: null,
    }).catch(() => {});
  }

  return json({ ok: true });
}

async function handleParticipants(chatId, env, userEmail) {
  // Verificar acceso.
  const me = await env.DB.prepare(
    `SELECT role FROM chat_participants WHERE chat_id = ? AND user_email = ?`
  ).bind(chatId, userEmail).first();
  if (!me) return errorResponse("not_participant", 403);

  const result = await env.DB.prepare(
    `SELECT cp.user_email, cp.role, cp.joined_at,
            COALESCE(cp2.last_heartbeat, 0) AS last_heartbeat,
            COALESCE(cp2.is_typing, 0) AS is_typing
       FROM chat_participants cp
       LEFT JOIN chat_presence cp2 ON cp.chat_id = cp2.chat_id AND cp.user_email = cp2.user_email
      WHERE cp.chat_id = ?`
  ).bind(chatId).all();

  const now = Date.now();
  const participants = (result.results || []).map((r) => ({
    user_email: r.user_email,
    role: r.role,
    online: r.last_heartbeat > 0 && (now - r.last_heartbeat) < 10_000,
    is_typing: r.is_typing === 1 && (now - r.last_heartbeat) < 5_000,
    joined_at: r.joined_at,
  }));
  return json({ participants, me: me.role });
}

async function handleHeartbeat(chatId, request, env, userEmail) {
  const { is_typing = false } = await request.json().catch(() => ({}));
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO chat_presence (chat_id, user_email, last_heartbeat, is_typing)
     VALUES (?, ?, ?, ?)`
  ).bind(chatId, userEmail, now, is_typing ? 1 : 0).run();
  return json({ ok: true, ts: now });
}

async function handleMessagesPolling(chatId, url, env, userEmail) {
  const since = Number(url.searchParams.get("since") || 0);
  const full = url.searchParams.get("full") === "true";

  // Verificar acceso (owner o editor).
  const me = await env.DB.prepare(
    `SELECT role FROM chat_participants WHERE chat_id = ? AND user_email = ?`
  ).bind(chatId, userEmail).first();
  if (!me) {
    // Si no es shared, verificar que es el owner directo del chat.
    const chat = await env.DB.prepare(
      `SELECT user_email, is_shared FROM chats WHERE id = ?`
    ).bind(chatId).first();
    if (!chat || chat.user_email !== userEmail) return errorResponse("not_participant", 403);
  }

  const limit = full ? 1000 : 200;
  const query = since > 0
    ? env.DB.prepare(
        `SELECT id, role, model, provider, content, thinking_content, tools_used, author_email,
                tokens_in, tokens_out, cached_tokens, created_at, unixepoch(created_at) as ts
           FROM messages WHERE chat_id = ? AND unixepoch(created_at)*1000 > ?
           ORDER BY created_at ASC LIMIT ?`
      ).bind(chatId, since, limit)
    : env.DB.prepare(
        `SELECT id, role, model, provider, content, thinking_content, tools_used, author_email,
                tokens_in, tokens_out, cached_tokens, created_at, unixepoch(created_at) as ts
           FROM messages WHERE chat_id = ?
           ORDER BY created_at ASC LIMIT ?`
      ).bind(chatId, limit);

  const result = await query.all();
  const messages = (result.results || []).map((r) => ({
    ...r,
    tools_used: r.tools_used ? JSON.parse(r.tools_used) : null,
  }));

  // Presencia de participantes (para indicador typing/online).
  const presenceResult = await env.DB.prepare(
    `SELECT user_email, last_heartbeat, is_typing FROM chat_presence WHERE chat_id = ?`
  ).bind(chatId).all();
  const now = Date.now();
  const presence = (presenceResult.results || []).map((r) => ({
    user_email: r.user_email,
    online: (now - r.last_heartbeat) < 10_000,
    is_typing: r.is_typing === 1 && (now - r.last_heartbeat) < 5_000,
  }));

  return json({ messages, presence, server_ts: now });
}

async function handleTurnAcquire(chatId, request, env, userEmail) {
  const { ttl_min = 30 } = await request.json().catch(() => ({}));
  const now = Date.now();
  const ttlMs = Math.min(Math.max(ttl_min, 1), 120) * 60_000;

  const existing = await env.DB.prepare(
    `SELECT held_by_user_email, expires_at FROM chat_turn_lock WHERE chat_id = ?`
  ).bind(chatId).first();

  if (existing) {
    if (existing.expires_at > now && existing.held_by_user_email !== userEmail) {
      return json({
        acquired: false,
        held_by: existing.held_by_user_email,
        expires_at: existing.expires_at,
      });
    }
    // Expirado o mismo usuario: sobrescribir.
  }

  const expiresAt = now + ttlMs;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO chat_turn_lock (chat_id, held_by_user_email, acquired_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).bind(chatId, userEmail, now, expiresAt).run();

  return json({ acquired: true, expires_at: expiresAt });
}

async function handleTurnRelease(chatId, env, userEmail) {
  const lock = await env.DB.prepare(
    `SELECT held_by_user_email FROM chat_turn_lock WHERE chat_id = ?`
  ).bind(chatId).first();
  if (!lock) return json({ ok: true, message: "No lock held." });
  if (lock.held_by_user_email !== userEmail) return errorResponse("not_lock_holder", 403);
  await env.DB.prepare(`DELETE FROM chat_turn_lock WHERE chat_id = ?`).bind(chatId).run();
  return json({ ok: true });
}

async function handleLeave(chatId, env, userEmail) {
  // Antes de borrar, verificar si quien sale es el editor para notificar al owner.
  const participant = await env.DB.prepare(
    `SELECT role FROM chat_participants WHERE chat_id = ? AND user_email = ?`
  ).bind(chatId, userEmail).first();

  await env.DB.prepare(
    `DELETE FROM chat_participants WHERE chat_id = ? AND user_email = ?`
  ).bind(chatId, userEmail).run();
  await env.DB.prepare(
    `DELETE FROM chat_presence WHERE chat_id = ? AND user_email = ?`
  ).bind(chatId, userEmail).run();
  // Si era el holder del turno, liberarlo.
  await env.DB.prepare(
    `DELETE FROM chat_turn_lock WHERE chat_id = ? AND held_by_user_email = ?`
  ).bind(chatId, userEmail).run();

  // Notificar al owner si quien salió fue el editor (fire-and-forget).
  if (participant?.role === 'editor') {
    const ownerRow = await env.DB.prepare(
      `SELECT user_email FROM chat_participants WHERE chat_id = ? AND role = 'owner' AND user_email IS NOT NULL`
    ).bind(chatId).first();
    if (ownerRow) {
      insertNotification(env, ownerRow.user_email, {
        title: 'El editor abandonó la sesión',
        body: 'El colaborador ha salido de la sesión compartida. Ya eres el único participante.',
        type: 'info',
        deep_link: `veritas://chat/${chatId}`,
      }).catch(() => {});
    }
  }

  return json({ ok: true });
}

// ==============================================================================
// 6.8 — RENAME + SUGGEST-TITLE
// ==============================================================================
async function handleRename(chatId, request, env, userEmail) {
  const { title } = await request.json().catch(() => ({}));
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return errorResponse("missing_title", 400);
  }
  const sanitized = title.trim().slice(0, 100);
  // Verificar permiso: owner del chat o editor en shared.
  const chat = await env.DB.prepare(
    `SELECT user_email, is_shared FROM chats WHERE id = ?`
  ).bind(chatId).first();
  if (!chat) return errorResponse("chat_not_found", 404);
  if (chat.user_email === userEmail) {
    // owner directo.
  } else if (chat.is_shared === 1) {
    const me = await env.DB.prepare(
      `SELECT role FROM chat_participants WHERE chat_id = ? AND user_email = ?`
    ).bind(chatId, userEmail).first();
    if (!me) return errorResponse("not_participant", 403);
  } else {
    return errorResponse("not_owner", 403);
  }
  await env.DB.prepare(
    `UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).bind(sanitized, chatId).run();
  return json({ ok: true, title: sanitized });
}

async function handleSuggestTitle(chatId, env, userEmail) {
  // Cargar primer intercambio user-assistant.
  const result = await env.DB.prepare(
    `SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT 2`
  ).bind(chatId).all();
  const msgs = result.results || [];
  if (msgs.length < 2) return json({ suggested_title: null, reason: "not_enough_messages" });
  const userMsg = msgs.find((m) => m.role === "user");
  const assistantMsg = msgs.find((m) => m.role === "assistant");
  if (!userMsg || !assistantMsg) return json({ suggested_title: null });

  // Llamar a Nemotron 3 Nano 30B vía OpenRouter con la pool de claves (es más fiable que Puter desde Worker).
  // Como GLM-Flash en Véritas es Puter, pero Puter no es accesible desde Worker, hacemos
  // best-effort: si la pool de openrouter tiene claves, usar qwen3-next como sugeridor.
  if (discoverKeys(env, "openrouter").length === 0) {
    return json({ suggested_title: null, reason: "openrouter_pool_empty" });
  }
  try {
    const { key, index: _keyIdx } = await getKey(env, "openrouter");
    const prompt = `Genera un título corto (máximo 8 palabras) que resuma el siguiente intercambio. Responde SOLO con el título, sin comillas ni puntuación final. Idioma: el mismo del primer mensaje del usuario.\n\nUsuario: ${userMsg.content.slice(0, 1000)}\n\nAsistente: ${assistantMsg.content.slice(0, 500)}`;
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Véritas",
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-nano-30b-a3b:free",
        messages: [{ role: "user", content: prompt }],
        stream: false,
        max_tokens: 50,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      let title = (data.choices?.[0]?.message?.content || "").trim().split("\n")[0].replace(/^["'«»]+|["'«»,.;]+$/g, "").trim();
      // v2.8.6: rechazar ecos del prompt; fallback = inicio del mensaje del usuario.
      if (/user wants|wants a|respond|responde|genera|generate|title:|the user|título:/i.test(title) || title.length > 60 || title.length < 3) {
        title = (userMsg.content || "").replace(/\s+/g, " ").trim().slice(0, 48);
      }
      if (title) {
        await env.DB.prepare(
          `UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_email = ?`
        ).bind(title, chatId, userEmail).run();
        return json({ suggested_title: title });
      }
    }
    await markCooldown(env, "openrouter", _keyIdx, 30_000, `suggest-title ${resp.status}`);
  } catch (e) { /* fall through */ }
  return json({ suggested_title: null, reason: "generation_failed" });
}

// ==============================================================================
// 6.9 — OFFLINE BUNDLE
// ==============================================================================
async function handleOfflineBundle(env, userEmail) {
  // v2.12: incluir chats compartidos donde el usuario es participante (editor),
  // necesario para que el flujo de join pueda localizar el chat tras canjear el token.
  const chats = await env.DB.prepare(
    `SELECT DISTINCT c.id, c.user_email, c.category, c.title, c.summary_json, c.is_shared, c.updated_at
     FROM chats c
     LEFT JOIN chat_participants cp ON cp.chat_id = c.id AND cp.user_email = ?
     WHERE (c.user_email = ? OR cp.user_email = ?)
     ORDER BY c.updated_at DESC LIMIT 100`
  ).bind(userEmail, userEmail, userEmail).all();

  const chatIds = (chats.results || []).map((c) => c.id);
  let messages = [];
  if (chatIds.length > 0) {
    // Últimos 50 mensajes por chat.
    const placeholders = chatIds.map(() => "?").join(",");
    const msgResult = await env.DB.prepare(
      `SELECT m.id, m.chat_id, m.role, m.model, m.provider, m.content, m.thinking_content,
              m.tools_used, m.author_email, m.tokens_in, m.tokens_out, m.cached_tokens, m.created_at
         FROM messages m
         JOIN (
           SELECT chat_id, id,
                  ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY created_at DESC) AS rn
             FROM messages
            WHERE chat_id IN (${placeholders})
         ) ranked ON m.id = ranked.id
        WHERE ranked.rn <= 50
        ORDER BY m.chat_id, m.created_at ASC`
    ).bind(...chatIds).all();
    messages = msgResult.results || [];
  }

  const bundle = {
    user_email: userEmail,
    generated_at: new Date().toISOString(),
    chats: chats.results || [],
    messages: messages.map((m) => ({
      ...m,
      tools_used: m.tools_used ? JSON.parse(m.tools_used) : null,
    })),
  };

  // Verificar tamaño (5 MB max).
  const size = JSON.stringify(bundle).length;
  return json({
    ...bundle,
    size_bytes: size,
    truncated: size > 5_242_880,
  });
}

// ==============================================================================
// 6.10 — AGENTE: ORQUESTACIÓN Y PERCEPCIÓN (Stack Nemotron)
// ==============================================================================

// POST /api/chat/agent/orchestrate
// Recibe: { chat_id, messages, escalate: "ultra" | null, stream: bool }
// Decide qué modelo del stack Nemotron usar y reenvía a OpenRouter.
// Por defecto → Nemotron 3 Super (ejecutor).
// Si escalate === "ultra" → Nemotron 3 Ultra (orquestador).
// Inyecta el system prompt correspondiente (super_executor o ultra_orchestrator).
// Retorna streaming SSE igual que /api/chat/openrouter.


// v2.9.2: síntesis final multi-proveedor (OpenRouter -> Cerebras -> Cohere).
async function callFallbackLLM(env, prompt) {
  const chain = [
    ["openrouter", "openai/gpt-oss-20b:free", "https://openrouter.ai/api/v1/chat/completions"],
    ["cerebras", "gpt-oss-120b", "https://api.cerebras.ai/v1/chat/completions"],
    ["cohere", "command-a-plus-05-2026", "https://api.cohere.com/v2/chat"],
  ];
  for (const [prov, mid, url] of chain) {
    try {
      const result = await withKeyRotation(env, prov, async (key) => {
        const headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
        if (prov === "openrouter") {
          headers["HTTP-Referer"] = env.PAGES_URL || "https://veritas.pages.dev";
          headers["X-Title"] = "Veritas";
        }
        return await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: mid, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 1400 }),
        });
      });
      if (!result.response.ok) continue;
      const data = await result.response.json().catch(() => null);
      const text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
      if (text) return text;
    } catch { /* siguiente proveedor */ }
  }
  return "";
}

// v2.9: nucleo de ejecucion de tools reutilizable (loop server-side del agente).
async function runToolByName(env, userEmail, role, toolName, args, chatId) {
  if (!TOOL_REGISTRY_SERVER[toolName]) return { status: "error", output: "tool_not_found: " + toolName };
  if (!isAllowed(toolName, role)) return { status: "forbidden", output: "Tool no permitida para el rol " + role + "." };
  const validation = validateArgs(toolName, args || {});
  if (!validation.ok) return { status: "invalid_args", output: validation.error };
  const meta = TOOL_REGISTRY_SERVER[toolName];
  if (meta.requiresOauth) {
    const row = await env.DB.prepare(
      "SELECT invalid FROM external_connections WHERE user_email = ? AND provider = ?"
    ).bind(userEmail, meta.requiresOauth).first();
    if (!row) return { status: "forbidden", output: "Conecta tu cuenta de " + meta.requiresOauth + " en Ajustes." };
    if (row.invalid === 1) return { status: "forbidden", output: "Conexion " + meta.requiresOauth + " revocada." };
  }
  const useToolCache = TOOL_CACHE_ALLOWLIST.has(toolName);
  let toolCacheKey = null;
  if (useToolCache) {
    const _u = TOOL_CACHE_USER_SCOPED.has(toolName) ? userEmail + "|" : "";
    toolCacheKey = await sha256Hex(toolName + "|" + _u + JSON.stringify(validation.args || {}));
    const hit = await toolCacheGet(env, toolCacheKey);
    if (hit) return { status: hit.status || "ok", output: hit.output, from_cache: true };
  }
  const startTs = Date.now();
  try {
    let result;
    if (toolName === "create_skill") {
      const r = await handleInlineCreateSkill(validation.args, env, userEmail);
      const d = await r.json().catch(() => null);
      result = { status: (d && d.status) || "error", output: (d && d.output) || "skill procesada" };
    } else {
      const handler = await importHandler(toolName);
      const ctx = { env, user_email: userEmail, chat_id: chatId || null, role };
      result = await Promise.race([
        handler.run(validation.args, ctx),
        new Promise((_, reject) => setTimeout(() => reject(new Error("tool_timeout")), 20_000)),
      ]);
    }
    const latency = Date.now() - startTs;
    persistToolCall(env, userEmail, chatId, toolName, validation.args, result, latency).catch(() => {});
    if (useToolCache && toolCacheKey && result && result.status === "ok") {
      await toolCacheSet(env, toolCacheKey, userEmail, toolName, { status: result.status, output: result.output, ...(result.extra || {}) });
    }
    return { status: result.status || "ok", output: result.output, latency_ms: latency };
  } catch (e) {
    return { status: "error", output: e.message };
  }
}

async function handleAgentOrchestrate(request, env, userEmail) {
  // v2.9: loop de tools SERVER-SIDE (max 2 rondas) + prompt lite.
  const rl = await rateLimit(env, userEmail, "chat", 30, 60);
  if (rl.limited) return errorResponse("rate_limited", 429, { message: "Limite temporal de peticiones alcanzado.", retry_after_sec: rl.retryAfterSec });
  const body = await request.json().catch(() => ({}));
  const { chat_id, messages, model, escalate, stream = true, skills_block, memory_block } = body;
  if (!Array.isArray(messages) || messages.length === 0) return errorResponse("missing_messages", 400);

  const useCache = body.cache === true && !stream;
  let cacheKey = null;
  if (useCache) {
    cacheKey = await sha256Hex(userEmail + "|" + model + "|" + JSON.stringify(messages));
    const hit = await llmCacheGet(env, cacheKey, userEmail);
    if (hit) return json({ ...(hit.json || { cached_text: hit.text }), cached: true, model, from_cache: true });
  }

  let modelId, roleKey;
  if (escalate === "ultra") { modelId = ROLE_TO_MODEL.ultra_orchestrator; roleKey = "ultra_orchestrator"; }
  else if (model && (OPENROUTER_WHITELIST.has(model) || MODEL_PROVIDER[model])) { modelId = model; roleKey = MODEL_TO_ROLE[modelId] || "super_executor"; }
  else { modelId = ROLE_TO_MODEL.super_executor; roleKey = "super_executor"; }

  let systemPrompt = LITE_AGENT_PROMPT;
  if (roleKey === "ultra_orchestrator") systemPrompt += "\n\nModo ULTRA: orquesta investigacion profunda; descompone en sub-pasos y verifica cruzado.";
  if (memory_block) systemPrompt += "\n\n<memorias_cross_chat>\n" + memory_block + "\n</memorias_cross_chat>";
  if (skills_block) systemPrompt += "\n" + skills_block;

  // v2.10 TOOL-FIRST: búsqueda fresca obligatoria antes del primer LLM,
  // + fecha actual inyectada (evita respuestas con corte de conocimiento).
  const userQuery = (messages.filter((m) => m.role === "user").pop() || {}).content || "";
  const fresh = [];
  const freshJobs = [
    ["web_search", { query: userQuery.slice(0, 400), max_results: 6 }],
    ["gdelt_search", { query: userQuery.slice(0, 300), mode: "events", timespan: "1w" }],
    ["exa_search", { query: userQuery.slice(0, 300) }],
  ];
  // v2.11: en paralelo (antes secuencial: hasta 60s de latencia pre-LLM).
  const freshResults = await Promise.all(freshJobs.map(async ([tn, ta]) => {
    try {
      return { tn, r: await runToolByName(env, userEmail, "agent", tn, ta, chat_id) };
    } catch { return { tn, r: null }; }
  }));
  for (const { tn, r } of freshResults) {
    if (r && r.status === "ok" && r.output) fresh.push("### " + tn + "\n" + String(r.output).slice(0, 4000));
  }
  systemPrompt += "\n\nFecha actual (UTC): " + new Date().toISOString() + ". NUNCA asumas que una fecha reciente es futura; usa los resultados de búsqueda.";
  if (fresh.length) {
    systemPrompt += "\n\n<busqueda_actual>\n" + fresh.join("\n\n") + "\n</busqueda_actual>\nUsa estos resultados frescos como base factual. Si no contienen el dato pedido, dilo sin inventar nada.";
  } else {
    systemPrompt += "\n\nNo se obtuvieron resultados de búsqueda automática; usa tus herramientas si el usuario necesita datos actuales y NO inventes datos.";
  }

  const msgs = [{ role: "system", content: systemPrompt }, ...messages.filter((m) => m.role !== "system")];

  const MAX_TOOL_ROUNDS = 2;
  const MAX_TOOLS_PER_ROUND = 3;
  const startTs = Date.now();
  let lastText = "";
  let lastResultsXml = "";
  const tokens = { in: 0, out: 0, cached: 0 };

  // Proveedor real del modelo elegido (no siempre OpenRouter).
  const orchProvider = getProvider(modelId);
  const orchModelSent = modelId.replace(/^cerebras\//, "").replace(/^cohere\//, "");

  const callLLM = async () => {
    const result = await withKeyRotation(env, orchProvider, async (key) => {
      let url, headers;
      if (orchProvider === "cerebras") {
        url = "https://api.cerebras.ai/v1/chat/completions";
        headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
      } else if (orchProvider === "cohere") {
        url = "https://api.cohere.com/v2/chat";
        headers = { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
      } else {
        url = "https://openrouter.ai/api/v1/chat/completions";
        headers = {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.PAGES_URL || "https://veritas.pages.dev",
          "X-Title": "Veritas",
        };
      }
      return fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: orchModelSent, messages: msgs, stream: false, max_tokens: 1600 }),
      });
    });
    const resp = result.response;
    if (!resp.ok) throw { error: "upstream_error", message: "HTTP " + resp.status };
    const data = await resp.json().catch(() => null);
    if (data && data.usage) {
      tokens.in += data.usage.prompt_tokens || 0;
      tokens.out += data.usage.completion_tokens || 0;
      tokens.cached += (data.usage.prompt_tokens_details && data.usage.prompt_tokens_details.cached_tokens) || 0;
    }
    return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const text = await callLLM();
      lastText = text;
      const calls = parseToolCallXML(text).slice(0, MAX_TOOLS_PER_ROUND);
      if (calls.length === 0) break;
      const results = [];
      for (const c of calls) {
        const r = await runToolByName(env, userEmail, "agent", c.name, c.args, chat_id);
        results.push({ name: c.name, status: r.status || "ok", output: String(r.output == null ? "" : r.output).slice(0, 3000) });
      }
      msgs.push({ role: "assistant", content: text });
      lastResultsXml = results.map((r) => buildToolResultXML(r.name, r.status, r.output)).join("\n");
      const resultsXml = lastResultsXml;
      const tail = round + 1 >= MAX_TOOL_ROUNDS
        ? "Redacta AHORA tu respuesta final al usuario en su idioma, sin tool_calls."
        : "Si son suficientes, redacta tu respuesta final; si no, emite otra llamada de herramienta.";
      msgs.push({ role: "user", content: "<tool_results>\n" + resultsXml + "\n</tool_results>\nProcesa estos resultados. Ronda " + (round + 1) + " de " + MAX_TOOL_ROUNDS + ". " + tail });
      if (round + 1 >= MAX_TOOL_ROUNDS) { lastText = await callLLM(); break; }
    }
    if (!lastText) lastText = await callLLM();
  } catch (e) {
    if (e instanceof AllKeysCooldownError || e instanceof KeyPoolEmptyError) throw e;
    if (!lastText) return errorResponse("upstream_error", 502, { message: e.message });
  }

  // Limpieza final: nunca markup interno en la respuesta.
  const stripRe = [
    new RegExp("<" + "tool_call[\\s\\S]*?(?:" + ("<" + "/tool_call>") + "|$)", "gi"),
    new RegExp("<" + "/?\\s*tool_call[^>]*>", "gi"),
    new RegExp("<" + "tool_result[\\s\\S]*?(?:" + ("<" + "/tool_result>") + "|$)", "gi"),
    new RegExp("<" + "/?\\s*tool_result[^>]*>", "gi"),
    /^\s*Now (summarize|respond|answer|provide)[^\n]*$/gmi,
  ];
  let finalText = lastText || "";
  for (const re of stripRe) finalText = finalText.replace(re, "");
  finalText = finalText.trim();
  // v2.9.1: si el modelo devolvio JSON crudo como respuesta, pedir prosa.
  if (/^[\s]*[\[{]/.test(finalText)) {
    msgs.push({ role: "assistant", content: finalText.slice(0, 2500) });
    msgs.push({ role: "user", content: "El dato anterior es JSON crudo de una herramienta. Redacta AHORA la respuesta final al usuario en prosa y markdown, en su idioma, integrando esos datos. No incluyas JSON crudo ni tool_calls." });
    try {
      const prose = (await callLLM()) || "";
      const cleanProse = stripRe.reduce((s, re) => s.replace(re, ""), prose).trim();
      if (cleanProse && !/^[\s]*[\[{]/.test(cleanProse)) finalText = cleanProse;
    } catch { /* best-effort */ }
  }
  // v2.10.2: si ningun LLM pudo sintetizar pero hay busqueda fresca,
  // entregar los resultados frescos como respuesta (mejor que "no pude").
  if (!finalText && fresh.length) {
    finalText = "**Resultados de busqueda actual** (sintesis LLM no disponible por limite de proveedores):\n\n" + fresh.join("\n\n");
  }

  if (!finalText && lastResultsXml) {
    const prose = await callFallbackLLM(env,
      "Eres Veritas. El usuario hizo una pregunta y estas son las respuestas de las herramientas ejecutadas:\n" +
      lastResultsXml.slice(0, 5000) +
      "\nRedacta la respuesta final al usuario en prosa y markdown, en su idioma, integrando esos datos. Sin JSON crudo ni tool_calls.");
    if (prose) {
      const cleanProse = stripRe.reduce((s, re) => s.replace(re, ""), prose).trim();
      if (cleanProse) finalText = cleanProse;
    }
  }
  if (!finalText) finalText = "No pude completar la respuesta en esta ronda. Reintenta o reformula la pregunta.";

  if (useCache && cacheKey) await llmCacheSet(env, cacheKey, finalText, null, modelId, userEmail);
  logOpenRouterCall(env, userEmail, modelId, null, 200, startTs, { tokens_in: tokens.in, tokens_out: tokens.out, cached_tokens: tokens.cached }).catch(() => {});

  // SSE unica para el cliente (compatible con streamSSE del frontend).
  const enc = new TextEncoder();
  const sse = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode("data: " + JSON.stringify({ id: "orch", choices: [{ delta: { role: "assistant", content: finalText } }] }) + "\n\n"));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(sse, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Veritas-Role": roleKey },
  });
}

async function handlePerceive(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const { attachment_url, attachment_r2_key, modality } = body;

  if (!modality || !["image", "pdf", "audio", "video"].includes(modality)) {
    return errorResponse("invalid_modality", 400, { modality, allowed: ["image", "pdf", "audio", "video"] });
  }
  if (!attachment_url && !attachment_r2_key) {
    return errorResponse("missing_attachment", 400, { message: "Provide attachment_url or attachment_r2_key" });
  }

  // Seleccionar modelo Nano según modalidad.
  let modelId, roleKey;
  if (modality === "image" || modality === "pdf") {
    modelId = ROLE_TO_MODEL.nano_vl;       // nvidia/nemotron-nano-12b-v2-vl:free
    roleKey = "nano_vl";
  } else {
    modelId = ROLE_TO_MODEL.nano_omni;     // nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
    roleKey = "nano_omni";
  }

  // Resolver el contenido del attachment.
  let contentParts;

  if (attachment_r2_key) {
    // v2.7.2 — sin R2 no hay attachments por clave; avisar claro.
    if (!hasBucket(env)) return r2UnavailableResponse();
    // Leer de R2. La key ya debe incluir el prefijo del usuario (ej: attachments/user@/file.png).
    const r2Key = attachment_r2_key.startsWith("attachments/")
      ? attachment_r2_key
      : `attachments/${userEmail}/${attachment_r2_key}`;
    const obj = await env.BUCKET.get(r2Key);
    if (!obj) {
      return errorResponse("attachment_not_found", 404, { r2_key: r2Key });
    }
    const buf = await obj.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    const contentType = obj.customMetadata?.mime_type || guessMimeType(attachment_r2_key, modality);
    contentParts = [
      { type: "text", text: `Analiza el siguiente contenido (${modality}). Responde en español con descripción estructurada.` },
      { type: "image_url", image_url: { url: `data:${contentType};base64,${base64}` } },
    ];
  } else {
    // Usar URL directa. Para VL, envolver como image_url. Para Omni, enviar como URL en texto.
    if (modality === "image" || modality === "pdf") {
      contentParts = [
        { type: "text", text: `Analiza el siguiente contenido (${modality}). Responde en español con descripción estructurada.` },
        { type: "image_url", image_url: { url: attachment_url } },
      ];
    } else {
      // Audio/video: pasar la URL como texto (el modelo Omni debe soportar la URL directamente).
      contentParts = [
        { type: "text", text: `Analiza el siguiente contenido multimedia (${modality}) en la URL: ${attachment_url}. Transcribe y describe en español.` },
      ];
    }
  }

  const systemPrompt = SYSTEM_PROMPTS[roleKey];
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: contentParts },
  ];

  // Llamar a OpenRouter (non-streaming, esperamos respuesta completa).
  const startTs = Date.now();
  let keyIndexUsed = null;
  let upstreamResp = null;

  try {
    const result = await withKeyRotation(env, "openrouter", async (key) => {
      return await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": env.PAGES_URL || "https://veritas.pages.dev",
          "X-Title": "Véritas",
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          stream: false,
          max_tokens: 4096,
        }),
      });
    });
    upstreamResp = result.response;
    keyIndexUsed = result.keyIndex;
  } catch (e) {
    if (e instanceof AllKeysCooldownError || e instanceof KeyPoolEmptyError) throw e;
    return errorResponse("upstream_error", 502, { message: e.message, role: roleKey });
  }

  if (!upstreamResp || !upstreamResp.ok) {
    const status = upstreamResp ? upstreamResp.status : 502;
    const errText = upstreamResp ? (await upstreamResp.text().catch(() => "")) : "";
    // Telemetría del error.
    logOpenRouterCall(env, userEmail, modelId, keyIndexUsed || 0, status, startTs).catch(() => {});
    return errorResponse("perception_failed", status, { model: modelId, role: roleKey, body: errText.slice(0, 500) });
  }

  // Telemetría.
  logOpenRouterCall(env, userEmail, modelId, keyIndexUsed, upstreamResp.status, startTs).catch(() => {});

  const data = await upstreamResp.json();
  const description = data.choices?.[0]?.message?.content || "";

  return json({
    description,
    model: modelId,
    role: roleKey,
    modality,
    tokens_in: data.usage?.prompt_tokens || 0,
    tokens_out: data.usage?.completion_tokens || 0,
  });
}

// Helper: ArrayBuffer → Base64 (sin btoa que no existe en Workers).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Helper: adivinar MIME type del attachment.
function guessMimeType(key, modality) {
  const ext = (key.split(".").pop() || "").toLowerCase();
  const map = {
    // Imágenes
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml",
    // PDF
    pdf: "application/pdf",
    // Audio
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac",
    // Video
    mp4: "video/mp4", webm: "video/webm", avi: "video/x-msvideo", mov: "video/quicktime",
  };
  if (map[ext]) return map[ext];
  // Fallback por modalidad.
  if (modality === "image") return "image/png";
  if (modality === "pdf") return "application/pdf";
  if (modality === "audio") return "audio/mpeg";
  if (modality === "video") return "video/mp4";
  return "application/octet-stream";
}

// ==============================================================================
// 6.11 — SKILLS CRUD (custom user skills, carga dinámica)
// ==============================================================================
// Gestión de skills personalizadas del usuario. Se almacenan en D1 (user_skills)
// y se fusionan en el frontend con las skills estáticas del registry.

/**
 * Genera un slug kebab-case a partir de un nombre.
 * Ej: "Mi Skill de Prueba" → "mi-skill-de-prueba"
 */
function skillSlugify(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 64);
}

/**
 * GET /api/skills — Lista todas las skills personalizadas del usuario.
 */
async function handleSkillsList(env, userEmail) {
  const { results } = await env.DB.prepare(
    `SELECT id, skill_json, prompt_content, is_active, ordering, created_at, updated_at
     FROM user_skills WHERE user_email = ? AND is_active = 1 ORDER BY ordering ASC, created_at ASC`
  ).bind(userEmail).all();

  const skills = (results || []).map((row) => {
    let skillData;
    try { skillData = JSON.parse(row.skill_json); } catch { skillData = {}; }
    // Asegurar que el id del skill coincide con la PK.
    skillData.id = row.id;
    skillData._isCustom = true;
    skillData._promptContent = row.prompt_content;
    skillData._ordering = row.ordering;
    skillData._created_at = row.created_at;
    skillData._updated_at = row.updated_at;
    return skillData;
  });

  return json({ skills });
}

/**
 * POST /api/skills — Crea una nueva skill personalizada.
 * Body: { name, description, category, tier?, inputType?, outputType?,
 *         needsExternal?, icon?, color?, promptContent, references? }
 */
async function handleSkillCreate(request, env, userEmail) {
  const body = await request.json();
  const { name, description, promptContent } = body;

  if (!name || !name.trim()) return errorResponse("validation_error", 400, { message: "name is required" });
  if (!description || !description.trim()) return errorResponse("validation_error", 400, { message: "description is required" });
  if (!promptContent || !promptContent.trim()) return errorResponse("validation_error", 400, { message: "promptContent is required" });

  const id = skillSlugify(name);
  if (!id) return errorResponse("validation_error", 400, { message: "Invalid skill name (cannot generate slug)" });

  // Evitar colisión con IDs estáticos del registry (77 built-in skills).
  const STATIC_IDS = new Set([
    "cross-reference-claim", "media-literacy-analyzer", "source-reliability-rater",
    "argument-deconstruct", "timeline-from-sources", "build-entity-graph",
    "detect-coordinated-behavior", "social-username-correlate", "social-profile-analyzer",
    "geolocate-from-visual-cues", "influence-operations-analyst", "social-phenomena-analyst",
    "psychological-profile", "legal-document-analyzer",
    "conflict-dynamics-analyst", "contentanalysis", "geopolitical-risk-analyst",
    "global-logistics-evaluator", "anti-pua",
    "web-search", "web-reader", "image-search", "multi-search-engine",
    "ai-news-collectors", "aminer-research", "qingyan-research", "auto-target-tracker",
    "coding-agent", "fullstack-dev", "agent-browser", "web-artifacts-builder",
    "web-shader-extractor", "process-optimizer", "version-management",
    "blog-writer", "seo-content-writer", "content-strategy", "writing-plans",
    "paraphrase-humanized", "transcreation-localization", "doc-coauthoring",
    "finance", "stock-analysis-skill", "market-research-reports", "text-to-dashboard",
    "image-understand", "image-generation", "image-edit", "video-understand",
    "podcast-generate", "storyboard-manager",
    "learn", "cheat-sheet", "mindfulness-meditation",
    "quiz-mastery", "study-buddy", "quiz-html",
    "comm-advisor-camp", "crisis-comm-advisor", "marketing-mode",
    "interview-designer", "interview-prep", "jd-resume-tailor", "resume-builder", "job-intent-tracker",
    "canvas-design", "design", "visual-design-foundations", "theme-factory", "ui-ux-pro-max",
    "docx", "pdf", "pptx", "xlsx",
    "skill-creator", "skill-finder-cn", "task-review",
  ]);
  if (STATIC_IDS.has(id)) return errorResponse("validation_error", 409, { message: `Skill ID "${id}" conflicts with a built-in skill` });

  // Obtener ordering máximo.
  const maxOrder = await env.DB.prepare(
    `SELECT COALESCE(MAX(ordering), -1) as max_o FROM user_skills WHERE user_email = ?`
  ).bind(userEmail).first();
  const ordering = (maxOrder?.max_o ?? -1) + 1;

  const skillData = {
    name: name.trim(),
    description: description.trim(),
    category: body.category || "utility",
    tier: body.tier || "utility",
    inputType: body.inputType || "text",
    outputType: body.outputType || "analysis_report",
    needsExternal: !!body.needsExternal,
    promptPath: null,
    references: body.references || [],
    icon: body.icon || "\u2728",
    color: body.color || "#f59e0b",
    allowedRoles: body.allowedRoles || ["agent", "estratega", "pensador", "coder", "fast"],
  };

  await env.DB.prepare(
    `INSERT INTO user_skills (id, user_email, skill_json, prompt_content, is_active, ordering)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).bind(id, userEmail, JSON.stringify(skillData), (promptContent || "").trim(), ordering).run();

  skillData.id = id;
  skillData._isCustom = true;
  skillData._promptContent = (promptContent || "").trim();
  return json({ skill: skillData }, 201);
}

/**
 * PUT /api/skills/:id — Actualiza una skill personalizada.
 */
async function handleSkillUpdate(skillId, request, env, userEmail) {
  const body = await request.json();

  // Verificar que existe y es del usuario.
  const existing = await env.DB.prepare(
    `SELECT id, skill_json, prompt_content FROM user_skills WHERE id = ? AND user_email = ?`
  ).bind(skillId, userEmail).first();
  if (!existing) return errorResponse("not_found", 404, { message: `Skill "${skillId}" not found` });

  let skillData;
  try { skillData = JSON.parse(existing.skill_json); } catch { skillData = {}; }

  // Merge campos proporcionados.
  if (body.name !== undefined) skillData.name = String(body.name).trim();
  if (body.description !== undefined) skillData.description = String(body.description).trim();
  if (body.category !== undefined) skillData.category = body.category;
  if (body.tier !== undefined) skillData.tier = body.tier;
  if (body.inputType !== undefined) skillData.inputType = body.inputType;
  if (body.outputType !== undefined) skillData.outputType = body.outputType;
  if (body.needsExternal !== undefined) skillData.needsExternal = !!body.needsExternal;
  if (body.icon !== undefined) skillData.icon = body.icon;
  if (body.color !== undefined) skillData.color = body.color;
  if (body.references !== undefined) skillData.references = body.references;
  if (body.allowedRoles !== undefined) skillData.allowedRoles = body.allowedRoles;

  const newPrompt = body.promptContent !== undefined ? String(body.promptContent).trim() : existing.prompt_content;

  await env.DB.prepare(
    `UPDATE user_skills SET skill_json = ?, prompt_content = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_email = ?`
  ).bind(JSON.stringify(skillData), newPrompt, skillId, userEmail).run();

  skillData.id = skillId;
  skillData._isCustom = true;
  skillData._promptContent = newPrompt;
  return json({ skill: skillData });
}

/**
 * DELETE /api/skills/:id — Elimina (soft delete) una skill personalizada.
 * v2.12b: firma corregida — el dispatcher pasa (skillId, env, userEmail);
 * antes recibía (skillId, request=env, env=userEmail, userEmail=undefined)
 * y TODOS los borrados caían con 500 "Cannot read properties of undefined".
 */
async function handleSkillDelete(skillId, env, userEmail) {
  // Soft delete: is_active = 0.
  const result = await env.DB.prepare(
    `UPDATE user_skills SET is_active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_email = ? AND is_active = 1`
  ).bind(skillId, userEmail).run();

  if (!result.meta.changes) return errorResponse("not_found", 404, { message: `Skill "${skillId}" not found or already deleted` });

  return json({ deleted: skillId });
}

// ==============================================================================
// 6.12 — Notifications (polling-based push, zero Google/FCM dependency)
// ==============================================================================
// Architecture:
//   - Android app registers a unique device_id via /api/notifications/register
//   - App polls /api/notifications/poll?since=<last_id> every ~15 min via WorkManager
//   - Backend stores notifications in D1; poll returns unseen ones + marks them delivered
//   - Any backend code can enqueue notifications via insertNotification()
//   - No external push service needed — pure Cloudflare Workers + D1.
// ==============================================================================

/**
 * Insert a notification for a user. Call this from any handler that needs to
 * notify the user (e.g. long-running tool completion, shared session activity).
 */
async function insertNotification(env, userEmail, { title, body, type = "info", deep_link = null, data = null }) {
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(
    `INSERT INTO notifications (id, user_email, title, body, type, deep_link, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).bind(id, userEmail, title, body, type, deep_link, data ? JSON.stringify(data) : null).run();
  // Return both seq (for polling cursor) and id (for ack/deep links)
  return { id, seq: result.meta.last_row_id };
}

async function handleNotificationDeviceRegister(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const { device_id, device_name } = body;
  if (!device_id) return errorResponse("missing_device_id", 400, { message: "device_id is required" });

  await env.DB.prepare(
    `INSERT INTO notification_devices (device_id, user_email, device_name, last_poll_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(device_id) DO UPDATE SET
       user_email = excluded.user_email,
       device_name = COALESCE(excluded.device_name, notification_devices.device_name),
       last_poll_at = CURRENT_TIMESTAMP`
  ).bind(device_id, userEmail, device_name || "Android", ).run();

  return json({ ok: true, device_id });
}

async function handleNotificationDeviceUnregister(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const { device_id } = body;
  if (!device_id) return errorResponse("missing_device_id", 400);

  await env.DB.prepare(
    "DELETE FROM notification_devices WHERE device_id = ? AND user_email = ?"
  ).bind(device_id, userEmail).run();

  return json({ ok: true });
}

async function handleNotificationPoll(request, env, userEmail) {
  const url = new URL(request.url);
  // Cursor: integer seq (monotonic AUTOINCREMENT), default 0 = fetch all
  const sinceSeq = parseInt(url.searchParams.get("since") || "0", 10);
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 20, 50);

  // Update device last_poll_at if device_id provided
  const deviceId = request.headers.get("x-veritas-device-id");
  if (deviceId) {
    env.DB.prepare(
      "UPDATE notification_devices SET last_poll_at = CURRENT_TIMESTAMP WHERE device_id = ? AND user_email = ?"
    ).bind(deviceId, userEmail).run().catch(() => {});
  }

  // Fetch unseen notifications (delivered=0) with seq > sinceSeq
  const rows = await env.DB.prepare(
    `SELECT seq, id, title, body, type, deep_link, data_json, created_at
     FROM notifications
     WHERE user_email = ? AND delivered = 0 AND seq > ?
     ORDER BY seq ASC LIMIT ?`
  ).bind(userEmail, sinceSeq, limit).all();

  // Mark them as delivered
  if (rows.results.length > 0) {
    const seqs = rows.results.map(r => r.seq);
    const placeholders = seqs.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE notifications SET delivered = 1, delivered_at = CURRENT_TIMESTAMP
       WHERE seq IN (${placeholders})`
    ).bind(...seqs).run();
  }

  const notifications = rows.results.map(r => ({
    seq: r.seq,
    id: r.id,
    title: r.title,
    body: r.body,
    type: r.type,
    deep_link: r.deep_link,
    data: r.data_json ? JSON.parse(r.data_json) : null,
    created_at: r.created_at,
  }));

  // Return last_seq so the client knows where to resume
  const lastSeq = notifications.length > 0 ? notifications[notifications.length - 1].seq : sinceSeq;

  return json({ ok: true, notifications, last_seq: lastSeq });
}

async function handleNotificationsList(request, env, userEmail) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit")) || 50, 100);
  const offset = parseInt(url.searchParams.get("offset")) || 0;

  const rows = await env.DB.prepare(
    `SELECT seq, id, title, body, type, deep_link, data_json, created_at, delivered, read
     FROM notifications
     WHERE user_email = ?
     ORDER BY seq DESC LIMIT ? OFFSET ?`
  ).bind(userEmail, limit, offset).all();

  const notifications = rows.results.map(r => ({
    seq: r.seq,
    id: r.id,
    title: r.title,
    body: r.body,
    type: r.type,
    deep_link: r.deep_link,
    data: r.data_json ? JSON.parse(r.data_json) : null,
    created_at: r.created_at,
    delivered: !!r.delivered,
    read: !!r.read,
  }));

  return json({ ok: true, notifications });
}

async function handleNotificationAck(request, env, userEmail) {
  const body = await request.json().catch(() => ({}));
  const { ids } = body;
  if (!Array.isArray(ids) || ids.length === 0) return errorResponse("missing_ids", 400);

  const placeholders = ids.map(() => "?").join(",");
  await env.DB.prepare(
    `UPDATE notifications SET read = 1, read_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders}) AND user_email = ?`
  ).bind(...ids, userEmail).run();

  return json({ ok: true, marked_read: ids.length });
}

// ==============================================================================
// Export default (compatibilidad con Cloudflare Pages Functions).
// ==============================================================================
export default { onRequest };
