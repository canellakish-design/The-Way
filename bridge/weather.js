// Route-aware weather (Open-Meteo). Uses today's plan bearings when present.
const { getJSON } = require('./storage');
const { auth } = require('./fuel-log');
const HOME_LAT = process.env.HOME_LAT || 39.0;
const HOME_LON = process.env.HOME_LON || -76.5;
const ROUTE_BEARING = 135;

function windKind(windDeg, heading) {
  const d = Math.abs(((windDeg - heading) + 540) % 360 - 180);
  return d < 45 ? 'tailwind' : d < 135 ? 'crosswind' : 'headwind';
}
async function routeWeather(hour) {
  const p = await getJSON('plan', null);
  const plan = (p && p.for_date === new Date().toDateString()) ? p : null;
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
function attach(app) {
  app.get('/route-weather', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await routeWeather(parseInt(req.query.hour, 10))); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, routeWeather };
