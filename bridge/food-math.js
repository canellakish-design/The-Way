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
// teacher and coach on his feet is light-active, factor 1.35. At 98.4 kg,
// 178 cm, 48 that is 1,862 × 1.35 ≈ 2,513 kcal before riding; the old flat
// 2,050 undercounted the day by ~500 kcal and squeezed the carbs out.
// Age and height are settings (body.js, Setup); these are the fallbacks. 55 was the goal age for 2033,
// not his age: he is 48 (9 Nov 2026), which adds 35 kcal to BMR and about 47 to the day's burn.
const PROFILE = { kg: 98, cm: 178, age: 48, activity: 1.35 };   // the scale overrides kg; this is the fallback
const DAILY_SHARE = PROFILE.activity - 1;   // everyday movement on top of BMR: BMR × 0.35
const DEFICIT = -450;              // ≈0.4% of body mass a week, under Garthe's 0.7% slow rate
const PROTEIN_PER_KG = 1.9;        // 1.8 to 2.0 g/kg in a deficit (Phillips & Van Loon; Morton's breakpoint 1.6)
const FAT_FLOOR_PER_KG = 0.7;      // hormones and absorption: never below this
// Carbohydrate floors by day, in a deficit (the ACSM tiers assume energy
// balance and are ceilings here; Hexis-style rest days run ~1.5 g/kg).
const CARB_FLOOR_PER_KG = { rest: 1.5, normal: 2.0, high: 3.0 };
const LABEL = { high: 'higher carb day', normal: 'normal day', rest: 'rest day', low: 'train-low day' };

function bmr(p) { return Math.round(10 * p.kg + 6.25 * p.cm - 5 * p.age + 5); }
function baseBurn(p) { return Math.round(bmr(p) * p.activity); }

// sessions: [{name, sport, minutes, tss}] for the date, planned or done.
// A higher carb day is a hard session (VO2, threshold, a race) or a long
// one: two hours and up, or 80 TSS. A 90-minute Zone 1 is a normal day; in
// a deficit it needs about 30 g an hour on the bike, not a carb breakfast.
// a lift, a run or a walk is training, but not riding: the day's type and its ride minutes come from rides only
const isRideSession = x => !!x && !/weight|lift|strength|^run$|virtualrun|trailrun|walk|hike/i.test(String(x.sport || '')) && !/\blift\b|^push\b|\bpull\b|\bupper\b|\blegs\b|\bpump\b|strength|treadmill|\brun\b/i.test(String(x.name || ''));
function fuelDay(sessions) {
  const s = (sessions || []).filter(isRideSession);
  const hard = s.some(x => /vo2|40\s*\/\s*20|threshold|race/i.test(String(x.name || ''))
    || (x.minutes || 0) >= 120 || (x.tss || 0) >= 80);
  if (hard) return 'high';
  if (s.some(x => (x.minutes || 0) >= 30 || (x.tss || 0) >= 20)) return 'normal';
  return 'rest';
}

// ---- fuel for the work required (Impey 2018): a prescription per session ----
// Carbohydrate availability is set for each session by what it demands, and the
// day's carbs are the sum of the work, not a tier picked by the day's name.
//   low    a Zone 1 ride under 90 min, in the morning: coffee and a Huel shake before (under 20 g), water on the
//          bike, protein and modest carbs after. At most TRAIN_LOW_PER_WEEK a week, never on a hard day
//          or the day before one (Marquet 2016: sleep-low works in blocks, with the hard work fuelled).
//   light  a Zone 1 ride under two hours: 0.5 g/kg before, 30 g an hour, 1 g/kg in the two hours after.
//   long   two hours and up: 1 g/kg before, 60 g an hour, 1.2 g/kg after.
//   hard   VO2, threshold, a race: 1 g/kg before, the 50 g bottle, 1.2 g/kg after ("recover-high").
//   lift   30 g protein before, 40 g after; its carbs follow the day's riding.
// The day: 1.5 g/kg as the floor plus 0.15 g for every kJ of riding (a 600 kJ Zone 1 ride adds about
// 90 g), capped at 6 g/kg. Burke 2011 gives the bands; Hector & Phillips 2018 the protein in a deficit.
const TRAIN_LOW_PER_WEEK = 1;
const CARB_BASE_PER_KG = 1.5, CARB_PER_KJ = 0.15, CARB_MAX_PER_KG = 6;
const HARD_RX = /vo2|40\s*\/\s*20|threshold|race|interval|sweet/i;
const RX_LABEL = { rest: 'rest day', low: 'train-low day', moderate: 'moderate carb day', high: 'higher carb day' };
function sessionRx(x, kg, ftp, o) {
  o = o || {};
  const w = kg > 40 ? kg : PROFILE.kg;
  const name = String(x.name || '');
  if (!isRideSession(x)) return { kind: 'lift', name, time: x.time || null, minutes: x.minutes || null, kj: 0, work_carbs_g: 0,
    before: { carbs_g: null, protein_g: 30, low: false, words: '30 g protein before it' }, during: { carbs_g: 0, g_per_h: 0, words: 'Water' },
    after: { carbs_g: null, protein_g: 40, within_min: 120, words: '40 g protein after; the carbs follow the riding' } };
  const mins = x.minutes || 60;
  const kj = Math.round(x.kcal || (x.tss ? x.tss * (ftp || 175) * 0.036 : mins * 2.2 * (ftp || 175) / 175 * 3));   // kcal on a bike ≈ kJ; no TSS: ~2.2 kcal/min at FTP 175
  const hard = HARD_RX.test(name);
  let kind = hard ? 'hard' : mins >= 120 ? 'long' : mins >= 90 ? 'light' : (o.allow_low ? 'low' : 'light');
  const ob = onBike(mins, hard);
  const g = v => Math.round(v);
  // the carbs the work itself asks for: 0.15 g a kJ (a fifth more when it is hard), split around the ride,
  // before 45% and after 75% of it (the after carries recovery too), each held inside the g/kg bands
  const work = kj * CARB_PER_KJ * (hard ? 1.2 : 1);
  // before a long or a hard ride the plate is a real breakfast: 0.6 g/kg (long) or 0.4 g/kg (hard) at least, 1 g/kg at most
  const beforeFloor = kind === 'long' ? 0.6 * w : kind === 'hard' ? 0.4 * w : 25;
  const beforeG = kind === 'low' ? 20 : g(Math.max(beforeFloor, Math.min(1.0 * w, work * 0.45)));
  const afterG = g(Math.max(0.4 * w, Math.min(1.2 * w, work * 0.75)));
  const rx = kind === 'low' ? {
      before: { carbs_g: 20, protein_g: 20, low: true, hours_before: 0.75, words: 'Coffee and a Huel shake (20 g protein); under 20 g of carbs. This is the low ride of the week.' },
      during: { carbs_g: 0, g_per_h: 0, words: 'Water only.' },
      after: { carbs_g: afterG, protein_g: 45, within_min: 120, words: `Within 2 hours: 45 g protein and about ${afterG} g carbs.` } }
    : kind === 'light' ? {
      before: { carbs_g: beforeG, protein_g: 30, low: false, hours_before: 1.5, words: `About ${beforeG} g carbs with 30 g protein, 1 to 2 hours before.` },
      during: { carbs_g: ob.carbs, g_per_h: mins >= 75 ? 30 : 0, words: ob.what },
      after: { carbs_g: afterG, protein_g: 45, within_min: 120, words: `Within 2 hours: 45 g protein and about ${afterG} g carbs.` } }
    : kind === 'long' ? {
      before: { carbs_g: beforeG, protein_g: 30, low: false, hours_before: 2.5, words: `About ${beforeG} g carbs 2 to 3 hours before: oats, fruit, a Huel shake.` },
      during: { carbs_g: ob.carbs, g_per_h: 60, words: ob.what },
      after: { carbs_g: afterG, protein_g: 45, within_min: 120, words: `Within 2 hours: 45 g protein and about ${afterG} g carbs; starch at dinner too.` } }
    : {
      before: { carbs_g: beforeG, protein_g: 30, low: false, hours_before: 2.5, words: `About ${beforeG} g carbs 2 to 3 hours before: oats, fruit, a Huel shake.` },
      during: { carbs_g: ob.carbs, g_per_h: 50, words: ob.what },
      after: { carbs_g: afterG, protein_g: 45, within_min: 120, words: `Within 2 hours: 45 g protein and about ${afterG} g carbs. Recover high.` } };
  // what the session adds to the day's carbs: its windows (a low ride's before is not carbs)
  return Object.assign({ kind, name, time: x.time || null, minutes: mins, kj, hard, work_carbs_g: (kind === 'low' ? 0 : rx.before.carbs_g) + (rx.during.carbs_g || 0) + rx.after.carbs_g }, rx);
}
// ctx: { hard_tomorrow, low_used_week, evening_yesterday }
function fuelRx(sessions, kg, ftp, ctx) {
  ctx = ctx || {};
  const w = kg > 40 ? kg : PROFILE.kg;
  const list = (sessions || []).slice().sort((a, b) => (toMin(a.time) == null ? 1e9 : toMin(a.time)) - (toMin(b.time) == null ? 1e9 : toMin(b.time)));
  const rides = list.filter(isRideSession);
  const hardToday = rides.some(x => HARD_RX.test(String(x.name || '')) || (x.minutes || 0) >= 120);
  let lowUsed = ctx.low_used_week || 0, lowTaken = false;
  const out = list.map(x => {
    const allow = isRideSession(x) && !lowTaken && !hardToday && !ctx.hard_tomorrow && lowUsed < TRAIN_LOW_PER_WEEK
      && (x.minutes || 60) < 90 && !HARD_RX.test(String(x.name || '')) && (toMin(x.time) == null || toMin(x.time) < 12 * 60);
    const r = sessionRx(x, w, ftp, { allow_low: allow });
    if (r.kind === 'low') { lowTaken = true; lowUsed++; }
    return r;
  });
  const work = out.reduce((a, r) => a + (r.work_carbs_g || 0), 0);
  const carbs_g = Math.round(Math.min(CARB_MAX_PER_KG * w, CARB_BASE_PER_KG * w + work));
  const level = !rides.length ? 'rest' : hardToday ? 'high' : lowTaken ? 'low' : 'moderate';
  const lowRide = out.find(r => r.kind === 'low');
  const sleep_low = !!(lowRide && ctx.evening_yesterday && toMin(lowRide.time) != null && toMin(lowRide.time) < 10 * 60);
  return { sessions: out, carbs_g, per_kg: Math.round(carbs_g / w * 10) / 10, level, label: RX_LABEL[level], train_low: lowTaken, sleep_low, low_used_week: lowUsed,
    day: level === 'high' ? 'high' : level === 'rest' ? 'rest' : 'normal' };
}

