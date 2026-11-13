// ============================================================
// suggest.js — a recommended ride based on your route (Harry, 13 Nov 2026: "as I'm coaching, I end up in these
// places that I'm not familiar with … could you recommend bike rides, either mountain bike rides or road bike
// rides, very popular routes, like iconic routes that are either close to where I'm coaching at or on the way …
// a fully blue card that says recommended ride based on your route … a check mark or an X. If I click check, it
// adds to the schedule. If I click X, it doesn't, and then we just continue with the indoor ride.").
//
// ("It wouldn't necessarily need to be games … from McDonogh and back, somewhere between Annapolis and McDonogh
// … on nice days … above 50 degrees … anything above a B".)
// When: any trip at least AWAY_KM from home (a game, McDonogh, a New Jersey tournament) on a day with a ride
// planned and not done. Where: near the place, else on the way home (three quarters, half, a quarter of the way).
// What: the most popular climbs and segments Strava knows there (the road), and the mountain-bike trails TomTom
// lists (the dirt). It must fit: after the trip's last event, with the drive to the start and the changeover
// (dayplan.js), the planned ride's minutes, home before dark, and a nice day: the ride's hours grade B or better on
// The Way's ride weather (weather.js gradeRide: light, wind, rain, cold) and 50°F or warmer.
// Yes: the planned ride becomes that ride outdoors at that time (its place set, so the drives follow, commute.js;
// the bike goes on the 8 p.m. packing list, pack.js). No: nothing changes; the indoor ride stands.
//   GET  /suggest?date=YYYY-MM-DD    the day's suggestion (worked out and kept; ?fresh=1 to work it out again)
//   GET  /suggest/week               the next seven days' kept suggestions, for the Day page
//   POST /suggest                    { date, answer: 'yes' | 'no' }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');

const AWAY_KM = 20, NEAR_KM = 15;
const MIN_F = 50, MIN_GRADE = 79;   // 50°F or warmer, and a B or better (weather.js letterOf: B is 79)
const kmBetween = (a, b) => { const R = 6371, t = x => x * Math.PI / 180; const h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const hmOf = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const isRide = w => w && /ride/i.test(String(w.sport || '')) && !/weight|lift|strength|kettlebell/i.test(String(w.name || ''));

// ---- the routes near a place (kept a week per place) --------------------------------------------------------
async function routesNear(p) {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const cache = await getJSON('suggest-routes', {}).catch(() => ({})) || {};
  if (cache[key] && Date.now() - Date.parse(cache[key].at) < 7 * 864e5) return cache[key].routes;
  const routes = [];
  // the road: Strava's most popular segments in the box around the place; the climbs first
  try {
    const { apiFetch } = require('./strava');
    const j = await apiFetch(`/segments/explore?bounds=${(p.lat - 0.12).toFixed(4)},${(p.lon - 0.15).toFixed(4)},${(p.lat + 0.12).toFixed(4)},${(p.lon + 0.15).toFixed(4)}&activity_type=riding`);
    for (const sg of (j && j.segments) || []) {
      if (!sg.start_latlng || (sg.distance || 0) < 1200) continue;
      const climb = (sg.climb_cat || sg.climb_category || 0), grade = sg.avg_grade || sg.average_grade || 0;
      routes.push({ type: 'road', name: sg.name, lat: sg.start_latlng[0], lon: sg.start_latlng[1], km: Math.round((sg.distance || 0) / 100) / 10, grade: Math.round(grade * 10) / 10, climb,
        detail: `${Math.round((sg.distance || 0) / 100) / 10} km${grade >= 2 ? ` at ${Math.round(grade * 10) / 10}%` : ''}${climb > 0 ? `, a Cat ${5 - climb > 0 ? 5 - climb : 'HC'} climb` : ''}: one of the most ridden segments here (Strava)`,
        url: `https://www.strava.com/segments/${sg.id}`, score: 10 + climb * 3 + Math.min(4, (sg.distance || 0) / 2000) });
    }
  } catch (e) { /* no Strava: the dirt may still answer */ }
  // the dirt: mountain-bike trails and parks TomTom lists near it
  try {
    const k = String(process.env.TOMTOM_API_KEY || '').trim();
    if (k) {
      const r = await fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent('mountain bike trail')}.json?key=${encodeURIComponent(k)}&lat=${p.lat}&lon=${p.lon}&radius=${NEAR_KM * 1000}&limit=6&countrySet=US`);
      const j = r.ok ? await r.json() : {};
      for (const x of j.results || []) {
        const name = (x.poi && x.poi.name) || (x.address && x.address.freeformAddress); if (!name || !x.position) continue;
        routes.push({ type: 'mtb', name, lat: x.position.lat, lon: x.position.lon, address: x.address && x.address.freeformAddress,
          detail: `Trails ${x.dist != null ? `${Math.round(x.dist / 100) / 10} km` : 'near'} from where you are`, url: `https://www.google.com/maps/dir/?api=1&destination=${x.position.lat},${x.position.lon}`,
          score: 12 - Math.min(6, (x.dist || 0) / 2000) });
      }
    }
  } catch (e) { /* the road may still answer */ }
  routes.sort((a, b) => b.score - a.score);
  cache[key] = { at: new Date().toISOString(), routes: routes.slice(0, 8) };
  for (const k of Object.keys(cache)) if (Date.now() - Date.parse(cache[k].at) > 14 * 864e5) delete cache[k];
  await setJSON('suggest-routes', cache).catch(() => {});
  return cache[key].routes;
}

