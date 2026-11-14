// ============================================================
// commute.js — the drives of the day, timed by traffic (Harry, 12 Nov 2026: "Build the commute to school on
// The Way calendar … adjusted based on traffic and then a notification from The Way on my way to school that
// traffic is heavy and to leave now" / "Also for away games in the ECNL").
//
// ("Also build in commute to training as well".) Trips get rows on the calendar (category 'commute', blocking):
//   school     a class day: in arrive_before minutes before the first class, home leave_after minutes after
//              the last
//   coaching   a practice, training session, game, scrimmage or tournament with a venue: in by its "Arrive by"
//              time (else arrive_before minutes before it starts), home after it ends. Two events at one
//              venue on one day are one trip; a far venue (over two hours) with something there the next day
//              too keeps him there overnight, so no drive home that night and none out the next morning.
//   chained    when there is no time to get home between two trips (school out at 3:30, practice at 4:30),
//              the first has no drive home and the second is driven from the first place.
// Each drive is TomTom's prediction for that time with traffic (TOMTOM_API_KEY in Netlify), kept per day in
// the store; venues are looked up once and kept. Without a key: the usual school drive, and for a venue the
// straight-line distance at highway pace, until a reading comes in.
//
// Every five minutes (netlify/functions/reminders.mjs) the check reads live traffic for each trip of the day
// in the window before its arrival and sends to the phone:
//   heavy traffic   once, when the drive is 8 minutes and a fifth over the usual and leaving is within half
//                   an hour: "Heavy traffic to McDonogh: 68 min this morning (usually 50). Leave by 7:07a."
//   leave now       once, five minutes before the time to leave
//   GET  /commute              settings, whether traffic is on, today's trips as they stand
//   POST /commute              { home_address?, home?:{lat,lon}, arrive_before?, leave_after?, usual_min?, notify? }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');

