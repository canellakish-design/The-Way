// WHOOP v2: OAuth + webhook + pull-reconciliation. Tokens in storage.
// Env: WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, BASE_URL
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const API = 'https://api.prod.whoop.com';
const CID = process.env.WHOOP_CLIENT_ID || '';
const SEC = process.env.WHOOP_CLIENT_SECRET || '';
const BASE = process.env.BASE_URL || '';

async function db() { return getJSON('whoop', { tokens: null, sleep: null, recovery: null }); }
async function tok(d) {
  if (!d.tokens) throw new Error('not authorized — visit /whoop/auth');
  if (Date.now() < d.tokens.expires_at - 60000) return d.tokens.access_token;
  const r = await fetch(API + '/oauth/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.tokens.refresh_token,
      client_id: CID, client_secret: SEC }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('token refresh failed');
  d.tokens = { access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000 };
  await setJSON('whoop', d);
  return d.tokens.access_token;
}
async function syncLatest() {
  const d = await db();
  const t = await tok(d);
  const h = { Authorization: 'Bearer ' + t };
  const s = await (await fetch(API + '/developer/v2/activity/sleep?limit=1', { headers: h })).json();
  const rec = await (await fetch(API + '/developer/v2/recovery?limit=1', { headers: h })).json();
  if (s.records && s.records[0]) d.sleep = s.records[0];
  if (rec.records && rec.records[0]) d.recovery = rec.records[0];
  await setJSON('whoop', d);
  return d;
}
async function sleepLatest() {
  let d;
  try { d = await syncLatest(); } catch { d = await db(); }
  const s = d.sleep, r = d.recovery;
  return {
    connected: !!d.tokens,
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
      await setJSON('whoop', d);
      await syncLatest().catch(() => {});
      res.send('WHOOP connected. You can close this tab.');
    } catch (e) { res.status(500).send('WHOOP auth failed: ' + e.message); }
  });
  app.post('/whoop/webhook', (req, res) => {
    res.sendStatus(200);
    syncLatest().catch(e => console.error('[whoop]', e.message));
  });
  app.get('/whoop/status', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({ connected: !!d.tokens, has_sleep: !!d.sleep, has_recovery: !!d.recovery }); });
  app.get('/whoop/sync', async (req, res) => { if (!auth(req, res)) return;
    try { await syncLatest(); res.json({ ok: true, ...(await sleepLatest()) }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
  app.get('/sleep/latest', async (req, res) => { if (!auth(req, res)) return;
    res.json(await sleepLatest()); });
}
module.exports = { attach, sleepLatest };
