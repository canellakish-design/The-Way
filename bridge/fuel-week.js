// ============================================================
// fuel-week.js — fuel for the work required, across the week. Each day's
// sessions from the plan (and, for a past day, what was ridden is handled by
// food.js) become prescriptions (food-math.fuelRx); the train-low rule runs in
// order from Monday, so one low ride a week, never before a hard day.
// ============================================================
const F = require('./food-math');
const tz = require('./tz');
const HARD = /vo2|40\s*\/\s*20|threshold|race|interval|sweet/i;

const mondayOf = k => { const d = new Date(k + 'T12:00:00'); const off = (d.getDay() + 6) % 7; return tz.shiftKey(k, -off); };
const toSession = e => ({ name: e.summary, sport: e.sport, minutes: e.minutes || null, tss: e.tss || null, time: e.start_min != null ? F.toHM(e.start_min) : null });

// days[date] -> the planned sessions as fuelRx sees them
async function plannedSessions(from, to) {
  const { plannedDays } = require('./workouts');
  const days = await plannedDays(from, to);
  const out = {};
  for (const k of Object.keys(days)) out[k] = (days[k] || []).filter(e => e.category === 'training').map(toSession);
  return out;
}
// a hard day for the train-low guard is a quality session (VO2, threshold, a race); a long Zone 1 ride is fed on its own day
const isHardDay = ss => (ss || []).some(s => F.isRideSession(s) && HARD.test(String(s.name || '')));
const eveningSession = ss => (ss || []).some(s => F.isRideSession(s) && F.toMin(s.time) != null && F.toMin(s.time) + (s.minutes || 60) >= 17 * 60);

// the context fuelRx needs for one date: the low rides already used this week (Monday to the day before),
// whether tomorrow is hard, whether yesterday had an evening session
async function contextFor(date, kg, ftp, sessionsByDate) {
  const mon = mondayOf(date);
  const by = sessionsByDate || await plannedSessions(mon, tz.shiftKey(date, 1));
  let lowUsed = 0;
  for (let k = mon; k < date; k = tz.shiftKey(k, 1)) {
    const rx = F.fuelRx(by[k] || [], kg, ftp, { low_used_week: lowUsed, hard_tomorrow: isHardDay(by[tz.shiftKey(k, 1)]), evening_yesterday: eveningSession(by[tz.shiftKey(k, -1)]) });
    lowUsed = rx.low_used_week;
  }
  return { low_used_week: lowUsed, hard_tomorrow: isHardDay(by[tz.shiftKey(date, 1)]), hard_tomorrow_am: hardMorning(by[tz.shiftKey(date, 1)]), evening_yesterday: eveningSession(by[tz.shiftKey(date, -1)]) };
}
// a hard ride tomorrow that starts before 10 a.m.: breakfast cannot fill the legs for it, so tonight's dinner does
// (Harry, 9 Nov: VO2 at 7:00 a.m. and a low carb dinner the night before)
function hardMorning(ss) {
  const h = (ss || []).filter(s => F.isRideSession(s) && HARD.test(String(s.name || '')) && F.toMin(s.time) != null && F.toMin(s.time) < 10 * 60)
    .sort((a, b) => F.toMin(a.time) - F.toMin(b.time))[0];
  return h ? { name: String(h.name).replace(/\s*[·:,].*$/, ''), time: h.time } : null;
}

// every day from..to: { carbs_g, per_kg, level, label, train_low, sleep_low, sessions: [{name, kind, before, during, after}] }
async function weekFuel(from, to, ftp) {
  const kg = (await require('./food').bodyKg().catch(() => null)) || F.PROFILE.kg;
  const by = await plannedSessions(tz.shiftKey(mondayOf(from), -1), tz.shiftKey(to, 1));
  const out = {};
  for (let k = from; k <= to; k = tz.shiftKey(k, 1)) {
    const ctx = await contextFor(k, kg, ftp, by);
    const rx = F.fuelRx(by[k] || [], kg, ftp, ctx);
    out[k] = { carbs_g: rx.carbs_g, per_kg: rx.per_kg, level: rx.level, label: rx.label, train_low: rx.train_low, sleep_low: rx.sleep_low,
      sessions: rx.sessions.map(s => ({ name: s.name, kind: s.kind, time: s.time, before_g: s.before.carbs_g, during_g: s.during.carbs_g, after_g: s.after.carbs_g, low: !!s.before.low })) };
  }
  return out;
}
module.exports = { weekFuel, contextFor, plannedSessions, mondayOf };