const SCHOOL = { lat: 39.39275, lon: -76.77399, label: 'McDonogh' };   // 8600 McDonogh Rd, Owings Mills
const DEF = { home: null, arrive_before: 15, leave_after: 15, usual_min: 50, notify: true, home_venues: ['Indian Creek', 'Anne Chambers'] };
const SANDBOX = /^(1|true|yes)$/i.test(String(process.env.THE_WAY_SANDBOX || ''));
const GAME = /\b(game|match|scrimmage|cup|tournament|showcase|invitational)\b/i;
const NOT_A_TRIP = /\b(webinar|zoom|seminar|call|meeting|evaluations?|at home|idp)\b/i;
// (Harry, 13 Nov: "Add driving to everything" / "build in that it should update automatically".) Any timed event
// with a real place gets a drive there and back: doctor, dinner out, trailhead, an in-person meeting. Not a drive:
// no place, TBD, a video call or link, home, within WALK_KM of home, a McDonogh campus room (it stretches the
// school trip instead), a ride's route name with no address, an errand looked up more than FAR_KM away (a wrong match).
// a place that is not a place to drive to
const VIRTUAL = /\b(zoom|teams|google meet|meet\.google|webex|facetime|online|virtual|phone|dial[- ]?in|remote)\b|https?:\/\/|www\./i;
// the McDonogh campus: its name, its road, or a classroom number (A104)
const CAMPUS = /mcdonogh|^\s*[A-Z]\d{3}\b/i;
// a street address, so "Faculty meeting, 12 Main St" is still a trip
const STREETISH = /\b\d+\s+[\w.' ]+\b(rd|road|st|street|ave|avenue|blvd|boulevard|dr|drive|way|ln|lane|pkwy|parkway|hwy|highway|ct|court|pl|place|pike|cir|circle|ter|terrace)\b/i;
const WALK_KM = 1.2;   // nearer than this to home: a walk, not a drive
const FAR_KM = 400;    // an errand looked up further than this is a wrong match (a game can be that far: PDA)

const clampInt = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const trafficKey = () => String(process.env.TOMTOM_API_KEY || '').trim();
const iso = (date, min) => { const [y, mo, d] = date.split('-').map(Number); return tz.zonedToUTC(y, mo, d, Math.floor(min / 60), min % 60).toISOString(); };
const hmOf = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(((m % 60) + 60) % 60).padStart(2, '0');
const hm = m => tz.hm12(hmOf(m));

async function settings() { return Object.assign({}, DEF, await getJSON('commute', {}).catch(() => ({}))); }
function homeOf(s) {
  if (s && s.home && Number.isFinite(+s.home.lat) && Number.isFinite(+s.home.lon)) return { lat: +s.home.lat, lon: +s.home.lon, label: s.home.label || 'home' };
  return null;
}

// ---- the day's trips ----------------------------------------------------------------------
// The day's classes: the timetable's rows and the school calendar's events (the rest-day pattern names them).
function classTimes(date, events) {
  const C = require('./classes');
  const re = new RegExp((C.TABLE.rest_day && C.TABLE.rest_day.match) || 'World History', 'i');
  const mins = [];
  for (const e of events || []) {
    if (!e || e.allDay || !e.start || !e.end || e.source === 'commute') continue;
    if (!re.test(String(e.summary || '')) && !/mcdonogh class/i.test(String(e.calendar || '')) && !onCampus(e)) continue;
    if (tz.keyOf(new Date(e.start)) !== date) continue;
    mins.push([tz.minutesOf(new Date(e.start)), tz.minutesOf(new Date(e.end))]);
  }
  for (const c of C.classesForDate(date)) mins.push([c.start_min, c.end_min]);
  if (!mins.length) return null;
  return { first: Math.min(...mins.map(m => m[0])), last: Math.max(...mins.map(m => m[1])) };
}
// "Arrive by 1:40 PM" in a game's notes
function arriveBy(text) {
  const m = /arrive\s+by\s+(\d{1,2}):(\d{2})\s*([ap])\.?m/i.exec(String(text || ''));
  if (!m) return null;
  let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12;
  return h * 60 + +m[2];
}
const venueKey = loc => String(loc || '').toLowerCase().replace(/\s+/g, ' ').trim();
const venueName = loc => String(loc || '').split(',')[0].trim().slice(0, 40);
// one place however the calendar writes it: "…, MD, USA" and "…, MD" are the same park (Harry's Wed 18 Nov practice and staff meeting)
const placeKey = loc => venueKey(loc).replace(/,?\s*(usa|united states( of america)?)\s*$/, '').replace(/\s+\d{5}(-\d{4})?\b/g, '').replace(/[,\s]+$/, '');
const isHomeVenue = (loc, s) => (s.home_venues || []).some(v => v && venueKey(loc).includes(String(v).toLowerCase()));
const onCampus = e => !!(e && !e.allDay && e.location && CAMPUS.test(String(e.location)) && !VIRTUAL.test(String(e.location)) && e.category !== 'info');
// home itself, by its street number and street ("1915 Towne Centre")
function atHome(loc, s) {
  const h = s && s.home && String(s.home.label || '').toLowerCase().match(/^\s*(\d+\s+\w+)/);
  const l = venueKey(loc);
  return /^(home|my (place|house|apartment)|house)$/.test(l) || !!(h && l.includes(h[1]));
}
// Does this event take a drive? A timed event with a real place that is not home, not campus, not a call.
function isTrip(e, s) {
  if (!e || e.allDay || !e.start || !e.end || e.source === 'commute' || e.category === 'commute' || e.category === 'sleep' || e.category === 'info') return false;
  const loc = String(e.location || '').trim();
  if (!loc || /^tbd\b/i.test(loc) || VIRTUAL.test(loc) || CAMPUS.test(loc) || atHome(loc, s)) return false;
  // a call, a seminar or a meeting is a trip only with a real place ("Staff Meeting (in person)", Liberty Sports Park, …)
  if (NOT_A_TRIP.test(String(e.summary || '')) && !/in[- ]person/i.test(String(e.summary || '')) && !STREETISH.test(loc) && !loc.includes(',')) return false;
  // outside coaching, only a place that reads as an address or a named place with its town ("Butler side roads" is a route)
  if (e.category !== 'coaching' && !STREETISH.test(loc) && !loc.includes(',')) return false;
  return true;
}
// The day's places (coaching, and everything else with a real place): one per place, earliest arrival, latest end.
function venueTrips(date, events, s) {
  const out = [];
  for (const e of events || []) {
    if (!isTrip(e, s)) continue;
    if (tz.keyOf(new Date(e.start)) !== date) continue;
    const start = tz.minutesOf(new Date(e.start)), end = tz.minutesOf(new Date(e.end));
    const arrive = arriveBy(e.description) ?? (start - s.arrive_before);
    const coaching = e.category === 'coaching', game = coaching && GAME.test(String(e.summary || ''));
    const k = placeKey(e.location), have = out.find(g => g.key === k);
    if (have) { have.arrive = Math.min(have.arrive, arrive); have.end = Math.max(have.end, end); have.game = have.game || game; have.coaching = have.coaching || coaching; continue; }
    // the place's name, or the event's when the place is only a street address ("Physio" over "12 West St")
    const place = venueName(e.location), byTitle = /^\d/.test(place) && !coaching;
    const title = String(e.summary || '').replace(/\s*[|·].*$/, '').trim().slice(0, 40);
    out.push({ key: k, location: e.location, label: byTitle && title ? title : place, arrive, end, game, coaching, home_field: isHomeVenue(e.location, s) });
  }
  return out;
}
const coachingTrips = (date, events, s) => venueTrips(date, events, s).filter(g => g.coaching);
const awayGames = (date, events, s) => coachingTrips(date, events, s).filter(g => g.game && !g.home_field);
// A planned ride with a place (suggest.js: a recommended ride he said yes to) is a trip like an event: the drive
// there from wherever he is, and home after it.
async function withPlaces(evs) {
  const dates = [...new Set((evs || []).filter(e => e && e.start).map(e => tz.keyOf(new Date(e.start))))];
  if (!dates.length) return evs || [];
  let d; try { d = await getJSON('plan-workouts', { workouts: {} }); } catch (e) { return evs; }
  const extra = [];
  for (const w of Object.values(d.workouts || {})) {
    if (!w || !w.location || !w.time || !dates.includes(w.date) || w.done) continue;
    const [h, mi] = w.time.split(':').map(Number), mins = Math.round((w.steps || []).reduce((a, x) => a + (x.dur_s || 0), 0) / 60) || 60;
    const [y, mo, dd] = w.date.split('-').map(Number);
    const st = tz.zonedToUTC(y, mo, dd, h, mi);
    extra.push({ summary: w.name, category: 'training', location: w.location, allDay: false, start: st.toISOString(), end: new Date(st.getTime() + mins * 60000).toISOString(), source: 'plan-place', workout_id: w.id });
  }
  return (evs || []).concat(extra);
}
// Every trip of a day: { id, kind, label, dest (school point or venue text), arrive (min), back (min) or null }
function tripsFor(date, events, s, nextEvents) {
  const trips = [];
  const times = classTimes(date, events);
  if (times) trips.push({ id: 'school', kind: 'school', label: SCHOOL.label, dest: SCHOOL, arrive: times.first - s.arrive_before, back: times.last + s.leave_after });
  for (const g of venueTrips(date, events, s)) trips.push({ id: 'go:' + g.key, kind: g.game ? 'game' : g.coaching ? 'training' : 'event', label: g.label, dest: g.location, arrive: g.arrive, back: g.end + (g.coaching ? 15 : 5) });
  return trips.sort((a, b) => a.arrive - b.arrive);
}
// No time to get home between two trips: the first keeps no drive home, the second leaves from the first place.
// est(trip, leg): the drive in minutes as known (a reading, else the straight-line estimate, else the usual).
function chain(trips, store, s) {
  const est = (t, leg) => { const c = store && store[t.id]; return (c && c[leg] && c[leg].min) || (c && c.est) || (t.kind === 'school' ? s.usual_min : null); };
  // a place that turned out to be a walk from home, or a wrong match far away, is no trip
  const out = trips.filter(t => !(store && store[t.id] && (store[t.id].walk || store[t.id].far))).map(t => Object.assign({}, t));
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (a.back == null || est(b, 'to') == null) continue;   // a venue not looked up yet: no guess
    if (a.back + est(a, 'home') + 20 + est(b, 'to') > b.arrive) { a.back = null; b.from = a.id; b.from_label = a.label; b.from_dest = a.dest; }
  }
  return out;
}

