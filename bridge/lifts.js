// ============================================================
// lifts.js — the weight training: Mike Matthews' five-day plan (Bigger
// Leaner Stronger), logged set by set, with each week's five days placed
// around the riding and the coaching calendar.
//
// The plan's shape is the book's: five workouts, each once every seven
// days, in this order when nothing else decides it: Push; Pull and calves;
// Upper body and core; Legs; Upper body and core. Each is two or three
// major muscle groups, nine to twelve hard sets of 4 to 6 reps on the big
// lifts (about 80 to 85% of a one-rep max), 6 to 8 or 8 to 10 on the
// smaller ones, two to three minutes between hard sets, hardest lift
// first. Progression is Matthews' double progression: when a hard set
// reaches the top of its range, the next set (here, the next session) adds
// weight, ten pounds on the Bowflex and the next bell up for a kettlebell,
// five pounds on the small lifts, and the reps go back to the bottom of
// the range; a set that cannot reach the bottom of the range drops the
// weight a step. Eight weeks on, then a deload week.
//
// The gear is a kettlebell set and a Bowflex, so each lift here is the
// book's lift on that gear; the barbell original is in the note, for a gym.
//
// Where the five land in the week: legs goes on the day before a day off
// the bike or a long coaching day (so the soreness falls on a day with no
// ride), or on a long coaching day itself (no ride anyway). The two days
// with no lift are the two biggest riding days. The other four fill the
// rest in the book's order, with the pull day (deadlift) kept a day clear of
// the legs day (Romanian deadlift) when the week allows.
//   GET  /lifts                 templates, this week's placement, each exercise's target, history
//   POST /lifts                 { template, date?, exercises:[{name, sets:[{reps, lb}]}], notes? }
//   POST /lifts/schedule        { time? } puts this week's five on the calendar as planned workouts
//   DELETE /lifts/:id
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const BELLS = [18, 26, 35, 44, 53, 62, 70, 80, 88];     // the common kettlebell sizes, in pounds
// ex(name, sets, lo, hi, kind, start, note, inc): kind bell | bowflex | reps | time; inc is the step on the Bowflex
const ex = (name, sets, lo, hi, kind, start, note, inc) => ({ name, sets, reps_lo: lo, reps_hi: hi, kind, start_lb: start, note: note || '', inc: inc || (kind === 'bowflex' ? 10 : 0), rest_min: hi <= 6 ? 3 : hi <= 8 ? 2.5 : 2 });
const TEMPLATES = [
  { key: 'push', name: 'Push', short: 'Push', minutes: 55, order: 1,
    why: 'Chest, shoulders and triceps. The book: bench, incline bench, dumbbell bench, triceps pushdown.',
    exercises: [
      ex('Bowflex chest press', 3, 4, 6, 'bowflex', 110, 'The book\'s barbell bench press. Shoulder blades pinned, bar to the chest.'),
      ex('Bowflex incline press', 3, 4, 6, 'bowflex', 90, 'Incline bench. Bench at 30 degrees if the Bowflex seat allows.'),
      ex('Kettlebell floor press', 3, 4, 6, 'bell', 44, 'Two bells, the dumbbell bench press. Elbows at 45 degrees.'),
      ex('Bowflex triceps pushdown', 3, 6, 8, 'bowflex', 50, 'Elbows pinned to the sides.', 5)
    ] },
  { key: 'pull', name: 'Pull and calves', short: 'Pull', minutes: 55, order: 2,
    why: 'Back and biceps, calves at the end. The book: deadlift, barbell row, lat pulldown, calf raise.',
    exercises: [
      ex('Kettlebell deadlift', 3, 4, 6, 'bell', 70, 'Two bells, or the heaviest one between the feet. The barbell deadlift. Hips back, bar close, stand tall.'),
      ex('Bowflex seated row', 3, 4, 6, 'bowflex', 110, 'Barbell row. Pull to the belly, squeeze the blades, no shrug.'),
      ex('Bowflex lat pulldown', 3, 4, 6, 'bowflex', 110, 'Chest up, elbows down and back.'),
      ex('Standing calf raise', 3, 8, 10, 'bell', 53, 'One bell in hand, toes on a step. Pause at the top and the bottom.', 0)
    ] },
  { key: 'upper-1', name: 'Upper body and core', short: 'Upper 1', minutes: 50, order: 3,
    why: 'The book\'s first upper day: close-grip bench, barbell row, seated dumbbell press, then core.',
    exercises: [
      ex('Bowflex close-grip press', 3, 4, 6, 'bowflex', 100, 'Hands shoulder width, elbows tucked. Close-grip bench press.'),
      ex('Kettlebell one-arm row', 3, 4, 6, 'bell', 62, 'Each side. Hand on the bench, pull to the hip.'),
      ex('Kettlebell seated press', 3, 4, 6, 'bell', 44, 'Two bells, seated. The dumbbell shoulder press. Ribs down.'),
      ex('Hanging knee raise', 3, 10, 15, 'reps', 0, 'Or lying leg raise. Slow down, no swing.')
    ] },
  { key: 'legs', name: 'Legs', short: 'Legs', minutes: 55, order: 4,
    why: 'The book\'s leg day: squat, leg press, Romanian deadlift, calf raise. The cycling day of the five: placed the day before a day off the bike or on a long coaching day.',
    exercises: [
      ex('Kettlebell front squat', 3, 4, 6, 'bell', 53, 'Two bells in the rack. The barbell back squat. Below parallel, knees out.'),
      ex('Bulgarian split squat', 3, 6, 8, 'bell', 35, 'Each leg, rear foot on the bench, a bell in each hand. The leg press.'),
      ex('Kettlebell Romanian deadlift', 3, 4, 6, 'bell', 70, 'Two bells. Hinge until the hamstrings pull, no lower; the bells stay on the thighs.'),
      ex('Standing calf raise', 3, 8, 10, 'bell', 53, 'One bell in hand, toes on a step.', 0)
    ] },
  { key: 'upper-2', name: 'Upper body and core', short: 'Upper 2', minutes: 50, order: 5,
    why: 'The book\'s second upper day: overhead press, dumbbell row, curls, then core.',
    exercises: [
      ex('Bowflex shoulder press', 3, 4, 6, 'bowflex', 80, 'The barbell overhead press. Glutes tight, press straight up.'),
      ex('Bowflex seated row', 3, 4, 6, 'bowflex', 110, 'Dumbbell row in the book; the row again here, to the belly.'),
      ex('Kettlebell curl', 3, 6, 8, 'bell', 26, 'One bell, both hands on the horns, or a bell in each hand. No swing.', 0),
      ex('Bowflex cable crunch', 3, 10, 12, 'bowflex', 60, 'Kneeling, crunch the ribs to the hips.', 5)
    ] }
];
const LEGACY = { 'lift-a': 'Lift A: hinge and push', 'lift-b': 'Lift B: squat and pull' };   // the two sessions this plan replaced
const nameOf = key => (TEMPLATES.find(t => t.key === key) || {}).name || LEGACY[key] || key;

