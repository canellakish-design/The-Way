// ============================================================
// food.js — the photo journal: Hexis-style fuel guidance, logged by camera.
//
// The day's rules come from the day's training (food-math.js). Each meal is a
// photo: Claude reads it, estimates the macros, and says whether the plate
// fits today's guidelines. The journal is the record; compliance is scored
// from it, half macros against target, half photos against the rules.
//
//   GET    /food/today            today's guidelines, targets, journal, score
//   GET    /food/day?date=        same for another day (read-only in the app)
//   POST   /food/photo            {images:[{image_base64,media_type}], meal?, notes?}
//   PUT    /food/:id              corrections: {name, meal, kcal, carbs_g, protein_g, fat_g}
//   DELETE /food/:id
//   GET    /food/photo/:id        the full-size photo
//   GET    /food/guidelines?date= guidelines + targets only (the calendar uses this)
//
// Each photo is also written to the fuel ledger (fuel-log.js), so the Energy
// Bank and the prescriptions keep reading the same meals.
// Env: ANTHROPIC_API_KEY (shared with agent.js), FOOD_MODEL to override.
// ============================================================
const crypto = require('crypto');
const { getJSON, setJSON } = require('./storage');
const { auth, logMeal } = require('./fuel-log');
const tz = require('./tz');
const F = require('./food-math');
const W = require('./workout-math');
const MI = require('./micro-math');
const HL = require('./hydration-live');
const EM = require('./energy-math');

const MODEL = process.env.FOOD_MODEL || 'claude-opus-5-5';
const KEEP_DAYS = 60;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dayKey = date => 'food-' + date;
const photoKey = id => 'food-photo-' + id;

async function dayDoc(date) { return getJSON(dayKey(date), { date, entries: [] }); }

const MEAL_WORDS = ['breakfast', 'lunch', 'dinner', 'snack', 'on the bike'];
const hmNow = () => { const p = tz.parts(new Date()); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); };
// A drink is a drink, with or without calories: a pint, a latte, a juice counts in the totals and the
// hydration curve but never stands in for a meal (a bottle with carbs on the bike is the exception).
// A plate that mentions its drink ("a wrap and two bottles of water") is still a plate: the drink
// flag alone does not make it one; little protein and few calories do.
const drinkish = e => !e.supplement && (!!e.drink_only || !!e.alcohol || (!!e.drink && (e.protein_g || 0) < 15 && (e.kcal || 0) < 300));
const isDrink = e => drinkish(e) && !(e.slot === 'on the bike' && (e.carbs_g || 0) >= 10);

// What the day remembers about its own plan (food-seen-<date>): when each slot was first shown (a
// slot that only appeared after its time had passed is not shown), and the slot given once to an
// entry saved before slots were always chosen at logging.
const seenKey = date => 'food-seen-' + date;
async function seenFor(date) { try { const s = await getJSON(seenKey(date), null); return Object.assign({ slots: {}, entry_slots: {} }, s || {}); } catch (e) { return { slots: {}, entry_slots: {} }; } }

// An entry without a saved slot is given one once, against the plan as it stands the first time it is
// read, and keeps it: the day never re-slots a meal on the way out.
function legacySlots(entries, g, seen) {
  let dirty = false;
  for (const e of entries) {
    if (e.supplement || e.drink_only || e.slot || e.slot_fixed) continue;
    if (!(e.id in seen.entry_slots)) { seen.entry_slots[e.id] = F.slotFor(g.meals, e.time, e.meal) || null; dirty = true; }
    e.slot = seen.entry_slots[e.id];
  }
  return dirty;
}

// The day's rows, the one list every page and the logging path read (food-math dayMeals): slots with
// food frozen as they were when eaten, open slots from the plan as it stands, the evening snack's words
// following the day's protein, and today's slots that appeared after their own time left out.
async function rowsFor(date, g, entries, seen) {
  const today = date === tz.todayKey();
  const proteinSoFar = Math.round(entries.filter(e => !e.supplement).reduce((a, e) => a + (e.protein_g || 0), 0));
  const plan = (g.meals || []).map(m => m.slot !== 'snack' || !today ? m : Object.assign({}, m, { what: (() => {
    const short = (g.target.protein_g || 0) - proteinSoFar;
    return short >= 20 ? `Protein is ${short} g short of ${g.target.protein_g} g so far: whey or cottage cheese.` : short > 0 ? `Protein is ${short} g short: a small one, or skip it.` : `Protein is covered (${proteinSoFar} of ${g.target.protein_g} g): skip it.`;
  })() }));
  let hide = null;
  if (today) {
    const st = seen || await seenFor(date);
    const r = F.pastOnArrival(plan, st.slots, hmNow());
    hide = r.hide;
    if (r.added.length) { st.slots = r.seen; await setJSON(seenKey(date), st).catch(() => {}); }
  }
  const dayKcal = Math.round(entries.filter(e => !e.supplement).reduce((a, e) => a + (e.kcal || 0), 0));
  return F.dayMeals(plan, entries, { day_kcal: dayKcal, target_kcal: g.target && g.target.kcal, isDrink, hide });
}

// The day's entries as the pages read them, and its rows, for the logging path and the report alike.
async function dayState(date, g) {
  const doc = await dayDoc(date);
  const seen = await seenFor(date);
  const entries = (doc.entries || []).map(e => F.alcoholRule(Object.assign({}, e, { photo: undefined })));
  if (legacySlots(entries, g, seen)) await setJSON(seenKey(date), seen).catch(() => {});
  for (const e of entries) e.is_drink = drinkish(e);
  const rows = await rowsFor(date, g, entries, seen);
  return { doc, entries, rows };
}

// The slot a new entry goes in, chosen once, and the plan it is graded against, taken from that same
// row: the verdict, the card and the Day row all show this one snapshot.
function chooseSlot(rows, hm, hint, entries) {
  const logged = rows.filter(r => (r.logged || []).length).map(r => r.slot);
  const last = (entries || []).filter(e => !e.supplement && !isDrink(e) && e.slot && e.time && e.time <= hm).sort((a, b) => String(a.time).localeCompare(String(b.time))).pop() || null;
  const slot = F.slotFor(rows, hm, hint, { logged, last });
  const same = rows.filter(r => r.slot === slot);
  const t = F.toMin(hm) ?? 0;
  const row = same.length ? same.reduce((a, x) => Math.abs(F.mmin(x) - t) < Math.abs(F.mmin(a) - t) ? x : a, same[0]) : null;
  return { slot: slot || null, row };
}
const mealWord = (slot, hint, guess) => MEAL_WORDS.includes(hint) ? hint : MEAL_WORDS.includes(slot) ? slot : MEAL_WORDS.includes(guess) ? guess : 'snack';

