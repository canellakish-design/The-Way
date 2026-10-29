// ============================================================
// food-math.js — the day's eating rules, as arithmetic. Pure.
//
// Hexis periodises fuel by the day's training: more carbohydrate around hard
// or long sessions, less on easy and rest days, protein held steady. This is
// that idea with Harry's own numbers:
//   energy   = BASE_BURN + the day's riding − the weight-loss deficit
//   protein  = PROTEIN_GOAL, every day
//   fat      = a share of energy that shrinks on higher-carb days
//   carbs    = whatever energy is left
// The day type comes from the sessions on the calendar (planned or done).
// Compliance has two halves: the macros against the target (intake.js) and
// the photo journal against the guidelines (here).
// ============================================================

const BASE_BURN = 2050, DEFICIT = -450, PROTEIN_GOAL = 190;
const FAT_SHARE = { high: 0.20, normal: 0.30, rest: 0.35 };
const LABEL = { high: 'higher carb day', normal: 'normal day', rest: 'rest day' };

// sessions: [{name, sport, minutes, tss}] for the date, planned or done.
function fuelDay(sessions) {
  const s = (sessions || []).filter(Boolean);
  const hard = s.some(x => /vo2|40\s*\/\s*20|threshold|race/i.test(String(x.name || ''))
    || (x.minutes || 0) >= 90 || (x.tss || 0) >= 80);
  if (hard) return 'high';
  if (s.some(x => (x.minutes || 0) >= 30 || (x.tss || 0) >= 20)) return 'normal';
  return 'rest';
}

// Riding energy for a day: Strava's number when the ride is done, an estimate
// from planned TSS otherwise (TSS × FTP × 0.036 ≈ kJ, and kJ ≈ kcal on a bike).
function workoutKcal(sessions, ftp) {
  let k = 0;
  for (const x of sessions || []) {
    if (x.kcal) k += x.kcal;
    else if (x.tss) k += x.tss * (ftp || 175) * 0.036;
  }
  return Math.round(k);
}

function targets(day, kcalFromRiding) {
  const kcal = Math.max(1400, Math.round((BASE_BURN + (kcalFromRiding || 0) + DEFICIT) / 10) * 10);
  const protein_g = PROTEIN_GOAL;
  const fat_g = Math.round(kcal * (FAT_SHARE[day] || FAT_SHARE.normal) / 9);
  const carbs_g = Math.max(100, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));
  return { kcal, carbs_g, protein_g, fat_g, fuel_day: LABEL[day] || LABEL.normal, day };
}

// The rules the photos are judged against. Short, because they are read on a
// phone between meals and sent to the model with every photo.
function guidelines(day, opts) {
  const o = opts || {};
  const g = [
    { key: 'protein', text: 'Protein at every meal, 40 g or more. 190 g for the day.' },
    { key: 'plants', text: 'Vegetables or fruit at two meals or more.' }
  ];
  if (day === 'high') {
    g.push({ key: 'carbs', text: 'Higher carb day: carbs at every meal. Rice, oats, potatoes, bread, fruit.' });
    g.push({ key: 'pre', text: 'Carb breakfast 2 to 3 hours before the ride: oats and fruit.' });
    g.push({ key: 'post', text: 'Whey and carbs within 30 minutes after the ride.' });
  } else if (day === 'normal') {
    g.push({ key: 'pre', text: 'Zone 1 day: low carb breakfast before the ride. Protein smoothie, eggs, Greek yogurt.' });
    g.push({ key: 'carbs', text: 'Carbs at the meal after the ride, protein-led everywhere else.' });
    g.push({ key: 'post', text: 'Protein and carbs within the hour after the ride.' });
  } else {
    g.push({ key: 'carbs', text: 'Rest day: no extra carbs. Starches at one meal only, beside protein.' });
  }
  g.push({ key: 'processed', text: 'Nothing ultra-processed. Sweets and fried food are a miss.' });
  if (o.deficit !== false) g.push({ key: 'deficit', text: 'Portions sized for a 450 kcal deficit: the plate is half protein and vegetables.' });
  return g;
}

