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

module.exports = { classesForDate, configured, TABLE };
