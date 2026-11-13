// ============================================================
// attend.js — what he is actually going to (Harry, 13 Nov 2026: "We need to establish what I am actually going to
// and what I am not going to" / "tech staff calls I have to participate in").
//
// Three layers, the narrowest wins:
//   an event      tapped Going or Not going on the Day page                       events[key]
//   a series      "always" / "never" for an event that repeats (same calendar, same title)   series[key]
//   a calendar    "I go" or "For info", set once on Setup                          calendars[name]
// The defaults: his own calendar, his classes, his team (U16 ECNL), the technical staff calls, his school
// account and his cycling calendar are "I go"; the school's, the club's and every other team's are "For info".
// An event that is "possible", "TBD" or "tentative" on a calendar he goes to is a maybe: asked, not assumed (the
// 8 p.m. check sends tomorrow's maybes to the phone).
//
// An event he is not going to (or only maybe) keeps its row on the Day page, dimmed, with category 'info': it
// blocks no time, makes no clash, gets no drive, and nothing is moved for it.
//   GET  /attend               the calendars with their setting
//   POST /attend               { calendar, mode: 'go'|'info'|null } | { key, mode: 'go'|'no'|null } | { series, mode }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');

const GO_DEFAULT = [/^\s*personal events\s*$/i, /mcdonogh class schedule/i, /^u16 g maryland united ecnl$/i, /technical staff/i, /^hcanellakis@mcdonogh\.org$/i, /^cycling$/i];
const MAYBE = /\b(possible|tbd|tentative|maybe|if we qualify)\b/i;

async function load() { return Object.assign({ calendars: {}, events: {}, series: {} }, await getJSON('attend', {}).catch(() => ({})) || {}); }
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function keyOf(e) {
  if (e.gid && e.calendar_id) return 'g:' + e.calendar_id + ':' + e.gid;
  if (e.id && String(e.id).startsWith('ev_')) return 'l:' + e.id;
  if (e.uid) return 'o:' + e.uid;
  return null;
}
const seriesOf = e => 's:' + norm(e.calendar) + '|' + norm(e.summary);
function calendarMode(name, A) {
  if (!name) return 'go';                       // added in The Way
  const set = A && A.calendars && A.calendars[name];
  if (set === 'go' || set === 'info') return set;
  return GO_DEFAULT.some(re => re.test(String(name))) ? 'go' : 'info';
}
// one event's answer: 'go' | 'no' | 'info' | 'maybe', and which layer said it
function modeOf(e, A) {
  const k = keyOf(e), s = seriesOf(e);
  if (k && A.events && A.events[k]) return { mode: A.events[k], by: 'event' };
  if (A.series && A.series[s]) return { mode: A.series[s], by: 'series' };
  const c = calendarMode(e.calendar, A);
  if (c === 'go' && MAYBE.test(String(e.summary || ''))) return { mode: 'maybe', by: 'title' };
  return { mode: c, by: 'calendar' };
}
// Marks every event; one he is not going to becomes category 'info' (its own kept as orig_category).
function apply(events, A) {
  return (events || []).map(e => {
    if (!e || ['commute', 'rx', 'plan'].includes(e.source)) return e;
    const m = modeOf(e, A || {});
    const x = Object.assign({}, e, { attend: m.mode, attend_by: m.by, attend_key: keyOf(e), series_key: seriesOf(e) });
    if (m.mode !== 'go' && x.category !== 'info') { x.orig_category = x.category; x.category = 'info'; }
    return x;
  });
}

async function save(b) {
  const A = await load();
  const mode = b.mode == null || b.mode === '' ? null : String(b.mode);
  const put = (map, k, ok) => { if (!k) { const e = new Error('which one?'); e.status = 400; throw e; }
    if (mode == null) delete A[map][k]; else if (ok.includes(mode)) A[map][k] = mode; else { const e = new Error('mode: ' + ok.join(' or ')); e.status = 400; throw e; } };
  if (b.calendar != null) put('calendars', String(b.calendar), ['go', 'info']);
  else if (b.series != null) put('series', String(b.series), ['go', 'no']);
  else put('events', String(b.key || ''), ['go', 'no']);
  await setJSON('attend', A);
  return { ok: true };
}

async function calendars() {
  const A = await load();
  let names = [];
  try { const s = await require('./calendar').scheduleReport({ days: 1 }); names = (s.sources && s.sources.calendars) || []; } catch (e) { names = Object.keys(A.calendars); }
  return names.filter(n => !/holidays/i.test(n)).map(n => ({ name: String(n).trim() || n, key: n, mode: calendarMode(n, A), set: A.calendars[n] || null }))
    .sort((a, b) => (a.mode === b.mode ? a.name.localeCompare(b.name) : a.mode === 'go' ? -1 : 1));
}

// 8 p.m.: tomorrow's maybes to the phone, once.
async function nightCheck(now) {
  if (/^(1|true|yes)$/i.test(String(process.env.THE_WAY_SANDBOX || ''))) return { skipped: 'sandbox' };
  const p = tz.parts(now || new Date()), nowMin = p.h * 60 + p.mi;
  if (nowMin < 20 * 60 || nowMin >= 20 * 60 + 5) return { skipped: 'not 8 p.m.' };
  const date = tz.todayKey(), tomorrow = tz.shiftKey(date, 1);
  const log = await getJSON('attend-sent', {}).catch(() => ({})) || {};
  if (log.date === date) return { skipped: 'sent' };
  const ev = await require('./calendar').eventsBetween(tomorrow, tomorrow).catch(() => []);
  const maybes = ev.filter(e => e.attend === 'maybe' && !e.allDay && e.start && tz.keyOf(new Date(e.start)) === tomorrow);
  if (!maybes.length) return { skipped: 'no maybes' };
  const list = maybes.map(e => `${tz.hm12(String(Math.floor(tz.minutesOf(new Date(e.start)) / 60)).padStart(2, '0') + ':' + String(tz.minutesOf(new Date(e.start)) % 60).padStart(2, '0'))} ${String(e.summary).replace(/^U\d{2} G MARYLAND UNITED ECNL - /i, '')}`);
  const r = await require('./push').send({ title: 'Tomorrow: going?', body: `${list.join(' · ')}. Tap Going or Not going on the Day page so the day plans around what you are doing.`, tag: 'way-attend', items: [], url: '/#today' });
  await setJSON('attend-sent', { date, at: new Date().toISOString() }).catch(() => {});
  return { sent: list, result: r };
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/attend', async (req, res) => { if (!auth(req, res)) return; try { res.json({ calendars: await calendars() }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/attend', async (req, res) => { if (!auth(req, res)) return; try { res.json(await save(req.body || {})); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
}

module.exports = { attach, load, apply, modeOf, calendarMode, keyOf, seriesOf, save, nightCheck, GO_DEFAULT };
