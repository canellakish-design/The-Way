// ============================================================
// ics.js — calendars by iCal feed, no OAuth app.
// Google gives every calendar a private "secret address in iCal format".
// Pointing at those needs no Google Cloud project, no client id or secret, no
// consent screen, and no refresh tokens to expire — at the cost of freshness:
// Google refreshes these feeds for outside fetchers on its own schedule, often
// hours behind. calendar.js merges whatever this returns alongside the OAuth
// path, so the two can run together or either alone.
//
// Env: ICS_FEEDS — one feed per line (or comma-separated), each either a bare
// URL or `Name=URL`. The name is what the day labels the calendar; without one
// the feed's own X-WR-CALNAME is used.
//
// The URLs are credentials: anyone holding one can read that calendar. They
// belong in the environment, not in the repo.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const TTL_MS = 15 * 60 * 1000;   // these feeds are hours stale at source anyway

function parseFeedList(raw) {
  if (!raw) return [];
  return String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(entry => {
    const eq = entry.indexOf('=');
    // Only treat '=' as a name separator when it comes before the URL — the
    // URLs themselves contain '=' in query strings.
    if (eq > 0 && !/^https?:/i.test(entry.slice(0, eq))) {
      return { name: entry.slice(0, eq).trim(), url: entry.slice(eq + 1).trim() };
    }
    return { name: null, url: entry };
  }).filter(f => /^https?:\/\//i.test(f.url));
}

// Feeds come from two places: the environment, and feeds added in the app.
// The stored ones matter more — adding a calendar shouldn't mean editing
// hosting configuration and waiting for a redeploy.
let STORED = null;
async function storedFeeds() {
  if (STORED) return STORED;
  STORED = (await getJSON('ics-feeds', { feeds: [] })).feeds || [];
  return STORED;
}
function envFeeds() { return parseFeedList(process.env.ICS_FEEDS); }

// Synchronous view, for the paths that can't await (status rows, config checks).
let CACHED_ALL = null;
function feeds() { return CACHED_ALL || envFeeds(); }
async function feedsAsync() {
  const all = envFeeds().concat(await storedFeeds());
  // last one wins on duplicate URLs
  const seen = new Map();
  for (const f of all) seen.set(f.url, f);
  CACHED_ALL = [...seen.values()];
  return CACHED_ALL;
}
const configured = () => feeds().length > 0;

/* ---------------- parsing ---------------- */

// Unfold: a line beginning with a space or tab continues the one before it.
function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

// "DTSTART;TZID=America/New_York:20260817T060000" ->
//   { name:'DTSTART', params:{TZID:'America/New_York'}, value:'20260817T060000' }
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon), value = line.slice(colon + 1);
  const bits = left.split(';');
  const params = {};
  for (const b of bits.slice(1)) {
    const eq = b.indexOf('=');
    if (eq > 0) params[b.slice(0, eq).toUpperCase()] = b.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: bits[0].toUpperCase(), params, value };
}

const unescape = v => String(v || '')
  .replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

// An ICS date-time in one of three shapes:
//   20260817        date only (all-day)
//   20260817T100000Z UTC
//   20260817T060000  wall clock, in TZID or the feed's zone
function parseDT(prop) {
  const v = String(prop.value || '').trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly || prop.params.VALUE === 'DATE') {
    const m = dateOnly || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    return { allDay: true, key: `${m[1]}-${m[2]}-${m[3]}` };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : tz.zonedToUTC(+y, +mo, +d, +h, +mi, prop.params.TZID || undefined);
  return { allDay: false, date };
}

function parseICS(text) {
  const lines = unfold(text).split('\n');
  const out = { calName: null, events: [] };
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') { cur = { props: {}, exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) out.events.push(cur); cur = null; continue; }
    const p = parseLine(line);
    if (!p) continue;
    if (!cur) { if (p.name === 'X-WR-CALNAME') out.calName = unescape(p.value); continue; }
    if (p.name === 'EXDATE') {
      for (const one of String(p.value).split(',')) {
        const dt = parseDT({ params: p.params, value: one.trim() });
        if (dt) cur.exdates.push(dt.allDay ? dt.key : tz.keyOf(dt.date));
      }
      continue;
    }
    cur.props[p.name] = p;
  }
  return out;
}

/* ---------------- recurrence ----------------
   A teaching timetable and a training schedule are mostly recurring events, so
   a reader that ignored RRULE would show an almost empty week. This covers
   what Google actually emits for weekly/daily/monthly repeats — FREQ, INTERVAL,
   BYDAY, COUNT, UNTIL, EXDATE — and deliberately stops there: anything more
   exotic yields its first occurrence rather than a wrong guess. */