// ---- rows on the calendar --------------------------------------------------------------------
// heavy: eight minutes and a fifth over the usual drive
function heavy(r, usual) {
  if (!r || !r.min) return false;
  const base = usual || r.usual_min || r.free_min;
  return !!base && r.min - base >= Math.max(8, Math.round(base * 0.2));
}
// A trip's two rows. c: its stored readings { to:{min, usual_min}, home:{…}, est }. overnight: { out, back } to skip.
function rowsFor(date, trip, s, c, overnight) {
  const usual = trip.kind === 'school' ? s.usual_min : (c && c.est) || null;
  const toMin = (c && c.to && c.to.min) || usual, homeMin = (c && c.home && c.home.min) || usual;
  if (!toMin) return [];   // a venue not looked up yet: no guess on the calendar
  if (c && (c.walk || c.far)) return [];   // a walk from home, or a far-off wrong match: no drive on the calendar
  const note = r => r && r.min ? `${r.min} min in traffic${r.usual_min && r.min - r.usual_min >= 5 ? `, ${r.min - r.usual_min} over the usual` : ''}` : `about ${usual} min`;
  const hv = r => r && heavy(r, trip.kind === 'school' ? s.usual_min : null) ? ' · heavy traffic' : '';
  const base = { category: 'commute', source: 'commute', calendar: 'The Way', account: 'the way', allDay: false, blocking: true };
  const rows = [];
  if (!(overnight && overnight.out)) rows.push(Object.assign({ id: `commute-to-${trip.id}-${date}`, summary: `Drive to ${trip.label} · ${toMin} min${hv(c && c.to)}`,
    detail: `${trip.from_label ? `from ${trip.from_label} · ` : ''}${note(c && c.to)} · in by ${hm(trip.arrive)}`, start: iso(date, trip.arrive - toMin), end: iso(date, trip.arrive) }, base));
  if (trip.back != null && !(overnight && overnight.back)) rows.push(Object.assign({ id: `commute-home-${trip.id}-${date}`, summary: `Drive home · ${homeMin} min${hv(c && c.home)}`,
    detail: `from ${trip.label} · ${note(c && c.home)}`, start: iso(date, trip.back), end: iso(date, trip.back + homeMin) }, base));
  return rows;
}
// A far venue two days running: stay over (no drive home the first night, none out the next morning).
const FAR_MIN = 120;
function overnightFor(date, trip, store, byDate) {
  if (trip.kind === 'school') return null;
  const c = store && store[trip.id], min = c && ((c.to && c.to.min) || c.est);
  if (!min || min < FAR_MIN) return null;
  const has = d => (byDate[d] || []).some(t => t.id === trip.id);
  return { back: has(tz.shiftKey(date, 1)), out: has(tz.shiftKey(date, -1)) };
}

