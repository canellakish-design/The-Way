// ============================================================
// thresholds.js — the ventilatory thresholds the buckets run on, with a dated history.
// Tymewear has no API (it reads breathing on its own app), so a new test is entered here by hand, by
// Harry or by Claude on his say-so: VT1 and VT2 as power and heart rate, with the test's date. The
// newest entry on or before a day is that day's lines; every bucket view reads it (bridge/buckets.js),
// and the Garmin field picks it up at its next ride start from /garmin/session/today.
// Until anything is entered, the lines are Tymewear's of 14 Aug 2026: VT1 169 W at 117 bpm, VT2 208 W
// at 139 bpm.
//
//   GET    /thresholds            { current, history, defaults }
//   POST   /thresholds            { date, vt1_w, vt2_w, vt1_hr, vt2_hr, source?, note? } (a date entered twice is replaced)
//   DELETE /thresholds/:date      removes one entry (the defaults stand when none is left)
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const KEY = 'thresholds';
const DEFAULTS = Object.freeze({ date: '2026-08-14', vt1_w: 169, vt2_w: 208, vt1_hr: 117, vt2_hr: 139, source: 'Tymewear', note: 'the defaults: Tymewear test of 14 Aug 2026' });
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

async function all() {
  const d = await getJSON(KEY, { history: [] });
  return { history: (d.history || []).slice().sort((a, b) => a.date.localeCompare(b.date)) };
}
// the lines in force on a day: the newest entry on or before it, else the defaults
async function current(day) {
  const k = isDate(day) ? day : tz.todayKey();
  const h = (await all()).history.filter(x => x.date <= k);
  return Object.assign({}, h.length ? h[h.length - 1] : DEFAULTS);
}
function check(b) {
  const n = (v, lo, hi, what) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) { const e = new Error(`${what} must be a number from ${lo} to ${hi}`); e.status = 400; throw e; } return Math.round(x); };
  const row = { date: isDate(b.date) ? b.date : tz.todayKey(),
    vt1_w: n(b.vt1_w, 60, 600, 'VT1 power'), vt2_w: n(b.vt2_w, 60, 700, 'VT2 power'),
    vt1_hr: n(b.vt1_hr, 70, 220, 'VT1 heart rate'), vt2_hr: n(b.vt2_hr, 70, 230, 'VT2 heart rate'),
    source: String(b.source || 'Tymewear').slice(0, 40), note: b.note ? String(b.note).slice(0, 200) : null, at: new Date().toISOString() };
  if (row.vt1_w >= row.vt2_w) { const e = new Error('VT1 power must be under VT2 power'); e.status = 400; throw e; }
  if (row.vt1_hr >= row.vt2_hr) { const e = new Error('VT1 heart rate must be under VT2 heart rate'); e.status = 400; throw e; }
  if (row.date > tz.shiftKey(tz.todayKey(), 1)) { const e = new Error('the test date cannot be in the future'); e.status = 400; throw e; }
  return row;
}
async function set(b) {
  const row = check(b || {});
  const d = await all();
  d.history = d.history.filter(x => x.date !== row.date).concat([row]).sort((a, c) => a.date.localeCompare(c.date)).slice(-50);
  await setJSON(KEY, d);
  return row;
}
async function remove(date) {
  const d = await all(); const n = d.history.length;
  d.history = d.history.filter(x => x.date !== date);
  if (d.history.length !== n) await setJSON(KEY, d);
  return n !== d.history.length;
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/thresholds', async (req, res) => { if (!auth(req, res)) return;
    try { const d = await all(); res.json({ current: await current(), history: d.history, defaults: DEFAULTS }); }
    catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/thresholds', async (req, res) => { if (!auth(req, res)) return;
    try { const row = await set(req.body || {}); res.json({ ok: true, saved: row, current: await current() }); }
    catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
  app.delete('/thresholds/:date', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: await remove(String(req.params.date).slice(0, 10)), current: await current() }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, all, current, set, remove, check, DEFAULTS };
