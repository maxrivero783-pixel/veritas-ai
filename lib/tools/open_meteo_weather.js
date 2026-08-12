// Véritas v2.4 — /lib/tools/open_meteo_weather.js
// Clima actual y pronostico con Open-Meteo.
// API publica gratuita. No requiere keyRotator.

function clamp(val, fb, min, max) { const n = Number(val); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fb; }

export async function run(args = {}) {
  if (args.latitude == null || args.longitude == null) {
    return { success: false, error: 'Parametros "latitude" y "longitude" son obligatorios.' };
  }

  const lat = Number(args.latitude);
  const lon = Number(args.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { success: false, error: 'lat/lon deben ser numeros validos.' };
  }

  const days = clamp(args.forecast_days, 3, 1, 16);
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon
    + '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature'
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
    + '&forecast_days=' + days + '&timezone=auto';

  let resp;
  try { resp = await fetch(url); } catch (e) { return { success: false, error: 'Error de conexion: ' + e.message }; }
  let data;
  try { data = await resp.json(); } catch (e) { return { success: false, error: 'Respuesta invalida.' }; }
  if (!resp.ok) return { success: false, error: 'Open-Meteo HTTP ' + resp.status };

  const cur = data.current || {};
  const daily = data.daily || {};
  const WMO = { 0: 'Despejado', 1: 'Principalmente despejado', 2: 'Parcialmente nublado', 3: 'Nublado', 45: 'Niebla', 48: 'Niebla con escarcha', 51: 'Llovizna ligera', 53: 'Llovizna moderada', 55: 'Llovizna densa', 61: 'Lluvia ligera', 63: 'Lluvia moderada', 65: 'Lluvia fuerte', 71: 'Nevada ligera', 73: 'Nevada moderada', 75: 'Nevada fuerte', 80: 'Chubascos ligeros', 81: 'Chubascos moderados', 82: 'Chubascos fuertes', 95: 'Tormenta', 96: 'Tormenta con granizo' };

  let text = 'Clima en ' + lat + ', ' + lon + '\n' + '='.repeat(60) + '\n';
  text += '>> Actual: ' + (cur.temperature_2m ?? 'N/D') + '°C (sensacion: ' + (cur.apparent_temperature ?? 'N/D') + '°C)\n';
  text += 'Humedad: ' + (cur.relative_humidity_2m ?? 'N/D') + '% · Viento: ' + (cur.wind_speed_10m ?? 'N/D') + ' km/h\n';
  text += 'Condicion: ' + (WMO[cur.weather_code] || ('codigo ' + (cur.weather_code || 'N/D'))) + '\n\n';

  if (daily.time?.length) {
    text += '-- Pronostico --\n';
    for (let i = 0; i < daily.time.length; i++) {
      const t = daily.time[i];
      text += t + ': ' + (daily.temperature_2m_min?.[i] ?? '?') + '°C / ' + (daily.temperature_2m_max?.[i] ?? '?') + '°C';
      text += ' · Precip ' + (daily.precipitation_probability_max?.[i] ?? '?') + '%';
      text += ' · ' + (WMO[daily.weather_code?.[i]] || ('cod ' + (daily.weather_code?.[i] ?? '?'))) + '\n';
    }
  }

  return { success: true, output: text.trim(), data: { current: cur, daily: daily } };
}
