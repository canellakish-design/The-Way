// ============================================================
// tz.js — the app's clock.
// Everything user-facing is in one timezone: Harry's. The server is not — a
// Netlify function runs in UTC — so anything derived from the server's local
// time is wrong in production while looking right on a laptop. A 6:00am
// Eastern ride rendered as 10:00a, and "today" rolled over at 8pm.
// Env: TIMEZONE (IANA name, default America/New_York)
// ============================================================
const ZONE = process.env.TIMEZONE || 'America/New_York';
const pad = n => String(n).padStart(2, '0');

// Wall-clock parts of an instant, as seen in the zone.
function parts(date, zone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone || ZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
  });
  const o = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {
    y: +o.year, mo: +o.month, d: +o.day,
    // hourCycle can yield 24 for midnight depending on ICU version
    h: +o.hour % 24, mi: +o.minute, s: +o.second, dow: o.weekday
  };
}

const keyOf = (date, zone) => { const p = parts(date, zone); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };
const todayKey = zone => keyOf(new Date(), zone);
const minutesOf = (date, zone) => { const p = parts(date, zone); return p.h * 60 + p.mi; };
const isToday = (date, zone) => keyOf(new Date(date), zone) === todayKey(zone);

// Calendar-day arithmetic on a YYYY-MM-DD key. Done in UTC deliberately: these
// are dates, not instants, so DST must not shift them.
function shiftKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 864e5);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// Midday of a calendar day, as an instant. Noon keeps every format/weekday
// lookup clear of both midnight and DST transitions.
function noonOf(key, zone) {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToUTC(y, m, d, 12, 0, zone);
}

// A wall-clock time in the zone -> the instant it refers to. Two passes: guess
// the instant, measure the offset the zone actually applied there, correct.
// The second pass settles the DST-boundary cases the first can miss.
function zonedToUTC(y, mo, d, h, mi, zone) {
  const target = Date.UTC(y, mo - 1, d, h, mi, 0);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(ts), zone);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0);
    ts = target - (seen - ts);
  }
  return new Date(ts);
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const dowOf = (key, zone) => parts(noonOf(key, zone), zone).dow;      // 'Mon'
const dowIndexOf = (key, zone) => WEEKDAYS[dowOf(key, zone)];

function labelOf(key, zone, opts) {
  return noonOf(key, zone).toLocaleDateString('en-US',
    Object.assign({ timeZone: zone || ZONE, weekday: 'long', month: 'long', day: 'numeric' }, opts || {}));
}

function fmtMin(m) {
  let h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'a' : 'p';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + pad(mm) + ap;
}

module.exports = { ZONE, parts, keyOf, todayKey, minutesOf, isToday,
  shiftKey, noonOf, zonedToUTC, dowOf, dowIndexOf, labelOf, fmtMin };
