// ============================================================
// withings-weight.js — add-on for strava-bridge.js
// Wire in with:  require('./withings-weight')(app);
//
// Flow: step on scale -> Withings cloud (WiFi) -> webhook POST here
//       -> fetch new measurement -> store -> tablet polls /weight/latest
//
// Env: WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET,
//      BASE_URL (public https URL of this server), FUEL_TOKEN
//
// One-time setup:
//   1. Create an app at developer.withings.com (callback = BASE_URL/withings/callback)
//   2. Visit BASE_URL/withings/auth once, approve on Withings
//   3. Server auto-subscribes the webhook. Done — weigh-ins push forever.
//
// NOTE: Endpoint/param names follow Withings' v2 API conventions —
// verify against current docs at developer.withings.com when building.
// ============================================================
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, 'withings.json');
const API = 'https://wbsapi.withings.net';
const CLIENT_ID = process.env.WITHINGS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || '';
const TOKEN = process.env.FUEL_TOKEN || '';

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { return { tokens: null, weights: [] }; } // weights: [{kg, fat_pct, ts}]
}
function save(db) { fs.writeFileSync(STORE, JSON.stringify(db, null, 2)); }

async function withingsPost(pathname, params) {
  const body = new URLSearchParams(params);
  const r = await fetch(API + pathname, { method: 'POST', body });
  const data = await r.json();
  if (data.status !== 0) throw new Error('Withings error ' + data.status);
  return data.body;
}

async function ensureToken(db) {
  if (!db.tokens) throw new Error('Not authorized — visit /withings/auth');
  if (Date.now() < db.tokens.expires_at - 60000) return db.tokens.access_token;
  const body = await withingsPost('/v2/oauth2', {
    action: 'requesttoken', grant_type: 'refresh_token',
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: db.tokens.refresh_token,
  });
  db.tokens = {
    access_token: body.access_token, refresh_token: body.refresh_token,
    expires_at: Date.now() + body.expires_in * 1000,
  };
  save(db);
  return db.tokens.access_token;
}

// Pull measurements since a timestamp; store weight (type 1) + fat % (type 6)
async function syncMeasures(db, sinceEpoch) {
  const access = await ensureToken(db);
  const body = await withingsPost('/measure', {
    action: 'getmeas', access_token: access,
    meastypes: '1,6', category: 1, lastupdate: sinceEpoch || 0,
  });
  for (const grp of body.measuregrps || []) {
    const entry = { ts: grp.date * 1000, kg: null, fat_pct: null };
    for (const m of grp.measures) {
      const v = m.value * Math.pow(10, m.unit);
      if (m.type === 1) entry.kg = v;
      if (m.type === 6) entry.fat_pct = v;
    }
    if (entry.kg && !db.weights.some(w => w.ts === entry.ts)) {
      db.weights.push(entry);
      console.log('[withings] weigh-in:', (entry.kg * 2.20462).toFixed(1), 'lb');
    }
  }
  db.weights.sort((a, b) => a.ts - b.ts);
  db.weights = db.weights.slice(-400); // ~1 year daily
  save(db);
}

function trend(db) {
  const lbs = db.weights.map(w => ({ ts: w.ts, lb: w.kg * 2.20462, fat_pct: w.fat_pct }));
  const latest = lbs[lbs.length - 1] || null;
  const now = Date.now(), day = 86400000;
  const avg = (from, to) => {
    const xs = lbs.filter(w => w.ts >= from && w.ts < to).map(w => w.lb);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const ma7 = avg(now - 7 * day, now + day);
  const prev7 = avg(now - 14 * day, now - 7 * day);
  return {
    latest: latest ? {
      lb: Math.round(latest.lb * 10) / 10,
      fat_pct: latest.fat_pct ? Math.round(latest.fat_pct * 10) / 10 : null,
      ts: latest.ts,
      logged_today: new Date(latest.ts).toDateString() === new Date().toDateString(),
    } : null,
    ma7_lb: ma7 ? Math.round(ma7 * 10) / 10 : null,
    week_change_lb: (ma7 && prev7) ? Math.round((ma7 - prev7) * 10) / 10 : null,
  };
}

function requireToken(req, res, next) {
  const supplied = req.query.token || req.get('x-fuel-token') || '';
  if (!TOKEN || supplied !== TOKEN) {
    return res.status(401).json({ ok: false, error: 'bad token' });
  }
  next();
}

module.exports = function attach(app) {
  // --- one-time OAuth ---
  app.get('/withings/auth', (req, res) => {
    const u = new URL('https://account.withings.com/oauth2_user/authorize2');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', CLIENT_ID);
    u.searchParams.set('scope', 'user.metrics');
    u.searchParams.set('redirect_uri', BASE_URL + '/withings/callback');
    u.searchParams.set('state', 'coach-tadej');
    res.redirect(u.toString());
  });

  app.get('/withings/callback', async (req, res) => {
    try {
      const db = load();
      const body = await withingsPost('/v2/oauth2', {
        action: 'requesttoken', grant_type: 'authorization_code',
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        code: req.query.code, redirect_uri: BASE_URL + '/withings/callback',
      });
      db.tokens = {
        access_token: body.access_token, refresh_token: body.refresh_token,
        expires_at: Date.now() + body.expires_in * 1000,
      };
      save(db);
      // subscribe the webhook: appli=1 covers weight-related measures
      await withingsPost('/notify', {
        action: 'subscribe', access_token: db.tokens.access_token,
        callbackurl: BASE_URL + '/withings/webhook', appli: 1,
      });
      await syncMeasures(db, 0); // backfill history
      res.send('Withings connected. Webhook subscribed. You can close this.');
    } catch (e) {
      console.error('[withings] auth failed:', e.message);
      res.status(500).send('Withings auth failed: ' + e.message);
    }
  });

  // --- webhook: Withings pings this the moment a weigh-in syncs ---
  // Must answer 200 fast; also answers HEAD for subscription verification.
  app.head('/withings/webhook', (req, res) => res.sendStatus(200));
  app.post('/withings/webhook', (req, res) => {
    res.sendStatus(200); // ack immediately, process async
    const db = load();
    const since = req.body && req.body.startdate
      ? Number(req.body.startdate) - 60 : Math.floor(Date.now() / 1000) - 3600;
    syncMeasures(db, since).catch(e =>
      console.error('[withings] sync failed:', e.message));
  });

  // --- tablet endpoints ---
  // Morning Mode polls this every ~10 s while on screen.
  app.get('/weight/latest', requireToken, (req, res) => {
    res.json(trend(load()));
  });

  // Manual fallback so a dead scale battery never blocks the morning flow.
  app.post('/weight/manual', requireToken, (req, res) => {
    const db = load();
    const lb = Number(req.body.lb);
    if (!lb) return res.status(400).json({ ok: false, error: 'lb required' });
    db.weights.push({ ts: Date.now(), kg: lb / 2.20462, fat_pct: null });
    save(db);
    res.json({ ok: true, ...trend(db) });
  });
};

/* ------------------------------------------------------------
Morning Mode polling snippet (Coach Tadej Fuel):

let weighPoll = setInterval(async () => {
  const r = await fetch(BRIDGE_URL + '/weight/latest?token=' + FUEL_TOKEN);
  const t = await r.json();
  if (t.latest && t.latest.logged_today) {
    clearInterval(weighPoll);
    renderWeighedIn(t);        // "177.0 · trend 177.2 ↓0.4/wk"
    unlockBreakfastLogging();  // hand off to the fueling flow
  }
}, 10000);
------------------------------------------------------------ */
