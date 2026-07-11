// The Race Architecture: weekly buckets from weeks-to-race.
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const HOURS = parseFloat(process.env.HOURS_PER_WEEK || '8');

const RACE = {
  name: 'Gran Fondo Maryland — Medio', date: '2026-09-20',
  location: 'Frederick, MD', miles: 57.2, climb_ft: 6231,
  character: 'climbing gran fondo: sustained threshold climbs, W/kg race'
};
const weeksOut = () => Math.max(0, (new Date(RACE.date) - new Date()) / (7 * 864e5));
function phase(w) {
  if (w > 12) return 'base'; if (w > 4) return 'build';
  if (w > 1) return 'peak'; if (w > 0.3) return 'taper'; return 'race week';
}
function buckets(w) {
  const p = phase(w);
  if (p === 'base')  return { phase: p, aerobic_h: HOURS * .90, hi_min: HOURS * 6,  strength: 2 };
  if (p === 'build') return { phase: p, aerobic_h: HOURS * .78, hi_min: HOURS * 11, strength: 2 };
  if (p === 'peak')  return { phase: p, aerobic_h: HOURS * .60, hi_min: HOURS * 13, strength: 1 };
  if (p === 'taper') return { phase: p, aerobic_h: HOURS * .35, hi_min: HOURS * 5,  strength: 0 };
  return { phase: p, aerobic_h: 1.5, hi_min: 10, strength: 0 };
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
  const w = weeksOut(); const need = buckets(w);
  const r1 = x => Math.round(x * 10) / 10;
  return {
    race: RACE, weeks_out: r1(w), phase: need.phase, week: wk,
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
