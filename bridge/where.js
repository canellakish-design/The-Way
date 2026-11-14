// ============================================================
// where.js — where each session is done (Harry, 14 Nov 2026: "I lift at Lifetime. … I ride, if the weather's
// bad, I'll ride indoors in the pain cave." "I will never ride my bike at lifetime").
//   a lift            Life Time (Life Time Annapolis, a walk from home); a kettlebell or Bowflex session, at home
//   a trainer ride    the pain cave, at home
//   a ride outside    outside, unless the weather at its time is bad: then the pain cave, with the reason
//   never             a ride at Life Time: no ride is planned, named or noted there (workouts.js refuses one)
// Bad weather is the line already used for a recommended ride (suggest.js): under 50°F, or the ride's weather
// grading under a B (rain, wind, ice, or dark before it ends). Every half hour the rides outside today and in the
// three days ahead are looked at against the forecast and marked (or unmarked); the Day page, the coach and the
// planner read the mark. A ride with a place of its own (a recommended ride he said yes to) is left as it is.
// ============================================================
const tz = require('./tz');
const GYM = { name: 'Life Time', full: 'Life Time Annapolis', address: '200 Harker Place, Annapolis, MD 21401' };
const CAVE = 'pain cave';
const MIN_F = 50, MIN_GRADE = 79;   // suggest.js: 50°F or warmer, and a B or better
const isLift = w => !!w && /weight|strength/i.test(String(w.sport || ''));
const liftAtHome = w => /kettlebell|bowflex|\bhome\b/i.test(String((w && w.name) || ''));
const isRide = w => !!w && /ride/i.test(String(w.sport || ''));
const outside = w => isRide(w) && w.sport !== 'VirtualRide';

// 'Life Time' | 'home' | 'pain cave' | 'outside' | null (its own place, or not a session with one)
function placeOf(w) {
  if (!w) return null;
  if (isLift(w)) return liftAtHome(w) ? 'home' : GYM.name;
  if (w.sport === 'VirtualRide') return CAVE;
  if (outside(w)) return w.location ? null : w.indoor ? CAVE : 'outside';
  return null;
}
// a ride that names Life Time (its name or its notes): never planned
const gymRide = w => isRide(w) && /life\s*time/i.test(`${(w && w.name) || ''} ${(w && w.notes) || ''}`);

// Why a ride from start to end (minutes from midnight) should be indoors, or null. hours: weather.js outlook hours.
function badWeather(hours, start, end) {
  const hrs = (hours || []).filter(h => h && h.hour * 60 < end && (h.hour + 1) * 60 > start);
  if (!hrs.length) return null;   // no forecast: no call
  const temps = hrs.map(h => h.temp_f).filter(t => t != null), low = temps.length ? Math.round(Math.min(...temps)) : null;
  if (low != null && low < MIN_F) return `${low}°F, under ${MIN_F}`;
  const g = hrs.some(h => h.cscore != null) ? require('./weather').gradeRide(hrs) : null;
  if (g && g.score < MIN_GRADE) return `the weather grades ${g.letter}${g.why && g.why.length ? ` (${g.why.slice(0, 2).join(', ')})` : ''}`;
  return null;
}
const minsOf = w => Math.round(((w.steps || []).reduce((a, x) => a + (x.dur_s || 0), 0)) / 60) || 60;

// What the forecast says of each ride outside, today and three days on: [{ id, date, name, why (or null) }]
function calls(workouts, days, today, nowMin) {
  const out = [];
  for (const w of Object.values(workouts || {})) {
    if (!w || !outside(w) || w.location || !w.time || !w.date || w.date < today || w.date > tz.shiftKey(today, 3)) continue;
    const start = (+w.time.slice(0, 2)) * 60 + (+w.time.slice(3, 5));
    if (w.date === today && start <= nowMin) continue;   // started: it is where it is
    const day = days && days[w.date]; if (!day) continue;
    out.push({ id: w.id, date: w.date, name: w.name, why: badWeather(day.hours, start, start + minsOf(w)), had: (w.indoor && w.indoor.why) || null });
  }
  return out;
}
async function tick(now) {
  const p = tz.parts(now || new Date());
  if (p.mi % 30 >= 5) return { skipped: 'every half hour' };
  return check(now);
}
async function check(now) {
  const { getJSON } = require('./storage');
  const p = tz.parts(now || new Date()), today = tz.todayKey();
  const d = await getJSON('plan-workouts', { workouts: {} });
  if (!Object.values(d.workouts || {}).some(w => w && outside(w) && !w.location && w.date >= today && w.date <= tz.shiftKey(today, 3))) return { rides: 0 };
  const o = await require('./weather').outlook(today, tz.shiftKey(today, 3));
  const list = calls(d.workouts, o && o.days, today, p.h * 60 + p.mi), changed = [];
  for (const c of list) {
    if ((c.why || null) === (c.had || null)) continue;
    try { await require('./workouts').update(c.id, { indoor: c.why ? { why: c.why, at: new Date().toISOString() } : null }); changed.push({ id: c.id, date: c.date, name: c.name, indoors: c.why }); }
    catch (e) { changed.push({ id: c.id, error: e.message }); }
  }
  return { rides: list.length, changed };
}
function attach(app) {
  const { auth } = require('./fuel-log');
  // the rule, and what the forecast says of the rides ahead (nothing is changed)
  app.get('/where', async (req, res) => { if (!auth(req, res)) return;
    try { const { getJSON } = require('./storage'); const p = tz.parts(new Date()), today = tz.todayKey();
      const d = await getJSON('plan-workouts', { workouts: {} }); const o = await require('./weather').outlook(today, tz.shiftKey(today, 3));
      res.json({ lifts: GYM, trainer: CAVE, min_f: MIN_F, rides: calls(d.workouts, o && o.days, today, p.h * 60 + p.mi) }); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, placeOf, gymRide, badWeather, calls, check, tick, isLift, isRide, outside, GYM, CAVE, MIN_F, MIN_GRADE };
