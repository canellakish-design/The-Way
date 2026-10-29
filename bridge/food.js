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

async function guidelinesFor(date) {
  const { sessions, ftp, work } = await sessionsFor(date);
  const day = F.fuelDay(sessions);
  const t = F.targets(day, F.workoutKcal(sessions, ftp));
  const rideNotes = sessions.filter(s => s.notes && /EAT/.test(s.notes)).map(s => ({ name: s.name, notes: s.notes }));
  const today = date === tz.todayKey();
  return { date, day, fuel_day: t.fuel_day, target: t, guidelines: F.guidelines(day), ride_notes: rideNotes, work,
    cue: today ? F.cue(day, sessions) : null,
    meals: F.mealPlan(day, sessions, t),
    sessions: sessions.map(s => ({ name: s.name, minutes: s.minutes, tss: s.tss, done: !!s.done, time: s.time || null,
      start_at: s.start_at || null, end_at: s.end_at || null })) };
}

// ---- the photo -> the model -> an entry ----
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['food_name', 'meal_guess', 'portion', 'kcal', 'carbs_g', 'protein_g', 'fat_g', 'confidence',
    'protein_source', 'carbs', 'vegetables', 'processed', 'fits', 'why', 'ingredients', 'micronutrients'],
  properties: {
    ingredients: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'grams'],
      properties: { name: { type: 'string' }, grams: { type: 'integer' } } } },
    micronutrients: { type: 'object', additionalProperties: false,
      required: ['iron_mg', 'calcium_mg', 'magnesium_mg', 'potassium_mg', 'sodium_mg', 'zinc_mg', 'vitamin_d_ug', 'b12_ug', 'folate_ug', 'vitamin_c_mg', 'vitamin_a_ug', 'omega3_mg', 'fiber_g'],
      properties: { iron_mg: { type: 'number' }, calcium_mg: { type: 'number' }, magnesium_mg: { type: 'number' }, potassium_mg: { type: 'number' },
        sodium_mg: { type: 'number' }, zinc_mg: { type: 'number' }, vitamin_d_ug: { type: 'number' }, b12_ug: { type: 'number' }, folate_ug: { type: 'number' },
        vitamin_c_mg: { type: 'number' }, vitamin_a_ug: { type: 'number' }, omega3_mg: { type: 'number' }, fiber_g: { type: 'number' } } },
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

function promptFor(g, meal, notes) {
  const rules = g.guidelines.map(x => '- ' + x.text).join('\n');
  return `You are the nutrition coach for one cyclist. He photographs every meal; you read the photo.
Today is a ${g.fuel_day}. Targets for the whole day: ${g.target.kcal} kcal, ${g.target.carbs_g} g carbs, ${g.target.protein_g} g protein, ${g.target.fat_g} g fat.
Today's guidelines:
${rules}
${g.work ? `What happened on the bike: ${g.work.note}\n` : ''}Today's meal plan, timed around the training:
${(g.meals || []).map(m => `- ${m.time} ${m.slot}: ${m.what}${m.kcal ? ` (~${m.kcal} kcal, ${m.carbs_g} g carbs${m.protein_g ? `, ${m.protein_g} g protein` : ''})` : ''}`).join('\n')}
${g.cue ? `Where the day stands right now: ${g.cue.text}\n` : ''}${meal ? `He says this is ${meal}.` : 'Guess which meal this is from the food and the time of day.'}${notes ? `\nHis note, which overrides what you can see: "${notes}"` : ''}

Identify the food and estimate the portion and its macros as eaten (read a scale display if one is in the photo).
List the ingredients you can see with grams each, in plain names (white rice, salmon, spinach, soy sauce), and estimate the plate's micronutrients: iron, calcium, magnesium, potassium, sodium, zinc, vitamin D, B12, folate, vitamin C, vitamin A, omega-3 EPA and DHA, fibre.
Then judge the plate against today's guidelines and the meal-plan slot nearest to now: protein_source is true when there is a real protein serving (roughly 30 g or more); carbs is none, some or heavy by the starch and sugar on the plate; vegetables counts fruit; processed means ultra-processed or fried or sweets.
fits is "yes" when the plate does what today's rules ask, "partly" when it does most of it, "no" when it works against them. why is one plain sentence, direct, the way a coach at the trainer would say it. Current time of day where he is: ${tz.parts(new Date()).h}:00.`;
}

