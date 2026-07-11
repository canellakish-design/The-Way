// Route-aware weather via Open-Meteo (no key needed). Tune ROUTE_BEARING
// to your actual GPX average heading for the evening leg.
const HOME_LAT = process.env.HOME_LAT || 39.0;
const HOME_LON = process.env.HOME_LON || -76.5;
const ROUTE_BEARING = 135;
const TOKEN = process.env.FUEL_TOKEN || '';

function relWind(windDeg, speed) {
  let d = Math.abs(((windDeg - ROUTE_BEARING) + 540) % 360 - 180);
  const kind = d < 45 ? 'tailwind' : d < 135 ? 'crosswind' : 'headwind';
  return kind + ' ' + Math.round(speed) + ' mph on the leg home';
}

module.exports = function (app) {
  app.get('/route-weather', async (req, res) => {
    if ((req.query.token || '') !== TOKEN) return res.status(401).json({ error: 'bad token' });
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${HOME_LAT}&longitude=${HOME_LON}` +
        `&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=1&timezone=auto`;
      const r = await fetch(u); const d = await r.json();
      const h = d.hourly, now = new Date().getHours();
      const at = i => ({ t: Math.round(h.temperature_2m[i]), p: h.precipitation_probability[i],
                         w: h.wind_speed_10m[i], dir: h.wind_direction_10m[i] });
      const cur = at(now), evening = at(17);
      const storm = h.precipitation_probability.findIndex((p, i) => i > now && p > 50);
      res.json({ now: { ...cur, ride: relWind(cur.dir, cur.w) },
                 evening: { ...evening, ride: relWind(evening.dir, evening.w) },
                 stormAfterHour: storm });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
};
