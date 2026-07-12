// ============================================================
// calendar.js — Training Availability Engine (Google Calendar)
// The calendar answers WHEN Harry can train; the training engine
// answers WHAT to do with those windows. Read-only scope.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const CID = process.env.GOOGLE_CLIENT_ID || '';
const SEC = process.env.GOOGLE_CLIENT_SECRET || '';
const BASE = process.env.BASE_URL || '';

// waking window the engine searches inside
const DAY_START = 5 * 60, DAY_END = 21.5 * 60;  // minutes from midnight
const MIN_WINDOW = 30;                            // ignore slivers

// ---- classification -------------------------------------------------
const RULES = [
  ['training', /\b(ride|zwift|train|workout|interval|z2|hiit|kettlebell|gym)\b/i],
  ['coaching', /\bcoach/i],
  ['commute',  /\b(commute|drive to|drive home)\b/i],
  ['work',     /\b(school|class|teach|meeting|work|mcdonogh)\b/i],
  ['family',   /\b(family|dinner with|birthday|kids?)\b/i],
  ['sleep',    /\bsleep\b/i],
  ['travel',   /\b(flight|travel|trip|airport|hotel)\b/i],
  ['flexible', /\b(flexible|maybe|hold|tentative)\b/i],
];
function classify(summary, manual) {
  if (manual && manual[summary]) return manual[summary];
  for (const [cat, re] of RULES) if (re.test(summary || '')) return cat;
  return 'busy'; // unknown defaults to busy
}
// categories that BLOCK training time
const BLOCKS = new Set(['work', 'coaching', 'commute', 'family', 'sleep', 'travel', 'busy']);

// ---- google oauth + sync --------------------------------------------
async function db() { return getJSON('gcal', { tokens: null, events: [], synced_at: null, manual: {} }); }

async function tok(d) {
  if (!d.tokens) throw new Error('calendar not connected — visit /gcal/auth');
  if (Date.now() < d.tokens.expires_at - 60000) return d.tokens.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.tokens.refresh_token,
      client_id: CID, client_secret: SEC }) });
  const j = await r.json();
  if (!j.access_token) throw new Error('google token refresh failed');
  d.tokens.access_token = j.access_token;
  d.tokens.expires_at = Date.now() + j.expires_in * 1000;
  await setJSON('gcal', d);
  return j.access_token;
}

async function sync() {
  const d = await db();
  const t = await tok(d);
  const timeMin = new Date(); timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin); timeMax.setDate(timeMax.getDate() + 8);
  const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  u.searchParams.set('timeMin', timeMin.toISOString());
  u.searchParams.set('timeMax', timeMax.toISOString());
  u.searchParams.set('singleEvents', 'true');
  u.searchParams.set('orderBy', 'startTime');
  u.searchParams.set('maxResults', '250');
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json();
  if (j.error) throw new Error('google: ' + j.error.message);
  d.events = (j.items || []).map(e => ({
    summary: e.summary || '(untitled)',
    start: e.start.dateTime || e.start.date,
    end: e.end.dateTime || e.end.date,
    allDay: !e.start.dateTime,
    category: classify(e.summary, d.manual)
  }));
  d.synced_at = new Date().toISOString();
  await setJSON('gcal', d);
  return d;
}

// ---- availability math (pure, testable) ------------------------------
function windowsForDate(events, dateStr) {
  const dayEvents = events.filter(e => {
    if (e.allDay) return e.start <= dateStr && dateStr < e.end;
    return new Date(e.start).toDateString() === new Date(dateStr + 'T12:00:00').toDateString();
  }).filter(e => BLOCKS.has(e.category));

  // an all-day travel/busy event blocks the whole day
  if (dayEvents.some(e => e.allDay)) {
    return { windows: [], available_min: 0, travel: dayEvents.some(e => e.category === 'travel') };
  }
  const busy = dayEvents.map(e => {
    const s = new Date(e.start), en = new Date(e.end);
    return [s.getHours() * 60 + s.getMinutes(), en.getHours() * 60 + en.getMinutes()];
  }).sort((a, b) => a[0] - b[0]);

  const windows = [];
  let cursor = DAY_START;
  for (const [s, e] of busy) {
    if (s - cursor >= MIN_WINDOW) windows.push([cursor, Math.min(s, DAY_END)]);
    cursor = Math.max(cursor, e);
    if (cursor >= DAY_END) break;
  }
  if (DAY_END - cursor >= MIN_WINDOW) windows.push([cursor, DAY_END]);

  const fmt = m => {
    let h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'a' : 'p';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + String(mm).padStart(2, '0') + ap;
  };
  return {
    windows: windows.map(([s, e]) => ({
      from: fmt(s), to: fmt(e), minutes: e - s,
      slot: s < 12 * 60 ? 'morning' : (s >= 15 * 60 ? 'evening' : 'midday')
    })),
    available_min: windows.reduce((a, [s, e]) => a + (e - s), 0),
    travel: false
  };
}