// What to eat right now, from where the clock sits against the day's riding.
// sessions carry start_at (planned, when timed) and end_at (done).
function cue(day, sessions, nowIso) {
  const now = new Date(nowIso || Date.now()).getTime();
  const s = sessions || [];
  const done = s.filter(x => x.done && x.end_at).map(x => ({ x, dt: (now - new Date(x.end_at).getTime()) / 6e4 }))
    .filter(x => x.dt >= 0).sort((a, b) => a.dt - b.dt)[0];
  if (done && done.dt <= (day === 'high' ? 30 : 60))
    return { key: 'post', text: `Ride done ${Math.round(done.dt)} min ago: whey and carbs now, within the ${day === 'high' ? 30 : 60}-minute window.` };
  const next = s.filter(x => !x.done && x.start_at).map(x => ({ x, dt: (new Date(x.start_at).getTime() - now) / 6e4 }))
    .filter(x => x.dt > -30).sort((a, b) => a.dt - b.dt)[0];
  if (next) {
    const name = next.x.name || 'the ride';
    if (next.dt <= 0) return { key: 'during', text: `${name} is on now: ${day === 'high' ? 'Tailwind in the bottle, a fig bar each hour on a long one' : 'water, one bottle'}.` };
    if (next.dt <= 60) return { key: 'pre-close', text: `${name} in ${Math.round(next.dt)} min: nothing heavy now. A banana or rice cakes if you need something.` };
    const early = toMin(next.x.time) != null && toMin(next.x.time) < 7 * 60 + 30;
    if (next.dt <= 180) return { key: 'pre', text: early
      ? (day === 'high' ? `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: a banana or rice cakes 45 minutes before, breakfast after.`
                        : `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: coffee and go. Zone 1 needs nothing before it; eat straight after.`)
      : day === 'high'
      ? `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: carb breakfast now, oats and fruit, then water.`
      : `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: low carb breakfast now. Protein smoothie, eggs or Greek yogurt, no toast.` };
    return { key: 'ahead', text: `${name} at ${next.x.time || 'later'}: ${day === 'high' ? 'carbs at every meal before it' : 'low carb until the ride, protein first'}.` };
  }
  if (done) return { key: 'after', text: 'Riding is done for the day. Protein-led meals from here, carbs only beside protein.' };
  return { key: 'rest', text: day === 'rest' ? 'Rest day: protein and vegetables, starches at one meal only.' : 'No timed session: protein at every meal, carbs around the work.' };
}

// ---- the day's meals, timed around the session ----

