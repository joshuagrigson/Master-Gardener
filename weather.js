/* weather.js — Open-Meteo client (no API key) for Master Gardener.
   forecast(): current + 7 past days + 7 forecast days, in °F / inches.
   dailySeries(): one record per day from a start date to the end of the forecast,
   stitching the historical archive onto the forecast window.
   gdd(): growing degree days accumulated over a date range for a base temperature. */
window.WX = (() => {
  const FORECAST = 'https://api.open-meteo.com/v1/forecast';
  const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
  const mem = new Map();

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const shift = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    return r.json();
  }

  async function forecast(lat, lon) {
    const key = `fc:${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = mem.get(key);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.data;
    const q = new URLSearchParams({
      latitude: lat, longitude: lon,
      current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,weather_code',
      temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch',
      timezone: 'auto', past_days: 92, forecast_days: 7, // 92 past days covers most of a season without the archive endpoint
    });
    const data = await getJSON(`${FORECAST}?${q}`);
    mem.set(key, { at: Date.now(), data });
    return data;
  }

  async function history(lat, lon, start, end) {
    const key = `ar:${lat.toFixed(3)},${lon.toFixed(3)}:${start}:${end}`;
    const hit = mem.get(key);
    if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.data;
    const q = new URLSearchParams({
      latitude: lat, longitude: lon, start_date: start, end_date: end,
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
      temperature_unit: 'fahrenheit', precipitation_unit: 'inch', timezone: 'auto',
    });
    const data = await getJSON(`${ARCHIVE}?${q}`);
    mem.set(key, { at: Date.now(), data });
    return data;
  }

  function fold(daily, into, fields) {
    if (!daily || !daily.time) return;
    daily.time.forEach((day, i) => {
      const rec = into.get(day) || { day };
      for (const [from, to] of fields) {
        const v = daily[from] ? daily[from][i] : null;
        if (v !== null && v !== undefined && !Number.isNaN(v)) rec[to] = v;
      }
      into.set(day, rec);
    });
  }

  /* Returns { days: Map<iso, {tmax,tmin,rain,et0,pop,code}>, fetchedAt, partial } */
  async function dailySeries(lat, lon, startISO) {
    const fc = await forecast(lat, lon);
    const days = new Map();
    fold(fc.daily, days, [
      ['temperature_2m_max', 'tmax'], ['temperature_2m_min', 'tmin'], ['precipitation_sum', 'rain'],
      ['et0_fao_evapotranspiration', 'et0'], ['precipitation_probability_max', 'pop'], ['weather_code', 'code'],
    ]);
    let partial = false;
    const firstFc = fc.daily.time[0];
    if (startISO && startISO < firstFc) {
      try {
        const ar = await history(lat, lon, startISO, shift(firstFc, -1));
        fold(ar.daily, days, [['temperature_2m_max', 'tmax'], ['temperature_2m_min', 'tmin'], ['precipitation_sum', 'rain']]);
      } catch (e) { partial = true; }
    }
    return { days, current: fc.current, fetchedAt: Date.now(), partial, tz: fc.timezone };
  }

  /* Accumulate GDD (°F-days) from startISO through endISO inclusive. */
  function gdd(days, startISO, endISO, base) {
    let sum = 0, covered = 0, total = 0;
    for (let d = startISO; d <= endISO; d = shift(d, 1)) {
      total++;
      const r = days.get(d);
      if (!r || r.tmax == null || r.tmin == null) continue;
      covered++;
      sum += Math.max(0, (r.tmax + r.tmin) / 2 - base);
    }
    return { gdd: Math.round(sum), covered, total };
  }

  function describe(code) {
    if (code === 0) return { icon: '☀️', text: 'Clear' };
    if (code <= 2) return { icon: '🌤️', text: 'Mostly clear' };
    if (code === 3) return { icon: '☁️', text: 'Overcast' };
    if (code <= 48) return { icon: '🌫️', text: 'Fog' };
    if (code <= 57) return { icon: '🌦️', text: 'Drizzle' };
    if (code <= 67) return { icon: '🌧️', text: 'Rain' };
    if (code <= 77) return { icon: '❄️', text: 'Snow' };
    if (code <= 82) return { icon: '🌦️', text: 'Showers' };
    if (code <= 86) return { icon: '🌨️', text: 'Snow showers' };
    return { icon: '⛈️', text: 'Thunderstorms' };
  }

  return { forecast, history, dailySeries, gdd, describe, iso, parse, shift };
})();
