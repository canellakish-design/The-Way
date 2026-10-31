// ============================================================
// calendar.js — Training Availability Engine (Google Calendar)
// The calendar answers WHEN Harry can train; the training engine
// answers WHAT to do with those windows. Read-only scope.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const crypto = require('crypto');
// Credentials pasted into a hosting dashboard pick up stray whitespace,
// newlines and sometimes the quotes around them. Providers then reject the
// value with a message about the credential being invalid, which sends you
// looking at the wrong thing.
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
// The Google OAuth client: from Netlify's environment, or pasted into the
// app's Setup page once (stored in the site's own storage). Either works.
let CID = envStr('GOOGLE_CLIENT_ID');
let SEC = envStr('GOOGLE_CLIENT_SECRET');
async function creds() {
  if (CID && SEC) return { id: CID, secret: SEC, from: process.env.GOOGLE_CLIENT_ID ? 'netlify' : 'setup' };
  const c = await getJSON('gcal-config', null);
  if (c && c.client_id && c.client_secret) { CID = c.client_id; SEC = c.client_secret; return { id: CID, secret: SEC, from: 'setup' }; }
  return null;
}
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
  await creds();
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
            description: e.description ? String(e.description).slice(0, 1200) : null,
            calendar: cal.name, calendar_id: cal.id, gid: e.id,
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

// One target per day on the page, computed from that day's sessions. Days are
// independent, so they run together; a failure leaves that day without a row
// rather than taking the page down.
async function attachMacros(days) {
  const { guidelinesFor } = require('./food');
  await Promise.all(days.map(async day => {
    try { const g = await guidelinesFor(day.date); day.macros = Object.assign({ source: 'the way' }, g.target); }
    catch (e) { day.macros = null; }
  }));
}