const e1rm = (lb, reps) => lb > 0 && reps > 0 ? Math.round(lb * (1 + reps / 30)) : null;
function nextBell(lb) { const i = BELLS.findIndex(b => b > lb); return i < 0 ? lb + 10 : BELLS[i]; }
function prevBell(lb) { const below = BELLS.filter(b => b < lb); return below.length ? below[below.length - 1] : Math.max(0, lb - 10); }
function increment(def, lb) { return def.kind === 'bell' ? nextBell(lb) : def.kind === 'bowflex' ? lb + (def.inc || 10) : lb; }
function decrement(def, lb) { return def.kind === 'bell' ? prevBell(lb) : def.kind === 'bowflex' ? Math.max(0, lb - (def.inc || 10)) : lb; }

// The target for an exercise given the last time it was done (Matthews'
// double progression: a hard set at the top of the range adds weight, a set
// under the bottom of the range takes it off).
function target(def, last) {
  if (!last || !last.sets || !last.sets.length) return { lb: def.start_lb, reps: def.reps_lo, why: 'first time: a weight that makes the last rep hard at the bottom of the range', progress: false };
  const sets = last.sets.filter(s => s.reps > 0);
  const lb = Math.max(...sets.map(s => s.lb || 0));
  const topReps = Math.max(...sets.map(s => s.reps)), minReps = Math.min(...sets.map(s => s.reps));
  if (def.kind === 'time' || def.kind === 'reps') {
    const allTop = sets.length >= def.sets && sets.every(s => s.reps >= def.reps_hi);
    if (allTop) return { lb: 0, reps: Math.min(def.reps_hi + (def.kind === 'time' ? 15 : 2), def.reps_hi * 2), why: `every set reached ${def.reps_hi}: add ${def.kind === 'time' ? '15 seconds' : 'two reps'}`, progress: true };
    return { lb: 0, reps: Math.max(def.reps_lo, Math.min(def.reps_hi, minReps + 1)), why: `hold until every set reaches ${def.reps_hi}`, progress: false };
  }
  if (topReps >= def.reps_hi) return { lb: increment(def, lb), reps: def.reps_lo, why: `a set reached ${def.reps_hi} at ${lb} lb: up to ${increment(def, lb)}, back to ${def.reps_lo} reps`, progress: true };
  if (minReps < def.reps_lo && sets.length >= 2) return { lb: decrement(def, lb), reps: def.reps_lo, why: `a set fell to ${minReps} at ${lb} lb: back to ${decrement(def, lb)} and ${def.reps_lo} to ${def.reps_hi} reps`, progress: false, back: true };
  return { lb, reps: Math.min(def.reps_hi, minReps + 1), why: `${lb} lb again; the weakest set did ${minReps}, aim for ${Math.min(def.reps_hi, minReps + 1)}`, progress: false };
}