// ---- the day's sessions: planned here, planned in intervals.icu, done on Strava ----
async function buildSessions(date, o) {
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const out = [];
  try {
    const d = await getJSON('plan-workouts', { workouts: {} });
    // a lift saved on the Lift page is done, whatever the clock says
    const WK = require('./workouts');
    const savedLifts = ((await WK.liftsSavedBy(date, date))[date]) || [];
    const dayLifts = Object.values(d.workouts || {}).filter(w => w.date === date && !WK.isRideSport(w)).length;
    const dayW = Object.values(d.workouts || {}).filter(w => w.date === date);
    for (const w of dayW) {
      // an untimed copy of a timed lift of the same name is the same session said twice: counted once
      if (!w.time && !WK.isRideSport(w) && dayW.some(o => o !== w && o.time && String(o.name).toLowerCase() === String(w.name).toLowerCase())) continue;
      const m = W.metrics(w.steps || [], st);
      const start = w.time ? tz.zonedToUTC(...date.split('-').map(Number), +w.time.slice(0, 2), +w.time.slice(3, 5)) : null;
      const { pastNow, liftMatches } = require('./workouts');
      const logged = pastNow(w, tz.todayKey()) || liftMatches(w, savedLifts, dayLifts);
      // a run has no power behind its TSS: its calories are its minutes, about 11 a minute at his weight at an easy pace
      const runKcal = w.sport === 'Run' ? Math.round(m.duration_s / 60 * 11) : null;
      out.push({ name: w.name, sport: w.sport, minutes: Math.round(m.duration_s / 60), tss: m.tss, kcal: runKcal, notes: w.notes || '', planned: !logged, done: logged,
        time: w.time || null, start_at: start ? start.toISOString() : null,
        end_time: w.time ? F.toHM(F.toMin(w.time) + Math.round(m.duration_s / 60)) : null,
        end_at: logged && start ? new Date(start.getTime() + m.duration_s * 1000).toISOString() : null });
    }
  } catch (e) { /* no plan store yet */ }
  try {
    const { calendar } = require('./workouts');
    const cal = await calendar(date, date, o);
    const day = cal.days[0];
    if (day) {
      for (const e of day.intervals) {
        const start = e.time ? tz.zonedToUTC(...date.split('-').map(Number), +e.time.slice(0, 2), +e.time.slice(3, 5)) : null;
        out.push({ name: e.name, sport: e.type, minutes: e.minutes, tss: e.tss, planned: true, time: e.time || null, start_at: start ? start.toISOString() : null });
      }
      const strava = day.done.length ? await getJSON('strava', { rides: [] }) : { rides: [] };
      for (const r of day.done) {
        const ride = (strava.rides || []).find(x => x.id === r.id);
        const kcal = ride ? (ride.calories || ride.kilojoules || null) : null;
        const start = r.time ? tz.zonedToUTC(...date.split('-').map(Number), +r.time.slice(0, 2), +r.time.slice(3, 5)) : null;
        out.push({ name: r.name, sport: r.type, minutes: r.minutes, tss: r.tss, kcal, done: true,
          time: r.time || null, end_time: r.time ? F.toHM(F.toMin(r.time) + r.minutes) : null,
          end_at: start ? new Date(start.getTime() + r.minutes * 6e4).toISOString() : null });
      }
    }
  } catch (e) { /* calendar unreachable: plan store alone decides the day */ }
  // Once Strava has a ride, the day is what was ridden, not what was planned:
  // every planned session up to the end of the last ride is taken as covered
  // by it (ridden long, short, or not at all), and only sessions still ahead
  // in the day stay on the plan. So the food for the rest of the day follows
  // the work actually done.
  // The plan stands when the ride matched it. Each planned session up to the
  // end of the last ride is graded against the day's rides (workouts.js,
  // the same grade the calendar shows): at 85% and up the plan is kept as
  // written and simply marked done, so the food plan does not move. Short
  // of that, the rest of the day is rebuilt from the work actually done.
  const done = out.filter(s => s.done), planned = out.filter(s => !s.done);
  let sessions = out, work = null, burn = out;
  // only a ride done reshapes the day: a run or a lift done is counted in the burn and keeps its place,
  // and never reads as "ridden 0 of 90 min"
  if (done.some(F.isRideSession)) {
    const { gradeOne } = require('./workouts');
    const doneRides = done.filter(F.isRideSession);
    const lastEnd = Math.max(...doneRides.map(d => F.toMin(d.end_time) ?? 0));
    const lastRide = doneRides.slice().sort((a, b) => (F.toMin(a.end_time) ?? 0) - (F.toMin(b.end_time) ?? 0)).pop();
    // only rides are measured against the ride; a run or a lift keeps its own place in the day
    const covered = planned.filter(p => F.isRideSession(p) && !(F.toMin(p.time) != null && F.toMin(p.time) > lastEnd + 30));
    const ahead = planned.filter(p => !F.isRideSession(p) || (F.toMin(p.time) != null && F.toMin(p.time) > lastEnd + 30));
    const rides = doneRides.map(r => ({ minutes: r.minutes, tss: r.tss }));
    const graded = covered.map(p => Object.assign({}, p, { compliance: gradeOne({ metrics: { duration_s: (p.minutes || 0) * 60, tss: p.tss || 0 } }, rides).compliance }));
    const compliant = graded.length > 0 && graded.every(p => p.compliance.pct >= 85);
    // the calories follow the work: every ride actually done (a third one nobody planned included) plus what is still ahead,
    // even when the plan stands for the meals
    burn = F.burnList(done, ahead);
    const pm = planned.filter(F.isRideSession).reduce((a, p) => a + (p.minutes || 0), 0), dm = done.filter(F.isRideSession).reduce((a, d) => a + (d.minutes || 0), 0);
    const pct = graded.length ? Math.round(graded.reduce((a, p) => a + p.compliance.pct, 0) / graded.length) : null;
    if (compliant) {
      sessions = graded.map(p => Object.assign({}, p, { planned: false, done: true, kept: true,
        end_time: lastRide.end_time || p.end_time, end_at: lastRide.end_at || p.end_at })).concat(ahead);
      const day = F.fuelDay(sessions);
      work = { planned_min: pm, done_min: dm, pct, compliant: true, planned_day: day, day, changed: false,
        note: `Ridden as planned (${pct}%): today's plan stands.` };
    } else {
      sessions = done.concat(ahead);
      const plannedDay = F.fuelDay(planned), actualDay = F.fuelDay(sessions);
      work = { planned_min: pm, done_min: dm, pct, compliant: false, planned_day: plannedDay, day: actualDay, changed: plannedDay !== actualDay,
        note: F.workNote({ pm, dm, pct, plannedDay, actualDay }) };
    }
  }
  return { sessions, ftp: st.ftp, work, burn };
}

// A planned session whose start has passed with no ride against it. Three
// readings, in order:
//   1. Strava may simply not have been asked lately: a Zwift ride reaches
//      Strava a minute or two after it is saved, and the calendar's copy is
//      kept ten minutes. While a session is overdue the copy is taken only
//      if it is under two minutes old, so the ride is seen almost as soon as
//      it lands.
//   2. A post-ride meal logged after the planned start is the ride's own
//      word before Strava's: the plan holds, marked as waiting for Strava's
//      copy, for up to three hours past the planned end. Nothing slides onto
//      the meal and nothing says "not started".
//   3. Otherwise it has not started: it slides to now, so the fuel and water
//      curves do not burn for a ride that is not happening and the post-ride
//      meal moves with it. This runs after the day's rides have covered the
//      plan, so a session the ride already answered is never slid into a
//      second copy of itself.
const FRESH_MS = 2 * 60 * 1000;
async function sessionsFor(date) {
  let r = await buildSessions(date);
  if (date !== tz.todayKey()) return r;
  const p = tz.parts(new Date()); const nowMin = p.h * 60 + p.mi;
  const overdue = s => !s.done && F.toMin(s.time) != null && F.toMin(s.time) < nowMin - 10;
  if (r.sessions.some(overdue)) {
    try { r = await buildSessions(date, { max_age_ms: FRESH_MS }); } catch (e) { /* the first reading stands */ }
  }
  let entries = [];
  try { entries = (await dayDoc(date)).entries || []; } catch (e) { entries = []; }
  for (const s of r.sessions) {
    if (!overdue(s)) continue;
    const start = F.toMin(s.time), end = start + (s.minutes || 60);
    const meal = entries.find(e => e.slot === 'after' && !e.drink_only && !e.supplement && (e.kcal || 0) >= 100 && F.toMin(e.time) > start && F.toMin(e.time) <= end + 180);
    if (meal && nowMin <= end + 180) {
      s.done = true; s.awaiting = 'strava';
      s.evidence = `${meal.name || meal.text || 'the post-ride meal'} at ${tz.hm12(meal.time)}`;
      s.end_at = s.end_at || tz.zonedToUTC(...date.split('-').map(Number), Math.floor(end / 60), end % 60).toISOString();
      continue;
    }
    const to = Math.ceil(nowMin / 5) * 5;
    s.slid_from = s.time; s.time = F.toHM(to);
    s.end_time = F.toHM(to + s.minutes);
    s.start_at = tz.zonedToUTC(...date.split('-').map(Number), Math.floor(to / 60), to % 60).toISOString();
  }
  return r;
}

// The body's say on the deficit: a red WHOOP morning, or HRV below the band
// two days running, means eat to maintenance today (the IOC's "adaptable"
// low energy availability is the transient kind; prolonged is the problem).
async function deficitFor(date) {
  if (date !== tz.todayKey()) return { deficit: undefined, why: null };
  try {
    const s = await require('./whoop').sleepLatest({ sync: false });
    const rec = s && s.recovery;
    if (rec && rec.score != null && rec.score < 34) return { deficit: 0, why: `WHOOP recovery ${Math.round(rec.score)}: no deficit today, eat to maintenance` };
    const fit = await getJSON('fitness', { wellness: [] });
    const guide = require('./scores-math').hrvGuide((fit.wellness || []).filter(w => w.date !== date), rec ? rec.hrv : null);
    if (guide.state === 'low2') return { deficit: 0, why: 'HRV below your band two days running: no deficit today, eat to maintenance' };
  } catch (e) { /* no reading: the deficit stands */ }
  return { deficit: undefined, why: null };
}

// The scale's latest reading sets the body mass the targets scale from.
async function bodyKg() {
  try {
    const w = await getJSON('weigh-in', { entries: [] });
    const latest = (w.entries || []).slice().sort((a, b) => a.ts - b.ts).pop();
    return latest && latest.lb > 100 ? Math.round(latest.lb / 2.2046 * 10) / 10 : null;
  } catch (e) { return null; }
}

async function guidelinesFor(date) {
  const { sessions, ftp, work, burn } = await sessionsFor(date);
  const [{ deficit, why }, kg] = await Promise.all([deficitFor(date), bodyKg()]);
  // fuel for the work required: the sessions' prescriptions set the carbs and the shape of the day
  let rx = null;
  try { const FW = require('./fuel-week'); rx = F.fuelRx(sessions, kg || F.PROFILE.kg, ftp, await FW.contextFor(date, kg || F.PROFILE.kg, ftp)); } catch (e) { rx = F.fuelRx(sessions, kg || F.PROFILE.kg, ftp, {}); }
  const day = rx.day;
  const t = F.targets(day, F.workoutKcal(burn || sessions, ftp), { kg, deficit, rx });
  if (why) t.deficit_note = why;
  if (t.deficit_trimmed) t.deficit_note = (t.deficit_note ? t.deficit_note + '; ' : '') + `deficit eased by ${t.deficit_trimmed} kcal to keep carbs at ${t.per_kg.carbs} g/kg for the work`;
  const rideNotes = sessions.filter(s => s.notes && /EAT/.test(s.notes)).map(s => ({ name: s.name, notes: s.notes }));
  const today = date === tz.todayKey();
  const rxOf = s => rx.sessions.find(r => r.name === s.name && r.time === (s.time || null)) || null;
  return { date, day, fuel_day: t.fuel_day, target: t, kg, guidelines: F.guidelines(day, { deficit: t.deficit !== 0, rx }), ride_notes: rideNotes, work,
    fuel: { level: rx.level, label: rx.label, carbs_g: rx.carbs_g, per_kg: rx.per_kg, train_low: rx.train_low, sleep_low: rx.sleep_low },
    cue: today ? F.cue(day, sessions, null, rx) : null,
    meals: F.mealPlan(day, sessions, t),
    sessions: sessions.map(s => { const r = rxOf(s); return { name: s.name, minutes: s.minutes, tss: s.tss, done: !!s.done, time: s.time || null, sport: s.sport || null,
      slid_from: s.slid_from || null, awaiting: s.awaiting || null, evidence: s.evidence || null, start_at: s.start_at || null, end_at: s.end_at || null,
      rx: r ? { kind: r.kind, before_g: r.before.carbs_g, low: !!r.before.low, during_g: r.during.carbs_g, g_per_h: r.during.g_per_h, after_g: r.after.carbs_g, after_protein_g: r.after.protein_g, words: { before: r.before.words, during: r.during.words, after: r.after.words } } : null }; }) };
}