// ---- the fit (pure, tested) ------------------------------------------------------------------------------
// o: { ride: {minutes, name}, trip: {label, back (min, when he is free there)}, route: {lat, lon}, place: {lat,lon},
//      sunset_min, hours: [{hour, rain_pct, feels_f}] }  → { start, end, why } | { no: reason }
function fit(o) {
  const mins = Math.max(45, Math.min(180, (o.ride && o.ride.minutes) || 60));
  const driveTo = o.place && o.route ? Math.round(kmBetween(o.place, o.route) * 1.3 / 40 * 60) : 0;   // to the start, local roads
  const change = 15;                                                                                    // into kit (dayplan.js changeover)
  const start = Math.ceil((o.trip.back + driveTo + change) / 5) * 5, end = start + mins;
  if (o.sunset_min != null && end > o.sunset_min) return { no: `not enough light: done ${tz.hm12(hmOf(end))}, sunset ${tz.hm12(hmOf(o.sunset_min))}` };
  const hrs = (o.hours || []).filter(h => h.hour >= Math.floor(start / 60) && h.hour <= Math.floor((end - 1) / 60));
  if (hrs.some(h => (h.rain_pct || 0) >= 40)) return { no: 'rain likely' };
  const temp = hrs.length ? Math.round(hrs.reduce((a, h) => a + (h.temp_f != null ? h.temp_f : h.feels_f || 0), 0) / hrs.length) : null;
  if (temp != null && temp < MIN_F) return { no: `${temp}°F: under ${MIN_F}` };
  // a nice day: the ride's hours grade B or better (weather.js), or the grade is not known
  const g = o.grade !== undefined ? o.grade : (hrs.some(h => h.cscore != null) ? require('./weather').gradeRide(hrs) : null);
  if (g && g.score < MIN_GRADE) return { no: `the weather grades ${g.letter}, under a B` };
  return { start, end, drive_min: driveTo, grade: g ? g.letter : null,
    why: `after ${o.trip.label}${temp != null ? `, ${temp}°F` : ''}${g ? `, weather ${g.letter}` : ''}${o.sunset_min != null ? `, back before sunset (${tz.hm12(hmOf(o.sunset_min))})` : ''}` };
}
// the one to offer: a mountain-bike ride when the planned ride says so or a trail is close, else the best road climb
function pick(routes, ride) {
  const wantsDirt = /mountain|mtb|trail|gravel/i.test(String((ride && ride.name) || ''));
  const dirt = routes.filter(r => r.type === 'mtb'), road = routes.filter(r => r.type === 'road');
  if (wantsDirt && dirt.length) return dirt[0];
  return road[0] && (!dirt[0] || road[0].score >= dirt[0].score) ? road[0] : dirt[0] || null;
}

