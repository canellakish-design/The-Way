// ============================================================
// planner.js — the coach builds the week (Harry, 15 Nov 2026: "I want the coach to be able to build this schedule
// rather than me working with you to build it … if I want to change the model of training like we just did from
// single sessions a day to double sessions a day, it would be able to do that").
//
// Two things live here.
//   The training model: how his riding week is shaped, in a handful of settings he changes by telling the coach.
//     base            'double': a base day is two one-hour Zone 1 rides, hours apart
//                     'single': a base day is one ride (single_minutes)
//     base_minutes    riding on a base day (120). With only one free stretch in the day the two hours are one ride;
//                     when that one ride would have to be on the trainer for the weather, it is short_minutes (60)
//     long_minutes    the one longer ride, on a day that is mostly free (long_free_min of daylight in one stretch)
//     vo2_days        the days of the week that are VO2 days (Tuesday and Friday); VO2 stays VO2
//     apart_min       how far apart two rides in a day start (four hours)
//   The planner: a week laid out from that model around what the calendar really holds. For each day from today:
//     a rest day (all three classes) and a day away (a drive of 90 minutes or more) take no ride;
//     a VO2 day takes the VO2 session in its first free stretch;
//     the day with the most free daylight, when it has five hours of it, takes the long ride;
//     every other day is a base day, laid out as the model says, in the free time between the fixed things, the
//     lifts and anything he has already ridden; each ride is outside when its hour is light and the forecast is
//     good (where.js: 50°F or warmer, grading B or better), else on the trainer in the pain cave.
//   Lifts are not moved here: the ones on the calendar are worked around, and lifts.js places the missing ones.
//   A ride with a place of its own, a mountain bike session and anything started or done are left as they are.
//
// Nothing is written until he says yes. The plan is laid out and kept (planner-proposal), shown, and the same
// plan is what a yes writes: planned rides are changed in place where they can be, added, and the ones the new
// week has no use for are taken off.
//
//   GET  /planner/model                  the model, and its words
//   PUT  /planner/model                  { base?, base_minutes?, single_minutes?, short_minutes?, long_minutes?, vo2_days? }
//   GET  /planner/week?from=&changes=    the week laid out (not written): days, rides, what would change
//   POST /planner/apply                  { id } writes the plan that was laid out with that id
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const MODEL_KEY = 'training-model', PROPOSAL_KEY = 'planner-proposal';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const Z1_LENGTHS = [60, 75, 90, 105, 120, 135, 150];
const DEFAULT_MODEL = { base: 'double', base_minutes: 120, single_minutes: 90, short_minutes: 60, long_minutes: 150, long_free_min: 300, vo2_days: [2, 5], apart_min: 240, since: null };
const AWAY_DRIVE_MIN = 90, PAD_BEFORE = 20, PAD_AFTER = 15, HARD_GAP = 180, VO2_MIN = 51;
const snap = m => Z1_LENGTHS.reduce((a, b) => Math.abs(b - m) < Math.abs(a - m) ? b : a, 60);
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const toHM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const r5 = m => Math.ceil(m / 5) * 5;
const mondayOf = key => tz.shiftKey(key, -((new Date(key + 'T12:00:00Z').getUTCDay() + 6) % 7));
const dowOf = key => new Date(key + 'T12:00:00Z').getUTCDay();