async function db() { return getJSON('lifts', { sessions: [] }); }

// ---- the week ---------------------------------------------------------
// days: [{ date, ride: {name, minutes, tss, hard} | null, coaching_min, long_coaching, off }]
// Returns the same days with .lift set to a template key or null, plus why.
const HARD = /vo2|40\s*\/\s*20|threshold|race|interval/i;
const LONG_COACHING_MIN = 4 * 60;
function placeWeek(days, o) {
  const opts = o || {};
  const d = days.map(x => Object.assign({}, x, { lift: null, why: '' }));
  const n = d.length;
  if (!n) return d;
  const load = x => x.ride ? (x.ride.tss || 0) + (x.ride.minutes || 0) / 3 + (x.ride.hard ? 40 : 0) : 0;
  // 1. legs: the day before a day off the bike (100) or a long coaching day
  //    (90), else a long coaching day itself (80), else a day off (50), else
  //    the day before the lightest ride; a hard-ride day loses 60 so it is
  //    never picked while there is a choice
  const legsScore = (x, i) => {
    let s = -1e3;
    const next = d[i + 1];
    const hardPen = x.ride && x.ride.hard ? 60 : 0;
    if (next && !next.ride) s = 100 - hardPen - load(x) / 10;
    else if (next && next.long_coaching) s = 90 - hardPen - load(x) / 10;
    else if (x.long_coaching) s = 80 - hardPen;
    else if (!x.ride) s = 50;
    else if (next) s = 20 - load(next) / 5 - hardPen;
    if (opts.done && opts.done[x.date]) s += 1e3;                      // already lifted legs that day: it stands
    if (x.locked && x.locked !== 'legs') s = -2e3;
    return s;
  };
  let legsIdx = -1, best = -1e9;
  d.forEach((x, i) => { const s = legsScore(x, i); if (s > best) { best = s; legsIdx = i; } });
  if (legsIdx >= 0) {
    const x = d[legsIdx], next = d[legsIdx + 1];
    x.lift = 'legs';
    x.why = next && (!next.ride || next.long_coaching) ? `the day before ${!next.ride ? 'a day off the bike' : 'a long coaching day'} (${tz.labelOf(next.date)}), so the soreness lands where it costs no ride`
      : x.long_coaching ? `a long coaching day (${Math.round(x.coaching_min / 60)} h), no ride anyway`
      : !x.ride ? 'a day off the bike' : 'the lightest riding ahead of it';
  }
  // 2. the two lift-free days: the two biggest riding days left
  const rest = d.map((x, i) => ({ x, i })).filter(p => p.i !== legsIdx && !p.x.locked).sort((a, b) => load(b.x) - load(a.x));
  const free = new Set(rest.slice(0, Math.max(0, n - 5)).map(p => p.i));
  for (const i of free) d[i].why = d[i].ride ? `no lift: one of the two biggest riding days (${d[i].ride.name})` : 'no lift: a rest day';
  // 3. the other four, in the book's order, with pull kept a day clear of legs when it can be
  const slots = d.map((x, i) => i).filter(i => i !== legsIdx && !free.has(i) && !(d[i].locked && d[i].locked !== 'any'));
  const four = ['push', 'pull', 'upper-1', 'upper-2'];
  const perms = permutations(four);
  let bestP = null, bestS = 1e9;
  for (const p of perms) {
    let s = 0;
    p.forEach((k, j) => {
      const i = slots[j]; if (i == null) return;
      if (k === 'pull' && legsIdx >= 0 && Math.abs(i - legsIdx) <= 1) s += 3;      // deadlift next to the Romanian deadlift
      if (k === 'push' && d[i].ride && d[i].ride.hard) s += 0.5;                      // a push day on the 40/20s is fine, a pull day a little better
    });
    for (let a = 0; a < p.length; a++) for (let b = a + 1; b < p.length; b++) if (four.indexOf(p[a]) > four.indexOf(p[b])) s += 1;   // the book's order, when nothing else decides
    if (s < bestS) { bestS = s; bestP = p; }
  }
  (bestP || four).forEach((k, j) => { const i = slots[j]; if (i != null) { d[i].lift = k; d[i].why = d[i].ride ? `with the ride (${d[i].ride.name})` : d[i].long_coaching ? 'a coaching day, no ride' : 'a day off the bike'; } });
  for (const x of d) if (x.locked && x.locked !== 'any') { x.lift = x.locked; x.why = x.why || 'logged'; }
  return d;
}
function permutations(a) { if (a.length <= 1) return [a]; const out = []; a.forEach((x, i) => { for (const p of permutations(a.slice(0, i).concat(a.slice(i + 1)))) out.push([x].concat(p)); }); return out; }

