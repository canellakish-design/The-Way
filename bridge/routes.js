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
//   GET  /routes/near?lat=&lon=      his routes that pass near that point, best first, each with where to join it
//   POST /routes/here                { lat, lon, name?, save? } → that route begun at the point nearest him
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
const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
const shapeRoute = r => ({ id: String(r.id), name: String(r.name || 'Route').trim(), km: r.distance ? r1(r.distance / 1000) : null, miles: r.distance ? r1(r.distance / 1609.34) : null,
  gain_m: r.elevation_gain != null ? Math.round(r.elevation_gain) : null, gain_ft: r.elevation_gain != null ? Math.round(r.elevation_gain * 3.281) : null,
  where: [r.locality, r.administrative_area].filter(Boolean).join(', ') || null, url: r.html_url || `https://ridewithgps.com/routes/${r.id}`, updated: r.updated_at || null,
  // where it lies on the map (for "which of my routes pass near me"): its corners, where it starts, and its kind
  box: num(r.sw_lat) != null && num(r.ne_lat) != null && num(r.sw_lng) != null && num(r.ne_lng) != null ? [num(r.sw_lat), num(r.sw_lng), num(r.ne_lat), num(r.ne_lng)] : null,
  first: num(r.first_lat) != null && num(r.first_lng) != null ? [num(r.first_lat), num(r.first_lng)] : null,
  kind: r.track_type || null, surface: r.surface || null, unpaved_pct: num(r.unpaved_pct) });

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

// ============================================================
// From where he stands (Harry, 15 Nov 2026: "I want the coach to know where I am and to tell me where to go to
// start a route … the best route in the area … the starting point of the route needs to be able to change, so it's
// the closest to my current location"; "it just needs to be on the route, the closest part on the route").
//   near(coords)       which of his routes pass close to him, each with the point on it nearest him: how far, which
//                      way, and the street it is on. Best first: a short way to the route, a length that fits the time.
//   startHere(coords)  one of them begun at that nearest point: a loop is turned so it starts and ends there, ridden
//                      the same way round; a one-way route is ridden from there to its end. Saved to his library
//                      when asked, as "<name> (from <street>)".
// ============================================================
const KY = 110.57, kxAt = lat => 111.32 * Math.cos(lat * Math.PI / 180);
const distKm = (a, b) => Math.hypot((a[0] - b[0]) * KY, (a[1] - b[1]) * kxAt((a[0] + b[0]) / 2));
const lengthKm = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += distKm(pts[i - 1], pts[i]); return s; };
// how far a point is from a route's corners box: 0 inside it (pure)
function boxKm(box, here) {
  if (!box) return Infinity;
  const lat = Math.min(Math.max(here[0], box[0]), box[2]), lon = Math.min(Math.max(here[1], box[1]), box[3]);
  return distKm(here, [lat, lon]);
}
// the point of a track nearest to him, on the line between its points and not only at them (pure)
function nearest(points, here) {
  if (!points || !points.length) return null;
  const kx = kxAt(here[0]), X = p => (p[1] - here[1]) * kx, Y = p => (p[0] - here[0]) * KY;
  let best = { i: 0, km: Math.hypot(X(points[0]), Y(points[0])), at: points[0], t: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const ax = X(points[i]), ay = Y(points[i]), bx = X(points[i + 1]), by = Y(points[i + 1]), dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0, km = Math.hypot(ax + t * dx, ay + t * dy);
    if (km < best.km) best = { i, km, t, at: [points[i][0] + t * (points[i + 1][0] - points[i][0]), points[i][1] + t * (points[i + 1][1] - points[i][1])] };
  }
  return best;
}
const isLoop = pts => pts.length > 3 && distKm(pts[0], pts[pts.length - 1]) <= 0.4;
// The same route begun at that point (pure). A loop: from there round to there again, the same way round.
// A one-way route: from there to its end.
function restart(points, n) {
  const at = [Math.round(n.at[0] * 1e5) / 1e5, Math.round(n.at[1] * 1e5) / 1e5], after = points.slice(n.i + 1), same = (a, b) => a[0] === b[0] && a[1] === b[1];
  let out = isLoop(points) ? [at].concat(after, points.slice(same(points[0], points[points.length - 1]) ? 1 : 0, n.i + 1), [at]) : [at].concat(after);
  out = out.filter((p, i) => !i || !same(p, out[i - 1]));
  return out;
}
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const compass = (from, to) => COMPASS[Math.round(((Math.atan2((to[1] - from[1]) * kxAt(from[0]), (to[0] - from[0]) * KY) * 180 / Math.PI + 360) % 360) / 45) % 8];

