// Route-aware weather (Open-Meteo). Uses today's plan bearings when present.
const { getJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const HOME_LAT = process.env.HOME_LAT || 39.0;
const HOME_LON = process.env.HOME_LON || -76.5;
const ROUTE_BEARING = 135;

function windKind(windDeg, heading) {
  const d = Math.abs(((windDeg - heading) + 540) % 360 - 180);
  return d < 45 ? 'tailwind' : d < 135 ? 'crosswind' : 'headwind';
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
function attach(app) {
  app.get('/route-weather', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await routeWeather(parseInt(req.query.hour, 10))); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, routeWeather, forecastAt, windKind };
