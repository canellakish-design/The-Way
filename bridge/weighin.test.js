// ============================================================
// weighin.test.js — the morning weigh-in: trend direction out of noisy daily
// readings, the per-field composition trends, the Withings dedupe, and what
// POST /weigh-in will and will not accept.
// Run: node bridge/weighin.test.js
// ============================================================
process.env.TZ = 'UTC';               // production runs UTC; the app zone is Eastern
process.env.FUEL_TOKEN = 'test-fuel-token';
process.env.START_WEIGHT_LB = '210';  // pinned, so "down 12 lb" means something here

const { stubStorage, serve, checker } = require('./test-helpers');
const ok = checker();

const DAY = 864e5;
const ago = d => Date.now() - d * DAY;
const TOKEN_Q = { headers: { 'x-fuel-token': process.env.FUEL_TOKEN } };
const KG_TO_LB = 2.20462;

// weighin.js reads START_WEIGHT_LB at load and closes over storage, so each
// group gets its own copy of the module on top of its own store.
function fresh(seed) {
  const store = stubStorage(seed);
  for (const p of ['./weighin', './fuel-log', './withings-weight'])
    delete require.cache[require.resolve(p)];
  return { store, weighin: require('./weighin') };
}
const W = fresh({}).weighin;   // for the pure functions, which need no store