// A route's track, kept (a route's line does not change until it is edited: kept against its "updated").
const TRACK_KEY = id => 'rwgps-track-' + id, SHAPES_KEY = 'rwgps-shapes', COARSE = 80;
async function trackOf(r) {
  const kept = await getJSON(TRACK_KEY(r.id), null).catch(() => null);
  if (kept && kept.points && kept.updated === (r.updated || null)) return kept.points;
  const res = await fetch(`${RWGPS}/routes/${encodeURIComponent(r.id)}.json`, { headers: await creds(), signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error('Ride with GPS answered ' + res.status + ' for ' + r.name);
  const j = await res.json(), raw = ((j.route || j).track_points || []).filter(p => p && p.y != null && p.x != null), step = Math.max(1, Math.ceil(raw.length / 2500));
  const points = raw.filter((_, i) => i % step === 0 || i === raw.length - 1).map(p => [Math.round(p.y * 1e5) / 1e5, Math.round(p.x * 1e5) / 1e5]);
  if (points.length < 2) throw new Error(r.name + ' has no line to follow.');
  await setJSON(TRACK_KEY(r.id), { updated: r.updated || null, points, at: Date.now() }).catch(() => {});
  return points;
}
const coarse = pts => { const step = Math.max(1, Math.ceil(pts.length / COARSE)); return pts.filter((_, i) => i % step === 0 || i === pts.length - 1); };
// The outline of every route (80 points each, in one place), so "which pass near me" is answered without reading
// 120 tracks. Built a few at a time: here for the routes around him, and by the five-minute job for the rest.
async function shapesFor(routes, budgetMs, most) {
  const S = await getJSON(SHAPES_KEY, { shapes: {} }).catch(() => ({ shapes: {} })), shapes = (S && S.shapes) || {};
  const need = routes.filter(r => !(shapes[r.id] && shapes[r.id].u === (r.updated || null))).slice(0, most == null ? 12 : most);
  if (need.length) {
    const got = await Promise.race([Promise.all(need.map(r => trackOf(r).then(p => ({ r, p })).catch(() => null))), new Promise(res => setTimeout(() => res(null), budgetMs || 8000))]);
    let changed = false;
    for (const g of got || []) if (g) { shapes[g.r.id] = { u: g.r.updated || null, p: coarse(g.p), loop: isLoop(g.p) }; changed = true; }
    if (changed) await setJSON(SHAPES_KEY, { shapes, at: Date.now() }).catch(() => {});
  }
  return shapes;
}
// the five-minute job: outlines for routes that have none yet, three at a time; nothing to do once all are kept
async function tick() {
  const L = await getJSON(LIST_KEY, null).catch(() => null);
  if (!L || !L.connected || !(L.routes || []).length || require('./sandbox').SANDBOX) return { skipped: true };
  const S = await getJSON(SHAPES_KEY, { shapes: {} }).catch(() => ({ shapes: {} })), have = (S && S.shapes) || {};
  const need = L.routes.filter(r => !(have[r.id] && have[r.id].u === (r.updated || null)));
  if (!need.length) return { done: true, shapes: Object.keys(have).length };
  await shapesFor(need, 6000, 3);
  return { built: Math.min(3, need.length), left: Math.max(0, need.length - 3) };
}

// the street a point is on, in a few words ("Clopper Rd, Germantown"); null when the map service does not say
async function placeOf(p) {
  const k = envStr('TOMTOM_API_KEY'); if (!k) return null;
  try {
    const r = await fetch(`https://api.tomtom.com/search/2/reverseGeocode/${p[0].toFixed(5)},${p[1].toFixed(5)}.json?key=${encodeURIComponent(k)}&radius=200`, { signal: AbortSignal.timeout(3500) });
    if (!r.ok) return null;
    const a = ((await r.json()).addresses || [])[0], ad = a && a.address; if (!ad) return null;
    const street = ad.streetName || ad.street || '', town = ad.municipality || ad.municipalitySubdivision || '';
    return { street: street || null, town: town || null, text: [street, town].filter(Boolean).join(', ') || ad.freeformAddress || null };
  } catch (e) { return null; }
}
const mapsTo = p => `https://www.google.com/maps/dir/?api=1&destination=${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const REACH_KM = 16;   // a route passing more than ten miles away is not "in the area"

// Best first (pure): the way to the route counts most, then how far its length is from the time he has.
function rank(rows, wantKm) {
  const score = x => x.join_km + (wantKm > 0 && x.km ? Math.abs(x.km - wantKm) / wantKm * 8 : 0);
  return rows.slice().sort((a, b) => score(a) - score(b));
}

async function near(coords, o) {
  o = o || {};
  if (!coords || !(Math.abs(Number(coords.lat)) <= 90) || !(Math.abs(Number(coords.lon)) <= 180)) { const e = new Error('No location came with that, so the routes near you cannot be worked out. Allow location for the site.'); e.status = 400; throw e; }
  const here = [Number(coords.lat), Number(coords.lon)], reach = o.reach_km > 0 ? o.reach_km : REACH_KM;
  let L = await list();
  if (L.connected && L.routes.length && L.routes[0].box === undefined) L = await list(true);   // a copy kept before the corners were read
  if (!L.connected) { const e = new Error(L.reason || 'Ride with GPS is not connected.'); e.status = 400; throw e; }
  const type = SPEED[o.type] ? o.type : 'road', wantKm = o.km > 0 ? o.km : o.minutes > 0 ? SPEED[type] * o.minutes / 60 : 0;
  // the routes whose corners reach him, the ones starting nearest first (their outlines are read first)
  const around = L.routes.filter(r => r.box && boxKm(r.box, here) <= reach).sort((a, b) => (a.first ? distKm(here, a.first) : 1e3) - (b.first ? distKm(here, b.first) : 1e3));
  const shapes = await shapesFor(around, o.budget_ms || 8000);
  const rough = around.map(r => { const s = shapes[r.id]; if (!s) return null; const n = nearest(s.p, here); return n && n.km <= reach + 1 ? Object.assign({ r, join_km: n.km }, { km: r.km }) : null; }).filter(Boolean);
  // the exact point for the best few (the outline is good to a few hundred metres)
  const top = rank(rough, wantKm).slice(0, 5), rows = [];
  await Promise.all(top.map(async x => { try {
    const pts = await trackOf(x.r), n = nearest(pts, here); if (!n || n.km > reach) return;
    const loop = isLoop(pts), left = loop ? x.r.km : r1(lengthKm(restart(pts, n)));
    rows.push({ id: x.r.id, name: x.r.name, km: left, miles: left != null ? r1(left / 1.60934) : null, gain_ft: x.r.gain_ft, minutes: left ? Math.round(left / SPEED[type] * 60) : null,
      loop, kind: x.r.kind || (loop ? 'loop' : 'one way'), surface: x.r.surface, unpaved_pct: x.r.unpaved_pct, url: x.r.url,
      join_km: r1(n.km), join_miles: r1(n.km / 1.60934), direction: n.km < 0.15 ? null : compass(here, n.at), start: [Math.round(n.at[0] * 1e5) / 1e5, Math.round(n.at[1] * 1e5) / 1e5], maps: mapsTo(n.at) });
  } catch (e) { /* that one could not be read */ } }));
  const out = rank(rows, wantKm);
  await Promise.all(out.slice(0, 3).map(async x => { const p = await placeOf(x.start); x.place = p ? p.text : null; x.street = p ? p.street : null; }));
  return { here: { lat: here[0], lon: here[1] }, reach_miles: r1(reach / 1.60934), looked_at: around.length, unread: around.filter(r => !shapes[r.id]).length, routes: out };
}

// One route begun at the point on it nearest him; saved to his library when asked.
async function startHere(coords, o) {
  o = o || {};
  const N = await near(coords, o), L = await list();
  let row = null;
  if (o.id) row = N.routes.find(x => x.id === String(o.id));
  if (!row && o.name) { const m = match(L.routes, o.name); row = m ? N.routes.find(x => x.id === m.id) : null;
    if (!row && m) {   // a route of his that is not among the nearest five: still his to start from the closest point on it
      const pts = await trackOf(m), n = nearest(pts, [N.here.lat, N.here.lon]), loop = isLoop(pts), left = loop ? m.km : r1(lengthKm(restart(pts, n))), p = await placeOf(n.at);
      row = { id: m.id, name: m.name, km: left, miles: left != null ? r1(left / 1.60934) : null, gain_ft: m.gain_ft, minutes: left ? Math.round(left / SPEED.road * 60) : null, loop, url: m.url,
        join_km: r1(n.km), join_miles: r1(n.km / 1.60934), direction: n.km < 0.15 ? null : compass([N.here.lat, N.here.lon], n.at), start: [Math.round(n.at[0] * 1e5) / 1e5, Math.round(n.at[1] * 1e5) / 1e5], maps: mapsTo(n.at), place: p ? p.text : null, street: p ? p.street : null }; } }
  if (!row && !o.name && !o.id) row = N.routes[0];
  if (!row) { const e = new Error(o.name ? `No route like "${String(o.name).slice(0, 40)}" in your Ride with GPS library.` : `None of your routes passes within ${N.reach_miles} miles of where you are.`); e.status = 404; throw e; }
  if (!row.place && row.place !== null) { const p = await placeOf(row.start); row.place = p ? p.text : null; row.street = p ? p.street : null; }
  const out = Object.assign({}, row, { new_name: `${row.name} (from ${row.street || row.place || 'here'})`.slice(0, 120), saved: null });
  if (o.save) {
    const have = L.routes.find(r => r.name === out.new_name);   // asked twice from the same spot: the copy already made
    if (have) out.saved = { saved: true, route_id: have.id, url: have.url, already: true };
    else { const track = await trackOf(L.routes.find(x => x.id === row.id)), pts = restart(track, nearest(track, [N.here.lat, N.here.lon]));
      out.saved = await save(gpx(pts, out.new_name), out.new_name, `"${row.name}" begun at ${row.place || 'the point nearest you'}: ${row.loop ? 'the same loop, the same way round, starting and ending there' : 'from there to its end'}. Made by The Way on ${tz.dayShort(tz.todayKey())}. Look it over before riding it.`, o.wait_ms); }
  }
  return out;
}
// in words, for the coach and for the page
function hereText(x) {
  const way = x.join_miles < 0.1 ? 'you are on it now' : `${x.join_miles} mi ${x.direction || ''} of you`.replace(/\s+/g, ' ');
  return `${x.name}: ${x.miles} mi${x.gain_ft != null ? ', ' + x.gain_ft + ' ft' : ''}${x.minutes ? ', about ' + x.minutes + ' min' : ''}${x.loop ? '' : ' (one way from there)'}; start on ${x.place || 'the route'}, ${way}`;
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
  // which of his routes pass near a point, each with the point on it nearest him (reads only)
  app.get('/routes/near', wrap(req => { const q = req.query || {}; return near({ lat: Number(q.lat), lon: Number(q.lon) }, { minutes: Number(q.minutes) || 0, type: q.type }); }));
  // one of them begun at that point; save: true puts the re-started route in his library
  app.post('/routes/here', wrap(req => { const b = req.body || {}; return startHere({ lat: Number(b.lat), lon: Number(b.lon) }, { name: b.name, id: b.id, minutes: Number(b.minutes) || 0, type: b.type, save: b.save === true }); }));
  app.post('/routes/loop', wrap(async req => { const b = req.body || {};
    const L = await loop({ start: await home(), minutes: Number(b.minutes) || 0, km: Number(b.km) || 0, direction: b.direction, type: b.type });
    const name = String(b.name || `Loop from home, ${L.miles} mi`).slice(0, 120);
    const saved = b.save ? await save(gpx(L.points, name), name, `Drawn by The Way for a ${L.minutes} minute ${L.type} ride.`) : null;
    return { name, km: L.km, miles: L.miles, minutes: L.minutes, direction: L.direction, maps: L.maps, points: L.points.length, saved }; }));
}

module.exports = { attach, list, match, gpx, corners, loop, save, rideTrack, home, libraryText, wordsOf, BEARING, SPEED,
  near, startHere, hereText, tick, nearest, restart, isLoop, boxKm, rank, distKm, lengthKm, compass };
