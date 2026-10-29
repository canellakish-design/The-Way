// ============================================================
// intake.js — what was actually eaten, against what Hexis asked for.
//   Hexis (macros.js) = the recommendation.
//   Alma             = the tracking.
//   Here             = the two side by side, a compliance score per macro,
//                      and the snack that would close the biggest gap.
//
// Alma has no server-to-server feed into the bridge, so like Hexis this is an
// inbox: a sync run posts the day's totals. Until it does, The Way's own food
// log stands in, and the payload says which source the numbers came from.
//   POST /intake        {kcal, carbs_g, protein_g, fat_g, source:"alma"}
//   GET  /intake/today
//   GET  /compliance    targets vs actual, per-macro score, suggested snack
// See deploy/alma-sync.md.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const { auth } = require('./fuel-log');

const MACROS = ['carbs_g', 'protein_g', 'fat_g'];
const KEEP_DAYS = 60;

let SNACKS = { snacks: [] };
try { SNACKS = require('./snacks.json'); }
catch (e) { console.error('[intake] snacks.json unreadable:', e.message); }

const dateKey = d => tz.keyOf(d);
const num = v => (v == null || v === '' || isNaN(Number(v))) ? null : Math.round(Number(v) * 10) / 10;

async function db() { return getJSON('intake', { days: {} }); }

async function save(rows) {
  const d = await db();
  const saved = rows.map(r => ({
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || '')) ? r.date : dateKey(new Date()),
    kcal: num(r.kcal), carbs_g: num(r.carbs_g ?? r.carbs),
    protein_g: num(r.protein_g ?? r.protein), fat_g: num(r.fat_g ?? r.fat),
    meals: Number.isFinite(Number(r.meals)) ? Number(r.meals) : null,
    source: r.source || 'alma', posted_at: new Date().toISOString()
  }));
  for (const r of saved) d.days[r.date] = r;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const floor = dateKey(cutoff);
  for (const k of Object.keys(d.days)) if (k < floor) delete d.days[k];
  await setJSON('intake', d);
  return saved;
}

// The Way's own food log is the record. A day's totals posted to /intake
// (the old Alma inbox) still count if nothing was logged here.
async function actualFor(date) {
  const d = await db();
  if (date !== dateKey(new Date())) return d.days[date] ? { ...d.days[date], from: 'posted totals' } : null;
  try {
    const { mealsToday } = require('./fuel-log');
    const meals = await mealsToday();
    if (!meals.length) return d.days[date] ? { ...d.days[date], from: 'posted totals' }
      : { date, kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, meals: 0, from: 'the way (nothing logged yet)' };
    const sum = k => Math.round(meals.reduce((a, m) => a + (m[k] || 0), 0) * 10) / 10;
    return { date, kcal: sum('kcal'), carbs_g: sum('carbs_g'), protein_g: sum('protein_g'),
      fat_g: sum('fat_g'), meals: meals.length, from: 'the way food log' };
  } catch (e) { return null; }
}

/* ---- scoring ----------------------------------------------------------
   100 inside a ±5% band, falling linearly to 0 at 55% off target. Over and
   under both cost — 400g of carbs on a 236g day is a miss in the same way
   150g is, and a score that only punished shortfalls would say otherwise. */
function macroScore(actual, target) {
  if (!target) return null;
  const dev = (actual - target) / target;
  const off = Math.abs(dev);
  const score = off <= 0.05 ? 100 : Math.max(0, Math.round(100 - (off - 0.05) * 200));
  return { actual, target, score, deviation_pct: Math.round(dev * 100),
    direction: off <= 0.05 ? 'on target' : (dev > 0 ? 'over' : 'under'),
    remaining: Math.round((target - actual) * 10) / 10 };
}

function scoreDay(actual, target) {
  if (!target) return null;
  const per = {};
  for (const m of MACROS) per[m] = macroScore(actual ? (actual[m] || 0) : 0, target[m]);
  per.kcal = macroScore(actual ? (actual.kcal || 0) : 0, target.kcal);
  const scored = MACROS.map(m => per[m] && per[m].score).filter(s => s != null);
  const overall = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
  return { per_macro: per, overall };
}