async function main() {

// ---- direction out of noise -----------------------------------------
ok.section('direction');
{
  const d = W.direction;
  ok('no week to compare against says so', d(null, 180).word === 'not enough data yet'
    && d(180, null).arrow === '·', JSON.stringify(d(null, 180)));
  ok('inside the flat band it holds rather than inventing a trend',
    d(100, 100.2).word === 'holding' && d(100, 100.2).arrow === '→', JSON.stringify(d(100, 100.2)));
  ok('down is losing, and good', d(100, 100.4).word === 'losing' && d(100, 100.4).tone === 'good',
    JSON.stringify(d(100, 100.4)));
  ok('up is gaining, and bad', d(100.4, 100).word === 'gaining' && d(100.4, 100).tone === 'bad');
  ok('delta carried through', Math.abs(d(179, 182).delta + 3) < 1e-9, String(d(179, 182).delta));
}

// ---- per-field direction --------------------------------------------
ok.section('fieldDirection');
{
  const f = W.fieldDirection;
  ok('a missing side is a dot, not a zero', f(null, 20, 0.2).arrow === '·'
    && f(20, null, 0.2).delta === null);
  ok('inside the band is flat, and the delta is zeroed',
    f(20.1, 20, 0.2).arrow === '→' && f(20.1, 20, 0.2).delta === 0, JSON.stringify(f(20.1, 20, 0.2)));
  ok('below the band falls', f(19.5, 20, 0.2).arrow === '↓' && f(19.5, 20, 0.2).tone === 'good');
  ok('above the band rises', f(20.5, 20, 0.2).arrow === '↑' && f(20.5, 20, 0.2).tone === 'bad');
  // Documented oddity, pinned so a change to it is deliberate: one rule for
  // every row means losing muscle colours green.
  ok('one rule for every row — losing muscle reads green, by design',
    f(80, 82, 0.3).tone === 'good', JSON.stringify(f(80, 82, 0.3)));
}

// ---- the weight trend ------------------------------------------------
ok.section('trend');
{
  // Deliberately out of order: the latest reading is the newest timestamp, not
  // the last thing pushed.
  // Last week averages 179, the week before 182.
  const entries = [
    { ts: ago(8), lb: 181 }, { ts: ago(4), lb: 180 }, { ts: ago(0.1), lb: 178.26 },
    { ts: ago(10), lb: 183 }, { ts: ago(2), lb: 178.74 }
  ];
  const t = W.trend(entries);
  ok('latest is the newest reading, not the last pushed', t.latest.lb === 178.3, String(t.latest.lb));
  ok('rounded to a tenth', t.latest.lb === 178.3);
  ok('logged today', t.latest.logged_today === true);
  ok('source defaults to manual', t.latest.source === 'manual', t.latest.source);
  ok('7-day average over the last week only', t.ma7_lb === 179, String(t.ma7_lb));
  ok('the week change compares against days 7–14', t.week_change_lb === -3, String(t.week_change_lb));
  ok('direction comes from week over week', t.direction.word === 'losing', JSON.stringify(t.direction));
  ok('readings_7d counts only the last week', t.readings_7d === 3, String(t.readings_7d));
  ok('entries counts everything', t.entries === 5, String(t.entries));
}
{
  const t = W.trend([{ ts: ago(0.2), lb: 180 }]);
  ok('one reading gives no week change', t.week_change_lb === null && t.ma7_lb === 180);
  ok('and says there is not enough data', t.direction.word === 'not enough data yet');
  ok('empty history is null, not a crash', W.trend([]).latest === null);
}

// ---- the per-field trends -------------------------------------------
ok.section('fieldTrends');
{
  const entries = [
    { ts: ago(9), lb: 183, fat_pct: 24.5, bone_lb: 8.5 },
    { ts: ago(8), lb: 182, fat_pct: 24.3, bone_lb: 8.5 },
    { ts: ago(2), lb: 180, fat_pct: 23.4, bone_lb: 8.35 },
    { ts: ago(1), lb: 179, fat_pct: 23.2, bone_lb: 8.35 }
  ];
  const rows = W.fieldTrends(entries);
  const by = k => rows.find(r => r.key === k);
  ok('a field present in both weeks compares week over week',
    by('fat_pct').basis === 'week over week', by('fat_pct').basis);
  ok('the value shown is the latest reading, not the average',
    by('fat_pct').value === 23.2, String(by('fat_pct').value));
  ok('falling body fat reads good', by('fat_pct').arrow === '↓' && by('fat_pct').tone === 'good');
  ok('weight row present with its own band', by('lb').arrow === '↓', JSON.stringify(by('lb')));
  // Bone barely moves, so its band is tighter — the same 0.15 lb swing is a
  // real move for bone and noise for weight.
  ok("bone's tighter band registers a 0.15 lb move", by('bone_lb').arrow === '↓',
    JSON.stringify(by('bone_lb')));
  ok('fields the scale never reported are left out entirely',
    !by('muscle_lb') && !by('water_lb'), rows.map(r => r.key).join(','));
  ok('each row carries its label and unit for the page',
    by('fat_pct').label === 'body fat' && by('fat_pct').unit === '%');
  ok('and when the reading landed', !!by('fat_pct').at);
}
{
  // A new scale has no week to compare against — fall back to the last two
  // readings rather than showing a row of dots.
  const rows = W.fieldTrends([
    { ts: ago(2), lb: 180, muscle_lb: 140.0 },
    { ts: ago(1), lb: 179, muscle_lb: 139.2 }
  ]);
  const m = rows.find(r => r.key === 'muscle_lb');
  ok('no prior week falls back to the last two readings',
    m.basis === 'since the last reading', m.basis);
  ok('and still reports a direction', m.arrow === '↓', JSON.stringify(m));
}
{
  const rows = W.fieldTrends([{ ts: ago(1), lb: 180, fat_pct: 23.1 }]);
  const f = rows.find(r => r.key === 'fat_pct');
  ok('a single reading shows the number and admits it has no trend',
    f.value === 23.1 && f.arrow === '·' && f.basis === 'not enough readings', JSON.stringify(f));
}

// ---- composition survives a typed weight ----------------------------
ok.section('composition');
{
  const t = W.trend([
    { ts: ago(1), lb: 180, fat_pct: 23.44, muscle_lb: 139.0, bone_lb: 8.5 },
    { ts: ago(0.1), lb: 179, source: 'manual' }   // typed in, no composition
  ]);
  ok('a hand-typed weight does not blank the last scale reading',
    t.composition && t.composition.fat_pct === 23.4, JSON.stringify(t.composition));
  ok('composition is stamped with when it was measured',
    t.composition.at === new Date(Math.round(ago(1))).toISOString()
      || Math.abs(Date.parse(t.composition.at) - ago(1)) < 1000, t.composition.at);
  ok('the weight shown is still the newest one', t.latest.lb === 179);
  ok('no composition anywhere is null', W.trend([{ ts: ago(1), lb: 180 }]).composition === null);
}

// ---- the Withings merge ---------------------------------------------
ok.section('state — the Withings merge');
{
  const T = ago(0.3);
  const { weighin } = fresh({
    'weigh-in': { entries: [{ ts: T, lb: 81.9 * KG_TO_LB, source: 'withings' }] },
    withings: { weights: [{ ts: T + 30000, kg: 81.9, fat_pct: 22.1 }] }
  });
  const s = await weighin.state();
  ok('the same scale reading on both sides is counted once', s.entries === 1, String(s.entries));
}
{
  const T = ago(0.3);
  const { weighin } = fresh({
    'weigh-in': { entries: [{ ts: T, lb: 180, source: 'withings' }] },
    withings: { weights: [{ ts: T + 10 * 60000, kg: 81.0 }] }
  });
  ok('two readings ten minutes apart are two readings',
    (await weighin.state()).entries === 2);
}
{
  // The mirror writes 'withings'; the demo store labels 'withings (demo)'.
  // Matching the labels exactly let the same reading through twice.
  const T = ago(0.3);
  const { weighin } = fresh({
    'weigh-in': { entries: [{ ts: T, lb: 180, source: 'withings' }] },
    withings: { demo: true, weights: [{ ts: T + 10000, kg: 81.6 }] }
  });
  const s = await weighin.state();
  ok('a demo label does not defeat the dedupe', s.entries === 1, String(s.entries));
}
{
  const { weighin } = fresh({
    'weigh-in': { entries: [] },
    withings: { demo: true, weights: [{ ts: ago(0.3), kg: 81.6, fat_pct: 22.0 }] }
  });
  const s = await weighin.state();
  ok('demo readings are labelled all the way through', s.demo === true
    && s.latest.source === 'withings (demo)', JSON.stringify({ demo: s.demo, src: s.latest.source }));
  ok('kilograms converted to pounds', Math.abs(s.latest.lb - 81.6 * KG_TO_LB) < 0.05, String(s.latest.lb));
  ok('composition rides along on the fallback path', s.composition && s.composition.fat_pct === 22,
    JSON.stringify(s.composition));
}
{
  const { weighin } = fresh({ 'weigh-in': { entries: [{ ts: ago(0.2), lb: 178.3 }] } });
  const s = await weighin.state();
  ok('start weight comes from the env when nothing is stored', s.start_lb === 210, String(s.start_lb));
  ok('change since start is measured against it', s.change_since_start_lb === -31.7,
    String(s.change_since_start_lb));
  ok('Withings reports as not connected without tokens', s.withings_connected === false);
}
{
  const { weighin } = fresh({
    'weigh-in': { start_lb: 205, entries: [{ ts: ago(0.2), lb: 180 }] },
    withings: { tokens: { access_token: 'x' }, weights: [] }
  });
  const s = await weighin.state();
  ok('a stored start weight overrides the env', s.start_lb === 205 && s.change_since_start_lb === -25,
    JSON.stringify({ start: s.start_lb, change: s.change_since_start_lb }));
  ok('Withings reports connected when it holds tokens', s.withings_connected === true);
}

// ---- the routes ------------------------------------------------------
ok.section('routes');
{
  const { store, weighin } = fresh({ 'weigh-in': { entries: [] } });
  const app = await serve(weighin.attach);

  ok('GET /weigh-in needs a credential', (await app.get('/weigh-in')).status === 401);
  ok('POST /weigh-in needs a credential', (await app.post('/weigh-in', { lb: 180 })).status === 401);
  ok("the app's own header is a credential",
    (await app.get('/weigh-in', { headers: { 'x-the-way-app': '1' } })).status === 200);

  const bad = async body => (await app.post('/weigh-in', body, TOKEN_Q));
  ok('no weight is a 400', (await bad({})).status === 400);
  ok('and says what it wanted', (await bad({})).json.error === 'lb required (50–500)',
    (await bad({})).json.error);
  ok('a nonsense weight is a 400', (await bad({ lb: 'heavy' })).status === 400);
  ok('below the floor is a 400', (await bad({ lb: 49 })).status === 400);
  ok('above the ceiling is a 400', (await bad({ lb: 501 })).status === 400);
  ok('the floor itself is allowed', (await bad({ lb: 50 })).status === 200);
  ok('the ceiling itself is allowed', (await bad({ lb: 500 })).status === 200);

  await app.close();
}
{
  const { store, weighin } = fresh({ 'weigh-in': { entries: [] } });
  const app = await serve(weighin.attach);
  const r = await app.post('/weigh-in', { lb: 178.26, source: 'shortcut',
    fat_pct: 22.34, muscle_lb: 139.05, bone_lb: 8.5,
    // Out of range or not a number at all — an Apple Shortcut can send either.
    fat_mass_lb: 400, fat_free_lb: -3, water_lb: 'n/a' }, TOKEN_Q);
  ok('a good weigh-in answers ok with the new state', r.status === 200 && r.json.ok === true
    && r.json.latest.lb === 178.3, r.text.slice(0, 90));
  const e = store['weigh-in'].entries[0];
  ok('source recorded', e.source === 'shortcut', e.source);
  ok('composition rounded to a tenth', e.fat_pct === 22.3 && e.muscle_lb === 139.1,
    JSON.stringify({ fat: e.fat_pct, muscle: e.muscle_lb }));
  ok('an out-of-range field is dropped, not stored', e.fat_mass_lb === null, String(e.fat_mass_lb));
  ok('a negative field is dropped', e.fat_free_lb === null, String(e.fat_free_lb));
  ok('a non-numeric field is dropped', e.water_lb === null, String(e.water_lb));
  ok('the weight itself is stored unrounded', e.lb === 178.26, String(e.lb));
  await app.close();
}
{
  const { store, weighin } = fresh({ 'weigh-in': { entries: [] } });
  const app = await serve(weighin.attach);
  await app.post('/weigh-in', { lb: 180, at: '2026-08-10T11:30:00Z' }, TOKEN_Q);
  ok('an explicit timestamp is honoured',
    store['weigh-in'].entries[0].ts === Date.parse('2026-08-10T11:30:00Z'),
    String(store['weigh-in'].entries[0].ts));
  await app.post('/weigh-in', { lb: 181, at: 'yesterday morning' }, TOKEN_Q);
  ok('an unparseable timestamp falls back to now rather than NaN',
    Math.abs(store['weigh-in'].entries[1].ts - Date.now()) < 5000,
    String(store['weigh-in'].entries[1].ts));
  await app.close();
}
{
  const { store, weighin } = fresh({ 'weigh-in': { entries: [
    { ts: ago(400), lb: 205 }, { ts: ago(100), lb: 190 }] } });
  const app = await serve(weighin.attach);
  await app.post('/weigh-in', { lb: 180 }, TOKEN_Q);
  const kept = store['weigh-in'].entries.map(e => e.lb);
  ok('readings older than a year are pruned on write', !kept.includes(205) && kept.includes(190),
    JSON.stringify(kept));
  await app.close();
}
{
  const { store, weighin } = fresh({ 'weigh-in': { entries: [{ ts: ago(0.2), lb: 180 }] } });
  const app = await serve(weighin.attach);
  const r = await app.post('/weigh-in/start', { lb: 205 }, TOKEN_Q);
  ok('the start weight can be set at runtime', r.status === 200 && r.json.start_lb === 205,
    r.text.slice(0, 60));
  ok('and change since start follows it', r.json.change_since_start_lb === -25,
    String(r.json.change_since_start_lb));
  ok('it is persisted', store['weigh-in'].start_lb === 205);
  ok('the same range check applies', (await app.post('/weigh-in/start', { lb: 10 }, TOKEN_Q)).status === 400);
  ok('and it needs a credential', (await app.post('/weigh-in/start', { lb: 205 })).status === 401);
  await app.close();
}
{
  // The store failing must read as a 500 rather than an empty day.
  const { store, weighin } = fresh({ 'weigh-in': { entries: [] } });
  store.__failWrites = true;
  const app = await serve(weighin.attach);
  const r = await app.post('/weigh-in', { lb: 180 }, TOKEN_Q);
  ok('a storage failure is a 500 with the reason', r.status === 500
    && /blob store unavailable/.test(r.json.error), r.text.slice(0, 80));
  await app.close();
}

ok.done();
}

main().catch(e => { console.error(e); process.exit(1); });
