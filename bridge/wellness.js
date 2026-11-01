// ============================================================
// wellness.js — a morning's numbers by hand: what the strap showed when no
// feed carried it. Sleep hours and score, recovery, HRV, resting HR, for a
// date. Laid over the intervals.icu wellness wherever the chain and the
// scores read it: a hand-entered number wins for its date, and the record
// says it was entered by hand and from what.
//
//   GET  /wellness                    the hand-entered days
//   POST /wellness  { date?, sleep_h?, sleep_score?, recovery?, hrv?, rhr?, source? }
//   DELETE /wellness/:date
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const KEY = 'wellness-manual';
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

async function all() { return getJSON(KEY, { days: {} }); }
async function set(b) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test((b || {}).date || '') ? b.date : tz.todayKey();
  const d = await all();
  const cur = d.days[date] || {};
  const next = {
    sleep_h: num(b.sleep_h, 0, 16) != null ? Math.round(num(b.sleep_h, 0, 16) * 100) / 100 : cur.sleep_h ?? null,
    sleep_score: num(b.sleep_score, 0, 100) != null ? Math.round(num(b.sleep_score, 0, 100)) : cur.sleep_score ?? null,
    recovery: num(b.recovery, 0, 100) != null ? Math.round(num(b.recovery, 0, 100)) : cur.recovery ?? null,
    hrv: num(b.hrv, 5, 250) != null ? Math.round(num(b.hrv, 5, 250)) : cur.hrv ?? null,
    rhr: num(b.rhr, 25, 120) != null ? Math.round(num(b.rhr, 25, 120)) : cur.rhr ?? null,
    source: String((b || {}).source || cur.source || 'by hand').slice(0, 40), at: new Date().toISOString()
  };
  if (next.sleep_h == null && next.recovery == null && next.hrv == null && next.rhr == null && next.sleep_score == null) throw new Error('nothing to record');
  d.days[date] = next;
  for (const k of Object.keys(d.days)) if (k < tz.shiftKey(date, -120)) delete d.days[k];
  await setJSON(KEY, d);
  return Object.assign({ date }, next);
}
async function remove(date) { const d = await all(); if (!d.days[date]) return false; delete d.days[date]; await setJSON(KEY, d); return true; }

// the intervals.icu days with the hand-entered ones laid over: a number given by hand wins for its date
async function overlay(days) {
  let d; try { d = await all(); } catch (e) { return days || []; }
  const out = (days || []).map(x => Object.assign({}, x));
  for (const [date, m] of Object.entries(d.days || {})) {
    let row = out.find(x => x.date === date);
    if (!row) { row = { date }; out.push(row); }
    if (m.sleep_h != null) row.sleep_h = m.sleep_h;
    if (m.sleep_score != null) row.sleep_score = m.sleep_score;
    if (m.recovery != null) row.readiness = m.recovery;
    if (m.hrv != null) row.hrv = m.hrv;
    if (m.rhr != null) row.rhr = m.rhr;
    row.manual = m.source || 'by hand'; row.updated = m.at;
  }
  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/wellness', async (req, res) => { if (!auth(req, res)) return; try { res.json(await all()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/wellness', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: true, day: await set(req.body || {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
  app.delete('/wellness/:date', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: await remove(String(req.params.date).slice(0, 10)) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, all, set, remove, overlay };