// ---- a day's suggestion ---------------------------------------------------------------------------------------
async function workOut(date) {
  const C = require('./commute');
  const s = await C.settings(), home = s.home;
  if (!home) return { none: 'no home set' };
  const d = await getJSON('plan-workouts', { workouts: {} });
  const rides = Object.values(d.workouts || {}).filter(w => w && w.date === date && isRide(w) && !w.suggest_of);
  const ride = rides.sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))[0];
  if (!ride) return { none: 'no ride planned' };
  const evs = await require('./calendar').eventsBetween(date, date).catch(() => []);
  const store = await getJSON(`commute-${date}`, {}).catch(() => ({})) || {};
  const places = await getJSON('commute-places', {}).catch(() => ({})) || {};
  const trips = C.tripsFor(date, evs, s);
  let best = null;
  for (const t of trips) {
    const p = t.dest && typeof t.dest === 'object' ? t.dest : places[String(t.dest || '').toLowerCase().replace(/\s+/g, ' ').trim()];
    if (!p || kmBetween(home, p) < AWAY_KM || t.back == null) continue;
    if (!best || t.back > best.t.back) best = { t, p };
  }
  if (!best) return { none: 'nothing far from home today' };
  // near the place, else on the way home: three quarters, half, a quarter of the way back
  let route = null;
  for (const f of [0, 0.25, 0.5, 0.75]) {
    const at = { lat: best.p.lat + (home.lat - best.p.lat) * f, lon: best.p.lon + (home.lon - best.p.lon) * f };
    route = pick(await routesNear(at), ride);
    if (route) { route.on_the_way = f > 0; break; }
  }
  if (!route) return { none: 'no known routes near' };
  let day = null; try { const o = await require('./weather').outlook(date, date); day = o && o.days && o.days[date]; } catch (e) { day = null; }
  const sunset = day && day.sunset ? (+day.sunset.slice(0, 2)) * 60 + (+day.sunset.slice(3, 5)) : null;
  const f = fit({ ride: { minutes: Math.round(((ride.steps || []).reduce((a, x) => a + (x.dur_s || 0), 0) / 60) || 60), name: ride.name }, trip: best.t, route, place: best.p, sunset_min: sunset, hours: day ? day.hours : [] });
  if (f.no) return { none: f.no };
  if (route.on_the_way) f.why = f.why.replace(/^after /, `on the way home from `);
  return { status: 'open', date, ride_id: ride.id, ride_name: ride.name, ride_minutes: f.end - f.start, start: hmOf(f.start), end: hmOf(f.end), at: tz.hm12(hmOf(f.start)), until: tz.hm12(hmOf(f.end)),
    route, near: best.t.label, why: f.why, drive_min: f.drive_min, made: new Date().toISOString() };
}
async function get(date, fresh) {
  const k = `suggest-${date}`;
  const have = await getJSON(k, null).catch(() => null);
  if (have && (have.status === 'yes' || have.status === 'no')) return have;
  if (have && !fresh && Date.now() - Date.parse(have.made || have.at || 0) < 3 * 3600e3) return have;
  const s = await workOut(date).catch(e => ({ none: e.message }));
  const out = Object.assign({ date, made: new Date().toISOString() }, s);
  await setJSON(k, out).catch(() => {});
  return out;
}
async function week() {
  const today = tz.todayKey(), out = {};
  await Promise.all(Array.from({ length: 7 }, (_, i) => tz.shiftKey(today, i)).map(async d => { const x = await getJSON(`suggest-${d}`, null).catch(() => null); if (x && x.status) out[d] = x; }));
  return out;
}
// yes: the planned ride becomes this ride, outdoors, at this time and place; no: nothing changes
async function answer(date, ans) {
  const k = `suggest-${date}`, sg = await getJSON(k, null);
  if (!sg || sg.status !== 'open') { const e = new Error('no open suggestion for that day'); e.status = 404; throw e; }
  if (ans === 'yes') {
    const W = require('./workouts');
    const d = await getJSON('plan-workouts', { workouts: {} });
    const w = d.workouts[sg.ride_id];
    if (!w) { const e = new Error('the planned ride is gone'); e.status = 404; throw e; }
    const where = sg.route.address || `${sg.route.name}, near ${sg.near}`;
    // the place, as the drives look it up (commute.js placeOf): known now, never geocoded wrong
    const places = await getJSON('commute-places', {}).catch(() => ({})) || {};
    places[where.toLowerCase().replace(/\s+/g, ' ').trim()] = { lat: sg.route.lat, lon: sg.route.lon, label: sg.route.name };
    await setJSON('commute-places', places).catch(() => {});
    await W.update(sg.ride_id, { time: sg.start, sport: 'Ride', location: where, suggested: { type: sg.route.type, name: sg.route.name, url: sg.route.url, near: sg.near, was: { time: w.time, sport: w.sport, name: w.name } },
      name: `${sg.route.type === 'mtb' ? 'MTB' : 'Road'}: ${sg.route.name} · ${sg.ride_minutes} min`,
      notes: `Recommended ride based on your route: ${sg.why}. ${sg.route.detail}. ${sg.route.url}\n\n${String(w.notes || '').slice(0, 1200)}` });
  }
  sg.status = ans === 'yes' ? 'yes' : 'no'; sg.answered = new Date().toISOString();
  await setJSON(k, sg);
  return sg;
}
// the five-minute run: today and the next day, worked out once and kept
async function tick(now) {
  const date = tz.todayKey(), p = tz.parts(now || new Date());
  if (p.mi % 30 >= 5) return { skipped: 'every half hour' };
  const out = {};
  for (const d of [date, tz.shiftKey(date, 1)]) { const x = await get(d).catch(e => ({ error: e.message })); out[d] = x.status || x.none || x.error; }
  return out;
}

function attach(app) {
  const { auth } = require('./fuel-log');
  const wrap = fn => async (req, res) => { if (!auth(req, res)) return; try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/suggest/week', wrap(() => week()));
  app.get('/suggest', wrap(req => get(/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : tz.todayKey(), req.query.fresh === '1')));
  app.post('/suggest', wrap(req => { const b = req.body || {}; return answer(String(b.date || ''), String(b.answer || '')); }));
}
module.exports = { attach, fit, pick, get, week, answer, tick, routesNear, AWAY_KM };
