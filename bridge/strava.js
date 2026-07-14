// Strava: OAuth + webhook + pull-reconciliation. Tokens in storage.
// Env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN, BASE_URL
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const API = 'https://www.strava.com/api/v3';
const OAUTH = 'https://www.strava.com/oauth';
const CID = process.env.STRAVA_CLIENT_ID || '';
const SEC = process.env.STRAVA_CLIENT_SECRET || '';
const VERIFY = process.env.STRAVA_VERIFY_TOKEN || 'the-way-2026';
const BASE = process.env.BASE_URL || '';

async function db() { return getJSON('strava', { tokens: null, athlete_id: null, latest: null, subscription_id: null,
  rides: [], eftp: null, lthr: null, ef_trend: 'flat' }); }

async function tok(d) {
  if (!d.tokens) throw new Error('not authorized — visit /strava/auth');
  if (Date.now() < d.tokens.expires_at - 60000) return d.tokens.access_token;
  const r = await fetch(OAUTH + '/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.tokens.refresh_token,
      client_id: CID, client_secret: SEC }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('token refresh failed');
  d.tokens = { access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000 };
  await setJSON('strava', d);
  return d.tokens.access_token;
}

function shapeActivity(a) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    start_date: a.start_date,
    distance_mi: a.distance ? Math.round(a.distance / 1609.34 * 10) / 10 : null,
    moving_time_min: a.moving_time ? Math.round(a.moving_time / 60) : null,
    elevation_ft: a.total_elevation_gain ? Math.round(a.total_elevation_gain * 3.281) : null,
    avg_watts: a.average_watts ? Math.round(a.average_watts) : null,
    weighted_avg_watts: a.weighted_average_watts ? Math.round(a.weighted_average_watts) : null,
    max_watts: a.max_watts || null,
    kilojoules: a.kilojoules ? Math.round(a.kilojoules) : null,
    calories: a.calories ? Math.round(a.calories) : null,
    avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
    max_hr: a.max_heartrate || null,
    type: a.type || a.sport_type || null
  };
}

async function fetchActivity(id) {
  const d = await db();
  const t = await tok(d);
  const r = await fetch(`${API}/activities/${id}`, { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('activity fetch failed: ' + r.status);
  return r.json();
}

async function syncLatest() {
  const d = await db();
  const t = await tok(d);
  const r = await fetch(`${API}/athlete/activities?per_page=1`, { headers: { Authorization: 'Bearer ' + t } });
  const list = await r.json();
  if (Array.isArray(list) && list[0]) {
    const full = await fetchActivity(list[0].id).catch(() => list[0]);
    const shaped = shapeActivity(full);
    d.latest = shaped;
    if (!d.rides.some(r => r.id === shaped.id)) {
      d.rides.push({ ...shaped, aspect: 'create', at: shaped.start_date || new Date().toISOString() });
      if (d.rides.length > 200) d.rides = d.rides.slice(-200);
    }
    await setJSON('strava', d);
  }
  return d;
}

async function latestActivity() {
  let d;
  try { d = await syncLatest(); } catch { d = await db(); }
  return { connected: !!d.tokens, activity: d.latest || null };
}

const isToday = iso => new Date(iso).toDateString() === new Date().toDateString();

// Sum of kilojoules across today's rides — the standard cycling rule of thumb
// is kJ of mechanical work ≈ kcal burned (human muscular efficiency ~23-25%
// happens to land within a few percent of the kJ->kcal conversion factor).
// This is an estimate, not a lab measurement — good enough to net against
// the day's balance, not precise to the calorie.
// Prefer Strava's own `calories` field (matches what's shown in the Strava
// app exactly) — fall back to the kJ≈kcal rule of thumb only if Strava
// didn't return calories for that activity.
async function workoutDebt() {
  const d = await db();
  const todays = d.rides.filter(r => r.at && isToday(r.at) && r.aspect !== 'delete' && (r.calories || r.kilojoules));
  const kcal = Math.round(todays.reduce((a, r) => a + (r.calories || r.kilojoules), 0));
  return { kcal, count: todays.length, rides: todays.map(r => ({ name: r.name, kcal: r.calories || r.kilojoules, source: r.calories ? 'strava' : 'kJ estimate', at: r.at })) };
}

async function ensureSubscription() {
  const check = await fetch(`${API}/push_subscriptions?client_id=${CID}&client_secret=${SEC}`);
  const existing = await check.json().catch(() => []);
  if (Array.isArray(existing) && existing[0]) return { ok: true, existing: true, id: existing[0].id };
  const r = await fetch(`${API}/push_subscriptions`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CID, client_secret: SEC,
      callback_url: BASE + '/strava/webhook', verify_token: VERIFY }) });
  const j = await r.json();
  if (!j.id) throw new Error('subscription create failed: ' + JSON.stringify(j));
  const d = await db();
  d.subscription_id = j.id;
  await setJSON('strava', d);
  return { ok: true, existing: false, id: j.id };
}