// sessions: [{name, time:'HH:MM', end_time:'HH:MM', minutes, done}] in the
// athlete's zone. Returns [{time, slot, what, kcal, carbs_g, protein_g}].
// Energy shares: the three main meals carry most of it; the ride's own
// fuelling is on top of the day, not inside it.
function mealPlan(day, sessions, target) {
  const t = target || targets(day, 0);
  const timed = (sessions || []).filter(x => toMin(x.time) != null)
    .map(x => ({ x, start: toMin(x.time), end: toMin(x.end_time) != null ? toMin(x.end_time) : toMin(x.time) + (x.minutes || 60) }))
    .sort((a, b) => a.start - b.start)[0];
  const meal = (time, slot, what, share, carbShare, protein) => ({
    time: toHM(time), slot, what,
    kcal: r5(t.kcal * share), carbs_g: r5(t.carbs_g * carbShare), protein_g: protein
  });
  const out = [];
  if (!timed) {
    if (day === 'rest') {
      out.push(meal(7 * 60, 'breakfast', 'Protein first: eggs or Greek yogurt, fruit. No starch.', 0.25, 0.15, 40));
      out.push(meal(12 * 60 + 30, 'lunch', 'Protein and vegetables. Big salad with chicken or fish.', 0.30, 0.25, 50));
      out.push(meal(18 * 60 + 30, 'dinner', 'Protein, vegetables and the one starch of the day.', 0.35, 0.50, 55));
      out.push(meal(20 * 60 + 30, 'snack', 'Cottage cheese or a whey shake if protein is short.', 0.10, 0.10, 25));
    } else {
      out.push(meal(7 * 60, 'breakfast', day === 'high' ? 'Oats and fruit, whey in the bowl.' : 'Protein smoothie or eggs. Low carb.', 0.25, day === 'high' ? 0.30 : 0.15, 40));
      out.push(meal(12 * 60 + 30, 'lunch', 'Protein with rice or potatoes, vegetables.', 0.30, 0.35, 50));
      out.push(meal(18 * 60 + 30, 'dinner', 'Protein and vegetables, starch beside it.', 0.35, 0.40, 55));
      out.push(meal(20 * 60 + 30, 'snack', 'Protein only if the day is short of 190 g.', 0.10, 0.10, 25));
    }
    return out;
  }
  const { start, end, x } = timed;
  const name = x.name || 'the ride';
  const early = start < 7 * 60 + 30;
  // before
  if (early) {
    out.push(meal(start - 45, 'before', day === 'high'
      ? `Small and quick before ${name}: a banana or two rice cakes with honey.`
      : `Coffee and go. ${name} is Zone 1: nothing needed before it.`, day === 'high' ? 0.08 : 0, day === 'high' ? 0.12 : 0, 0));
  } else {
    out.push(meal(start - 150, 'breakfast', day === 'high'
      ? `Carb breakfast 2 to 3 hours before ${name}: 70 g oats, fruit, whey.`
      : `Low carb breakfast before ${name}: protein smoothie, eggs or Greek yogurt. No toast.`, 0.22, day === 'high' ? 0.30 : 0.10, 40));
  }
  // during
  const hours = Math.max(1, Math.round(((end - start) / 60) * 10) / 10);
  out.push({ time: toHM(start), slot: 'on the bike', what: day === 'high'
    ? (hours >= 1.5 ? `Tailwind, 2 scoops a bottle, and a fig bar each hour: 60 g carbs an hour for ${hours} h.` : 'One bottle of Tailwind, 2 scoops: 50 g carbs.')
    : 'Water, one bottle. Nothing to eat.',
    kcal: day === 'high' ? (hours >= 1.5 ? r5(240 * hours) : 200) : 0, carbs_g: day === 'high' ? (hours >= 1.5 ? r5(60 * hours) : 50) : 0, protein_g: 0, extra: true });
  // after
  out.push(meal(end + 15, 'after', day === 'high'
    ? 'Within 30 minutes: whey and carbs. Post-ride bowl, or chocolate milk and a rice ball.'
    : 'Within the hour: protein and carbs. Post-ride bowl.', early ? 0.28 : 0.22, day === 'high' ? 0.30 : 0.35, 45));
  // the rest of the day
  const lunch = Math.max(end + 150, 12 * 60 + 30);
  if (lunch < 15 * 60) out.push(meal(lunch, 'lunch', 'Protein and vegetables, rice or potatoes beside it.', 0.22, 0.20, 50));
  out.push(meal(Math.max(18 * 60 + 30, lunch + 300), 'dinner', day === 'high'
    ? 'Protein, vegetables, and a proper starch. Carbs still count today.'
    : 'Protein and vegetables. Starch only beside protein.', 0.28, day === 'high' ? 0.25 : 0.25, 55));
  out.push(meal(20 * 60 + 45, 'snack', 'Whey or cottage cheese if protein is short of 190 g.', 0.08, 0.05, 25));
  return out.sort((a, b) => toMin(a.time) - toMin(b.time));
}

