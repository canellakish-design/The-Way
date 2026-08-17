// ============================================================
// calendar.js — Training Availability Engine (Google Calendar)
// The calendar answers WHEN Harry can train; the training engine
// answers WHAT to do with those windows. Read-only scope.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
// Credentials pasted into a hosting dashboard pick up stray whitespace,
// newlines and sometimes the quotes around them. Providers then reject the
// value with a message about the credential being invalid, which sends you
// looking at the wrong thing.
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const CID = envStr('GOOGLE_CLIENT_ID');
const SEC = envStr('GOOGLE_CLIENT_SECRET');
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
const BASE = siteUrl();

// waking window the engine searches inside
const DAY_START = 5 * 60, DAY_END = 21.5 * 60;  // minutes from midnight
const MIN_WINDOW = 30;                            // ignore slivers

// Day keys and clock times are read in the app's timezone (tz.js). Using the
// server's local time looked right on a laptop and was hours out in
// production, where the function runs in UTC.
const dateKey = d => tz.keyOf(d);
const fmtMin = m => tz.fmtMin(m);

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
function classify(summary, manual, calDefault) {
  if (manual && manual[summary]) return manual[summary];
  // A dedicated calendar is stronger evidence than a title regex: everything
  // on "16 ECNL" is coaching, whatever the event happens to be called.
  if (calDefault) return calDefault;
  for (const [cat, re] of RULES) if (re.test(summary || '')) return cat;
  return 'busy'; // unknown defaults to busy
}

// Calendars whose whole purpose fixes the category of everything on them.
const CAL_RULES = [
  ['coaching', /\b(ecnl|united|mufc|club|academy)\b/i],
  ['work',     /\b(mcdonogh|school|class|teaching|academic)\b/i],
];
function calendarCategory(name) {
  for (const [cat, re] of CAL_RULES) if (re.test(name || '')) return cat;
  return null; // fall back to per-title classification
}
// Noise calendars nobody schedules against.
const CAL_SKIP = /holidays?\b|birthdays|week numbers|contacts/i;
// categories that BLOCK training time
const BLOCKS = new Set(['work', 'coaching', 'commute', 'family', 'sleep', 'travel', 'busy']);

// ---- google oauth + sync --------------------------------------------
// The day is spread across more than one Google account: teaching lives on the
// school account, the club's coaching calendar on another. So this holds a
// list of accounts, not one token pair, and merges every one of them into the
// same day. Visiting /gcal/auth adds an account; it never replaces one.
async function db() {
  const d = await getJSON('gcal', { accounts: [], events: [], synced_at: null, manual: {} });
  if (!Array.isArray(d.accounts)) d.accounts = [];
  // Migrate the single-account shape this used to have.
  if (d.tokens) {
    d.accounts.push({ id: d.account_email || 'google', tokens: d.tokens,
      calendar_list: d.calendar_list || [], calendars: d.calendars || null });
    delete d.tokens; delete d.calendars; delete d.calendar_list;
    await setJSON('gcal', d);
  }
  return d;
}

async function tok(acct) {
  if (!acct || !acct.tokens) throw new Error('calendar not connected — visit /gcal/auth');
  if (Date.now() < acct.tokens.expires_at - 60000) return acct.tokens.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: acct.tokens.refresh_token,
      client_id: CID, client_secret: SEC }) });
  const j = await r.json();
  if (!j.access_token) {
    acct.auth_error = j.error_description || j.error || 'token refresh failed';
    throw new Error('google token refresh failed for ' + acct.id + ': ' + acct.auth_error);
  }
  acct.tokens.access_token = j.access_token;
  acct.tokens.expires_at = Date.now() + j.expires_in * 1000;
  acct.auth_error = null;
  return j.access_token;
}

// Every calendar the account can read — the coaching schedule lives on its own
// ("16 ECNL"), not on primary, so syncing primary alone misses half the day.
async function calendarList(t) {
  const u = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
  u.searchParams.set('minAccessRole', 'reader');
  u.searchParams.set('maxResults', '250');
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json();
  if (j.error) throw new Error('google: ' + j.error.message);
  return (j.items || []).map(c => ({ id: c.id, name: c.summary || c.id, primary: !!c.primary }));
}

