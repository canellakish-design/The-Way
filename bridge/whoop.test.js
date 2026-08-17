// ============================================================
// whoop.test.js — the WHOOP path: OAuth URLs, the token refresh, the
// night-vs-nap pick, the sync cache, and what /whoop/status tells you when
// the connection has died.
// Run: node bridge/whoop.test.js
// ============================================================
process.env.TZ = 'UTC';               // production runs UTC; the app zone is Eastern
process.env.FUEL_TOKEN = 'test-fuel-token';
// Deliberately grubby: this is what a credential pasted into a hosting
// dashboard looks like, and the trimming in whoop.js exists because of it.
process.env.WHOOP_CLIENT_ID = '  "whoop-cid" ';
process.env.WHOOP_CLIENT_SECRET = "'whoop-secret'\n";
// Likewise the API base rather than the site root, with a trailing slash —
// the spelling that produced a redirect_uri no provider would accept.
process.env.BASE_URL = 'https://thewayforward.netlify.app/.netlify/functions/api/';

const { stubStorage, serve, stubFetch, checker } = require('./test-helpers');
const tz = require('./tz');
const ok = checker();

const API = 'https://api.prod.whoop.com';
const TOKEN_URL = API + '/oauth/oauth2/token';
const SLEEP_URL = '/developer/v2/activity/sleep';
const RECOVERY_URL = '/developer/v2/recovery';

// ---- fixtures --------------------------------------------------------
const today = tz.todayKey();
const yesterday = tz.shiftKey(today, -1);
// A wall-clock time in Harry's zone, as an instant — the same conversion the
// app does. Building these in UTC would put "1pm" on the wrong calendar day.
const at = (key, h, m) => {
  const [y, mo, d] = key.split('-').map(Number);
  return tz.zonedToUTC(y, mo, d, h, m || 0).toISOString();
};
const sleepRec = (start, o) => ({
  id: o.id || 'sleep-1', start, nap: !!o.nap,
  score: {
    sleep_performance_percentage: o.perf == null ? 88 : o.perf,
    stage_summary: {
      total_in_bed_time_milli: o.inBedH * 3.6e6,
      total_awake_time_milli: (o.awakeMin || 0) * 60000
    }
  }
});
const recoveryRec = o => ({ score: { recovery_score: o.score, hrv_rmssd_milli: o.hrv,
  resting_heart_rate: o.rhr } });
const liveTokens = () => ({ access_token: 'access-1', refresh_token: 'refresh-1',
  expires_at: Date.now() + 3600e3 });
const deadTokens = () => ({ access_token: 'access-old', refresh_token: 'refresh-old',
  expires_at: Date.now() - 1000 });

// whoop.js keeps module-level state (the in-flight sync guard), so each group
// gets its own copy of the module on top of its own store.
function fresh(seed) {
  const store = stubStorage(seed);
  for (const p of ['./whoop', './fuel-log']) delete require.cache[require.resolve(p)];
  return { store, whoop: require('./whoop') };
}
const form = body => Object.fromEntries(new URLSearchParams(body));
const TOKEN_Q = { headers: { 'x-fuel-token': process.env.FUEL_TOKEN } };