// Riding energy for a day: Strava's number when the ride is done, an estimate
// from planned TSS otherwise (TSS × FTP × 0.036 ≈ kJ, and kJ ≈ kcal on a bike).
// A Kettlebell Blast (his at-home extra, WeightTraining, ~30 min) is about 6 kcal a minute, whatever the
// watch or the TSS says: not a ride, and not the cycling estimate.
const BLAST = /kettlebell\s*blast/i, BLAST_KCAL_MIN = 6;
const isBlast = x => !!x && BLAST.test(String(x.name || ''));
function workoutKcal(sessions, ftp) {
  let k = 0;
  for (const x of sessions || []) {
    if (isBlast(x)) k += Math.round((x.minutes || 30) * BLAST_KCAL_MIN);
    else if (x.kcal) k += x.kcal;
    else if (x.tss) k += x.tss * (ftp || 175) * 0.036;
  }
  return Math.round(k);
}

// The sessions whose energy the day's target carries: once anything is ridden, the rides done (each
// one, planned or not) and whatever is still ahead; before that, the plan.
function burnList(done, ahead) { return (done || []).concat(ahead || []); }

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
  // fuel for the work required: when the sessions' prescriptions give the carbs, they are the carbs (between the
  // floor and 6 g/kg), fat takes what is left of the calories down to its floor, and past that the deficit gives
  if (o.rx && Number.isFinite(o.rx.carbs_g)) {
    carbs_g = Math.max(Math.round(p.kg * CARB_BASE_PER_KG), Math.min(Math.round(p.kg * CARB_MAX_PER_KG), Math.round(o.rx.carbs_g)));
    fat_g = Math.round((kcal - protein_g * 4 - carbs_g * 4) / 9);
    if (fat_g < fat_floor) { const need = protein_g * 4 + carbs_g * 4 + fat_floor * 9; trimmed += need - kcal; kcal = Math.round(need / 10) * 10; fat_g = fat_floor; }
  }
  return { kcal, carbs_g, protein_g, fat_g, fuel_day: o.rx && o.rx.label ? o.rx.label : (LABEL[day] || LABEL.normal), day, rx: o.rx || null,
    base_burn: baseBurn(p), bmr: bmr(p), age: p.age, cm: p.cm, ride_kcal: Math.round(kcalFromRiding || 0), deficit: kcal - burn,
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
  } else if (day === 'normal' && o.rx && o.rx.train_low) {
    g.push({ key: 'pre', text: 'Train-low day: coffee and a Huel shake before the ride, under 20 g of carbs; water on the bike.' });
    g.push({ key: 'carbs', text: 'Carbs after the ride and at the main meals later; none before it.' });
    g.push({ key: 'post', text: 'Protein and carbs within 2 hours of the ride: recover high.' });
  } else if (day === 'normal') {
    g.push({ key: 'pre', text: 'Zone 1 day: light carbs with protein 1 to 2 hours before the ride.' });
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
function cue(day, sessions, nowIso, rx) {
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
                        : rx && rx.train_low ? `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: coffee and a Huel shake, then go: the low ride of the week. Breakfast after.`
                        : `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: a banana or a Huel shake, then go. Breakfast after.`)
      : toMin(next.x.time) != null && toMin(next.x.time) >= 11 * 60
      ? `${name} in ${Math.round(next.dt / 60 * 10) / 10} h: something light with protein now, Greek yogurt, a Huel shake or a small rice bowl. Nothing heavy.`
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
// A session's end in minutes from today's midnight: a ride from 11:00p to 12:30a ends at 1470, not at 30
// (its end_time "00:30" read as the same morning made the ride zero minutes long and lost its bottle and
// its post-ride meal).
function endOf(x, start) {
  let e = toMin(x.end_time);
  if (e != null) { if (e < start) e += 1440; return e; }
  return start + (x.minutes || 60);
}
// A slot's minute in the day: past midnight it is 1440 and up (at_min), so it sorts last, never first.
const mmin = m => m == null ? null : (m.at_min != null ? m.at_min : toMin(m.time));
function stamp(row, t) {
  const r = Math.round(t / 5) * 5;
  row.time = toHM(r);
  if (r >= 1440) { row.next_day = true; row.at_min = r; } else { delete row.next_day; delete row.at_min; }
  return row;
}

// sleep: { wake, bed } in minutes (sleep-window.js; 6:30 and 10:30 p.m. by default). Sleep comes first: no
// meal before waking, dinner at least 2.5 h before bed, the evening snack 1.5 h before it.
function mealPlan(day, sessions, target, sleep, opts) {
  return carbLoad(mealPlanOf(day, sessions, target, sleep), opts);
}
// The night before a hard ride that starts before 10 a.m., dinner is the carb meal: about 1.2 g of carbs per kg
// (roughly 120 g at 98 kg), with its protein, inside its calories (fat gives way). Breakfast an hour before a 7:00
// start cannot fill the legs. When the ride moves to the afternoon, the plan goes back to normal by itself.
const LOAD_G_PER_KG = 1.2;
const hm12 = t => { const m = toMin(t); if (m == null) return t || ''; const h = Math.floor(m / 60) % 24, mi = m % 60; return `${h % 12 || 12}:${String(mi).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`; };
// Snacks where the day needs them (Harry, 10 Nov: "Should we add snacks?" ... "Make some adjustments"):
//  A. a snack never lands inside coaching, a class or work: it moves to half an hour before the block (an hour
//     after the meal before it at least), else just after it (an hour before bed at most);
//  B. a lift or a hard ride with no food planned in the 4 hours before it gets a small snack an hour before (a Huel
//     shake: 20 g protein, little carb), taken out of the next main meal, so the day's total does not move. An easy
//     ride is left alone: a fasted Zone 1 morning is allowed.
// opts: { busy: [{ start, end, name }], sessions: [{ start, end, name, kind: 'lift'|'hard'|'easy' }], wake, bed }
const SHAKE = { kcal: 105, carbs_g: 5, protein_g: 20 };
function placeSnacks(meals, opts) {
  const o = opts || {}, out = (meals || []).map(m => Object.assign({}, m));
  const wake = o.wake != null ? o.wake : 6 * 60 + 30, bed = o.bed != null ? o.bed : 22 * 60 + 30;
  const busy = (o.busy || []).filter(b => b.end > b.start);
  const mainBefore = t => out.filter(m => m.slot !== 'snack' && !m.extra && (m.kcal || 0) > 150 && mmin(m) != null && mmin(m) < t).map(mmin).sort((a, b) => b - a)[0];
  // A: out of the busy blocks
  for (const m of out) {
    if (m.slot !== 'snack' || mmin(m) == null) continue;
    const t = mmin(m), b = busy.find(x => t >= x.start && t < x.end);
    if (!b) continue;
    const prev = mainBefore(t), early = b.start - 30, late = b.end + 5;
    const nt = early >= wake && (prev == null || early >= prev + 60) ? early : late <= bed - 60 ? late : null;
    if (nt == null) continue;
    m.moved_from = m.time; m.time = toHM(nt); delete m.at_min;
    m.what = `${String(m.what || '').replace(/\s*$/, '')} ${nt < b.start ? 'Before' : 'After'} ${b.name || 'the block'}.`.trim();
  }
  // B: nothing in the 4 hours before a lift or a hard ride
  for (const s of (o.sessions || []).filter(x => x.kind === 'lift' || x.kind === 'hard')) {
    const fed = out.some(m => !m.extra && (m.kcal || 0) > 0 && mmin(m) != null && mmin(m) >= s.start - 240 && mmin(m) < s.start);
    const at = s.start - 60;
    if (fed || at < wake) continue;
    const next = out.filter(m => !m.extra && m.slot !== 'snack' && (m.kcal || 0) > SHAKE.kcal + 150 && mmin(m) != null && mmin(m) > s.start).sort((a, b) => mmin(a) - mmin(b))[0];
    out.push({ time: toHM(at), slot: 'before', kcal: SHAKE.kcal, carbs_g: SHAKE.carbs_g, protein_g: SHAKE.protein_g, low_carb: true, gap_snack: true,
      what: `Before ${s.name}: a Huel shake, about 20 g protein, so you don't ${s.kind === 'lift' ? 'lift' : 'ride hard'} on empty.` });
    if (next) { next.kcal = r5(next.kcal - SHAKE.kcal); next.protein_g = Math.max(0, r5((next.protein_g || 0) - SHAKE.protein_g)); next.carbs_g = Math.max(0, r5((next.carbs_g || 0) - SHAKE.carbs_g)); }
  }
  return out.sort((a, b) => mmin(a) - mmin(b));
}
function carbLoad(meals, opts) {
  const o = opts || {}, f = o.load_for;
  if (!f) return meals;
  const dinner = (meals || []).filter(m => m.slot === 'dinner' || (m.slot === 'after' && toMin(m.time) >= 16 * 60)).sort((a, b) => mmin(b) - mmin(a))[0];
  if (!dinner) return meals;
  const g = r5(Math.min(LOAD_G_PER_KG * (o.kg || PROFILE.kg), (dinner.kcal || 0) * 0.65 / 4));
  if (g <= (dinner.carbs_g || 0)) { dinner.carb_load = { name: f.name, time: f.time, min_g: dinner.carbs_g }; return meals; }
  dinner.carbs_g = g; delete dinner.low_carb; dinner.carb_load = { name: f.name, time: f.time, min_g: g };
  const why = `Tomorrow's ${f.name} at ${hm12(f.time)} runs on tonight's carbs`;
  dinner.what = dinner.post_ride ? `${dinner.what} ${why}: make it about ${g} g.` : `High carb: ${why}. Rice, potatoes or pasta, about ${g} g carbs, with ${dinner.protein_g || 45} g protein.`;
  return meals;
}
function mealPlanOf(day, sessions, target, sleep) {
  const SL = sleep || {}, WAKE = SL.wake != null ? SL.wake : 6 * 60 + 30, BED = SL.bed != null ? SL.bed : 22 * 60 + 30;
  const dinnerBy = m => Math.min(m, BED - 150), snackAt = m => Math.min(m, BED - 90);
  const t = target || targets(day, 0);
  // the day is laid out around the first ride; a lift or a run never gets a "before" meal or an on-the-bike slot
  const timed = (sessions || []).filter(x => isRideSession(x) && toMin(x.time) != null)
    .map(x => ({ x, start: toMin(x.time), end: endOf(x, toMin(x.time)) }))
    .sort((a, b) => a.start - b.start)[0];
  const meal = (time, slot, what, share, carbShare, protein) => stamp({
    slot, what,
    kcal: r5(t.kcal * share), carbs_g: r5(t.carbs_g * carbShare), protein_g: protein
  }, time);
  const out = [];
  const restDay = day === 'rest';
  // A low-carb breakfast means it: 20 g of carbs at most (eggs, Greek yogurt, a
  // smoothie with berries), 30 g of protein, about 350 kcal. The carbs it does
  // not carry move to the meal after the ride. Graded as low carb: under on
  // carbs is the point, not a miss.
  const LOW_CARB_G = 20;
  const lowCarb = (time, slot, what, protein) => Object.assign(meal(time, slot, what, 0.15, 0, protein), { carbs_g: LOW_CARB_G, low_carb: true });
  const bfast = (time, pre) => restDay ? Object.assign(meal(time, 'breakfast', 'Protein first: eggs or Greek yogurt, fruit. No starch.', 0.25, 0.15, 45), { low_carb: true })
    : day === 'high' ? meal(time, 'breakfast', pre ? `Carb breakfast 2 to 3 hours before ${pre}: 70 g oats, fruit, a Huel shake.` : 'Oats and fruit, a Huel shake beside it.', 0.25, 0.30, 45)
    : lowCarb(time, 'breakfast', pre ? `Low carb breakfast before ${pre}, under ${LOW_CARB_G} g of carbs, 30 g protein: eggs, Greek yogurt or a smoothie. No toast.` : `Protein smoothie or eggs, 30 g protein, under ${LOW_CARB_G} g of carbs.`, 30);
  // Shares of the day's calories and carbs; each layout below hands out the whole day once.
  const lunch = (time, share, carbShare) => meal(time, 'lunch', restDay ? 'Protein and vegetables. Big salad with chicken or fish.' : 'Protein with rice or potatoes, vegetables.', share == null ? 0.30 : share, carbShare == null ? (restDay ? 0.25 : 0.35) : carbShare, 50);
  const dinner = (time, share, carbShare) => meal(time, 'dinner', restDay ? 'Protein, vegetables and the one starch of the day.'
    : day === 'high' ? 'Protein, vegetables, and a proper starch. Carbs still count today.' : 'Protein and vegetables, starch beside it.', share == null ? 0.35 : share, carbShare == null ? (restDay ? 0.50 : 0.40) : carbShare, 55);
  const snack = time => meal(time, 'snack', `A Huel shake or cottage cheese if protein is short of ${t.protein_g} g.`, 0.10, 0.08, 25);
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
  // It belongs to its ride: marked post_ride, so a lift later never drags it along.
  const after = (slot, share, carbShare) => Object.assign(meal(end + 30, slot, (day === 'high'
    ? 'Within 2 hours of the ride: 45 g protein and carbs. Post-ride bowl, or chocolate milk and a rice ball.'
    : 'Within 2 hours of the ride: 45 g protein and carbs. Post-ride bowl.'), share, carbShare, 50), { post_ride: true, ride_end: end });
  // After a late ride (back after 10 p.m., or past midnight) the post-ride meal is a bedtime snack:
  // protein and some carbs, small enough to sleep on. Dinner stays at dinner time.
  const bedtime = (endMin, share, carbShare) => Object.assign(meal(endMin + 30, 'after',
    'After the ride, before bed: 25 g protein and some carbs. A glass of milk and a banana, or Greek yogurt with honey.', share, carbShare, 25), { post_ride: true, ride_end: endMin });
  // A carb breakfast wants 2.5 h before a hard ride; a light low-carb one 1.5 h
  // before Zone 1. Breakfast sits at the latest of those, and if that would mean
  // getting up before waking it becomes coffee and a Huel shake 45 minutes out (never before waking), with
  // breakfast after the ride instead.
  const gap = day === 'high' ? 150 : 90;
  const early = start - gap < WAKE;

  if (start < 11 * 60) {
    // Morning ride: breakfast before it (or nothing before a dawn ride), the post-ride meal, then the day.
    if (early) out.push(meal(Math.max(WAKE, start - 45), 'before', day === 'high'
      ? `Small and quick before ${name}: a banana or two rice cakes with honey.`
      : `Coffee and a Huel shake (20 g protein) before ${name}. Zone 1 needs no carbs before it; the protein protects the muscle.`, day === 'high' ? 0.08 : 0.04, day === 'high' ? 0.12 : 0, day === 'high' ? 0 : 20));
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
    out.push(dinner(dinnerBy(Math.max(18 * 60 + 30, l + 300)), Math.round(left * (hasLunch ? 0.6 : 1) * 100) / 100, Math.round(leftC * (hasLunch ? 0.6 : 1) * 100) / 100));
    out.push(snack(snackAt(20 * 60 + 45)));
  } else if (start < 15 * 60) {
    // Midday ride: breakfast carries the pre-ride role (as late as 9:30), the post-ride meal is lunch.
    out.push(bfast(Math.min(9 * 60 + 30, start - gap), name));
    if (start - gap > 9 * 60 + 30 + 60) out.push(meal(start - 120, 'before', day === 'high'
      ? `Two hours before ${name}: rice cakes and honey, or a banana and yogurt.`
      : `Two hours before ${name}: something light with protein, Greek yogurt or a Huel shake.`, 0.08, day === 'high' ? 0.12 : 0.04, 20));
    out.push(onBikeSlot);
    const hasBefore = start - gap > 9 * 60 + 30 + 60;
    const used = (day === 'high' ? 0.25 : 0.15) + (hasBefore ? 0.08 : 0) + 0.10, usedC = (day === 'high' ? 0.30 : 0.08) + (hasBefore ? (day === 'high' ? 0.12 : 0.04) : 0) + 0.08;
    out.push(after('lunch', Math.round((1 - used) * 0.5 * 100) / 100, Math.round((1 - usedC) * 0.5 * 100) / 100));   // carries what the low-carb breakfast did not
    out.push(dinner(dinnerBy(Math.max(18 * 60 + 30, end + 240)), Math.round((1 - used) * 0.5 * 100) / 100, Math.round((1 - usedC) * 0.5 * 100) / 100));
    out.push(snack(snackAt(20 * 60 + 45)));
  } else if (end + 30 > BED - 30) {
    // Late ride (back after 10 p.m., or past midnight): dinner at dinner time, a light bite before
    // the ride when dinner is far from it, and a bedtime snack after it. Nothing vanishes.
    const b = day === 'high' ? 0.25 : 0.15, bC = day === 'high' ? 0.30 : 0.08;
    const lC = day === 'high' ? 0.25 : 0.30;
    const dnT = Math.min(18 * 60 + 30, start - 150);
    const hasBefore = start - dnT >= 210;
    const pre = hasBefore ? 0.05 : 0, preC = hasBefore ? (day === 'high' ? 0.10 : 0.05) : 0;
    const post = 0.10, postC = day === 'high' ? 0.15 : 0.12;
    out.push(bfast(9 * 60));
    out.push(lunch(13 * 60, 0.27, lC));
    out.push(dinner(dnT, Math.round((1 - b - 0.27 - pre - post) * 100) / 100, Math.round((1 - bC - lC - preC - postC) * 100) / 100));
    if (hasBefore) out.push(meal(start - 90, 'before', day === 'high'
      ? `Before ${name}: a banana or two rice cakes with honey.`
      : `Before ${name}: something light with protein, Greek yogurt or a Huel shake.`, pre, preC, 15));
    out.push(onBikeSlot);
    out.push(bedtime(end, post, postC));
  } else {
    // Evening ride: a late breakfast, lunch, a light pre-ride meal, and the post-ride meal is dinner.
    out.push(bfast(9 * 60));
    out.push(lunch(13 * 60, 0.27, day === 'high' ? 0.25 : 0.30));
    out.push(meal(start - 120, 'before', day === 'high'
      ? `Two hours before ${name}: carbs that sit light, rice cakes and honey or a banana and yogurt.`
      : `Two hours before ${name}: something light with protein, Greek yogurt or a Huel shake. No big plate.`, 0.10, day === 'high' ? 0.15 : 0.05, 20));
    out.push(onBikeSlot);
    const lateSnack = end + 30 <= 20 * 60;
    out.push(after('dinner', Math.round((1 - (day === 'high' ? 0.25 : 0.15) - 0.27 - 0.10 - (lateSnack ? 0.10 : 0)) * 100) / 100,
      Math.round((1 - (day === 'high' ? 0.30 : 0.08) - (day === 'high' ? 0.25 : 0.30) - (day === 'high' ? 0.15 : 0.05) - (lateSnack ? 0.08 : 0)) * 100) / 100));   // carries what the low-carb breakfast did not
    if (lateSnack) out.push(snack(snackAt(21 * 60)));
  }
  // A second timed session later in the day: the meals already laid out step around it. Nothing
  // lands inside it or in the hour before it; dinner never comes before an evening session ends;
  // the second session gets its own bottle when its length calls for one.
  // A lift or a run steps the meals around it but never takes the ride's post-ride meal as its own:
  // that meal keeps the ride's words only while it is still after the ride.
  const others = (sessions || []).filter(x => toMin(x.time) != null)
    .map(x => ({ x, start: toMin(x.time), end: endOf(x, toMin(x.time)) }))
    .filter(o => o.x !== timed.x).sort((a, b) => a.start - b.start);
  for (const s2 of others) {
    const ride2 = isRideSession(s2.x);
    const ob = onBike(Math.max(0, s2.end - s2.start), /vo2|40\s*\/\s*20|threshold|race/i.test(s2.x.name || ''));
    // every ride gets its own bottle when its length calls for one, the second as much as the first
    if (ride2 && ob.carbs > 0 && !out.some(m => m.slot === 'on the bike' && toMin(m.time) === s2.start)) out.push({ time: toHM(s2.start), slot: 'on the bike', what: ob.what, kcal: ob.carbs * 4, carbs_g: ob.carbs, protein_g: 0, extra: true });
    for (const m of out) {
      if (m.extra || m.slot === 'on the bike') continue;
      const tm = mmin(m);
      if (!(tm >= s2.start - 60 && tm <= s2.end + 20)) continue;
      let to = tm < s2.start ? Math.max(11 * 60, s2.start - 120) : s2.end + 30;
      // a post-ride meal is never before its own ride is over: right after the ride when there is room before the next session, else after it
      if (m.post_ride && to < m.ride_end + 15) to = m.ride_end + 15 <= s2.start - 45 ? m.ride_end + 15 : s2.end + 30;
      stamp(m, to);
      if (m.post_ride && !ride2 && to > m.ride_end + 120) m.what = `After the ride and the ${/run/i.test(String(s2.x.sport || '') + ' ' + String(s2.x.name || '')) ? 'run' : 'lift'}: 45 g protein and carbs.`;
    }
    const dn = out.find(m => m.slot === 'dinner');
    // dinner never comes before an evening session ends, unless it is a ride's own post-ride meal and this is a lift
    if (dn && s2.end >= 17 * 60 && s2.end + 30 <= 22 * 60 && mmin(dn) < s2.end + 30 && !(dn.post_ride && !ride2)) stamp(dn, s2.end + 30);
    // a second ride that ends late gets its own bedtime snack, not a dinner pushed past midnight
    if (ride2 && s2.end + 30 > 22 * 60 && s2.end - s2.start >= 45 && !out.some(m => m.post_ride && m.ride_end >= s2.end)) {
      const snackAfter = Object.assign(meal(s2.end + 30, 'after', 'After the ride, before bed: 25 g protein and some carbs. A glass of milk and a banana, or Greek yogurt with honey.', 0.08, 0.10, 25), { post_ride: true, ride_end: s2.end });
      if (dn) { dn.kcal = Math.max(0, dn.kcal - snackAfter.kcal); dn.carbs_g = Math.max(0, dn.carbs_g - snackAfter.carbs_g); }   // the day is handed out once
      out.push(snackAfter);
    }
  }
  // fuel for the work required: the ride's own slots take the session's prescription (the grams before, in the
  // bottle and after), and are then fixed; the other meals share what is left of the day
  if (t.rx && Array.isArray(t.rx.sessions)) {
    const rxOf = st => t.rx.sessions.find(r => r.kind !== 'lift' && toMin(r.time) === st) || null;
    const firstRx = rxOf(start);
    if (firstRx) {
      const pre = out.filter(m => !m.extra && !m.post_ride && mmin(m) < start && mmin(m) >= start - 240).sort((a, b) => mmin(b) - mmin(a))[0];
      const earlyBite = pre && mmin(pre) >= start - 60 && !firstRx.before.low;
      const preG = pre ? (earlyBite ? Math.min(30, firstRx.before.carbs_g) : firstRx.before.carbs_g) : 0;
      if (pre) { pre.carbs_g = preG; pre.low_carb = !!firstRx.before.low; pre.fixed = true; pre.rx = firstRx.kind; if (firstRx.before.low) pre.what = `${firstRx.before.words} Breakfast after the ride.`; }
      const post = out.find(m => m.post_ride && m.ride_end === end);
      if (post) { post.carbs_g = firstRx.after.carbs_g + (pre ? firstRx.before.carbs_g - preG : 0); post.protein_g = firstRx.after.protein_g; post.fixed = true; post.rx = firstRx.kind; post.what = firstRx.after.words; }
    }
    for (const m of out) if (m.slot === 'on the bike') { const r = rxOf(toMin(m.time)); if (r) { m.carbs_g = r.during.carbs_g; m.kcal = r.during.carbs_g * 4; m.what = r.during.words; m.rx = r.kind; } }
  }
  // the bottles and the fixed slots are eaten too: the day's target holds them, so the meals share what is left (a day ends on its plan)
  { const extra = out.filter(m => m.extra || m.fixed), rest = out.filter(m => !m.extra && !m.fixed);
    const eK = extra.reduce((a, m) => a + (m.kcal || 0), 0), eC = extra.reduce((a, m) => a + (m.carbs_g || 0), 0);
    const rK = rest.reduce((a, m) => a + (m.kcal || 0), 0), rC = rest.reduce((a, m) => a + (m.carbs_g || 0), 0);
    if (eK > 0 && rK > 0 && t.kcal) { const f = Math.max(0.5, (t.kcal - eK) / rK), fc = rC > 0 && t.carbs_g ? Math.max(0.5, (t.carbs_g - eC) / rC) : 1;
      for (const m of rest) { m.kcal = r5(m.kcal * f); if (m.carbs_g && !m.low_carb) m.carbs_g = r5(m.carbs_g * fc); } } }
  return out.sort((a, b) => mmin(a) - mmin(b));
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
// Which slot a logged meal belongs to. The word he used wins when it names
// a slot of the day's plan ("breakfast" at 6:47 is breakfast, however late
// the plan put it). Otherwise the nearest slot within 90 minutes; a meal
// eaten up to four hours before the first slot is the first slot (an early
// breakfast on a rest day whose plan says 9:00); after that the nearest
// slot within two and a half hours. null only when nothing is near.
// After 8 p.m. with dinner still open (nothing logged in it, its time come), a meal is dinner:
// the eggs at 9:26p are dinner, not the evening snack. opts.logged: the slot names that already
// hold food (the day payload's rows with logged ids); opts.last: the last plate logged {slot, time}.
const DINNER_LATE = 20 * 60;
function slotFor(plan, hm, mealHint, opts) {
  const o = opts || {};
  const slots = (plan || []).filter(p => p.slot && mmin(p) != null);
  const hint = String(mealHint || '').toLowerCase().trim();
  if (hint && hint !== 'supplement') {
    const direct = hint !== 'snack' ? slots.find(p => p.slot === hint) : null;   // "snack" is judged by time below
    if (direct) return direct.slot;
  }
  const m = toMin(hm);
  if (m == null) return null;
  if (!hint && m >= DINNER_LATE) {
    const logged = new Set(o.logged || slots.filter(p => (p.logged || []).length).map(p => p.slot));
    const dn = slots.find(p => p.slot === 'dinner');
    if (dn && !logged.has('dinner') && mmin(dn) <= m + 60) return 'dinner';
  }
  // then a second plate within 45 minutes of the last one is the same meal: the photo of the chicken after
  // the eggs goes where the eggs went
  if (!hint && o.last && o.last.slot && toMin(o.last.time) != null && m - toMin(o.last.time) >= 0 && m - toMin(o.last.time) <= 45 && slots.some(p => p.slot === o.last.slot)) return o.last.slot;
  // "snack" names the plan's snack only when that slot is near (within three hours); a morning coffee is not the evening snack
  if (hint === 'snack') { const sn = slots.find(p => p.slot === 'snack'); return sn && Math.abs(mmin(sn) - m) <= 180 ? 'snack' : null; }
  const nearest = (limit) => { let best = null; for (const p of slots) { const d = Math.abs(mmin(p) - m); if (d <= limit && (!best || d < best.d)) best = { p, d }; } return best ? best.p.slot : null; };
  const near = nearest(90); if (near) return near;
  const real = slots.filter(p => !p.extra).sort((a, b) => mmin(a) - mmin(b));
  if (real.length && m < mmin(real[0]) && mmin(real[0]) - m <= 240) return real[0].slot;
  return nearest(150);
}

// The plan a logged meal is graded against, taken once from the row the day payload shows at that
// minute (after any roll-forward), and kept on the entry. The verdict, the card and the Day row all
// read this one object.
function planSnapshot(row, at) {
  if (!row || row.kcal == null) return null;
  const s = { slot: row.slot, time: row.time, kcal: row.kcal, carbs_g: row.carbs_g || 0, protein_g: row.protein_g || 0, low_carb: !!row.low_carb, what: row.what || '', at: at || null };
  if (row.at_min != null) { s.at_min = row.at_min; s.next_day = true; }
  if (row.covered_by) s.covered_by = row.covered_by;
  if (row.rx) { s.rx = row.rx; s.fixed = !!row.fixed; s.post_ride = !!row.post_ride; }   // the prescription's slots keep their kind: judged as fuel
  return s;
}

// Keys for a plan's rows: the slot and its place among rows of the same name ("on the bike#1").
function slotKeys(plan) {
  const seen = {};
  return (plan || []).map(m => { const n = seen[m.slot] = (seen[m.slot] ?? -1) + 1; return `${m.slot}#${n}`; });
}
// A slot that only appeared after its own time had passed (a ride added at 9:37p brings a "before"
// at 8:00p) is not shown for today. seen: { key: 'HH:MM' first seen }. Returns the keys to hide and
// the map with new keys added; an empty map is the first look of the day, and everything in it counts
// as there from the start.
function pastOnArrival(plan, seen, nowHM) {
  const keys = slotKeys(plan), now = toMin(nowHM);
  const first = !seen || !Object.keys(seen).length;
  const next = Object.assign({}, seen || {});
  const hide = new Set();
  keys.forEach((k, i) => {
    if (!(k in next)) next[k] = first ? '00:00' : nowHM;
    const at = toMin(next[k]);
    if (at != null && now != null && mmin(plan[i]) < at) hide.add(k);
  });
  return { hide, seen: next, added: keys.filter(k => !(seen && k in seen)) };
}

// The day's rows, as every page reads them: a slot with food in it is frozen (its plan, numbers and
// grade from the snapshot taken when its first plate was logged, its row even when a later plan has
// no slot of that name), and the plan as it stands now reshapes only the open slots.
//   plan: the current plan rows; entries: the day's entries with their saved slots
//   ctx: { day_kcal, target_kcal, isDrink(e), hide: Set of slotKeys to leave out when open }
// The carb label every meal card and every coach sentence uses (Harry, 10 Nov: "make it very obvious when it's low
// carb, high carb or a balanced meal, and tie the coach's advice to it"). From the meal's own numbers: carbs as a share
// of its calories, under 20% low carb, 20 to 45% balanced, over 45% high carb (a 715 kcal post-ride dinner
// with 44 g of carbs is balanced, not low); a meal the plan keeps low (train-low,
// a rest-day breakfast) is low carb whatever its size. The bottle on the bike carries no label: it is all carbs.
const CARB_WORD = { low: 'Low carb', balanced: 'Balanced', high: 'High carb' };
function carbLabel(m) {
  if (!m || m.slot === 'on the bike' || !(m.kcal > 0)) return null;
  const share = (m.carbs_g || 0) * 4 / m.kcal;
  const key = m.low_carb ? 'low' : share < 0.20 ? 'low' : share <= 0.45 ? 'balanced' : 'high';
  return { key, word: CARB_WORD[key], pct: Math.round(share * 100) };
}

// Lunch and dinner say what the label means in food, so the words never promise rice on a low carb lunch
// (Harry, 10 Nov: the lunch read "Protein with rice or potatoes" while it was planned low carb). Only the plain
// lunch and dinner lines are rewritten; a post-ride meal, a rest-day plate or a plan line with its own reason keeps it.
const PLAIN = /^(Protein with rice or potatoes, vegetables\.|Protein and vegetables, starch beside it\.|Protein, vegetables, and a proper starch\. Carbs still count today\.)$/;
function carbWords(m, label) {
  if (!label || !/^(lunch|dinner)$/.test(m.slot) || m.post_ride || !PLAIN.test(String(m.what || ''))) return m.what;
  const g = Math.round(m.carbs_g || 0);
  return label.key === 'low' ? `Low carb: protein and vegetables, starch a fist at most (about ${g} g carbs).`
    : label.key === 'high' ? `High carb: protein and a proper plate of rice, potatoes or pasta (about ${g} g carbs).`
    : `Balanced: protein, vegetables and a palm of rice or potatoes (about ${g} g carbs).`;
}

function dayMeals(plan, entries, ctx) {
  const c = ctx || {};
  const isDrink = c.isDrink || (e => !!e.drink_only);
  const keys = slotKeys(plan);
  const rows = (plan || []).map((m, i) => Object.assign({}, m, { _key: keys[i] }));
  const es = (entries || []).filter(e => e && !e.supplement && e.slot);
  const byTime = (a, b) => String(a.time || '').localeCompare(String(b.time || ''));
  const assigned = new Map(), orphans = new Map();
  for (const e of es) {
    const same = rows.filter(r => r.slot === e.slot);
    if (!same.length) { if (!orphans.has(e.slot)) orphans.set(e.slot, []); orphans.get(e.slot).push(e); continue; }
    // two rows of one name (a bottle for each ride): the one nearest the time it was logged against
    const t = (e.plan && e.plan.slot === e.slot && mmin(e.plan) != null) ? mmin(e.plan) : (toMin(e.time) ?? 0);
    const r = same.reduce((a, x) => Math.abs(t - mmin(x)) < Math.abs(t - mmin(a)) ? x : a, same[0]);
    if (!assigned.has(r)) assigned.set(r, []); assigned.get(r).push(e);
  }
  const freeze = (base, mine) => {
    const food = mine.filter(e => !isDrink(e)).sort(byTime);
    if (!food.length) return null;
    const snap = food.map(e => e.plan).find(p => p && p.slot === base.slot && p.kcal != null);
    const row = Object.assign({}, base, { frozen: true });
    if (snap) {
      Object.assign(row, { kcal: snap.kcal, carbs_g: snap.carbs_g, protein_g: snap.protein_g, low_carb: !!snap.low_carb, what: snap.what || base.what, frozen_at: snap.at || null });
      if (snap.time) stamp(row, snap.at_min != null ? snap.at_min : toMin(snap.time));
      if (snap.covered_by) row.covered_by = snap.covered_by; else delete row.covered_by;
    }
    return row;
  };
  let out = [];
  for (const r of rows) {
    const mine = assigned.get(r) || [];
    const fr = freeze(r, mine);
    if (fr) out.push(Object.assign(fr, { _mine: mine }));
    else if (!(c.hide && c.hide.has(r._key))) out.push(Object.assign(r, { _mine: mine }));
  }
  // a slot with food that today's plan no longer has: kept, as it was when it was eaten
  for (const [slot, mine] of orphans) {
    const food = mine.filter(e => !isDrink(e)).sort(byTime);
    if (!food.length) continue;
    const snap = food.map(e => e.plan).find(p => p && p.slot === slot && p.kcal != null);
    const base = { slot, what: snap ? snap.what : '', kcal: snap ? snap.kcal : null, carbs_g: snap ? snap.carbs_g : null, protein_g: snap ? snap.protein_g : null, orphan: true };
    stamp(base, snap && snap.time ? (snap.at_min != null ? snap.at_min : toMin(snap.time)) : (toMin(food[0].time) ?? 0));
    const fr = freeze(base, mine);
    if (fr) out.push(Object.assign(fr, { _mine: mine }));
  }
  out.sort((a, b) => mmin(a) - mmin(b));
  out = rollForward(out, entries);
  return out.map(m => {
    const mine = m._mine || [];
    const food = mine.filter(e => !isDrink(e));
    const first = food.filter(e => /^\d{2}:\d{2}$/.test(e.time || '')).sort(byTime)[0];
    const carb = carbLabel(m);
    const row = Object.assign({}, m, { carb, what: carbWords(m, carb), logged: food.map(e => e.id),
      match: m.kcal == null ? null : mealMatch(m, mine, { day_kcal: c.day_kcal, target_kcal: c.target_kcal }), time_logged: first ? first.time : null });
    delete row._mine; delete row._key; delete row.ride_end;
    return row;
  });
}

// One photo's verdict, from the model's assessment, to points.
const FIT_POINTS = { yes: 100, partly: 60, no: 20 };
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHM = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const r5 = x => Math.round(x / 5) * 5;


// entries: [{at, meal, assessment:{protein_source, carbs, vegetables, processed, fits}}]
// rides: [{end_at}] done rides for the day, for the post-ride window.
function guidelineScore(day, entries, rides, plan) {
  const all = (entries || []).filter(x => x && x.assessment);
  if (!all.length) return { score: null, meals: 0, checks: [] };
  // A meal is its slot, not each thing logged into it (Harry, 9 Nov: "these add-ons should fold into the meal and
  // count against that meal"). The soy sauce beside the sushi is part of dinner: the meal has protein, vegetables
  // or starch when anything on it does; it is processed only when the processed things are a quarter of its
  // calories or more; and its fit is weighted by calories, so a 16 kcal add-on hardly moves it. Entries with no
  // slot stay meals of their own.
  const groups = {};
  all.forEach((x, i) => { const k = x.slot || ('_' + i); (groups[k] = groups[k] || []).push(x); });
  const CARB_RANK = { none: 0, some: 1, light: 1, moderate: 1, heavy: 2 };
  const e = Object.entries(groups).map(([k, xs]) => {
    const kcal = xs.reduce((t, x) => t + Math.max(1, x.kcal || 0), 0);
    const pk = xs.filter(x => x.assessment.processed).reduce((t, x) => t + Math.max(1, x.kcal || 0), 0);
    const carbs = xs.reduce((c, x) => (CARB_RANK[x.assessment.carbs] ?? 1) > (CARB_RANK[c] ?? 1) ? x.assessment.carbs : c, 'none');
    const fitPts = xs.reduce((t, x) => t + (FIT_POINTS[x.assessment.fits] ?? 60) * Math.max(1, x.kcal || 0), 0) / kcal;
    const first = xs.slice().sort((p, q) => String(p.at || '').localeCompare(String(q.at || '')))[0];
    return { slot: k.startsWith('_') ? null : k, at: first.at, entries: xs, fit_pts: fitPts,
      assessment: { protein_source: xs.some(x => x.assessment.protein_source), vegetables: xs.some(x => x.assessment.vegetables), carbs, processed: pk >= 0.25 * kcal } };
  });
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
    }));   // a meal counts from its first bite
    checks.push({ key: 'post', label: `fed within ${window} min of the ride`, ok: hit, detail: hit ? 'yes' : 'not yet' });
  }
  const fit = Math.round(e.reduce((t, x) => t + x.fit_pts, 0) / n);
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
  const due = meals.filter(m => mmin(m) <= now + 45);
  const realMeals = due.filter(m => !m.extra);
  if (!realMeals.length) return { kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, share: 0, meals: 0, next: (meals.find(m => !m.extra) || meals[0]).time };
  const kcal = due.reduce((a, m) => a + (m.kcal || 0), 0);
  // fat is spread over the real meals only: a bottle on the bike carries none
  const share = target.kcal ? Math.min(1, realMeals.reduce((a, m) => a + (m.kcal || 0), 0) / target.kcal) : 0;
  const nxt = meals.find(m => !m.extra && mmin(m) > now + 45);
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
  return open.find(m => mmin(m) >= now - 45) || null;
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
    if (a.low_carb || a.kcal == null || mmin(b) == null || mmin(a) == null || mmin(b) - mmin(a) > 150) continue;
    const got = es.filter(e => e.slot === a.slot);
    if (!got.length) continue;
    const sum = k => got.reduce((x, e) => x + (e[k] || 0), 0);
    const over = { kcal: Math.max(0, sum('kcal') - (a.kcal || 0)), carbs_g: Math.max(0, sum('carbs_g') - (a.carbs_g || 0)), protein_g: Math.max(0, sum('protein_g') - (a.protein_g || 0)) };
    if (over.kcal < 60 && over.carbs_g < 10 && over.protein_g < 10) continue;
    const aName = a.slot === 'after' ? 'post-ride meal' : a.slot === 'before' ? 'pre-ride snack' : a.slot;
    a.rolled_out = { to: b.slot, kcal: over.kcal, carbs_g: over.carbs_g, protein_g: over.protein_g };
    // a slot that already holds food keeps the plan it was eaten under: only open slots are reshaped
    if (b.frozen) continue;
    b.plan_kcal = b.plan_kcal ?? b.kcal; b.plan_carbs_g = b.plan_carbs_g ?? b.carbs_g; b.plan_protein_g = b.plan_protein_g ?? b.protein_g;
    b.kcal = Math.max(0, (b.kcal || 0) - over.kcal); b.carbs_g = Math.max(0, (b.carbs_g || 0) - over.carbs_g); b.protein_g = Math.max(0, (b.protein_g || 0) - over.protein_g);
    // protein the meal did not carry lands at the next slot (up to 25 g, with its calories), so the day's protein holds
    const proteinShort = Math.min(25, Math.max(0, (a.protein_g || 0) - sum('protein_g')));
    if (proteinShort >= 5) { b.protein_g += proteinShort; b.kcal += 4 * proteinShort; }
    if (b.carb_load) b.carbs_g = Math.max(b.carbs_g, b.carb_load.min_g || 0);   // a meal running over never takes the night-before carbs
    b.kcal = r5(b.kcal); b.carbs_g = r5(b.carbs_g); b.protein_g = r5(b.protein_g);
    b.rolled_from = { slot: a.slot, time: a.time, kcal: over.kcal, carbs_g: over.carbs_g, protein_g: over.protein_g, protein_short_g: proteinShort };
    if (b.plan_kcal > 0 && b.kcal < 0.4 * b.plan_kcal) { b.covered_by = a.slot; b.what = `covered by the ${aName}, which ran over; a protein bite if hungry.`; }
    else if (over.carbs_g >= 20 && b.carbs_g <= 0.6 * (b.plan_carbs_g || 1)) b.what = `${b.protein_g} g of protein and vegetables; the ${aName} carried the starch.`;
    else if (over.kcal >= 60) b.what = `${b.what} Lighter: the ${aName} ran ${over.kcal} kcal over${proteinShort >= 5 ? `, and ${proteinShort} g short on protein, so protein first` : ''}.`;
  }
  return out;
}