// Which calendars feed the day. null = auto (everything readable except the
// noise ones); an explicit list of ids overrides, set via POST /gcal/calendars.
function chooseCalendars(all, picked) {
  if (picked && picked.length) return all.filter(c => picked.includes(c.id));
  return all.filter(c => c.primary || !CAL_SKIP.test(c.name));
}

async function eventsFrom(t, cal, timeMin, timeMax) {
  const u = new URL('https://www.googleapis.com/calendar/v3/calendars/'
    + encodeURIComponent(cal.id) + '/events');
  u.searchParams.set('timeMin', timeMin.toISOString());
  u.searchParams.set('timeMax', timeMax.toISOString());
  u.searchParams.set('singleEvents', 'true');
  u.searchParams.set('orderBy', 'startTime');
  u.searchParams.set('maxResults', '250');
  const r = await fetch(u, { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json();
  // One unreadable calendar must not sink the whole sync.
  if (j.error) return [];
  return j.items || [];
}

async function sync() {
  const d = await db();
  if (!d.accounts.length) throw new Error('calendar not connected — visit /gcal/auth');
  // Reach back a week as well as forward: the day page can step back to
  // yesterday, and a sync window starting at midnight today would make every
  // past day look empty rather than unsynced.
  const timeMin = new Date(); timeMin.setHours(0, 0, 0, 0); timeMin.setDate(timeMin.getDate() - 7);
  const timeMax = new Date(); timeMax.setHours(0, 0, 0, 0); timeMax.setDate(timeMax.getDate() + 15);
  const collected = [];
  let anyOk = false;
  for (const acct of d.accounts) {
    // One account failing (revoked access, a school domain pulling the plug)
    // must not empty the day of everything the others hold.
    try {
      const t = await tok(acct);
      const all = await calendarList(t);
      acct.calendar_list = all;
      // An account migrated from the old single-account store has no email on
      // it. Adopt the real one from its primary calendar so the UI and
      // /gcal/disconnect can name it.
      if (!String(acct.id).includes('@')) {
        const primary = all.find(c => c.primary);
        if (primary) acct.id = primary.id;
      }
      for (const cal of chooseCalendars(all, acct.calendars)) {
        const calDefault = cal.primary ? null : calendarCategory(cal.name);
        for (const e of await eventsFrom(t, cal, timeMin, timeMax)) {
          if (e.status === 'cancelled' || !e.start) continue;
          collected.push({
            summary: e.summary || '(untitled)',
            start: e.start.dateTime || e.start.date,
            end: (e.end && (e.end.dateTime || e.end.date)) || e.start.dateTime || e.start.date,
            allDay: !e.start.dateTime,
            location: e.location || null,
            calendar: cal.name,
            account: acct.id,
            source: calDefault === 'coaching' ? 'coaching' : 'calendar',
            category: classify(e.summary, d.manual, calDefault)
          });
        }
      }
      acct.synced_at = new Date().toISOString();
      anyOk = true;
    } catch (e) {
      acct.auth_error = acct.auth_error || e.message;
      console.error('[gcal]', acct.id, e.message);
    }
  }
  if (!anyOk) { await setJSON('gcal', d); throw new Error('no Google account could be synced'); }
  collected.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  d.events = collected;
  d.synced_at = new Date().toISOString();
  await setJSON('gcal', d);
  return d;
}

// The account's own email is the id of its primary calendar — no extra scope
// needed to find out which account just connected.
async function accountEmail(t) {
  const all = await calendarList(t).catch(() => []);
  const primary = all.find(c => c.primary);
  return primary ? primary.id : null;
}

// ---- availability math (pure, testable) ------------------------------
function dayEventsFor(events, dateStr) {
  return events.filter(e => {
    if (e.allDay) return e.start <= dateStr && dateStr < e.end;
    return tz.keyOf(new Date(e.start)) === dateStr;
  });
}

// extraBusy: [[startMin, endMin], …] from sources outside Google — classes,
// mainly. They occupy the day just as hard as a calendar event does.
function windowsForDate(events, dateStr, extraBusy) {
  const dayEvents = dayEventsFor(events, dateStr).filter(e => BLOCKS.has(e.category));

  // an all-day travel/busy event blocks the whole day
  if (dayEvents.some(e => e.allDay)) {
    return { windows: [], available_min: 0, travel: dayEvents.some(e => e.category === 'travel') };
  }
  const busy = dayEvents.map(e => [tz.minutesOf(new Date(e.start)), tz.minutesOf(new Date(e.end))])
    .concat(extraBusy || []).sort((a, b) => a[0] - b[0]);

  const windows = [];
  let cursor = DAY_START;
  for (const [s, e] of busy) {
    if (s - cursor >= MIN_WINDOW) windows.push([cursor, Math.min(s, DAY_END)]);
    cursor = Math.max(cursor, e);
    if (cursor >= DAY_END) break;
  }
  if (DAY_END - cursor >= MIN_WINDOW) windows.push([cursor, DAY_END]);

  return {
    windows: windows.map(([s, e]) => ({
      from: fmtMin(s), to: fmtMin(e), minutes: e - s, start_min: s, end_min: e,
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

// ---- the schedule (what the day actually looks like, hour by hour) ----
// Availability answers "when is Harry free"; this answers "what is the day".
// Every event is returned, blocking or not, in clock order — the front page
// renders it as one timeline per day, starting with today.
function scheduleForDate(events, dateStr) {
  const all = dayEventsFor(events, dateStr);
  const allDay = all.filter(e => e.allDay).map(e => ({
    summary: e.summary, category: e.category, allDay: true,
    source: e.source || 'calendar', calendar: e.calendar || null, location: e.location || null
  }));
  const timed = all.filter(e => !e.allDay).map(e => {
    const sm = tz.minutesOf(new Date(e.start)), em = tz.minutesOf(new Date(e.end));
    return {
      summary: e.summary, category: e.category, allDay: false,
      source: e.source || 'calendar', calendar: e.calendar || null, location: e.location || null,
      from: fmtMin(sm), to: fmtMin(em), start_min: sm, end_min: em,
      minutes: Math.max(0, em - sm), blocking: BLOCKS.has(e.category)
    };
  }).sort((a, b) => a.start_min - b.start_min);
  return { all_day: allDay, events: timed };
}

// One day, every source: Google calendars (life + coaching), the teaching
// timetable, and the planned work from intervals.icu.
// back: days before today to include, so the page can step back to yesterday.
// Day 0 of the returned array is (today - back).
function scheduleDays(events, n, plannedByDate, back) {
  const { classesForDate } = require('./classes');
  const today = tz.todayKey();
  const days = [];
  const first = -(back || 0);
  for (let i = first; i < first + n; i++) {
    const key = tz.shiftKey(today, i);
    const classes = classesForDate(key);
    const day = windowsForDate(events, key, classes.map(c => [c.start_min, c.end_min]));
    const base = scheduleForDate(events, key);
    const planned = (plannedByDate && plannedByDate[key]) || [];
    days.push({
      date: key,
      dow: tz.dowOf(key),
      label: tz.labelOf(key),
      today: key === today,
      events: base.events.concat(classes, planned.filter(p => !p.allDay))
        .sort((a, b) => a.start_min - b.start_min),
      all_day: base.all_day.concat(planned.filter(p => p.allDay)),
      windows: day.windows, available_min: day.available_min, travel: day.travel
    });
  }
  return days;
}

// weekly availability + recommended volume
function weekAvailability(events, recovery) {
  const days = [];
  let totalMin = 0;
  for (let i = 0; i < 7; i++) {
    const key = tz.shiftKey(tz.todayKey(), i);
    const day = windowsForDate(events, key);
    totalMin += day.available_min;
    days.push({ date: key, dow: tz.dowOf(key), ...day });
  }
  const availableH = Math.round(totalMin / 6) / 10;
  // realistic trainable share of raw free time, modulated by recovery
  const mod = recovery == null ? 0.55 : recovery >= 67 ? 0.6 : recovery >= 34 ? 0.45 : 0.3;
  return { days, available_h: availableH,
    recommended_h: Math.round(availableH * mod * 10) / 10,
    reason: recovery == null ? 'no recovery data — conservative share of free time'
      : recovery >= 67 ? 'recovery green' : recovery >= 34 ? 'recovery yellow — trimmed' : 'recovery red — minimal' };
}

async function connected() { return (await db()).accounts.length > 0; }
async function trainingHours(recovery) {
  const d = await db();
  if (!d.accounts.length || !d.events.length) return null;
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
    // ?email= preselects the account in Google's chooser. The schedule lives on
    // a specific account, and signing in with the wrong one silently connects
    // an empty calendar.
    if (req.query.email) u.searchParams.set('login_hint', String(req.query.email));
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
      const email = await accountEmail(j.access_token);
      const id = email || ('account-' + (d.accounts.length + 1));
      const existing = d.accounts.find(a => a.id === id);
      const tokens = { access_token: j.access_token,
        // Google only returns a refresh token on first consent for an account;
        // reconnecting must not wipe the one already held.
        refresh_token: j.refresh_token || (existing && existing.tokens && existing.tokens.refresh_token),
        expires_at: Date.now() + j.expires_in * 1000 };
      if (existing) { existing.tokens = tokens; existing.auth_error = null; }
      else d.accounts.push({ id, tokens, calendar_list: [], calendars: null });
      await setJSON('gcal', d);
      const after = await sync().catch(() => null);
      const cals = ((after || d).accounts.find(a => a.id === id) || {}).calendar_list || [];
      res.send(`Connected ${id} (read-only). ${cals.length} calendar(s): `
        + cals.map(c => c.name).join(', ')
        + `. ${d.accounts.length} account(s) now feeding the day. You can close this tab.`);
    } catch (e) { res.status(500).send('Calendar auth failed: ' + e.message); }
  });
  app.get('/gcal/status', async (req, res) => { if (!auth(req, res)) return;
    const d = await db();
    res.json({ connected: d.accounts.length > 0, events: d.events.length, synced_at: d.synced_at,
      accounts: d.accounts.map(a => ({ id: a.id, calendars: (a.calendar_list || []).map(c => c.name),
        synced_at: a.synced_at || null, auth_error: a.auth_error || null })) }); });
  app.get('/gcal/disconnect', async (req, res) => { if (!auth(req, res)) return;
    const id = req.query.account;
    if (!id) return res.status(400).json({ error: 'account required' });
    const d = await db();
    const before = d.accounts.length;
    d.accounts = d.accounts.filter(a => a.id !== id);
    d.events = d.events.filter(e => e.account !== id);
    await setJSON('gcal', d);
    res.json({ ok: true, removed: before - d.accounts.length, accounts: d.accounts.map(a => a.id) }); });
  app.get('/availability', async (req, res) => { if (!auth(req, res)) return;
    try {
      const d = await sync().catch(async () => await db());
      if (!d.accounts.length) return res.json({ connected: false });
      const { sleepLatest } = require('./whoop');
      const s = await sleepLatest({ sync: false }).catch(() => null);
      const rec = s && s.recovery ? s.recovery.score : null;
      res.json({ connected: true, ...weekAvailability(d.events, rec) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  // The front page: N days of real schedule, day 0 = today. Answers with the
  // day skeleton even when Google isn't connected, so the page still renders.
  app.get('/schedule', async (req, res) => { if (!auth(req, res)) return;
    try {
      const n = Math.min(21, Math.max(1, parseInt(req.query.days, 10) || 7));
      const back = Math.min(7, Math.max(0, parseInt(req.query.back, 10) || 0));
      const d = await sync().catch(async () => await db());
      const firstKey = tz.shiftKey(tz.todayKey(), -back);
      const lastKey = tz.shiftKey(tz.todayKey(), n - back - 1);
      const intervals = require('./intervals');
      const classes = require('./classes');
      // A dead source dims one lane of the day; it never blanks the page.
      const iv = await intervals.plannedRange(firstKey, lastKey)
        .catch(e => ({ configured: intervals.configured(), days: {}, error: e.message }));
      // iCal feeds sit alongside the OAuth accounts — same day, same shape.
      const icsMod = require('./ics');
      const ics = await icsMod.fetchAll(firstKey, lastKey)
        .catch(e => ({ configured: icsMod.configured(), events: [], feeds: [], error: e.message }));
      const icsEvents = (ics.events || []).map(e => {
        const calDefault = calendarCategory(e.calendar);
        return { ...e, source: calDefault === 'coaching' ? 'coaching' : 'calendar',
          account: 'ical:' + e.calendar,
          category: classify(e.summary, d.manual, calDefault) };
      });
      const days = scheduleDays((d.events || []).concat(icsEvents), n, iv.days, back);
      // Hexis macros, posted each morning by the Chrome run.
      const macros = await require('./macros').forDates(days.map(x => x.date)).catch(() => ({}));
      for (const day of days) day.macros = macros[day.date] || null;
      const sources = {
        calendars: d.accounts.flatMap(a => (a.calendar_list || []).map(c => c.name))
          .concat((ics.feeds || []).filter(f => f.ok).map(f => f.name)),
        ical_feeds: (ics.feeds || []),
        ical_errors: (ics.feeds || []).filter(f => !f.ok).map(f => f.name + ': ' + f.error),
        accounts: d.accounts.map(a => a.id),
        account_errors: d.accounts.filter(a => a.auth_error).map(a => a.id + ': ' + a.auth_error),
        calendar_connected: d.accounts.length > 0,
        classes_configured: classes.configured(),
        intervals_configured: !!iv.configured,
        intervals_error: iv.error || null,
        macros_today: !!((days.find(x => x.today) || {}).macros)
      };
      const todayIdx0 = Math.max(0, days.findIndex(x => x.today));
      sources.calendar_connected = d.accounts.length > 0 || icsEvents.length > 0 || icsMod.configured();
      if (!d.accounts.length && !icsMod.configured()) {
        return res.json({ connected: false, days, sources, today_index: todayIdx0 });
      }
      if (!d.accounts.length) {
        // feeds only, no OAuth account: still a real day
        const { sleepLatest } = require('./whoop');
        const { weekState } = require('./race');
        const s0 = await sleepLatest({ sync: false }).catch(() => null);
        const w0 = await weekState().catch(() => null);
        const macros0 = await require('./macros').forDates(days.map(x => x.date)).catch(() => ({}));
        for (const day of days) day.macros = macros0[day.date] || null;
        return res.json({ connected: true, synced_at: null, days, sources, today_index: todayIdx0,
          ...recommendToday(days[todayIdx0], s0 && s0.recovery ? s0.recovery.score : null,
            w0 ? w0.remaining : null) });
      }
      const { sleepLatest } = require('./whoop');
      const { weekState } = require('./race');
      const s = await sleepLatest({ sync: false }).catch(() => null);
      const w = await weekState().catch(() => null);
      const rec = s && s.recovery ? s.recovery.score : null;
      res.json({ connected: true, synced_at: d.synced_at, days, sources,
        today_index: todayIdx0,
        ...recommendToday(days[todayIdx0], rec, w ? w.remaining : null) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  // Which Google calendars feed the day (the coaching one included).
  app.get('/gcal/calendars', async (req, res) => { if (!auth(req, res)) return;
    try {
      const d = await db();
      if (!d.accounts.length) return res.json({ connected: false, calendars: [] });
      const out = [];
      for (const acct of d.accounts) {
        try {
          const all = await calendarList(await tok(acct));
          acct.calendar_list = all;
          const on = chooseCalendars(all, acct.calendars).map(c => c.id);
          out.push(...all.map(c => ({ ...c, account: acct.id, on: on.includes(c.id) })));
        } catch (e) { out.push({ account: acct.id, error: e.message }); }
      }
      await setJSON('gcal', d);
      res.json({ connected: true, accounts: d.accounts.map(a => ({ id: a.id, picked: a.calendars || null })),
        calendars: out });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/gcal/calendars', async (req, res) => { if (!auth(req, res)) return;
    try {
      const ids = (req.body && req.body.calendars) || null;
      const acctId = req.body && req.body.account;
      const d = await db();
      const targets = acctId ? d.accounts.filter(a => a.id === acctId) : d.accounts;
      if (!targets.length) return res.status(404).json({ error: 'no such account' });
      for (const a of targets) a.calendars = Array.isArray(ids) && ids.length ? ids : null;  // null = auto
      await setJSON('gcal', d);
      await sync().catch(() => {});
      res.json({ ok: true, accounts: targets.map(a => ({ id: a.id, picked: a.calendars })) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/availability/today', async (req, res) => { if (!auth(req, res)) return;
    try {
      const d = await sync().catch(async () => await db());
      if (!d.accounts.length) return res.json({ connected: false });
      const key = tz.todayKey();
      const day = windowsForDate(d.events, key);
      const { sleepLatest } = require('./whoop');
      const { weekState } = require('./race');
      const s = await sleepLatest({ sync: false }).catch(() => null);
      const w = await weekState().catch(() => null);
      const rec = s && s.recovery ? s.recovery.score : null;
      res.json({ connected: true, ...day,
        ...recommendToday(day, rec, w ? w.remaining : null) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, classify, windowsForDate, weekAvailability, recommendToday,
  trainingHours, connected, scheduleForDate, scheduleDays, dateKey };
