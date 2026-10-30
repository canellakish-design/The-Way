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

// ---- the day's sessions: planned here, planned in intervals.icu, done on Strava ----
async function sessionsFor(date) {
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const out = [];
  try {
    const d = await getJSON('plan-workouts', { workouts: {} });
    for (const w of Object.values(d.workouts || {})) if (w.date === date) {
      const m = W.metrics(w.steps || [], st);
      const start = w.time ? tz.zonedToUTC(...date.split('-').map(Number), +w.time.slice(0, 2), +w.time.slice(3, 5)) : null;
      const { pastNow } = require('./workouts');
      const logged = pastNow(w, tz.todayKey());
      out.push({ name: w.name, sport: w.sport, minutes: Math.round(m.duration_s / 60), tss: m.tss, notes: w.notes || '', planned: !logged, done: logged,
        time: w.time || null, start_at: start ? start.toISOString() : null,
        end_time: w.time ? F.toHM(F.toMin(w.time) + Math.round(m.duration_s / 60)) : null,
        end_at: logged && start ? new Date(start.getTime() + m.duration_s * 1000).toISOString() : null });
    }
  } catch (e) { /* no plan store yet */ }
  // A planned session whose start has passed with no ride logged has not
  // started: it slides to now, so the fuel and water curves do not burn for
  // a ride that is not happening and the post-ride meal moves with it. The
  // ride itself, once Strava has it, replaces the plan with the real start.
  if (date === tz.todayKey()) {
    const p = tz.parts(new Date()); const nowMin = p.h * 60 + p.mi;
    for (const s of out) {
      const start = F.toMin(s.time);
      if (s.done || start == null || start >= nowMin - 10) continue;
      const to = Math.ceil(nowMin / 5) * 5;
      s.slid_from = s.time; s.time = F.toHM(to);
      s.end_time = F.toHM(to + s.minutes);
      s.start_at = tz.zonedToUTC(...date.split('-').map(Number), Math.floor(to / 60), to % 60).toISOString();
    }
  }
  try {
    const { calendar } = require('./workouts');
    const cal = await calendar(date, date);
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
  let sessions = out, work = null;
  if (done.length) {
    const { gradeOne } = require('./workouts');
    const lastEnd = Math.max(...done.map(d => F.toMin(d.end_time) ?? 0));
    const lastRide = done.slice().sort((a, b) => (F.toMin(a.end_time) ?? 0) - (F.toMin(b.end_time) ?? 0)).pop();
    const covered = planned.filter(p => !(F.toMin(p.time) != null && F.toMin(p.time) > lastEnd + 30));
    const ahead = planned.filter(p => F.toMin(p.time) != null && F.toMin(p.time) > lastEnd + 30);
    const rides = done.map(r => ({ minutes: r.minutes, tss: r.tss }));
    const graded = covered.map(p => Object.assign({}, p, { compliance: gradeOne({ metrics: { duration_s: (p.minutes || 0) * 60, tss: p.tss || 0 } }, rides).compliance }));
    const compliant = graded.length > 0 && graded.every(p => p.compliance.pct >= 85);
    const pm = planned.reduce((a, p) => a + (p.minutes || 0), 0), dm = done.reduce((a, d) => a + (d.minutes || 0), 0);
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
        note: !pm ? `Ridden ${dm} min with nothing planned: today is a ${F.LABEL[actualDay]}.`
          : plannedDay === actualDay ? `Ridden ${dm} of ${pm} min planned (${pct}%): still a ${F.LABEL[actualDay]}, sized to the ride.`
          : `Planned ${pm} min (${F.LABEL[plannedDay]}); ridden ${dm} min (${pct}%), so the rest of today is a ${F.LABEL[actualDay]}.` };
    }
  }
  return { sessions, ftp: st.ftp, work };
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
  const { sessions, ftp, work } = await sessionsFor(date);
  const day = F.fuelDay(sessions);
  const [{ deficit, why }, kg] = await Promise.all([deficitFor(date), bodyKg()]);
  const t = F.targets(day, F.workoutKcal(sessions, ftp), { kg, deficit });
  if (why) t.deficit_note = why;
  if (t.deficit_trimmed) t.deficit_note = (t.deficit_note ? t.deficit_note + '; ' : '') + `deficit eased by ${t.deficit_trimmed} kcal to keep carbs at ${t.per_kg.carbs} g/kg for the work`;
  const rideNotes = sessions.filter(s => s.notes && /EAT/.test(s.notes)).map(s => ({ name: s.name, notes: s.notes }));
  const today = date === tz.todayKey();
  return { date, day, fuel_day: t.fuel_day, target: t, kg, guidelines: F.guidelines(day, { deficit: t.deficit !== 0 }), ride_notes: rideNotes, work,
    cue: today ? F.cue(day, sessions) : null,
    meals: F.mealPlan(day, sessions, t),
    sessions: sessions.map(s => ({ name: s.name, minutes: s.minutes, tss: s.tss, done: !!s.done, time: s.time || null, sport: s.sport || null,
      slid_from: s.slid_from || null, start_at: s.start_at || null, end_at: s.end_at || null })) };
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

