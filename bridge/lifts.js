// ============================================================
// lifts.js — the weight training: two sessions that alternate, logged set
// by set, with the next target worked out from the last time.
//
// Two sessions a week is what the cycling literature supports for a
// masters rider (Rønnestad and Mujika 2014: heavy, low-volume strength
// work improves cycling economy and power without adding weight when the
// riding stays easy). The gear is a kettlebell set and a Bowflex, so the
// sessions are built from those. Progression is the double kind: hold the
// weight until every set reaches the top of its rep range, then add the
// increment (the next bell up for a kettlebell) and start the range again.
// Strength is tracked as an estimated one-rep max (Epley: weight × (1 +
// reps/30)) per exercise, so a heavier set of fewer reps and a lighter set
// of more both show as the same strength.
//   GET  /lifts          templates, which is next, each exercise's target, history
//   POST /lifts          { template, date?, exercises:[{name, sets:[{reps, lb}]}], notes? }
//   DELETE /lifts/:id
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const BELLS = [18, 26, 35, 44, 53, 62, 70, 80, 88];     // the common kettlebell sizes, in pounds
const ex = (name, sets, lo, hi, kind, start, note) => ({ name, sets, reps_lo: lo, reps_hi: hi, kind, start_lb: start, note: note || '' });
const TEMPLATES = [
  { key: 'lift-a', name: 'Lift A: hinge and push', minutes: 45,
    why: 'The hinge is the cycling muscle (glutes, hamstrings, back); the push and the row balance the hours bent over the bars.',
    exercises: [
      ex('Kettlebell swing', 4, 12, 15, 'bell', 35, 'Hips, not arms. Stand tall at the top.'),
      ex('Goblet squat', 3, 8, 12, 'bell', 35, 'Elbows inside the knees at the bottom.'),
      ex('Bowflex chest press', 3, 8, 12, 'bowflex', 90, ''),
      ex('Bowflex seated row', 3, 8, 12, 'bowflex', 90, 'Squeeze the shoulder blades; the bars stay quiet after this.'),
      ex('Plank', 3, 45, 60, 'time', 0, 'Seconds. Hips level, breathe.')
    ] },
  { key: 'lift-b', name: 'Lift B: squat and pull', minutes: 45,
    why: 'Legs under load for the climbs, the back for the position; the dead bug keeps the pelvis steady on the saddle.',
    exercises: [
      ex('Kettlebell front squat', 3, 6, 10, 'bell', 35, 'Two bells if you have them; one goblet-style if not.'),
      ex('Romanian deadlift', 3, 8, 12, 'bell', 44, 'Bell or Bowflex. Hinge until the hamstrings pull, no lower.'),
      ex('Bowflex shoulder press', 3, 8, 12, 'bowflex', 60, ''),
      ex('Bowflex lat pulldown', 3, 8, 12, 'bowflex', 90, ''),
      ex('Dead bug', 3, 8, 12, 'reps', 0, 'Each side. Low back flat on the floor.')
    ] }
];

const e1rm = (lb, reps) => lb > 0 && reps > 0 ? Math.round(lb * (1 + reps / 30)) : null;
function nextBell(lb) { const i = BELLS.findIndex(b => b > lb); return i < 0 ? lb + 10 : BELLS[i]; }
function increment(kind, lb) { return kind === 'bell' ? nextBell(lb) : kind === 'bowflex' ? lb + 10 : kind === 'time' ? lb : lb; }

// The target for an exercise given the last time it was done.
function target(def, last) {
  if (!last || !last.sets || !last.sets.length) return { lb: def.start_lb, reps: def.reps_lo, why: 'first time: start light and find the range', progress: false };
  const sets = last.sets.filter(s => s.reps > 0);
  const lb = Math.max(...sets.map(s => s.lb || 0));
  const allTop = sets.length >= def.sets && sets.every(s => s.reps >= def.reps_hi);
  if (def.kind === 'time' || def.kind === 'reps') {
    if (allTop) return { lb: 0, reps: Math.min(def.reps_hi + (def.kind === 'time' ? 15 : 2), def.reps_hi * 2), why: `every set reached ${def.reps_hi}: add ${def.kind === 'time' ? '15 seconds' : 'two reps'}`, progress: true };
    return { lb: 0, reps: Math.max(def.reps_lo, Math.min(...sets.map(s => s.reps))), why: `hold until every set reaches ${def.reps_hi}`, progress: false };
  }
  if (allTop) return { lb: increment(def.kind, lb), reps: def.reps_lo, why: `every set reached ${def.reps_hi} at ${lb} lb: up to ${increment(def.kind, lb)}, back to ${def.reps_lo} reps`, progress: true };
  const minReps = Math.min(...sets.map(s => s.reps));
  return { lb, reps: Math.min(def.reps_hi, minReps + 1), why: `${lb} lb again; the weakest set did ${minReps}, aim for ${Math.min(def.reps_hi, minReps + 1)}`, progress: false };
}

async function db() { return getJSON('lifts', { sessions: [] }); }

async function report() {
  const d = await db();
  const sessions = d.sessions.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.at).localeCompare(String(b.at)));
  const last = sessions[sessions.length - 1] || null;
  const nextKey = !last ? 'lift-a' : last.template === 'lift-a' ? 'lift-b' : 'lift-a';
  const lastOf = {};
  for (const s of sessions) for (const e of s.exercises || []) lastOf[e.name] = { date: s.date, sets: e.sets };
  const templates = TEMPLATES.map(t => ({ key: t.key, name: t.name, minutes: t.minutes, why: t.why,
    exercises: t.exercises.map(e => Object.assign({}, e, { last: lastOf[e.name] || null, target: target(e, lastOf[e.name]) })) }));
  // strength over time: the best estimated one-rep max in each session, per exercise
  const history = {};
  for (const s of sessions) for (const e of s.exercises || []) {
    const best = Math.max(0, ...(e.sets || []).map(x => e1rm(x.lb, x.reps) || 0));
    if (best) (history[e.name] = history[e.name] || []).push({ date: s.date, e1rm: best, top_lb: Math.max(...e.sets.map(x => x.lb || 0)) });
  }
  const week = sessions.filter(s => s.date >= tz.shiftKey(tz.todayKey(), -6)).length;
  return { templates, next: nextKey, last: last ? { date: last.date, template: last.template, name: (TEMPLATES.find(t => t.key === last.template) || {}).name } : null,
    sessions: sessions.slice(-12).reverse().map(s => ({ id: s.id, date: s.date, template: s.template, name: (TEMPLATES.find(t => t.key === s.template) || {}).name || s.template,
      notes: s.notes || '', volume_lb: (s.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, x) => b + (x.lb || 0) * (x.reps || 0), 0), 0),
      exercises: (s.exercises || []).map(e => ({ name: e.name, sets: e.sets })) })),
    history, this_week: week, target_per_week: 2 };
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
  d.sessions.push(s); d.sessions = d.sessions.slice(-300);
  await setJSON('lifts', d);
  return s;
}

function attach(app) {
  app.get('/lifts', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await report()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/lifts', async (req, res) => { if (!auth(req, res)) return;
    try { const s = await save(req.body); res.json({ ok: true, session: s, report: await report() }); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.delete('/lifts/:id', async (req, res) => { if (!auth(req, res)) return;
    try { const d = await db(); const n = d.sessions.length; d.sessions = d.sessions.filter(s => s.id !== req.params.id); await setJSON('lifts', d); res.json({ ok: true, removed: n - d.sessions.length }); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, TEMPLATES, target, e1rm, nextBell, report, save };
