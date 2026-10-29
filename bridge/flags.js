// ============================================================
// flags.js — the flag game: iconic spots on his routes, caught by riding
// past them. The arithmetic is in flags-math.js; this is the plumbing.
//
// Routes come from RideWithGPS (his library, the routes he pushes to the
// Edge 1050) once it is connected, and from Strava's ride history
// otherwise: rides with the same name are one route. Zwift rides are
// routes too, in their world. Flags are named from OpenStreetMap's named
// features beside the road (Overpass, no key). Catches are read from the
// Strava GPS track of every ride after it lands.
//
//   GET  /flags                 the collection, level, routes, today's hunt
//   GET  /flags/today           the front-page box: caught / hunt
//   POST /flags/build           one step of the build (call until done)
//   POST /flags/scan            read recent rides for catches
//   POST /flags/rename {id,name} · POST /flags/hide {id, hidden}
//   GET  /flags/course/:route.tcx   Garmin course with the flags as course points
//   POST /rwgps/connect {email,password}  → an auth token (the password is sent once, never kept)
//   GET  /rwgps/status · POST /rwgps/disconnect
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const G = require('./flags-math');

const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const RWGPS = 'https://ridewithgps.com/api/v1';
const OVERPASS = envStr('OVERPASS_URL') || 'https://overpass-api.de/api/interpreter';
const HISTORY_DAYS = 120, TRACKS_PER_STEP = 8, ROUTES_PER_STEP = 6, NAMES_PER_STEP = 3, SCAN_PER_CALL = 3;
const trackKey = id => 'track-' + String(id).replace(/\D/g, '');
const routeKey = id => 'route-' + String(id).replace(/[^\w-]/g, '');

async function state() {
  return getJSON('flags', { flags: [], routes: [], tracks: [], catches: [], scanned: [], xp: 0, built_at: null, names: {}, speed_kmh: null, hunt_bonus_days: [] });
}
const save = s => setJSON('flags', s);

// ---- RideWithGPS ----
async function rwgps() { return getJSON('rwgps', { token: null, user: null }); }
async function rwgpsGet(pathname) {
  const key = envStr('RWGPS_API_KEY'); const r = await rwgps();
  if (!key) throw new Error('RWGPS_API_KEY is not set in Netlify');
  if (!r.token) throw new Error('RideWithGPS is not connected');
  const res = await fetch(RWGPS + pathname, { headers: { 'x-rwgps-api-key': key, 'x-rwgps-auth-token': r.token, Accept: 'application/json' } });
  if (!res.ok) throw new Error('ridewithgps ' + res.status + ' on ' + pathname.split('?')[0]);
  return res.json();
}
async function rwgpsRoutes() {
  const j = await rwgpsGet('/routes.json?page_size=200');
  const list = Array.isArray(j) ? j : (j.results || j.routes || []);
  return list.filter(r => !r.archived).map(r => ({ id: 'rwgps-' + r.id, rwgps_id: r.id, name: r.name || 'Route', km: r.distance ? Math.round(r.distance / 100) / 10 : null, gain_m: r.elevation_gain ? Math.round(r.elevation_gain) : null, updated: r.updated_at || null }));
}
async function rwgpsRoutePoints(rwgpsId) {
  const j = await rwgpsGet(`/routes/${rwgpsId}.json`);
  const r = j.route || j;
  const pts = (r.track_points || []).map(p => ({ lat: p.y, lng: p.x, ele: p.e != null ? p.e : null })).filter(p => p.lat != null && p.lng != null);
  return { points: G.downsample(pts, 25), pois: (r.points_of_interest || []).filter(p => p.name && p.lat != null).map(p => ({ name: p.name, kind: 'landmark', rank: 8, lat: p.lat, lng: p.lng })) };
}