async function main() {

// ---- the OAuth URLs --------------------------------------------------
ok.section('OAuth URLs');
{
  const { whoop } = fresh({});
  const app = await serve(whoop.attach);
  const r = await app.get('/whoop/auth', { redirect: 'manual' });
  const u = new URL(r.headers.get('location'));
  ok('/whoop/auth redirects to WHOOP', r.status === 302 && u.origin === API, u.origin);
  ok('client_id is trimmed of pasted quotes and spaces',
    u.searchParams.get('client_id') === 'whoop-cid', JSON.stringify(u.searchParams.get('client_id')));
  ok('redirect_uri drops the function mount and the trailing slash',
    u.searchParams.get('redirect_uri') === 'https://thewayforward.netlify.app/whoop/callback',
    u.searchParams.get('redirect_uri'));
  ok('offline scope requested, or there is no refresh token to hold',
    /\boffline\b/.test(u.searchParams.get('scope')), u.searchParams.get('scope'));
  ok('sleep and recovery scopes requested',
    /read:sleep/.test(u.searchParams.get('scope')) && /read:recovery/.test(u.searchParams.get('scope')));
  await app.close();
}

// ---- the callback ----------------------------------------------------
ok.section('callback');
{
  const { store, whoop } = fresh({});
  const f = stubFetch(url => {
    if (url === TOKEN_URL) return { body: { access_token: 'access-new',
      refresh_token: 'refresh-new', expires_in: 3600 } };
    if (url.includes(SLEEP_URL)) return { body: { records: [] } };
    if (url.includes(RECOVERY_URL)) return { body: { records: [] } };
    return { status: 404, body: {} };
  });
  const app = await serve(whoop.attach);
  const r = await app.get('/whoop/callback?code=auth-code-123');
  ok('callback reports success', r.status === 200 && /WHOOP connected/.test(r.text), r.text.slice(0, 80));
  const sent = form(f.calls[0].body);
  ok('exchanges the authorization code', sent.grant_type === 'authorization_code' && sent.code === 'auth-code-123');
  ok('callback redirect_uri matches the one /whoop/auth sent',
    sent.redirect_uri === 'https://thewayforward.netlify.app/whoop/callback', sent.redirect_uri);
  ok('secret is trimmed of pasted quotes and newlines', sent.client_secret === 'whoop-secret',
    JSON.stringify(sent.client_secret));
  ok('tokens stored', store.whoop.tokens.access_token === 'access-new'
    && store.whoop.tokens.refresh_token === 'refresh-new');
  ok('expiry stored as an instant, not a duration',
    Math.abs(store.whoop.tokens.expires_at - (Date.now() + 3600e3)) < 5000, String(store.whoop.tokens.expires_at));
  f.restore();
  await app.close();
}
{
  // A store that cannot be written must say so rather than claiming success —
  // the tokens are gone the moment the function instance goes away.
  const { store, whoop } = fresh({});
  store.__failWrites = true;
  const f = stubFetch(url => url === TOKEN_URL
    ? { body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } } : { body: {} });
  const app = await serve(whoop.attach);
  const r = await app.get('/whoop/callback?code=x');
  ok('storage failure surfaces as a 500, not a false "connected"',
    r.status === 500 && /storage error/.test(r.text), r.status + ' ' + r.text.slice(0, 60));
  f.restore();
  await app.close();
}