function promptFor(g, meal, notes, written) {
  const rules = g.guidelines.map(x => '- ' + x.text).join('\n');
  return `You are the nutrition coach for one cyclist. He photographs every meal; you read the photo.${written ? `
This time there is no photo: he wrote the meal down instead. Read his words as the plate: "${written}". Weights he gives are from a kitchen scale and are exact: use them as given. Where he gives none, assume his usual portions for a ${g.kg || 98} kg cyclist and say so in the portion field.` : ''}
Today is a ${g.fuel_day}. Targets for the whole day: ${g.target.kcal} kcal, ${g.target.carbs_g} g carbs, ${g.target.protein_g} g protein, ${g.target.fat_g} g fat.
Today's guidelines:
${rules}
${g.work ? `What happened on the bike: ${g.work.note}\n` : ''}Today's meal plan, timed around the training:
${(g.meals || []).map(m => `- ${tz.hm12(m.time)} ${m.slot}: ${m.what}${m.kcal ? ` (~${m.kcal} kcal, ${m.carbs_g} g carbs${m.protein_g ? `, ${m.protein_g} g protein` : ''})` : ''}`).join('\n')}
${g.cue ? `Where the day stands right now: ${g.cue.text}\n` : ''}${g.logged && g.logged.length ? `Already in the journal today (do not ask for a meal he has already eaten): ${g.logged.map(e => `${e.time} ${e.meal}: ${e.name} (${e.kcal} kcal, ${e.carbs_g} C / ${e.protein_g} P / ${e.fat_g} F${e.fluid_ml ? `, ${e.fluid_ml} ml` : ''})`).join('; ')}. Eaten so far: ${g.logged.reduce((a, e) => a + (e.kcal || 0), 0)} kcal, ${g.logged.reduce((a, e) => a + (e.carbs_g || 0), 0)} C / ${g.logged.reduce((a, e) => a + (e.protein_g || 0), 0)} P / ${g.logged.reduce((a, e) => a + (e.fat_g || 0), 0)} F.\n` : ''}${meal ? `He says this is ${meal}.` : 'Guess which meal this is from the food and the time of day.'}${notes ? `\nHis note, which overrides what you can see: "${notes}"` : ''}

Identify the food and estimate the portion and its macros as eaten (read a scale display if one is in the photo).
List the ingredients you can see with grams each, in plain names (white rice, salmon, spinach, soy sauce), and estimate the plate's micronutrients: iron, calcium, magnesium, potassium, sodium, zinc, vitamin D, B12, folate, vitamin C, vitamin A, omega-3 EPA and DHA, fibre.
Drinks: fluid_ml is the millilitres of drinkable liquid in the photo as drunk, the glass, mug, bottle or bowl of broth (a mug 300, a pint glass 500, a bike bottle 600 or 750 by its size, a can 330); coffee, tea, milk, smoothies, sports drink and soup count in full, alcohol counts 0, and 0 when there is no drink. drink names it in two or three words, or is empty. A photo of only a bottle or a glass is a drink, not a meal: food_name is the drink, kcal as drunk, meal_guess snack, fits yes.
Then judge the plate against today's guidelines and the meal-plan slot nearest to now: protein_source is true when there is a real protein serving (roughly 30 g or more); carbs is none, some or heavy by the starch and sugar on the plate; vegetables counts fruit; processed means ultra-processed or fried or sweets.
fits is "yes" when the plate does what today's rules ask, "partly" when it does most of it, "no" when it works against them. why is one plain sentence, direct, the way a coach at the trainer would say it. Current time of day where he is: ${tz.parts(new Date()).h}:00.`;
}