// One line under the day: what the body and the calendar say about the
// session planned. The plan has three workouts (Zone 1 under 117 bpm, the
// VO2 40/20s, mountain-bike handling); recovery is WHOOP's band.
function recommendToday(day, recovery, remaining) {
  const rec = recovery == null ? null : (recovery >= 67 ? 'green' : recovery >= 34 ? 'yellow' : 'red');
  const best = day.windows.reduce((a, w) => Math.max(a, w.minutes), 0);
  const planned = (day.events || []).filter(e => e.source === 'plan' || e.source === 'intervals');
  const hard = planned.find(e => /vo2|40\s*\/\s*20|threshold|race/i.test(e.summary || ''));
  const names = planned.map(e => e.summary).join(' + ');
  let what;
  if (day.travel) what = 'travel day: rest, or a spin if one fits';
  else if (rec === 'red') what = planned.length ? `recovery red: skip ${names}, easy spin or off` : 'recovery red: off';
  else if (rec === 'yellow') what = hard ? `recovery yellow: Zone 1 under 117 instead of ${hard.summary}` : planned.length ? `recovery yellow: ${names}, keep it under 117` : 'recovery yellow: Zone 1 under 117 if you ride';
  else if (planned.length) what = `train as planned: ${names}`;
  else if (best >= 45) what = 'nothing planned: Zone 1 under 117 if you ride';
  else what = 'rest day: no window';
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
    source: e.source || 'calendar', calendar: e.calendar || null, location: e.location || null, description: e.description || null, local_id: e.id && String(e.id).startsWith('ev_') ? e.id : null,
    edit: editKey(e)
  }));
  const timed = all.filter(e => !e.allDay).map(e => {
    const sm = tz.minutesOf(new Date(e.start)), em = tz.minutesOf(new Date(e.end));
    return {
      summary: e.summary, category: e.category, allDay: false,
      source: e.source || 'calendar', calendar: e.calendar || null, location: e.location || null, description: e.description || null, workout_id: e.workout_id || null, local_id: e.id && String(e.id).startsWith('ev_') ? e.id : null, google_id: e.google_id || null,
      edit: editKey(e),
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

// ---- events added in the app ----
// Stored here first, so the day shows them at once; pushed to the primary
// Google calendar when an account with write access is connected. Until
// then they wait, and the next push after connecting sends them all.
async function pushLocal(d) {
  const acct = d.accounts.find(a => a.tokens && !a.auth_error);
  if (!acct) return 0;
  let n = 0;
  for (const e of d.local_events || []) {
    if (e.google_id) continue;
    try {
      const t = await tok(acct);
      const body = e.allDay ? { summary: e.summary, description: e.description || undefined, location: e.location || undefined, start: { date: e.start.slice(0, 10) }, end: { date: e.end.slice(0, 10) } }
        : { summary: e.summary, description: e.description || undefined, location: e.location || undefined, start: { dateTime: e.start, timeZone: tz.ZONE }, end: { dateTime: e.end, timeZone: tz.ZONE } };
      const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.ok && j.id) { e.google_id = j.id; e.pushed_at = new Date().toISOString(); n++; }
      else e.push_error = (j.error && j.error.message) || ('google ' + r.status);
    } catch (err) { e.push_error = err.message; }
  }
  if (n) await setJSON('gcal', d);
  return n;
}
async function addEvent(b) {
  const title = String(b.title || '').trim().slice(0, 120);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : tz.todayKey();
  if (!title) { const e = new Error('a title is needed'); e.status = 400; throw e; }
  const d = await db();
  d.local_events = d.local_events || [];
  const allDay = !/^\d{2}:\d{2}$/.test(b.start || '');
  let ev;
  if (allDay) ev = { summary: title, start: date, end: tz.shiftKey(date, 1), allDay: true };
  else {
    const [h, m] = b.start.split(':').map(Number);
    const mins = Number(b.minutes) > 0 ? Number(b.minutes) : (/^\d{2}:\d{2}$/.test(b.end || '') ? ((+b.end.slice(0, 2)) * 60 + (+b.end.slice(3, 5))) - (h * 60 + m) : 60);
    const s = tz.zonedToUTC(...date.split('-').map(Number), h, m);
    const e2 = new Date(s.getTime() + Math.max(15, mins) * 60000);
    ev = { summary: title, start: s.toISOString(), end: e2.toISOString(), allDay: false };
  }
  ev.id = 'ev_' + crypto.randomBytes(5).toString('hex');
  ev.description = b.notes ? String(b.notes).slice(0, 1000) : null;
  ev.location = b.location ? String(b.location).slice(0, 200) : null;
  ev.created = new Date().toISOString();
  d.local_events.push(ev);
  await setJSON('gcal', d);
  const pushed = await pushLocal(d);
  return { ok: true, event: ev, pushed_to_google: !!ev.google_id, google_connected: d.accounts.some(a => a.tokens), pushed };
}
// ---- editing any event ----
// Every event has an edit key: a Google event is "g:<calendar id>:<event id>"
// and is changed on Google itself; one added here is "l:<id>"; a snapshot or
// feed event has no handle on Google, so its edit is kept as an override in
// the app ("o:<uid>") and shown here until the live calendar takes over.
function editKey(e) {
  if (e.gid && e.calendar_id) return 'g:' + e.calendar_id + ':' + e.gid;
  if (e.id && String(e.id).startsWith('ev_')) return 'l:' + e.id;
  if (e.uid) return 'o:' + e.uid;
  return null;
}
function applyOverrides(events, overrides) {
  if (!overrides || !Object.keys(overrides).length) return events;
  const out = [];
  for (const e of events) {
    const k = editKey(e); const o = k && overrides[k];
    if (!o) { out.push(e); continue; }
    if (o.deleted) continue;
    out.push(Object.assign({}, e, o.fields || {}));
  }
  return out;
}
function fieldsFrom(b, base) {
  const f = {};
  if (b.title != null) f.summary = String(b.title).trim().slice(0, 120) || base.summary;
  if (b.notes != null) f.description = String(b.notes).slice(0, 1000) || null;
  if (b.location != null) f.location = String(b.location).slice(0, 200) || null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : String(base.start).slice(0, 10);
  if (b.start === '' || (b.start == null && base.allDay && !b.end)) { f.allDay = true; f.start = date; f.end = tz.shiftKey(date, 1); }
  else if (/^\d{2}:\d{2}$/.test(b.start || '')) {
    const [h, m] = b.start.split(':').map(Number);
    const s = tz.zonedToUTC(...date.split('-').map(Number), h, m);
    let mins = Number(b.minutes) > 0 ? Number(b.minutes) : null;
    if (!mins && /^\d{2}:\d{2}$/.test(b.end || '')) mins = ((+b.end.slice(0, 2)) * 60 + (+b.end.slice(3, 5))) - (h * 60 + m);
    if (!mins && !base.allDay) mins = Math.round((new Date(base.end) - new Date(base.start)) / 60000);
    const e2 = new Date(s.getTime() + Math.max(15, mins || 60) * 60000);
    f.allDay = false; f.start = s.toISOString(); f.end = e2.toISOString();
  }
  return f;
}
function googleBody(f) {
  const body = {};
  if (f.summary != null) body.summary = f.summary;
  if (f.description !== undefined) body.description = f.description || '';
  if (f.location !== undefined) body.location = f.location || '';
  if (f.start) body.start = f.allDay ? { date: f.start.slice(0, 10) } : { dateTime: f.start, timeZone: tz.ZONE };
  if (f.end) body.end = f.allDay ? { date: f.end.slice(0, 10) } : { dateTime: f.end, timeZone: tz.ZONE };
  return body;
}
async function editEvent(key, b) {
  const d = await db();
  if (key.startsWith('l:')) {
    const id = key.slice(2);
    const ev = (d.local_events || []).find(e => e.id === id);
    if (!ev) return null;
    Object.assign(ev, fieldsFrom(b, ev));
    if (ev.google_id) {
      const acct = d.accounts.find(a => a.tokens);
      if (acct) { try { const t = await tok(acct); await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev.google_id)}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(googleBody(ev)) }); } catch (e) { ev.push_error = e.message; } }
    }
    await setJSON('gcal', d);
    return { ok: true, where: ev.google_id ? 'google' : 'app' };
  }
  if (key.startsWith('g:')) {
    const [, calId, gid] = key.match(/^g:(.*):([^:]+)$/) || [];
    const base = (d.events || []).find(e => e.gid === gid) || {};
    const f = fieldsFrom(b, base);
    const acct = d.accounts.find(a => a.id === base.account && a.tokens) || d.accounts.find(a => a.tokens);
    if (!acct) { const err = new Error('Google is not connected'); err.status = 400; throw err; }
    const t = await tok(acct);
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(googleBody(f)) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const err = new Error('google: ' + ((j.error && j.error.message) || r.status)); err.status = 502; throw err; }
    if (base.gid) Object.assign(base, f);
    await setJSON('gcal', d);
    return { ok: true, where: 'google' };
  }
  if (key.startsWith('o:')) {
    d.overrides = d.overrides || {};
    const cur = d.overrides[key] || { fields: {} };
    const base = Object.assign({ summary: b.title || '', start: b.date, end: b.date, allDay: b.start === '' }, cur.fields || {});
    cur.fields = Object.assign(cur.fields || {}, fieldsFrom(b, base));
    cur.at = new Date().toISOString();
    d.overrides[key] = cur;
    await setJSON('gcal', d);
    return { ok: true, where: 'app', note: 'This event comes from the calendar copy, not a live Google connection, so the change lives in the app until Google is connected.' };
  }
  return null;
}
async function deleteAny(key) {
  const d = await db();
  if (key.startsWith('l:')) return removeEvent(key.slice(2));
  if (key.startsWith('g:')) {
    const [, calId, gid] = key.match(/^g:(.*):([^:]+)$/) || [];
    const base = (d.events || []).find(e => e.gid === gid) || {};
    const acct = d.accounts.find(a => a.id === base.account && a.tokens) || d.accounts.find(a => a.tokens);
    if (!acct) { const err = new Error('Google is not connected'); err.status = 400; throw err; }
    const t = await tok(acct);
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(gid)}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } });
    if (!r.ok && r.status !== 410 && r.status !== 404) { const err = new Error('google ' + r.status); err.status = 502; throw err; }
    d.events = (d.events || []).filter(e => e.gid !== gid);
    await setJSON('gcal', d);
    return true;
  }
  if (key.startsWith('o:')) {
    d.overrides = d.overrides || {};
    d.overrides[key] = { deleted: true, at: new Date().toISOString() };
    await setJSON('gcal', d);
    return true;
  }
  return false;
}
async function removeEvent(id) {
  const d = await db();
  const ev = (d.local_events || []).find(e => e.id === id);
  if (!ev) return false;
  if (ev.google_id) {
    const acct = d.accounts.find(a => a.tokens);
    if (acct) { try { const t = await tok(acct); await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(ev.google_id)}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + t } }); } catch (e) { /* it stays on Google; the app forgets it */ } }
  }
  d.local_events = d.local_events.filter(e => e.id !== id);
  await setJSON('gcal', d);
  return true;
}

