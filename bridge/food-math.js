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
const PROFILE = { kg: 98, cm: 178, age: 55, activity: 1.35 };   // the scale overrides kg; this is the fallback
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
    { key: 'protein', text: '45 g of protein at breakfast, lunch and dinner; the shake before a dawn ride is its own.' },
    { key: 'plants', text: 'Vegetables or fruit at two meals or more.' }
  ];
  if (day === 'high') {
    g.push({ key: 'carbs', text: 'Higher carb day: carbs at every meal.' });
    g.push({ key: 'pre', text: 'Carb breakfast 2 to 3 hours before the ride: oats and fruit.' });
    g.push({ key: 'post', text: 'A real meal within 2 hours of the ride: 45 g protein and carbs.' });
  } else if (day === 'normal') {
    g.push({ key: 'pre', text: 'Zone 1 day: low carb breakfast before the ride, under 20 g of carbs, 30 g protein.' });
    g.push({ key: 'carbs', text: 'Starch at the meals the plan marks (after the ride, and the main meals later); protein first before the ride.' });
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
    if (next.dt <= 0) return { key: 'during', text: `${name} is on now: ${onBike(next.x.minutes || 60, /vo2|40\s*\/\s*20|threshold|race/i.test(name)).what}` };
    if (next.dt <= 60) return { key: 'pre-close', text: `${name} in ${Math.round(next.dt)} min: nothing heavy now. A banana or rice cakes if you need something.` };
    const early = toMin(next.x.time) != null && toMin(next.x.time) < 7 * 60 + 30;
    if (next.dt <= 180) return { key: 'pre', text: early
      ? (day === 'high' ? `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: a banana or rice cakes 45 minutes before, breakfast after.`
                        : `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: coffee and a 20 g whey shake, then go. Zone 1 needs no carbs before it; the protein protects the muscle. Breakfast after.`)
      : day === 'high'
      ? `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: carb breakfast now, oats and fruit, then water.`
      : `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: low carb breakfast now. Protein smoothie, eggs or Greek yogurt, no toast.` };
    return { key: 'ahead', text: `${name} at ${next.x.time ? require('./tz').hm12(next.x.time) : 'later'}: ${day === 'high' ? 'carbs at every meal before it' : 'protein first before it; the plan\'s meals carry the carbs'}.` };
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
    time: toHM(Math.round(time / 5) * 5), slot, what,
    kcal: r5(t.kcal * share), carbs_g: r5(t.carbs_g * carbShare), protein_g: protein
  });
  const out = [];
  const restDay = day === 'rest';
  // A low-carb breakfast means it: 20 g of carbs at most (eggs, Greek yogurt, a
  // smoothie with berries), 30 g of protein, about 350 kcal. The carbs it does
  // not carry move to the meal after the ride. Graded as low carb: under on
  // carbs is the point, not a miss.
  const LOW_CARB_G = 20;
  const lowCarb = (time, slot, what, protein) => Object.assign(meal(time, slot, what, 0.15, 0, protein), { carbs_g: LOW_CARB_G, low_carb: true });
  const bfast = (time, pre) => restDay ? Object.assign(meal(time, 'breakfast', 'Protein first: eggs or Greek yogurt, fruit. No starch.', 0.25, 0.15, 45), { low_carb: true })
    : day === 'high' ? meal(time, 'breakfast', pre ? `Carb breakfast 2 to 3 hours before ${pre}: 70 g oats, fruit, whey.` : 'Oats and fruit, whey in the bowl.', 0.25, 0.30, 45)
    : lowCarb(time, 'breakfast', pre ? `Low carb breakfast before ${pre}, under ${LOW_CARB_G} g of carbs, 30 g protein: eggs, Greek yogurt or a smoothie. No toast.` : `Protein smoothie or eggs, 30 g protein, under ${LOW_CARB_G} g of carbs.`, 30);
  // Shares of the day's calories and carbs; each layout below hands out the whole day once.
  const lunch = (time, share, carbShare) => meal(time, 'lunch', restDay ? 'Protein and vegetables. Big salad with chicken or fish.' : 'Protein with rice or potatoes, vegetables.', share == null ? 0.30 : share, carbShare == null ? (restDay ? 0.25 : 0.35) : carbShare, 50);
  const dinner = (time, share, carbShare) => meal(time, 'dinner', restDay ? 'Protein, vegetables and the one starch of the day.'
    : day === 'high' ? 'Protein, vegetables, and a proper starch. Carbs still count today.' : 'Protein and vegetables, starch beside it.', share == null ? 0.35 : share, carbShare == null ? (restDay ? 0.50 : 0.40) : carbShare, 55);
  const snack = time => meal(time, 'snack', `Whey or cottage cheese if protein is short of ${t.protein_g} g.`, 0.10, 0.08, 25);
  // Breakfast is as late as the training allows: he would rather sleep.
  if (!timed) {
    const b = restDay || day === 'high' ? 0.25 : 0.15, bC = restDay ? 0.15 : day === 'high' ? 0.30 : 0.08;
    const left = 1 - b - 0.10, leftC = 1 - bC - 0.08;
    out.push(bfast(9 * 60), lunch(13 * 60, Math.round(left * 0.45 * 100) / 100, Math.round(leftC * 0.4 * 100) / 100), dinner(18 * 60 + 30, Math.round(left * 0.55 * 100) / 100, Math.round(leftC * 0.6 * 100) / 100), snack(20 * 60 + 30));
    return out;
  }
  const { start, end, x } = timed;
  const name = x.name || 'the ride';
  // On the bike, by duration (Jeukendrup 2014): nothing under 45 min, a
  // mouthful 45 to 75, ~30 g/h to 2 h, 60 g/h to 2.5 h, 90 g/h glucose and
  // fructose beyond. A hard session is fed whatever its length.
  const mins = Math.max(0, end - start);
  const hard = /vo2|40\s*\/\s*20|threshold|race/i.test(name);
  const { what, carbs } = onBike(mins, hard);
  const onBikeSlot = { time: toHM(start), slot: 'on the bike', what, kcal: carbs * 4, carbs_g: carbs, protein_g: 0, extra: true };
  // The post-ride meal is a real meal inside two hours (Aragon & Schoenfeld
  // 2013); the 30-minute window only matters with a second session that day.
  const after = (slot, share, carbShare) => meal(end + 30, slot, (day === 'high'
    ? 'Within 2 hours of the ride: 45 g protein and carbs. Post-ride bowl, or chocolate milk and a rice ball.'
    : 'Within 2 hours of the ride: 45 g protein and carbs. Post-ride bowl.'), share, carbShare, 50);
  // A carb breakfast wants 2.5 h before a hard ride; a light low-carb one 1.5 h
  // before Zone 1. Breakfast sits at the latest of those, and if that would mean
  // getting up before 6:30 it becomes coffee and whey 45 minutes out, with
  // breakfast after the ride instead.
  const gap = day === 'high' ? 150 : 90;
  const early = start - gap < 6 * 60 + 30;

  if (start < 11 * 60) {
    // Morning ride: breakfast before it (or nothing before a dawn ride), the post-ride meal, then the day.
    if (early) out.push(meal(start - 45, 'before', day === 'high'
      ? `Small and quick before ${name}: a banana or two rice cakes with honey.`
      : `Coffee and a 20 g whey shake before ${name}. Zone 1 needs no carbs before it; the protein protects the muscle.`, day === 'high' ? 0.08 : 0.04, day === 'high' ? 0.12 : 0, day === 'high' ? 0 : 20));
    else out.push(bfast(start - gap, name));
    out.push(onBikeSlot);
    // the carbs the low-carb breakfast did not carry land here
    const pre = early ? (day === 'high' ? 0.08 : 0.04) : (day === 'high' ? 0.25 : 0.15);
    const preC = early ? (day === 'high' ? 0.12 : 0) : (day === 'high' ? 0.30 : 0.08);
    out.push(after(early ? 'breakfast' : 'after', 0.25, day === 'high' ? 0.30 : 0.40));
    const l = Math.max(end + 150, 12 * 60 + 30);
    const hasLunch = l < 15 * 60;
    // what is left of the day after breakfast, the post-ride meal and the snack, split lunch 40 / dinner 60
    const left = 1 - pre - 0.25 - 0.10, leftC = 1 - preC - (day === 'high' ? 0.30 : 0.40) - 0.08;
    if (hasLunch) out.push(lunch(l, Math.round(left * 0.4 * 100) / 100, Math.round(leftC * 0.4 * 100) / 100));
    out.push(dinner(Math.max(18 * 60 + 30, l + 300), Math.round(left * (hasLunch ? 0.6 : 1) * 100) / 100, Math.round(leftC * (hasLunch ? 0.6 : 1) * 100) / 100));
    out.push(snack(20 * 60 + 45));
  } else if (start < 15 * 60) {
    // Midday ride: breakfast carries the pre-ride role (as late as 9:30), the post-ride meal is lunch.
    out.push(bfast(Math.min(9 * 60 + 30, start - gap), name));
    if (start - gap > 9 * 60 + 30 + 60) out.push(meal(start - 120, 'before', day === 'high'
      ? `Two hours before ${name}: rice cakes and honey, or a banana and yogurt.`
      : `Two hours before ${name}: something light with protein, Greek yogurt or a whey shake.`, 0.08, day === 'high' ? 0.12 : 0.04, 20));
    out.push(onBikeSlot);
    const hasBefore = start - gap > 9 * 60 + 30 + 60;
    const used = (day === 'high' ? 0.25 : 0.15) + (hasBefore ? 0.08 : 0) + 0.10, usedC = (day === 'high' ? 0.30 : 0.08) + (hasBefore ? (day === 'high' ? 0.12 : 0.04) : 0) + 0.08;
    out.push(after('lunch', Math.round((1 - used) * 0.5 * 100) / 100, Math.round((1 - usedC) * 0.5 * 100) / 100));   // carries what the low-carb breakfast did not
    out.push(dinner(Math.max(18 * 60 + 30, end + 240), Math.round((1 - used) * 0.5 * 100) / 100, Math.round((1 - usedC) * 0.5 * 100) / 100));
    out.push(snack(20 * 60 + 45));
  } else {
    // Evening ride: a late breakfast, lunch, a light pre-ride meal, and the post-ride meal is dinner.
    out.push(bfast(9 * 60));
    out.push(lunch(13 * 60, 0.27, day === 'high' ? 0.25 : 0.30));
    out.push(meal(start - 120, 'before', day === 'high'
      ? `Two hours before ${name}: carbs that sit light, rice cakes and honey or a banana and yogurt.`
      : `Two hours before ${name}: something light with protein, Greek yogurt or a whey shake. No big plate.`, 0.10, day === 'high' ? 0.15 : 0.05, 20));
    out.push(onBikeSlot);
    const lateSnack = end + 30 <= 20 * 60;
    out.push(after('dinner', Math.round((1 - (day === 'high' ? 0.25 : 0.15) - 0.27 - 0.10 - (lateSnack ? 0.10 : 0)) * 100) / 100,
      Math.round((1 - (day === 'high' ? 0.30 : 0.08) - (day === 'high' ? 0.25 : 0.30) - (day === 'high' ? 0.15 : 0.05) - (lateSnack ? 0.08 : 0)) * 100) / 100));   // carries what the low-carb breakfast did not
    if (lateSnack) out.push(snack(21 * 60));
  }
  return out.sort((a, b) => toMin(a.time) - toMin(b.time));
}