// ---- the photo -> the model -> an entry ----
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['food_name', 'meal_guess', 'portion', 'kcal', 'carbs_g', 'protein_g', 'fat_g', 'confidence',
    'protein_source', 'carbs', 'vegetables', 'processed', 'fits', 'why', 'ingredients', 'micronutrients', 'fluid_ml', 'drink'],
  properties: {
    ingredients: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'grams'],
      properties: { name: { type: 'string' }, grams: { type: 'integer' } } } },
    micronutrients: { type: 'object', additionalProperties: false,
      required: ['iron_mg', 'calcium_mg', 'magnesium_mg', 'potassium_mg', 'sodium_mg', 'zinc_mg', 'vitamin_d_ug', 'b12_ug', 'folate_ug', 'vitamin_c_mg', 'vitamin_a_ug', 'omega3_mg', 'fiber_g'],
      properties: { iron_mg: { type: 'number' }, calcium_mg: { type: 'number' }, magnesium_mg: { type: 'number' }, potassium_mg: { type: 'number' },
        sodium_mg: { type: 'number' }, zinc_mg: { type: 'number' }, vitamin_d_ug: { type: 'number' }, b12_ug: { type: 'number' }, folate_ug: { type: 'number' },
        vitamin_c_mg: { type: 'number' }, vitamin_a_ug: { type: 'number' }, omega3_mg: { type: 'number' }, fiber_g: { type: 'number' } } },
    fluid_ml: { type: 'integer' },
    drink: { type: 'string' },
    food_name: { type: 'string' },
    meal_guess: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'on the bike'] },
    portion: { type: 'string' },
    kcal: { type: 'integer' }, carbs_g: { type: 'integer' }, protein_g: { type: 'integer' }, fat_g: { type: 'integer' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    protein_source: { type: 'boolean' },
    carbs: { type: 'string', enum: ['none', 'some', 'heavy'] },
    vegetables: { type: 'boolean' },
    processed: { type: 'boolean' },
    fits: { type: 'string', enum: ['yes', 'partly', 'no'] },
    why: { type: 'string' }
  }
};

// What the reader is told on every plate, the same every time, so the API keeps it cached (see docs/api-spend.md);
// the day's targets, plan and journal follow in the message.
const READER = `You are the nutrition coach for one cyclist. He photographs every meal; you read the photo, or his words when there is no photo.
Identify the food and estimate the portion and its macros as eaten (read a scale display if one is in the photo). Several photos are the same meal from different angles, or its courses and its drink: one entry, the whole of it added together, never counted twice.
List the ingredients you can see with grams each, in plain names (white rice, salmon, spinach, soy sauce), and estimate the plate's micronutrients: iron, calcium, magnesium, potassium, sodium, zinc, vitamin D, B12, folate, vitamin C, vitamin A, omega-3 EPA and DHA, fibre.
Drinks: fluid_ml is the millilitres of drinkable liquid in the photo as drunk, the glass, mug, bottle or bowl of broth (a mug 300, a pint glass 500, a bike bottle 600 or 750 by its size, a can 330); coffee, tea, milk, smoothies, sports drink and soup count in full, alcohol counts 0, and 0 when there is no drink. drink names it in two or three words, or is empty. A photo of only a bottle or a glass is a drink, not a meal: food_name is the drink (with the count: "three pints of lager"), kcal as drunk, meal_guess snack; fits yes for water, coffee, tea, milk or a planned sports drink. Alcohol is never "yes": one drink on a rest day is "partly", two or more, or any before a training session, is "no", and why names the calories it adds and what it costs the plan.
protein_source is true when the plate's main item is a protein food: eggs (two or more), meat, poultry, fish, Greek yogurt, cottage cheese, tofu, beans with a grain, whey, cheese as a main part, even under 30 g; it is false only when no such food is on the plate; carbs is none, some or heavy by the starch and sugar on the plate; vegetables counts fruit.
processed is true only for ultra-processed food, NOVA group 4: industrially formulated products such as chips and crisps, candy and sweets, pastries and packaged cakes, soft drinks, packaged snack bars, instant noodles, hot dogs and deli meats, sugary cereals, or a deep-fried fast-food plate. Whole and minimally processed foods are never processed, cooked at home or not: eggs, bread and toast, fruit, plain Greek yogurt, milk, cheese, rice, oats, potatoes, meat, fish, vegetables, nuts, olive oil, butter. Judge processed by what is on this plate only.
fits is "yes" when the plate does what today's rules ask, "partly" when it does most of it, "no" when it works against them. why is one or two whole sentences, at most 35 words in all, direct, the way a coach at the trainer would say it, to him as "you" (never "he" or "his"); every text field speaks to him the same way. He has already eaten this plate: never tell him to skip it, swap it, leave part of it, or save it for tomorrow, and never say "skip the rice"; say what it means for what comes next (the next slot on the plan, or the rest of the evening).`;

function promptFor(g, meal, notes, written, photos) {
  const rules = g.guidelines.map(x => '- ' + x.text).join('\n');
  return `${written && photos ? `
This time he sent the photo AND wrote about the plate: "${written}". Read the two together as one meal. His words win on what a photo cannot show: weights he gives are from a kitchen scale and are exact, and he names the oil, the sauce, what is under the rice, what the bowl holds, the brand. The photo shows the portion and anything he did not mention. Never count the same food twice because it is both in the photo and in his words.` : written ? `
This time there is no photo: he wrote the meal down instead. Read his words as the plate: "${written}". Weights he gives are from a kitchen scale and are exact: use them as given. Where he gives none, assume the usual portions for a ${g.kg || 98} kg cyclist and say so in the portion field, written to him ("your usual", never "his").` : ''}
Today is a ${g.fuel_day}. Targets for the whole day: ${g.target.kcal} kcal, ${g.target.carbs_g} g carbs, ${g.target.protein_g} g protein, ${g.target.fat_g} g fat.
Today's guidelines:
${rules}
${g.work ? `What happened on the bike: ${g.work.note}\n` : ''}Today's meal plan, timed around the training:
${(g.rows || g.meals || []).map(m => `- ${tz.hm12(m.time)}${m.next_day ? ' (after midnight)' : ''} ${m.slot}: ${m.what}${m.kcal ? ` (~${m.kcal} kcal, ${m.carbs_g} g carbs${m.protein_g ? `, ${m.protein_g} g protein` : ''})` : ''}${(m.logged || []).length ? ' [already eaten]' : ''}`).join('\n')}
${g.cue ? `Where the day stands right now: ${g.cue.text}\n` : ''}${g.logged && g.logged.length ? `Already in the journal today (do not ask for a meal he has already eaten): ${g.logged.map(e => `${e.time} ${e.meal}: ${e.name} (${e.kcal} kcal, ${e.carbs_g} C / ${e.protein_g} P / ${e.fat_g} F${e.fluid_ml ? `, ${e.fluid_ml} ml` : ''})`).join('; ')}. Eaten so far: ${g.logged.reduce((a, e) => a + (e.kcal || 0), 0)} kcal, ${g.logged.reduce((a, e) => a + (e.carbs_g || 0), 0)} C / ${g.logged.reduce((a, e) => a + (e.protein_g || 0), 0)} P / ${g.logged.reduce((a, e) => a + (e.fat_g || 0), 0)} F.\n` : ''}${meal ? `He says this is ${meal}.` : 'Guess which meal this is from the food and the time of day.'}${notes ? `\nHis note, which overrides what you can see: "${notes}"` : ''}

${g.slotRow ? `This plate goes in his ${g.slotRow.slot} slot (planned ${tz.hm12(g.slotRow.time)}: ~${g.slotRow.kcal} kcal, ${g.slotRow.carbs_g} g carbs${g.slotRow.protein_g ? `, ${g.slotRow.protein_g} g protein` : ''}${(g.slotRow.logged || []).length ? `, and already holding what he ate earlier in it` : ''}). Call it by that name, and judge it against that slot and today's guidelines.` : 'This plate falls outside the plan\'s slots: judge it against today\'s guidelines and what is left of the day.'}
Current time of day where he is: ${tz.hm12(hmNow())}.`;
}

async function analyze(images, g, meal, notes, written) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const content = (images || []).slice(0, 4).map(img => ({ type: 'image',
    source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.image_base64 } }));
  content.push({ type: 'text', text: promptFor(g, meal, notes, written, images.length) });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
      'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: [{ type: 'text', text: READER, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }]
    })
  });
  const j = await r.json();
  if (j.usage) console.log('food reader usage', JSON.stringify(j.usage));
  if (!r.ok) throw new Error('vision ' + r.status + ': ' + ((j.error && j.error.message) || JSON.stringify(j)).slice(0, 200));
  if (j.stop_reason === 'refusal') throw new Error('the model declined to read this photo' + (j.stop_details && j.stop_details.explanation ? ': ' + j.stop_details.explanation : ''));
  const block = (j.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no answer from the vision model');
  let out;
  try { out = JSON.parse(block.text.replace(/```json|```/g, '').trim()); }
  catch { throw new Error('vision answer was not JSON: ' + block.text.slice(0, 160)); }
  return out;
}

// ---- rechecks: a sentence written at 7:20 must not speak for the day at 9:00 ----
// Every reading is a snapshot of the day at that minute. When a later entry lands, the earlier
// sentences are re-read against the day as it now stands, in one cheap text call, and kept with
// the time of the re-read; the first words are kept as why_then. The verdict on the plate itself
// (fits) never changes here: only what the sentence says about the rest of the day.
const RECHECK_MODEL = process.env.FOOD_RECHECK_MODEL || 'claude-haiku-5-5';
function staleOf(entries) {
  const live = entries.filter(e => !e.supplement && e.assessment && e.assessment.why && e.at);
  if (live.length < 2) return { latest: null, stale: [] };
  const latest = live.slice().sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  return { latest, stale: live.filter(e => e.id !== latest.id && e.why_as_of !== latest.id) };
}
async function recheckDay(date) {
  const doc = await dayDoc(date);
  const { latest, stale } = staleOf(doc.entries);
  if (!latest || !stale.length) return { rechecked: 0 };
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const g = await guidelinesFor(date);
  const sum = k => Math.round(doc.entries.filter(e => !e.supplement).reduce((a, e) => a + (e[k] || 0), 0));
  const line = e => `${tz.hm12(e.time)} ${e.drink_only ? 'drink' : e.slot || e.meal}: ${e.name}, ${e.kcal} kcal, ${e.carbs_g} g carbs, ${e.protein_g} g protein, ${e.fat_g} g fat${F.alcoholOf(e) ? ` (alcohol, ${F.alcoholOf(e)} drink${F.alcoholOf(e) === 1 ? '' : 's'})` : ''}`;
  const prompt = `You are the nutrition coach for one cyclist, 55, 98 kg, losing weight slowly while training. Each journal entry carries one sentence you wrote when it was logged. The day has moved on since; rewrite the sentences below so each is true of the day AS IT NOW STANDS.
