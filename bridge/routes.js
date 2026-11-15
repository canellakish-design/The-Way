// ============================================================
// routes.js — the coach's hands on routes (Harry, 15 Nov 2026: "build the coach so we can do routes and intervals
// ICU and could also upload stuff onto Garmin as well, along with the workout player").
//
// His routes live in Ride with GPS, which The Way is already signed in to (flags.js: POST /rwgps/connect keeps a
// token, never the password). Through its API (v1; file upload and route creation were added 30 Jul 2026):
//   list     his route library (kept six hours, so the coach can name routes without waiting)
//   attach   one of them to a planned ride (the ride's route_id; the course, flags and wind follow it)
//   build    a new loop from home for a ride of a given length, drawn on roads a bicycle can use (TomTom routing),
//            or the track of a ride he has already done (Strava), and
//   save     it into his Ride with GPS library as a GPX upload (a background task there, waited on for a few seconds)
// From Ride with GPS a route reaches the Garmin the way his other routes do (its own Garmin sync of pinned routes);
// there is no door to put a course on the Garmin directly. Planned workouts go to the Garmin through intervals.icu
// (workouts.js syncOne), which is what the coach's "garmin" action uses.
//
//   GET  /routes                     { connected, routes:[{ id, name, km, miles, gain_m, gain_ft, url, updated }] }
//   POST /routes/loop                { minutes|km, direction?, type?, name?, save?, date? } → the loop, saved if asked
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const RWGPS = 'https://ridewithgps.com/api/v1';
const LIST_KEY = 'rwgps-routes', LIST_TTL = 6 * 3600e3;
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const SPEED = { road: 24, gravel: 19, mtb: 12 };   // km/h at an easy pace, as suggest.js plans them
const BEARING = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };
const r1 = n => Math.round(n * 10) / 10;

async function creds() {
  // the sign-in the Plan page already uses (plan.js: RWGPS_AUTH_TOKEN in Netlify); a token kept by POST /rwgps/connect
  // (flags.js) serves when that one is not set
  const key = envStr('RWGPS_API_KEY'); let token = envStr('RWGPS_AUTH_TOKEN');
  if (!token) { const r = await getJSON('rwgps', { token: null }).catch(() => ({ token: null })); token = (r && r.token) || ''; }
  if (!key) { const e = new Error('Ride with GPS is not set up in Netlify (RWGPS_API_KEY).'); e.status = 400; throw e; }
  if (!token) { const e = new Error('Ride with GPS is not connected: connect it in Settings first.'); e.status = 400; throw e; }
  return { 'x-rwgps-api-key': key, 'x-rwgps-auth-token': token, Accept: 'application/json' };
}
const shapeRoute = r => ({ id: String(r.id), name: String(r.name || 'Route').trim(), km: r.distance ? r1(r.distance / 1000) : null, miles: r.distance ? r1(r.distance / 1609.34) : null,
  gain_m: r.elevation_gain != null ? Math.round(r.elevation_gain) : null, gain_ft: r.elevation_gain != null ? Math.round(r.elevation_gain * 3.281) : null,
  where: [r.locality, r.administrative_area].filter(Boolean).join(', ') || null, url: r.html_url || `https://ridewithgps.com/routes/${r.id}`, updated: r.updated_at || null });

// His library, from the kept copy when it is under six hours old (fresh: read it now).
async function list(fresh) {
  const kept = await getJSON(LIST_KEY, null).catch(() => null);
  if (kept && kept.routes && !fresh && Date.now() - (kept.at || 0) < LIST_TTL) return kept;
  let h; try { h = await creds(); } catch (e) { return { connected: false, reason: e.message, routes: [], at: Date.now() }; }
  try {
    const res = await fetch(`${RWGPS}/routes.json?page_size=200`, { headers: h, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error('Ride with GPS answered ' + res.status);
    const j = await res.json(), raw = Array.isArray(j) ? j : (j.routes || j.results || []);
    const out = { connected: true, at: Date.now(), routes: raw.filter(r => !r.archived).map(shapeRoute).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))) };
    await setJSON(LIST_KEY, out).catch(() => {});
    return out;
  } catch (e) { if (kept && kept.routes) return Object.assign({}, kept, { stale: e.message }); return { connected: true, reason: e.message, routes: [], at: Date.now() }; }
}

// The route his words point at: every word of his in its name beats most words; nothing in common is no match (pure).
const wordsOf = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !/^(the|route|loop|ride|my|on|to|of|and|at|in|a)$/.test(w));
function match(routes, said) {
  const ws = wordsOf(said); if (!ws.length) return null;
  let best = null;
  for (const r of routes || []) { const name = ' ' + wordsOf(r.name).join(' ') + ' ', hits = ws.filter(w => name.includes(' ' + w)).length; if (!hits) continue;
    const score = hits / ws.length + (hits === ws.length ? 1 : 0) - Math.abs(wordsOf(r.name).length - ws.length) * 0.01;
    if (!best || score > best.score) best = { r, score, hits }; }
  return best && best.hits / ws.length >= 0.5 ? best.r : null;
}