// ---- Strava tracks ----
async function track(ride) {
  const c = await getJSON(trackKey(ride.id), null);
  if (c) return c;
  const s = await require('./strava').apiFetch(`/activities/${ride.id}/streams?keys=latlng,time,altitude&key_by_type=true`);
  const ll = s && s.latlng && s.latlng.data, t = s && s.time && s.time.data, alt = s && s.altitude && s.altitude.data;
  const pts = (ll || []).map((p, i) => ({ lat: p[0], lng: p[1], t: t ? t[i] : null, ele: alt ? alt[i] : null })).filter(p => p.lat != null);
  const out = { id: ride.id, date: ride.date, name: ride.name, virtual: /virtual/i.test(ride.type || ''), minutes: ride.minutes, miles: ride.miles,
    points: G.downsample(pts, 30), at: Date.now() };
  await setJSON(trackKey(ride.id), out).catch(() => {});
  return out;
}
async function rides(from, to) {
  const W = require('./workout-math');
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const done = await require('./workouts').stravaDone(from, to, st);
  return (done.rides || []).filter(r => /ride|cycl/i.test(r.type || 'Ride') && r.minutes >= 15);
}

// ---- naming from OpenStreetMap ----
const MIRRORS = [OVERPASS, 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
async function namesFor(route) {
  const body = 'data=' + encodeURIComponent(G.overpassQuery(route.points));
  let last = null;
  for (const url of MIRRORS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!r.ok) { last = new Error('overpass ' + r.status + ' at ' + new URL(url).host); continue; }
      return G.parsePois(await r.json());
    } catch (e) { last = e; }
  }
  throw last || new Error('overpass unreachable');
}

