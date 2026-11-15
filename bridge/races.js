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

async function db() { const d = await getJSON(KEY, { races: [] }); d.races = Array.isArray(d.races) ? d.races : []; return d; }
async function report() { return view((await db()).races, tz.todayKey()); }
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
  app.post('/races', wrap(async req => ({ ok: true, race: await add(req.body) })));
  app.put('/races/:id', wrap(async req => ({ ok: true, race: await update(req.params.id, req.body) })));
  app.delete('/races/:id', wrap(async req => ({ ok: await remove(req.params.id) })));
}

module.exports = { attach, clean, view, aheadText, kindOf, phaseOf, report, add, update, remove, target, KINDS, STATUSES };