// ---- the model (pure) ----
function cleanModel(m) {
  const x = Object.assign({}, DEFAULT_MODEL, m || {});
  const n = (v, lo, hi, d) => Number.isFinite(+v) && +v >= lo && +v <= hi ? Math.round(+v) : d;
  return { base: x.base === 'single' ? 'single' : 'double', base_minutes: snap(n(x.base_minutes, 60, 150, 120)), single_minutes: snap(n(x.single_minutes, 60, 150, 90)),
    short_minutes: snap(n(x.short_minutes, 60, 90, 60)), long_minutes: snap(n(x.long_minutes, 90, 150, 150)), long_free_min: n(x.long_free_min, 180, 600, 300),
    vo2_days: [...new Set((Array.isArray(x.vo2_days) ? x.vo2_days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort(), apart_min: n(x.apart_min, 120, 480, 240), since: x.since || null };
}
// "base=double; hours=2; long=150; vo2=Tue,Fri" (what the coach writes from his words) → the settings to change
function parseChanges(text) {
  const out = {};
  for (const part of String(text || '').split(/[;\n]/)) {
    const m = /^\s*([a-z0-9_ ]+?)\s*[=:]\s*(.+?)\s*$/i.exec(part); if (!m) continue;
    const k = m[1].toLowerCase().replace(/\s+/g, '_'), v = m[2].toLowerCase();
    const mins = () => { const h = /^([\d.]+)\s*h/.exec(v); return h ? Math.round(+h[1] * 60) : parseInt(v, 10); };
    if (k === 'base' || k === 'mode') { if (/double|two|split|2/.test(v)) out.base = 'double'; else if (/single|one|1/.test(v)) out.base = 'single'; }
    else if (k === 'hours') out.base_minutes = Math.round(parseFloat(v) * 60);
    else if (k === 'base_minutes' || k === 'day') out.base_minutes = mins();
    else if (k === 'single' || k === 'single_minutes') out.single_minutes = mins();
    else if (k === 'short' || k === 'short_minutes') out.short_minutes = mins();
    else if (k === 'long' || k === 'long_minutes') out.long_minutes = mins();
    else if (k === 'apart' || k === 'apart_min') out.apart_min = /h/.test(v) ? Math.round(parseFloat(v) * 60) : parseInt(v, 10);
    else if (k === 'vo2' || k === 'vo2_days') out.vo2_days = /none|no\b|0/.test(v) ? [] : DOW.map((d, i) => new RegExp('\\b' + d.toLowerCase()).test(v) ? i : -1).filter(i => i >= 0);
  }
  return out;
}
// a day set by hand for one week: "2026-11-20=long:150@14:00; 2026-11-22=off" → { date: { kind, minutes, time } }
function parseOverrides(text) {
  const out = {};
  for (const part of String(text || '').split(/[;\n]/)) {
    const m = /^\s*(\d{4}-\d{2}-\d{2})\s*[=:]\s*(off|rest|vo2|base|double|single|long)(?:\s*:\s*(\d+))?(?:\s*@\s*(\d{1,2}:\d{2}))?\s*$/i.exec(part); if (!m) continue;
    out[m[1]] = { kind: m[2].toLowerCase() === 'rest' ? 'off' : m[2].toLowerCase(), minutes: m[3] ? snap(+m[3]) : null, time: m[4] ? toHM(toMin(m[4])) : null };
  }
  return out;
}
function modelWords(m) {
  const x = cleanModel(m), h = n => n % 60 ? `${n} minutes` : n === 60 ? 'one hour' : `${n / 60} hours`;
  return `A base day is ${x.base === 'double' ? `${h(x.base_minutes)} of Zone 1 as two rides of ${h(Math.round(x.base_minutes / 2))} each, at least ${h(x.apart_min)} apart; with only one free stretch in the day it is one ride of ${h(x.base_minutes)}, or ${h(x.short_minutes)} when the weather would put it on the trainer` : `one Zone 1 ride of ${h(x.single_minutes)}`}. `
    + `A day that is mostly free (${h(x.long_free_min)} of daylight in one stretch) takes the week's longer ride, ${h(x.long_minutes)}. `
    + `${x.vo2_days.length ? `VO2 days: ${x.vo2_days.map(d => DOW[d]).join(' and ')}; VO2 stays VO2` : 'No fixed VO2 days'}. A rest day (all three classes) and a day away take no ride. Each ride is outside when it is light and the forecast is good, else on the trainer.`;
}

// ---- the day's free time (pure) ----
// blocks: [[start, end]] of what cannot move; → [[start, end]] a ride may fill, between earliest and latest
function freeOf(blocks, earliest, latest) {
  const busy = (blocks || []).map(b => [b[0] - (b[2] != null ? b[2] : PAD_BEFORE), b[1] + (b[3] != null ? b[3] : PAD_AFTER)]).sort((a, b) => a[0] - b[0]);
  const out = []; let cur = earliest;
  for (const [s, e] of busy) { if (s > cur) out.push([cur, Math.min(s, latest)]); cur = Math.max(cur, e); if (cur >= latest) break; }
  if (cur < latest) out.push([cur, latest]);
  return out.map(([s, e]) => [r5(s), Math.floor(e / 5) * 5]).filter(([s, e]) => e - s >= 30);
}
const fits = (free, len) => free.filter(([s, e]) => e - s >= len);
const cut = (free, s, e) => free.flatMap(([a, b]) => e <= a || s >= b ? [[a, b]] : [[a, s - PAD_BEFORE], [e + PAD_AFTER, b]].filter(([x, y]) => y - x >= 30));

// ---- the week (pure) ----
// days: [{ date, past, rest, away, blocks: [[s, e, padBefore?, padAfter?]], earliest, latest, sunrise, sunset, weather(start, end) → why|null|undefined,
//          kept_min (riding already on the day that stays), heavy: [[s, e]] (Legs or Pull, kept three hours from a hard ride) }]
// → [{ date, kind, rides: [{ time, minutes, type: 'z1'|'vo2', outside, indoor_why }], note }]
function buildWeek(days, model, overrides) {
  const M = cleanModel(model), O = overrides || {};
  const light = (d, s, e) => d.sunrise != null && d.sunset != null ? s >= d.sunrise + 30 && e <= d.sunset - 15 : (s >= 9 * 60 && e <= 16 * 60);
  const outsideWhy = (d, s, e) => { if (!light(d, s, e)) return 'dark'; const w = d.weather ? d.weather(s, e) : undefined; return w === undefined ? 'no forecast yet' : w; };
  const open = d => !d.past && !d.rest && !d.away;
  // the long ride goes to the open day with the most free daylight, when it has enough of it (and is not a VO2 day)
  const dayLight = d => { const lo = (d.sunrise != null ? d.sunrise : 7 * 60) + 30, hi = (d.sunset != null ? d.sunset : 17 * 60) - 15; return Math.max(0, ...freeOf(d.blocks, Math.max(d.earliest, lo), Math.min(d.latest, hi)).map(([s, e]) => e - s)); };
  const forced = Object.keys(O).filter(k => O[k].kind === 'long');
  let longDay = forced[0] || null;
  if (!longDay) { const c = days.filter(d => open(d) && !O[d.date] && !M.vo2_days.includes(dowOf(d.date)) && !(d.kept_min >= 60)).map(d => ({ d, l: dayLight(d) })).filter(x => x.l >= M.long_free_min).sort((a, b) => b.l - a.l)[0]; longDay = c ? c.d.date : null; }
  return days.map(d => {
    const o = O[d.date] || null, out = { date: d.date, kind: 'base', rides: [], note: '' };
    if (d.past) return Object.assign(out, { kind: 'past', note: 'gone' });
    if (o && o.kind === 'off') return Object.assign(out, { kind: 'off', note: 'set as a day off' });
    if (d.rest && !o) return Object.assign(out, { kind: 'rest', note: `rest day (${d.rest})` });
    if (d.away && !o) return Object.assign(out, { kind: 'away', note: `away (${d.away}): no ride placed; say where and when if you will ride on the way` });
    // what is already planned keeps its time when that time is still good (7:00a at the earliest), so a week that
    // is laid out again does not shuffle rides for nothing. d.prefer: [{ type, time }]
    const pref = (type, nth) => { const p = (d.prefer || []).filter(x => x.type === type)[nth || 0]; return p && toMin(p.time) != null ? toMin(p.time) : null; };
    const first = Math.min(d.earliest, ...(d.prefer || []).map(x => toMin(x.time)).filter(t => t != null && t >= 7 * 60));
    let free = freeOf(d.blocks, first, d.latest);
    const place = (len, at, type, minStart) => {   // at: a start to be nearest to; → the ride, or null
      const slots = fits(free, len); if (!slots.length) return null;
      let best = null;
      for (const [s, e] of slots) for (let t = s; t + len <= e; t += 5) { if (minStart != null && t < minStart) continue; const dist = Math.abs(t - at); if (!best || dist < best.dist) best = { t, dist }; }
      if (!best) return null;
      const why = type === 'vo2' ? 'on the trainer' : outsideWhy(d, best.t, best.t + len);
      free = cut(free, best.t, best.t + len);
      return { time: toHM(best.t), minutes: len, type, outside: !why, indoor_why: why || null };
    };
    // a long or single ride looks for a start that can be outside before it settles for the trainer
    const placeOut = (len, at) => {
      const slots = fits(free, len); let best = null;
      for (const [s, e] of slots) for (let t = s; t + len <= e; t += 15) { if (outsideWhy(d, t, t + len)) continue; const dist = Math.abs(t - at); if (!best || dist < best.dist) best = { t, dist }; }
      if (!best) return null;
      free = cut(free, best.t, best.t + len);
      return { time: toHM(best.t), minutes: len, type: 'z1', outside: true, indoor_why: null };
    };
    const kind = o ? (o.kind === 'double' || o.kind === 'single' ? 'base' : o.kind) : M.vo2_days.includes(dowOf(d.date)) ? 'vo2' : d.date === longDay ? 'long' : 'base';
    out.kind = kind;
    if (kind === 'vo2') {
      // three hours clear of a heavy lower-body lift already on the day
      for (const [s, e] of d.heavy || []) free = cut(free, s - HARD_GAP + PAD_BEFORE, e + HARD_GAP - PAD_AFTER);
      const r = place(VO2_MIN, o && o.time ? toMin(o.time) : pref('vo2') != null ? pref('vo2') : d.earliest, 'vo2');
      if (r) out.rides.push(r); else out.note = 'no room for the VO2 session';
      return out;
    }
    if (kind === 'long') {
      const len = (o && o.minutes) || M.long_minutes, mid = o && o.time ? toMin(o.time) : 12 * 60 - Math.round(len / 2);
      const r = (o && o.time ? place(len, toMin(o.time), 'z1') : placeOut(len, mid)) || place(len, mid, 'z1');
      if (r) { out.rides.push(r); out.note = 'the longer ride: the day is mostly free'; } else out.note = `no room for ${len} minutes`;
      return out;
    }
    // a base day
    const want = Math.max(0, ((o && o.minutes) || (M.base === 'double' || (o && o.kind === 'double') ? M.base_minutes : M.single_minutes)) - (d.kept_min || 0));
    if (want < 45) { out.note = d.kept_min ? 'the riding already on the day covers it' : ''; return out; }
    const two = (o ? o.kind === 'double' : M.base === 'double') && want >= 90, half = snap(Math.round(want / 2));
    if (two) {
      // the first hour as early as the day allows (or where it already is), the second at least apart_min later,
      // late afternoon by choice
      const s1 = fits(free, half)[0];
      if (s1) { const a = pref('z1', 0) != null && fits(free, half).some(([x, y]) => pref('z1', 0) >= x && pref('z1', 0) + half <= y) ? pref('z1', 0) : s1[0];
        const snapshot = free.map(x => x.slice()), r1 = place(half, a, 'z1'), from = toMin(r1.time) + M.apart_min;
        const r2 = place(half, pref('z1', 1) != null && pref('z1', 1) >= from ? pref('z1', 1) : Math.max(from, 16 * 60 + 30), 'z1', from);
        if (r1 && r2) { out.rides.push(r1, r2); return out; }
        free = snapshot; }   // no second stretch far enough from the first: the day has one free stretch
      // one free stretch: the two hours together, outside if that can be, as much of them as fits; when it would have to
      // be on the trainer for the weather or the light, it is the short one
      const whole = snap(want);
      for (const len of Z1_LENGTHS.filter(x => x <= whole).reverse()) { const r = placeOut(len, 13 * 60);
        if (r) { out.rides.push(r); out.note = len === whole ? 'one free stretch in the day: the two hours as one ride' : `one free stretch in the day, with room for ${len} minutes`; return out; } }
      const short = place(Math.min(whole, M.short_minutes), 13 * 60, 'z1');
      if (short) { out.rides.push(short); out.note = `one free stretch in the day, and it is on the trainer (${short.indoor_why}): ${short.minutes} minutes`; return out; }
      out.note = 'no free hour in the day';
      return out;
    }
    const len = snap(want), r = (o && o.time ? place(len, toMin(o.time), 'z1') : placeOut(len, 12 * 60)) || place(len, 12 * 60, 'z1') || place(60, 12 * 60, 'z1');
    if (r) out.rides.push(r); else out.note = 'no free hour in the day';
    return out;
  });
}

// ---- what the plan changes (pure) ----
// have: the planned rides that may be replaced [{ id, date, time, minutes, name, sport }]; plan: buildWeek's days
// → ops: [{ op: 'keep'|'change'|'add'|'remove', date, id?, ride? , was? }]
function diff(plan, have) {
  const ops = [];
  for (const day of plan) {
    if (day.kind === 'past') continue;
    const mine = (have || []).filter(w => w.date === day.date).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
    const want = day.rides.slice().sort((a, b) => a.time.localeCompare(b.time)), used = new Set();
    for (const r of want) {
      // the planned ride of the same kind first, then any
      const isVo2 = w => /vo2|40\s*\/\s*20/i.test(w.name || '');
      const m = mine.find(w => !used.has(w) && isVo2(w) === (r.type === 'vo2')) || mine.find(w => !used.has(w));
      if (!m) { ops.push({ op: 'add', date: day.date, ride: r }); continue; }
      used.add(m);
      const same = m.time === r.time && m.minutes === r.minutes && isVo2(m) === (r.type === 'vo2') && (r.type === 'vo2' || (m.sport === 'Ride') === r.outside);
      ops.push({ op: same ? 'keep' : 'change', date: day.date, id: m.id, ride: r, was: { time: m.time, minutes: m.minutes, name: m.name } });
    }
    for (const w of mine) if (!used.has(w)) ops.push({ op: 'remove', date: day.date, id: w.id, was: { time: w.time, minutes: w.minutes, name: w.name } });
  }
  return ops;
}
const rideName = r => r.type === 'vo2' ? 'VO2 40/20s' : `Zone 1, ${r.minutes} min`;
function lines(plan, ops, lifts) {
  const out = [];
  for (const day of plan) {
    if (day.kind === 'past') continue;
    const label = tz.dayShort(day.date), L = (lifts || []).filter(l => l.date === day.date).map(l => `${l.name} ${tz.hm12(l.time)}`);
    const rides = day.rides.map(r => `${rideName(r)} at ${tz.hm12(r.time)} (${r.type === 'vo2' ? 'trainer' : r.outside ? 'outside' : 'trainer: ' + r.indoor_why})`);
    const gone = ops.filter(o => o.op === 'remove' && o.date === day.date).map(o => `comes off: ${o.was.name}${o.was.time ? ' ' + tz.hm12(o.was.time) : ''}`);
    const things = rides.concat(L.map(x => 'lift ' + x)).join('; '), note = day.note ? day.note.replace(/^./, c => c.toUpperCase()) : '';
    out.push(`${label}: ${things && note ? things + '. ' + note : things || note || 'no ride'}${gone.length ? ` (${gone.join('; ')})` : ''}`);
  }
  return out;
}

// ---- reading the week ----
const KEPT = /mountain bike|\bmtb\b|race|gran fondo|event/i;
const isRideW = w => /ride/i.test(String(w.sport || ''));
const isLiftW = w => /weight|strength/i.test(String(w.sport || ''));
const minsOfW = w => Math.round(((w.steps || []).reduce((a, s) => a + (s.kind === 'repeat' ? (s.steps || []).reduce((b, x) => b + (x.dur_s || 0), 0) * (s.count || 1) : (s.dur_s || 0)), 0)) / 60) || 60;
async function model() { return cleanModel(await getJSON(MODEL_KEY, null).catch(() => null)); }
async function setModel(patch, words) {
  const cur = await model(), next = cleanModel(Object.assign({}, cur, patch || {}, { since: tz.todayKey() }));
  await setJSON(MODEL_KEY, Object.assign({}, next, { words: String(words || '').slice(0, 300) }));
  return next;
}
async function gather(weekOf) {
  const today = tz.todayKey(), p = tz.parts(new Date()), nowMin = p.h * 60 + p.mi;
  const mon = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(weekOf || '') ? weekOf : today), sun = tz.shiftKey(mon, 6);
  const ahead = Math.round((Date.parse(sun) - Date.parse(today)) / 864e5) + 1;
  const SW = require('./sleep-window');
  const [sched, rest, wx, R, store, cal] = await Promise.all([
    ahead > 0 ? require('./calendar').scheduleReport({ days: Math.min(ahead, 15), light: true }).catch(() => ({ days: [] })) : { days: [] },
    require('./classes').restDaysBetween(mon, sun).catch(() => ({})),
    require('./weather').outlook(mon, sun).catch(() => null),
    SW.get().catch(() => SW.DEFAULT_RULES),
    getJSON('plan-workouts', { workouts: {} }),
    require('./workouts').calendar(mon > today ? mon : today, sun).catch(() => ({ days: [] }))
  ]);
  const W = Object.values(store.workouts || {}).filter(w => w && w.date >= mon && w.date <= sun);
  const kept = w => !isRideW(w) || !!w.location || !!w.suggested || !!w.started_at || KEPT.test(w.name || '');
  const have = [], days = [], lifts = [];
  for (let k = mon; k <= sun; k = tz.shiftKey(k, 1)) {
    const sd = (sched.days || []).find(x => x.date === k), cd = (cal.days || []).find(x => x.date === k), fx = wx && wx.days && wx.days[k];
    const ev = ((sd && sd.events) || []).filter(e => !e.allDay && e.start_min != null && e.end_min > e.start_min && e.category !== 'training' && e.free !== true && e.attend !== 'no' && e.blocking !== false
      && ['work', 'coaching', 'commute', 'travel', 'family', 'busy', 'sleep'].includes(e.category));
    const drive = Math.max(0, ...ev.filter(e => e.category === 'commute').map(e => e.minutes || (e.end_min - e.start_min)));
    const blocks = ev.map(e => [e.start_min, e.end_min]), heavy = []; let keptMin = 0;
    for (const w of W.filter(x => x.date === k)) {
      const done = cd && (cd.planned || []).find(x => x.id === w.id && (x.logged || (x.compliance && x.compliance.pct > 0)));
      const s = toMin(w.time), len = minsOfW(w);
      if (isLiftW(w)) { lifts.push({ date: k, name: w.name, time: w.time }); if (s != null) { blocks.push([s, s + len, 15, 15]); if (/^(legs|pull)/i.test(w.name || '')) heavy.push([s, s + len]); } continue; }
      if (kept(w) || done) { if (s != null) blocks.push([s, s + len]); keptMin += len; continue; }
      have.push({ id: w.id, date: k, time: w.time || null, minutes: len, name: w.name, sport: w.sport });
    }
    // what was ridden today already stands, and its time is taken
    for (const r of (cd && cd.done) || []) { const s = toMin(r.time); if (s != null && !/weight|strength/i.test(r.type || '')) { blocks.push([s, s + (r.minutes || 60)]); if (!W.some(w => w.date === k && Math.abs((toMin(w.time) || 0) - s) < 45)) keptMin += r.minutes || 0; } }
    const earliest = Math.max(R.earliest_workout || 450, k === today ? r5(nowMin + 45) : 0), latest = (R.bed || 1350) - 120;
    const places = ev.map(e => String(e.location || '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(x => x.length > 8);
    const prefer = have.filter(w => w.date === k && w.time).sort((a, b) => a.time.localeCompare(b.time)).map(w => ({ type: /vo2|40\s*\/\s*20/i.test(w.name || '') ? 'vo2' : 'z1', time: w.time }));
    days.push({ date: k, past: k < today, rest: rest[k] || null, away: drive >= AWAY_DRIVE_MIN ? `a ${drive} min drive` : null, _drive: drive, _places: places, prefer, blocks, heavy, kept_min: keptMin, earliest, latest,
      sunrise: fx ? toMin(fx.sunrise) : null, sunset: fx ? toMin(fx.sunset) : null,
      weather: fx && fx.hours && fx.hours.length ? (s, e) => require('./where').badWeather(fx.hours, s, e) : null });
  }
  // a place that is a long drive away on one day is a long way away on the others too (two games in Somerset, NJ:
  // the Saturday has the drive there, the Sunday has none, and he is still in New Jersey)
  const far = new Map(); for (const d of days) if (d.away) for (const pl of d._places) far.set(pl, d._drive);
  for (const d of days) if (!d.away) { const hit = d._places.find(pl => far.has(pl)); if (hit) d.away = `at a place a ${far.get(hit)} min drive from home`; }
  // the week before, as it was planned: a week that asks for much more than the last is said to (the model is
  // applied as it stands; the size of the step is his to judge)
  const prevMon = tz.shiftKey(mon, -7), prevSun = tz.shiftKey(mon, -1);
  const prevMin = Object.values(store.workouts || {}).filter(w => w && w.date >= prevMon && w.date <= prevSun && isRideW(w)).reduce((a, w) => a + minsOfW(w), 0);
  return { mon, sun, today, days, have, lifts, prev_min: prevMin };
}
// The week laid out and kept, not written. o: { changes: "base=double; …" (tried, not saved), overrides: "2026-11-20=long:150@14:00" }
async function propose(weekOf, o) {
  o = o || {};
  const base = await model(), M = cleanModel(Object.assign({}, base, parseChanges(o.changes)));
  const G = await gather(weekOf), plan = buildWeek(G.days, M, parseOverrides(o.overrides)), ops = diff(plan, G.have);
  const keptMin = G.days.reduce((a, d) => a + (d.kept_min || 0), 0);
  const before = G.have.reduce((a, w) => a + w.minutes, 0) + keptMin, after = plan.reduce((a, d) => a + d.rides.reduce((b, r) => b + r.minutes, 0), 0) + keptMin;
  const step = G.prev_min > 0 ? Math.round((after - G.prev_min) / G.prev_min * 100) : null;
  const id = 'p_' + Date.now().toString(36);
  const out = { id, at: Date.now(), week_of: G.mon, to: G.sun, model: M, model_words: modelWords(M), tried: o.changes ? parseChanges(o.changes) : null,
    days: plan.filter(d => d.kind !== 'past'), ops, lines: lines(plan, ops, G.lifts), riding_min: { now_planned: before, this_plan: after, last_week_planned: G.prev_min || null },
    step_pct: step, step_note: step != null && step > 20 ? `This week asks for ${step}% more riding than last week's plan (${Math.round(after / 6) / 10} h against ${Math.round(G.prev_min / 6) / 10} h). A step of more than about 10 to 15% a week is a big one.` : null,
    changes: { add: ops.filter(x => x.op === 'add').length, change: ops.filter(x => x.op === 'change').length, remove: ops.filter(x => x.op === 'remove').length, keep: ops.filter(x => x.op === 'keep').length } };
  await keep(out);
  return out;
}
// the plans on the table: the last five laid out, newest first
async function table() { const t = await getJSON(PROPOSAL_KEY, null).catch(() => null); return t && Array.isArray(t.list) ? t.list : t && t.id ? [t] : []; }
async function keep(p) { const list = (await table()).filter(x => x.id !== p.id); list.unshift(p); await setJSON(PROPOSAL_KEY, { list: list.slice(0, 5) }).catch(() => {}); }
// by its id; with none, the newest one not yet written (and not older than a quarter hour)
async function proposal(id) { const list = await table(); if (id) return list.find(x => x.id === id) || null; const p = list.find(x => !x.applied_at); return p && Date.now() - p.at < 15 * 60000 ? p : null; }
// the body of a planned ride, from the library's session of that length, on the road or on the trainer
function bodyOf(r) {
  const { LIBRARY, notesFor } = require('./workout-library');
  if (r.type === 'vo2') { const l = LIBRARY.find(x => x.key === 'vo2-4020'); return { name: l.name, sport: l.sport, notes: l.notes, steps: l.steps }; }
  const l = LIBRARY.find(x => x.key === 'z1-' + r.minutes) || LIBRARY.find(x => x.key === 'z1-60'), sport = r.outside ? 'Ride' : 'VirtualRide';
  return { name: l.name, sport, notes: notesFor(l.notes, sport), steps: l.steps };
}
// A yes: the plan that was laid out with that id is written, one change after another.
async function apply(id) {
  const P = await proposal(id);
  if (!P) { const e = new Error('That plan is no longer on the table. Ask for the week again.'); e.status = 409; throw e; }
  if (Date.now() - P.at > 6 * 3600e3) { const e = new Error('That plan was laid out more than six hours ago and the day has moved on. Ask for the week again.'); e.status = 409; throw e; }
  if (P.applied_at) return { already: true, week_of: P.week_of, done: P.done || [] };
  const WK = require('./workouts'), done = [], failed = [], today = tz.todayKey();
  for (const o of P.ops.filter(x => x.op === 'remove')) { try { await WK.remove(o.id); done.push(`took off ${o.was.name}, ${tz.dayShort(o.date)}`); } catch (e) { failed.push(`${o.was.name} ${tz.dayShort(o.date)}: ${e.message}`); } }
  for (const o of P.ops.filter(x => x.op === 'change')) { try { await WK.update(o.id, Object.assign(bodyOf(o.ride), { date: o.date, time: o.ride.time })); done.push(`${rideName(o.ride)} ${tz.dayShort(o.date)} ${tz.hm12(o.ride.time)} (was ${o.was.name}${o.was.time ? ' ' + tz.hm12(o.was.time) : ''})`); } catch (e) { failed.push(`${o.was.name} ${tz.dayShort(o.date)}: ${e.message}`); } }
  for (const o of P.ops.filter(x => x.op === 'add')) {
    try { const w = await WK.create(Object.assign(bodyOf(o.ride), { date: o.date, time: o.ride.time })); done.push(`${rideName(o.ride)} ${tz.dayShort(o.date)} ${tz.hm12(o.ride.time)} (new)`);
      // onto the Garmin through intervals.icu, for the days it will be ridden soon
      if (w && w.id && o.date <= tz.shiftKey(today, 8)) await WK.send(w.id).catch(() => {}); }
    catch (e) { failed.push(`${rideName(o.ride)} ${tz.dayShort(o.date)}: ${e.message}`); }
  }
  await keep(Object.assign({}, P, { applied_at: Date.now(), done, failed }));
  try { require('./voice').contextStale && require('./voice').contextStale(); } catch (e) { /* the coach reads it fresh next time */ }
  return { applied: true, week_of: P.week_of, done, failed, kept: P.ops.filter(x => x.op === 'keep').length };
}

function attach(app) {
  const wrap = fn => async (req, res) => { if (!auth(req, res)) return; try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
  app.get('/planner/model', wrap(async () => { const m = await model(); return { model: m, words: modelWords(m) }; }));
  app.put('/planner/model', wrap(async req => { const m = await setModel(req.body || {}, (req.body || {}).words); return { model: m, words: modelWords(m) }; }));
  app.get('/planner/week', wrap(req => propose((req.query || {}).from, { changes: (req.query || {}).changes, overrides: (req.query || {}).overrides })));
  app.post('/planner/apply', wrap(req => apply((req.body || {}).id)));
}

module.exports = { attach, model, setModel, propose, apply, proposal, gather, buildWeek, diff, lines, freeOf, cleanModel, parseChanges, parseOverrides, modelWords, DEFAULT_MODEL, mondayOf };