// Alcohol: counted in the calories, never on plan. One drink on a rest day is "partly";
// two or more is "no". The reader's own "fits" is overruled either way, and so is an old
// entry's when it is read back, so the journal never shows a pint in green.
const ALC = /\b(beers?|lagers?|ales?|ipas?|stouts?|porters?|pilsners?|wines?|prosecco|champagne|pints?|cocktails?|margaritas?|martinis?|whisk(e)?ys?|bourbon|scotch|vodka|gin|rum|tequila|ciders?|sake|mead|hard seltzers?|white claws?|negronis?|spritz|mimosas?|sangria|shots? of)\b/i;
const NUMS = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3 };
function alcoholOf(e) {
  if (!e || e.supplement) return 0;
  const text = [e.name, e.drink, e.written].filter(Boolean).join(' ');
  if (!ALC.test(text)) return 0;
  const m = /\b(\d+|a|one|two|three|four|five|six|couple|few)\b\s+(?:of\s+)?(?:\w+\s+){0,2}?(pints?|beers?|lagers?|ales?|glass(?:es)?|bottles?|cans?|drinks?|cocktails?|shots?|margaritas?|martinis?|ipas?)/i.exec(text);
  if (m) return Math.max(1, parseInt(m[1], 10) || NUMS[m[1].toLowerCase()] || 1);
  return Math.max(1, Math.round((e.kcal || 0) / 150));
}
function alcoholRule(e) {
  const n = alcoholOf(e);
  if (!n) return e;
  const a = Object.assign({}, e.assessment || {}, { fits: n >= 2 ? 'no' : 'partly' });
  return Object.assign({}, e, { alcohol: n, assessment: a });
}