// ---- the build: one small step per call (a function has about ten
// seconds), so the page calls it until done: tracks → routes → names →
// place → history → done.
async function loadTracks(s, ids) {
  const out = [];
  const want = ids || s.tracks.map(t => t.id);
  for (let i = 0; i < want.length; i += 10) {
    const part = await Promise.all(want.slice(i, i + 10).map(id => getJSON(trackKey(id), null)));
    for (const d of part) if (d) out.push(d);
  }
  return out;
}
async function buildStep() {
  const s = await state();
  const today = tz.todayKey(), from = tz.shiftKey(today, -HISTORY_DAYS);
  const log = [];
  const rw = await rwgps();
  const rwOn = !!(rw.token && envStr('RWGPS_API_KEY'));
  const progress = extra => Object.assign({ done: false, phase: s.phase, tracks: s.tracks.length, routes: s.routes.length, log }, extra);
  if (!s.phase || s.phase === 'done') s.phase = 'tracks';

  // 1. the ride history, a few tracks per step
  if (s.phase === 'tracks') {
    const list = await rides(from, today);
    const have = new Set(s.tracks.map(t => t.id));
    let fetched = 0;
    for (const r of list) {
      if (have.has(r.id)) continue;
      if (fetched >= TRACKS_PER_STEP) break;
      try { const t = await track(r); s.tracks.push({ id: t.id, date: t.date, name: t.name, virtual: t.virtual, n: t.points.length }); fetched++; }
      catch (e) { log.push('track ' + r.id + ': ' + e.message); if (/429/.test(e.message)) break; }
    }
    const pending = list.filter(r => !s.tracks.some(t => t.id === r.id)).length;
    if (pending === 0 || log.some(l => /429/.test(l))) { if (pending === 0) s.phase = 'routes'; }
    await save(s);
    return progress({ tracks_pending: pending });
  }

  // 2. the routes: RideWithGPS when connected, plus the rides grouped by name (every Zwift world comes from here)
  if (s.phase === 'routes') {
    let pending = 0;
    if (rwOn) {
      try {
        const lib = await rwgpsRoutes();
        let got = 0;
        for (const r of lib) {
          const known = s.routes.find(x => x.id === r.id);
          if (known && known.updated === r.updated) continue;
          if (got >= ROUTES_PER_STEP) { pending++; continue; }
          try {
            const d = await rwgpsRoutePoints(r.rwgps_id);
            await setJSON(routeKey(r.id), { id: r.id, name: r.name, virtual: false, points: d.points, pois: d.pois });
            s.routes = s.routes.filter(x => x.id !== r.id).concat([Object.assign({ source: 'rwgps', named: false, virtual: false }, r)]);
            got++;
          } catch (e) { log.push('route ' + r.name + ': ' + e.message); }
        }
        s.rwgps_routes = lib.length;
      } catch (e) { log.push('ridewithgps: ' + e.message); }
    }
    if (pending === 0) {
      const full = await loadTracks(s);
      const fromRides = G.routesFromTracks(full).filter(r => r.virtual || !rwOn);
      for (const r of fromRides) {
        const name = r.virtual ? `${G.worldOf(r.points[0].lat, r.points[0].lng)} · ${r.name}` : r.name;
        await setJSON(routeKey(r.id), { id: r.id, name, virtual: r.virtual, points: r.points, pois: [] });
        const known = s.routes.find(x => x.id === r.id);
        if (known) Object.assign(known, { rides: r.rides, name });
        else s.routes.push({ id: r.id, name, source: 'strava', virtual: r.virtual, rides: r.rides, named: r.virtual, km: null });
      }
      s.routes = s.routes.filter(r => (r.source === 'rwgps' && rwOn) || fromRides.some(x => x.id === r.id));
      s.phase = 'names';
    }
    await save(s);
    return progress({ routes_pending: pending });
  }

  // 3. names from the map, one route per step (Overpass is a shared, free server)
  if (s.phase === 'names') {
    const r = s.routes.find(x => !x.named && !x.virtual);
    if (r) {
      const d = await getJSON(routeKey(r.id), null);
      if (!d) r.named = true;
      else {
        try { d.pois = (d.pois || []).concat(await namesFor(d)); await setJSON(routeKey(r.id), d); r.named = true; }
        catch (e) { log.push('names for ' + r.name + ': ' + e.message); r.named = 'failed'; }
      }
    }
    const pending = s.routes.filter(x => !x.named && !x.virtual).length;
    if (!pending) s.phase = 'place';
    await save(s);
    return progress({ names_pending: pending });
  }

  // 4. place the flags
  if (s.phase === 'place') {
    const full = await loadTracks(s);
    const road = full.filter(t => !t.virtual);
    const speeds = road.filter(t => t.miles && t.minutes).map(t => t.miles * 1.609 / (t.minutes / 60)).sort((a, b) => a - b);
    s.speed_kmh = speeds.length ? Math.round(speeds[Math.floor(speeds.length / 2)] * 10) / 10 : null;
    const kept = {};
    for (const f of s.flags) kept[f.id] = { name: f.renamed ? f.name : null, hidden: f.hidden || false };
    const flags = [];
    for (const r of s.routes) {
      const d = await getJSON(routeKey(r.id), null); if (!d) continue;
      const placed = G.placeFlags(d, d.pois || [], full.filter(t => !!t.virtual === !!d.virtual), { speed_kmh: s.speed_kmh });
      for (const f of placed) { const k = kept[f.id] || {}; flags.push(Object.assign(f, { name: k.name || f.name, renamed: !!k.name, hidden: !!k.hidden, caught: 0, first_at: null, last_at: null })); }
    }
    s.flags = flags; s.built_at = new Date().toISOString();
    s.scanned = []; s.catches = []; s.xp = 0; s.hunt_bonus_days = [];
    s.phase = 'history';
    await save(s);
    return progress({ flags: flags.length });
  }

  // 5. the catches already in the history, a few rides per step, oldest first
  if (s.phase === 'history') {
    const todo = s.tracks.filter(t => !s.scanned.includes(t.id)).sort((a, b) => a.date < b.date ? -1 : 1).slice(0, 12);
    const full = await loadTracks(s, todo.map(t => t.id));
    for (const t of full.sort((a, b) => a.date < b.date ? -1 : 1)) await scanTrack(s, t, { quiet: true });
    const pending = s.tracks.filter(t => !s.scanned.includes(t.id)).length;
    if (!pending) s.phase = 'done';
    await save(s);
    return pending ? progress({ history_pending: pending }) : { done: true, flags: s.flags.length, routes: s.routes.length, tracks: s.tracks.length, xp: s.xp, log };
  }
  await save(s);
  return progress({});
}

