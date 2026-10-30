// Fuel ledger: the meals the photos and the voice log, and the shared auth() every route uses.
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
// Credentials pasted into a hosting dashboard pick up stray whitespace,
// newlines and sometimes the quotes around them. Providers then reject the
// value with a message about the credential being invalid, which sends you
// looking at the wrong thing.
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const TOKEN = envStr('FUEL_TOKEN');
// In the athlete's zone, not the server's: on a UTC host these all rolled
// over at 8pm Eastern, so the day's meals reset mid-evening.
const isToday = iso => tz.isToday(new Date(iso));
async function db() { return getJSON('fuel-log', { meals: [] }); }
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
    logged_at: new Date().toISOString(),
    ...(body.food_id ? { food_id: String(body.food_id) } : {})
  };
  d.meals.push(m);
  d.meals = d.meals.filter(x => hoursSince(x.logged_at) < 168);
  await setJSON('fuel-log', d);
  return { ok: true, meal: m };
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
    const fallback = parseInt(process.env.FTP || '175', 10);   // the planning FTP
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
    res.json({ ok: true, removed }); });
}
module.exports = { attach, mealsToday, logMeal, auth };
