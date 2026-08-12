// ==============================================================================
// Véritas v2.4 — /lib/tools/open_meteo_weather.js
// ==============================================================================
// Clima actual y pronóstico con Open-Meteo (pública, sin key).
// ==============================================================================

export async function run(args) {
  if (args.latitude == null || args.longitude == null) {
    return { success: false, error: 'Parametros "latitude" y "longitude" son obligatorios.' };
  }

  const lat = Number(args.latitude);
  const lon = Number(args.longitude);
  const days = Math.min(Math.max(Math.floor(Number(args.forecast_days)) || 3, 1), 16);

  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature,pressure_msl',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max',
      forecast_days: String(days),
      timezone: 'auto',
    });

    const resp = await fetch('https://api.open-meteo.com/v1/forecast?' + params.toString(), {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return { success: false, error: 'Open-Meteo HTTP ' + resp.status };
    const data = await resp.json();

    const cur = data.current || {};
    const daily = data.daily || {};
    let output = 'Open-Meteo — ' + lat + ', ' + lon;
    if (data.timezone) output += ' (' + data.timezone + ')';

    output += '\n\n--- Actual ---';
    if (cur.temperature_2m !== undefined) output += '\nTemperatura: ' + cur.temperature_2m + ' C';
    if (cur.apparent_temperature !== undefined) output += ' (sensación: ' + cur.apparent_temperature + ' C)';
    if (cur.relative_humidity_2m !== undefined) output += '\nHumedad: ' + cur.relative_humidity_2m + '%';
    if (cur.wind_speed_10m !== undefined) output += '\nViento: ' + cur.wind_speed_10m + ' km/h';
    if (cur.pressure_msl !== undefined) output += '\nPresión: ' + Math.round(cur.pressure_msl) + ' hPa';
    if (cur.weather_code !== undefined) output += '\nCódigo clima: ' + cur.weather_code + ' (' + weatherLabel(cur.weather_code) + ')';

    if (daily.time && daily.time.length > 0) {
      output += '\n\n--- Pronóstico (' + days + ' días) ---';
      daily.time.forEach(function(date, i) {
        output += '\n' + date;
        if (daily.temperature_2m_max) output += ' | ' + daily.temperature_2m_max[i] + '/' + daily.temperature_2m_min[i] + ' C';
        if (daily.precipitation_probability_max) output += ' | Lluvia: ' + daily.precipitation_probability_max[i] + '%';
        if (daily.wind_speed_10m_max) output += ' | Viento: ' + daily.wind_speed_10m_max[i] + ' km/h';
        if (daily.weather_code) output += ' | ' + weatherLabel(daily.weather_code[i]);
      });
    }

    return { success: true, latitude: lat, longitude: lon, current: cur, daily: daily, output: output };
  } catch (err) {
    return { success: false, error: 'Error de conexión: ' + (err.message || err) };
  }
}

function weatherLabel(code) {
  const map = { 0:'Despejado', 1:'Poco nuboso', 2:'Parcialmente nuboso', 3:'Nublado', 45:'Niebla', 48:'Niebla con escarcha', 51:'Llovizna leve', 53:'Llovizna', 55:'Llovizna intensa', 61:'Lluvia leve', 63:'Lluvia moderada', 65:'Lluvia fuerte', 71:'Nieve leve', 73:'Nieve', 75:'Nieve fuerte', 80:'Chubascos', 81:'Chubascos moderados', 82:'Chubascos fuertes', 95:'Tormenta', 96:'Tormenta con granizo' };
  return map[code] || 'Desconocido';
}