// The schedule for n days from today (back days before): every event with its
// edit key, the planned sessions, the day's macros. The route and the voice both use it.
async function scheduleReport(q) {
      const n = Math.min(21, Math.max(1, parseInt(q.days, 10) || 7));
      const back = Math.min(7, Math.max(0, parseInt(q.back, 10) || 0));
      const d = await sync().catch(async () => await db());
      const firstKey = tz.shiftKey(tz.todayKey(), -back);
      const lastKey = tz.shiftKey(tz.todayKey(), n - back - 1);
      const intervals = require('./intervals');
      const classes = require('./classes');
      // A dead source dims one lane of the day; it never blanks the page.
      const iv = await intervals.plannedRange(firstKey, lastKey)
        .catch(e => ({ configured: intervals.configured(), days: {}, error: e.message }));
      // The plan's own workouts, merged in. One that was sent to the Garmin
      // comes back from intervals.icu as well, so the same session on the same
      // day at the same time is shown once, as the plan's copy (it links to
      // the builder).
      try {
        const own = await require('./workouts').plannedDays(firstKey, lastKey);
        for (const [k, list] of Object.entries(own)) {
          const have = iv.days[k] || [];
          const dup = p => have.some(e => (e.start_min ?? -1) === (p.start_min ?? -1)
            && String(e.summary || '').trim().toLowerCase() === String(p.summary || '').trim().toLowerCase());
          iv.days[k] = have.filter(e => !list.some(p => (p.start_min ?? -1) === (e.start_min ?? -1)
              && String(e.summary || '').trim().toLowerCase() === String(p.summary || '').trim().toLowerCase()))
            .concat(list);
          iv.days[k].sort((a, b) => (a.start_min ?? 1e6) - (b.start_min ?? 1e6));
        }
      } catch (e) { /* no plan store yet: the intervals.icu lane stands alone */ }
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
      // The written-down copy of the calendar fills only the days no live
      // source reached. See snapshot.js for why it exists and how it retires.
      const snapshot = require('./snapshot');
      // Events added in the app: on the day at once, whether or not they have reached Google yet.
      const localEvents = (d.local_events || []).map(e => ({ ...e, source: 'calendar', account: 'the way', category: classify(e.summary, d.manual, null) }));
      const liveEvents = applyOverrides((d.events || []).concat(icsEvents, localEvents), d.overrides);
      const covered = new Set(liveEvents.map(e => String(e.start || e.date).slice(0, 10)));
      const snapEvents = snapshot.eventsInRange(firstKey, lastKey, covered).map(e => {
        const calDefault = calendarCategory(e.calendar);
        return { ...e, source: calDefault === 'coaching' ? 'coaching' : 'calendar',
          account: 'snapshot:' + e.calendar,
          category: classify(e.summary, d.manual, calDefault) };
      });
      const days = scheduleDays(liveEvents.concat(applyOverrides(snapEvents, d.overrides)), n, iv.days, back);
      // The supplements, as rows tied to the day's rides: beetroot before the
      // first ride, bicarbonate before a hard one, magnesium in the evening.
      // Derived, never stored, so they follow a ride that moves and never
      // double up. Today's rows know whether the dose is already logged.
      try {
        const S = require('./supps');
        const todayKey = tz.todayKey();
        let todayEntries = [], yEntries = [];
        try { const { getJSON } = require('./storage'); todayEntries = ((await getJSON('food-' + todayKey, null)) || {}).entries || []; yEntries = ((await getJSON('food-' + tz.shiftKey(todayKey, -1), null)) || {}).entries || []; } catch (e) { /* no journal */ }
        for (const day of days) {
          const rides = (day.events || []).filter(e => e.category === 'training' && e.kind === 'ride' && e.start_min != null)
            .map(e => ({ name: e.summary, time: S.toHM(e.start_min), sport: 'Ride', done: false }));
          const r = S.dueFor(day.date, rides, day.today ? todayEntries : [], null, day.today ? yEntries : []);
          for (const x of r.due) {
            if (!x.time || x.key === 'creatine') continue;                          // creatine is any time: it lives under the Lift box
            const sm = S.toMin(x.time); if (sm == null || sm < 5 * 60) continue;
            day.events.push({ summary: x.name, detail: x.why, category: 'supplement', source: 'rx', kind: 'supplement', calendar: 'The Way', allDay: false, blocking: false,
              minutes: 10, start_min: sm, end_min: sm + 10, from: fmtMin(sm), to: fmtMin(sm + 10), rx_key: x.key, taken: !!x.taken, for_session: x.session || null });
          }
          day.events.sort((a, b) => (a.start_min ?? 1e6) - (b.start_min ?? 1e6));
        }
      } catch (e) { /* the day stands without them */ }
      // The day's fuel targets, from the day's training (food-math.js).
      await attachMacros(days);
      const sources = {
        timezone: tz.ZONE,
        calendars: d.accounts.flatMap(a => (a.calendar_list || []).map(c => c.name))
          .concat((ics.feeds || []).filter(f => f.ok).map(f => f.name)),
        ical_feeds: (ics.feeds || []),
        ical_errors: (ics.feeds || []).filter(f => !f.ok).map(f => f.name + ': ' + f.error),
        accounts: d.accounts.map(a => a.id),
        account_errors: d.accounts.filter(a => a.auth_error).map(a => a.id + ': ' + a.auth_error),
        calendar_connected: d.accounts.length > 0,
        snapshot: snapEvents.length ? { ...snapshot.meta(), used: snapEvents.length } : null,
        classes_configured: classes.configured(),
        intervals_configured: !!iv.configured,
        intervals_error: iv.error || null,
        macros_today: !!((days.find(x => x.today) || {}).macros)
      };
      const todayIdx0 = Math.max(0, days.findIndex(x => x.today));
      sources.calendar_connected = d.accounts.length > 0 || icsEvents.length > 0 || icsMod.configured();
      const icsFeeds = await icsMod.feedsAsync().catch(() => []);
      if (!d.accounts.length && !icsFeeds.length && !snapEvents.length) {
        return ({ connected: false, days, sources, today_index: todayIdx0 });
      }
      if (!d.accounts.length) {
        // Feeds or the snapshot, no OAuth account: still a real day. The page
        // draws the whole thing; sources.snapshot is what tells it the events
        // came from a copy rather than from Google.
        const { sleepLatest } = require('./whoop');
        const { weekState } = require('./race');
        const s0 = await sleepLatest({ sync: false }).catch(() => null);
        const w0 = await weekState().catch(() => null);
        await attachMacros(days);
        return ({ connected: true, synced_at: null, days, sources, today_index: todayIdx0,
          ...recommendToday(days[todayIdx0], s0 && s0.recovery ? s0.recovery.score : null,
            w0 ? w0.remaining : null) });
      }
      const { sleepLatest } = require('./whoop');
      const { weekState } = require('./race');
      const s = await sleepLatest({ sync: false }).catch(() => null);
      const w = await weekState().catch(() => null);
      const rec = s && s.recovery ? s.recovery.score : null;
      return ({ connected: true, synced_at: d.synced_at, days, sources,
        today_index: todayIdx0,
        ...recommendToday(days[todayIdx0], rec, w ? w.remaining : null) });
}

