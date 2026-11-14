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
async function routesNear(p, o) {
  const key = `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;
  const cache = await getJSON('suggest-routes', {}).catch(() => ({})) || {};
  if (!(o && o.fresh) && cache[key] && Date.now() - Date.parse(cache[key].at) < 7 * 864e5) return cache[key].routes;
  const routes = [], errors = {};
  // the road: Strava's most popular segments in the box around the place; the climbs first
  try {
    const { apiFetch } = require('./strava');
    const j = await apiFetch(`/segments/explore?bounds=${(p.lat - 0.12).toFixed(4)},${(p.lon - 0.15).toFixed(4)},${(p.lat + 0.12).toFixed(4)},${(p.lon + 0.15).toFixed(4)}&activity_type=riding`);
    for (const sg of (j && j.segments) || []) {
      if (!sg.start_latlng || (sg.distance || 0) < 1200) continue;
      const climb = (sg.climb_cat || sg.climb_category || 0), grade = sg.avg_grade || sg.average_grade || 0;
      routes.push({ type: 'road', name: sg.name, lat: sg.start_latlng[0], lon: sg.start_latlng[1], end: sg.end_latlng ? { lat: sg.end_latlng[0], lon: sg.end_latlng[1] } : null,
        km: Math.round((sg.distance || 0) / 100) / 10, grade: Math.round(grade * 10) / 10, climb,
        detail: `${Math.round((sg.distance || 0) / 100) / 10} km${grade >= 2 ? ` at ${Math.round(grade * 10) / 10}%` : ''}${climb > 0 ? `, a Cat ${5 - climb > 0 ? 5 - climb : 'HC'} climb` : ''}: one of the most ridden segments here (Strava)`,
        url: `https://www.strava.com/segments/${sg.id}`, score: 10 + climb * 3 + Math.min(4, (sg.distance || 0) / 2000) });
    }
  } catch (e) { errors.strava = e.message; /* no Strava: the dirt may still answer */ }
  // the dirt: mountain-bike trails and parks TomTom lists near it
  try {
    const k = String(process.env.TOMTOM_API_KEY || '').trim();
    if (k) {
      const r = await fetch(`https://api.tomtom.com/search/2/search/${encodeURIComponent('mountain bike trail')}.json?key=${encodeURIComponent(k)}&lat=${p.lat}&lon=${p.lon}&radius=${NEAR_KM * 1000}&limit=6&countrySet=US`);
      const j = r.ok ? await r.json() : {};
      for (const x of j.results || []) {
        const name = (x.poi && x.poi.name) || ''; if (!name || !x.position) continue;
        const kind = trailKind(name, (x.poi && x.poi.categories) || []);
        if (!kind) continue;   // a bike shop, a store, a road: not a place to ride
        routes.push({ type: kind, name, lat: x.position.lat, lon: x.position.lon, address: x.address && x.address.freeformAddress,
          detail: kind === 'path' ? 'A paved or gravel path: flat, no traffic' : `Mountain-bike trails ${x.dist != null ? `${Math.round(x.dist / 100) / 10} km` : 'near'} from where you are`,
          url: `https://www.google.com/maps/dir/?api=1&destination=${x.position.lat},${x.position.lon}`,
          score: (kind === 'mtb' ? 12 : 10) - Math.min(6, (x.dist || 0) / 2000) });
      }
    }
  } catch (e) { errors.tomtom = e.message; /* the road may still answer */ }
  // the signed routes: OpenStreetMap's named cycling and mountain-bike routes that pass within 12 km (no key, no
  // permission; Strava's segment search has been refusing this app). The start is where he is; the link is its map.
  try {
    const q = `[out:json][timeout:8];(relation(around:12000,${p.lat},${p.lon})[route=bicycle][name];relation(around:12000,${p.lat},${p.lon})[route=mtb][name];);out tags 30;`;
    let j = null, last = null;
    for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) {
      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 7000);
      try { const r = await fetch(url, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
        if (!r.ok) throw new Error('overpass ' + r.status); j = await r.json(); break; } catch (e) { last = e; } finally { clearTimeout(timer); }
    }
    if (!j) throw last || new Error('no map service answered');
    for (const el of j.elements || []) {
      const t = el.tags || {}, name = t.name; if (!name || routes.some(r => r.name.toLowerCase() === name.toLowerCase())) continue;
      const type = t.route === 'mtb' ? 'mtb' : (trailKind(name, []) === 'path' ? 'path' : 'road');
      const km = parseFloat(String(t.distance || '').replace(',', '.')) || null, net = { ncn: 3, rcn: 2, lcn: 1 }[t.network] || 0;
      routes.push({ type, name, lat: p.lat, lon: p.lon, km, osm: true,
        detail: `${type === 'mtb' ? 'A marked mountain-bike route' : type === 'path' ? 'A marked path: flat, mostly car-free' : 'A signed cycling route on the road'}${km ? `, ${Math.round(km)} km in all` : ''}, passing near where you are (OpenStreetMap)`,
        url: `https://www.openstreetmap.org/relation/${el.id}`, score: (type === 'mtb' ? 9 : 8) + net });
    }
  } catch (e) { errors.osm = e.message; }
  routes.sort((a, b) => b.score - a.score);
  cache[key] = { at: new Date().toISOString(), routes: routes.slice(0, 12), errors };
  if (o && o.debug) o.debug.errors = errors;
  for (const k of Object.keys(cache)) if (Date.now() - Date.parse(cache[k].at) > 14 * 864e5) delete cache[k];
  await setJSON('suggest-routes', cache).catch(() => {});
  return cache[key].routes;
}

