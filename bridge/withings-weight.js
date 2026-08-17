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
// Checked against Withings' own API reference: Bearer-header auth, the
// {status, body} envelope, value × 10^unit decoding, measure types 1/5/6/8/
// 76/77/88, getmeas pagination via more+offset, lastupdate from updatetime,
// and appli=1 for body-metric notifications. Access tokens last 3 hours; a
// refresh token is valid for a year but the previous one dies 8 hours after a
// new one is issued, so the new one is always stored.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');

const API = 'https://wbsapi.withings.net';
const CLIENT_ID = process.env.WITHINGS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || '';

async function db() { return getJSON('withings', { tokens: null, weights: [] }); }
async function save(d) { return setJSON('withings', d); }

// Named error codes, so a failure says what it means rather than a bare number.
const ERRORS = {
  100: 'request succeeded but no data found',
  214: 'an error occurred', 247: 'invalid userid',
  250: 'userid absent or does not match the client', 286: 'no such subscription',
  293: 'callback URL absent or incorrect', 294: 'no notification callback',
  304: 'authorization code absent or incorrect', 305: 'missing required parameter',
  342: 'OAuth credentials absent or incorrect', 343: 'access token absent or invalid',
  601: 'rate limited — no more than one poll per 10 minutes'
};

// token: sent as an Authorization: Bearer header. Passing access_token as a
// form field is the older style and returns 343 against the current API.
async function withingsPost(pathname, params, token) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(API + pathname, { method: 'POST', headers, body: new URLSearchParams(params) });
  const data = await r.json();
  // 100 is "nothing to report", which is an ordinary outcome for a date range
  // with no weigh-ins — not a failure.
  if (data.status === 100) return { measuregrps: [], updatetime: null, empty: true };
  if (data.status !== 0) {
    throw new Error('Withings error ' + data.status
      + (ERRORS[data.status] ? ' — ' + ERRORS[data.status] : '')
      + (data.error ? ' — ' + data.error : ''));
  }
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
    w.entries.push({ ts: e.ts, lb: e.kg * 2.20462, source: 'withings',
      fat_pct: e.fat_pct ?? null,
      fat_mass_lb: e.fat_mass_kg != null ? e.fat_mass_kg * 2.20462 : null,
      fat_free_lb: e.fat_free_kg != null ? e.fat_free_kg * 2.20462 : null,
      muscle_lb: e.muscle_kg != null ? e.muscle_kg * 2.20462 : null,
      water_lb: e.water_kg != null ? e.water_kg * 2.20462 : null,
      bone_lb: e.bone_kg != null ? e.bone_kg * 2.20462 : null });
    added++;
  }
  if (added) {
    w.entries.sort((a, b) => a.ts - b.ts);
    await setJSON('weigh-in', w);
  }
  return added;
}

// Withings measure types. Only the ones the scale actually reports are stored;
// anything else in the response is ignored rather than guessed at.
const MEASURE = {
  1:  'kg',            // weight
  5:  'fat_free_kg',   // fat free mass
  6:  'fat_pct',       // fat ratio %
  8:  'fat_mass_kg',   // fat mass
  76: 'muscle_kg',     // muscle mass
  77: 'water_kg',      // hydration
  88: 'bone_kg'        // bone mass
};
const MEASTYPES = Object.keys(MEASURE).join(',');

// Pull measurements since a timestamp: weight plus whatever body composition
// the scale sent with it.
async function syncMeasures(sinceEpoch) {
  const d = await db();
  const access = await ensureToken(d);
  // lastupdate: the updatetime Withings returned last time, so a sync asks only
  // for what changed since. 0 on the first run pulls the whole history.
  const since = sinceEpoch != null ? sinceEpoch : (d.updatetime || 0);
  const groups = [];
  let offset = 0, updatetime = null, guard = 0;
  // Paginated: keep going while more=1, or a long history arrives truncated
  // with no sign anything is missing.
  while (guard++ < 40) {
    const body = await withingsPost('/measure', {
      action: 'getmeas', meastypes: MEASTYPES, category: 1,
      lastupdate: since, ...(offset ? { offset } : {})
    }, access);
    groups.push(...(body.measuregrps || []));
    if (body.updatetime) updatetime = body.updatetime;
    if (body.more === 1 && body.offset != null) offset = body.offset;
    else break;
  }
  const fresh = [];
  for (const grp of groups) {
    const entry = { ts: grp.date * 1000, kg: null, fat_pct: null };
    for (const m of grp.measures) {
      // value × 10^unit — unit is negative, e.g. 82345 × 10^-3 = 82.345 kg
      const v = m.value * Math.pow(10, m.unit);
      const field = MEASURE[m.type];
      if (field) entry[field] = v;
    }
    if (entry.kg && !d.weights.some(w => w.ts === entry.ts)) {
      d.weights.push(entry);
      fresh.push(entry);
      console.log('[withings] weigh-in:', (entry.kg * 2.20462).toFixed(1), 'lb');
    }
  }
  d.weights.sort((a, b) => a.ts - b.ts);
  d.weights = d.weights.slice(-400); // ~1 year daily
  if (updatetime) d.updatetime = updatetime;   // next sync's lastupdate
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
        action: 'subscribe', callbackurl: BASE_URL + '/withings/webhook', appli: 1
      }, d.tokens.access_token).catch(e => console.error('[withings] subscribe failed:', e.message));
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
      last_updatetime: d.updatetime || null,
      configured: !!(CLIENT_ID && CLIENT_SECRET && BASE_URL) }); });

  app.get('/withings/sync', async (req, res) => { if (!auth(req, res)) return;
    // ?full=1 re-pulls everything; by default sync asks only for what changed.
    try { res.json({ ok: true, ...(await syncMeasures(req.query.full === '1' ? 0 : null)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
}

module.exports = { attach, syncMeasures, connected: async () => !!(await db()).tokens };
