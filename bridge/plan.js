// Ride Plan v2: name + start time + optional Ride with GPS route.
// With RWGPS creds set, the bridge pulls the route's track points and
// computes real bearings (out-leg / back-leg), distance, and climbing —
// so the morning wind call is your road's geometry, not a constant.
// Env: RWGPS_API_KEY, RWGPS_AUTH_TOKEN (account settings -> Developers)
const fs = require('fs'); const path = require('path');
const STORE = path.join(__dirname, 'plan.json');
const TOKEN = process.env.FUEL_TOKEN || '';
const RW_KEY = process.env.RWGPS_API_KEY || '';
const RW_TOK = process.env.RWGPS_AUTH_TOKEN || '';

function bearing(a, b) { // points {y:lat, x:lon} -> degrees 0..360
  const toR = d => d * Math.PI / 180;
  const dL = toR(b.x - a.x);
  const y = Math.sin(dL) * Math.cos(toR(b.y));
  const x = Math.cos(toR(a.y)) * Math.sin(toR(b.y)) -
            Math.sin(toR(a.y)) * Math.cos(toR(b.y)) * Math.cos(dL);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

async function fetchRoute(idOrUrl) {
  const m = String(idOrUrl).match(/(\d+)/g);
  if (!m) throw new Error('no route id found');
  const id = m[m.length - 1];
  const auth = Buffer.from(RW_KEY + ':' + RW_TOK).toString('base64');
  const r = await fetch(`https://ridewithgps.com/api/v1/routes/${id}.json`, {
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' } });
  if (!r.ok) throw new Error('RWGPS ' + r.status);
  const d = await r.json();
  const route = d.route || d;
  const pts = (route.track_points || []).filter(p => p.x != null && p.y != null);
  if (pts.length < 2) throw new Error('route has no track points');
  const mid = pts[Math.floor(pts.length / 2)];
  return {
    name: route.name || null,
    miles: route.distance ? Math.round(route.distance / 1609.34 * 10) / 10 : null,
    climb_ft: route.elevation_gain ? Math.round(route.elevation_gain * 3.28084) : null,
    bearing_out: Math.round(bearing(pts[0], mid)),
    bearing_back: Math.round(bearing(mid, pts[pts.length - 1])),
    start_lat: pts[0].y, start_lon: pts[0].x,
    rwgps_id: id
  };
}

module.exports = function (app) {
  app.post('/plan', async (req, res) => {
    if ((req.query.token || '') !== TOKEN) return res.status(401).json({ error: 'bad token' });
    const d = new Date(); d.setDate(d.getDate() + 1);
    const plan = {
      ride: String(req.body.ride || 'Ride').slice(0, 120),
      start: /^\d{1,2}:\d{2}$/.test(req.body.start || '') ? req.body.start : '06:00',
      for_date: d.toDateString(), route: null, route_error: null
    };
    if (req.body.rwgps) {
      if (!RW_KEY || !RW_TOK) plan.route_error = 'RWGPS keys not set on bridge';
      else {
        try {
          plan.route = await fetchRoute(req.body.rwgps);
          if (!req.body.ride && plan.route.name) plan.ride = plan.route.name;
        } catch (e) { plan.route_error = e.message; } // never block the plan
      }
    }
    fs.writeFileSync(STORE, JSON.stringify(plan, null, 2));
    res.json({ ok: true, ...plan });
  });
  app.get('/plan', (req, res) => {
    if ((req.query.token || '') !== TOKEN) return res.status(401).json({ error: 'bad token' });
    try {
      const p = JSON.parse(fs.readFileSync(STORE, 'utf8'));
      res.json({ ...p, for_today: p.for_date === new Date().toDateString() });
    } catch { res.json({ ride: null, for_today: false }); }
  });
};
