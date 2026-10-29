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

// Energy. Mifflin-St Jeor is the equation Frankenfield found most reliable
// in adults including the overweight: 10·kg + 6.25·cm − 5·age + 5. A
// teacher and coach on his feet is light-active, factor 1.35. At 104 kg,
// 178 cm, 55 that is ~1,890 × 1.35 ≈ 2,550 kcal before riding; the old flat
// 2,050 undercounted the day by ~500 kcal and squeezed the carbs out.
const PROFILE = { kg: 104, cm: 178, age: 55, activity: 1.35 };
const DEFICIT = -450;              // ≈0.4% of body mass a week, under Garthe's 0.7% slow rate
const PROTEIN_PER_KG = 1.9;        // 1.8 to 2.0 g/kg in a deficit (Phillips & Van Loon; Morton's breakpoint 1.6)
const FAT_FLOOR_PER_KG = 0.7;      // hormones and absorption: never below this
// Carbohydrate floors by day, in a deficit (the ACSM tiers assume energy
// balance and are ceilings here; Hexis-style rest days run ~1.5 g/kg).
const CARB_FLOOR_PER_KG = { rest: 1.5, normal: 2.0, high: 3.0 };
const LABEL = { high: 'higher carb day', normal: 'normal day', rest: 'rest day' };

function bmr(p) { return Math.round(10 * p.kg + 6.25 * p.cm - 5 * p.age + 5); }
function baseBurn(p) { return Math.round(bmr(p) * p.activity); }

