// ============================================================
// sleep-window.js — sleep comes first (Harry, 9 Nov 2026: "Prioritize sleep with timing of fueling and
// workouts"; his window 10:30 p.m. to 6:30 a.m.). Everything the site times is placed around it:
//   - nothing is scheduled inside it: no supplement, no food, no workout before the wake time
//   - the earliest workout is an hour after waking, and never before 7 a.m. (the standing rule)
//   - magnesium an hour before bed; a bedtime snack small, an hour and a half before
//   - a workout that ends within 2 h of bed (3 h if hard) is flagged "cuts sleep" (warned, not refused)
//   GET  /sleep-window              { bed_hm, wake_hm, bed, wake (minutes), hours, earliest_workout_hm, ... }
//   POST /sleep-window { bed, wake }   24-hour HH:MM; 6 to 10 hours in bed, or a 400
// ============================================================
const { getJSON, setJSON } = require('./storage');
const KEY = 'sleep-window';
const DEFAULT = { bed: '22:30', wake: '06:30' };
const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null; };
const toHM = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const hoursOf = (bed, wake) => ((wake - bed + 1440) % 1440) / 60;
const LATE_MIN = 120, LATE_HARD_MIN = 180;   // a workout ending this close to bed cuts sleep
const HARD = /vo2|40\s*\/\s*20|threshold|race|interval|sweet/i;

// everything derived from a window, in minutes from midnight
function rules(win) {
  const w = win || DEFAULT;
  const bed = toMin(w.bed) ?? toMin(DEFAULT.bed), wake = toMin(w.wake) ?? toMin(DEFAULT.wake);
  const earliest = Math.max(7 * 60, wake + 60);         // an hour after waking, never before 7 a.m.
  return { bed, wake, bed_hm: toHM(bed), wake_hm: toHM(wake), hours: hoursOf(bed, wake),
    earliest_workout: earliest, earliest_workout_hm: toHM(earliest),
    magnesium: bed - 60, bedtime_snack: bed - 90 };
}
const DEFAULT_RULES = rules(DEFAULT);

// a workout's sleep flag: null, or the words for the Day ("ends 9:40p, cuts sleep: 2 h before bed")
function lateFlag(w, r) {
  const R = r || DEFAULT_RULES;
  const st = toMin(String(w.time || '').slice(0, 5)); if (st == null) return null;
  const mins = w.minutes || (w.metrics && w.metrics.duration_s ? Math.round(w.metrics.duration_s / 60) : 60);
  const end = st + mins, hard = HARD.test(String(w.name || ''));
  const room = R.bed - end;
  if (st < R.wake) return { cuts_sleep: true, word: 'before waking: cuts sleep' };
  if (st < R.earliest_workout) return { cuts_sleep: true, early: true, word: `starts before ${toHM(R.earliest_workout).replace(/^0/, '')}: under an hour after waking` };
  if (room >= (hard ? LATE_HARD_MIN : LATE_MIN)) return null;
  return { cuts_sleep: true, hard, end_min: end, word: `${hard ? 'hard, ' : ''}ends ${Math.max(0, Math.round(room / 6) / 10)} h before bed: cuts sleep` };
}

async function get() {
  const d = await getJSON(KEY, null).catch(() => null);
  const win = d && toMin(d.bed) != null && toMin(d.wake) != null ? { bed: d.bed, wake: d.wake } : DEFAULT;
  return rules(win);   // bed and wake in minutes; bed_hm and wake_hm as HH:MM
}
async function set(body) {
  const b = body || {};
  const bed = toMin(b.bed), wake = toMin(b.wake);
  if (bed == null || wake == null) { const e = new Error('bed and wake as HH:MM'); e.status = 400; throw e; }
  const h = hoursOf(bed, wake);
  if (h < 6 || h > 10) { const e = new Error(`${h} h in bed: the window must be 6 to 10 hours`); e.status = 400; throw e; }
  await setJSON(KEY, { bed: toHM(bed), wake: toHM(wake), at: new Date().toISOString() });
  return get();
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/sleep-window', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await get()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/sleep-window', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(Object.assign({ ok: true }, await set(req.body))); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, get, set, rules, lateFlag, DEFAULT, DEFAULT_RULES, toMin, toHM };