async function analyze(images, g, meal, notes) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const content = images.slice(0, 3).map(img => ({ type: 'image',
    source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.image_base64 } }));
  content.push({ type: 'text', text: promptFor(g, meal, notes) });
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
  const actual = { kcal: sum('kcal'), carbs_g: sum('carbs_g'), protein_g: sum('protein_g'), fat_g: sum('fat_g'), meals: entries.length };
  const { scoreDay, suggestSnack } = require('./intake');
  const macro = scoreDay(actual, g.target);
  const rides = g.sessions.filter(s => s.done && s.end_at);
  const guide = F.guidelineScore(g.day, entries.filter(e => !e.supplement), rides);
  const overall = F.overall(macro ? macro.overall : null, guide.score);
  // Micronutrients: today and the two days before, so one short day does not read as a crisis.
  const microDays = [MI.sumDays(entries.map(e => e.micros).filter(Boolean))];
  for (let i = 1; i <= 2; i++) {
    const prev = await getJSON(dayKey(tz.shiftKey(date, -i)), null);
    if (prev && prev.entries && prev.entries.length) microDays.push(MI.sumDays(prev.entries.map(e => e.micros).filter(Boolean)));
  }
  const micro = entries.some(e => e.micros) || microDays.length > 1 ? MI.dayScore(microDays) : null;
  const microSuggest = micro ? MI.suggest(microDays, { day: g.day, post: !!(g.cue && g.cue.key === 'post') }) : null;
  return {
    date, today: date === tz.todayKey(),
    fuel_day: g.fuel_day, day: g.day, target: g.target, guidelines: g.guidelines, ride_notes: g.ride_notes, sessions: g.sessions, cue: g.cue, work: g.work,
    meals: g.meals.map(m => Object.assign({}, m, { logged: entries.filter(e => e.slot === m.slot).map(e => e.id) })),
    actual: Object.assign(actual, { meals: entries.filter(e => !e.supplement).length }), entries,
    compliance: { overall, band: F.band(overall), macros: macro, guidelines: guide },
    micros: micro ? Object.assign(micro, { suggest: microSuggest, supplements_available: MI.TABLE.supplements.map(x => ({ key: x.key, name: x.name, note: x.note })) }) : null,
    suggestion: entries.length && date === tz.todayKey() ? suggestSnack(actual, g.target, { day: g.day, post: !!(g.cue && g.cue.key === 'post') }) : null,
    basis: 'day-to-date photos against the day\'s guidelines and the whole-day target'
  };
}

async function addPhoto(body) {
  const images = Array.isArray(body.images) ? body.images.filter(i => i && i.image_base64) : [];
  if (!images.length) throw new Error('no photo');
  const date = tz.todayKey();
  const g = await guidelinesFor(date);
  const meal = ['breakfast', 'lunch', 'dinner', 'snack', 'on the bike'].includes(body.meal) ? body.meal : null;
  const notes = body.notes ? String(body.notes).slice(0, 300) : '';
  const a = await analyze(images, g, meal, notes);
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
    ingredients: Array.isArray(a.ingredients) ? a.ingredients.slice(0, 20).map(i => ({ name: String(i.name || '').slice(0, 60), grams: Math.max(0, Math.round(i.grams || 0)) })) : [],
    micros: null, micros_matched_pct: null, micros_unknown: []
  };
  const pm = MI.plateMicros(entry.ingredients, a.micronutrients || null);
  entry.micros = pm.micros; entry.micros_matched_pct = pm.matched_pct; entry.micros_unknown = pm.unknown;
  // The full photo in its own key, so the day document stays small enough to read on every page load.
  await setJSON(photoKey(id), { media_type: images[0].media_type || 'image/jpeg', data: images[0].image_base64 }).catch(() => {});
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

  app.post('/food/photo', async (req, res) => { if (!auth(req, res)) return;
    try {
      const entry = await addPhoto(req.body || {});
      res.json({ ok: true, entry, day: await dayReport(entry.date) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

  // A supplement is an entry without a photo: one tap, its nutrients counted.
  app.post('/food/supplement', async (req, res) => { if (!auth(req, res)) return;
    try {
      const sm = MI.supplementMicros(String((req.body || {}).key || ''));
      if (!sm) return res.status(400).json({ error: 'unknown supplement' });
      const date = tz.todayKey();
      const p = tz.parts(new Date());
      const entry = { id: 'f_' + crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), date,
        time: String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'), slot: null, meal: 'supplement', supplement: true, key: sm.key,
        name: sm.name, portion: '', kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, confidence: 'high', notes: sm.note || '',
        assessment: null, thumb: null, ingredients: [], micros: sm.micros, micros_matched_pct: 100, micros_unknown: [] };
      const doc = await dayDoc(date); doc.entries.push(entry); await setJSON(dayKey(date), doc);
      res.json({ ok: true, entry, day: await dayReport(date) });
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
      e.corrected = true;
      await setJSON(dayKey(date), doc);
      // keep the ledger in step
      const led = await getJSON('fuel-log', { meals: [] });
      const m = led.meals.find(x => x.food_id === e.id);
      if (m) { Object.assign(m, { name: e.name, kcal: e.kcal, carbs_g: e.carbs_g, protein_g: e.protein_g, fat_g: e.fat_g }); await setJSON('fuel-log', led); }
      res.json({ ok: true, entry: e, day: await dayReport(date) });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.delete('/food/:id', async (req, res) => { if (!auth(req, res)) return;
    try {
      const date = isDate(req.query.date) ? req.query.date : tz.todayKey();
      const doc = await dayDoc(date);
      const before = doc.entries.length;
      doc.entries = doc.entries.filter(x => x.id !== req.params.id);
      if (doc.entries.length === before) return res.status(404).json({ error: 'no such entry' });
      await setJSON(dayKey(date), doc);
      await removeFromLedger(req.params.id);
      res.json({ ok: true, day: await dayReport(date) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, dayReport, guidelinesFor, sessionsFor };