// The week from today: each day's planned ride (the plan here and in
// intervals.icu, or the ride done), coaching minutes from the calendar.
async function weekDays(n) {
  const today = tz.todayKey();
  const from = today, to = tz.shiftKey(today, (n || 7) - 1);
  const days = [];
  for (let i = 0; i < (n || 7); i++) days.push({ date: tz.shiftKey(today, i), ride: null, coaching_min: 0, long_coaching: false });
  try {
    const { calendar } = require('./workouts');
    const cal = await calendar(from, to);
    for (const day of cal.days || []) {
      const x = days.find(y => y.date === day.date); if (!x) continue;
      const rides = (day.planned || []).filter(w => !/weight|lift|strength/i.test(w.sport || '') && !/^lift|^push$|^pull|^upper|^legs$/i.test(w.name || '')).map(w => ({ name: w.name, minutes: Math.round((w.metrics ? w.metrics.duration_s : 0) / 60), tss: w.metrics ? w.metrics.tss : 0 }))
        .concat((day.intervals || []).filter(e => !/weight|lift|strength/i.test(e.type || '')).map(e => ({ name: e.name, minutes: e.minutes, tss: e.tss })))
        .concat((day.done || []).filter(r => !/weight|lift|strength/i.test(r.type || '')).map(r => ({ name: r.name, minutes: r.minutes, tss: r.tss, done: true })));
      if (rides.length) {
        const big = rides.slice().sort((a, b) => (b.tss || 0) - (a.tss || 0))[0];
        x.ride = { name: big.name, minutes: rides.reduce((a, r) => a + (r.minutes || 0), 0), tss: rides.reduce((a, r) => a + (r.tss || 0), 0), hard: rides.some(r => HARD.test(r.name || '')), done: rides.every(r => r.done) };
      }
    }
  } catch (e) { /* no plan: the week is placed on the calendar alone */ }
  try {
    const { scheduleReport } = require('./calendar');
    const s = await scheduleReport({ days: n || 7 });
    for (const day of s.days || []) {
      const x = days.find(y => y.date === day.date); if (!x) continue;
      x.coaching_min = (day.events || []).filter(e => e.category === 'coaching' && !e.allDay).reduce((a, e) => a + (e.minutes || 0), 0);
      x.long_coaching = x.coaching_min >= LONG_COACHING_MIN;
    }
  } catch (e) { /* calendar unreachable: coaching unknown */ }
  return days;
}

