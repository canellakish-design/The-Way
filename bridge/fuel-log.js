// Fuel ledger: meals in, fuel-state out. Exports functions for the agent.
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
// Credentials pasted into a hosting dashboard pick up stray whitespace,
// newlines and sometimes the quotes around them. Providers then reject the
// value with a message about the credential being invalid, which sends you
// looking at the wrong thing.
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const TOKEN = envStr('FUEL_TOKEN');
const BASE_BURN = 2050;
const DECAY_HOURS = 4, FASTED_HOURS = 10;
const hoursSince = iso => (Date.now() - new Date(iso).getTime()) / 3.6e6;
// In the athlete's zone, not the server's: on a UTC host these all rolled
// over at 8pm Eastern, so the day's meals reset mid-evening.
const isToday = iso => tz.isToday(new Date(iso));
async function db() { return getJSON('fuel-log', { meals: [] }); }
async function ballCarbs() {
  const seeds = await getJSON('seed-recipes', null);
  if (seeds) {
    const r = (seeds.recipes || []).find(x => x.role === 'ride_fuel_unit');
    if (r) return r.perUnit.carbs_g;
  }
  return 19.4; // Spicy Anchovy Rice Balls v1
}
// Reads the 'strava' storage key directly (rather than requiring strava.js)
// to avoid a circular require — strava.js already requires fuel-log.js for
// auth(). Sums today's ride kilojoules as an estimated kcal burn (cycling's
// standard rule of thumb: kJ of mechanical work ≈ kcal burned).
async function todaysWorkoutKcal() {
  try {
    const s = await getJSON('strava', null);
    if (!s || !Array.isArray(s.rides)) return 0;
    return Math.round(s.rides
      .filter(r => r.at && isToday(r.at) && r.aspect !== 'delete' && r.kilojoules)
      .reduce((a, r) => a + r.kilojoules, 0));
  } catch { return 0; }
}
async function fuelState() {
  const d = await db();
  const recent = d.meals.filter(m => hoursSince(m.logged_at) < DECAY_HOURS);
  let carbs = 0;
  for (const m of recent) carbs += (m.carbs_g || 0) * Math.max(0, 1 - hoursSince(m.logged_at) / DECAY_HOURS);
  const todays = d.meals.filter(m => isToday(m.logged_at));
  const last = d.meals.length ? d.meals[d.meals.length - 1].logged_at : null;
  const hSince = last ? hoursSince(last) : 999;
  const workoutKcal = await todaysWorkoutKcal();
  // fraction of the day elapsed, measured from local midnight in the zone
  const baseBurn = BASE_BURN * (tz.minutesOf(new Date()) / 1440);
  return {
    carbs_g: Math.round(carbs),
    hours_since_meal: Math.round(hSince * 10) / 10,
    fasted: hSince >= FASTED_HOURS,
    meals_today: todays.length,
    workout_kcal: workoutKcal,
    balance_kcal: Math.round(todays.reduce((a, m) => a + (m.kcal || 0), 0) - baseBurn - workoutKcal),
    ball_carbs_g: await ballCarbs(),
    fresh: true
  };
}
async function mealsToday() {
  const d = await db();
  return d.meals.filter(m => isToday(m.logged_at));
}
async function logMeal(body) {
  const d = await db();
  const m = {
    name: String(body.name || 'meal'), meal: String(body.meal || 'snack'),
    carbs_g: Number(body.carbs_g) || 0, protein_g: Number(body.protein_g) || 0,
    fat_g: Number(body.fat_g) || 0, kcal: Number(body.kcal) || 0,
    logged_at: new Date().toISOString()
  };
  d.meals.push(m);
  d.meals = d.meals.filter(x => hoursSince(x.logged_at) < 168);
  await setJSON('fuel-log', d);
  return { ok: true, meal: m, state: await fuelState() };
}
// The app itself no longer carries a token. It used to be typed in per device
// and kept in that browser's localStorage, which meant a phone with a stale or
// empty value failed while the desktop worked.
//
// Two ways in now:
//   - FUEL_TOKEN, for callers that aren't the page: the Hexis and Alma sync
//     runs, the Garmin field, curl.
//   - the page itself, identified by a custom header it always sends. Another
//     site's JavaScript cannot set a custom header on a cross-origin request
//     without a CORS preflight this function never approves, so this keeps
//     other websites out of the data.
//
// What it is NOT: secret. Anyone who knows the URL can call these endpoints
// with a one-line script. Put Netlify's password protection in front of the
// site if the data should be private — that needs no per-device setup either.
function sameOrigin(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const src = req.get('origin') || req.get('referer') || '';
  if (!host || !src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}
function auth(req, res) {
  const supplied = req.query.token || req.get('x-fuel-token') || '';
  if (TOKEN && supplied === TOKEN) return true;
  if (req.get('x-the-way-app') === '1' || sameOrigin(req)) return true;
  res.status(401).json({ ok: false, error: 'bad token' }); return false;
}
function attach(app) {
  // Athlete profile — single source of truth for FTP and other constants.
  // Set FTP env var in Netlify when it changes; everything reads from here.
  app.get('/profile', async (req, res) => {
    if (!auth(req, res)) return;
    const fallback = parseInt(process.env.FTP || '265', 10);
    // The Signature owns FTP once it has a signal; the env var is the floor
    // for a fresh install with no rides analysed yet.
    let ftp = fallback, source = 'FTP env var';
    try {
      const s = await require('./fitness').compute('profile read');
      if (s.ftp) { ftp = s.ftp; source = s.source; }
    } catch (e) { /* fall back to the env value */ }
    res.json({ ftp, ftp_source: source, athlete: 'Harry', units: 'imperial' });
  });
  app.post('/meals', async (req, res) => { if (!auth(req, res)) return;
    res.json(await logMeal(req.body || {})); });
  app.get('/meals/today', async (req, res) => { if (!auth(req, res)) return;
    res.json({ meals: await mealsToday() }); });
  app.delete('/meals/last', async (req, res) => { if (!auth(req, res)) return;
    const d = await db(); const removed = d.meals.pop();
    await setJSON('fuel-log', d);
    res.json({ ok: true, removed, state: await fuelState() }); });
  app.get('/fuel-state', async (req, res) => { if (!auth(req, res)) return;
    res.json(await fuelState()); });
}
module.exports = { attach, fuelState, mealsToday, logMeal, auth, todaysWorkoutKcal, BASE_BURN };