// ---- reading what is stored -----------------------------------------
ok.section('sleepLatest — the passive read');
{
  const night = sleepRec(at(yesterday, 23, 15), { inBedH: 8, awakeMin: 30, perf: 91 });
  const { whoop } = fresh({ whoop: { tokens: liveTokens(), sleep: night, nap: null,
    recovery: recoveryRec({ score: 71, hrv: 88.5, rhr: 48 }), synced_at: new Date().toISOString() } });
  const f = stubFetch(() => { throw new Error('passive read must not call WHOOP'); });
  const s = await whoop.sleepLatest({ sync: false });
  ok('sync:false makes no request to WHOOP', f.calls.length === 0, String(f.calls.length));
  ok('connected', s.connected === true);
  ok('"slept" is asleep, not in bed', s.sleep.hours === 7.5, String(s.sleep.hours));
  ok('time in bed reported separately', s.sleep.in_bed === 8, String(s.sleep.in_bed));
  ok('performance passed through', s.sleep.performance === 91);
  ok('recovery mapped', s.recovery.score === 71 && s.recovery.hrv === 88.5 && s.recovery.rhr === 48,
    JSON.stringify(s.recovery));
  f.restore();
}
{
  // The nap guard on the way out: a passive read serves whatever was stored,
  // so yesterday's lie-down would otherwise still be on this morning's card.
  const { whoop } = fresh({ whoop: { tokens: liveTokens(),
    sleep: sleepRec(at(yesterday, 23, 0), { inBedH: 7, awakeMin: 0 }),
    nap: sleepRec(at(yesterday, 14, 0), { inBedH: 1, awakeMin: 6, nap: true }),
    recovery: null } });
  const s = await whoop.sleepLatest({ sync: false });
  ok("yesterday's nap is not shown today", s.nap === null, JSON.stringify(s.nap));
}
{
  const { whoop } = fresh({ whoop: { tokens: liveTokens(),
    sleep: sleepRec(at(yesterday, 23, 0), { inBedH: 7, awakeMin: 0 }),
    nap: sleepRec(at(today, 14, 0), { inBedH: 1, awakeMin: 6, nap: true }),
    recovery: null } });
  const s = await whoop.sleepLatest({ sync: false });
  ok("today's nap is shown", s.nap && s.nap.hours === 0.9, JSON.stringify(s.nap));
}
{
  // Never connected: an honest empty answer, not an exception.
  const { whoop } = fresh({});
  const f = stubFetch(() => ({ body: {} }));
  const s = await whoop.sleepLatest();
  ok('unconnected reads as connected:false with no data', s.connected === false
    && s.sleep === null && s.recovery === null, JSON.stringify(s));
  ok('and does not call WHOOP without a token', f.calls.length === 0);
  f.restore();
}

// ---- the sync --------------------------------------------------------
ok.section('sync — night vs nap');
{
  // WHOOP returns newest first, and the newest record is often a nap.
  const records = [
    sleepRec(at(today, 13, 30), { id: 'nap-today', inBedH: 1.5, awakeMin: 18, nap: true }),
    sleepRec(at(yesterday, 23, 10), { id: 'last-night', inBedH: 8, awakeMin: 30, perf: 84 }),
    sleepRec(at(tz.shiftKey(today, -2), 23, 0), { id: 'older-night', inBedH: 6, awakeMin: 0 })
  ];
  const { store, whoop } = fresh({ whoop: { tokens: liveTokens() } });
  const f = stubFetch(url => {
    if (url.includes(SLEEP_URL)) return { body: { records } };
    if (url.includes(RECOVERY_URL)) return { body: { records: [recoveryRec({ score: 55, hrv: 62, rhr: 51 })] } };
    return { status: 404, body: {} };
  });
  const app = await serve(whoop.attach);
  const r = await app.get('/whoop/sync', TOKEN_Q);
  ok('/whoop/sync answers ok', r.status === 200 && r.json.ok === true, r.text.slice(0, 80));
  ok('asks for ten sleep records, not one', /limit=10/.test(f.calls[0].url), f.calls[0].url);
  ok('bearer token sent', /^Bearer /.test(f.calls[0].headers.Authorization || ''));
  ok('the night is the latest non-nap record', store.whoop.sleep.id === 'last-night', store.whoop.sleep.id);
  ok('the nap is kept separately', store.whoop.nap && store.whoop.nap.id === 'nap-today');
  ok('sync answers with the night, not the nap', r.json.sleep.hours === 7.5, String(r.json.sleep.hours));
  ok('recovery stored', store.whoop.recovery.score.recovery_score === 55);
  ok('synced_at stamped', !!store.whoop.synced_at);
  f.restore();
  await app.close();
}
{
  // A nap that is not today's must not be carried into today's store either.
  const records = [
    sleepRec(at(yesterday, 15, 0), { id: 'nap-yesterday', inBedH: 1, awakeMin: 0, nap: true }),
    sleepRec(at(yesterday, 23, 0), { id: 'last-night', inBedH: 7, awakeMin: 0 })
  ];
  const { store, whoop } = fresh({ whoop: { tokens: liveTokens(), nap: { id: 'stale' } } });
  const f = stubFetch(url => url.includes(SLEEP_URL)
    ? { body: { records } } : { body: { records: [] } });
  await whoop.syncLatest(true);
  ok("a nap from another day clears rather than sticking", store.whoop.nap === null,
    JSON.stringify(store.whoop.nap));
  ok('the night is still taken', store.whoop.sleep.id === 'last-night');
  f.restore();
}
{
  // A sleep record with no score is not a night — WHOOP emits these while a
  // sleep is still being scored.
  const records = [
    { id: 'unscored', start: at(today, 2, 0), nap: false },
    sleepRec(at(yesterday, 23, 0), { id: 'scored-night', inBedH: 7, awakeMin: 0 })
  ];
  const { store, whoop } = fresh({ whoop: { tokens: liveTokens() } });
  const f = stubFetch(url => url.includes(SLEEP_URL)
    ? { body: { records } } : { body: { records: [] } });
  await whoop.syncLatest(true);
  ok('unscored records are skipped', store.whoop.sleep.id === 'scored-night', store.whoop.sleep.id);
  f.restore();
}