// What TomTom found, read (Harry, 13 Nov, point 6: "East Coast Greenway" is a path, not mountain-bike trails, and a
// bike shop is not a place to ride): 'mtb' | 'path' | null.
function trailKind(name, cats) {
  const n = String(name || ''), c = (cats || []).join(' ').toLowerCase();
  if (/\b(shop|store|sales|repair|rental|cycles|cyclery|bikes? (inc|co|llc)|outfitters?|sports)\b/i.test(n) || /shop|store|retail/.test(c)) return null;
  if (/greenway|rail[- ]?trail|towpath|\bpath\b|bikeway|canal|parkway trail|w&od|\bb&a\b|multi[- ]?use|\bmup\b/i.test(n)) return 'path';
  if (/mountain bike|\bmtb\b|singletrack|trail(s|head)?\b|state park|park\b|forest|preserve|recreation area|wildlife|farm/i.test(n) || /park|recreation|forest|trail/.test(c)) return 'mtb';
  return null;
}

// ---- the fit (pure, tested) ------------------------------------------------------------------------------
// o: { ride: {minutes, name}, trip: {label, back (min, when he is free there)}, route: {lat, lon}, place: {lat,lon},
//      sunset_min, hours: [{hour, rain_pct, feels_f}] }  → { start, end, why } | { no: reason }
function fit(o) {
  const mins = Math.max(45, Math.min(180, (o.ride && o.ride.minutes) || 60));
  const driveTo = o.place && o.route ? Math.round(kmBetween(o.place, o.route) * 1.3 / 40 * 60) : 0;   // to the start, local roads
  const change = 15;                                                                                    // into kit (dayplan.js changeover)
  const start = Math.ceil((o.trip.back + driveTo + change) / 5) * 5, end = start + mins;
  let short = null;
  if (o.sunset_min != null && end > o.sunset_min) {
    // point 5: November light is short; a shorter ride that ends by sunset beats none (an hour at least)
    const fits = Math.floor((o.sunset_min - 10 - start) / 5) * 5;
    if (fits < 60) return { no: `not enough light: done ${tz.hm12(hmOf(end))}, sunset ${tz.hm12(hmOf(o.sunset_min))}` };
    short = fits;
  }
  const endF = short ? start + short : end;
  const hrs = (o.hours || []).filter(h => h.hour >= Math.floor(start / 60) && h.hour <= Math.floor((endF - 1) / 60));
  if (hrs.some(h => (h.rain_pct || 0) >= 40)) return { no: 'rain likely' };
  const temp = hrs.length ? Math.round(hrs.reduce((a, h) => a + (h.temp_f != null ? h.temp_f : h.feels_f || 0), 0) / hrs.length) : null;
  if (temp != null && temp < MIN_F) return { no: `${temp}°F: under ${MIN_F}` };
  // a nice day: the ride's hours grade B or better (weather.js), or the grade is not known
  const g = o.grade !== undefined ? o.grade : (hrs.some(h => h.cscore != null) ? require('./weather').gradeRide(hrs) : null);
  if (g && g.score < MIN_GRADE) return { no: `the weather grades ${g.letter}, under a B` };
  return { start, end: endF, drive_min: driveTo, grade: g ? g.letter : null, shortened: short ? mins - short : 0,
    why: `after ${o.trip.label}${temp != null ? `, ${temp}°F` : ''}${g ? `, weather ${g.letter}` : ''}${o.sunset_min != null ? `, back before sunset (${tz.hm12(hmOf(o.sunset_min))})` : ''}${short ? `; ${short} min, not ${mins}, for the light` : ''}` };
}
// The one to offer, fitted to the workout (point 2) and the ground (point 3):
//   hard (VO2, threshold, 40/20s)  a climb of 0.8 to 3 km at 4% or more: one rep up, roll down to recover
//   easy (Zone 1, Zone 2)          a path or a flat popular road (under 2%): a climb is not Zone 1
//   mountain bike planned          trails
// Dirt is skipped after rain (wet: rain_in the 36 hours before, 0.1 in or more): trails close and tear up.
function rideKind(ride) {
  const n = String((ride && ride.name) || '');
  if (/mountain|mtb|singletrack|handling/i.test(n)) return 'mtb';
  if (/vo2|40\s*\/\s*20|threshold|interval|sweet|race|over[- ]?under/i.test(n)) return 'hard';
  return 'easy';
}
function pick(routes, ride, o) {
  const wet = !!(o && o.wet), kind = rideKind(ride);
  const R = (routes || []).filter(r => !(wet && r.type === 'mtb'));
  const by = f => R.filter(f).sort((a, b) => b.score - a.score)[0] || null;
  const isClimb = r => r.type === 'road' && ((r.climb || 0) > 0 || (r.grade || 0) >= 4);
  let best = null, note = '';
  if (kind === 'mtb') { best = by(r => r.type === 'mtb'); note = best ? 'Trails for the handling ride.' : ''; }
  if (!best && kind === 'hard') { best = by(r => isClimb(r) && (r.km || 0) >= 0.8 && (r.km || 0) <= 3); note = best ? `The reps on it: one climb a rep, roll back down to recover.` : ''; }
  // no climb the right size (flat country): a popular stretch of road two kilometres or more, steady enough to hold an effort
  if (!best && kind === 'hard') { best = by(r => r.type === 'road' && !isClimb(r) && (r.km || 0) >= 2); note = best ? 'No climb the right size here: a steady stretch to hold the efforts on, easy riding between.' : ''; }
  // an easy day: the most ridden flat thing, a popular road or a path, whichever scores higher
  if (!best && kind !== 'hard') { best = by(r => r.type === 'path' || (r.type === 'road' && !isClimb(r))); note = best ? (best.type === 'path' ? 'Flat and car-free: easy to hold Zone 1.' : 'Flat and well ridden: easy to hold Zone 1.') : ''; }
  if (!best && kind === 'easy') { best = by(r => r.type === 'mtb'); note = best ? 'Easy on the trails: keep the heart rate down on the climbs.' : ''; }
  if (!best) return null;
  return Object.assign({}, best, { fit_note: note, ride_kind: kind });
}