function mealMatch(plan, logged, ctx) {
  // ctx: { day_kcal, target_kcal } — the day so far, so a light plate reads against the day it lands in
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
    // before a fuelled ride (a fixed pre-ride plate), carbs over the plan are fuel, not a miss, up to 60% over: they carry into the ride
    const preRide = plan.rx && plan.rx !== 'low' && !plan.post_ride && plan.fixed;
    const cOff = off(got.carbs_g, plan.carbs_g);
    if (plan.carbs_g > 0 || got.carbs_g > 0) parts.push({ k: 'carbs', off: preRide && cOff > 0 ? Math.max(0, cOff - 0.6) : cOff, both: true });
    if (plan.protein_g > 0) parts.push({ k: 'protein', off: off(got.protein_g, plan.protein_g), both: false });
  }
  // protein only counts when short; an overage that rolled into the next slot is not a miss here
  const miss = p => p.both ? (plan.rolled_out && p.off > 0 ? 0 : Math.abs(p.off)) : Math.max(0, -p.off);
  const worst = parts.reduce((a, p) => miss(p) > miss(a) ? p : a, parts[0] || { k: 'kcal', off: 0, both: true });
  const w = miss(worst);
  let keyM = w <= 0.2 ? 'green' : w <= 0.4 || !worst.both ? 'yellow' : 'red';
  const dir = worst.off > 0 ? 'over' : 'under';
  let wordM = keyM === 'green' ? 'macros on' : `${worst.k} ${Math.round(Math.abs(worst.off) * 100)}% ${dir}`;
  // an overage the plan took out of a later meal is not a miss, but it is said, so the slot and the fuel numbers agree
  const rolledOver = plan.rolled_out ? parts.filter(p => p.both && p.off > 0.2).sort((a, b) => b.off - a.off)[0] : null;
  if (rolledOver && keyM === 'green') wordM = `${rolledOver.k} ${Math.round(rolledOver.off * 100)}% over, taken from ${plan.rolled_out.to || "the next meal"}`;
  // A light plate that still brings its protein is never a red: under is a deficit, not a miss.
  // When the day is already at its calories, the light plate is the right call and reads green.
  const proteinIn = !(plan.protein_g > 0) || got.protein_g >= 0.8 * plan.protein_g;
  if (worst.both && worst.off < 0 && !plan.low_carb && proteinIn && keyM !== 'green') {
    const dayFull = ctx && ctx.target_kcal > 0 && ctx.day_kcal >= 0.95 * ctx.target_kcal;
    if (dayFull) { keyM = 'green'; wordM = 'light plate, day covered'; }
    else if (keyM === 'red') keyM = 'yellow';
  }
  // The rules are the other half of the grade: the plate's assessment against
  // the day's guidelines (fits yes, partly, no). One grade, the worse of the
  // two, so the word on the card and the word at logging time agree.
  const RANK = { green: 0, yellow: 1, red: 2 };
  let keyR = 'green', wordR = 'rules met', whyR = null;
  // The sentence on the card is the plate's own reading, never a drink's: a pint logged before
  // dinner was read before dinner existed. A drink still sets the word and the colour.
  // flags are judged against the whole slot, never one item: a pint beside a pound of shrimp
  // has no protein source, the plate has plenty
  const slotProtein = l.some(e => e.assessment && e.assessment.protein_source) || got.protein_g >= Math.max(20, 0.5 * (plan.protein_g || 0));
  const slotVeg = l.some(e => e.assessment && e.assessment.vegetables);
  const plates = l.filter(e => !e.alcohol && e.assessment && e.assessment.why);
  const worstPlate = plates.reduce((a, e) => !a || RANK[e.assessment.fits === 'no' ? 'red' : e.assessment.fits === 'partly' ? 'yellow' : 'green'] > RANK[a.assessment.fits === 'no' ? 'red' : a.assessment.fits === 'partly' ? 'yellow' : 'green'] ? e : a, null);
  const plateWhy = worstPlate ? worstPlate.assessment.why : null;
  for (const e of l) {
    const a = e.assessment; if (!a || !a.fits) continue;
    const k = a.fits === 'no' ? 'red' : a.fits === 'partly' ? 'yellow' : 'green';
    if (RANK[k] <= RANK[keyR] && keyR !== 'green') continue;
    if (RANK[k] > RANK[keyR] || keyR === 'green') {
      keyR = k;
      // the reason in a few words: a flag when one explains it, else the clause of the plate's own reading that starts with "but"
      const clip = why => { const m = /\bbut\s+([^,.;]{8,80})/i.exec(String(why || '')); if (!m) return null; const t = m[1].trim(); return t.length <= 42 ? t : t.slice(0, 42).replace(/\s+\S*$/, ''); };
      // fuel slots (before a ride, on the bike) are judged on their carbs alone: the plate rules (protein, vegetables,
      // one starch, nothing processed) are for meals, and a gel or a banana before a hard session meets them by design
      if (/^(before|on the bike)$/.test(plan.slot || '') && !e.alcohol) { keyR = 'green'; wordR = 'rules met'; continue; }
      wordR = k === 'green' ? 'rules met' : e.alcohol ? (e.alcohol >= 2 ? `${e.alcohol} drinks` : 'one drink') : a.processed ? 'processed' : a.carbs === 'heavy' && (plan.low_carb || (plan.carbs_g || 0) <= 30) ? 'heavy on starch' : (!slotProtein && (plan.protein_g || 0) >= 30) ? 'no protein source' : (!slotVeg && /lunch|dinner/.test(plan.slot || '')) ? 'no vegetables' : clip(a.why) || (k === 'red' ? 'against the rules' : 'rules partly met');
      whyR = plateWhy || a.why || null;
    }
  }
  if (plateWhy) whyR = plateWhy;
  const key = RANK[keyR] > RANK[keyM] ? keyR : keyM;
  const word = key === 'green' ? (rolledOver ? wordM : 'as planned') : RANK[keyR] > RANK[keyM] ? wordR : (RANK[keyM] > RANK[keyR] ? wordM : `${wordM} · ${wordR}`);
  return { key, word, kcal: got.kcal, carbs_g: got.carbs_g, protein_g: got.protein_g, worst: worst.k,
    macros: { key: keyM, word: wordM }, rules: { key: keyR, word: wordR, why: whyR } };
}

