// ============================================================
// races.js — the race calendar (Harry, 14 Nov 2026: "Let's build a race calendar section to this site").
// His races, the ones he is thinking about and the ones he has done: each with its date, kind, how much it matters
// (A: the season is built around it; B: raced properly, no long taper; C: training with a number on), where it is,
// what it asks of him, the link to enter, and afterwards the result.
// The next A race sets the season's clock (race.js: base, build, peak, taper, race week); with none on the
// calendar the season is base. The coach knows what is ahead and how many weeks out it is.
//
//   GET    /races              { today, next, target, clock, upcoming:[…], past:[…], kinds, sources }
//   POST   /races              { name, date, kind?, priority?, location?, distance_mi?, climb_ft?, minutes?, url?, notes?, status? }
//   PUT    /races/:id          any of the same, plus result: { place?, field?, time?, notes? }
//   DELETE /races/:id
//   GET    /races/find?kind=    races open for entry within reach of home, from BikeReg's event search (kept 12 hours)
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const KEY = 'races';
const KINDS = ['road race', 'criterium', 'time trial', 'gran fondo', 'gravel', 'mountain bike', 'cyclocross', 'hill climb', 'other'];
const STATUSES = ['idea', 'planned', 'registered', 'done', 'skipped'];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x * 10) / 10 : null; };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);

// what the calendar's words say about its kind, when he does not ("the Greenbelt crit", "Gran Fondo Maryland")
function kindOf(name) {
  const n = String(name || '').toLowerCase();
  return /cyclo-?cross|\bcx\b|\bcross\b/.test(n) ? 'cyclocross' : /\bcrit(erium)?\b/.test(n) ? 'criterium' : /time trial|\btt\b|chrono/.test(n) ? 'time trial'
    : /gran ?fondo|fondo|century/.test(n) ? 'gran fondo' : /gravel|grinder/.test(n) ? 'gravel' : /mountain|\bmtb\b|\bxc\b|enduro|trail/.test(n) ? 'mountain bike'
    : /hill ?climb/.test(n) ? 'hill climb' : /road race|\brr\b|classic|circuit/.test(n) ? 'road race' : 'other';
}

// One race, from what was sent over what was there. Throws a 400 with plain words when it cannot be a race.
function clean(body, prev) {
  const b = body || {}, p = prev || {};
  const bad = m => { const e = new Error(m); e.status = 400; return e; };
  const name = b.name != null ? str(b.name, 120) : p.name;
  if (!name) throw bad('A race needs a name.');
  const date = b.date != null ? String(b.date).slice(0, 10) : p.date;
  if (!isDate(date)) throw bad('A race needs its date (year, month, day).');
  const kind = KINDS.includes(b.kind) ? b.kind : (b.kind == null && p.kind) || kindOf(name);
  const priority = /^[ABC]$/i.test(String(b.priority || '')) ? String(b.priority).toUpperCase() : (p.priority || 'B');
  let status = STATUSES.includes(b.status) ? b.status : (p.status || 'planned');
  const result = b.result === null ? null : b.result && typeof b.result === 'object'
    ? { place: num(b.result.place, 1, 5000), field: num(b.result.field, 1, 5000), time: str(b.result.time, 20) || null, notes: str(b.result.notes, 600) || null }
    : (p.result || null);
  if (result && (result.place || result.time || result.notes) && status !== 'skipped') status = 'done';
  const url = b.url != null ? str(b.url, 400) : (p.url || '');
  return { id: p.id || 'r_' + Math.random().toString(36).slice(2, 10), name, date, kind, priority, status,
    location: b.location != null ? str(b.location, 120) : (p.location || ''),
    distance_mi: b.distance_mi !== undefined ? num(b.distance_mi, 0.1, 500) : (p.distance_mi ?? null),
    climb_ft: b.climb_ft !== undefined ? num(b.climb_ft, 0, 40000) : (p.climb_ft ?? null),
    minutes: b.minutes !== undefined ? num(b.minutes, 1, 1500) : (p.minutes ?? null),
    category: b.category != null ? str(b.category, 60) : (p.category || ''),
    url: /^https?:\/\//i.test(url) ? url : '',
    notes: b.notes != null ? str(b.notes, 1200) : (p.notes || ''),
    result, created: p.created || new Date().toISOString(), updated: new Date().toISOString() };
}

// the season's clock from the weeks to the race it is built around (the same steps race.js has always used)
function phaseOf(weeks) { return weeks > 12 ? 'base' : weeks > 4 ? 'build' : weeks > 1 ? 'peak' : weeks > 0.3 ? 'taper' : 'race week'; }
const PHASE_WORD = { base: 'base: long easy riding, strength, a little intensity', build: 'build: the hard days get race-specific', peak: 'peak: sharpen, less volume', taper: 'taper: rest into it, short and sharp', 'race week': 'race week: stay fresh, open the legs the day before' };

