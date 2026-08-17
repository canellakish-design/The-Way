// ============================================================
// status.js — one honest answer to "what is actually connected?"
// Every integration reports three things: whether its credentials exist at all
// (env vars), whether it holds a live authorization, and whether real data has
// arrived. Those fail differently and a single green tick would hide it — an
// app with no client secret and an app awaiting one OAuth visit look identical
// from the outside, and only one of them is fixed by clicking a link.
// ============================================================
const { getJSON } = require('./storage');
const { auth } = require('./fuel-log');

const BASE = process.env.BASE_URL || '';
const env = k => !!(process.env[k] || '').trim();

// Auth links must be absolute for the phone to follow them. BASE_URL is what
// the OAuth providers redirect back to, so if it isn't set the link is broken
// anyway — say so rather than emitting a half-formed href.
const link = path => BASE ? BASE.replace(/\/$/, '') + path : null;

const ago = iso => {
  if (!iso) return null;
  const h = (Date.now() - new Date(iso).getTime()) / 3.6e6;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm ago';
  if (h < 48) return Math.round(h) + 'h ago';
  return Math.round(h / 24) + 'd ago';
};

async function report() {
  const out = [];
  const push = o => out.push(o);

  // ---- Google Calendar (multi-account) ----
  try {
    const g = await getJSON('gcal', { accounts: [], events: [] });
    const accounts = (g.accounts || []);
    const bad = accounts.filter(a => a.auth_error);
    push({
      key: 'google', name: 'Google Calendar', role: 'the day itself — classes, coaching, everything',
      configured: env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'),
      connected: accounts.length > 0 && bad.length < accounts.length,
      has_data: (g.events || []).length > 0,
      detail: accounts.length
        ? accounts.map(a => a.id + (a.auth_error ? ' (needs reconnect)' : '')).join(', ')
          + ` · ${(g.events || []).length} events · synced ${ago(g.synced_at) || 'never'}`
        : 'no account connected',
      auth_url: link('/gcal/auth'),
      hint: 'Add one account per Google identity — /gcal/auth?email=you@domain preselects it.',
      fix: !(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'))
        ? 'set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'
        : bad.length ? 'reconnect: ' + bad.map(a => a.id).join(', ')
        : accounts.length ? null : 'visit the auth link once'
    });
  } catch (e) { push({ key: 'google', name: 'Google Calendar', error: e.message }); }

  // ---- WHOOP ----
  try {
    const w = await getJSON('whoop', { tokens: null });
    push({
      key: 'whoop', name: 'WHOOP', role: 'recovery and sleep, top of the day',
      configured: env('WHOOP_CLIENT_ID') && env('WHOOP_CLIENT_SECRET'),
      connected: !!w.tokens && !w.auth_error,
      has_data: !!(w.recovery || w.sleep),
      detail: w.auth_error ? 'auth error: ' + (w.auth_error.detail || w.auth_error)
        : w.tokens ? `synced ${ago(w.synced_at) || 'never'}` : 'not authorized',
      auth_url: link('/whoop/auth'),
      fix: !(env('WHOOP_CLIENT_ID') && env('WHOOP_CLIENT_SECRET'))
        ? 'set WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET'
        : (!w.tokens || w.auth_error) ? 'visit the auth link to (re)connect' : null
    });
  } catch (e) { push({ key: 'whoop', name: 'WHOOP', error: e.message }); }

  // ---- Strava ----
  try {
    const st = await getJSON('strava', { tokens: null, rides: [] });
    push({
      key: 'strava', name: 'Strava', role: 'rides in — workout burn, and the power streams FTP is read from',
      configured: env('STRAVA_CLIENT_ID') && env('STRAVA_CLIENT_SECRET'),
      connected: !!st.tokens,
      has_data: (st.rides || []).length > 0,
      detail: st.tokens ? `${(st.rides || []).length} rides stored` : 'not authorized',
      auth_url: link('/strava/auth'),
      fix: !(env('STRAVA_CLIENT_ID') && env('STRAVA_CLIENT_SECRET'))
        ? 'set STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET'
        : !st.tokens ? 'visit the auth link once' : null
    });
  } catch (e) { push({ key: 'strava', name: 'Strava', error: e.message }); }

  // ---- Withings ----
  try {
    const wi = await getJSON('withings', { tokens: null, weights: [] });
    push({
      key: 'withings', name: 'Withings scale', role: 'the morning weigh-in, automatically',
      configured: env('WITHINGS_CLIENT_ID') && env('WITHINGS_CLIENT_SECRET'),
      connected: !!wi.tokens,
      has_data: (wi.weights || []).length > 0,
      detail: wi.tokens ? `${(wi.weights || []).length} weigh-ins · synced ${ago(wi.synced_at) || 'never'}`
        : 'not authorized — the weigh-in is typed in until this is connected',
      auth_url: link('/withings/auth'),
      fix: !(env('WITHINGS_CLIENT_ID') && env('WITHINGS_CLIENT_SECRET'))
        ? 'set WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET'
        : !wi.tokens ? 'visit the auth link once' : null
    });
  } catch (e) { push({ key: 'withings', name: 'Withings scale', error: e.message }); }

  // ---- intervals.icu (API key, no OAuth) ----
  try {
    const iv = require('./intervals');
    const cache = await getJSON('intervals-cache', null);
    const configured = iv.configured();
    // Env vars being present says nothing about the key working. Ask.
    const probe = configured ? await iv.ping() : { ok: false, reason: 'no API key' };
    const cached = !!(cache && cache.days && Object.keys(cache.days).length);
    push({
      key: 'intervals', name: 'intervals.icu', role: 'planned intervals and lifting on the day',
      configured, connected: probe.ok,
      has_data: cached || !!(probe.planned_today),
      detail: !configured ? 'no API key'
        : probe.ok ? `athlete ${process.env.INTERVALS_ICU_ATHLETE_ID} · ${probe.planned_today} planned today`
          + (cached ? ` · ${Object.keys(cache.days).length} days cached` : '')
        : 'API key rejected — ' + probe.reason,
      auth_url: null,
      fix: !configured ? 'set INTERVALS_ICU_API_KEY and INTERVALS_ICU_ATHLETE_ID (athlete id looks like i123456)'
        : probe.ok ? null : 'check the API key and athlete id on intervals.icu → Settings → Developer'
    });
  } catch (e) { push({ key: 'intervals', name: 'intervals.icu', error: e.message }); }

  // ---- iCal feeds (the no-OAuth calendar path) ----
  try {
    const icsMod = require('./ics');
    const list = icsMod.feeds();
    const cache = await getJSON('ics-cache', null);
    const bad = (cache && cache.feeds || []).filter(f => !f.ok);
    push({
      key: 'ical', name: 'Calendar feeds (iCal)', role: 'calendars without a Google OAuth app',
      configured: list.length > 0,
      connected: list.length > 0 && bad.length < list.length,
      has_data: !!(cache && (cache.events || []).length),
      detail: !list.length ? 'no feeds set'
        : (cache ? `${(cache.events || []).length} events from ${list.length} feed(s)`
            + (bad.length ? ' · failing: ' + bad.map(f => f.name).join(', ') : '')
          : `${list.length} feed(s), not fetched yet`),
      auth_url: null,
      fix: !list.length ? 'set ICS_FEEDS (one per line: Name=secret iCal URL)'
        : bad.length ? 'check the failing feed URL' : null
    });
  } catch (e) { push({ key: 'ical', name: 'Calendar feeds (iCal)', error: e.message }); }

  // ---- Hexis (pushed in by the morning run) ----
  try {
    const m = await getJSON('macros', { days: {} });
    const keys = Object.keys(m.days || {});
    const today = new Date(); const key = today.getFullYear() + '-'
      + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    push({
      key: 'hexis', name: 'Hexis macros', role: 'the day\'s macro targets',
      configured: true,                       // nothing to configure — it's an inbox
      connected: keys.length > 0, has_data: !!m.days[key],
      detail: m.days[key] ? 'today posted' : keys.length ? `last posted ${keys.sort().pop()}` : 'nothing posted yet',
      auth_url: null,
      fix: m.days[key] ? null : 'run the morning Chrome fetch (deploy/hexis-morning-run.md)'
    });
  } catch (e) { push({ key: 'hexis', name: 'Hexis macros', error: e.message }); }

  // ---- Alma (pushed in by the sync run) ----
  try {
    const i = await getJSON('intake', { days: {} });
    const keys = Object.keys(i.days || {});
    push({
      key: 'alma', name: 'Alma intake', role: 'what was actually eaten, for the compliance score',
      configured: true, connected: keys.length > 0, has_data: keys.length > 0,
      detail: keys.length ? `last posted ${keys.sort().pop()}` : 'nothing posted yet — falling back to the app\'s own food log',
      auth_url: null,
      fix: keys.length ? null : 'run the Alma sync (deploy/alma-sync.md)'
    });
  } catch (e) { push({ key: 'alma', name: 'Alma intake', error: e.message }); }

  // ---- classes (a file in the repo) ----
  try {
    const classes = require('./classes');
    push({
      key: 'classes', name: 'Class schedule', role: 'teaching blocks on the day',
      configured: classes.configured(), connected: classes.configured(), has_data: classes.configured(),
      detail: classes.configured() ? 'timetable loaded' : 'bridge/schedule-classes.json is empty',
      auth_url: null,
      fix: classes.configured() ? null : 'fill in bridge/schedule-classes.json and redeploy'
    });
  } catch (e) { push({ key: 'classes', name: 'Class schedule', error: e.message }); }

  // ---- the Agent ----
  push({
    key: 'agent', name: 'Coach (Anthropic)', role: 'the wake report and the coaches',
    configured: env('ANTHROPIC_API_KEY'), connected: env('ANTHROPIC_API_KEY'), has_data: env('ANTHROPIC_API_KEY'),
    detail: env('ANTHROPIC_API_KEY') ? 'key set' : 'no API key',
    auth_url: null, fix: env('ANTHROPIC_API_KEY') ? null : 'set ANTHROPIC_API_KEY'
  });

  const ready = out.filter(s => s.connected && s.has_data).length;
  return {
    base_url: BASE || null,
    base_url_note: BASE ? null : 'BASE_URL is not set — every OAuth callback will fail. Set it to the site URL.',
    ready, total: out.length,
    integrations: out
  };
}

function attach(app) {
  app.get('/status', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await report()); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, report };