// The coach's sentence, whole: never cut mid-sentence. Past the limit it ends at the last full stop
// inside it; a sentence the model itself left hanging ("…no butter, and") goes back to its last whole
// sentence, or is closed where its last clause ends.
function tidyWhy(s, max) {
  const lim = max || 420;
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length > lim) {
    const cut = t.slice(0, lim);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), /[.!?]$/.test(cut) ? cut.length - 1 : -1);
    t = end >= 40 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '');
  }
  if (!/[.!?…)"'”]$/.test(t)) {
    const m = /^(.*[.!?])\s+[^.!?]*$/.exec(t);
    if (m && m[1].length >= 15) t = m[1];
    else t = t.replace(/[\s,;:–—-]+(and|but|or|so|with|then|because|the|a|an|to|of|for)?[\s,;:–—-]*$/i, '').replace(/[\s,;:–—-]+$/, '') + '.';
  }
  return t;
}

// The same words logged again within twenty minutes are the same food said twice, unless he says
// it was more ("another", "a second"). One rule for the Food page and the voice.
const normWords = t => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(a|an|the|one|of|and|with|i|had|have|just)\b/g, ' ').replace(/\s+/g, ' ').trim();
const SAYS_MORE = /\b(another|more|again|second|extra|other)\b/i;
function twinOf(entries, text, nowMin, windowMin) {
  const w = normWords(text);
  if (!w || SAYS_MORE.test(String(text || '')) || nowMin == null) return null;
  const win = windowMin || 20;
  return (entries || []).filter(e => e && !e.supplement && toMin(e.time) != null && nowMin - toMin(e.time) >= 0 && nowMin - toMin(e.time) <= win
    && (normWords(e.written) === w || normWords(e.name) === w)).sort((a, b) => String(b.time).localeCompare(String(a.time)))[0] || null;
}

