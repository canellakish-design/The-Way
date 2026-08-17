// ============================================================
// macros.test.js — the Hexis path: the inbox the morning run POSTs into, what
// it will accept, and the compliance scoring that reads the target back out
// against what was actually eaten.
// Run: node bridge/macros.test.js
// ============================================================
process.env.TZ = 'UTC';               // production runs UTC; the app zone is Eastern
process.env.FUEL_TOKEN = 'test-fuel-token';

const { stubStorage, stubModule, serve, checker } = require('./test-helpers');
const tz = require('./tz');
const ok = checker();

const TOKEN_Q = { headers: { 'x-fuel-token': process.env.FUEL_TOKEN } };
const today = tz.todayKey();
const yesterday = tz.shiftKey(today, -1);

// A small, fixed snack list. The real snacks.json is edited freely by hand —
// testing the suggester against it would make every edit a test failure.
const SNACKS = [
  { name: 'Whey shake', kcal: 120, carbs_g: 3, protein_g: 25, fat_g: 1 },
  { name: 'Banana', kcal: 105, carbs_g: 27, protein_g: 1, fat_g: 0.4 },
  { name: 'Olive oil', kcal: 119, carbs_g: 0, protein_g: 0, fat_g: 13.5 }
];

// intake.js loads snacks.json at require time, so the stub goes in first.
function fresh(seed, snacks) {
  const store = stubStorage(seed);
  stubModule('./snacks.json', { snacks: snacks || SNACKS });
  for (const p of ['./macros', './intake', './fuel-log'])
    delete require.cache[require.resolve(p)];
  return { store, macros: require('./macros'), intake: require('./intake') };
}
const I = fresh({}).intake;   // for the pure scoring, which needs no store