Today is a ${g.fuel_day}. Targets for the whole day: ${g.target.kcal} kcal, ${g.target.carbs_g} g carbs, ${g.target.protein_g} g protein, ${g.target.fat_g} g fat.
Today's rules:
${g.guidelines.map(x => '- ' + x.text).join('\n')}
The journal now, in order:
${doc.entries.filter(e => !e.supplement).slice().sort((a, b) => String(a.time).localeCompare(String(b.time))).map(line).join('\n')}
Totals now: ${sum('kcal')} kcal, ${sum('carbs_g')} g carbs, ${sum('protein_g')} g protein, ${sum('fat_g')} g fat.
Sentences to rewrite:
${stale.map(e => `- id ${e.id}, ${tz.hm12(e.time)} ${e.name}: "${e.assessment.why}"`).join('\n')}
For each: one whole plain sentence, at most 35 words, spoken to him as "you" (never "he" or "his"), about that item in the light of everything logged since. Keep its own verdict (a good plate stays good, a poor one poor, a pint is still a pint). Never ask for food a later entry already brought: if the pint's sentence asked for protein at dinner and the shrimp at 8:53 brought 112 g, say the shrimp closed it. Name later entries by what they were. Everything in the journal has been eaten: never tell him to skip, swap or undo any of it, or to save it for tomorrow; say only what is next. Times in 12-hour form. Answer with JSON only: {"readings":[{"id":"...","why":"..."}]}.`;
  const schema = { type: 'object', additionalProperties: false, required: ['readings'], properties: { readings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string' } } } } } };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: RECHECK_MODEL, max_tokens: 6000, fallbacks: 'default', output_config: { effort: 'low', format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('recheck ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 200));
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  let out; try { out = JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch { const m = /\{[\s\S]*\}/.exec(text); try { out = JSON.parse(m ? m[0] : ''); } catch { throw new Error(`recheck answer was not JSON (${j.stop_reason || 'no stop reason'}; ${(j.content || []).map(c => c.type).join(',') || 'no content'}): ${text.slice(0, 120)}`); } }
  const nowHM = (() => { const p = tz.parts(new Date()); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); })();
  let n = 0;
  const fresh = await dayDoc(date);      // re-read: a log may have landed while the model thought
  for (const rd of (out.readings || [])) {
    const e = fresh.entries.find(x => x.id === rd.id); if (!e || !e.assessment || !rd.why) continue;
    const why = F.tidyWhy(rd.why, 420);
    if (why !== e.assessment.why) { e.why_then = e.why_then || e.assessment.why; e.assessment.why = why; e.why_at = nowHM; n++; }
    e.why_as_of = latest.id;
  }
  for (const e of stale) { const x = fresh.entries.find(y => y.id === e.id); if (x) x.why_as_of = latest.id; }   // asked and answered, even if unchanged
  await setJSON(dayKey(date), fresh);
  return { rechecked: n, asked: stale.length };
}

async function dayReport(date) {
  const g = await guidelinesFor(date);
  // a lift in the day: its calories are counted, and the rules say what it asks of the plate
  for (const sx of (g.sessions || [])) if (/weight|lift|strength/i.test(String(sx.sport || '')) || /\blift\b|^push\b|\bpull\b|\bupper\b|\blegs\b/i.test(String(sx.name || '')))
    g.guidelines = (g.guidelines || []).concat([{ key: 'lift', text: `Lift${sx.time ? ' at ' + tz.hm12(sx.time) : ''}: about ${Math.round((sx.kcal || (sx.tss ? sx.tss * 175 * 0.036 : 180)))} kcal added to the day; 25 g of protein within the hour after it.` }]);
  // Every entry keeps the slot it was given when it was logged; the rows freeze a slot with food in it
  // and reshape only the open ones (rowsFor). The verdict, the card and the Day row read these.
  const { doc, entries, rows } = await dayState(date, g);
  const sum = k => Math.round(entries.filter(e => !e.supplement).reduce((a, e) => a + (e[k] || 0), 0));
  const meals = entries.filter(e => !e.supplement && !e.drink_only);
  const actual = { kcal: sum('kcal'), carbs_g: sum('carbs_g'), protein_g: sum('protein_g'), fat_g: sum('fat_g'), meals: entries.length };
  const { scoreDay } = require('./intake');
  // Macros are read against what the plan says should be in by now (today), or the whole day (a past day).
  const nowHM0 = hmNow();
  const due = date === tz.todayKey() ? F.dueSoFar(rows, g.target, nowHM0) : null;
  const macroTarget = due ? (due.kcal > 0 ? Object.assign({}, g.target, due) : null) : g.target;
  const macro = macroTarget ? scoreDay(actual, macroTarget) : null;
  const rides = g.sessions.filter(s => s.done && s.end_at);
  const guide = F.guidelineScore(g.day, meals, rides, rows);
  const overall = F.overall(macro ? macro.overall : null, guide.score);
  // Micronutrients: today and up to six days before; each nutrient averages
  // over its own window (3 days for the quick ones, 7 for iron, D, B12,
  // zinc, sodium, omega-3). Sweat sodium is added from the day's riding.
  const microDays = [MI.sumDays(entries.map(e => e.micros).filter(Boolean))];
  for (let i = 1; i <= 6; i++) {
    const prev = await getJSON(dayKey(tz.shiftKey(date, -i)), null);
    if (prev && prev.entries && prev.entries.length) microDays.push(MI.sumDays(prev.entries.map(e => e.micros).filter(Boolean)));
    else if (microDays.length > 1) break;   // the journal started here
  }
  const rideHours = g.sessions.filter(s => s.done).reduce((a, s) => a + (s.minutes || 0), 0) / 60;
  const microOpts = { day: g.day, post: !!(g.cue && g.cue.key === 'post'), ride_hours: Math.round(rideHours * 10) / 10, today_share: due ? due.share : 1 };
  const micro = entries.some(e => e.micros) || microDays.length > 1 ? MI.dayScore(microDays, microOpts) : null;
  const microSuggest = micro ? MI.suggest(microDays, microOpts) : null;
  const nowP = tz.parts(new Date());
  const nowMin = date === tz.todayKey() ? nowP.h * 60 + nowP.mi : null;
  const hydration = await liveHydration(date, entries, g, nowMin);
  // The day's drinks, one list: the Hydration page lists them, Food counts them, and "drank" is
  // the sum of their poured volumes (food-math drinksOf). Each listed entry carries what it counted.
  const dk = F.drinksOf(entries, hydration && hydration.drinks);
  for (const r of dk.rows) { const e = entries.find(x => x.id === r.id); if (e) { e.drink_ml = r.ml; if (r.net_ml != null) e.drink_net_ml = r.net_ml; } }
  if (hydration) { hydration.drunk_ml = dk.ml; hydration.left_ml = Math.max(0, (hydration.target_ml || 0) - dk.ml); }
  // the four supplements: what is due today and what was taken (supps.js); a pre-ride one whose time
  // has gone by untaken says so, rather than "due" at a time already past
  let supps = null;
  try { const S = require('./supps'); const y = await getJSON(dayKey(tz.shiftKey(date, -1)), null); supps = S.dueFor(date, g.sessions, entries, nowMin, (y && y.entries) || []); } catch (e) { supps = null; }
  if (supps && nowMin != null) for (const d of supps.due || []) if (d.link === 'fuel' && !d.taken && !d.past && F.toMin(d.time) != null && F.toMin(d.time) < nowMin) { d.too_late = true; d.word = 'too late today'; }
  // Live fuel: the carbohydrate on board through the day, from what was logged (energy-math.js).
  let energy = null;
  try { energy = await liveFuel(date, entries, Object.assign({}, g, { meals: rows }), nowMin); } catch (e) { energy = null; }
  // live energy (calories in minus out since midnight), the Hexis view; past days run to midnight
  let balance = null;
  try {
    const isToday = date === tz.todayKey(), mins = isToday ? nowMin : 1440;
    const sess = (g.sessions || []).filter(x => F.toMin(x.time) != null).map(x => { const st = F.toMin(x.time); return { name: x.name, start: st, end: st + (x.minutes || 60), kcal: F.workoutKcal([x], g.ftp || 175) }; });
    const eaten = entries.filter(e => !e.supplement && (e.kcal || 0) > 0 && F.toMin(e.time) != null).map(e => ({ min: F.toMin(e.time), kcal: e.kcal, label: e.name }));
    const planned = isToday ? rows.filter(m => !(m.logged || []).length && (m.kcal || 0) > 0).map(m => ({ min: (m.at_min != null ? m.at_min : F.toMin(m.time)), kcal: m.kcal, label: m.slot })) : [];
    balance = F.balanceSeries({ baseBurn: (g.target && g.target.base_burn) || 0, nowMin: mins, sessions: sess, eaten, planned });
    balance.target_end = g.target ? Math.round(g.target.kcal - (g.target.base_burn || 0) - (g.target.ride_kcal || 0)) : null;
  } catch (e) { balance = null; }
  return {
    date, today: date === tz.todayKey(),
    fuel_day: g.fuel_day, day: g.day, fuel: g.fuel || null, target: g.target, guidelines: g.guidelines, ride_notes: g.ride_notes, sessions: g.sessions, cue: g.cue, work: g.work,
    // a slot is logged by food, not by the water drunk near it (a bottle with carbs on the bike is the exception); drinks stay in the journal and the hydration curve
    meals: rows,
    actual: Object.assign(actual, { meals: meals.length }), entries,
    drinks: dk.ids, drink_count: dk.count, drink_food_count: dk.food_count, drinks_ml: dk.ml,
    stale_readings: staleOf(doc.entries).stale.length, stale_key: (staleOf(doc.entries).latest || {}).id || null,
    hydration, energy, supps, balance,
    compliance: { overall, band: F.band(overall), macros: macro, guidelines: guide, due },
    micros: micro ? Object.assign(micro, { suggest: microSuggest, supplements_available: MI.TABLE.supplements.map(x => ({ key: x.key, name: x.name, note: x.note })) }) : null,
    suggestion: date === tz.todayKey() ? nextUp(Object.assign({}, g, { meals: rows }), entries, actual, macro, nowHM0) : null,
    basis: 'the journal against the day\'s guidelines, and the macros against what the plan says should be in by now'
  };
}