// What the ride did to the day, in one line. A missing percentage is left out, never printed as null.
function workNote(w) {
  const pctTxt = w.pct != null ? ` (${w.pct}%)` : '';
  if (!w.pm) return `Ridden ${w.dm} min with nothing planned: today is a ${LABEL[w.actualDay]}.`;
  if (w.plannedDay === w.actualDay) return `Ridden ${w.dm} of ${w.pm} min planned${pctTxt}: still a ${LABEL[w.actualDay]}, sized to the ride.`;
  return `Planned ${w.pm} min (${LABEL[w.plannedDay]}); ridden ${w.dm} min${pctTxt}, so the rest of today is a ${LABEL[w.actualDay]}.`;
}

// The day's drinks, one list for every page: the Hydration page lists these, the Food page counts
// them, and "drank" is the sum of their volumes (alcohol at its poured volume; the balance takes its
// net). modelDrinks: hydration-live's drinks, by entry id, for the volume and net it counted.
const onDrinksList = e => !!e && !e.supplement && (!!e.is_drink || !!e.drink_only || (e.fluid_ml || 0) > 0);
function drinksOf(entries, modelDrinks) {
  const md = modelDrinks || [];
  const rows = (entries || []).filter(onDrinksList).map(e => {
    const d = md.find(x => x.id && x.id === e.id);
    return { id: e.id, ml: d ? d.ml : Math.max(0, Math.round(e.fluid_ml || 0)), net_ml: d && d.net_ml != null ? d.net_ml : null, alcohol: e.alcohol || 0, food: !e.is_drink && !e.drink_only, name: e.name || '' };
  });
  return { ids: rows.map(r => r.id), count: rows.length, food_count: rows.filter(r => r.food).length, ml: rows.reduce((a, r) => a + r.ml, 0), rows };
}


