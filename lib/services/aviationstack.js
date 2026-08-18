import { fetchT } from './http.js';
// ==============================================================================
// Véritas v2.12.3 — /lib/services/aviationstack.js
// ==============================================================================
// Adaptador HTTP para AviationStack v1 (tracking de vuelos en tiempo real).
//
// ⚠️ Plan FREE = HTTP solamente (https:// falla en free; HTTPS requiere plan pago).
// Auth: access_key como query parameter.
// Free: ~100 requests/mes, sin datos históricos (flight_date es de pago).
//
// Endpoints cubiertos:
//   "flights"   → /v1/flights   (filtros: flight_iata/icao, flight_number, airline_*,
//                                dep_iata, arr_iata, flight_status, limit/offset)
//   "airlines"  → /v1/airlines  (búsqueda de aerolíneas)
//   "airports"  → /v1/airports  (búsqueda de aeropuertos)
// ==============================================================================

const BASE_HTTP = "http://api.aviationstack.com/v1";
const BASE_HTTPS = "https://api.aviationstack.com/v1";

export async function callService({ endpoint, payload, apiKey, useHttps = false }) {
  const base = useHttps ? BASE_HTTPS : BASE_HTTP;
  let url;
  switch (endpoint) {
    case "flights": {
      const {
        flight_iata, flight_icao, flight_number, airline_name, airline_iata, airline_icao,
        dep_iata, arr_iata, flight_status, flight_date, limit = 10, offset = 0,
      } = payload;
      url = new URL(`${base}/flights`);
      url.searchParams.set("access_key", apiKey);
      for (const [k, v] of Object.entries({
        flight_iata, flight_icao, flight_number, airline_name, airline_iata, airline_icao,
        dep_iata, arr_iata, flight_status, flight_date,
      })) if (v) url.searchParams.set(k, v);
      url.searchParams.set("limit", String(Math.min(100, Math.max(1, Number(limit) || 10))));
      if (offset) url.searchParams.set("offset", String(offset));
      break;
    }
    case "airlines": {
      url = new URL(`${base}/airlines`);
      url.searchParams.set("access_key", apiKey);
      if (payload.search) url.searchParams.set("search", payload.search);
      url.searchParams.set("limit", String(Math.min(100, Math.max(1, Number(payload.limit) || 10))));
      break;
    }
    case "airports": {
      url = new URL(`${base}/airports`);
      url.searchParams.set("access_key", apiKey);
      if (payload.search) url.searchParams.set("search", payload.search);
      if (payload.iata) url.searchParams.set("iata", payload.iata);
      url.searchParams.set("limit", String(Math.min(100, Math.max(1, Number(payload.limit) || 10))));
      break;
    }
    default:
      return { status: 400, data: null, raw: null, error: `Unknown AviationStack endpoint: ${endpoint}` };
  }
  const response = await fetchT(url.toString(), { timeoutMs: 20000 });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  // AviationStack devuelve errores dentro del cuerpo con HTTP 200 en algunos casos.
  const apiError = data && data.error ? `${data.error.code || ""} ${data.error.message || ""}`.trim() : undefined;
  return { status: response.status, data, raw, error: (!response.ok ? `HTTP ${response.status}` : apiError) || undefined };
}

export default { callService };