function attach(app) {
  app.post('/gcal/events', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await addEvent(req.body || {})); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  app.delete('/gcal/events/:id', async (req, res) => { if (!auth(req, res)) return;
    try { const ok = await removeEvent(req.params.id); if (!ok) return res.status(404).json({ error: 'no such event' }); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); } });
  app.put('/gcal/event', async (req, res) => { if (!auth(req, res)) return;
    try { const r = await editEvent(String((req.body || {}).key || ''), req.body || {}); if (!r) return res.status(404).json({ error: 'no such event' }); res.json(r); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  app.delete('/gcal/event', async (req, res) => { if (!auth(req, res)) return;
    try { const ok = await deleteAny(String(req.query.key || '')); if (!ok) return res.status(404).json({ error: 'no such event' }); res.json({ ok: true }); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
  app.post('/gcal/events/push', async (req, res) => { if (!auth(req, res)) return;
    try { const d = await db(); res.json({ ok: true, pushed: await pushLocal(d), waiting: (d.local_events || []).filter(e => !e.google_id).length, google_connected: d.accounts.some(a => a.tokens) }); }
    catch (e) { res.status(500).json({ error: e.message }); } });

  // The client id and secret, pasted once on the Setup page.
  app.post('/gcal/config', async (req, res) => { if (!auth(req, res)) return;
    try {
      const id = String((req.body || {}).client_id || '').trim(), secret = String((req.body || {}).client_secret || '').trim();
      if (!/\.apps\.googleusercontent\.com$/.test(id) || secret.length < 10) return res.status(400).json({ error: 'that does not look like a Google OAuth client id and secret' });
      await setJSON('gcal-config', { client_id: id, client_secret: secret, at: new Date().toISOString() });
      CID = id; SEC = secret;
      res.json({ ok: true, redirect_uri: BASE + '/gcal/callback', next: BASE + '/gcal/auth' });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/gcal/config', async (req, res) => { if (!auth(req, res)) return;
    const c = await creds();
    res.json({ configured: !!c, from: c ? c.from : null, client_id: c ? c.id : null, redirect_uri: BASE + '/gcal/callback', auth_url: BASE + '/gcal/auth' }); });

  app.get('/gcal/auth', async (req, res) => {
    if (!(await creds())) return res.status(400).send('Google is not configured yet: paste the OAuth client id and secret on the Setup page first.');
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', CID);
    u.searchParams.set('redirect_uri', BASE + '/gcal/callback');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events');
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
      await creds();
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
    try { res.json(await scheduleReport(req.query || {})); }
    catch (e) { res.status(500).json({ error: e.message }); } });
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
  trainingHours, connected, scheduleForDate, scheduleDays, scheduleReport, dateKey, addEvent, removeEvent, pushLocal, editEvent, deleteAny, editKey };