// What goes in the bottle, by the session (Jeukendrup 2014): nothing under
// 45 min, a mouthful 45 to 75, ~30 g/h to two hours, 60 g/h to 2.5 h, 90 g/h
// glucose and fructose beyond. A hard session is fed whatever its length.
// One rule, read by the plan, the cue and the library's notes.
function onBike(mins, hard) {
  const hours = Math.round(mins / 60 * 10) / 10;
  if (hard) return { what: 'One bottle of Tailwind, 2 scoops: 50 g carbs. A hard session is always fed.', carbs: 50 };
  if (mins < 45) return { what: 'Water. Nothing to eat under 45 minutes.', carbs: 0 };
  if (mins < 75) return { what: 'Water, a mouthful of Tailwind if you want it. Nothing is needed.', carbs: 0 };
  if (mins < 120) return { what: `Tailwind, 1 scoop a bottle: about 30 g carbs an hour for ${hours} h.`, carbs: r5(30 * hours) };
  if (mins <= 150) return { what: `Tailwind, 2 scoops a bottle, and a fig bar each hour: 60 g carbs an hour for ${hours} h.`, carbs: r5(60 * hours) };
  return { what: `Past 2.5 h the gut takes 90 g an hour if it is glucose and fructose together: Tailwind plus fig bars or dates, for ${hours} h.`, carbs: r5(90 * hours) };
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
function guidelineScore(day, entries, rides, plan) {
  const e = (entries || []).filter(x => x && x.assessment);
  if (!e.length) return { score: null, meals: 0, checks: [] };
  const a = e.map(x => x.assessment);
  const checks = [];
  const n = e.length;
  // protein is asked of the main meals; the shake before a dawn ride, the
  // bottle and the evening snack are their own sizes
  const MAIN = ['breakfast', 'lunch', 'dinner', 'after'];
  const mains = e.filter(x => !x.slot || MAIN.includes(x.slot));
  const prot = mains.filter(x => x.assessment.protein_source).length;
  checks.push({ key: 'protein', label: 'protein at the main meals', ok: prot === mains.length, detail: `${prot} of ${mains.length}` });
  const veg = a.filter(x => x.vegetables).length;
  checks.push({ key: 'plants', label: 'vegetables or fruit', ok: veg >= Math.min(2, n), detail: `${veg} meal${veg === 1 ? '' : 's'}` });
  const heavy = a.filter(x => x.carbs === 'heavy').length, some = a.filter(x => x.carbs !== 'none').length;
  if (day === 'high') checks.push({ key: 'carbs', label: 'carbs at every meal', ok: some === n, detail: `${some} of ${n}` });
  else if (day === 'rest') checks.push({ key: 'carbs', label: 'starches at one meal only', ok: heavy <= 1, detail: `${heavy} starchy meal${heavy === 1 ? '' : 's'}` });
  else { const marked = plan ? Math.max(1, plan.filter(m => !m.extra && (m.carbs_g || 0) >= 40).length) : 2; checks.push({ key: 'carbs', label: 'starch where the plan puts it', ok: heavy <= marked, detail: `${heavy} starchy meal${heavy === 1 ? '' : 's'} of ${marked} planned` }); }
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
  // Every slot whose time has come counts, the bottle on the bike included:
  // the planned bottle must not read as "over" once it is drunk.
  const due = meals.filter(m => toMin(m.time) <= now + 45);
  const realMeals = due.filter(m => !m.extra);
  if (!realMeals.length) return { kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, share: 0, meals: 0, next: (meals.find(m => !m.extra) || meals[0]).time };
  const kcal = due.reduce((a, m) => a + (m.kcal || 0), 0);
  // fat is spread over the real meals only: a bottle on the bike carries none
  const share = target.kcal ? Math.min(1, realMeals.reduce((a, m) => a + (m.kcal || 0), 0) / target.kcal) : 0;
  const nxt = meals.find(m => !m.extra && toMin(m.time) > now + 45);
  // Floors: a low-carb slot's carbs are a cap, not a target, and such a slot
  // is light by design. Eating under them is within the plan, so the macro
  // score treats anything between the floor and the due figure as on target.
  const lowCarb = due.filter(m => m.low_carb);
  const lowKcal = lowCarb.reduce((a, m) => a + (m.kcal || 0), 0);
  const carbsFloor = due.filter(m => !m.low_carb).reduce((a, m) => a + (m.carbs_g || 0), 0);
  const kcalFloor = kcal - Math.round(lowKcal * 0.6);
  const fat = Math.round(target.fat_g * share);
  return { kcal, carbs_g: due.reduce((a, m) => a + (m.carbs_g || 0), 0), protein_g: due.reduce((a, m) => a + (m.protein_g || 0), 0),
    fat_g: fat, share: Math.round(share * 100) / 100, meals: realMeals.length, next: nxt ? nxt.time : null,
    carbs_floor_g: carbsFloor, kcal_floor: kcalFloor, fat_floor_g: lowCarb.length ? Math.round(fat * (1 - 0.6 * lowKcal / Math.max(1, realMeals.reduce((a, m) => a + (m.kcal || 0), 0)))) : null, low_carb_due: lowCarb.length };
}

// What the plan says to eat next: the first slot with nothing logged against
// it, from the one whose time is nearest now (a slot up to 45 minutes gone
// still counts as next). The suggestion the pages show is this, sized to the
// slot, never a snack picked against the whole day.
function nextSlot(meals, nowHM) {
  const now = toMin(nowHM);
  const open = (meals || []).filter(m => !(m.logged || []).length);
  return open.find(m => toMin(m.time) >= now - 45) || null;
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

// Once a planned meal has something logged against it, how well the plate
// matched the plan: calories, carbs and protein each against the slot's
// target. Green when all are within 20%; yellow within 40% (or protein
// short alone); red when the calories or the carbs are further off than
// that, either way, since on a Zone 1 morning too many carbs is the miss
// and before a hard session too few is. Slots with no logged entry: null.
// A meal that ran over its slot moves the overage into the next slot, when
// the next slot is near enough (two and a half hours) to be the same
// stretch of the day: the sushi at 11:39 that was both the post-ride meal
// and most of lunch leaves lunch at 12:55 a protein plate, not a second
// full meal. Carbs over, calories over and protein over each roll on their
// own, so a carb-heavy plate leaves the next slot lighter on starch and a
// protein-short one leaves its protein where it was. Nothing rolls out of a
// low-carb slot (its carbs over are the miss, not a credit) or through the
// bottle on the bike, and a slot left under 40% of itself is covered.
// meals: the plan with logged []; entries: the day's entries.
function rollForward(meals, entries) {
  const out = (meals || []).map(m => Object.assign({}, m));
  const real = out.filter(m => !m.extra);
  const es = Array.isArray(entries) ? entries.filter(e => e && !e.supplement && !e.drink_only) : [];
  for (let i = 0; i + 1 < real.length; i++) {
    const a = real[i], b = real[i + 1];
    if (a.low_carb || toMin(b.time) == null || toMin(a.time) == null || toMin(b.time) - toMin(a.time) > 150) continue;
    const got = es.filter(e => e.slot === a.slot);
    if (!got.length) continue;
    const sum = k => got.reduce((x, e) => x + (e[k] || 0), 0);
    const over = { kcal: Math.max(0, sum('kcal') - (a.kcal || 0)), carbs_g: Math.max(0, sum('carbs_g') - (a.carbs_g || 0)), protein_g: Math.max(0, sum('protein_g') - (a.protein_g || 0)) };
    if (over.kcal < 60 && over.carbs_g < 10 && over.protein_g < 10) continue;
    const aName = a.slot === 'after' ? 'post-ride meal' : a.slot === 'before' ? 'pre-ride snack' : a.slot;
    a.rolled_out = { to: b.slot, kcal: over.kcal, carbs_g: over.carbs_g, protein_g: over.protein_g };
    b.plan_kcal = b.plan_kcal ?? b.kcal; b.plan_carbs_g = b.plan_carbs_g ?? b.carbs_g; b.plan_protein_g = b.plan_protein_g ?? b.protein_g;
    b.kcal = Math.max(0, (b.kcal || 0) - over.kcal); b.carbs_g = Math.max(0, (b.carbs_g || 0) - over.carbs_g); b.protein_g = Math.max(0, (b.protein_g || 0) - over.protein_g);
    b.kcal = r5(b.kcal); b.carbs_g = r5(b.carbs_g); b.protein_g = r5(b.protein_g);
    b.rolled_from = { slot: a.slot, time: a.time, kcal: over.kcal, carbs_g: over.carbs_g, protein_g: over.protein_g };
    if (b.plan_kcal > 0 && b.kcal < 0.4 * b.plan_kcal) { b.covered_by = a.slot; b.what = `covered by the ${aName}, which ran over; a protein bite if hungry.`; }
    else if (over.carbs_g >= 20 && b.carbs_g <= 0.6 * (b.plan_carbs_g || 1)) b.what = `${b.protein_g} g of protein and vegetables; the ${aName} carried the starch.`;
    else if (over.kcal >= 60) b.what = `${b.what} Lighter: the ${aName} ran ${over.kcal} kcal over.`;
  }
  return out;
}

function mealMatch(plan, logged) {
  // a bottle of water logged into a slot is not the meal; a bottle with carbs on the bike is
  const l = (logged || []).filter(e => e && !e.supplement && (!e.drink_only || (plan.slot === 'on the bike' && e.carbs_g >= 10)));
  if (!l.length) return null;
  if (plan.covered_by) return { key: 'green', word: `with the ${plan.covered_by} meal`, kcal: 0, carbs_g: 0, protein_g: 0, worst: null, covered: true };
  const sum = k => l.reduce((a, e) => a + (e[k] || 0), 0);
  const got = { kcal: sum('kcal'), carbs_g: sum('carbs_g'), protein_g: sum('protein_g') };
  const off = (have, want) => want > 0 ? (have - want) / want : (have > 15 ? 1 : 0);
  const parts = [];
  if (plan.low_carb) {
    // the point of the slot is few carbs: only carbs OVER the cap and protein short count
    parts.push({ k: 'carbs', off: Math.max(0, off(got.carbs_g, plan.carbs_g)), both: true });
    if (plan.protein_g > 0) parts.push({ k: 'protein', off: off(got.protein_g, plan.protein_g), both: false });
  } else {
    if (plan.kcal > 0) parts.push({ k: 'kcal', off: off(got.kcal, plan.kcal), both: true });
    if (plan.carbs_g > 0 || got.carbs_g > 0) parts.push({ k: 'carbs', off: off(got.carbs_g, plan.carbs_g), both: true });
    if (plan.protein_g > 0) parts.push({ k: 'protein', off: off(got.protein_g, plan.protein_g), both: false });
  }
  // protein only counts when short; an overage that rolled into the next slot is not a miss here
  const miss = p => p.both ? (plan.rolled_out && p.off > 0 ? 0 : Math.abs(p.off)) : Math.max(0, -p.off);
  const worst = parts.reduce((a, p) => miss(p) > miss(a) ? p : a, parts[0] || { k: 'kcal', off: 0, both: true });
  const w = miss(worst);
  const key = w <= 0.2 ? 'green' : w <= 0.4 || !worst.both ? 'yellow' : 'red';
  const dir = worst.off > 0 ? 'over' : 'under';
  const word = key === 'green' ? 'as planned' : `${worst.k} ${Math.round(Math.abs(worst.off) * 100)}% ${dir}`;
  return { key, word, kcal: got.kcal, carbs_g: got.carbs_g, protein_g: got.protein_g, worst: worst.k };
}

module.exports = { PROFILE, DEFICIT, LABEL, bmr, baseBurn, fuelDay, workoutKcal, targets, guidelines, cue, mealPlan, onBike, slotFor, toMin, toHM, dueSoFar, nextSlot, mealMatch, rollForward,
  guidelineScore, overall, band, FIT_POINTS };