// Every trip in the events gets its rows. Readings are stored per day (today and the days ahead the check reached).
async function withCommutes(events) {
  const evs = events || [];
  let s; try { s = await settings(); } catch (e) { return evs; }
  if (s.off) return evs;
  const dates = [...new Set(evs.filter(e => e && !e.allDay && e.start).map(e => tz.keyOf(new Date(e.start))))].sort();
  const withP = await withPlaces(evs).catch(() => evs);
  const byDate = {};
  for (const d of dates) byDate[d] = tripsFor(d, withP, s);
  const out = evs.slice();
  // the stored readings for every day with a trip, read at once
  const stores = {};
  await Promise.all(dates.filter(d => byDate[d].length).map(async d => { stores[d] = await getJSON(`commute-${d}`, {}).catch(() => ({})) || {}; }));
  for (const date of dates) {
    if (!byDate[date].length) continue;
    const store = stores[date] || {};
    for (const trip of chain(byDate[date], store, s)) out.push(...rowsFor(date, trip, s, store[trip.id], overnightFor(date, trip, store, byDate)));
  }
  return out;
}

// ---- traffic -------------------------------------------------------------------------------
// One drive with traffic: TomTom's routing, live and historic. o.departAt: Date (or now); o.arriveAt: Date.
async function route(from, to, o) {
  const k = trafficKey(); if (!k) return null;
  const when = o && o.arriveAt ? `&arriveAt=${encodeURIComponent(o.arriveAt.toISOString())}` : `&departAt=${o && o.departAt ? encodeURIComponent(o.departAt.toISOString()) : 'now'}`;
  const u = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lon}:${to.lat},${to.lon}/json?key=${encodeURIComponent(k)}&traffic=true&travelMode=car&routeType=fastest&computeTravelTimeFor=all${when}`;
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 7000);
  try {
    const r = await fetch(u, { signal: ac.signal });
    if (!r.ok) throw new Error('tomtom routing ' + r.status);
    const j = await r.json(); const x = j.routes && j.routes[0] && j.routes[0].summary;
    if (!x) throw new Error('no route');
    const m = v => v == null ? null : Math.round(v / 60);
    return { min: m(x.travelTimeInSeconds), delay_min: m(x.trafficDelayInSeconds) || 0, free_min: m(x.noTrafficTravelTimeInSeconds),
      usual_min: m(x.historicTrafficTravelTimeInSeconds) || m(x.noTrafficTravelTimeInSeconds), km: Math.round((x.lengthInMeters || 0) / 100) / 10, at: new Date().toISOString() };
  } finally { clearTimeout(timer); }
}
// An address to a point: TomTom with the key, else OpenStreetMap. Venues are kept once found.
async function geocode(q) {
  const k = trafficKey();
  if (k) {
    const r = await fetch(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(q)}.json?key=${encodeURIComponent(k)}&countrySet=US&limit=1`);
    const j = r.ok ? await r.json() : {}; const x = j.results && j.results[0];
    if (x && x.position) return { lat: x.position.lat, lon: x.position.lon, label: (x.address && x.address.freeformAddress) || q };
  }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'the-way-app' } });
  const j = r.ok ? await r.json() : []; const x = j[0];
  if (!x) { const e = new Error('Could not find that address.'); e.status = 400; throw e; }
  return { lat: +x.lat, lon: +x.lon, label: x.display_name ? x.display_name.split(',').slice(0, 3).join(',') : q };
}
async function placeOf(dest) {
  if (dest && typeof dest === 'object') return dest;
  const k = venueKey(dest), places = await getJSON('commute-places', {}).catch(() => ({})) || {};
  if (places[k]) return places[k];
  const p = await geocode(String(dest).replace(/^.*?\|\s*/, ''));
  places[k] = p; await setJSON('commute-places', places).catch(() => {});
  return p;
}
const kmBetween = (a, b) => { const R = 6371, t = x => x * Math.PI / 180; const h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lon - a.lon) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