// Live fuel (energy-math.js): two stores through the day. Yesterday's end
// is today's start (the legs carry over; the quick store loses the night),
// so a long Saturday reads low on Sunday. Each day's end is kept in one
// small store. The legs tap after a ride is kept too, and after thirty
// rides it tunes the model's two constants.
async function liveFuel(date, entries, g, nowMin) {
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const planMeals = g.meals.map(m => Array.isArray(m.logged) ? m : Object.assign({}, m, { logged: entries.filter(e => e.slot === m.slot).map(e => e.id) }));
  const days = await getJSON('energy-days', { days: {} });
  const prev = days.days[tz.shiftKey(date, -1)] || null;
  const taps = await getJSON('fuel-legs', { rides: [] });
  const cal = EM.calibrate(taps.rides);
  const energy = EM.model(Object.assign({ entries, meals: planMeals, sessions: g.sessions, now_min: nowMin, ftp: st.ftp, cal }, EM.carryOver(prev)));
  // the supplements taken today sit on the curve where they were taken: no carbs, but part of the fuelling
  energy.supps = entries.filter(e => e.supplement && e.time).map(e => ({ time: e.time, min: F.toMin(e.time), name: e.name, key: e.key || null }));
  const end = { quick_end_g: energy.quick_end_g, legs_end_g: energy.legs_end_g, at: Date.now() };
  const was = days.days[date];
  if (!was || was.quick_end_g !== end.quick_end_g || was.legs_end_g !== end.legs_end_g) {
    days.days[date] = end;
    for (const k of Object.keys(days.days)) if (k < tz.shiftKey(date, -45)) delete days.days[k];
    await setJSON('energy-days', days);
  }
  // the legs tap: the last ride done today, if he has not rated it yet
  const done = g.sessions.filter(s => s.done && s.time && !/lift|weight|strength/i.test(s.name || '')).sort((a, b) => F.toMin(a.time) - F.toMin(b.time)).pop();
  if (done) {
    const key = `${date}|${done.name}`;
    const rated = taps.rides.find(r => r.key === key);
    const startPt = energy.series.find(p => p.t === done.time) || null;
    energy.legs_tap = { key, name: done.name, rated: rated ? rated.legs : null, tuned: cal.tuned, pct: startPt ? startPt.pct : null,
      fasted: !entries.some(e => !e.supplement && e.time && F.toMin(e.time) < F.toMin(done.time)) };
  }
  energy.calibration = { rides: cal.rides, tuned: cal.tuned, quick_share: energy.share, rest_g_h: energy.rest_g_h };
  // a planned ride taken as ridden on the strength of its post-ride meal, until Strava's copy lands
  energy.awaiting = g.sessions.filter(s => s.awaiting).map(s => ({ name: s.name, time: s.time, evidence: s.evidence }));
  energy.carried = prev ? { from: tz.shiftKey(date, -1), legs_g: prev.legs_end_g } : null;
  return energy;
}
// The legs tap itself: POST /fuel/legs { key, legs 1..5 }.
async function rateLegs(key, legs) {
  const taps = await getJSON('fuel-legs', { rides: [] });
  const [date, name] = String(key).split('|');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(legs >= 1 && legs <= 5)) throw new Error('need a date|ride key and legs 1 to 5');
  const day = await dayReport(date);
  const tap = day.energy && day.energy.legs_tap && day.energy.legs_tap.key === key ? day.energy.legs_tap : null;
  const r = { key, date, name, legs: Math.round(legs), pct: tap ? tap.pct : null, fasted: tap ? tap.fasted : false, at: Date.now() };
  taps.rides = taps.rides.filter(x => x.key !== key).concat([r]).slice(-200);
  await setJSON('fuel-legs', taps);
  return { ok: true, rating: r, calibration: EM.calibrate(taps.rides) };
}

// Live hydration (hydration-live.js): the water balance through the day. The
// weather is fetched only when a ride is outdoors, and only waited on for a
// few seconds; the trainer needs none. A post-ride weigh-in within three
// hours of a ride, against the morning reading, is a calibration point.
async function liveHydration(date, entries, g, nowMin) {
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  let weather = null;
  if (g.sessions.some(s => s.sport && s.sport !== 'VirtualRide' && s.sport !== 'WeightTraining')) {
    const first = g.sessions.find(s => s.sport === 'Ride') || g.sessions[0];
    const span = g.sessions.reduce((a, s) => a + (s.minutes || 60), 0);
    weather = await Promise.race([
      require('./weather').forecastAt(date, F.toMin(first.time) || 9 * 60, span).catch(() => null),
      new Promise(r => setTimeout(() => r(null), 3000))
    ]);
  }
  const cal = await getJSON('hydration-calibration', { points: [] });
  const k = HL.calibrate(cal.points).k;
  // yesterday's end is today's start. Yesterday is recomputed once if its
  // stored end predates its own evening (a drink logged after the last look).
  const hdays = await getJSON('hydration-days', { days: {} });
  const yday = tz.shiftKey(date, -1);
  let prev = hdays.days[yday] || null;
  const ydayEve = tz.zonedToUTC(...yday.split('-').map(Number), 22, 0).getTime();
  if ((!prev || prev.at < ydayEve) && date >= tz.shiftKey(tz.todayKey(), -1)) {
    try {
      const gy = await guidelinesFor(yday);
      const ey = (await dayDoc(yday)).entries;
      if (ey.length || gy.sessions.some(s => s.done)) {
        const before = hdays.days[tz.shiftKey(yday, -1)] || {};
        const my = HL.model({ entries: ey.map(F.alcoholRule), sessions: gy.sessions, now_min: null, kg: gy.kg, ftp: st.ftp, weather: null, sweat_k: k, start_ml: before.end_ml != null ? HL.carryOver(before.end_ml, null, before.alcohol).start_ml : 0 });
        prev = hdays.days[yday] = { end_ml: my.end_ml, alcohol: my.alcohol || null, at: Date.now() };
      }
    } catch (e) { /* yesterday unknown: start from zero */ }
  }
  // the scale: a morning reading against a three-day baseline, and one after a ride
  let weigh = null, scale = null;
  try {
    const w = await getJSON('weigh-in', { entries: [] });
    const dayStart = tz.zonedToUTC(...date.split('-').map(Number), 0, 0).getTime();
    const todays = (w.entries || []).filter(e => e.ts >= dayStart && e.ts < dayStart + 864e5 && e.lb > 100).sort((a, b) => a.ts - b.ts);
    const morning = todays.find(e => e.ts < dayStart + 11 * 36e5);
    const base = (w.entries || []).filter(e => e.ts >= dayStart - 3 * 864e5 && e.ts < dayStart && e.lb > 100);
    if (morning && base.length >= 2) scale = { today_kg: morning.lb / 2.20462, baseline_kg: base.reduce((a, e) => a + e.lb, 0) / base.length / 2.20462 };
    for (const s of g.sessions.filter(x => x.done && x.start_at && x.end_at)) {
      const t0 = Date.parse(s.start_at), t1 = Date.parse(s.end_at);
      const pre = todays.filter(e => e.ts < t0).pop();
      const post = todays.find(e => e.ts > t1 && e.ts < t1 + 3 * 36e5);
      if (!pre || !post) continue;
      const sMin = F.toMin(s.time), eMin = sMin + (s.minutes || 0);
      const drank = entries.filter(e => e.fluid_ml > 0 && F.toMin(e.time) != null && F.toMin(e.time) >= sMin - 5 && F.toMin(e.time) <= eMin).reduce((a, e) => a + e.fluid_ml, 0);
      const lost = HL.measured(pre.lb / 2.20462, post.lb / 2.20462, drank, s.minutes);
      if (lost == null) continue;
      weigh = { session: s.name, lost_ml: lost, end_min: eMin, pre_lb: pre.lb, post_lb: post.lb, drank_ml: drank };
      break;
    }
  } catch (e) { weigh = null; }
  const carry = HL.carryOver(prev ? prev.end_ml : null, scale, prev ? prev.alcohol : null);
  const live = HL.model({ entries, sessions: g.sessions, now_min: nowMin, kg: g.kg, ftp: st.ftp, weather, sweat_k: k, weigh, start_ml: carry.start_ml, night: carry.night || null });
  live.carried = Object.assign({ from_date: yday }, carry);
  const wasH = hdays.days[date];
  const alcKey = a => a ? `${a.evening_drinks}:${a.evening_net_ml}` : '';
  if (!wasH || wasH.end_ml !== live.end_ml || alcKey(wasH.alcohol) !== alcKey(live.alcohol)) {
    hdays.days[date] = { end_ml: live.end_ml, alcohol: live.alcohol || null, at: Date.now() };
    for (const kk of Object.keys(hdays.days)) if (kk < tz.shiftKey(date, -45)) delete hdays.days[kk];
    await setJSON('hydration-days', hdays);
  }
  if (weigh) {
    const s = live.sessions.find(x => x.name === weigh.session) || null;
    const modelled = s ? Math.round(s.loss_ml / live.sweat_k) : null;
    if (modelled && !cal.points.some(p => p.date === date && p.session === weigh.session)) {
      cal.points.push({ date, session: weigh.session, measured_ml: weigh.lost_ml, modelled_ml: modelled, pre_lb: weigh.pre_lb, post_lb: weigh.post_lb });
      cal.points = cal.points.slice(-60);
      await setJSON('hydration-calibration', cal);
    }
    live.weigh = Object.assign(weigh, { modelled_ml: modelled });
  }
  live.calibration = { k: live.sweat_k, points: HL.calibrate(cal.points).points };
  // the shape the tile already reads
  live.target = { total: live.target_ml, base: live.target_ml - live.sessions.reduce((a, s) => a + s.loss_ml, 0), ride: live.sessions.reduce((a, s) => a + s.loss_ml, 0) };
  // the line under the balance: the bedtime note after evening alcohol, else the advice, else where it
  // stands (never "0.0 L down"); a drink still landing says so, so a glass that moved the balance by a
  // fifth of itself is explained
  const where = live.now.band.key === 'blue' ? 'Ahead of the morning.' : Math.abs(live.now.ml) < 100 ? 'Level with the morning.' : `${(Math.abs(live.now.ml) / 1000).toFixed(1)} L ${live.now.ml < 0 ? 'down' : 'up'} on the morning.`;
  live.note = [live.bedtime_note || live.advice || where, live.landing_note].filter(Boolean).join(' ');
  return live;
}

