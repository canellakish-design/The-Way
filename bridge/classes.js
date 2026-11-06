// ============================================================
// classes.js — the teaching timetable.
// A class schedule is a fixed weekly pattern, not a feed: it lives in
// schedule-classes.json and gets expanded onto whatever dates the front
// page asks for. Edit that file to change the week.
// ============================================================
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let TABLE = { week: {}, no_class_dates: [] };
try { TABLE = require('./schedule-classes.json'); }
catch (e) { console.error('[classes] schedule-classes.json unreadable:', e.message); }

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function fmtMin(m) {
  let h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'a' : 'p';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + String(mm).padStart(2, '0') + ap;
}

// dateStr is a local YYYY-MM-DD. Noon anchor keeps the weekday off the
// midnight/DST boundary.
function classesForDate(dateStr) {
  const skip = TABLE.no_class_dates || [];
  if (skip.includes(dateStr)) return [];
  const dow = DOW[new Date(dateStr + 'T12:00:00').getDay()];
  const rows = (TABLE.week && TABLE.week[dow]) || [];
  return rows.map(c => {
    const sm = toMin(c.from), em = toMin(c.to);
    if (sm == null || em == null) return null;
    return {
      summary: c.name + (c.room ? ' · ' + c.room : ''),
      category: 'work', source: 'class', calendar: 'Classes',
      location: c.room || null, allDay: false, blocking: true,
      from: fmtMin(sm), to: fmtMin(em), start_min: sm, end_min: em,
      minutes: Math.max(0, em - sm)
    };
  }).filter(Boolean).sort((a, b) => a.start_min - b.start_min);
}

function configured() {
  return Object.values(TABLE.week || {}).some(rows => (rows || []).length > 0);
}

// A day with all the sections is a rest day (Harry, 6 Nov 2026). The classes come through Google
// Calendar; the day's events matching rest_day.match in schedule-classes.json are counted, and at
// rest_day.classes of them the day is a rest day: no ride, no lift (workouts.js refuses to place one
// there, lifts.js skips it, the Calendar marks it).
const REST = Object.assign({ classes: 3, match: '' }, TABLE.rest_day || {});
function restReason(dateStr, events) {
  if (!REST.match || !(REST.classes > 0)) return null;
  const re = new RegExp(REST.match, 'i');
  const tz = require('./tz');
  const n = (events || []).filter(e => e && !e.allDay && re.test(String(e.summary || '')) && tz.keyOf(new Date(e.start)) === dateStr).length;
  if (n < REST.classes) return null;
  return `${['', 'one', 'two', 'three', 'four', 'five'][n] || n} classes`;
}
// the rest days between two dates, from every source the schedule reads (the classes come through the
// school's calendar feed, not only Google; calendar.js merges them): { date: reason }
async function restDaysBetween(from, to) {
  const tz = require('./tz');
  let events = [];
  try { events = await require('./calendar').eventsBetween(from, to); }
  catch (e) { const d = await require('./storage').getJSON('gcal', null); events = (d && d.events) || []; }
  const out = {};
  for (let k = from, i = 0; k <= to && i < 120; k = tz.shiftKey(k, 1), i++) { const r = restReason(k, events); if (r) out[k] = r; }
  return out;
}

// A special schedule (an all-day "Special Schedule: …" event on the Upper School calendar whose description
// lists lines like "8:30 - 9:30 Period 1") re-times the day's classes: each class is matched to its period by
// its regular start (schedule-classes.json periods.starts) and moved to the period's time that day; a period
// that does not meet that day drops its class. Times in the description have no a.m./p.m.: a school day,
// so an hour under 7 is afternoon.
const PERIODS = (TABLE.periods && TABLE.periods.starts) || [];
function specialPeriods(description) {
  // two spellings on the school's notes: "12:45 - 1:30 Period 4 (45 min)" and "12:50 Period 3 (70 min)"
  const out = {}; let m;
  const min = (h, mm) => { h = +h; if (h < 7) h += 12; return h * 60 + (+mm); };
  const re = /(\d{1,2}):(\d{2})\s*(?:[-–]\s*(\d{1,2}):(\d{2}))?\s*Period\s*(\d+)(?:\s*\((\d+)\s*min\))?/gi;
  while ((m = re.exec(String(description || '')))) {
    const start = min(m[1], m[2]);
    const end = m[3] ? min(m[3], m[4]) : m[6] ? start + (+m[6]) : null;
    if (end != null) out[+m[5]] = { start_min: start, end_min: end };
  }
  return Object.keys(out).length ? out : null;
}
function applySpecialSchedules(events) {
  if (!PERIODS.length || !REST.match) return events;
  const tz = require('./tz');
  const re = new RegExp(REST.match, 'i');
  const specials = {};
  for (const e of events || []) {
    if (!e || !e.allDay || !/^special schedule/i.test(String(e.summary || '')) || !e.description) continue;
    const p = specialPeriods(e.description);
    if (p) specials[String(e.start).slice(0, 10)] = { periods: p, name: String(e.summary).replace(/^special schedule:?\s*/i, '').trim() };
  }
  if (!Object.keys(specials).length) return events;
  const out = [];
  for (const e of events) {
    if (!e || e.allDay || !re.test(String(e.summary || ''))) { out.push(e); continue; }
    const day = tz.keyOf(new Date(e.start)), sp = specials[day];
    if (!sp) { out.push(e); continue; }
    const startMin = tz.minutesOf(new Date(e.start));
    let idx = -1, best = 31;
    PERIODS.forEach((s, i) => { const d = Math.abs(s - startMin); if (d < best) { best = d; idx = i; } });
    if (idx < 0) { out.push(e); continue; }
    const p = sp.periods[idx + 1];
    if (!p) continue;   // that period does not meet on the special day
    const [y, mo, d] = day.split('-').map(Number);
    out.push(Object.assign({}, e, { start: tz.zonedToUTC(y, mo, d, Math.floor(p.start_min / 60), p.start_min % 60).toISOString(),
      end: tz.zonedToUTC(y, mo, d, Math.floor(p.end_min / 60), p.end_min % 60).toISOString(), special: sp.name, period: idx + 1 }));
  }
  return out;
}

module.exports = { classesForDate, configured, restReason, restDaysBetween, specialPeriods, applySpecialSchedules, TABLE };
