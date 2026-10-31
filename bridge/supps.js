// ============================================================
// supps.js — the four performance supplements and when each is due, so
// they show up under the link they serve and as a row on the day at the
// right time, with no box of their own.
//   creatine        under Lift:  5 g every day, any time; no loading
//   beetroot        under Ride:  2 to 3 hours before any ride
//   sodium_bicarb   under Ride:  60 to 90 minutes before a hard session only
//   magnesium       under Sleep: 200 mg glycinate an hour before bed
// Creatine adds a pound or two of water in its first two weeks, and the
// weight link is told so it does not read that as the week going wrong.
//   dueFor(date, sessions, entries, nowMin, yesterdayEntries) → { due, taken, magnesium_last_night, creatine_started }
// ============================================================
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHM = m => { m = Math.max(0, Math.min(1439, Math.round(m))); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const HARD = /vo2|40\s*\/\s*20|threshold|race|interval/i;
const isRide = s => !/lift|weight|strength|push|pull|upper|legs|pump/i.test(String(s.name || '')) && !/WeightTraining/i.test(String(s.sport || ''));
const hardName = s => HARD.test(String(s.name || '').replace(/intervals\.?\s*icu/ig, ''));

const RX = {
  creatine: { name: 'Creatine, 5 g', link: 'lift', every: 'day', why: 'every day, any time; it is the one for strength and the hard efforts' },
  beetroot: { name: 'Beetroot shot', link: 'work', every: 'ride', before_min: 150, why: '2 to 3 hours before the ride' },
  sodium_bicarb: { name: 'Sodium bicarbonate', link: 'work', every: 'hard', before_min: 75, why: '60 to 90 minutes before a hard session, with food; not on an easy day' },
  magnesium: { name: 'Magnesium glycinate, 200 mg', link: 'sleep', every: 'night', at_min: 21 * 60, why: 'an hour before bed' }
};

function dueFor(date, sessions, entries, nowMin, yesterdayEntries) {
  const taken = (entries || []).filter(e => e && e.supplement && RX[e.key]).map(e => ({ key: e.key, time: e.time }));
  const has = k => taken.some(t => t.key === k);
  const rides = (sessions || []).filter(isRide).filter(s => toMin(s.time) != null);
  const due = [];
  // creatine: once a day
  due.push({ key: 'creatine', name: RX.creatine.name, link: 'lift', time: null, why: RX.creatine.why, taken: has('creatine') });
  // beetroot: before the first ride of the day; bicarbonate: before a hard one
  const first = rides.filter(s => !s.done).sort((a, b) => toMin(a.time) - toMin(b.time))[0] || rides[0];
  if (first) {
    const start = toMin(first.time);
    due.push({ key: 'beetroot', name: RX.beetroot.name, link: 'work', time: toHM(start - RX.beetroot.before_min), session: first.name, why: `${RX.beetroot.why} (${first.name.replace(/,.*$/, '')} at ${first.time})`, taken: has('beetroot'), past: !!first.done });
    const hard = rides.find(hardName);
    if (hard) due.push({ key: 'sodium_bicarb', name: RX.sodium_bicarb.name, link: 'work', time: toHM(toMin(hard.time) - RX.sodium_bicarb.before_min), session: hard.name, why: `${RX.sodium_bicarb.why} (${hard.name.replace(/,.*$/, '')} at ${hard.time})`, taken: has('sodium_bicarb'), past: !!hard.done });
  }
  // magnesium: this evening
  due.push({ key: 'magnesium', name: RX.magnesium.name, link: 'sleep', time: toHM(RX.magnesium.at_min), why: RX.magnesium.why, taken: has('magnesium') });
  const mgLast = (yesterdayEntries || []).some(e => e && e.supplement && e.key === 'magnesium' && (toMin(e.time) == null || toMin(e.time) >= 16 * 60));
  return { due, taken: taken.map(t => t.key), magnesium_last_night: mgLast, rx: Object.fromEntries(Object.entries(RX).map(([k, v]) => [k, { name: v.name, link: v.link, why: v.why }])) };
}

// Over a week of day rows ({date, supps:[keys], ride, hard}): what was taken against what was due.
function weekOf(rows) {
  const days = rows || [];
  const count = (k, pred) => days.filter(d => (!pred || pred(d)) && (d.supps || []).includes(k)).length;
  const rideDays = days.filter(d => d.ride).length, hardDays = days.filter(d => d.hard).length;
  return {
    creatine: { taken: count('creatine'), due: days.length },
    magnesium: { taken: count('magnesium'), due: days.length },
    beetroot: { taken: count('beetroot', d => d.ride), due: rideDays },
    sodium_bicarb: { taken: count('sodium_bicarb', d => d.hard), due: hardDays }
  };
}

module.exports = { RX, dueFor, weekOf, toMin, toHM };