async function report() {
  const d = await db();
  const sessions = d.sessions.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.at).localeCompare(String(b.at)));
  const lastOf = {};
  for (const s of sessions) for (const e of s.exercises || []) lastOf[e.name] = { date: s.date, sets: e.sets };
  const templates = TEMPLATES.map(t => ({ key: t.key, name: t.name, short: t.short, minutes: t.minutes, why: t.why, order: t.order,
    hard_sets: t.exercises.reduce((a, e) => a + e.sets, 0),
    exercises: t.exercises.map(e => Object.assign({}, e, { last: lastOf[e.name] || null, target: target(e, lastOf[e.name]) })) }));
  // the week: what was lifted already this week holds its day; the rest is placed
  const today = tz.todayKey();
  const days = await weekDays(7);
  const doneByDate = {};
  for (const s of sessions) if (s.date >= today) doneByDate[s.date] = s.template;
  for (const x of days) if (doneByDate[x.date]) x.locked = doneByDate[x.date];
  const week = placeWeek(days, { done: doneByDate }).map(x => Object.assign(x, { done: !!doneByDate[x.date], label: tz.labelOf(x.date), name: x.lift ? nameOf(x.lift) : null }));
  // next: today's, if not done; else the next placed day
  const todayX = week.find(x => x.date === today);
  const nextX = todayX && todayX.lift && !todayX.done ? todayX : week.find(x => x.lift && !x.done && x.date > today) || null;
  // strength over time: the best estimated one-rep max in each session, per exercise
  const history = {};
  for (const s of sessions) for (const e of s.exercises || []) {
    const best = Math.max(0, ...(e.sets || []).map(x => e1rm(x.lb, x.reps) || 0));
    if (best) (history[e.name] = history[e.name] || []).push({ date: s.date, e1rm: best, top_lb: Math.max(...e.sets.map(x => x.lb || 0)) });
  }
  const weekCount = sessions.filter(s => s.date >= tz.shiftKey(today, -6)).length;
  const last = sessions[sessions.length - 1] || null;
  // eight weeks on, one off: counted from the first session of this plan
  const first = sessions.find(s => TEMPLATES.some(t => t.key === s.template));
  const weekNo = first ? Math.floor((Date.parse(today) - Date.parse(first.date)) / (7 * 864e5)) + 1 : 1;
  const deload = weekNo % 9 === 0;
  return { templates, next: nextX ? nextX.lift : 'push', next_date: nextX ? nextX.date : null, week, plan: 'Bigger Leaner Stronger, five days',
    week_no: weekNo, deload, deload_note: deload ? 'Deload week: the same lifts, half the hard sets, two reps shy of the top of the range. The weights stay.' : null,
    last: last ? { date: last.date, template: last.template, name: nameOf(last.template) } : null,
    sessions: sessions.slice(-15).reverse().map(s => ({ id: s.id, date: s.date, template: s.template, name: nameOf(s.template),
      notes: s.notes || '', volume_lb: (s.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, x) => b + (x.lb || 0) * (x.reps || 0), 0), 0),
      exercises: (s.exercises || []).map(e => ({ name: e.name, sets: e.sets })) })),
    history, this_week: weekCount, target_per_week: 5,
    rules: ['Legs the day before a day off the bike or a long coaching day, or on a long coaching day.', 'No lift on the two biggest riding days.', 'Pull (deadlift) a day clear of legs (Romanian deadlift) when the week allows.', 'Each of the five once every seven days; eight weeks, then a deload week.'] };
}