function recommendToday(day, recovery, remaining) {
  const rec = recovery == null ? null : (recovery >= 67 ? 'green' : recovery >= 34 ? 'yellow' : 'red');
  const best = day.windows.reduce((a, w) => Math.max(a, w.minutes), 0);
  let what;
  if (day.travel || best < MIN_WINDOW) what = 'rest day — no window';
  else if (rec === 'red') what = 'mobility + easy walk — recovery is red';
  else if (rec === 'yellow') what = best >= 60 ? 'Z2 only, keep it honest' : 'mobility + recovery spin';
  else if (remaining && remaining.hi_min > 0 && best >= 60) what = 'threshold session (e.g., 4×8) — hard minutes owed';
  else if (remaining && remaining.aerobic_h > 0 && best >= 75) what = 'Z2 — pay the aerobic bucket';
  else if (best >= 40) what = 'openers or strength';
  else what = 'mobility';
  return { recovery: rec, best_window_min: best, recommendation: what };
}

// weekly availability + recommended volume
function weekAvailability(events, recovery) {
  const days = [];
  let totalMin = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const day = windowsForDate(events, key);
    totalMin += day.available_min;
    days.push({ date: key, dow: d.toLocaleDateString('en-US', { weekday: 'short' }), ...day });
  }
  const availableH = Math.round(totalMin / 6) / 10;
  // realistic trainable share of raw free time, modulated by recovery
  const mod = recovery == null ? 0.55 : recovery >= 67 ? 0.6 : recovery >= 34 ? 0.45 : 0.3;
  return { days, available_h: availableH,
    recommended_h: Math.round(availableH * mod * 10) / 10,
    reason: recovery == null ? 'no recovery data — conservative share of free time'
      : recovery >= 67 ? 'recovery green' : recovery >= 34 ? 'recovery yellow — trimmed' : 'recovery red — minimal' };
}

async function connected() { return !!(await db()).tokens; }
async function trainingHours(recovery) {
  const d = await db();
  if (!d.tokens || !d.events.length) return null;
  return weekAvailability(d.events, recovery).recommended_h;
}

// ---- routes ----------------------------------------------------------
function attach(app) {
  app.get('/gcal/auth', (req, res) => {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', CID);
    u.searchParams.set('redirect_uri', BASE + '/gcal/callback');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly');
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    res.redirect(u.toString());
  });
  app.get('/gcal/callback', async (req, res) => {
    try {
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code,
          client_id: CID, client_secret: SEC, redirect_uri: BASE + '/gcal/callback' }) });
      const j = await r.json();
      if (!j.access_token) throw new Error(JSON.stringify(j));
      const d = await db();
      d.tokens = { access_token: j.access_token,
        refresh_token: j.refresh_token || (d.tokens && d.tokens.refresh_token),
        expires_at: Date.now() + j.expires_in * 1000 };
      await setJSON('gcal', d);
      await sync().catch(() => {});
      res.send('Google Calendar connected (read-only). You can close this tab.');
    } catch (e) { res.status(500).send('Calendar auth failed: ' + e.message); }
  });
  app.get('/gcal/status', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({ connected: !!d.tokens, events: d.events.length, synced_at: d.synced_at }); });
  app.get('/availability', async (req, res) => { if (!auth(req, res)) return;
    try {
      const d = await sync().catch(async () => await db());
      if (!d.tokens) return res.json({ connected: false });
      const { sleepLatest } = require('./whoop');
      const s = await sleepLatest().catch(() => null);
      const rec = s && s.recovery ? s.recovery.score : null;
      res.json({ connected: true, ...weekAvailability(d.events, rec) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/availability/today', async (req, res) => { if (!auth(req, res)) return;
    try {
      const d = await sync().catch(async () => await db());
      if (!d.tokens) return res.json({ connected: false });
      const key = new Date().toISOString().slice(0, 10);
      const day = windowsForDate(d.events, key);
      const { sleepLatest } = require('./whoop');
      const { weekState } = require('./race');
      const s = await sleepLatest().catch(() => null);
      const w = await weekState().catch(() => null);
      const rec = s && s.recovery ? s.recovery.score : null;
      res.json({ connected: true, ...day,
        ...recommendToday(day, rec, w ? w.remaining : null) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, classify, windowsForDate, weekAvailability, recommendToday, trainingHours, connected };