// The predicted drives for a day's trips, both ways, stored for the calendar rows (fresh for three hours).
async function refresh(date, events) {
  const s = await settings(), home = homeOf(s);
  if (!home) return null;
  const evs = await withPlaces(events || await require('./calendar').eventsBetween(date, date).catch(() => [])).catch(() => events || []);
  const raw = tripsFor(date, evs, s);
  if (!raw.length) return null;
  const store = await getJSON(`commute-${date}`, {}).catch(() => ({})) || {};
  // today's drives are re-read every 20 minutes, the days ahead every 3 hours; a moved event at once (x.for)
  const ttl = date === tz.todayKey() ? 20 * 60e3 : 3 * 3600e3;
  const fresh = (x, from, when) => x && x.at && Date.now() - Date.parse(x.at) < ttl && (x.from || 'home') === (from || 'home') && (!when || x.for === when);
  // twice: the first pass learns how far each place is, the second routes a trip from the place before it when
  // there is no time to go home between them (a ride at the trailhead straight after a game)
  for (let pass = 0; pass < 2; pass++)
  for (const t of chain(raw, store, s)) {
    const c = store[t.id] = store[t.id] || {};
    let p, o = home; try { p = await placeOf(t.dest); if (t.from) o = await placeOf(t.from_dest); } catch (e) { continue; }
    c.est = Math.round(kmBetween(o, p) * 1.3 / 75 * 60 + 10);   // no traffic yet: the straight line at highway pace
    c.walk = !t.from && kmBetween(home, p) < WALK_KM;
    c.far = t.kind === 'event' && kmBetween(home, p) > FAR_KM;
    if (c.walk || c.far) continue;
    if (!trafficKey()) continue;
    if (!fresh(c.to, t.from, t.arrive)) { const r = await route(o, p, { arriveAt: new Date(iso(date, t.arrive)) }).catch(() => null); c.to = r ? Object.assign(r, { from: t.from || 'home', for: t.arrive }) : (c.to || null); }
    if (t.back != null && !fresh(c.home, null, t.back)) { const r = await route(p, home, { departAt: new Date(iso(date, t.back)) }).catch(() => null); c.home = r ? Object.assign(r, { for: t.back }) : (c.home || null); }
  }
  await setJSON(`commute-${date}`, store).catch(() => {});
  return store;
}

