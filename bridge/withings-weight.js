// ============================================================
// withings-weight.js — the scale.
// Flow: step on scale -> Withings cloud (WiFi) -> webhook POST here
//       -> fetch new measurements -> store -> the day shows it.
//
// Storage-backed (Netlify Blobs in production, local JSON on the PC), so this
// works hosted. It used to write to a real disk and was mounted only locally,
// which meant /withings/auth returned 404 on the deployed site.
//
// Every weigh-in is also written into the shared 'weigh-in' store that
// /weigh-in serves, so the scale and a typed-in number are the same data to
// everything downstream — the front page never has to know which arrived.
//
// Env: WITHINGS_CLIENT_ID, WITHINGS_CLIENT_SECRET, BASE_URL, FUEL_TOKEN
// One-time setup:
//   1. Create an app at developer.withings.com (callback = BASE_URL/withings/callback)
//   2. Visit BASE_URL/withings/auth once, approve on Withings
//   3. The server subscribes the webhook itself. Weigh-ins then push forever.
//
// NOTE: Endpoint/param names follow Withings' v2 API conventions —
// verify against current docs at developer.withings.com on the first run.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');

const API = 'https://wbsapi.withings.net';
const CLIENT_ID = process.env.WITHINGS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || '';

async function db() { return getJSON('withings', { tokens: null, weights: [] }); }
async function save(d) { return setJSON('withings', d); }

async function withingsPost(pathname, params) {
  const r = await fetch(API + pathname, { method: 'POST', body: new URLSearchParams(params) });
  const data = await r.json();
  if (data.status !== 0) throw new Error('Withings error ' + data.status + (data.error ? ' — ' + data.error : ''));
  return data.body;
}

// Same rotation hazard WHOOP has: one refresh at a time, and never overwrite a
// newer token pair with an older one.
let inflight = null;

async function ensureToken(d) {
  if (!d.tokens) throw new Error('Not authorized — visit /withings/auth');
  if (Date.now() < d.tokens.expires_at - 60000) return d.tokens.access_token;
  if (inflight) return inflight;
  inflight = (async () => {
    const body = await withingsPost('/v2/oauth2', {
      action: 'requesttoken', grant_type: 'refresh_token',
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: d.tokens.refresh_token
    });
    const tokens = { access_token: body.access_token,
      refresh_token: body.refresh_token || d.tokens.refresh_token,
      expires_at: Date.now() + body.expires_in * 1000 };
    const fresh = await db();
    if (!fresh.tokens || fresh.tokens.expires_at < tokens.expires_at) {
      fresh.tokens = tokens;
      await save(fresh);
    }
    d.tokens = tokens;
    return tokens.access_token;
  })();
  try { return await inflight; } finally { inflight = null; }
}

// Mirror scale readings into the shared weigh-in store, deduped by timestamp,
// so /weigh-in and the front page see them without knowing about Withings.
async function mirrorToWeighIn(entries) {
  if (!entries.length) return;
  const w = await getJSON('weigh-in', { entries: [] });
  let added = 0;
  for (const e of entries) {
    if (w.entries.some(x => Math.abs(x.ts - e.ts) < 60000 && x.source === 'withings')) continue;
    w.entries.push({ ts: e.ts, lb: e.kg * 2.20462, fat_pct: e.fat_pct ?? null, source: 'withings' });
    added++;
  }
  if (added) {
    w.entries.sort((a, b) => a.ts - b.ts);
    await setJSON('weigh-in', w);
  }
  return added;
}

// Pull measurements since a timestamp; store weight (type 1) + fat % (type 6)
async function syncMeasures(sinceEpoch) {
  const d = await db();
  const access = await ensureToken(d);
  const body = await withingsPost('/measure', {
    action: 'getmeas', access_token: access,
    meastypes: '1,6', category: 1, lastupdate: sinceEpoch || 0
  });
  const fresh = [];
  for (const grp of body.measuregrps || []) {
    const entry = { ts: grp.date * 1000, kg: null, fat_pct: null };
    for (const m of grp.measures) {
      const v = m.value * Math.pow(10, m.unit);
      if (m.type === 1) entry.kg = v;
      if (m.type === 6) entry.fat_pct = v;
    }
    if (entry.kg && !d.weights.some(w => w.ts === entry.ts)) {
      d.weights.push(entry);
      fresh.push(entry);
      console.log('[withings] weigh-in:', (entry.kg * 2.20462).toFixed(1), 'lb');
    }
  }
  d.weights.sort((a, b) => a.ts - b.ts);
  d.weights = d.weights.slice(-400); // ~1 year daily
  d.synced_at = new Date().toISOString();
  await save(d);
  await mirrorToWeighIn(fresh).catch(e => console.error('[withings] mirror failed:', e.message));
  return { found: fresh.length, total: d.weights.length };
}

function attach(app) {
  app.get('/withings/auth', (req, res) => {
    const u = new URL('https://account.withings.com/oauth2_user/authorize2');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', CLIENT_ID);
    u.searchParams.set('scope', 'user.metrics');
    u.searchParams.set('redirect_uri', BASE_URL + '/withings/callback');
    u.searchParams.set('state', 'the-way');
    res.redirect(u.toString());
  });

  app.get('/withings/callback', async (req, res) => {
    try {
      const d = await db();
      const body = await withingsPost('/v2/oauth2', {
        action: 'requesttoken', grant_type: 'authorization_code',
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        code: req.query.code, redirect_uri: BASE_URL + '/withings/callback'
      });
      d.tokens = { access_token: body.access_token, refresh_token: body.refresh_token,
        expires_at: Date.now() + body.expires_in * 1000 };
      await save(d);
      // appli=1 covers weight-related measures
      await withingsPost('/notify', {
        action: 'subscribe', access_token: d.tokens.access_token,
        callbackurl: BASE_URL + '/withings/webhook', appli: 1
      }).catch(e => console.error('[withings] subscribe failed:', e.message));
      const r = await syncMeasures(0); // backfill history
      res.send(`Withings connected. Webhook subscribed. ${r.total} weigh-ins pulled. You can close this.`);
    } catch (e) {
      console.error('[withings] auth failed:', e.message);
      res.status(500).send('Withings auth failed: ' + e.message);
    }
  });

  // Withings pings this the moment a weigh-in syncs. Answer 200 fast; HEAD is
  // the subscription verification.
  app.head('/withings/webhook', (req, res) => res.sendStatus(200));
  app.post('/withings/webhook', (req, res) => {
    res.sendStatus(200);
    const since = req.body && req.body.startdate
      ? Number(req.body.startdate) - 60 : Math.floor(Date.now() / 1000) - 3600;
    syncMeasures(since).catch(e => console.error('[withings] sync failed:', e.message));
  });

  app.get('/withings/status', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({ connected: !!d.tokens, weigh_ins: d.weights.length, synced_at: d.synced_at || null,
      configured: !!(CLIENT_ID && CLIENT_SECRET && BASE_URL) }); });

  app.get('/withings/sync', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: true, ...(await syncMeasures(0)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
}

module.exports = { attach, syncMeasures, connected: async () => !!(await db()).tokens };
