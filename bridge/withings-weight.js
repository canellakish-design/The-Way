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
// Credentials pasted into a hosting dashboard pick up stray whitespace,
// newlines and sometimes the quotes around them. Providers then reject the
// value with a message about the credential being invalid, which sends you
// looking at the wrong thing.
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const CLIENT_ID = envStr('WITHINGS_CLIENT_ID');
const CLIENT_SECRET = envStr('WITHINGS_CLIENT_SECRET');
// Netlify sets URL (the site's primary address) and DEPLOY_PRIME_URL on every
// build, so the site knows where it lives even if BASE_URL was never set —
// and a missing BASE_URL otherwise yields a relative redirect_uri, which
// providers reject with a message that names neither the app nor the variable.
// Trailing slashes are stripped: they turn every redirect into a double slash.
function siteUrl() {
  const v = process.env.BASE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  return v.replace(/\/+$/, '')
    // BASE_URL is naturally set to the API base — that is where the endpoints
    // live — but an OAuth redirect must be a site path. The catch-all redirect
    // in netlify.toml routes /withings/callback to the function anyway, so the
    // short form works and is what gets registered with providers. Strip the
    // function mount so both spellings produce the same redirect_uri.
    .replace(/\/\.netlify\/functions\/[^/]+$/, '');
}
const BASE_URL = siteUrl();

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
async function mirrorToWeighIn(entries, demo) {
  if (!entries.length) return;
  const w = await getJSON('weigh-in', { entries: [] });
  let added = 0;
  for (const e of entries) {
    if (w.entries.some(x => Math.abs(x.ts - e.ts) < 60000 && x.source === 'withings')) continue;
    w.entries.push({ ts: e.ts, lb: e.kg * 2.20462, source: demo ? 'withings (demo)' : 'withings', demo,
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
  await mirrorToWeighIn(fresh, !!d.demo).catch(e => console.error('[withings] mirror failed:', e.message));
  return { found: fresh.length, total: d.weights.length };
}

function attach(app) {
  app.get('/withings/auth', (req, res) => {
    const u = new URL('https://account.withings.com/oauth2_user/authorize2');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', CLIENT_ID);
    u.searchParams.set('scope', 'user.metrics');
    u.searchParams.set('redirect_uri', BASE_URL + '/withings/callback');
    // The state comes back on the callback, which is the only way that handler
    // can know this was a demo run — and demo data must never be mistaken for
    // the athlete's own.
    u.searchParams.set('state', req.query.demo === '1' ? 'the-way-demo' : 'the-way');
    if (req.query.demo === '1') u.searchParams.set('mode', 'demo');
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
      d.demo = req.query.state === 'the-way-demo';
      await save(d);
      // appli=1 covers weight-related measures
      await withingsPost('/notify', {
        action: 'subscribe', callbackurl: BASE_URL + '/withings/webhook', appli: 1
      }, d.tokens.access_token).catch(e => console.error('[withings] subscribe failed:', e.message));
      const r = await syncMeasures(0); // backfill history
      res.send((d.demo ? 'DEMO MODE — these are Withings\' demo readings, not yours. ' : '')
        + `Withings connected. Webhook subscribed. ${r.total} weigh-ins pulled.`
        + (d.demo ? ' Visit /withings/disconnect then /withings/auth for your own account.' : '')
        + ' You can close this.');
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
    res.json({ connected: !!d.tokens, demo: !!d.demo,
      weigh_ins: d.weights.length, synced_at: d.synced_at || null,
      last_updatetime: d.updatetime || null,
      configured: !!(CLIENT_ID && CLIENT_SECRET && BASE_URL) }); });

  // What this app will send, character for character, so it can be compared
  // against what's registered at Withings. No secrets in the response.
  app.get('/withings/debug', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({
      base_url: BASE_URL || '(no site URL — BASE_URL, URL and DEPLOY_PRIME_URL are all unset)',
      base_url_source: process.env.BASE_URL ? 'BASE_URL'
        : process.env.URL ? 'URL (set by Netlify)'
        : process.env.DEPLOY_PRIME_URL ? 'DEPLOY_PRIME_URL (set by Netlify)' : 'none',
      redirect_uri_sent: BASE_URL + '/withings/callback',
      webhook_url_sent: BASE_URL + '/withings/webhook',
      register_both_of_these_at_withings: [BASE_URL + '/withings/callback', BASE_URL + '/withings/webhook'],
      client_id_set: !!CLIENT_ID, client_secret_set: !!CLIENT_SECRET,
      // enough to compare against the dashboard without printing the value
      client_id_tail: CLIENT_ID ? '…' + CLIENT_ID.slice(-6) : null,
      client_id_length: CLIENT_ID.length || 0,
      client_secret_length: CLIENT_SECRET.length || 0,
      raw_had_whitespace_or_quotes: (process.env.WITHINGS_CLIENT_ID || '') !== CLIENT_ID
        || (process.env.WITHINGS_CLIENT_SECRET || '') !== CLIENT_SECRET,
      connected: !!d.tokens, weigh_ins: (d.weights || []).length
    }); });
  // The actual readings, newest first — for checking whether the numbers are
  // the athlete's or a demo account's.
  app.get('/withings/recent', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    const n = Math.min(50, Math.max(1, parseInt(req.query.n, 10) || 10));
    res.json({ demo: !!d.demo, total: d.weights.length,
      readings: d.weights.slice(-n).reverse().map(w => ({
        date: new Date(w.ts).toISOString().slice(0, 10),
        lb: Math.round(w.kg * 2.20462 * 10) / 10, kg: Math.round(w.kg * 10) / 10,
        fat_pct: w.fat_pct ?? null })) }); });
  app.get('/withings/disconnect', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    d.tokens = null; d.weights = []; d.updatetime = null; d.demo = false;
    await save(d);
    // Demo readings were mirrored into the shared weigh-in store; take them
    // back out, or they stay in the trend as if they were real.
    //
    // ?purge=1 takes out everything this scale mirrored, flagged demo or not.
    // It exists because the demo flag is only set when the connect went through
    // /withings/auth?demo=1 — the label rides along in the OAuth state. Sign
    // into a demo or test account through the ordinary flow and the readings
    // arrive labelled as real, and nothing downstream can tell the difference:
    // a scale that reported 143 lb and 249 lb on consecutive days is not a
    // person, but it is stored exactly like one.
    //
    // Not the default, deliberately. Disconnecting a real scale must not delete
    // a true history — and it would be gone for good, since this clears the
    // scale's own store in the same breath.
    const purge = req.query.purge === '1';
    const fromScale = e => String(e.source || '').startsWith('withings');
    let removed = 0;
    try {
      const w = await getJSON('weigh-in', { entries: [] });
      const before = w.entries.length;
      w.entries = w.entries.filter(e => (purge ? !fromScale(e) : !e.demo));
      removed = before - w.entries.length;
      if (removed) await setJSON('weigh-in', w);
    } catch (e) { console.error('[withings] could not clear mirrored readings:', e.message); }
    res.json({ ok: true, disconnected: true, purged: purge, readings_removed: removed }); });
  app.get('/withings/sync', async (req, res) => { if (!auth(req, res)) return;
    // ?full=1 re-pulls everything; by default sync asks only for what changed.
    try { res.json({ ok: true, ...(await syncMeasures(req.query.full === '1' ? 0 : null)) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
}

module.exports = { attach, syncMeasures, connected: async () => !!(await db()).tokens };