// ---- the morning (and game-day) check ------------------------------------------------------------
// What to send now, if anything (tested without a phone). nowMin: minutes from midnight; target: when to be
// there; r: the live drive; sent: what went for this trip today; label: where to.
function decide(nowMin, target, r, usual, sent, label) {
  if (!r || !r.min || nowMin > target) return null;
  const to = label || SCHOOL.label;
  const leaveBy = target - r.min, hv = heavy(r, usual), u = usual || r.usual_min || r.free_min;
  if (!sent.leave && nowMin >= leaveBy - 5) {
    return { kind: 'leave', title: hv ? 'Leave now · heavy traffic' : `Time to leave for ${to}`,
      body: hv ? `${r.min} min to ${to} (usually ${u}). Leave now to be in by ${hm(target)}.` : `${r.min} min to ${to}. Leave now to be in by ${hm(target)}.` };
  }
  if (hv && !sent.heavy && leaveBy - nowMin <= 30) {
    return { kind: 'heavy', title: `Heavy traffic to ${to}`, body: `${r.min} min right now (usually ${u}). Leave by ${hm(leaveBy)} to be in by ${hm(target)}.` };
  }
  return null;
}

async function check(now) {
  if (SANDBOX) return { skipped: 'the copy never sends on a schedule' };
  const s = await settings(), home = homeOf(s);
  if (!home) return { skipped: 'no home set' };
  const date = tz.todayKey(), p = tz.parts(now || new Date()), nowMin = p.h * 60 + p.mi;
  const tomorrow = tz.shiftKey(date, 1);
  const evs = await withPlaces(await require('./calendar').eventsBetween(date, tomorrow).catch(() => [])).catch(() => []);
  // the readings for the calendar: today's and tomorrow's trips, kept fresh
  const store = await refresh(date, evs).catch(() => null) || {};
  // kept up to date by itself: one day of the six ahead is re-read on each five-minute run, the week every half hour
  const ahead = (Math.floor(nowMin / 5) % 6) + 1, aday = tz.shiftKey(date, ahead);
  const aevs = ahead === 1 ? evs : await require('./calendar').eventsBetween(aday, aday).catch(() => []);
  await refresh(aday, aevs).catch(() => null);
  if (!s.notify || !trafficKey()) return { skipped: !s.notify ? 'notifications off' : 'no traffic key (TOMTOM_API_KEY)' };
  const trips = chain(tripsFor(date, evs, s), store, s);
  const log = await getJSON('commute-sent', { date, sent: {} });
  if (log.date !== date) { log.date = date; log.sent = {}; }
  const out = [];
  for (const t of trips) {
    const c = store[t.id] || {};
    const expect = (c.to && c.to.min) || c.est || s.usual_min;
    if (nowMin < t.arrive - Math.max(150, expect + 75) || nowMin > t.arrive) continue;
    const byDate = { [date]: trips, [tz.shiftKey(date, -1)]: tripsFor(tz.shiftKey(date, -1), evs, s) };
    const on = overnightFor(date, t, store, byDate); if (on && on.out) continue;   // already there from the night before
    if (c.walk || c.far) continue;
    let place, origin = home; try { place = await placeOf(t.dest); if (t.from) origin = await placeOf(t.from_dest); } catch (e) { continue; }
    const r = await route(origin, place, {}).catch(() => null);
    if (!r) continue;
    c.to = Object.assign({}, r, { live: true, from: t.from || 'home' }); store[t.id] = c;
    const sent = log.sent[t.id] = log.sent[t.id] || {};
    const msg = decide(nowMin, t.arrive, r, t.kind === 'school' ? s.usual_min : (r.usual_min || null), sent, t.label);
    if (!msg) { out.push({ trip: t.id, drive_min: r.min, leave_by: hm(t.arrive - r.min) }); continue; }
    const res = await require('./push').send({ title: msg.title, body: msg.body, tag: 'way-commute-' + t.id, items: [], url: '/#today' });
    sent[msg.kind] = new Date().toISOString(); if (msg.kind === 'leave') sent.heavy = sent.heavy || sent.leave;
    out.push({ trip: t.id, sent: msg, result: res });
  }
  await setJSON(`commute-${date}`, store).catch(() => {});
  await setJSON('commute-sent', log).catch(() => {});
  return { date, trips: out };
}