// The suggestion is the plan's next slot, sized to the slot, with the
// compliance it would leave: what the plan says to eat next, not a snack
// chosen against the whole day. After the last slot, only a protein gap
// earns a word (whey or cottage cheese, as the plan's snack says).
function nextUp(g, entries, actual, macroNow, nowHM) {
  const { scoreDay } = require('./intake');
  // the day's rows (rowsFor): rolled forward already, a slot logged when it holds food
  const meals = (g.meals || []).map(m => Array.isArray(m.logged) ? m : Object.assign({}, m, { logged: entries.filter(e => e.slot === m.slot && !e.supplement && (!e.drink_only || m.slot === 'on the bike')).map(e => e.id) }));
  // a slot the meal before it already covered is not next
  const nx = F.nextSlot(meals.filter(m => !m.covered_by), nowHM);
  const before = macroNow ? macroNow.overall : null;
  if (!nx) {
    const short = Math.round((g.target.protein_g || 0) - (actual.protein_g || 0));
    if (short >= 20) return { slot: 'snack', time: null, name: 'Whey or cottage cheese', what: `Protein is ${short} g short of the day. A scoop of whey or a bowl of cottage cheese closes most of it.`,
      kcal: 160, carbs_g: 5, protein_g: 25, fat_g: 3, why: 'every planned meal is logged; protein is what is left', score_before: before, score_after: null, snap: 'snack' };
    return { none: true, why: 'every planned meal is logged' };
  }
  const fat = Math.max(0, Math.round(((nx.kcal || 0) - 4 * (nx.carbs_g || 0) - 4 * (nx.protein_g || 0)) / 9));
  // the compliance it would leave: the day to date plus this slot, against what is due once the slot's time has come
  const after = { kcal: (actual.kcal || 0) + (nx.kcal || 0), carbs_g: (actual.carbs_g || 0) + (nx.carbs_g || 0), protein_g: (actual.protein_g || 0) + (nx.protein_g || 0), fat_g: (actual.fat_g || 0) + fat };
  const dueThen = F.dueSoFar(meals, g.target, nx.time);   // includes this slot: its time has come
  const scoredAfter = dueThen && dueThen.kcal > 0 ? scoreDay(after, Object.assign({}, g.target, dueThen)) : null;
  const late = F.toMin(nx.time) < F.toMin(nowHM) - 5;
  return { slot: nx.slot, time: nx.time, name: `${nx.slot}${nx.time ? ' at ' + tz.hm12(nx.time) : ''}`, what: nx.what,
    kcal: nx.kcal || 0, carbs_g: nx.carbs_g || 0, protein_g: nx.protein_g || 0, fat_g: fat, low_carb: !!nx.low_carb, late,
    why: nx.rolled_from ? `next on the plan, lighter: the ${nx.rolled_from.slot === 'after' ? 'post-ride meal' : nx.rolled_from.slot} ran over` : late ? 'its time has come' : 'next on the plan',
    score_before: before, score_after: scoredAfter ? scoredAfter.overall : null,
    snap: nx.slot === 'before' || nx.slot === 'after' || nx.slot === 'on the bike' ? 'snack' : nx.slot };
}

// Remove one entry from a day (and from the ledger). Returns the entry, or null.
async function removeEntry(id, date) {
  const doc = await dayDoc(date);
  const gone = doc.entries.find(x => x.id === id);
  if (!gone) return null;
  doc.entries = doc.entries.filter(x => x.id !== id);
  for (const e of doc.entries) if (e.why_as_of) delete e.why_as_of;   // every sentence is re-read against the day without it
  await setJSON(dayKey(date), doc);
  await removeFromLedger(id);
  return gone;
}
// Today's entries, newest last, for the voice's "remove the ..." and "undo".
async function todayEntries() { return (await dayDoc(tz.todayKey())).entries; }
// The same words logged again within twenty minutes, today (food-math twinOf): the Food page and the voice ask the same.
async function twinToday(text) {
  const p = tz.parts(new Date());
  return F.twinOf(await todayEntries(), text, p.h * 60 + p.mi, 20);
}

// A supplement taken: one tap, one entry, its micronutrients counted.
async function addSupplement(key) {
  const sm = MI.supplementMicros(key);
  if (!sm) return null;
  const date = tz.todayKey();
  const p = tz.parts(new Date());
  const entry = { id: 'f_' + crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), date,
    time: String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'), slot: null, meal: 'supplement', supplement: true, key: sm.key,
    name: sm.name, portion: '', kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, confidence: 'high', notes: sm.note || '',
    assessment: null, thumb: null, ingredients: [], micros: sm.micros, micros_matched_pct: 100, micros_unknown: [] };
  const doc = await dayDoc(date); doc.entries.push(entry); await setJSON(dayKey(date), doc);
  return entry;
}

// A photo, or words instead of one (body.text): the same read, the same entry.
async function addPhoto(body) {
  const images = Array.isArray(body.images) ? body.images.filter(i => i && i.image_base64) : [];
  const written = body.text ? String(body.text).trim().slice(0, 600) : '';
  if (!images.length && !written) throw new Error('no photo and nothing written');
  const date = tz.todayKey();
  const g = await guidelinesFor(date);
  const meal = MEAL_WORDS.includes(body.meal) ? body.meal : null;
  const notes = body.notes ? String(body.notes).slice(0, 300) : '';
  const nowHM = hmNow();
  // The slot is chosen once, here, from the rows the day shows this minute (after 8 p.m. with dinner
  // open, a meal is dinner), and the coach is told it, so the verdict, the card and the Day row agree.
  let pick = { slot: null, row: null };
  try {
    const st = await dayState(date, g);
    g.rows = st.rows;
    pick = chooseSlot(st.rows, nowHM, meal, st.entries);
    g.slotRow = pick.row;
    // The coach sees what is already in the journal, so it never asks for a meal just eaten.
    g.logged = st.entries.filter(e => !e.supplement).map(e => ({ time: e.time, meal: e.drink_only ? 'drink' : e.meal, name: e.name, kcal: e.kcal, carbs_g: e.carbs_g, protein_g: e.protein_g, fat_g: e.fat_g, fluid_ml: e.fluid_ml || 0 }));
  } catch (e) { g.logged = g.logged || []; }
  const a = await analyze(images, g, meal, notes, written);
  const id = 'f_' + crypto.randomBytes(5).toString('hex');
  const entry = {
    id, at: new Date().toISOString(), date, time: nowHM,
    slot: pick.slot, slot_fixed: true,
    meal: mealWord(pick.slot, meal, a.meal_guess),
    name: String(a.food_name || 'meal').slice(0, 80), portion: String(a.portion || '').slice(0, 120),
    kcal: Math.max(0, Math.round(a.kcal || 0)), carbs_g: Math.max(0, Math.round(a.carbs_g || 0)),
    protein_g: Math.max(0, Math.round(a.protein_g || 0)), fat_g: Math.max(0, Math.round(a.fat_g || 0)),
    confidence: a.confidence || 'medium', notes,
    assessment: { protein_source: !!a.protein_source, carbs: a.carbs || 'some', vegetables: !!a.vegetables,
      processed: !!a.processed, fits: a.fits || 'partly', why: F.tidyWhy(a.why, 420) },
    thumb: body.thumb_base64 ? String(body.thumb_base64).slice(0, 60000) : null,
    written: written || null,
    ingredients: Array.isArray(a.ingredients) ? a.ingredients.slice(0, 20).map(i => ({ name: String(i.name || '').slice(0, 60), grams: Math.max(0, Math.round(i.grams || 0)) })) : [],
    micros: null, micros_matched_pct: null, micros_unknown: [],
    fluid_ml: Math.max(0, Math.min(3000, Math.round(a.fluid_ml || 0))), drink: String(a.drink || '').slice(0, 40) || null
  };
  // A bottle or a glass on its own is a drink: it counts for hydration, not as a meal the rules judge.
  entry.drink_only = entry.fluid_ml > 0 && entry.kcal < 60 && !entry.assessment.protein_source && entry.carbs_g < 15;
  // the plan as it stood when this was eaten, from the row the day showed: a meal is graded against that, never against a plan redrawn later in the day
  entry.plan = !entry.drink_only ? F.planSnapshot(pick.row, entry.time) : null;
  const pm = MI.plateMicros(entry.ingredients, a.micronutrients || null);
  entry.micros = pm.micros; entry.micros_matched_pct = pm.matched_pct; entry.micros_unknown = pm.unknown;
  // The full photo in its own key, so the day document stays small enough to read on every page load.
  if (images.length) await setJSON(photoKey(id), { media_type: images[0].media_type || 'image/jpeg', data: images[0].image_base64,
    more: images.slice(1, 4).map(i => ({ media_type: i.media_type || 'image/jpeg', data: i.image_base64 })) }).catch(() => {});
  entry.photos = Math.min(4, images.length);
  const doc = await dayDoc(date);
  doc.entries.push(F.alcoholRule(entry));
  await setJSON(dayKey(date), doc);
  await pruneOld(date).catch(() => {});
  // The ledger sees the same meal, tagged so a delete here removes it there.
  await logMeal({ name: entry.name, meal: entry.meal === 'on the bike' ? 'snack' : entry.meal,
    kcal: entry.kcal, carbs_g: entry.carbs_g, protein_g: entry.protein_g, fat_g: entry.fat_g, food_id: id }).catch(() => {});
  return entry;
}