// ---- the sync cache --------------------------------------------------
ok.section('sync cache');
{
  const { whoop } = fresh({ whoop: { tokens: liveTokens(),
    sleep: sleepRec(at(yesterday, 23, 0), { inBedH: 7, awakeMin: 0 }), recovery: null,
    synced_at: new Date().toISOString() } });
  const f = stubFetch(() => ({ body: { records: [] } }));
  const app = await serve(whoop.attach);
  await app.get('/sleep/latest', TOKEN_Q);
  await app.get('/sleep/latest', TOKEN_Q);
  ok('a fresh sync is reused — page loads do not hammer WHOOP', f.calls.length === 0,
    String(f.calls.length));
  f.restore();
  await app.close();
}
{
  const { whoop } = fresh({ whoop: { tokens: liveTokens(), sleep: null, recovery: null,
    synced_at: new Date(Date.now() - 11 * 60000).toISOString() } });
  const f = stubFetch(() => ({ body: { records: [] } }));
  const app = await serve(whoop.attach);
  await app.get('/sleep/latest', TOKEN_Q);
  ok('a stale sync refetches', f.calls.length === 2, String(f.calls.length));
  f.restore();
  await app.close();
}
{
  // The webhook is WHOOP saying there is something new, so it must bypass the
  // cache — and answer 200 before doing any of the work.
  const { store, whoop } = fresh({ whoop: { tokens: liveTokens(),
    synced_at: new Date().toISOString() } });
  let resolveSleep;
  const f = stubFetch(url => url.includes(SLEEP_URL)
    ? new Promise(r => { resolveSleep = () => r({ body: { records: [
        sleepRec(at(yesterday, 23, 0), { id: 'webhook-night', inBedH: 8, awakeMin: 0 })] } }); })
    : { body: { records: [] } });
  const app = await serve(whoop.attach);
  const r = await app.post('/whoop/webhook', { type: 'sleep.updated' });
  ok('webhook answers 200 without waiting for the pull', r.status === 200);
  resolveSleep();
  await new Promise(res => setTimeout(res, 50));
  ok('webhook forces a pull despite a fresh cache', store.whoop.sleep
    && store.whoop.sleep.id === 'webhook-night', JSON.stringify(store.whoop.sleep && store.whoop.sleep.id));
  f.restore();
  await app.close();
}