// ---- settings and the page ----------------------------------------------------------------------
async function save(b) {
  const s = await settings();
  if (b.home_address) s.home = await geocode(String(b.home_address).slice(0, 200));
  else if (b.home && Number.isFinite(+b.home.lat) && Number.isFinite(+b.home.lon)) s.home = { lat: +b.home.lat, lon: +b.home.lon, label: String(b.home.label || 'home').slice(0, 80) };
  if (b.arrive_before != null) s.arrive_before = clampInt(b.arrive_before, 0, 90, s.arrive_before);
  if (b.leave_after != null) s.leave_after = clampInt(b.leave_after, 0, 120, s.leave_after);
  if (b.usual_min != null) s.usual_min = clampInt(b.usual_min, 5, 180, s.usual_min);
  if (b.notify != null) s.notify = !!b.notify;
  if (b.off != null) s.off = !!b.off;
  await setJSON('commute', s);
  // a new home: the stored readings are for the old one
  if (b.home_address || b.home) for (let i = 0; i < 7; i++) await setJSON(`commute-${tz.shiftKey(tz.todayKey(), i)}`, {}).catch(() => {});
  return status();
}

async function status() {
  const s = await settings(), date = tz.todayKey();
  const evs = await withPlaces(await require('./calendar').eventsBetween(date, tz.shiftKey(date, 6)).catch(() => [])).catch(() => []);
  const store = await refresh(date, evs).catch(() => null) || {};
  const trips = chain(tripsFor(date, evs, s), store, s).map(t => ({ trip: t.label, kind: t.kind, in_by: hm(t.arrive),
    rows: rowsFor(date, t, s, store[t.id], null).map(r => ({ summary: r.summary, detail: r.detail, from: hm(tz.minutesOf(new Date(r.start))), to: hm(tz.minutesOf(new Date(r.end))) })) }));
  const ahead = [];
  for (let i = 1; i < 7; i++) { const d = tz.shiftKey(date, i); for (const g of venueTrips(d, evs, s)) ahead.push({ date: d, label: tz.labelOf(d), venue: g.label, kind: g.game ? 'game' : g.coaching ? 'training' : 'event', in_by: hm(g.arrive) }); }
  const log = await getJSON('commute-sent', { date: null, sent: {} }).catch(() => ({ sent: {} }));
  return { home: s.home ? { label: s.home.label } : null, school: SCHOOL.label, arrive_before: s.arrive_before, leave_after: s.leave_after, usual_min: s.usual_min,
    notify: s.notify, off: !!s.off, traffic: !!trafficKey(), today: trips, coaching_ahead: ahead, sent_today: log.date === date ? log.sent : {} };
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/commute', async (req, res) => { if (!auth(req, res)) return; try { res.json(await status()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/commute', async (req, res) => { if (!auth(req, res)) return; try { res.json(await save(req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
}

module.exports = { attach, withPlaces, withCommutes, rowsFor, tripsFor, chain, coachingTrips, venueTrips, isTrip, atHome, classTimes, awayGames, arriveBy, overnightFor, decide, heavy, check, refresh, route, settings, SCHOOL, DEF };