// Live energy, the way Hexis draws it: calories in minus calories out since midnight. The day's base burn
// (resting plus everyday movement) runs evenly through the 24 hours, each session's burn is spread over its
// minutes, food lands as a step at the time it was eaten. Before now the line is what happened; after now it
// is the plan: the open meals at their times and the sessions still ahead. Every 15 minutes.
// A session counts toward "now" only once it is done (done: true); one still planned burns nothing until
// now and, in the projection, burns its whole energy from now (or its start, if later). With no done flag
// at all a session is taken as it was always taken: on the clock.
// o.bmr splits the base burn into BMR and everyday movement for the meter's breakdown.
function balanceSeries(o) {
  const per = (o.baseBurn || 0) / 1440, nowMin = o.nowMin == null ? 1440 : o.nowMin;
  const sessions = (o.sessions || []).filter(x => x.start != null && x.end > x.start);
  const flagged = sessions.some(x => x.done != null);
  const isDone = x => !flagged || !!x.done;
  const food = (o.eaten || []).map(x => Object.assign({ projected: false }, x)).concat((o.planned || []).filter(x => x.min >= nowMin).map(x => Object.assign({ projected: true }, x)));
  const frac = (m, a, b) => Math.max(0, Math.min(1, (m - a) / (b - a)));
  const sessBurn = (x, m) => {
    if (isDone(x)) return x.kcal * frac(m, x.start, x.end);
    if (m <= nowMin) return 0;
    const a = Math.max(x.start, nowMin), b = a + (x.end - x.start);
    return x.kcal * frac(m, a, b);
  };
  const exTo = m => sessions.reduce((a, x) => a + sessBurn(x, m), 0);
  const burnTo = m => per * m + exTo(m);
  const inTo = m => food.filter(x => x.min <= m).reduce((a, x) => a + (x.kcal || 0), 0);
  const at = m => Math.round(inTo(m) - burnTo(m));
  const points = [];
  for (let m = 0; m <= 1440; m += 15) points.push({ m, kcal: at(m), projected: m > nowMin });
  const nowM = Math.min(nowMin, 1440);
  const bmrDay = o.bmr > 0 ? o.bmr : null, base = o.baseBurn || 0;
  const parts = {
    bmr_day: bmrDay, daily_day: bmrDay != null ? Math.round(base - bmrDay) : null, base_day: Math.round(base),
    bmr: bmrDay != null ? Math.round(bmrDay * nowM / 1440) : null,
    daily: bmrDay != null ? Math.round((base - bmrDay) * nowM / 1440) : null,
    base: Math.round(per * nowM),
    exercise: Math.round(exTo(nowM)),
    eaten: Math.round(inTo(nowM)),
  };
  parts.burned = parts.base + parts.exercise; parts.net = at(nowM);
  return { points, now: at(nowM), end: at(1440), now_min: nowMin, parts,
    meals: food.map(x => ({ min: x.min, kcal: x.kcal, label: x.label, logged: !x.projected, at: at(x.min) })),
    sessions: sessions.map(x => ({ start: x.start, end: x.end, kcal: Math.round(x.kcal), name: x.name, done: isDone(x) })) };
}

