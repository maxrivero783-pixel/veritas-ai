import { fetchT } from '../services/http.js';
// Shared helpers for public, no-key-first research tools.
// Keep results bounded so tool responses remain usable in the chat context.
export const MAX_OUTPUT_CHARS = 30_000;

export async function fetchJson(url, options = {}) {
  const response = await fetchT(url, options);
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { /* caller can use raw */ }
  return { status: response.status, ok: response.ok, data, raw };
}

export function clamp(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

export function truncate(text, max = MAX_OUTPUT_CHARS) {
  const value = typeof text === "string" ? text : JSON.stringify(text, null, 2);
  return value.length > max ? `${value.slice(0, max)}\n\n[… truncado a ${max} caracteres]` : value;
}

export function lines(items, formatter) {
  return (items || []).map(formatter).filter(Boolean).join("\n\n");
}

export function errorOutput(service, response) {
  const detail = response?.data?.message || response?.raw?.slice(0, 500) || "Solicitud fallida";
  return { status: "error", output: `${service} HTTP ${response?.status || "?"}: ${detail}` };
}