async function analyze(images, g, meal, notes, written) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const content = (images || []).slice(0, 3).map(img => ({ type: 'image',
    source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.image_base64 } }));
  content.push({ type: 'text', text: promptFor(g, meal, notes, written) });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
      'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000,
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }]
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('vision ' + r.status + ': ' + ((j.error && j.error.message) || JSON.stringify(j)).slice(0, 200));
  if (j.stop_reason === 'refusal') throw new Error('the model declined to read this photo' + (j.stop_details && j.stop_details.explanation ? ': ' + j.stop_details.explanation : ''));
  const block = (j.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no answer from the vision model');
  let out;
  try { out = JSON.parse(block.text.replace(/```json|```/g, '').trim()); }
  catch { throw new Error('vision answer was not JSON: ' + block.text.slice(0, 160)); }
  return out;
}

async function dayReport(date) {
  const g = await guidelinesFor(date);
  const doc = await dayDoc(date);
  const entries = doc.entries.map(e => Object.assign({}, e, { photo: undefined }));
  const sum = k => Math.round(entries.filter(e => !e.supplement).reduce((a, e) => a + (e[k] || 0), 0));
  const meals = entries.filter(e => !e.supplement && !e.drink_only);
  const actual = { kcal: sum('kcal'), carbs_g: sum('carbs_g'), protein_g: sum('protein_g'), fat_g: sum('fat_g'), meals: entries.length };
  const { scoreDay } = require('./intake');
  // Macros are read against what the plan says should be in by now (today), or the whole day (a past day).
  const nowHM0 = (() => { const p = tz.parts(new Date()); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); })();
  const due = date === tz.todayKey() ? F.dueSoFar(g.meals, g.target, nowHM0) : null;
  const macroTarget = due ? (due.kcal > 0 ? Object.assign({}, g.target, due) : null) : g.target;
  const macro = macroTarget ? scoreDay(actual, macroTarget) : null;
  const rides = g.sessions.filter(s => s.done && s.end_at);
  const guide = F.guidelineScore(g.day, meals, rides, g.meals);
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
  // Live fuel: the carbohydrate on board through the day, from what was logged (energy-math.js).
  let energy = null;
  try { energy = await liveFuel(date, entries, g, nowMin); } catch (e) { energy = null; }
  return {
    date, today: date === tz.todayKey(),
    fuel_day: g.fuel_day, day: g.day, target: g.target, guidelines: g.guidelines, ride_notes: g.ride_notes, sessions: g.sessions, cue: g.cue, work: g.work,
    meals: g.meals.map(m => Object.assign({}, m, { logged: entries.filter(e => e.slot === m.slot).map(e => e.id), match: F.mealMatch(m, entries.filter(e => e.slot === m.slot)) })),
    actual: Object.assign(actual, { meals: meals.length }), entries,
    hydration, energy,
    compliance: { overall, band: F.band(overall), macros: macro, guidelines: guide, due },
    micros: micro ? Object.assign(micro, { suggest: microSuggest, supplements_available: MI.TABLE.supplements.map(x => ({ key: x.key, name: x.name, note: x.note })) }) : null,
    suggestion: date === tz.todayKey() ? nextUp(g, entries, actual, macro, nowHM0) : null,
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
  const planMeals = g.meals.map(m => Object.assign({}, m, { logged: entries.filter(e => e.slot === m.slot).map(e => e.id) }));
  const days = await getJSON('energy-days', { days: {} });
  const prev = days.days[tz.shiftKey(date, -1)] || null;
  const taps = await getJSON('fuel-legs', { rides: [] });
  const cal = EM.calibrate(taps.rides);
  const energy = EM.model(Object.assign({ entries, meals: planMeals, sessions: g.sessions, now_min: nowMin, ftp: st.ftp, cal }, EM.carryOver(prev)));
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
        const my = HL.model({ entries: ey, sessions: gy.sessions, now_min: null, kg: gy.kg, ftp: st.ftp, weather: null, sweat_k: k, start_ml: (hdays.days[tz.shiftKey(yday, -1)] || {}).end_ml != null ? HL.carryOver(hdays.days[tz.shiftKey(yday, -1)].end_ml, null).start_ml : 0 });
        prev = hdays.days[yday] = { end_ml: my.end_ml, at: Date.now() };
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
  const carry = HL.carryOver(prev ? prev.end_ml : null, scale);
  const live = HL.model({ entries, sessions: g.sessions, now_min: nowMin, kg: g.kg, ftp: st.ftp, weather, sweat_k: k, weigh, start_ml: carry.start_ml });
  live.carried = Object.assign({ from_date: yday }, carry);
  const wasH = hdays.days[date];
  if (!wasH || wasH.end_ml !== live.end_ml) {
    hdays.days[date] = { end_ml: live.end_ml, at: Date.now() };
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
  live.note = live.advice || (live.now.band.key === 'blue' ? 'Ahead of the morning.' : `${(Math.abs(live.now.ml) / 1000).toFixed(1)} L ${live.now.ml < 0 ? 'down' : 'up'} on the morning.`);
  return live;
}

// The suggestion is the plan's next slot, sized to the slot, with the
// compliance it would leave: what the plan says to eat next, not a snack
// chosen against the whole day. After the last slot, only a protein gap
// earns a word (whey or cottage cheese, as the plan's snack says).
function nextUp(g, entries, actual, macroNow, nowHM) {
  const { scoreDay } = require('./intake');
  const meals = g.meals.map(m => Object.assign({}, m, { logged: entries.filter(e => e.slot === m.slot && !e.supplement && (!e.drink_only || m.slot === 'on the bike')).map(e => e.id) }));
  const nx = F.nextSlot(meals, nowHM);
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
    why: late ? 'its time has come' : 'next on the plan',
    score_before: before, score_after: scoredAfter ? scoredAfter.overall : null,
    snap: nx.slot === 'before' || nx.slot === 'after' || nx.slot === 'on the bike' ? 'snack' : nx.slot };
}