// The slot a photo belongs to: the nearest planned meal within 90 minutes,
// else by the clock.
function slotFor(plan, hm) {
  const m = toMin(hm);
  if (m == null) return null;
  let best = null;
  for (const p of plan || []) {
    const d = Math.abs(toMin(p.time) - m);
    if (d <= 90 && (!best || d < best.d)) best = { p, d };
  }
  return best ? best.p.slot : null;
}

// One photo's verdict, from the model's assessment, to points.
const FIT_POINTS = { yes: 100, partly: 60, no: 20 };
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHM = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const r5 = x => Math.round(x / 5) * 5;


// entries: [{at, meal, assessment:{protein_source, carbs, vegetables, processed, fits}}]
// rides: [{end_at}] done rides for the day, for the post-ride window.
function guidelineScore(day, entries, rides) {
  const e = (entries || []).filter(x => x && x.assessment);
  if (!e.length) return { score: null, meals: 0, checks: [] };
  const a = e.map(x => x.assessment);
  const checks = [];
  const n = e.length;
  const prot = a.filter(x => x.protein_source).length;
  checks.push({ key: 'protein', label: 'protein at every meal', ok: prot === n, detail: `${prot} of ${n}` });
  const veg = a.filter(x => x.vegetables).length;
  checks.push({ key: 'plants', label: 'vegetables or fruit', ok: veg >= Math.min(2, n), detail: `${veg} meal${veg === 1 ? '' : 's'}` });
  const heavy = a.filter(x => x.carbs === 'heavy').length, some = a.filter(x => x.carbs !== 'none').length;
  if (day === 'high') checks.push({ key: 'carbs', label: 'carbs at every meal', ok: some === n, detail: `${some} of ${n}` });
  else if (day === 'rest') checks.push({ key: 'carbs', label: 'starches at one meal only', ok: heavy <= 1, detail: `${heavy} starchy meal${heavy === 1 ? '' : 's'}` });
  else checks.push({ key: 'carbs', label: 'carbs around the ride', ok: heavy <= 2, detail: `${heavy} starchy meal${heavy === 1 ? '' : 's'}` });
  const proc = a.filter(x => x.processed).length;
  checks.push({ key: 'processed', label: 'nothing ultra-processed', ok: proc === 0, detail: proc ? `${proc} flagged` : 'clean' });
  if (day !== 'rest' && rides && rides.length) {
    const window = day === 'high' ? 30 : 60;
    const hit = rides.some(r => r.end_at && e.some(x => {
      const dt = (new Date(x.at) - new Date(r.end_at)) / 6e4;
      return dt >= -15 && dt <= window && x.assessment.protein_source && x.assessment.carbs !== 'none';
    }));
    checks.push({ key: 'post', label: `fed within ${window} min of the ride`, ok: hit, detail: hit ? 'yes' : 'not yet' });
  }
  const fit = Math.round(a.reduce((s, x) => s + (FIT_POINTS[x.fits] ?? 60), 0) / n);
  const passed = checks.filter(c => c.ok).length;
  const score = Math.round(0.6 * fit + 0.4 * (passed / checks.length) * 100);
  return { score, fit, meals: n, checks };
}

// The day's number: macros against target and photos against guidelines,
// averaged when both exist.
function overall(macroScore, guideline) {
  const m = macroScore == null ? null : macroScore;
  const g = guideline == null ? null : guideline;
  if (m == null && g == null) return null;
  if (m == null) return g;
  if (g == null) return m;
  return Math.round((m + g) / 2);
}

function band(score) {
  if (score == null) return null;
  if (score >= 90) return { word: 'on target', tone: 'good' };
  if (score >= 70) return { word: 'close', tone: 'warn' };
  return { word: 'off', tone: 'bad' };
}

module.exports = { BASE_BURN, DEFICIT, PROTEIN_GOAL, LABEL, fuelDay, workoutKcal, targets, guidelines, cue, mealPlan, slotFor, toMin, toHM,
  guidelineScore, overall, band, FIT_POINTS };