// Catches on one track, credited once per ride.
async function scanTrack(s, t, o) {
  if (s.scanned.includes(t.id)) return [];
  const live = s.flags.filter(f => !f.hidden && !!f.virtual === !!t.virtual);
  const hits = G.catchesIn(live, t);
  const out = [];
  for (const h of hits) {
    const f = s.flags.find(x => x.id === h.flag_id);
    const first = !f.caught;
    const xp = G.xpFor(f, first);
    f.caught = (f.caught || 0) + 1; f.last_at = t.date; if (first) f.first_at = t.date;
    s.xp += xp;
    const c = { flag_id: f.id, name: f.name, rarity: f.rarity, ride_id: t.id, date: t.date, xp, first, d: h.d };
    s.catches.push(c); out.push(c);
  }
  s.scanned.push(t.id);
  if (s.catches.length > 600) s.catches = s.catches.slice(-600);
  return out;
}

// Recent rides not yet scanned: the catches of the ride that just landed.
async function scan(limit) {
  const s = await state();
  if (!s.flags.length) return { new_catches: [], pending: 0 };
  const today = tz.todayKey();
  const list = await rides(tz.shiftKey(today, -3), today);
  const fresh = []; let n = 0;
  for (const r of list) {
    if (s.scanned.includes(r.id)) continue;
    if (n >= (limit || SCAN_PER_CALL)) break;
    try {
      const t = await track(r);
      if (!s.tracks.some(x => x.id === t.id)) s.tracks.push({ id: t.id, date: t.date, name: t.name, virtual: t.virtual, n: t.points.length });
      fresh.push(...await scanTrack(s, t)); n++;
    } catch (e) { if (/429/.test(e.message)) break; }
  }
  // The day's hunt completed is a bonus, once.
  const h = await todayHunt(s);
  if (h && h.hunt && h.caught >= h.hunt.size && !s.hunt_bonus_days.includes(today)) { s.xp += G.HUNT_BONUS; s.hunt_bonus_days.push(today); h.bonus = G.HUNT_BONUS; }
  if (n || (h && h.bonus)) await save(s);
  return { new_catches: fresh, pending: list.filter(r => !s.scanned.includes(r.id)).length, today: h };
}

// Today's hunt: the planned work, on Zwift if the session says so.
async function todayHunt(s) {
  const today = tz.todayKey();
  let sessions = [];
  try { sessions = (await require('./food').sessionsFor(today)).sessions || []; } catch (e) { sessions = []; }
  const rides_ = sessions.filter(x => !/lift|weight|strength|run/i.test(x.name || ''));
  const tss = rides_.reduce((a, x) => a + (x.tss || 0), 0);
  const virtual = rides_.some(x => /zwift|trainer|indoor|40\/20|vo2/i.test(x.name || ''));
  const hunt = G.hunt(s.flags, tss, virtual);
  const caughtToday = s.catches.filter(c => c.date === today);
  const caught = hunt ? hunt.flags.filter(f => caughtToday.some(c => c.flag_id === f.id)).length : caughtToday.length;
  return { date: today, tss, virtual, hunt: hunt ? Object.assign(hunt, { flags: hunt.flags.map(f => Object.assign({}, f, { caught_today: caughtToday.some(c => c.flag_id === f.id) })) }) : null,
    caught, caught_today: caughtToday, sessions: rides_.map(x => ({ name: x.name, tss: x.tss, done: !!x.done })) };
}