// sessions: [{name, sport, minutes, tss}] for the date, planned or done.
// A higher carb day is a hard session (VO2, threshold, a race) or a long
// one: two hours and up, or 80 TSS. A 90-minute Zone 1 is a normal day; in
// a deficit it needs about 30 g an hour on the bike, not a carb breakfast.
function fuelDay(sessions) {
  const s = (sessions || []).filter(Boolean);
  const hard = s.some(x => /vo2|40\s*\/\s*20|threshold|race/i.test(String(x.name || ''))
    || (x.minutes || 0) >= 120 || (x.tss || 0) >= 80);
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

// opts: { kg, cm, age, deficit } override the profile (the scale sets kg;
// deficit 0 on a day the body says rest).
function targets(day, kcalFromRiding, opts) {
  const o = opts || {};
  const p = Object.assign({}, PROFILE, { kg: o.kg > 40 ? o.kg : PROFILE.kg, cm: o.cm > 100 ? o.cm : PROFILE.cm, age: o.age > 10 ? o.age : PROFILE.age });
  const deficit = o.deficit != null ? o.deficit : DEFICIT;
  const burn = baseBurn(p) + (kcalFromRiding || 0);
  const protein_g = Math.round(p.kg * PROTEIN_PER_KG);
  const fat_floor = Math.round(p.kg * FAT_FLOOR_PER_KG);
  const carb_floor = Math.round(p.kg * (CARB_FLOOR_PER_KG[day] || CARB_FLOOR_PER_KG.normal));
  let kcal = Math.round((burn + deficit) / 10) * 10;
  // The floors come first; if the deficit cannot hold them, the deficit gives.
  const floorKcal = protein_g * 4 + fat_floor * 9 + carb_floor * 4;
  let trimmed = 0;
  if (kcal < floorKcal) { trimmed = floorKcal - kcal; kcal = Math.round(floorKcal / 10) * 10; }
  // What is left after protein and the fat floor goes to carbs, the fuel for
  // the work, up to a sensible ceiling; past that it goes back to fat.
  const carb_ceiling = Math.round(p.kg * (day === 'high' ? 6 : day === 'normal' ? 4 : 3));
  let carbs_g = Math.round((kcal - protein_g * 4 - fat_floor * 9) / 4);
  let fat_g = fat_floor;
  if (carbs_g > carb_ceiling) { fat_g = Math.round((kcal - protein_g * 4 - carb_ceiling * 4) / 9); carbs_g = carb_ceiling; }
  return { kcal, carbs_g, protein_g, fat_g, fuel_day: LABEL[day] || LABEL.normal, day,
    base_burn: baseBurn(p), ride_kcal: Math.round(kcalFromRiding || 0), deficit: kcal - burn,
    deficit_trimmed: trimmed ? Math.round(trimmed) : 0, kg: p.kg,
    per_kg: { carbs: Math.round(carbs_g / p.kg * 10) / 10, protein: Math.round(protein_g / p.kg * 10) / 10 } };
}

// The rules the photos are judged against. Short, because they are read on a
// phone between meals and sent to the model with every photo.
function guidelines(day, opts) {
  const o = opts || {};
  const g = [
    { key: 'protein', text: 'Protein at every meal, 45 g or more.' },
    { key: 'plants', text: 'Vegetables or fruit at two meals or more.' }
  ];
  if (day === 'high') {
    g.push({ key: 'carbs', text: 'Higher carb day: carbs at every meal.' });
    g.push({ key: 'pre', text: 'Carb breakfast 2 to 3 hours before the ride: oats and fruit.' });
    g.push({ key: 'post', text: 'A real meal within 2 hours of the ride: 45 g protein and carbs.' });
  } else if (day === 'normal') {
    g.push({ key: 'pre', text: 'Zone 1 day: low carb breakfast before the ride, 20 g protein in it.' });
    g.push({ key: 'carbs', text: 'Carbs at the meal after the ride, protein-led everywhere else.' });
    g.push({ key: 'post', text: 'Protein and carbs within 2 hours of the ride.' });
  } else {
    g.push({ key: 'carbs', text: 'Rest day: starches at one meal only.' });
  }
  g.push({ key: 'processed', text: 'Nothing ultra-processed.' });
  if (o.deficit !== false) g.push({ key: 'deficit', text: 'Half the plate protein and vegetables.' });
  return g;
}

// What to eat right now, from where the clock sits against the day's riding.
// sessions carry start_at (planned, when timed) and end_at (done).
function cue(day, sessions, nowIso) {
  const now = new Date(nowIso || Date.now()).getTime();
  const s = sessions || [];
  const done = s.filter(x => x.done && x.end_at).map(x => ({ x, dt: (now - new Date(x.end_at).getTime()) / 6e4 }))
    .filter(x => x.dt >= 0).sort((a, b) => a.dt - b.dt)[0];
  if (done && done.dt <= 120)
    return { key: 'post', text: `Ride done ${Math.round(done.dt)} min ago: the post-ride meal, 45 g protein and carbs, within the two hours.` };
  const next = s.filter(x => !x.done && x.start_at).map(x => ({ x, dt: (new Date(x.start_at).getTime() - now) / 6e4 }))
    .filter(x => x.dt > -30).sort((a, b) => a.dt - b.dt)[0];
  if (next) {
    const name = next.x.name || 'the ride';
    if (next.dt <= 0) return { key: 'during', text: `${name} is on now: ${day === 'high' ? 'Tailwind in the bottle, a fig bar each hour on a long one' : 'water, one bottle'}.` };
    if (next.dt <= 60) return { key: 'pre-close', text: `${name} in ${Math.round(next.dt)} min: nothing heavy now. A banana or rice cakes if you need something.` };
    const early = toMin(next.x.time) != null && toMin(next.x.time) < 7 * 60 + 30;
    if (next.dt <= 180) return { key: 'pre', text: early
      ? (day === 'high' ? `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: a banana or rice cakes 45 minutes before, breakfast after.`
                        : `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: coffee and a 20 g whey shake, then go. Zone 1 needs no carbs before it; the protein protects the muscle. Breakfast after.`)
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
  const restDay = day === 'rest';
  const bfast = (time, pre) => meal(time, 'breakfast',
    restDay ? 'Protein first: eggs or Greek yogurt, fruit. No starch.'
    : day === 'high' ? (pre ? `Carb breakfast 2 to 3 hours before ${pre}: 70 g oats, fruit, whey.` : 'Oats and fruit, whey in the bowl.')
    : (pre ? `Low carb breakfast before ${pre}, with 20 g protein: smoothie, eggs or Greek yogurt. No toast.` : 'Protein smoothie or eggs, 20 g protein at least. Low carb.'),
    0.25, restDay ? 0.15 : day === 'high' ? 0.30 : 0.15, 45);
  const lunch = time => meal(time, 'lunch', restDay ? 'Protein and vegetables. Big salad with chicken or fish.' : 'Protein with rice or potatoes, vegetables.', 0.30, restDay ? 0.25 : 0.35, 50);
  const dinner = time => meal(time, 'dinner', restDay ? 'Protein, vegetables and the one starch of the day.'
    : day === 'high' ? 'Protein, vegetables, and a proper starch. Carbs still count today.' : 'Protein and vegetables, starch beside it.', 0.35, restDay ? 0.50 : 0.40, 55);
  const snack = time => meal(time, 'snack', 'Whey or cottage cheese if protein is short of 190 g.', 0.10, 0.10, 25);
  if (!timed) {
    out.push(bfast(7 * 60), lunch(12 * 60 + 30), dinner(18 * 60 + 30), snack(20 * 60 + 30));
    return out;
  }
  const { start, end, x } = timed;
  const name = x.name || 'the ride';
  // On the bike, by duration (Jeukendrup 2014): nothing under 45 min, a
  // mouthful 45 to 75, ~30 g/h to 2 h, 60 g/h to 2.5 h, 90 g/h glucose and
  // fructose beyond. A hard session is fed whatever its length.
  const mins = Math.max(0, end - start), hours = Math.round(mins / 60 * 10) / 10;
  const hard = /vo2|40\s*\/\s*20|threshold|race/i.test(name);
  let what, carbs;
  if (hard) { what = 'One bottle of Tailwind, 2 scoops: 50 g carbs. A hard session is always fed.'; carbs = 50; }
  else if (mins < 45) { what = 'Water. Nothing to eat under 45 minutes.'; carbs = 0; }
  else if (mins < 75) { what = 'Water, a mouthful of Tailwind if you want it. Nothing is needed.'; carbs = 0; }
  else if (mins <= 120) { what = `Tailwind, 1 scoop a bottle: about 30 g carbs an hour for ${hours} h.`; carbs = r5(30 * hours); }
  else if (mins <= 150) { what = `Tailwind, 2 scoops a bottle, and a fig bar each hour: 60 g carbs an hour for ${hours} h.`; carbs = r5(60 * hours); }
  else { what = `Past 2.5 h the gut takes 90 g an hour if it is glucose and fructose together: Tailwind plus fig bars or dates, for ${hours} h.`; carbs = r5(90 * hours); }
  const onBike = { time: toHM(start), slot: 'on the bike', what, kcal: carbs * 4, carbs_g: carbs, protein_g: 0, extra: true };
  // The post-ride meal is a real meal inside two hours (Aragon & Schoenfeld
  // 2013); the 30-minute window only matters with a second session that day.
  const after = (slot, share, carbShare) => meal(end + 30, slot, (day === 'high'
    ? 'Within 2 hours of the ride: 45 g protein and carbs. Post-ride bowl, or chocolate milk and a rice ball.'
    : 'Within 2 hours of the ride: 45 g protein and carbs. Post-ride bowl.'), share, carbShare, 50);
  const early = start < 7 * 60 + 30;

  if (start < 11 * 60) {
    // Morning ride: breakfast before it (or nothing before a dawn ride), the post-ride meal, then the day.
    if (early) out.push(meal(start - 45, 'before', day === 'high'
      ? `Small and quick before ${name}: a banana or two rice cakes with honey.`
      : `Coffee and a 20 g whey shake before ${name}. Zone 1 needs no carbs before it; the protein protects the muscle.`, day === 'high' ? 0.08 : 0.04, day === 'high' ? 0.12 : 0, day === 'high' ? 0 : 20));
    else out.push(bfast(start - 150, name));
    out.push(onBike);
    out.push(after(early ? 'breakfast' : 'after', early ? 0.28 : 0.22, day === 'high' ? 0.30 : 0.35));
    const l = Math.max(end + 150, 12 * 60 + 30);
    if (l < 15 * 60) out.push(lunch(l));
    out.push(dinner(Math.max(18 * 60 + 30, l + 300)));
    out.push(snack(20 * 60 + 45));
  } else if (start < 15 * 60) {
    // Midday ride: breakfast carries the pre-ride role, the post-ride meal is lunch.
    out.push(bfast(Math.min(7 * 60 + 30, start - 150), name));
    if (start - 150 >= 9 * 60 + 30) out.push(meal(start - 120, 'before', day === 'high'
      ? `Two hours before ${name}: rice cakes and honey, or a banana and yogurt.`
      : `Two hours before ${name}: something light with protein, Greek yogurt or a whey shake.`, 0.08, day === 'high' ? 0.12 : 0.04, 20));
    out.push(onBike);
    out.push(after('lunch', 0.30, day === 'high' ? 0.35 : 0.35));
    out.push(dinner(Math.max(18 * 60 + 30, end + 240)));
    out.push(snack(20 * 60 + 45));
  } else {
    // Evening ride: the day is normal up to lunch, a light pre-ride meal, and the post-ride meal is dinner.
    out.push(bfast(7 * 60));
    out.push(lunch(12 * 60 + 30));
    out.push(meal(start - 120, 'before', day === 'high'
      ? `Two hours before ${name}: carbs that sit light, rice cakes and honey or a banana and yogurt.`
      : `Two hours before ${name}: something light with protein, Greek yogurt or a whey shake. No big plate.`, 0.10, day === 'high' ? 0.15 : 0.05, 20));
    out.push(onBike);
    out.push(after('dinner', 0.33, day === 'high' ? 0.35 : 0.40));
    if (end + 30 <= 20 * 60) out.push(snack(21 * 60));
  }
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
    const window = 120;
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
// What the plan says should be in by now: the meals whose time has come
// (with 45 minutes' grace to finish eating), as a share of the day. The
// macro half of the Food score is read against this, not the whole day, so
// a good breakfast at eight is not "off" because dinner has not happened.
function dueSoFar(meals, target, nowHM) {
  if (!target || !Array.isArray(meals) || !meals.length) return null;
  const now = toMin(nowHM);
  const due = meals.filter(m => !m.extra && toMin(m.time) <= now + 45);
  if (!due.length) return { kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, share: 0, meals: 0, next: meals[0].time };
  const kcal = due.reduce((a, m) => a + (m.kcal || 0), 0);
  const share = target.kcal ? Math.min(1, kcal / target.kcal) : 0;
  const nxt = meals.find(m => !m.extra && toMin(m.time) > now + 45);
  return { kcal, carbs_g: due.reduce((a, m) => a + (m.carbs_g || 0), 0), protein_g: due.reduce((a, m) => a + (m.protein_g || 0), 0),
    fat_g: Math.round(target.fat_g * share), share: Math.round(share * 100) / 100, meals: due.length, next: nxt ? nxt.time : null };
}

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
  if (score >= 80) return { word: 'on target', tone: 'good' };
  if (score >= 60) return { word: 'close', tone: 'warn' };
  return { word: 'off', tone: 'bad' };
}

module.exports = { PROFILE, DEFICIT, LABEL, bmr, baseBurn, fuelDay, workoutKcal, targets, guidelines, cue, mealPlan, slotFor, toMin, toHM, dueSoFar,
  guidelineScore, overall, band, FIT_POINTS };