// ---- a GPX file from points [[lat, lon], …] (pure) ----
function gpx(points, name) {
  const esc = x => String(x || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="The Way" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name><trkseg>`
    + (points || []).map(p => `<trkpt lat="${Number(p[0]).toFixed(5)}" lon="${Number(p[1]).toFixed(5)}"></trkpt>`).join('') + '</trkseg></trk></gpx>';
}
// two corners of a triangle whose sides, on the map, add up to the perimeter: out along the bearing, across, and home (pure)
function corners(start, perimeterKm, bearingDeg) {
  const side = perimeterKm / 3, ky = 110.57, kx = 111.32 * Math.cos(start.lat * Math.PI / 180), rad = d => d * Math.PI / 180;
  const at = deg => ({ lat: start.lat + Math.cos(rad(deg)) * side / ky, lon: start.lon + Math.sin(rad(deg)) * side / kx });
  return [at(bearingDeg - 30), at(bearingDeg + 30)];
}

// A loop from a start point for a ride of about `km`, on roads a bicycle may use. Roads wind, so the triangle is
// drawn smaller than the ride and tried again once if the road distance comes out more than 12% off.
async function loop(o) {
  const k = envStr('TOMTOM_API_KEY');
  if (!k) { const e = new Error('The map service is not set up (TOMTOM_API_KEY), so a loop cannot be drawn.'); e.status = 400; throw e; }
  const type = SPEED[o.type] ? o.type : 'road', want = o.km > 0 ? o.km : Math.round(SPEED[type] * (o.minutes || 60) / 60);
  if (!(want >= 5 && want <= 250)) { const e = new Error('A loop needs a length between 5 and 250 km.'); e.status = 400; throw e; }
  const start = o.start, tries = BEARING[String(o.direction || '').toLowerCase().replace(/[\s-]/g, '')] != null ? [BEARING[String(o.direction).toLowerCase().replace(/[\s-]/g, '')]] : [315, 270, 0, 225, 180];
  let best = null;
  for (const bearing of tries) {
    let factor = 1.3;
    for (let pass = 0; pass < 2; pass++) {
      const [B, C] = corners(start, want / factor, bearing);
      const pts = [start, B, C, start].map(x => `${x.lat.toFixed(5)},${x.lon.toFixed(5)}`).join(':');
      let j; try { const r = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${pts}/json?key=${encodeURIComponent(k)}&travelMode=bicycle&routeType=thrilling&hilliness=normal&windingness=normal`, { signal: AbortSignal.timeout(9000) });
        if (!r.ok) break; j = await r.json(); } catch (e) { break; }
      const rt = j.routes && j.routes[0]; if (!rt) break;
      const km = rt.summary.lengthInMeters / 1000, off = Math.abs(km - want) / want, all = rt.legs.flatMap(l => l.points || []), step = Math.max(1, Math.ceil(all.length / 2500));
      const cand = { km: r1(km), miles: r1(km / 1.60934), off, bearing, points: all.filter((_, i) => i % step === 0).map(x => [Math.round(x.latitude * 1e5) / 1e5, Math.round(x.longitude * 1e5) / 1e5]),
        maps: `https://www.google.com/maps/dir/?api=1&travelmode=bicycling&origin=${start.lat},${start.lon}&destination=${start.lat},${start.lon}&waypoints=${B.lat.toFixed(5)},${B.lon.toFixed(5)}|${C.lat.toFixed(5)},${C.lon.toFixed(5)}` };
      if (!best || cand.off < best.off) best = cand;
      if (off <= 0.12) break;
      factor = factor * km / want;   // the roads were this much longer than the lines: draw the triangle that much smaller
    }
    if (best && best.off <= 0.12) break;
  }
  if (!best) { const e = new Error('No rideable loop could be drawn from there.'); e.status = 502; throw e; }
  return Object.assign(best, { want_km: want, type, minutes: Math.round(best.km / SPEED[type] * 60), direction: Object.keys(BEARING).find(n => BEARING[n] === best.bearing) || null });
}