function attach(app) {
  app.get('/flags', async (req, res) => { if (!auth(req, res)) return;
    try {
      let s = await state();
      let fresh = [];
      if (s.flags.length) { const r = await scan(2); fresh = r.new_catches; s = await state(); }
      const rw = await rwgps();
      res.json({ built_at: s.built_at, level: G.level(s.xp), flags: s.flags, routes: s.routes, tracks: s.tracks.length, speed_kmh: s.speed_kmh,
        catches: s.catches.slice(-40).reverse(), new_catches: fresh, today: await todayHunt(s),
        sources: { rwgps: { configured: !!envStr('RWGPS_API_KEY'), connected: !!rw.token, user: rw.user, routes: s.rwgps_routes || 0 }, strava_tracks: s.tracks.length } });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/flags/today', async (req, res) => { if (!auth(req, res)) return;
    try {
      const s = await state();
      if (!s.flags.length) return res.json({ built: false, level: G.level(0), hunt: null, caught: 0 });
      const r = await scan(2);
      const s2 = await state();
      res.json(Object.assign({ built: true, level: G.level(s2.xp), new_catches: r.new_catches }, await todayHunt(s2)));
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.post('/flags/build', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await buildStep()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/flags/rebuild', async (req, res) => { if (!auth(req, res)) return;
    try { const s = await state(); s.routes = s.routes.map(r => Object.assign(r, { named: r.virtual })); s.phase = 'tracks'; await save(s); res.json(await buildStep()); }
    catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/flags/scan', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await scan(SCAN_PER_CALL)); } catch (e) { res.status(500).json({ error: e.message }); } });

  app.post('/flags/rename', async (req, res) => { if (!auth(req, res)) return;
    try {
      const s = await state(); const f = s.flags.find(x => x.id === req.body.id);
      if (!f) return res.status(404).json({ error: 'no such flag' });
      f.name = String(req.body.name || f.name).slice(0, 60); f.renamed = true;
      await save(s); res.json({ ok: true, flag: f });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/flags/hide', async (req, res) => { if (!auth(req, res)) return;
    try {
      const s = await state(); const f = s.flags.find(x => x.id === req.body.id);
      if (!f) return res.status(404).json({ error: 'no such flag' });
      f.hidden = !!req.body.hidden; await save(s); res.json({ ok: true, flag: f });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/flags/route/:id', async (req, res) => { if (!auth(req, res)) return;
    try {
      const d = await getJSON(routeKey(req.params.id), null);
      if (!d) return res.status(404).json({ error: 'no such route' });
      res.json({ id: d.id, name: d.name, virtual: !!d.virtual, points: G.downsample(d.points, 120).map(p => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) })) });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/flags/course/:route.tcx', async (req, res) => { if (!auth(req, res)) return;
    try {
      const s = await state();
      const d = await getJSON(routeKey(req.params.route), null);
      if (!d) return res.status(404).json({ error: 'no such route' });
      const flags = s.flags.filter(f => f.route_id === d.id && !f.hidden);
      res.setHeader('Content-Type', 'application/vnd.garmin.tcx+xml');
      res.setHeader('Content-Disposition', `attachment; filename="${d.name.replace(/[^\w ]+/g, '').slice(0, 40) || 'course'} flags.tcx"`);
      res.send(G.tcxCourse(d, flags));
    } catch (e) { res.status(500).json({ error: e.message }); } });

  // RideWithGPS: the password goes to ridewithgps.com once for a token and is not stored.
  app.get('/rwgps/status', async (req, res) => { if (!auth(req, res)) return;
    const r = await rwgps(); res.json({ configured: !!envStr('RWGPS_API_KEY'), connected: !!r.token, user: r.user }); });
  app.post('/rwgps/connect', async (req, res) => { if (!auth(req, res)) return;
    try {
      const key = envStr('RWGPS_API_KEY');
      if (!key) return res.status(400).json({ error: 'RWGPS_API_KEY is not set in Netlify: create an API client at ridewithgps.com/api and add its key' });
      const r = await fetch(RWGPS + '/auth_tokens.json', { method: 'POST', headers: { 'x-rwgps-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ user: { email: String(req.body.email || ''), password: String(req.body.password || '') } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return res.status(400).json({ error: 'ridewithgps ' + r.status + ': ' + ((j.error || j.message) || 'sign-in refused') });
      const tokenObj = j.auth_token || j; const token = tokenObj.auth_token || tokenObj.token;
      if (!token) return res.status(400).json({ error: 'no token in the answer' });
      const user = tokenObj.user ? { id: tokenObj.user.id, name: tokenObj.user.name || tokenObj.user.display_name || null } : null;
      await setJSON('rwgps', { token, user, at: new Date().toISOString() });
      res.json({ ok: true, connected: true, user });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/rwgps/disconnect', async (req, res) => { if (!auth(req, res)) return;
    await setJSON('rwgps', { token: null, user: null }); res.json({ ok: true }); });
}

module.exports = { attach, buildStep, scan, todayHunt };