// A known item (a chain menu order, with its published macros) logged
// without a photo. The entry looks like any other so every scorer reads it;
// the place is kept so the advisor can prefer it next time.
async function addKnown(body) {
  const b = body || {};
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name || !(Number(b.kcal) >= 0)) throw new Error('name and kcal needed');
  const date = tz.todayKey();
  const g = await guidelinesFor(date);
  const meal = MEAL_WORDS.includes(b.meal) ? b.meal : null;
  const id = 'f_' + crypto.randomBytes(5).toString('hex');
  const nowHM = hmNow();
  const tags = Array.isArray(b.tags) ? b.tags : [];
  // a glass of water takes no slot; anything else gets its slot once, from the rows the day shows now
  let pick = { slot: null, row: null };
  try { const st = await dayState(date, g); pick = chooseSlot(st.rows, nowHM, meal, st.entries); } catch (e) { pick = { slot: F.slotFor(g.meals, nowHM, meal), row: null }; }
  const slot = pick.slot;
  const entry = {
    id, at: new Date().toISOString(), date, time: nowHM, slot, slot_fixed: true,
    meal: mealWord(slot, meal, null),
    name, portion: b.place ? `at ${String(b.place).slice(0, 60)}` : 'as sold', kcal: Math.round(Number(b.kcal) || 0), carbs_g: Math.round(Number(b.carbs_g) || 0),
    protein_g: Math.round(Number(b.protein_g) || 0), fat_g: Math.round(Number(b.fat_g) || 0), confidence: 'high', notes: 'published nutrition, approximate',
    assessment: { protein_source: (Number(b.protein_g) || 0) >= 25, carbs: (Number(b.carbs_g) || 0) >= 45 ? 'heavy' : (Number(b.carbs_g) || 0) >= 15 ? 'some' : 'none', vegetables: tags.includes('veg'),
      processed: tags.includes('fried') || tags.includes('sweet'), fits: b.fits || 'partly', why: F.tidyWhy(b.why || 'A known order, logged with its published numbers.', 420) },
    thumb: null, written: null, ingredients: [], micros: null, micros_matched_pct: null, micros_unknown: [],
    fluid_ml: tags.includes('drink') ? Math.max(0, Math.round(Number(b.fluid_ml) || 500)) : 0, drink: tags.includes('drink') ? name.slice(0, 40) : null,
    place: b.place ? { name: String(b.place).slice(0, 80), brand: b.brand || null } : null, source: 'menu'
  };
  entry.drink_only = entry.fluid_ml > 0 && entry.kcal < 60 && !entry.assessment.protein_source && entry.carbs_g < 15;
  // the plan as it stood when this was eaten, from the row the day showed: a meal is graded against that, never against a plan redrawn later in the day
  entry.plan = !entry.drink_only ? F.planSnapshot(pick.row, entry.time) : null;
  const doc = await dayDoc(date);
  doc.entries.push(F.alcoholRule(entry));
  await setJSON(dayKey(date), doc);
  await logMeal({ name: entry.name, meal: entry.meal === 'on the bike' ? 'snack' : entry.meal, kcal: entry.kcal, carbs_g: entry.carbs_g, protein_g: entry.protein_g, fat_g: entry.fat_g, food_id: id }).catch(() => {});
  if (b.brand) await require('./menus').remember(b.brand, { name, kcal: entry.kcal, carbs_g: entry.carbs_g, protein_g: entry.protein_g, fat_g: entry.fat_g }).catch(() => {});
  return entry;
}

async function pruneOld(today) {
  const idx = await getJSON('food-index', { days: [] });
  if (!idx.days.includes(today)) idx.days.push(today);
  const floor = tz.shiftKey(today, -KEEP_DAYS);
  idx.days = idx.days.filter(d => d >= floor).sort();
  await setJSON('food-index', idx);
}

async function removeFromLedger(id) {
  const d = await getJSON('fuel-log', { meals: [] });
  const before = d.meals.length;
  d.meals = d.meals.filter(m => m.food_id !== id);
  if (d.meals.length !== before) await setJSON('fuel-log', d);
}