// Into his Ride with GPS library: the file is taken at once and built in the background there; waited on for up to
// `waitMs`, then the route's page (or, still building, word that it will appear in his library).
async function save(gpxText, name, description, waitMs) {
  const h = await creds(); delete h.Accept;
  const form = new FormData();
  form.append('file', new Blob([gpxText], { type: 'application/gpx+xml' }), String(name || 'route').replace(/[^\w -]/g, '').slice(0, 60) + '.gpx');
  if (name) form.append('name', String(name).slice(0, 120));
  if (description) form.append('description', String(description).slice(0, 2000));
  const res = await fetch(`${RWGPS}/routes.json`, { method: 'POST', headers: h, body: form, signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error('Ride with GPS did not take the route (' + res.status + (j && j.error ? ': ' + String(j.error).slice(0, 120) : '') + ').'); e.status = 502; throw e; }
  // (the copy of The Way never writes outside itself: the upload is held back there and answers with a stand-in)
  if (j && j.sandbox) return { saved: false, sandbox: true, note: 'On the copy nothing is sent to Ride with GPS.' };
  let task = j.task || j, until = Date.now() + (waitMs == null ? 9000 : waitMs);
  while (task && task.status !== 'completed' && task.url && Date.now() < until) {
    await new Promise(r => setTimeout(r, 1300));
    try { const t = await fetch(task.url, { headers: Object.assign({ Accept: 'application/json' }, h), signal: AbortSignal.timeout(8000) }); if (t.ok) { const tj = await t.json(); task = tj.task || tj; } } catch (e) { /* ask again */ }
  }
  await setJSON(LIST_KEY, null).catch(() => {});   // the library has a new route: read it fresh next time
  const item = ((task && task.items) || []).find(x => x.item_type === 'route'), err = ((task && task.errors) || [])[0];
  if (err && !item) { const e = new Error('Ride with GPS could not build the route: ' + String(err.message || err.code).slice(0, 140)); e.status = 502; throw e; }
  if (item) return { saved: true, route_id: String(item.item_id), url: `https://ridewithgps.com/routes/${item.item_id}` };
  return { saved: true, pending: true, note: 'Ride with GPS is still building it; it will be in your library in a minute.' };
}

// Taking a route out of his library. Only a route The Way made as a test ("THE WAY TEST …") can be removed here:
// his own routes are his to delete, in Ride with GPS.
async function removeTest(id) {
  const L = await list(true), r = (L.routes || []).find(x => x.id === String(id));
  if (!r) { const e = new Error('No such route in the library.'); e.status = 404; throw e; }
  if (!/^THE WAY TEST\b/i.test(r.name)) { const e = new Error('Only a test route made by The Way can be removed here.'); e.status = 403; throw e; }
  const res = await fetch(`${RWGPS}/routes/${encodeURIComponent(r.id)}.json`, { method: 'DELETE', headers: await creds(), signal: AbortSignal.timeout(12000) });
  if (!res.ok && res.status !== 404) { const e = new Error('Ride with GPS did not remove it (' + res.status + ').'); e.status = 502; throw e; }
  await setJSON(LIST_KEY, null).catch(() => {});
  return { removed: true, id: r.id, name: r.name };
}

// The track of a ride he did on a day (the longest outdoor one), as points.
async function rideTrack(date) {
  const W = require('./workout-math'), st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const done = await require('./workouts').stravaDone(date, date, st);
  const ride = (done.rides || []).filter(r => r.date === date && !/virtual/i.test(r.type || '')).sort((a, b) => (b.minutes || 0) - (a.minutes || 0))[0];
  if (!ride) { const e = new Error(`No outdoor ride on ${tz.dayShort(date)} to make a route from.`); e.status = 404; throw e; }
  const s = await require('./strava').apiFetch(`/activities/${ride.id}/streams?keys=latlng&key_by_type=true`);
  const ll = (s && s.latlng && s.latlng.data) || [];
  if (ll.length < 20) { const e = new Error('That ride has no track to make a route from.'); e.status = 404; throw e; }
  const step = Math.max(1, Math.ceil(ll.length / 2500));
  return { ride, points: ll.filter((_, i) => i % step === 0).map(p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5]) };
}
async function home() {
  const s = await require('./commute').settings();
  if (s && s.home && Number.isFinite(+s.home.lat) && Number.isFinite(+s.home.lon)) return { lat: +s.home.lat, lon: +s.home.lon };
  const e = new Error('Home is not set (Settings, the drive to school), so a loop has nowhere to start.'); e.status = 400; throw e;
}

// For the coach: what is in his library, in a line.
function libraryText(L) {
  if (!L || !L.connected) return 'ROUTES: Ride with GPS is not connected, so you cannot list, attach or save routes; say so if he asks.';
  if (!L.routes.length) return 'ROUTES: his Ride with GPS library is empty. You can build a loop from home and save it there (a new_route action).';
  return `HIS ROUTES in Ride with GPS (${L.routes.length}; newest first): ` + L.routes.slice(0, 40).map(r => `${r.name}${r.miles != null ? ` (${r.miles} mi${r.gain_ft != null ? ', ' + r.gain_ft + ' ft' : ''})` : ''}`).join('; ') + '.';
}

function attach(app) {
  const wrap = fn => async (req, res) => { if (!auth(req, res)) return; try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/routes', wrap(req => list((req.query || {}).fresh === '1')));
  app.delete('/routes/:id', wrap(req => removeTest(req.params.id)));
  app.post('/routes/loop', wrap(async req => { const b = req.body || {};
    const L = await loop({ start: await home(), minutes: Number(b.minutes) || 0, km: Number(b.km) || 0, direction: b.direction, type: b.type });
    const name = String(b.name || `Loop from home, ${L.miles} mi`).slice(0, 120);
    const saved = b.save ? await save(gpx(L.points, name), name, `Drawn by The Way for a ${L.minutes} minute ${L.type} ride.`) : null;
    return { name, km: L.km, miles: L.miles, minutes: L.minutes, direction: L.direction, maps: L.maps, points: L.points.length, saved }; }));
}

module.exports = { attach, list, match, gpx, corners, loop, save, rideTrack, home, libraryText, wordsOf, BEARING, SPEED };