// ---- the loop (point 1): a ride, not just a segment ------------------------------------------------------------
// Road: from the segment's start, up it, out to a turn point and back to the start, about the planned length (TomTom
// bicycle routing). The turn point sits off the segment's middle so the three legs make a triangle of that length.
// A path is out and back; trails are ridden as the trail system goes (the trailhead is the route). Kept as points,
// served as GPX for the Garmin (/suggest/gpx) and as Google Maps directions.
const SPEED = { road: 24, path: 18, mtb: 12 };   // km/h at Zone 1-2
function turnPoint(a, b, perimeterKm) {
  const L = kmBetween(a, b), half = L / 2;
  const d = Math.sqrt(Math.max(0, ((perimeterKm - L) / 2) ** 2 - half * half));   // height of the triangle off the segment
  const midLat = (a.lat + b.lat) / 2, midLon = (a.lon + b.lon) / 2;
  const kx = 111.32 * Math.cos(midLat * Math.PI / 180), ky = 110.57;
  const vx = (b.lon - a.lon) * kx, vy = (b.lat - a.lat) * ky, len = Math.hypot(vx, vy) || 1;
  return { lat: midLat + (vx / len) * d / ky, lon: midLon - (vy / len) * d / kx };   // a right angle off the segment
}
async function loopFor(route, minutes) {
  const k = String(process.env.TOMTOM_API_KEY || '').trim();
  const km = Math.round(SPEED[route.type] * minutes / 60);
  if (!k || route.type !== 'road' || !route.end) return { km, gpx: false };
  const start = { lat: route.lat, lon: route.lon };
  const C = turnPoint(start, route.end, km / 1.25);   // roads wind: a quarter longer than the straight lines
  const pts = [start, route.end, C, start].map(x => `${x.lat.toFixed(5)},${x.lon.toFixed(5)}`).join(':');
  const r = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/${pts}/json?key=${encodeURIComponent(k)}&travelMode=bicycle&routeType=thrilling&hilliness=normal&windingness=normal`);
  if (!r.ok) return { km, gpx: false };
  const j = await r.json(), rt = j.routes && j.routes[0];
  if (!rt) return { km, gpx: false };
  const points = rt.legs.flatMap(l => l.points || []);
  const step = Math.max(1, Math.ceil(points.length / 1500));
  return { km: Math.round(rt.summary.lengthInMeters / 100) / 10, gpx: true, points: points.filter((_, i) => i % step === 0).map(x => [Math.round(x.latitude * 1e5) / 1e5, Math.round(x.longitude * 1e5) / 1e5]),
    maps: `https://www.google.com/maps/dir/?api=1&travelmode=bicycling&origin=${start.lat},${start.lon}&destination=${start.lat},${start.lon}&waypoints=${route.end.lat},${route.end.lon}|${C.lat.toFixed(5)},${C.lon.toFixed(5)}` };
}
function gpxOf(sg) {
  const pts = (sg.loop && sg.loop.points) || [];
  const esc = x => String(x || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="The Way" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(sg.route && sg.route.name)}</name><trkseg>` +
    pts.map(p => `<trkpt lat="${p[0]}" lon="${p[1]}"></trkpt>`).join('') + `</trkseg></trk></gpx>`;
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
  // point 3: the ground: rain in the 36 hours before the ride (the outlook carries the past days)
  let wet = false;
  try { const o = await require('./weather').outlook(tz.shiftKey(date, -2), date); const hrs = [];
    for (const k of [tz.shiftKey(date, -1), date]) for (const h of ((o.days || {})[k] || {}).hours || []) hrs.push(Object.assign({ day: k }, h));
    const startH = Math.floor(best.t.back / 60);
    const rain = hrs.filter(h => (h.day === date && h.hour < startH) || (h.day !== date && h.hour >= startH - 12)).reduce((a, h) => a + (h.rain_in || 0), 0);
    wet = rain >= 0.1; } catch (e) { wet = false; }
  let route = null;
  for (const f of [0, 0.25, 0.5, 0.75]) {
    const at = { lat: best.p.lat + (home.lat - best.p.lat) * f, lon: best.p.lon + (home.lon - best.p.lon) * f };
    route = pick(await routesNear(at), ride, { wet });
    if (route) { route.on_the_way = f > 0; break; }
  }
  if (!route) return { none: 'no known routes near' };
  let day = null; try { const o = await require('./weather').outlook(date, date); day = o && o.days && o.days[date]; } catch (e) { day = null; }
  const sunset = day && day.sunset ? (+day.sunset.slice(0, 2)) * 60 + (+day.sunset.slice(3, 5)) : null;
  const f = fit({ ride: { minutes: Math.round(((ride.steps || []).reduce((a, x) => a + (x.dur_s || 0), 0) / 60) || 60), name: ride.name }, trip: best.t, route, place: best.p, sunset_min: sunset, hours: day ? day.hours : [] });
  if (f.no) return { none: f.no };
  if (route.on_the_way) f.why = f.why.replace(/^after /, `on the way home from `);
  const loop = await loopFor(route, f.end - f.start).catch(() => ({ km: null, gpx: false }));
  return { status: 'open', date, ride_id: ride.id, ride_name: ride.name, ride_minutes: f.end - f.start, start: hmOf(f.start), end: hmOf(f.end), at: tz.hm12(hmOf(f.start)), until: tz.hm12(hmOf(f.end)),
    route, near: best.t.label, why: f.why, drive_min: f.drive_min, wet, loop, made: new Date().toISOString() };
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
      notes: `Recommended ride based on your route: ${sg.why}. ${sg.route.detail}. ${sg.route.fit_note || ''}${sg.loop && sg.loop.km ? ` About ${sg.loop.km} km.` : ''}${sg.loop && sg.loop.maps ? ` The loop: ${sg.loop.maps}` : ` ${sg.route.url}`}\n\n${String(w.notes || '').slice(0, 1200)}` });
  }
  sg.status = ans === 'yes' ? 'yes' : 'no'; sg.answered = new Date().toISOString();
  await setJSON(k, sg);
  return sg;
}
// the five-minute run: today and the next day, worked out once and kept
async function tick(now) {
  const date = tz.todayKey(), p = tz.parts(now || new Date());
  // point 4: the bike has to be in the car, so tomorrow's idea goes to the phone at 7:30 p.m., before the 8 p.m. list
  if (p.h === 19 && p.mi >= 30 && p.mi < 35) {
    const t = await get(tz.shiftKey(date, 1)).catch(() => null), log = await getJSON('suggest-sent', {}).catch(() => ({})) || {};
    if (t && t.status === 'open' && log.date !== date) {
      await require('./push').send({ title: 'Ride idea for tomorrow', body: `${t.route.name}, ${t.at}–${t.until}, ${t.why}. Tap ✓ or ✕ on the Day page by 8 p.m. so the bike makes the packing list.`, tag: 'way-suggest', items: [], url: '/#today' }).catch(() => null);
      await setJSON('suggest-sent', { date, at: new Date().toISOString() }).catch(() => {});
    }
  }
  if (p.mi % 30 >= 5) return { skipped: 'every half hour' };
  const out = {};
  for (const d of [date, tz.shiftKey(date, 1)]) { const x = await get(d).catch(e => ({ error: e.message })); out[d] = x.status || x.none || x.error; }
  return out;
}

function attach(app) {
  const { auth } = require('./fuel-log');
  const wrap = fn => async (req, res) => { if (!auth(req, res)) return; try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/suggest/week', wrap(() => week()));
  // what is known near a point, and what each source said (for looking into an empty suggestion)
  app.get('/suggest/near', wrap(async req => { const dbg = {}; const lat = Number(req.query.lat), lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { const e = new Error('lat and lon'); e.status = 400; throw e; }
    const routes = await routesNear({ lat, lon }, { fresh: true, debug: dbg }); return { routes, errors: dbg.errors || {} }; }));
  app.get('/suggest', wrap(req => get(/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : tz.todayKey(), req.query.fresh === '1')));
  app.post('/suggest', wrap(req => { const b = req.body || {}; return answer(String(b.date || ''), String(b.answer || '')); }));
  // the loop as a GPX file: open it on the phone and share it to Garmin Connect, or import it on the computer
  app.get('/suggest/gpx', async (req, res) => { if (!auth(req, res)) return;
    const sg = await getJSON(`suggest-${String(req.query.date || '')}`, null).catch(() => null);
    if (!sg || !sg.loop || !sg.loop.points) return res.status(404).send('no route');
    res.set('Content-Type', 'application/gpx+xml'); res.set('Content-Disposition', `attachment; filename="${String(sg.route.name || 'ride').replace(/[^\w -]/g, '').slice(0, 40)}.gpx"`); res.send(gpxOf(sg)); });
}
module.exports = { attach, fit, pick, rideKind, trailKind, turnPoint, gpxOf, get, week, answer, tick, routesNear, AWAY_KM };