// Everything the page and the coach need, worked out from the list and today's date (pure).
function view(list, today) {
  const all = (list || []).filter(r => r && r.name && isDate(r.date)).map(r => {
    const days = daysBetween(today, r.date);
    return Object.assign({}, r, { days_out: days, weeks_out: Math.round(days / 7 * 10) / 10, past: days < 0 });
  });
  const live = r => r.status !== 'skipped' && r.status !== 'done';
  const upcoming = all.filter(r => !r.past).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const past = all.filter(r => r.past).sort((a, b) => b.date.localeCompare(a.date));
  const next = upcoming.find(live) || null;
  // the race the season is built around: the next A race; with none, the next B race counts for a short sharpening only
  const target = upcoming.find(r => live(r) && r.priority === 'A') || null;
  const clock = target ? { race_id: target.id, name: target.name, date: target.date, days_out: target.days_out, weeks_out: target.weeks_out, phase: phaseOf(target.weeks_out), word: PHASE_WORD[phaseOf(target.weeks_out)] }
    : { race_id: null, name: null, date: null, days_out: null, weeks_out: null, phase: 'base', word: 'no A race on the calendar: the season is base until one is set' };
  // two races close together: said, so one is not an accident (within 6 days of another live one)
  for (const r of upcoming) r.crowded = upcoming.some(o => o !== r && live(o) && live(r) && Math.abs(daysBetween(o.date, r.date)) <= 6 && (o.priority === 'A' || r.priority === 'A')) || undefined;
  return { today, next, target, clock, upcoming, past, kinds: KINDS, statuses: STATUSES };
}

// For the coach: what is ahead, in lines.
function aheadText(v) {
  if (!v || !v.upcoming.length) return 'RACES: none on his race calendar. If he asks about racing, say so and offer to add one (a race action).';
  const out = [`RACES AHEAD (his race calendar; A = the season is built around it, B = raced properly, C = training with a number on). Season clock: ${v.clock.name ? `${v.clock.name} in ${v.clock.weeks_out} weeks, so ${v.clock.word}` : v.clock.word}.`];
  for (const r of v.upcoming.slice(0, 8)) out.push(`${r.priority} · ${r.name} (${r.kind}) on ${tz.dayShort(r.date)} ${r.date.slice(0, 4)}, ${r.days_out === 0 ? 'TODAY' : r.days_out === 1 ? 'tomorrow' : r.days_out < 15 ? `in ${r.days_out} days` : `in ${r.weeks_out} weeks`}${r.location ? `, ${r.location}` : ''}${r.distance_mi ? `, ${r.distance_mi} mi` : ''}${r.climb_ft ? `, ${r.climb_ft} ft of climbing` : ''}${r.minutes ? `, about ${r.minutes} min` : ''}; ${r.status}${r.notes ? `; note: ${r.notes.slice(0, 140)}` : ''}`);
  return out.join('\n');
}

// ---- where to find races -----------------------------------------------------------------------------
// The calendars worth checking for Maryland and around it (researched 14 Nov 2026; each was opened and read).
const SOURCES = [
  { name: 'BikeReg', url: 'https://www.bikereg.com/events/', what: 'Where nearly every race in the region opens entry, all kinds, with each race\'s category list. The list below is read from it.' },
  { name: 'MABRA', url: 'https://www.mabra.org', what: 'The local association (MD, DC, northern VA, DE): the road series, the cyclocross calendar, time trials. The 2027 road calendar will land here first.' },
  { name: 'MABRA mailing list', url: 'https://groups.google.com/g/MABRA-USCF', what: 'Where promoters announce dates and changes before the entry pages exist.' },
  { name: 'USA Cycling event finder', url: 'https://usacycling.sport80.com/pub/e_locator/events/find?from_date=today&country_region=81', what: 'Sanctioned road and cyclocross dates as soon as the permit is filed (Poolesville 2027 showed here first).' },
  { name: 'Mid-Atlantic Super Series', url: 'https://www.masuperseries.com', what: 'Mountain bike cross-country and endurance; three rounds at Fair Hill, Maryland. Age classes 40 to 49.' },
  { name: 'RVA Racing', url: 'https://rvaracing.com', what: 'Virginia cyclocross, the Virginia cross-country series and gravel; masters 45 to 59 classes.' },
  { name: 'PA Cycling Association', url: 'https://pacycling.org/calendar/', what: 'Pennsylvania cyclocross (PACX) and road.' },
  { name: 'Mid-Atlantic time trial series', url: 'https://midatlantictimetrialseries.blogspot.com', what: 'Time trials (Church Creek, That Dam TT); masters 45+ classes.' },
  { name: 'Gran Fondo Maryland', url: 'https://www.granfondonationalseries.com/gran-fondo-maryland', what: 'Frederick, age-group ranked on timed climbs.' },
  { name: 'GFNY Maryland', url: 'https://maryland.gfny.com', what: 'Cambridge, on the Eastern Shore: flat, fast, age-group ranked.' }
];