// Remove one entry from a day (and from the ledger). Returns the entry, or null.
async function removeEntry(id, date) {
  const doc = await dayDoc(date);
  const gone = doc.entries.find(x => x.id === id);
  if (!gone) return null;
  doc.entries = doc.entries.filter(x => x.id !== id);
  await setJSON(dayKey(date), doc);
  await removeFromLedger(id);
  return gone;
}
// Today's entries, newest last, for the voice's "remove the ..." and "undo".
async function todayEntries() { return (await dayDoc(tz.todayKey())).entries; }

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
  const meal = ['breakfast', 'lunch', 'dinner', 'snack', 'on the bike'].includes(body.meal) ? body.meal : null;
  const notes = body.notes ? String(body.notes).slice(0, 300) : '';
  // The coach sees what is already in the journal, so it never asks for a meal just eaten.
  try { g.logged = (await dayDoc(date)).entries.filter(e => !e.supplement).map(e => ({ time: e.time, meal: e.drink_only ? 'drink' : e.meal, name: e.name, kcal: e.kcal, carbs_g: e.carbs_g, protein_g: e.protein_g, fat_g: e.fat_g, fluid_ml: e.fluid_ml || 0 })); } catch (e) { g.logged = []; }
  const a = await analyze(images, g, meal, notes, written);
  const id = 'f_' + crypto.randomBytes(5).toString('hex');
  const nowHM = (() => { const p = tz.parts(new Date()); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); })();
  const entry = {
    id, at: new Date().toISOString(), date, time: nowHM,
    slot: F.slotFor(g.meals, nowHM),
    meal: meal || a.meal_guess || 'snack',
    name: String(a.food_name || 'meal').slice(0, 80), portion: String(a.portion || '').slice(0, 120),
    kcal: Math.max(0, Math.round(a.kcal || 0)), carbs_g: Math.max(0, Math.round(a.carbs_g || 0)),
    protein_g: Math.max(0, Math.round(a.protein_g || 0)), fat_g: Math.max(0, Math.round(a.fat_g || 0)),
    confidence: a.confidence || 'medium', notes,
    assessment: { protein_source: !!a.protein_source, carbs: a.carbs || 'some', vegetables: !!a.vegetables,
      processed: !!a.processed, fits: a.fits || 'partly', why: String(a.why || '').slice(0, 240) },
    thumb: body.thumb_base64 ? String(body.thumb_base64).slice(0, 60000) : null,
    written: written || null,
    ingredients: Array.isArray(a.ingredients) ? a.ingredients.slice(0, 20).map(i => ({ name: String(i.name || '').slice(0, 60), grams: Math.max(0, Math.round(i.grams || 0)) })) : [],
    micros: null, micros_matched_pct: null, micros_unknown: [],
    fluid_ml: Math.max(0, Math.min(3000, Math.round(a.fluid_ml || 0))), drink: String(a.drink || '').slice(0, 40) || null
  };
  // A bottle or a glass on its own is a drink: it counts for hydration, not as a meal the rules judge.
  entry.drink_only = entry.fluid_ml > 0 && entry.kcal < 60 && !entry.assessment.protein_source && entry.carbs_g < 15;
  const pm = MI.plateMicros(entry.ingredients, a.micronutrients || null);
  entry.micros = pm.micros; entry.micros_matched_pct = pm.matched_pct; entry.micros_unknown = pm.unknown;
  // The full photo in its own key, so the day document stays small enough to read on every page load.
  if (images.length) await setJSON(photoKey(id), { media_type: images[0].media_type || 'image/jpeg', data: images[0].image_base64 }).catch(() => {});
  const doc = await dayDoc(date);
  doc.entries.push(entry);
  await setJSON(dayKey(date), doc);
  await pruneOld(date).catch(() => {});
  // The ledger sees the same meal, tagged so a delete here removes it there.
  await logMeal({ name: entry.name, meal: entry.meal === 'on the bike' ? 'snack' : entry.meal,
    kcal: entry.kcal, carbs_g: entry.carbs_g, protein_g: entry.protein_g, fat_g: entry.fat_g, food_id: id }).catch(() => {});
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

  app.get('/food/day', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await dayReport(isDate(req.query.date) ? req.query.date : tz.todayKey())); }
    catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/food/guidelines', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await guidelinesFor(isDate(req.query.date) ? req.query.date : tz.todayKey())); }
    catch (e) { res.status(500).json({ error: e.message }); } });

  // Words instead of a photo: {text, meal?}
  app.post('/food/text', async (req, res) => { if (!auth(req, res)) return;
    try {
      const entry = await addPhoto({ text: (req.body || {}).text, meal: (req.body || {}).meal });
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
      for (const k of ['kcal', 'carbs_g', 'protein_g', 'fat_g']) if (b[k] != null && Number.isFinite(Number(b[k]))) e[k] = Math.max(0, Math.round(Number(b[k])));
      if (b.name) e.name = String(b.name).slice(0, 80);
      if (['breakfast', 'lunch', 'dinner', 'snack', 'on the bike'].includes(b.meal)) e.meal = b.meal;
      if (['yes', 'partly', 'no'].includes(b.fits)) e.assessment.fits = b.fits;
      if (/^\d{2}:\d{2}$/.test(b.time || '')) { e.time = b.time; const gl = await guidelinesFor(date); e.slot = F.slotFor(gl.meals, e.time); doc.entries.sort((x, y) => String(x.time).localeCompare(String(y.time))); }
      e.corrected = true;
      await setJSON(dayKey(date), doc);
      // keep the ledger in step
      const led = await getJSON('fuel-log', { meals: [] });
      const m = led.meals.find(x => x.food_id === e.id);
      if (m) { Object.assign(m, { name: e.name, kcal: e.kcal, carbs_g: e.carbs_g, protein_g: e.protein_g, fat_g: e.fat_g }); await setJSON('fuel-log', led); }
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
            fits: first.assessment ? first.assessment.fits : 'partly', why: olds.map(e => e.assessment && e.assessment.why).filter(Boolean).join(' ').slice(0, 240) },
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
      merged.time = first.time; merged.at = first.at; merged.merged_from = ids;
      const gl = await guidelinesFor(date); merged.slot = F.slotFor(gl.meals, merged.time);
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
      res.json({ ok: true, removed: gone, day: await dayReport(date) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, dayReport, guidelinesFor, sessionsFor, addPhoto, addSupplement, removeEntry, todayEntries, rateLegs };
