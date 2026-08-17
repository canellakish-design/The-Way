// ============================================================
// snapshot.js — a calendar that was read once and written down.
//
// Google's OAuth consent screen needs Harry's own login, so the hosted app
// can't reach his calendars unattended. This is the honest stand-in: the real
// events, read out of Google Calendar on the capture date and committed here,
// in the same shape the iCal reader produces so the day merges them without
// knowing the difference.
//
// It goes stale. That is the whole point of saying so on the page: the day
// shows "calendar snapshot · captured <date>", and events past the covered
// range simply aren't there rather than quietly appearing empty. The live
// replacements, in order of preference:
//   1. paste a calendar's secret iCal address into Settings (see ics.js)
//   2. connect the Google account (see calendar.js)
// Either one takes precedence — a feed or an account supplies the same days,
// and the snapshot only fills what nothing else covers.
// ============================================================
const doc = require('./calendar-snapshot.json');

const keyOf = e => String(e.start).slice(0, 10);

function meta() {
  return { captured_at: doc.captured_at, covers: doc.covers,
    events: doc.events.length,
    calendars: [...new Set(doc.events.map(e => e.calendar))] };
}

// Days already covered by a live source win outright. Mixing a stale copy of a
// day with the live one is worse than either: a cancelled practice would sit
// next to its replacement with nothing to say which is current.
function eventsInRange(fromKey, toKey, coveredDays) {
  const covered = coveredDays instanceof Set ? coveredDays : new Set(coveredDays || []);
  return doc.events.filter(e => {
    const k = keyOf(e);
    return k >= fromKey && k <= toKey && !covered.has(k);
  });
}

// How far the written-down copy still reaches. Past this the day is simply
// unknown, which the page says rather than drawing an empty calendar.
function staleAfter() { return doc.covers.to; }

module.exports = { eventsInRange, meta, staleAfter };