async function save(body) {
  const b = body || {};
  const t = TEMPLATES.find(x => x.key === b.template);
  if (!t) throw new Error('unknown session');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : tz.todayKey();
  const exercises = (Array.isArray(b.exercises) ? b.exercises : []).map(e => ({
    name: String(e.name || '').slice(0, 60),
    sets: (Array.isArray(e.sets) ? e.sets : []).map(s => ({ reps: Math.max(0, Math.min(300, Math.round(Number(s.reps) || 0))), lb: Math.max(0, Math.min(1000, Math.round(Number(s.lb) || 0))) })).filter(s => s.reps > 0)
  })).filter(e => e.name && e.sets.length);
  if (!exercises.length) throw new Error('no sets to save');
  const d = await db();
  const s = { id: 'l_' + Date.now().toString(36), date, template: t.key, exercises, notes: String(b.notes || '').slice(0, 400), at: new Date().toISOString() };
  d.sessions.push(s); d.sessions = d.sessions.slice(-400);
  await setJSON('lifts', d);
  return s;
}

// This week's five onto the calendar as planned workouts (the plan store),
// skipping a day that already has a lift planned. time: "HH:MM", default 07:00.
async function scheduleWeek(body) {
  const time = /^\d{2}:\d{2}$/.test((body || {}).time || '') ? body.time : '07:00';
  const r = await report();
  const { create, calendar } = require('./workouts');
  const cal = await calendar(r.week[0].date, r.week[r.week.length - 1].date).catch(() => ({ days: [] }));
  const added = [], kept = [];
  for (const x of r.week) {
    if (!x.lift || x.done) continue;
    const day = (cal.days || []).find(dd => dd.date === x.date);
    const has = day && (day.planned || []).some(w => /weight/i.test(w.sport || '') || /^(push|pull|upper|legs)/i.test(w.name || ''));
    if (has) { kept.push(x.date); continue; }
    const t = TEMPLATES.find(tt => tt.key === x.lift);
    const w = await create({ name: t.name === 'Upper body and core' ? `${t.name} (${t.short})` : t.name, sport: 'WeightTraining', date: x.date, time, notes: `Log it on the Lift tab. ${x.why}.`, steps: [{ kind: 'step', label: 'Lift', dur_s: t.minutes * 60, target: { type: 'free' } }] });
    added.push({ date: x.date, name: t.name, id: w && w.id });
  }
  return { ok: true, added, kept, time };
}

function attach(app) {
  app.get('/lifts', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await report()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/lifts', async (req, res) => { if (!auth(req, res)) return;
    try { const s = await save(req.body); res.json({ ok: true, session: s, report: await report() }); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/lifts/schedule', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await scheduleWeek(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.delete('/lifts/:id', async (req, res) => { if (!auth(req, res)) return;
    try { const d = await db(); const n = d.sessions.length; d.sessions = d.sessions.filter(s => s.id !== req.params.id); await setJSON('lifts', d); res.json({ ok: true, removed: n - d.sessions.length }); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, TEMPLATES, target, e1rm, nextBell, prevBell, placeWeek, report, save, scheduleWeek, LONG_COACHING_MIN };