// The energy meter beside CTL: a half dial, 9 o'clock to 3 o'clock, noon is eaten = burned. Left of
// noon a deficit (losing), right a surplus (gaining); full scale ±1,000 kcal, clamped there, the true
// number printed. Returns the needle angle in degrees from noon (−90 full left, +90 full right).
const METER_SCALE = 1000;
function meterAngle(kcal) {
  if (kcal == null || !Number.isFinite(kcal)) return null;
  const c = Math.max(-METER_SCALE, Math.min(METER_SCALE, kcal));
  return Math.round(c / METER_SCALE * 90 * 10) / 10;
}
// lb a week at a daily balance: 3,500 kcal a pound
const lbPerWeek = avgKcal => avgKcal == null ? null : Math.round(avgKcal * 7 / 3500 * 10) / 10;

module.exports = { placeSnacks, carbLoad, carbLabel, carbWords, CARB_WORD, balanceSeries, meterAngle, lbPerWeek, METER_SCALE, isBlast, BLAST_KCAL_MIN, DAILY_SHARE, burnList, PROFILE, DEFICIT, LABEL, bmr, baseBurn, fuelDay, sessionRx, fuelRx, TRAIN_LOW_PER_WEEK, RX_LABEL, isRideSession, workoutKcal, targets, guidelines, cue, mealPlan, onBike, slotFor, toMin, toHM, dueSoFar, nextSlot, mealMatch, rollForward, alcoholOf, alcoholRule,
  guidelineScore, overall, band, FIT_POINTS, endOf, mmin, planSnapshot, slotKeys, pastOnArrival, dayMeals, tidyWhy, normWords, twinOf, workNote, drinksOf, onDrinksList };