function attach(app) {
  app.get('/food/today', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await dayReport(tz.todayKey())); } catch (e) { res.status(500).json({ error: e.message }); } });

  // The week's food score, day by day, with what each day missed: the Food page's score card. A past day's row is
  // kept for an hour (a correction to yesterday shows within the hour); today is read fresh.
  app.get('/food/week', async (req, res) => { if (!auth(req, res)) return;
    try {
      const today = tz.todayKey(), cache = await getJSON('food-week-cache', { rows: {} });
      const rowOf = r => { const c = r.compliance || {}, pm = c.macros && c.macros.per_macro || {};
        const logged = (r.entries || []).some(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
        return { logged, overall: logged ? c.overall : null, band: logged && c.band ? c.band.word : null, kcal: r.actual ? r.actual.kcal : null, kcal_target: r.target ? r.target.kcal : null,
          macros: Object.fromEntries(['carbs_g', 'protein_g', 'fat_g'].map(k => [k, pm[k] ? { actual: pm[k].actual, target: pm[k].target, score: pm[k].score, direction: pm[k].direction } : null])),
          macro_score: c.macros ? c.macros.overall : null, guide_score: c.guidelines ? c.guidelines.score : null,
          checks: ((c.guidelines && c.guidelines.checks) || []).map(x => ({ key: x.key, label: x.label, ok: !!x.ok, detail: x.detail || '' })) }; };
      const days = []; let dirty = false;
      for (let i = 6; i >= 0; i--) {
        const d = tz.shiftKey(today, -i);
        let row = d !== today && cache.rows[d] && Date.now() - (cache.rows[d].at || 0) < 3600e3 ? cache.rows[d].row : null;
        if (!row) { try { row = rowOf(await dayReport(d)); if (d !== today) { cache.rows[d] = { at: Date.now(), row }; dirty = true; } } catch (e) { row = { logged: false, overall: null, checks: [], macros: {} }; } }
        days.push(Object.assign({ date: d }, row));
      }
      if (dirty) { for (const k of Object.keys(cache.rows)) if (k < tz.shiftKey(today, -14)) delete cache.rows[k]; await setJSON('food-week-cache', cache).catch(() => {}); }
      const scored = days.filter(x => x.logged && x.overall != null);
      res.json({ today, days, week: scored.length ? Math.round(scored.reduce((a, x) => a + x.overall, 0) / scored.length) : null, days_logged: scored.length });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/food/day', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await dayReport(isDate(req.query.date) ? req.query.date : tz.todayKey())); }
    catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/food/guidelines', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await guidelinesFor(isDate(req.query.date) ? req.query.date : tz.todayKey())); }
    catch (e) { res.status(500).json({ error: e.message }); } });

  // Words instead of a photo: {text, meal?}
  app.post('/food/item', async (req, res) => { if (!auth(req, res)) return;
    try { const entry = await addKnown(req.body); res.json({ ok: true, entry, day: await dayReport(entry.date) }); }
    catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
  // re-read the day's earlier sentences against the day as it now stands
  app.post('/food/recheck', async (req, res) => { if (!auth(req, res)) return;
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test((req.body || {}).date || '') ? req.body.date : tz.todayKey();
      const r = await recheckDay(date);
      res.json(Object.assign({ ok: true }, r, { day: await dayReport(date) }));
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
  // The same words again within twenty minutes are caught here, before the read, as the voice catches
  // them: 409 with the earlier entry; sent again with force: true, both are kept.
  app.post('/food/text', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      if (!b.force) {
        const twin = await twinToday(b.text);
        if (twin) return res.status(409).json({ ok: false, double: true, twin: { id: twin.id, name: twin.name, time: twin.time, kcal: twin.kcal },
          error: `Looks like the same as ${tz.hm12(twin.time)} (${twin.name}): keep both?` });
      }
      const entry = await addPhoto({ text: b.text, meal: b.meal });
      res.json({ ok: true, entry, day: await dayReport(entry.date) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

  app.post('/food/photo', async (req, res) => { if (!auth(req, res)) return;
    try {
      const entry = await addPhoto(req.body || {});
      res.json({ ok: true, entry, day: await dayReport(entry.date) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

  // A supplement is an entry without a photo: one tap, its nutrients counted.
  // the legs tap after a ride, and the fuel verdicts for the days ahead (calendar dots)
  app.post('/fuel/legs', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await rateLegs((req.body || {}).key, Number((req.body || {}).legs))); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.get('/fuel/ahead', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(4, Number(req.query.days) || 3));
      const dates = Array.from({ length: days }, (_, i) => tz.shiftKey(tz.todayKey(), i));
      const reports = await Promise.all(dates.map(d => dayReport(d).catch(() => null)));
      const out = [];
      reports.forEach((d, i) => { for (const s of (d && d.energy && d.energy.sessions) || []) out.push({ date: dates[i], name: s.name, time: s.time, band: s.band.key, pct: s.pct, legs_pct: s.legs_pct, advice: s.advice }); });
      res.json({ sessions: out });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/food/supplement', async (req, res) => { if (!auth(req, res)) return;
    try {
      const entry = await addSupplement(String((req.body || {}).key || ''));
      if (!entry) return res.status(400).json({ error: 'unknown supplement' });
      res.json({ ok: true, entry, day: await dayReport(entry.date) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

  app.get('/food/photo/:id', async (req, res) => { if (!auth(req, res)) return;
    const p = await getJSON(photoKey(String(req.params.id).replace(/[^\w]/g, '')), null);
    if (!p) return res.status(404).json({ error: 'no such photo' });
    res.json(p); });

  app.put('/food/:id', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      const date = isDate(b.date) ? b.date : tz.todayKey();
      const doc = await dayDoc(date);
      const e = doc.entries.find(x => x.id === req.params.id);
      if (!e) return res.status(404).json({ error: 'no such entry' });
      if (b.plan && typeof b.plan === 'object' && b.plan.kcal != null) e.plan = { slot: String(b.plan.slot || e.slot || ''), kcal: Math.round(+b.plan.kcal), carbs_g: Math.round(+b.plan.carbs_g || 0), protein_g: Math.round(+b.plan.protein_g || 0), low_carb: !!b.plan.low_carb, what: String(b.plan.what || '').slice(0, 200), at: String(b.plan.at || e.time || '') };
      const onlyKcal = b.kcal != null && Number.isFinite(Number(b.kcal)) && ['carbs_g', 'protein_g', 'fat_g'].every(k => b[k] == null || Number(b[k]) === Number(e[k]));
      if (onlyKcal && e.kcal > 0) { const f = Number(b.kcal) / e.kcal; for (const k of ['carbs_g', 'protein_g', 'fat_g']) e[k] = Math.max(0, Math.round((e[k] || 0) * f)); }   // the plate got bigger or smaller, not a different plate
      for (const k of ['kcal', 'carbs_g', 'protein_g', 'fat_g']) if (b[k] != null && Number.isFinite(Number(b[k]))) e[k] = Math.max(0, Math.round(Number(b[k])));
      for (const x of doc.entries) if (x.why_as_of) delete x.why_as_of;   // the day changed: every sentence is re-read, this plate's first
      if (b.name) e.name = String(b.name).slice(0, 80);
      // A slot changes only when he says so: a different meal named, or a different time. The plan it is
      // graded against is then the one that slot shows (the slot's own frozen plan when it already holds food).
      const shown = MEAL_WORDS.includes(e.slot) ? e.slot : e.meal;
      const newMeal = MEAL_WORDS.includes(b.meal) && b.meal !== shown ? b.meal : null;
      const newTime = /^\d{2}:\d{2}$/.test(b.time || '') && b.time !== e.time ? b.time : null;
      if (MEAL_WORDS.includes(b.meal)) e.meal = b.meal;
      if (['yes', 'partly', 'no'].includes(b.fits)) e.assessment.fits = b.fits;
      if (newTime) { e.time = newTime; doc.entries.sort((x, y) => String(x.time).localeCompare(String(y.time))); }
      if ((newMeal || newTime) && !e.supplement) {
        const gl = await guidelinesFor(date);
        const st = await dayState(date, gl);
        const others = st.entries.filter(x => x.id !== e.id);
        const rows = await rowsFor(date, gl, others);
        const pick = chooseSlot(rows, e.time, newMeal, others);
        e.slot = newMeal && rows.some(r => r.slot === newMeal) ? newMeal : pick.slot;
        e.slot_fixed = true;
        const row = rows.find(r => r.slot === e.slot) || null;
        if (!e.drink_only) e.plan = F.planSnapshot(row, e.time) || e.plan || null;
      }
      e.corrected = true;
      await setJSON(dayKey(date), doc);
      // keep the ledger in step
      const led = await getJSON('fuel-log', { meals: [] });
      const m = led.meals.find(x => x.food_id === e.id);
      if (m) { Object.assign(m, { name: e.name, kcal: e.kcal, carbs_g: e.carbs_g, protein_g: e.protein_g, fat_g: e.fat_g }); await setJSON('fuel-log', led); }
      // the sentences are re-read by the Food page right after (POST /food/recheck): the correction answers at once
      res.json({ ok: true, entry: e, day: await dayReport(date) });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  // Two or more entries were one meal: fold them into one. With `text`, the
  // combined plate is read again from his words (so a food neither photo
  // caught can be added); without it the numbers are simply added up. The
  // merged entry keeps the earliest time and slot; the originals go.
  app.post('/food/merge', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
      const date = isDate(b.date) ? b.date : tz.todayKey();
      let doc = await dayDoc(date);
      const olds = doc.entries.filter(e => ids.includes(e.id) && !e.supplement).sort((x, y) => String(x.time).localeCompare(String(y.time)));
      if (olds.length < 2) return res.status(400).json({ error: 'pick two or more entries' });
      const first = olds[0];
      const meal = ['breakfast', 'lunch', 'dinner', 'snack', 'on the bike'].includes(b.meal) ? b.meal : first.meal;
      let merged;
      if (b.text && String(b.text).trim()) {
        if (date !== tz.todayKey()) return res.status(400).json({ error: 'a re-read is only for today' });
        // The originals go first: if the read outlives the function, the page shows the gap, never three entries.
        doc.entries = doc.entries.filter(e => !ids.includes(e.id)); await setJSON(dayKey(date), doc);
        for (const id of ids) await removeFromLedger(id);
        const r = await addPhoto({ text: String(b.text).trim(), meal });
        doc = await dayDoc(date);
        merged = doc.entries.find(e => e.id === r.entry.id);
      } else {
        const sum = k => olds.reduce((a, e) => a + (e[k] || 0), 0);
        const g = await guidelinesFor(date);
        merged = Object.assign({}, first, {
          id: 'f_' + crypto.randomBytes(5).toString('hex'), meal,
          name: olds.map(e => e.name).join(' + ').slice(0, 80), portion: olds.map(e => e.portion).filter(Boolean).join('; ').slice(0, 120),
          kcal: sum('kcal'), carbs_g: sum('carbs_g'), protein_g: sum('protein_g'), fat_g: sum('fat_g'), fluid_ml: sum('fluid_ml'),
          drink: olds.map(e => e.drink).filter(Boolean).join(', ').slice(0, 40) || null,
          assessment: { protein_source: olds.some(e => e.assessment && e.assessment.protein_source),
            carbs: olds.some(e => e.assessment && e.assessment.carbs === 'heavy') ? 'heavy' : olds.some(e => e.assessment && e.assessment.carbs === 'some') ? 'some' : 'none',
            vegetables: olds.some(e => e.assessment && e.assessment.vegetables), processed: olds.some(e => e.assessment && e.assessment.processed),
            fits: first.assessment ? first.assessment.fits : 'partly', why: olds.map(e => e.assessment && e.assessment.why).filter(Boolean).join(' ').slice(0, 420) },
          written: olds.map(e => e.written).filter(Boolean).join('; ') || null, thumb: olds.map(e => e.thumb).find(Boolean) || null,
          ingredients: olds.flatMap(e => e.ingredients || []).slice(0, 20),
          micros: MI.sumDays(olds.map(e => e.micros).filter(Boolean)), micros_unknown: olds.flatMap(e => e.micros_unknown || []),
          micros_matched_pct: Math.round(olds.reduce((a, e) => a + (e.micros_matched_pct || 0), 0) / olds.length), merged_from: ids
        });
        merged.drink_only = false;
        doc.entries.push(merged);
        await logMeal({ name: merged.name, meal: merged.meal === 'on the bike' ? 'snack' : merged.meal, kcal: merged.kcal, carbs_g: merged.carbs_g, protein_g: merged.protein_g, fat_g: merged.fat_g, food_id: merged.id });
        void g;
      }
      // one meal in two entries keeps the first one's slot and the plan it was graded against
      merged.time = first.time; merged.at = first.at; merged.merged_from = ids;
      if (first.slot !== undefined) { merged.slot = first.slot; merged.slot_fixed = true; if (first.plan) merged.plan = first.plan; }
      else { const gl = await guidelinesFor(date); merged.slot = F.slotFor(gl.meals, merged.time); merged.slot_fixed = true; }
      if (merged.assessment) merged.assessment.why = F.tidyWhy(merged.assessment.why, 420);
      doc.entries = doc.entries.filter(e => !ids.includes(e.id));
      doc.entries.sort((x, y) => String(x.time).localeCompare(String(y.time)));
      await setJSON(dayKey(date), doc);
      for (const id of ids) await removeFromLedger(id);
      res.json({ ok: true, entry: merged });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.delete('/food/:id', async (req, res) => { if (!auth(req, res)) return;
    try {
      const date = isDate(req.query.date) ? req.query.date : tz.todayKey();
      const gone = await removeEntry(req.params.id, date);
      if (!gone) return res.status(404).json({ error: 'no such entry' });
      // the sentences are re-read by the Food page right after (POST /food/recheck): the removal answers at once
      res.json({ ok: true, removed: gone, day: await dayReport(date) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, dayReport, recheckDay, bodyKg, dayDocFor: dayDoc, saveDayDoc: (date, doc) => setJSON(dayKey(date), doc), guidelinesFor, sessionsFor, addPhoto, addKnown, addSupplement, removeEntry, todayEntries, twinToday, rateLegs };