// BikeReg's event search answers without a key. It is asked at most twice a day and what it said is kept.
const FOUND_KEY = 'races-found', FOUND_TTL = 12 * 3600e3, STATES = 'MD,VA,DC,DE,PA,WV,NJ', REACH_MI = 210;
const brDate = v => { const m = /Date\((\d+)/.exec(String(v || '')); return m ? tz.keyOf(new Date(+m[1])) : null; };
const milesBetween = (a, b) => { const R = 3958.8, r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2; return Math.round(2 * R * Math.asin(Math.sqrt(h))); };
const NOT_EVENTS = /^(club membership|cycling camp|gift card|virtual|track|special event|merchandise|donation)$/i, RIDES = /^(recreational|bike tour)$/i;
function kindFromTypes(types, name) {
  const t = (types || []).join(' | ').toLowerCase();
  return /cyclocross/.test(t) ? 'cyclocross' : /mountain bike|mtb/.test(t) ? 'mountain bike' : /gravel/.test(t) ? 'gravel' : /gran fondo/.test(t) ? 'gran fondo'
    : /criterium/.test(t) ? 'criterium' : /time trial/.test(t) ? 'time trial' : /road race/.test(t) ? 'road race' : /hill climb/.test(t) ? 'hill climb' : kindOf(name);
}
// the fields a man of his age can enter as a master: "Masters 40+", "Men 45-59", "Cat 1/2/3 Men 40-49"; not 50+, not the women's
function mastersFor(categories, age) {
  const out = [];
  for (const c of categories || []) { const n = String(c.CategoryName || c.name || '');
    if (/wom[ae]n|female|girls?|junior|youth|kids?|\bw\s?\d\d/i.test(n)) continue;
    const plus = /\b(\d\d)\s*\+/.exec(n), span = /\b(\d\d)\s*(?:-|to)\s*(\d\d)\b/.exec(n);
    const fits = plus ? (+plus[1] >= 30 && +plus[1] <= age) : span ? (+span[1] >= 30 && +span[1] <= age && +span[2] >= age) : false;
    if (fits) out.push({ name: n.slice(0, 70), start: /^\d\d:\d\d/.test(String(c.StartTime || '')) ? String(c.StartTime).slice(0, 5) : null, fee: Number(c.EntryFee) > 0 ? Number(c.EntryFee) : null });
  }
  return out.slice(0, 4);
}
// one BikeReg event as the page shows it (pure); null for what is not an event to ride (a club membership, a camp)
function shape(e, home, age) {
  const types = (e.EventTypes || []).map(String), real = types.filter(t => !NOT_EVENTS.test(t));
  // not something to enter and ride: a membership, a series pass, a camp, a school league
  if (/membership|series registration|season pass|\bcamp\b|\bNICA\b|skills sessions?|high school|\bVAHS\b|teen trail|girls riding|volunteer/i.test(String(e.EventName || ''))) return null;
  const date = brDate(e.EventDate); if (!date || !e.EventName || (types.length && !real.some(t => !/^(club membership|cycling camp|gift card|virtual|merchandise|donation)$/i.test(t)))) return null;
  if (types.some(t => /^(club membership|cycling camp|gift card|virtual)$/i.test(t)) && !types.some(t => /cyclocross|mountain|gravel|fondo|road|criterium|time trial|recreational|tour|enduro|hill/i.test(t))) return null;
  const lat = Number(e.Latitude), lon = Number(e.Longitude), here = Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon } : null;
  const miles = here && home ? milesBetween(home, here) : null, kind = kindFromTypes(types, e.EventName);
  const ride = !/cyclocross|mountain|gravel|fondo|road race|criterium|time trial|enduro|hill/i.test(types.join(' ')) && types.some(t => RIDES.test(t));
  return { id: 'br' + e.EventId, name: String(e.EventName).trim().slice(0, 120), date, end_date: brDate(e.EventEndDate) !== date ? brDate(e.EventEndDate) : null,
    where: [e.EventCity, e.EventState].filter(Boolean).join(', '), state: e.EventState || '', kind, ride, miles,
    // a straight line is shorter than the road: about 1.3 times it, at 50 mph, to the nearest quarter hour
    drive_h: miles != null ? Math.max(0.25, Math.round(miles * 1.3 / 50 * 4) / 4) : null,
    url: String(e.EventUrl || e.EventPermalink || '').replace(/^http:/i, 'https:'), series: types.filter(t => /super series|mabra|rva racing|championship series|pennsylvania cycling/i.test(t)).slice(0, 2),
    masters: mastersFor(e.Categories, age || 48), fields: (e.Categories || []).length,
    reg_open: brDate(e.RegOpenDate), reg_close: brDate(e.RegCloseDate) };
}
async function fetchFound(today) {
  const all = [], until = tz.shiftKey(today, 420);
  for (let page = 0; page < 4; page++) {
    const r = await fetch(`https://www.bikereg.com/api/search?states=${STATES}&startdate=${today}&enddate=${until}&startpage=${page}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error('BikeReg answered ' + r.status);
    const j = await r.json(), list = j.MatchingEvents || []; all.push(...list);
    if (list.length < 100) break;
  }
  return all;
}
// The races within reach, soonest first. From the kept copy when it is under 12 hours old; a failed read keeps the old one.
async function find(q) {
  const today = tz.todayKey(), kept = await getJSON(FOUND_KEY, null).catch(() => null);
  let data = kept, note = null;
  if (!kept || !kept.events || Date.now() - (kept.at || 0) > FOUND_TTL || (q && q.fresh)) {
    try {
      let home = null, age = 48;
      try { const cs = await require('./commute').settings(); home = cs && cs.home && Number.isFinite(+cs.home.lat) && Number.isFinite(+cs.home.lon) ? { lat: +cs.home.lat, lon: +cs.home.lon } : null; } catch (e) { home = null; }
      try { age = (await require('./body').stored()).age || 48; } catch (e) { age = 48; }
      const events = (await fetchFound(today)).map(e => shape(e, home, age)).filter(Boolean);
      data = { at: Date.now(), home: !!home, events }; await setJSON(FOUND_KEY, data).catch(() => {});
    } catch (e) { if (!kept) throw e; note = 'BikeReg could not be reached just now; this is the list as last read.'; }
  }
  const mine = (await db()).races, on = new Set(mine.map(r => r.name.toLowerCase() + '|' + r.date));
  const kind = q && KINDS.includes(q.kind) ? q.kind : null;
  const events = (data.events || []).filter(e => e.date >= today && (e.miles == null || e.miles <= REACH_MI) && (!kind || e.kind === kind) && (q && q.rides ? true : !e.ride))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.miles || 0) - (b.miles || 0))
    .map(e => Object.assign({}, e, { on_calendar: on.has(e.name.toLowerCase() + '|' + e.date) }));
  return { at: data.at, from: 'BikeReg', note, reach_miles: REACH_MI, counts: KINDS.reduce((a, k) => { const n = (data.events || []).filter(e => e.date >= today && !e.ride && (e.miles == null || e.miles <= REACH_MI) && e.kind === k).length; if (n) a[k] = n; return a; }, {}), events };
}

async function db() { const d = await getJSON(KEY, { races: [] }); d.races = Array.isArray(d.races) ? d.races : []; return d; }
async function report() { return Object.assign(view((await db()).races, tz.todayKey()), { sources: SOURCES }); }
async function add(body) { const d = await db(); const r = clean(body, null); d.races.push(r); await setJSON(KEY, d); return r; }
async function update(id, body) {
  const d = await db(), i = d.races.findIndex(r => r.id === id);
  if (i < 0) { const e = new Error('no such race'); e.status = 404; throw e; }
  d.races[i] = clean(body, d.races[i]); await setJSON(KEY, d); return d.races[i];
}
async function remove(id) { const d = await db(), n = d.races.length; d.races = d.races.filter(r => r.id !== id); if (d.races.length === n) return false; await setJSON(KEY, d); return true; }
// the race the season is built around, for race.js (name, date, and what it is)
async function target() { const v = await report(); return v.target; }

function attach(app) {
  const wrap = fn => async (req, res) => { if (!auth(req, res)) return; try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/races', wrap(() => report()));
  app.get('/races/find', wrap(req => find({ kind: String((req.query || {}).kind || ''), fresh: (req.query || {}).fresh === '1', rides: (req.query || {}).rides === '1' })));
  app.post('/races', wrap(async req => ({ ok: true, race: await add(req.body) })));
  app.put('/races/:id', wrap(async req => ({ ok: true, race: await update(req.params.id, req.body) })));
  app.delete('/races/:id', wrap(async req => ({ ok: await remove(req.params.id) })));
}

module.exports = { attach, clean, view, aheadText, kindOf, phaseOf, report, add, update, remove, target, find, shape, mastersFor, kindFromTypes, SOURCES, KINDS, STATUSES };