async function main() {

// ---- the inbox -------------------------------------------------------
ok.section('POST /macros — the morning run');
{
  const { store, macros } = fresh({});
  const app = await serve(macros.attach);
  const r = await app.post('/macros', { kcal: 2950, carbs_g: 420, protein_g: 185,
    fat_g: 75, fuel_day: 'high carb' }, TOKEN_Q);
  ok('a posted day answers ok with what was saved', r.status === 200 && r.json.ok === true
    && r.json.saved.length === 1, r.text.slice(0, 80));
  const d = store.macros.days[today];
  ok('it lands under today by default', !!d, JSON.stringify(Object.keys(store.macros.days)));
  ok('the numbers are stored', d.kcal === 2950 && d.carbs_g === 420
    && d.protein_g === 185 && d.fat_g === 75, JSON.stringify(d));
  ok('the fuel day label is kept — Hexis periodizes', d.fuel_day === 'high carb');
  ok('source defaults to hexis', d.source === 'hexis');
  ok('and when it was posted is stamped', !!d.posted_at);
  await app.close();
}
{
  // The run scrapes whatever Hexis renders; the doc promises these aliases so
  // it can be passed through with minimal reshaping.
  const { store, macros } = fresh({});
  const app = await serve(macros.attach);
  await app.post('/macros', { kcal: 2400, carbs: 300, protein: 190, fat: 70,
    day_type: 'low carb' }, TOKEN_Q);
  const d = store.macros.days[today];
  ok('carbs/protein/fat are accepted as aliases for the _g fields',
    d.carbs_g === 300 && d.protein_g === 190 && d.fat_g === 70, JSON.stringify(d));
  ok('day_type is accepted as an alias for fuel_day', d.fuel_day === 'low carb');
  await app.close();
}
{
  const { store, macros } = fresh({});
  const app = await serve(macros.attach);
  await app.post('/macros', { kcal: '2950.4', carbs_g: 419.6, protein_g: 'lots',
    fat_g: '', fuel_day: null }, TOKEN_Q);
  const d = store.macros.days[today];
  ok('numbers arrive as strings from a scrape and are coerced', d.kcal === 2950, String(d.kcal));
  ok('and rounded to whole grams', d.carbs_g === 420, String(d.carbs_g));
  ok('a non-numeric field is stored as null, not NaN', d.protein_g === null, String(d.protein_g));
  ok('an empty field is null', d.fat_g === null, String(d.fat_g));
  ok('a missing label is null, not "null"', d.fuel_day === null);
  await app.close();
}
{
  const { store, macros } = fresh({});
  const app = await serve(macros.attach);
  await app.post('/macros', { date: '17/08/2026', kcal: 2000 }, TOKEN_Q);
  ok('a date the wrong way round falls back to today rather than storing junk',
    !!store.macros.days[today] && !store.macros.days['17/08/2026'],
    JSON.stringify(Object.keys(store.macros.days)));
  await app.post('/macros', { date: '2026-08-20', kcal: 2100 }, TOKEN_Q);
  ok('a valid date is honoured', store.macros.days['2026-08-20'].kcal === 2100);
  await app.close();
}
{
  // Hexis periodizes ahead, so the run posts the visible week in one call.
  const { store, macros } = fresh({});
  const app = await serve(macros.attach);
  const r = await app.post('/macros', { days: [
    { date: '2026-08-17', kcal: 2400, carbs_g: 300, protein_g: 190, fat_g: 70, fuel_day: 'low carb' },
    { date: '2026-08-18', kcal: 2950, carbs_g: 420, protein_g: 185, fat_g: 75, fuel_day: 'high carb' },
    { date: '2026-08-19', kcal: 2200, carbs_g: 250, protein_g: 190, fat_g: 70, fuel_day: 'rest' }
  ] }, TOKEN_Q);
  ok('a whole week posts in one call', r.json.saved.length === 3, String(r.json.saved.length));
  ok('each day is stored under its own date',
    Object.keys(store.macros.days).sort().join(',') === '2026-08-17,2026-08-18,2026-08-19',
    Object.keys(store.macros.days).sort().join(','));
  ok('and each keeps its own fuel day',
    store.macros.days['2026-08-19'].fuel_day === 'rest');
  await app.close();
}
{
  const { macros } = fresh({});
  const app = await serve(macros.attach);
  ok('an empty week is a 400, not a silent no-op',
    (await app.post('/macros', { days: [] }, TOKEN_Q)).status === 400);
  ok('and says so', (await app.post('/macros', { days: [] }, TOKEN_Q)).json.error === 'no days posted');
  await app.close();
}
{
  // Running the fetch twice in a morning must correct the day, not double it.
  const { store, macros } = fresh({});
  const app = await serve(macros.attach);
  await app.post('/macros', { kcal: 2400, carbs_g: 300 }, TOKEN_Q);
  await app.post('/macros', { kcal: 2950, carbs_g: 420 }, TOKEN_Q);
  ok('re-posting the same day overwrites rather than duplicating',
    Object.keys(store.macros.days).length === 1 && store.macros.days[today].kcal === 2950,
    JSON.stringify(store.macros.days[today]));
  await app.close();
}
{
  const old = tz.shiftKey(today, -61), recent = tz.shiftKey(today, -59);
  const seed = { macros: { days: {} } };
  seed.macros.days[old] = { date: old, kcal: 2000 };
  seed.macros.days[recent] = { date: recent, kcal: 2100 };
  const { store, macros } = fresh(seed);
  const app = await serve(macros.attach);
  await app.post('/macros', { kcal: 2500 }, TOKEN_Q);
  ok('days past the 60-day window are pruned on write',
    !store.macros.days[old], JSON.stringify(Object.keys(store.macros.days).sort()));
  ok('days inside it are kept', !!store.macros.days[recent]);
  await app.close();
}
{
  const { macros } = fresh({});
  const app = await serve(macros.attach);
  ok('POST /macros needs a credential', (await app.post('/macros', { kcal: 2000 })).status === 401);
  ok('GET /macros/today needs a credential', (await app.get('/macros/today')).status === 401);
  ok('GET /macros needs a credential', (await app.get('/macros')).status === 401);
  await app.close();
}

// ---- reading it back -------------------------------------------------
ok.section('reading the target back');
{
  // The whole point of have:false — yesterday's targets shown as today's would
  // be worse than no targets at all.
  const seed = { macros: { days: {} } };
  seed.macros.days[yesterday] = { date: yesterday, kcal: 2950, carbs_g: 420 };
  const { macros } = fresh(seed);
  const app = await serve(macros.attach);
  const t = (await app.get('/macros/today', TOKEN_Q)).json;
  ok('no run today reads as have:false', t.have === false && t.date === today, JSON.stringify(t));
  ok("and does not fall back to yesterday's numbers", t.kcal === undefined, JSON.stringify(t));
  await app.close();
}
{
  const seed = { macros: { days: {} } };
  seed.macros.days[today] = { date: today, kcal: 2400, carbs_g: 300, protein_g: 190,
    fat_g: 70, fuel_day: 'low carb' };
  const { macros } = fresh(seed);
  const app = await serve(macros.attach);
  const t = (await app.get('/macros/today', TOKEN_Q)).json;
  ok('a landed run reads as have:true with the numbers',
    t.have === true && t.kcal === 2400 && t.fuel_day === 'low carb', JSON.stringify(t));
  const one = (await app.get('/macros?date=' + today, TOKEN_Q)).json;
  ok('a named date returns that day', one.kcal === 2400);
  const missing = (await app.get('/macros?date=2026-01-01', TOKEN_Q)).json;
  ok('a date with nothing stored says have:false rather than 404ing',
    missing.have === false && missing.date === '2026-01-01', JSON.stringify(missing));
  const all = (await app.get('/macros', TOKEN_Q)).json;
  ok('no date returns the whole store', !!all.days[today]);
  await app.close();
}
{
  const seed = { macros: { days: {} } };
  seed.macros.days[today] = { date: today, kcal: 2400 };
  seed.macros.days['2026-08-19'] = { date: '2026-08-19', kcal: 2200 };
  const { macros } = fresh(seed);
  // The front page asks for the days it is drawing and gets back only what exists.
  const m = await macros.forDates([today, '2026-08-18', '2026-08-19']);
  ok('forDates returns only the days that have targets',
    Object.keys(m).sort().join(',') === [today, '2026-08-19'].sort().join(','),
    Object.keys(m).sort().join(','));
  ok('a day with no target is absent, not null-filled', !('2026-08-18' in m));
}

// ---- the scoring -----------------------------------------------------
ok.section('macroScore');
{
  const s = I.macroScore;
  ok('inside the ±5% band is 100', s(410, 420).score === 100 && s(410, 420).direction === 'on target',
    JSON.stringify(s(410, 420)));
  ok('exactly 5% off is still on target', s(441, 420).score === 100, JSON.stringify(s(441, 420)));
  ok('past the band it falls linearly', s(462, 420).score === 90, JSON.stringify(s(462, 420)));
  ok('over is named over', s(462, 420).direction === 'over');
  ok('under is named under', s(378, 420).direction === 'under');
  // 400g on a 236g day is a miss the same way 150g is.
  ok('over and under cost the same', s(150, 100).score === s(50, 100).score,
    s(150, 100).score + ' vs ' + s(50, 100).score);
  ok('the score floors at zero rather than going negative',
    s(200, 100).score === 0, String(s(200, 100).score));
  ok('what is left is reported', s(378, 420).remaining === 42, String(s(378, 420).remaining));
  ok('and the overshoot is reported as a negative remainder',
    s(462, 420).remaining === -42, String(s(462, 420).remaining));
  ok('deviation as a percentage', s(462, 420).deviation_pct === 10, String(s(462, 420).deviation_pct));
  ok('no target is not scored', s(400, null) === null && s(400, 0) === null);
}
ok.section('scoreDay');
{
  const target = { kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const perfect = I.scoreDay({ kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 }, target);
  ok('hitting everything is 100', perfect.overall === 100, String(perfect.overall));
  ok('every macro is scored individually',
    ['carbs_g', 'protein_g', 'fat_g', 'kcal'].every(k => perfect.per_macro[k]),
    Object.keys(perfect.per_macro).join(','));
  // Calories are the sum of the macros; scoring them again would weight the
  // same miss twice.
  const kcalOff = I.scoreDay({ kcal: 500, carbs_g: 200, protein_g: 150, fat_g: 60 }, target);
  ok('the overall is the three macros — calories are shown, not double-counted',
    kcalOff.overall === 100 && kcalOff.per_macro.kcal.score === 0,
    JSON.stringify({ overall: kcalOff.overall, kcal: kcalOff.per_macro.kcal.score }));
  const empty = I.scoreDay(null, target);
  ok('an empty day scores zero, not perfect', empty.overall === 0, String(empty.overall));
  ok('no target means nothing to score against', I.scoreDay({ kcal: 2000 }, null) === null);
}

// ---- the snack -------------------------------------------------------
ok.section('suggestSnack');
{
  const target = { kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const s = I.suggestSnack({ kcal: 1850, carbs_g: 200, protein_g: 120, fat_g: 60 }, target);
  ok('it picks the snack that closes the gap', s.name === 'Whey shake', JSON.stringify(s));
  ok('and reports the improvement', s.score_before === 90 && s.score_after === 100 && s.gain === 10,
    JSON.stringify({ before: s.score_before, after: s.score_after, gain: s.gain }));
  ok('it names which gap it closes', s.why === 'closes the protein gap', s.why);
  ok('and what eating it costs', s.kcal === 120 && s.protein_g === 25, JSON.stringify(s));
}
{
  // Two servings can beat one, so the search has to consider them.
  const target = { kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const s = I.suggestSnack({ kcal: 1700, carbs_g: 200, protein_g: 100, fat_g: 60 }, target);
  ok('more than one serving is considered', s.servings === 2, JSON.stringify(s));
  ok('and the totals scale with the servings', s.kcal === 240 && s.protein_g === 50,
    JSON.stringify({ kcal: s.kcal, protein: s.protein_g }));
}
{
  // Closing a protein gap by blowing the energy budget is a different miss.
  const target = { kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const s = I.suggestSnack({ kcal: 2050, carbs_g: 200, protein_g: 100, fat_g: 60 }, target);
  ok('nothing may close a gap by pushing calories more than 5% past target',
    s.none === true && /overshooting calories/.test(s.reason), JSON.stringify(s));
}
{
  const target = { kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const s = I.suggestSnack({ kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 }, target);
  ok('a day already on target gets no suggestion', s.none === true, JSON.stringify(s));
  ok('no target means no suggestion at all', I.suggestSnack({ kcal: 1000 }, null) === null);
}
{
  const target = { kcal: 2000, carbs_g: 300, protein_g: 150, fat_g: 60 };
  const s = I.suggestSnack({ kcal: 1500, carbs_g: 200, protein_g: 110, fat_g: 60 }, target);
  ok('two gaps are both named', /carbs/.test(s.why) && /protein/.test(s.why), s.why);
}

// ---- /compliance -----------------------------------------------------
ok.section('/compliance');
{
  // Today's live state: the morning run has not happened.
  const { intake } = fresh({});
  const app = await serve(intake.attach);
  const c = (await app.get('/compliance', TOKEN_Q)).json;
  ok('no Hexis target means nothing to score against',
    c.target === null && c.compliance === null && c.suggestion === null, JSON.stringify(c));
  ok('the date is still reported', c.date === today);
  ok('and the basis is always stated', /day-to-date/.test(c.basis), c.basis);
  ok('/compliance needs a credential', (await app.get('/compliance')).status === 401);
  await app.close();
}
{
  const seed = { macros: { days: {} }, intake: { days: {} } };
  seed.macros.days[today] = { date: today, kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  seed.intake.days[today] = { date: today, kcal: 1850, carbs_g: 200, protein_g: 120,
    fat_g: 60, meals: 3, source: 'alma' };
  const { intake } = fresh(seed);
  const app = await serve(intake.attach);
  const c = (await app.get('/compliance', TOKEN_Q)).json;
  ok('Alma is the tracker of record', c.source === 'alma', c.source);
  ok('the target and the actual sit side by side',
    c.target.kcal === 2000 && c.actual.kcal === 1850);
  ok('scored per macro', c.compliance.per_macro.protein_g.score === 70,
    String(c.compliance.per_macro.protein_g.score));
  ok('with an overall', c.compliance.overall === 90, String(c.compliance.overall));
  ok('and the snack that closes the gap', c.suggestion.name === 'Whey shake', JSON.stringify(c.suggestion));
  await app.close();
}
{
  // Alma hasn't posted; The Way's own food log stands in and says so.
  const seed = { macros: { days: {} }, 'fuel-log': { meals: [
    { logged_at: new Date().toISOString(), kcal: 600, carbs_g: 80, protein_g: 40, fat_g: 15 },
    { logged_at: new Date().toISOString(), kcal: 700, carbs_g: 90, protein_g: 45, fat_g: 20 }
  ] } };
  seed.macros.days[today] = { date: today, kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const { intake } = fresh(seed);
  const app = await serve(intake.attach);
  const c = (await app.get('/compliance', TOKEN_Q)).json;
  ok("without Alma it falls back to The Way's food log", c.source === 'the way food log', c.source);
  ok('and totals what was logged there', c.actual.kcal === 1300 && c.actual.protein_g === 85,
    JSON.stringify(c.actual));
  ok('the meal count comes with it', c.actual.meals === 2);
  await app.close();
}
{
  // An empty day must not read as perfect compliance.
  const seed = { macros: { days: {} }, 'fuel-log': { meals: [] } };
  seed.macros.days[today] = { date: today, kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const { intake } = fresh(seed);
  const app = await serve(intake.attach);
  const c = (await app.get('/compliance', TOKEN_Q)).json;
  ok('nothing logged yet says exactly that', c.source === 'the way (nothing logged yet)', c.source);
  ok('and scores zero rather than 100', c.compliance.overall === 0, String(c.compliance.overall));
  await app.close();
}
{
  const seed = { macros: { days: {} }, intake: { days: {} } };
  seed.macros.days[yesterday] = { date: yesterday, kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const { intake } = fresh(seed);
  const app = await serve(intake.attach);
  const c = (await app.get('/compliance?date=' + yesterday, TOKEN_Q)).json;
  ok('a past day with no intake has no actual to score',
    c.actual === null && c.source === null && c.suggestion === null, JSON.stringify(c));
  ok('but the target is still shown', c.target.kcal === 2000);
  await app.close();
}
{
  const seed = { macros: { days: {} }, intake: { days: {} } };
  seed.macros.days[today] = { date: today, kcal: 2000, carbs_g: 200, protein_g: 150, fat_g: 60 };
  const { store, intake } = fresh(seed);
  const app = await serve(intake.attach);
  const r = await app.post('/intake', { kcal: 1850, carbs: 200, protein: 120, fat: 60,
    meals: 3, source: 'alma' }, TOKEN_Q);
  ok('posting intake answers with the compliance in the same response',
    r.status === 200 && r.json.ok === true && r.json.compliance.overall === 90,
    r.text.slice(0, 90));
  ok('the aliases work here too',
    store.intake.days[today].carbs_g === 200 && store.intake.days[today].protein_g === 120,
    JSON.stringify(store.intake.days[today]));
  ok('POST /intake needs a credential', (await app.post('/intake', { kcal: 100 })).status === 401);
  await app.close();
}

ok.done();
}

main().catch(e => { console.error(e); process.exit(1); });