/* ---- the snack --------------------------------------------------------
   Try every snack at 1–3 servings, keep whatever lifts the overall score the
   most. Nothing that pushes calories more than 5% past the day's target is
   allowed to win — closing a protein gap by blowing the energy budget isn't
   compliance, it's a different miss. */
// opts.day: 'rest' | 'normal' | 'high' (food-math). A sugar drink is a
// post-ride tool on a hard day, not a rest-day snack: the carbs a snack may
// carry are capped by the day. opts.post: true inside the post-ride window
// lifts the cap. One serving, two at most; nobody wants three pints of
// anything.
function suggestSnack(actual, target, opts) {
  if (!target) return null;
  const o = opts || {};
  const base = scoreDay(actual, target);
  if (!base || base.overall == null) return null;
  const kcalCeiling = target.kcal ? target.kcal * 1.05 : Infinity;
  const carbCap = o.post ? Infinity : o.day === 'rest' ? 15 : o.day === 'normal' ? 30 : Infinity;
  let best = null;
  for (const s of (SNACKS.snacks || [])) {
    if (s.carbs_g > carbCap) continue;
    for (let n = 1; n <= 2; n++) {
      const after = {
        kcal: (actual.kcal || 0) + s.kcal * n,
        carbs_g: (actual.carbs_g || 0) + s.carbs_g * n,
        protein_g: (actual.protein_g || 0) + s.protein_g * n,
        fat_g: (actual.fat_g || 0) + s.fat_g * n
      };
      if (after.kcal > kcalCeiling) continue;
      const sc = scoreDay(after, target);
      if (!sc || sc.overall == null) continue;
      const gain = sc.overall - base.overall;
      if (gain <= 0) continue;
      if (!best || gain > best.gain || (gain === best.gain && s.kcal * n < best.kcal)) {
        best = { name: s.name, servings: n, gain, score_after: sc.overall,
          kcal: Math.round(s.kcal * n),
          carbs_g: Math.round(s.carbs_g * n * 10) / 10,
          protein_g: Math.round(s.protein_g * n * 10) / 10,
          fat_g: Math.round(s.fat_g * n * 10) / 10 };
      }
    }
  }
  if (!best) return { none: true, reason: 'nothing in the snack list improves the score without overshooting calories' };
  const gaps = MACROS.filter(m => base.per_macro[m] && base.per_macro[m].direction === 'under')
    .map(m => m.replace('_g', ''));
  return { ...best, score_before: base.overall,
    why: gaps.length ? `closes the ${gaps.join(' and ')} gap` : 'best available move on the remaining macros' };
}

// The target is The Way's own (food-math.js, from the day's training), the
// intake is the food log, and the photo journal adds the guideline half of
// the score. Hexis and Alma are no longer in the loop.
async function compliance(date) {
  const key = date || dateKey(new Date());
  const food = await require('./food').dayReport(key);
  const actual = await actualFor(key);
  const scored = scoreDay(actual || {}, food.target);
  if (scored) {
    const g = food.compliance.guidelines;
    scored.macro_overall = scored.overall;
    scored.guideline_overall = g.score;
    scored.overall = require('./food-math').overall(scored.overall, g.score);
    scored.checks = g.checks;
  }
  return {
    date: key,
    target: food.target,
    actual: actual || null,
    source: actual ? actual.from : null,
    compliance: scored,
    // Nothing to close a gap against until something has been eaten.
    suggestion: actual && (actual.kcal > 0 || food.entries.length) ? suggestSnack(actual, food.target, { day: food.day, post: !!(food.cue && food.cue.key === 'post') }) : null,
    meals: food.entries.length,
    // Mid-morning you are "under" on everything and that is not a failure.
    // Say what the number means rather than letting it be read as a verdict.
    basis: 'day-to-date intake against the whole-day target, and the photo journal against the guidelines'
  };
}

function attach(app) {
  app.post('/intake', async (req, res) => { if (!auth(req, res)) return;
    try {
      const body = req.body || {};
      const rows = Array.isArray(body.days) ? body.days : [body];
      const saved = await save(rows);
      res.json({ ok: true, saved, ...(await compliance(saved[0].date)) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/intake/today', async (req, res) => { if (!auth(req, res)) return;
    res.json((await actualFor(dateKey(new Date()))) || { have: false }); });
  app.get('/compliance', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await compliance(req.query.date)); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, compliance, scoreDay, macroScore, suggestSnack };
