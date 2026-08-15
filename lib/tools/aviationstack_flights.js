import { discoverKeys, getKey, markCooldown } from '../keyRotator.js';
import aviationstack from '../services/aviationstack.js';

const MAX_OUTPUT_BYTES = 50_000;
const VALID_MODES = ['flights', 'airlines', 'airports'];
const VALID_STATUS = ['scheduled', 'active', 'landed', 'cancelled', 'incident', 'diverted'];

export async function run(args, ctx) {
  const { env } = ctx;
  const {
    mode = 'flights', flight_iata, flight_icao, flight_number, airline_name, airline_iata,
    dep_iata, arr_iata, flight_status, search, iata, limit,
  } = args || {};

  if (!VALID_MODES.includes(mode)) {
    return { status: 'error', output: `Argumento "mode" inválido. Valores válidos: ${VALID_MODES.join(', ')}` };
  }
  if (flight_status && !VALID_STATUS.includes(flight_status)) {
    return { status: 'error', output: `Argumento "flight_status" inválido. Valores: ${VALID_STATUS.join(', ')}` };
  }
  if (mode === 'flights' && !flight_iata && !flight_icao && !flight_number && !airline_name && !airline_iata && !dep_iata && !arr_iata) {
    return { status: 'error', output: 'El modo "flights" requiere al menos un filtro: flight_iata, flight_number, airline_name, dep_iata o arr_iata (evita escaneos globales que agotan la cuota).' };
  }
  if ((mode === 'airlines' || mode === 'airports') && !search && !iata) {
    return { status: 'error', output: `El modo "${mode}" requiere "search" (texto) o "iata" (código).` };
  }

  if (discoverKeys(env, 'aviationstack').length === 0) {
    return { status: 'error', output: 'AviationStack no configurado. Agrega AVIATIONSTACK_API_KEY_1 como secreto. Nota: el plan free solo permite HTTP y ~100 req/mes.' };
  }

  const startTs = Date.now();
  try {
    const { key, index } = await getKey(env, 'aviationstack');
    const payload = { flight_iata, flight_icao, flight_number, airline_name, airline_iata, dep_iata, arr_iata, flight_status, search, iata, limit };
    const r = await aviationstack.callService({ endpoint: mode, payload, apiKey: key });

    if (r.status >= 400 || r.error) {
      await markCooldown(env, 'aviationstack', index, 60_000, `HTTP ${r.status}`);
      return { status: 'error', output: `AviationStack ${mode} failed: ${r.error || ('HTTP ' + r.status)}. Si usas plan free recuerda que HTTPS no está permitido y el límite es ~100 req/mes.`, latency_ms: Date.now() - startTs };
    }
    let content = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
    if (content.length > MAX_OUTPUT_BYTES) content = content.slice(0, MAX_OUTPUT_BYTES) + '\n...[truncado]';
    return { status: 'ok', output: content, latency_ms: Date.now() - startTs };
  } catch (e) {
    return { status: 'error', output: `Error: ${e.message}`, latency_ms: Date.now() - startTs };
  }
}

export default { run };
