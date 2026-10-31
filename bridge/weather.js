// Route-aware weather (Open-Meteo). Uses today's plan bearings when present.
const { getJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const HOME_LAT = process.env.HOME_LAT || 39.0;
const HOME_LON = process.env.HOME_LON || -76.5;
const ROUTE_BEARING = 135;

// windDeg is where the wind comes FROM (the meteorological convention Open-Meteo
// uses); heading is the way the bike points. d is how far the wind's source is
// from straight ahead: 0 means the wind comes from where you are going, a
// headwind; 180 means it comes from behind, a tailwind. (This read the other
// way round until October 2026, so every route-weather line was inverted.)
function windKind(windDeg, heading) {
  const d = Math.abs(((windDeg - heading) + 540) % 360 - 180);
  return d < 45 ? 'headwind' : d < 135 ? 'crosswind' : 'tailwind';
}
async function routeWeather(hour) {
  const p = await getJSON('plan', null);
  const plan = (p && p.for_date === tz.todayKey()) ? p : null;
  const lat = (plan && plan.route && plan.route.start_lat) || HOME_LAT;
  const lon = (plan && plan.route && plan.route.start_lon) || HOME_LON;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=2&timezone=auto`;
  const r = await fetch(u); const d = await r.json();
  const h = d.hourly, now = new Date().getHours();
  const at = i => ({ t: Math.round(h.temperature_2m[i]), p: h.precipitation_probability[i],
                     w: Math.round(h.wind_speed_10m[i]), dir: h.wind_direction_10m[i] });
  const describe = pt => {
    if (plan && plan.route) {
      const out = windKind(pt.dir, plan.route.bearing_out);
      const back = windKind(pt.dir, plan.route.bearing_back);
      return out === back ? `${out} ${pt.w} mph the whole way`
                          : `${out} ${pt.w} mph out, ${back} home`;
    }
    return windKind(pt.dir, ROUTE_BEARING) + ' ' + pt.w + ' mph';
  };
  const out = {
    now: { ...at(now), ride: describe(at(now)) },
    evening: { ...at(17), ride: describe(at(17)) },
    stormAfterHour: h.precipitation_probability.findIndex((x, i) => i > now && x > 50)
  };
  if (!isNaN(hour) && hour >= 0 && hour <= 23) out.at = { hour, ...at(hour), ride: describe(at(hour)) };
  return out;
}
// Hour by hour across a ride: temperature, feels-like, rain chance, wind and
// gusts, with the wind read against the route's bearing. Any day from three
// back to seven ahead. Open-Meteo, no key.
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
// The sky in one word, from the WMO weather code (what Open-Meteo gives) and
// the cloud cover: thunder, snow, rain, drizzle, fog, cloud, partly, sun (moon at night).
function skyOf(code, cloud, isDay) {
  if (code == null && cloud == null) return null;
  if (code >= 95) return 'thunder';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 45 || code === 48) return 'fog';
  const c = cloud != null ? cloud : code === 3 ? 90 : code === 2 ? 60 : code === 1 ? 30 : 0;
  if (c >= 80) return 'cloud';
  if (c >= 30) return isDay ? 'partly' : 'partly-night';
  return isDay ? 'sun' : 'moon';
}
async function forecastAt(dateKey, startMin, minutes, opts) {
  const o = opts || {};
  const lat = o.lat || HOME_LAT, lon = o.lon || HOME_LON, bearing = o.bearing || ROUTE_BEARING;
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,relative_humidity_2m` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=7&past_days=3&timezone=auto`;
  const r = await fetch(u); if (!r.ok) throw new Error('open-meteo ' + r.status);
  const d = await r.json(); const h = d.hourly;
  const h0 = Math.floor((startMin == null ? 7 * 60 : startMin) / 60), h1 = Math.ceil(((startMin == null ? 7 * 60 : startMin) + (minutes || 60)) / 60);
  const hours = [];
  for (let hh = h0; hh <= Math.min(23, h1); hh++) {
    const i = h.time.indexOf(`${dateKey}T${String(hh).padStart(2, '0')}:00`);
    if (i < 0) continue;
    const dir = h.wind_direction_10m[i];
    hours.push({ hour: hh, temp_f: Math.round(h.temperature_2m[i]), feels_f: Math.round(h.apparent_temperature[i]), rain_pct: h.precipitation_probability[i], rain_in: h.precipitation[i],
      wind_mph: Math.round(h.wind_speed_10m[i]), gust_mph: Math.round(h.wind_gusts_10m[i]), wind_from: compass(dir), wind_deg: dir, humidity: h.relative_humidity_2m[i],
      ride: windKind(dir, bearing) + ' out, ' + windKind(dir, (bearing + 180) % 360) + ' home' });
  }
  if (!hours.length) return null;
  const mid = hours[Math.floor(hours.length / 2)];
  return { date: dateKey, hours, summary: `${mid.temp_f}°F, feels ${mid.feels_f}°, wind ${mid.wind_mph} mph from the ${mid.wind_from}${mid.gust_mph > mid.wind_mph + 8 ? `, gusts ${mid.gust_mph}` : ''}, ${mid.rain_pct}% rain`,
    bearing, source: 'Open-Meteo' };
}
// Each hour of a day graded for riding outside: red when it is dark, very
// cold, very hot, very windy or wet; amber when marginal; green otherwise.
// Daylight from Open-Meteo's sunrise and sunset for that day.
function gradeHour(h, sunrise, sunset) {
  const why = []; let g = 'good';
  const bad = r => { g = 'bad'; why.push(r); }, ok = r => { if (g !== 'bad') g = 'ok'; why.push(r); };
  if (h.hour < sunrise || h.hour >= sunset) bad('dark');
  if (h.feels_f < 35) bad(`${h.feels_f}° feels`); else if (h.feels_f < 45) ok(`${h.feels_f}° feels`);
  if (h.feels_f > 95) bad(`${h.feels_f}° feels`); else if (h.feels_f > 88) ok(`${h.feels_f}° feels`);
  if (h.wind_mph >= 20 || h.gust_mph >= 32) bad(`wind ${h.wind_mph}, gusts ${h.gust_mph}`); else if (h.wind_mph >= 14 || h.gust_mph >= 25) ok(`wind ${h.wind_mph}, gusts ${h.gust_mph}`);
  if (h.rain_pct >= 60 || h.rain_in >= 0.05) bad(`${h.rain_pct}% rain`); else if (h.rain_pct >= 35) ok(`${h.rain_pct}% rain`);
  return { grade: g, why };
}
async function outlook(from, to) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${HOME_LAT}&longitude=${HOME_LON}` +
    `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,cloud_cover,is_day` +
    `&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=7&past_days=3&timezone=auto`;
  const r = await fetch(u); if (!r.ok) throw new Error('open-meteo ' + r.status);
  const d = await r.json(); const h = d.hourly, dd = d.daily;
  const days = {};
  for (let k = 0; k < dd.time.length; k++) {
    const date = dd.time[k];
    if (date < from || date > to) continue;
    const sr = +dd.sunrise[k].slice(11, 13) + (+dd.sunrise[k].slice(14, 16) >= 30 ? 1 : 0), ss = +dd.sunset[k].slice(11, 13);
    const hours = [];
    for (let hh = 0; hh < 24; hh++) {
      const i = h.time.indexOf(`${date}T${String(hh).padStart(2, '0')}:00`); if (i < 0) continue;
      const code = h.weather_code ? h.weather_code[i] : null, cloud = h.cloud_cover ? h.cloud_cover[i] : null, isDay = h.is_day ? h.is_day[i] !== 0 : true;
      const pt = { hour: hh, temp_f: Math.round(h.temperature_2m[i]), feels_f: Math.round(h.apparent_temperature[i]), rain_pct: h.precipitation_probability[i], rain_in: h.precipitation[i],
        wind_mph: Math.round(h.wind_speed_10m[i]), gust_mph: Math.round(h.wind_gusts_10m[i]), wind_from: compass(h.wind_direction_10m[i]), wind_deg: Math.round(h.wind_direction_10m[i]),
        code, cloud_pct: cloud, is_day: isDay, sky: skyOf(code, cloud, isDay) };
      hours.push(Object.assign(pt, gradeHour(pt, sr, ss)));
    }
    // the best stretch: the longest run of green hours, then amber
    let best = null, run = null;
    for (const x of hours) {
      if (x.grade === 'good') { if (!run) run = { from: x.hour, to: x.hour + 1 }; else run.to = x.hour + 1; if (!best || run.to - run.from > best.to - best.from) best = run; }
      else run = null;
    }
    days[date] = { date, sunrise: dd.sunrise[k].slice(11, 16), sunset: dd.sunset[k].slice(11, 16), hours, best };
  }
  return { from, to, days, source: 'Open-Meteo' };
}

// What to wear, from feels-like temperature, wind and rain over the ride.
// The usual road-cyclist thresholds; he can shift them in his head by a layer.
function kit(hours) {
  if (!hours || !hours.length) return null;
  const feels = Math.min(...hours.map(h => h.feels_f)), wind = Math.max(...hours.map(h => h.wind_mph)), rain = Math.max(...hours.map(h => h.rain_pct)), rainIn = Math.max(...hours.map(h => h.rain_in || 0));
  const items = [];
  if (feels >= 68) items.push('short bibs', 'light jersey');
  else if (feels >= 58) items.push('short bibs', 'light jersey', 'arm warmers in the pocket');
  else if (feels >= 50) items.push('short bibs with knee warmers', 'long-sleeve jersey', 'light gloves');
  else if (feels >= 40) items.push('long bibs', 'heavy jersey', 'wind vest', 'full gloves', 'cap under the helmet');
  else if (feels >= 32) items.push('long bibs, thermal', 'heavy jersey', 'jacket', 'winter gloves', 'shoe covers', 'cap or headband');
  else items.push('long bibs, thermal', 'base layer', 'heavy jersey', 'winter jacket', 'lobster gloves', 'shoe covers', 'balaclava');
  if (rain >= 50 || rainIn >= 0.05) items.push('rain jacket', 'cap with a peak');
  else if (rain >= 30) items.push('packable rain jacket in the pocket');
  if (wind >= 15 && feels < 68 && !items.some(x => /jacket|vest/.test(x))) items.push('wind vest');
  if (feels >= 60 && feels < 68) items.push('vest for the first half hour');
  return { feels_low_f: feels, wind_mph: wind, rain_pct: rain, items };
}
function attach(app) {
  app.get('/weather/outlook', async (req, res) => { if (!auth(req, res)) return;
    try {
      const today = tz.todayKey();
      const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : today;
      const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : tz.shiftKey(today, 6);
      res.json(await outlook(from, to));
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/route-weather', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await routeWeather(parseInt(req.query.hour, 10))); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, routeWeather, forecastAt, windKind, outlook, kit, gradeHour, skyOf };