function attach(app) {
  app.get('/strava/auth', (req, res) => {
    const u = new URL(OAUTH + '/authorize');
    u.searchParams.set('client_id', CID);
    u.searchParams.set('redirect_uri', BASE + '/strava/callback');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('approval_prompt', 'auto');
    u.searchParams.set('scope', 'activity:read_all');
    u.searchParams.set('state', 'the-way-2026');
    res.redirect(u.toString());
  });

  app.get('/strava/callback', async (req, res) => {
    try {
      const r = await fetch(OAUTH + '/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code,
          client_id: CID, client_secret: SEC }) });
      const j = await r.json();
      if (!j.access_token) throw new Error(JSON.stringify(j));
      const d = await db();
      d.tokens = { access_token: j.access_token, refresh_token: j.refresh_token,
        expires_at: Date.now() + j.expires_in * 1000 };
      d.athlete_id = j.athlete ? j.athlete.id : d.athlete_id;
      try {
        await setJSON('strava', d);
      } catch (se) {
        return res.status(500).send('Strava auth failed — storage error: ' + se.message);
      }
      await syncLatest().catch(() => {});
      res.send('Strava connected. You can close this tab.');
    } catch (e) { res.status(500).send('Strava auth failed: ' + e.message); }
  });

  // Strava validates the callback URL with a GET + hub.challenge handshake
  app.get('/strava/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY) {
      res.json({ 'hub.challenge': challenge });
    } else {
      res.sendStatus(403);
    }
  });

  app.post('/strava/webhook', (req, res) => {
    res.sendStatus(200);
    const body = req.body || {};
    if (body.aspect_type === 'delete') return;
    if (body.object_type === 'activity' && body.object_id) {
      fetchActivity(body.object_id)
        .then(async (full) => {
          const d = await db();
          const shaped = shapeActivity(full);
          d.latest = shaped;
          d.rides.push({ ...shaped, aspect: body.aspect_type, at: shaped.start_date || new Date().toISOString() });
          if (d.rides.length > 200) d.rides = d.rides.slice(-200);
          // TODO(Signature): pull /activities/{id}/streams (watts, heartrate) with this
          // athlete's token and update rolling eFTP / LTHR / EF trend from stream data.
          // Summary-level fields (avg/weighted watts, avg HR) are already in d.latest;
          // real power-curve analysis needs the stream endpoint, not yet built.
          await setJSON('strava', d);
        })
        .catch(e => console.error('[strava]', e.message));
    }
  });

  app.get('/strava/status', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({ connected: !!d.tokens, athlete_id: d.athlete_id, subscription_id: d.subscription_id, has_activity: !!d.latest }); });

  app.get('/strava/sync', async (req, res) => { if (!auth(req, res)) return;
    try { await syncLatest(); res.json({ ok: true, ...(await latestActivity()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

  app.get('/strava/subscribe', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await ensureSubscription()); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });

  app.get('/activity/latest', async (req, res) => { if (!auth(req, res)) return;
    res.json(await latestActivity()); });

  app.get('/workout-debt', async (req, res) => { if (!auth(req, res)) return;
    res.json(await workoutDebt()); });

  app.get('/signature', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({ eftp: d.eftp, lthr: d.lthr, ef_trend: d.ef_trend, ride_count: d.rides.length,
      confidence: d.eftp ? 'ok' : 'low — no analyzed efforts yet' }); });
}

module.exports = { attach, latestActivity, workoutDebt };
