// ============================================================
// nights.js — the 3 a.m. tracker (Harry, 9 Nov 2026: "I'm constantly waking up at 3 AM").
// Each morning he says whether he woke in the night (one tap on the Day). The evening before is read from
// what the site already holds and kept with the answer, so the record shows what came before each night:
//   alcohol      drinks logged from 6 p.m. (food journal, entry.alcohol)
//   late_meal    the last food within 2.5 h of bed (the sleep window's bed time)
//   late_fluid   fluid logged after 8 p.m., in ml (500 ml or more counts as late fluid)
//   late_workout a session ending within 3 h of bed (the calendar's rides and the plan's logged sessions)
//   bp_night     the blood pressure medicine taken in the evening (meds.js)
//   magnesium    magnesium taken that evening
// With at least two nights on each side of a factor, the page shows how often he woke with it and without
// it, most different first. A pattern over a fortnight is a lead to take to the doctor, not a diagnosis.
//   GET  /nights           { nights: [{ date, woke, time, factors }], factors: [{ key, label, with, without }] }
//   POST /nights { date?, woke, time? }   date is the morning (default today); time 'HH:MM', default 03:00
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const SW = require('./sleep-window');
const KEY = 'night-wakes';
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const FACTORS = [
  { key: 'alcohol', label: 'alcohol in the evening', test: f => f.alcohol > 0 },
  { key: 'late_meal', label: 'eating within 2.5 h of bed', test: f => f.last_food_min != null && f.bed_min - f.last_food_min < 150 },
  { key: 'late_fluid', label: '500 ml or more after 8 p.m.', test: f => f.fluid_after8_ml >= 500 },
  { key: 'late_workout', label: 'a workout ending within 3 h of bed', test: f => f.last_session_end_min != null && f.bed_min - f.last_session_end_min < 180 },
  { key: 'bp_night', label: 'BP medicine at night', test: f => !!f.bp_night },
  { key: 'magnesium', label: 'magnesium taken', test: f => !!f.magnesium }
];

// the evening before a morning, from that day's journal, medicines and sessions (pure)
function eveningFactors(o) {
  const ents = (o.entries || []).filter(e => e && toMin(e.time) != null);
  const food = ents.filter(e => !e.supplement && (e.kcal || 0) > 0);
  const alcohol = ents.filter(e => !e.supplement && (e.alcohol || 0) > 0 && toMin(e.time) >= 18 * 60).reduce((a, e) => a + (e.alcohol || 0), 0);
  const fluid = ents.filter(e => !e.supplement && toMin(e.time) >= 20 * 60).reduce((a, e) => a + Math.max(0, e.fluid_ml || 0), 0);
  const lastFood = food.length ? Math.max(...food.map(e => toMin(e.time))) : null;
  const ends = (o.sessions || []).map(s => s.end).filter(x => x != null);
  const bp = o.meds && o.meds.bp ? tz.parts(new Date(o.meds.bp)) : null;
  return { alcohol, fluid_after8_ml: Math.round(fluid), last_food_min: lastFood, last_session_end_min: ends.length ? Math.max(...ends) : null,
    bp_night: !!(bp && bp.h >= 17), magnesium: ents.some(e => e.supplement && e.key === 'magnesium'), bed_min: o.bed != null ? o.bed : SW.DEFAULT_RULES.bed };
}
// with and without each factor: how often he woke; at least two nights on each side, biggest gap first
function analyse(nights) {
  const known = (nights || []).filter(n => typeof n.woke === 'boolean' && n.factors);
  const out = [];
  for (const F of FACTORS) {
    const yes = known.filter(n => F.test(n.factors)), no = known.filter(n => !F.test(n.factors));
    if (yes.length < 2 || no.length < 2) continue;
    const rate = xs => Math.round(xs.filter(n => n.woke).length / xs.length * 100);
    out.push({ key: F.key, label: F.label, with: { nights: yes.length, woke_pct: rate(yes) }, without: { nights: no.length, woke_pct: rate(no) }, gap: rate(yes) - rate(no) });
  }
  return out.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
}

// read the evening before a morning from the stores
async function readEvening(morning) {
  const eve = tz.shiftKey(morning, -1);
  const [doc, meds, win] = await Promise.all([getJSON('food-' + eve, { entries: [] }).catch(() => ({ entries: [] })), getJSON('meds-' + eve, { taken: {} }).catch(() => ({ taken: {} })), SW.get().catch(() => null)]);
  let sessions = [];
  try {
    const cal = await require('./workouts').calendar(eve, eve);
    const d = (cal.days || [])[0] || {};
    sessions = (d.done || []).filter(r => toMin(r.time) != null).map(r => ({ end: toMin(r.time) + (r.minutes || 60) }))
      .concat((d.planned || []).filter(w => w.logged && toMin(w.time) != null).map(w => ({ end: toMin(w.time) + Math.round(((w.metrics && w.metrics.duration_s) || 3600) / 60) })));
  } catch (e) { sessions = []; }
  return eveningFactors({ entries: doc.entries, meds: meds.taken, sessions, bed: win ? win.bed : null });
}

async function list() {
  const d = await getJSON(KEY, { nights: {} });
  const nights = Object.entries(d.nights || {}).map(([date, n]) => Object.assign({ date }, n)).sort((a, b) => b.date.localeCompare(a.date));
  return { nights, factors: analyse(nights), today: tz.todayKey(), answered_today: !!(d.nights || {})[tz.todayKey()] };
}
async function record(b) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test((b || {}).date || '') ? b.date : tz.todayKey();
  if (typeof (b || {}).woke !== 'boolean') { const e = new Error('woke must be true or false'); e.status = 400; throw e; }
  const time = b.woke ? (/^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '03:00') : null;
  const d = await getJSON(KEY, { nights: {} });
  d.nights = d.nights || {};
  d.nights[date] = { woke: b.woke, time, factors: await readEvening(date), at: new Date().toISOString() };
  for (const k of Object.keys(d.nights)) if (k < tz.shiftKey(date, -120)) delete d.nights[k];
  await setJSON(KEY, d);
  return list();
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/nights', async (req, res) => { if (!auth(req, res)) return; try { res.json(await list()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/nights', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(Object.assign({ ok: true }, await record(req.body))); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, FACTORS, eveningFactors, analyse, list, record };