// ---- the refresh -----------------------------------------------------
ok.section('token refresh');
{
  const { store, whoop } = fresh({ whoop: { tokens: deadTokens() } });
  const f = stubFetch(url => {
    if (url === TOKEN_URL) return { body: { access_token: 'access-2',
      refresh_token: 'refresh-2', expires_in: 3600 } };
    return { body: { records: [] } };
  });
  await whoop.syncLatest(true);
  const sent = form(f.calls[0].body);
  ok('an expired token is refreshed before the pull', f.calls[0].url === TOKEN_URL, f.calls[0].url);
  ok('refresh_token grant', sent.grant_type === 'refresh_token' && sent.refresh_token === 'refresh-old');
  ok('offline scope on the refresh, or WHOOP returns no replacement',
    sent.scope === 'offline', JSON.stringify(sent.scope));
  ok('the rotated refresh token is stored', store.whoop.refresh_token === undefined
    && store.whoop.tokens.refresh_token === 'refresh-2', store.whoop.tokens.refresh_token);
  ok('the pull uses the new access token',
    (f.calls[1].headers.Authorization || '') === 'Bearer access-2', f.calls[1].headers.Authorization);
  f.restore();
}
{
  // WHOOP does not always return a replacement. Keeping the old one is the
  // difference between a connection that survives and one that dies silently.
  const { store, whoop } = fresh({ whoop: { tokens: deadTokens() } });
  const f = stubFetch(url => url === TOKEN_URL
    ? { body: { access_token: 'access-3', expires_in: 3600 } } : { body: { records: [] } });
  await whoop.syncLatest(true);
  ok('a refresh with no new refresh token keeps the old one',
    store.whoop.tokens.refresh_token === 'refresh-old', store.whoop.tokens.refresh_token);
  f.restore();
}
{
  // A 401 before the clock expiry means revoked or reissued elsewhere: refresh
  // once and retry, rather than reporting the connection dead.
  const { whoop } = fresh({ whoop: { tokens: liveTokens() } });
  let sleepHits = 0;
  const f = stubFetch(url => {
    if (url.includes(SLEEP_URL)) return ++sleepHits === 1
      ? { status: 401, body: {} } : { body: { records: [] } };
    if (url === TOKEN_URL) return { body: { access_token: 'access-4', refresh_token: 'refresh-4', expires_in: 3600 } };
    return { body: { records: [] } };
  });
  await whoop.syncLatest(true);
  ok('an unexpected 401 triggers one refresh and one retry',
    f.calls.map(c => c.url === TOKEN_URL ? 'token' : c.url.includes(SLEEP_URL) ? 'sleep' : 'recovery')
      .join(',') === 'sleep,token,sleep,recovery',
    f.calls.map(c => c.url.split('?')[0]).join(' | '));
  ok('the retry carries the refreshed token',
    f.calls[2].headers.Authorization === 'Bearer access-4', f.calls[2].headers.Authorization);
  f.restore();
}
{
  // The retry is once, not forever.
  const { whoop } = fresh({ whoop: { tokens: liveTokens() } });
  const f = stubFetch(url => url === TOKEN_URL
    ? { body: { access_token: 'a', refresh_token: 'r', expires_in: 3600 } }
    : { status: 401, body: {} });
  let threw = null;
  await whoop.syncLatest(true).catch(e => { threw = e; });
  ok('a persistent 401 gives up rather than looping', !!threw && /whoop 401/.test(threw.message),
    threw && threw.message);
  f.restore();
}

// ---- the last-write guard -------------------------------------------
ok.section('token race');
{
  // Two instances refreshing at once: the loser must not write its retired
  // pair over the winner's fresh one, which is what kills the connection for
  // good. Newest expiry wins.
  const winner = { access_token: 'winner', refresh_token: 'refresh-winner',
    expires_at: Date.now() + 3600e3 };
  const { store, whoop } = fresh({ whoop: { tokens: winner, auth_error: { detail: 'old' } } });
  await whoop.storeTokens({ access_token: 'loser', refresh_token: 'refresh-loser',
    expires_at: Date.now() + 1800e3 });
  ok('an older token pair cannot overwrite a newer one',
    store.whoop.tokens.access_token === 'winner', store.whoop.tokens.access_token);
  ok('and the stale auth_error is left alone by the loser',
    store.whoop.auth_error && store.whoop.auth_error.detail === 'old');
  await whoop.storeTokens({ access_token: 'newer', refresh_token: 'refresh-newer',
    expires_at: Date.now() + 7200e3 });
  ok('a newer pair does write', store.whoop.tokens.access_token === 'newer');
  ok('a successful store clears auth_error', store.whoop.auth_error === null,
    JSON.stringify(store.whoop.auth_error));
}

