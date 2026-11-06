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

module.exports = { classesForDate, configured, restReason, restDaysBetween, TABLE };
