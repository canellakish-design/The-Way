// WHOOP v2: OAuth + webhook + pull-reconciliation. Tokens in storage.
// Env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, BASE_URL
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const API = 'https://api.prod.whoop.com';
const CID = process.env.WHOOP_CLIENT_ID || '';
const SEC = process.env.WHOOP_CLIENT_SECRET || '';
const BASE = process.env.BASE_URL || '';

async function db() { return getJSON('whoop', { tokens: null, sleep: null, recovery: null }); }

// WHOOP rotates the refresh token on every use: refreshing consumes the one
// you hold and hands back a new pair. So two refreshes racing each other means
// the second is spending a token WHOOP has already retired — it fails, and if
// its write lands last it stores a dead refresh token, which takes the
// connection down for good until someone re-authorizes by hand.
//
// Two guards. In-process: one refresh/sync at a time, everyone else waits on
// the same promise. Across instances: never write tokens older than the ones
// already stored, so a slow loser can't overwrite the winner's fresh pair.
let inflight = null;
const SYNC_TTL_MS = 10 * 60 * 1000;

async function storeTokens(tokens) {
  const fresh = await db();
  if (fresh.tokens && fresh.tokens.expires_at >= tokens.expires_at) return fresh; // someone newer won
  fresh.tokens = tokens;
  fresh.auth_error = null;
  await setJSON('whoop', fresh);
  return fresh;
}

async function tok(d) {
  if (!d.tokens) throw new Error('not authorized — visit /whoop/auth');
  if (Date.now() < d.tokens.expires_at - 60000) return d.tokens.access_token;
  const r = await fetch(API + '/oauth/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.tokens.refresh_token,
      client_id: CID, client_secret: SEC,
      // Required: WHOOP only returns a replacement refresh token when the
      // refresh request asks for offline access. Without it the token it just
      // retired is never replaced, and the connection dies an hour after it
      // was made — which is exactly what "it was working" looks like.
      scope: 'offline' }) });
  const j = await r.json();
  if (!j.access_token) {
    // Record it rather than failing silently — a dead refresh token needs a
    // human to revisit /whoop/auth, and nothing else can tell them that.
    const cur = await db();
    cur.auth_error = { at: new Date().toISOString(), detail: (j.error_description || j.error || 'token refresh failed') };
    await setJSON('whoop', cur).catch(() => {});
    throw new Error('token refresh failed: ' + cur.auth_error.detail);
  }
  d.tokens = { access_token: j.access_token,
    // A refresh response without a new refresh token means keep the old one.
    refresh_token: j.refresh_token || d.tokens.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000 };
  await storeTokens(d.tokens);
  return d.tokens.access_token;
}

async function syncLatest(force) {
  const d = await db();
  // A page load asks several routes for recovery at once; they don't each need
  // their own round trip to WHOOP. The webhook is what makes this fresh.
  if (!force && d.synced_at && Date.now() - new Date(d.synced_at).getTime() < SYNC_TTL_MS) return d;
  if (inflight) return inflight;
  inflight = (async () => {
    let t = await tok(d);
    const get = async (path, retried) => {
      const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + t } });
      if (r.status === 401 && !retried) {
        // Rejected before its clock expiry — revoked, or reissued elsewhere.
        d.tokens.expires_at = 0;
        t = await tok(d);
        return get(path, true);
      }
      if (!r.ok) throw new Error('whoop ' + r.status + ' on ' + path.split('?')[0]);
      return r.json();
    };
    const s = await get('/developer/v2/activity/sleep?limit=1');
    const rec = await get('/developer/v2/recovery?limit=1');
    const cur = await db();
    if (s.records && s.records[0]) cur.sleep = s.records[0];
    if (rec.records && rec.records[0]) cur.recovery = rec.records[0];
    cur.synced_at = new Date().toISOString();
    cur.auth_error = null;
    await setJSON('whoop', cur);
    return cur;
  })();
  try { return await inflight; }
  finally { inflight = null; }
}

// opts.sync === false reads what's stored without touching WHOOP. Passive
// readers (the day, the week's availability, the training log) use it; only
// the Sleep card, the webhook and an explicit /whoop/sync pull live.
async function sleepLatest(opts) {
  let d;
  if (opts && opts.sync === false) d = await db();
  else { try { d = await syncLatest(); } catch { d = await db(); } }
  const s = d.sleep, r = d.recovery;
  return {
    connected: !!d.tokens,
    synced_at: d.synced_at || null,
    auth_error: d.auth_error || null,
    sleep: s ? { performance: s.score ? s.score.sleep_performance_percentage : null,
                 hours: s.score ? Math.round(s.score.stage_summary.total_in_bed_time_milli / 3.6e6 * 10) / 10 : null } : null,
    recovery: r ? { score: r.score ? r.score.recovery_score : null,
                    hrv: r.score ? r.score.hrv_rmssd_milli : null,
                    rhr: r.score ? r.score.resting_heart_rate : null } : null
  };
}
function attach(app) {
  app.get('/whoop/auth', (req, res) => {
    const u = new URL(API + '/oauth/oauth2/auth');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', CID);
    u.searchParams.set('redirect_uri', BASE + '/whoop/callback');
    u.searchParams.set('scope', 'read:sleep read:recovery offline');
    u.searchParams.set('state', 'the-way-2026');
    res.redirect(u.toString());
  });
  app.get('/whoop/callback', async (req, res) => {
    try {
      const r = await fetch(API + '/oauth/oauth2/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code,
          client_id: CID, client_secret: SEC, redirect_uri: BASE + '/whoop/callback' }) });
      const j = await r.json();
      if (!j.access_token) throw new Error(JSON.stringify(j));
      const d = await db();
      d.tokens = { access_token: j.access_token, refresh_token: j.refresh_token,
        expires_at: Date.now() + j.expires_in * 1000 };
      try {
        await setJSON('whoop', d);
      } catch(se) {
        return res.status(500).send('WHOOP auth failed — storage error: ' + se.message);
      }
      await syncLatest().catch(() => {});
      res.send('WHOOP connected. You can close this tab.');
    } catch (e) { res.status(500).send('WHOOP auth failed: ' + e.message); }
  });
  app.post('/whoop/webhook', (req, res) => {
    res.sendStatus(200);
    // force: the cache exists to stop page loads hammering WHOOP, but a
    // webhook is WHOOP telling us there is something new to fetch.
    syncLatest(true).catch(e => console.error('[whoop]', e.message));
  });
  app.get('/whoop/status', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({ configured: !!(CID && SEC), base_url_set: !!BASE,
      connected: !!d.tokens, has_sleep: !!d.sleep, has_recovery: !!d.recovery,
      synced_at: d.synced_at || null, auth_error: d.auth_error || null,
      token_expires_in_s: d.tokens ? Math.round((d.tokens.expires_at - Date.now()) / 1000) : null,
      reauthorize: !!(d.auth_error) || !d.tokens,
      fix: !(CID && SEC) ? 'set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET'
        : !BASE ? 'set BASE_URL so the OAuth callback resolves'
        : (!d.tokens || d.auth_error) ? 'visit /whoop/auth to reconnect' : null }); });
  app.get('/whoop/sync', async (req, res) => { if (!auth(req, res)) return;
    try { await syncLatest(true); res.json({ ok: true, ...(await sleepLatest({ sync: false })) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
  app.get('/sleep/latest', async (req, res) => { if (!auth(req, res)) return;
    res.json(await sleepLatest()); });
}
module.exports = { attach, sleepLatest };