const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(value) {
  const r = {};
  for (const part of String(value).split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) r[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return r;
}

// Expand into the [fromKey, toKey] window. Works in calendar days: the start's
// wall-clock time is reapplied to each occurrence, so a 6am session stays 6am
// across a DST change rather than drifting an hour.
function expand(startKey, rule, fromKey, toKey, exdates) {
  if (!rule) return [startKey];
  const freq = (rule.FREQ || '').toUpperCase();
  const interval = Math.max(1, parseInt(rule.INTERVAL, 10) || 1);
  const count = rule.COUNT ? parseInt(rule.COUNT, 10) : null;
  const untilKey = rule.UNTIL ? String(rule.UNTIL).slice(0, 8).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : null;
  const byday = rule.BYDAY ? rule.BYDAY.split(',').map(d => d.slice(-2).toUpperCase()) : null;
  const out = [];
  const skip = new Set(exdates || []);

  const emit = key => {
    if (untilKey && key > untilKey) return false;
    if (key > toKey) return false;
    if (key >= fromKey && !skip.has(key)) out.push(key);
    return true;
  };

  if (freq === 'DAILY') {
    let key = startKey, n = 0;
    while ((!count || n < count) && key <= toKey) {
      if (untilKey && key > untilKey) break;
      emit(key); n++; key = tz.shiftKey(key, interval);
    }
  } else if (freq === 'WEEKLY') {
    const days = byday || [Object.keys(DAY_CODES).find(k => DAY_CODES[k] === tz.dowIndexOf(startKey))];
    // walk week by week from the start's week
    let weekStart = tz.shiftKey(startKey, -tz.dowIndexOf(startKey));   // back to Sunday
    let n = 0, guard = 0;
    while (guard++ < 500) {
      let past = true;
      for (const code of days) {
        const key = tz.shiftKey(weekStart, DAY_CODES[code]);
        if (key < startKey) continue;
        if (key <= toKey) past = false;
        if (untilKey && key > untilKey) continue;
        if (count && n >= count) continue;
        if (key <= toKey) { emit(key); n++; }
        else past = true;
      }
      if (count && n >= count) break;
      const nextWeek = tz.shiftKey(weekStart, 7 * interval);
      if (nextWeek > toKey) break;
      if (untilKey && nextWeek > untilKey) break;
      weekStart = nextWeek;
    }
  } else if (freq === 'MONTHLY' || freq === 'YEARLY') {
    // same day-of-month (or day-of-year); enough for the occasional standing
    // monthly commitment, and it stops rather than guessing at BYSETPOS
    const [y0, m0, d0] = startKey.split('-').map(Number);
    for (let i = 0, n = 0; i < 60 && (!count || n < count); i++) {
      const mo = freq === 'MONTHLY' ? m0 - 1 + i * interval : m0 - 1;
      const yr = freq === 'MONTHLY' ? y0 : y0 + i * interval;
      const t = new Date(Date.UTC(yr, mo, d0));
      const key = `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
      if (key > toKey) break;
      if (untilKey && key > untilKey) break;
      emit(key); n++;
    }
  } else {
    emit(startKey);
  }
  return out;
}

/* ---------------- feed -> events ---------------- */

function eventsFromFeed(text, feedName, fromKey, toKey) {
  const parsed = parseICS(text);
  const calendar = feedName || parsed.calName || 'calendar';
  const out = [];
  // A modified single occurrence arrives as its own VEVENT with RECURRENCE-ID;
  // the generated instance for that date must give way to it.
  const overrides = new Set();
  for (const ev of parsed.events) {
    if (ev.props['RECURRENCE-ID']) {
      const dt = parseDT(ev.props['RECURRENCE-ID']);
      if (dt) overrides.add((ev.props.UID ? ev.props.UID.value : '') + '@' + (dt.allDay ? dt.key : tz.keyOf(dt.date)));
    }
  }
  for (const ev of parsed.events) {
    const dtstart = ev.props.DTSTART && parseDT(ev.props.DTSTART);
    if (!dtstart) continue;
    const dtend = ev.props.DTEND && parseDT(ev.props.DTEND);
    const summary = unescape(ev.props.SUMMARY && ev.props.SUMMARY.value) || '(untitled)';
    const location = unescape(ev.props.LOCATION && ev.props.LOCATION.value) || null;
    const status = ev.props.STATUS && String(ev.props.STATUS.value).toUpperCase();
    if (status === 'CANCELLED') continue;
    const uid = ev.props.UID ? ev.props.UID.value : summary;
    const rule = ev.props.RRULE ? parseRule(ev.props.RRULE.value) : null;
    const isOverride = !!ev.props['RECURRENCE-ID'];

    if (dtstart.allDay) {
      const endKey = dtend && dtend.allDay ? dtend.key : tz.shiftKey(dtstart.key, 1);
      for (const key of (isOverride ? [dtstart.key] : expand(dtstart.key, rule, fromKey, toKey, ev.exdates))) {
        if (!isOverride && rule && overrides.has(uid + '@' + key)) continue;
        const span = Math.max(1, Math.round((Date.parse(endKey) - Date.parse(dtstart.key)) / 864e5));
        out.push({ summary, location, calendar, allDay: true,
          start: key, end: tz.shiftKey(key, span), uid });
      }
      continue;
    }

    const p = tz.parts(dtstart.date);
    const durMs = dtend && dtend.date ? (dtend.date - dtstart.date) : 60 * 60000;
    const startKey = tz.keyOf(dtstart.date);
    for (const key of (isOverride ? [startKey] : expand(startKey, rule, fromKey, toKey, ev.exdates))) {
      if (!isOverride && rule && overrides.has(uid + '@' + key)) continue;
      const [y, mo, d] = key.split('-').map(Number);
      // reapply the original wall-clock time on the occurrence's own date
      const start = tz.zonedToUTC(y, mo, d, p.h, p.mi);
      out.push({ summary, location, calendar, allDay: false,
        start: start.toISOString(), end: new Date(start.getTime() + durMs).toISOString(), uid });
    }
  }
  return out;
}

/* ---------------- fetch + cache ---------------- */

async function fetchAll(fromKey, toKey, force) {
  const list = await feedsAsync();
  if (!list.length) return { configured: false, events: [], feeds: [] };
  const cache = await getJSON('ics-cache', null);
  if (!force && cache && cache.from === fromKey && cache.to === toKey
      && Date.now() - cache.at < TTL_MS) {
    return { configured: true, events: cache.events, feeds: cache.feeds, cached: true };
  }
  const events = [], report = [];
  for (const f of list) {
    try {
      const r = await fetch(f.url, { headers: { 'User-Agent': 'the-way/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not an iCal feed (no VCALENDAR)');
      const evs = eventsFromFeed(text, f.name, fromKey, toKey);
      events.push(...evs);
      report.push({ name: f.name || 'calendar', events: evs.length, ok: true });
    } catch (e) {
      // One bad feed must not empty the day of the others.
      report.push({ name: f.name || f.url.slice(0, 40), ok: false, error: e.message });
      console.error('[ics]', f.name || f.url.slice(0, 40), e.message);
    }
  }
  await setJSON('ics-cache', { from: fromKey, to: toKey, events, feeds: report, at: Date.now() })
    .catch(() => {});
  return { configured: true, events, feeds: report, cached: false };
}

function attach(app) {
  // Add a calendar from the app itself: paste the secret iCal address, done.
  // No hosting dashboard, no redeploy.
  app.post('/ics/feeds', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      const url = String(b.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'a http(s) iCal URL is required' });
      // Prove it is a calendar before storing it, so a wrong paste is caught
      // here rather than showing up as an empty day.
      let name = (b.name || '').trim() || null, events = 0;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'the-way/1.0' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('that URL did not return an iCal feed');
        const parsed = parseICS(text);
        if (!name) name = parsed.calName || 'calendar';
        events = parsed.events.length;
      } catch (e) { return res.status(400).json({ error: 'could not read that feed — ' + e.message }); }
      const d = await getJSON('ics-feeds', { feeds: [] });
      d.feeds = (d.feeds || []).filter(f => f.url !== url).concat([{ name, url, added_at: new Date().toISOString() }]);
      await setJSON('ics-feeds', d);
      STORED = d.feeds; CACHED_ALL = null;
      await setJSON('ics-cache', null).catch(() => {});   // force a refetch
      res.json({ ok: true, name, events_in_feed: events, feeds: d.feeds.map(f => f.name) });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/ics/feeds', async (req, res) => { if (!auth(req, res)) return;
    const stored = await storedFeeds();
    res.json({ feeds: stored.map(f => ({ name: f.name, added_at: f.added_at })),
      from_env: envFeeds().map(f => f.name || 'unnamed') }); });

  app.post('/ics/feeds/remove', async (req, res) => { if (!auth(req, res)) return;
    const name = String((req.body || {}).name || '');
    const d = await getJSON('ics-feeds', { feeds: [] });
    const before = (d.feeds || []).length;
    d.feeds = (d.feeds || []).filter(f => f.name !== name);
    await setJSON('ics-feeds', d);
    STORED = d.feeds; CACHED_ALL = null;
    await setJSON('ics-cache', null).catch(() => {});
    res.json({ ok: true, removed: before - d.feeds.length }); });

  app.get('/ics/status', async (req, res) => { if (!auth(req, res)) return;
    const list = await feedsAsync();
    if (!list.length) return res.json({ configured: false, feeds: [] });
    const from = tz.shiftKey(tz.todayKey(), -7), to = tz.shiftKey(tz.todayKey(), 14);
    try {
      const r = await fetchAll(from, to, req.query.force === '1');
      res.json({ configured: true, feeds: r.feeds, events: r.events.length, cached: !!r.cached });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, fetchAll, configured, feeds, feedsAsync, parseICS, eventsFromFeed, expand };