// ---- status ----------------------------------------------------------
ok.section('/whoop/status');
{
  const { whoop } = fresh({ whoop: { tokens: liveTokens(),
    sleep: sleepRec(at(yesterday, 23, 0), { inBedH: 7, awakeMin: 0 }),
    recovery: recoveryRec({ score: 60, hrv: 70, rhr: 50 }),
    synced_at: new Date().toISOString() } });
  const app = await serve(whoop.attach);
  const r = await app.get('/whoop/status', TOKEN_Q);
  const j = r.json;
  ok('healthy connection reports no fix needed', j.fix === null && j.reauthorize === false,
    JSON.stringify({ fix: j.fix, reauthorize: j.reauthorize }));
  ok('configured and base_url_set', j.configured === true && j.base_url_set === true);
  ok('connected with data on both sides', j.connected && j.has_sleep && j.has_recovery);
  ok('token expiry reported in seconds', j.token_expires_in_s > 3500 && j.token_expires_in_s <= 3600,
    String(j.token_expires_in_s));
  await app.close();
}
{
  // A dead refresh token needs a human. Nothing else can say so.
  const { store, whoop } = fresh({ whoop: { tokens: deadTokens() } });
  const f = stubFetch(url => url === TOKEN_URL
    ? { body: { error: 'invalid_grant', error_description: 'refresh token is invalid' } }
    : { body: { records: [] } });
  const app = await serve(whoop.attach);
  const sync = await app.get('/whoop/sync', TOKEN_Q);
  ok('a failed refresh answers 500, not a cheerful ok', sync.status === 500 && sync.json.ok === false,
    sync.text.slice(0, 80));
  ok('the reason is recorded, not swallowed',
    store.whoop.auth_error && /refresh token is invalid/.test(store.whoop.auth_error.detail),
    JSON.stringify(store.whoop.auth_error));
  const st = (await app.get('/whoop/status', TOKEN_Q)).json;
  ok('status asks for a reconnect', st.reauthorize === true
    && st.fix === 'visit /whoop/auth to reconnect', JSON.stringify({ r: st.reauthorize, fix: st.fix }));
  ok('and names the underlying error', /refresh token is invalid/.test(st.auth_error.detail));
  f.restore();
  await app.close();
}
{
  const { whoop } = fresh({});
  const app = await serve(whoop.attach);
  const st = (await app.get('/whoop/status', TOKEN_Q)).json;
  ok('never connected also asks for /whoop/auth',
    st.connected === false && st.reauthorize === true && st.fix === 'visit /whoop/auth to reconnect',
    JSON.stringify(st));
  ok('no token means no expiry to report', st.token_expires_in_s === null);
  await app.close();
}

// ---- who may call ----------------------------------------------------
ok.section('auth');
{
  const { whoop } = fresh({ whoop: { tokens: liveTokens() } });
  const app = await serve(whoop.attach);
  const bare = await app.get('/whoop/status');
  ok('no credential is a 401', bare.status === 401 && bare.json.error === 'bad token',
    bare.status + ' ' + bare.text.slice(0, 40));
  ok('a wrong token is a 401', (await app.get('/whoop/status?token=nope')).status === 401);
  ok('FUEL_TOKEN in the query works', (await app.get('/whoop/status?token=' + process.env.FUEL_TOKEN)).status === 200);
  ok('FUEL_TOKEN in the header works', (await app.get('/whoop/status', TOKEN_Q)).status === 200);
  ok("the app's own header works", (await app.get('/whoop/status',
    { headers: { 'x-the-way-app': '1' } })).status === 200);
  ok('/whoop/auth needs no credential — it is the connect link',
    (await app.get('/whoop/auth', { redirect: 'manual' })).status === 302);
  await app.close();
}

ok.done();
}

main().catch(e => { console.error(e); process.exit(1); });
