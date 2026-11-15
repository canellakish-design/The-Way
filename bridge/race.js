// The Race Architecture: weekly buckets from weeks-to-race.
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
function num(v, dflt) { const n = parseFloat(v); return (isFinite(n) && n > 0) ? n : dflt; }
const FALLBACK_HOURS = num(process.env.HOURS_PER_WEEK, 8);

const RACE = {
  name: 'Gran Fondo Maryland — Medio', date: '2026-09-20',
  location: 'Frederick, MD', miles: 57.2, climb_ft: 6231,
  character: 'climbing gran fondo: sustained threshold climbs, W/kg race'
};
const weeksTo = date => Math.max(0, (new Date(date) - new Date()) / (7 * 864e5));
// The race the season is built around is the next A race on his race calendar (races.js). With none there, and the
// old fixed race behind him, there is no clock to count down: the season is base.
async function current() {
  try { const t = await require('./races').target(); if (t) return { race: { name: t.name, date: t.date, location: t.location || '', miles: t.distance_mi || null, climb_ft: t.climb_ft || null, character: t.kind + (t.notes ? ': ' + t.notes.slice(0, 120) : '') }, weeks: weeksTo(t.date + 'T12:00:00') }; } catch (e) { /* the old race stands */ }
  if (new Date(RACE.date + 'T23:59:59') >= new Date()) return { race: RACE, weeks: weeksTo(RACE.date) };
  return { race: { name: 'No A race set', date: null, location: '', miles: null, climb_ft: null, character: 'base season: add an A race on the Races page' }, weeks: 20 };
}
function phase(w) {
  if (w > 12) return 'base'; if (w > 4) return 'build';
  if (w > 1) return 'peak'; if (w > 0.3) return 'taper'; return 'race week';
}
function buckets(w, HOURS) {
  HOURS = (isFinite(HOURS) && HOURS > 0) ? HOURS : 8;
  const p = phase(w);
  if (p === 'base')  return { phase: p, aerobic_h: HOURS * .90, hi_min: HOURS * 6,  strength: 2 };
  if (p === 'build') return { phase: p, aerobic_h: HOURS * .78, hi_min: HOURS * 11, strength: 2 };
  if (p === 'peak')  return { phase: p, aerobic_h: HOURS * .60, hi_min: HOURS * 13, strength: 1 };
  if (p === 'taper') return { phase: p, aerobic_h: HOURS * .35, hi_min: HOURS * 5,  strength: 0 };
  return { phase: p, aerobic_h: 1.5, hi_min: 10, strength: 0 };
}
// Hours source of truth: calendar-derived recommended volume when Google
// Calendar is connected (never ask what the system can know); env fallback.
async function weeklyHours() {
  try {
    const { trainingHours } = require('./calendar');
    const { sleepLatest } = require('./whoop');
    const s = await sleepLatest({ sync: false }).catch(() => null);
    const rec = s && s.recovery ? s.recovery.score : null;
    const h = await trainingHours(rec);
    if (h != null && h > 0) return { hours: h, source: 'calendar' };
  } catch (e) {}
  return { hours: num(FALLBACK_HOURS, 8), source: 'env fallback' };
}
function isoWeek(d) {
  const t = new Date(d); t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return t.getFullYear() + '-W' + String(1 + Math.round(((t - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7)).padStart(2, '0');
}
async function weekState() {
  const wk = isoWeek(new Date());
  const db = await getJSON('race-week', {});
  const done = db[wk] || { aerobic_h: 0, hi_min: 0, strength: 0 };
  const cur = await current(), w = cur.weeks;
  const hrs = await weeklyHours();
  const need = buckets(w, hrs.hours);
  const r1 = x => Math.round(x * 10) / 10;
  return {
    race: cur.race, weeks_out: cur.race.date ? r1(w) : null, phase: need.phase, week: wk,
    hours_source: hrs.source, weekly_hours: hrs.hours,
    need: { aerobic_h: r1(need.aerobic_h), hi_min: Math.round(need.hi_min), strength: need.strength },
    done: { aerobic_h: r1(done.aerobic_h), hi_min: Math.round(done.hi_min), strength: done.strength },
    remaining: { aerobic_h: r1(Math.max(0, need.aerobic_h - done.aerobic_h)),
                 hi_min: Math.round(Math.max(0, need.hi_min - done.hi_min)),
                 strength: Math.max(0, need.strength - done.strength) }
  };
}
async function logTraining(body) {
  const wk = isoWeek(new Date());
  const db = await getJSON('race-week', {});
  const cur = db[wk] || { aerobic_h: 0, hi_min: 0, strength: 0 };
  cur.aerobic_h += Number(body.aerobic_h) || 0;
  cur.hi_min += Number(body.hi_min) || 0;
  cur.strength += Number(body.strength) || 0;
  db[wk] = cur; await setJSON('race-week', db);
  return { ok: true, ...(await weekState()) };
}
function attach(app) {
  app.get('/race', async (req, res) => { if (!auth(req, res)) return;
    res.json(await weekState()); });
  app.post('/race/log', async (req, res) => { if (!auth(req, res)) return;
    res.json(await logTraining(req.body || {})); });
}
module.exports = { attach, weekState, logTraining };
