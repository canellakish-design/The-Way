// ============================================================
// body.js — the body the day's burn is worked out from (Harry, 9 Nov 2026: "I'm 48").
// Age and height are settings, not constants. Weight is never stored here: it follows the latest
// weigh-in (food.bodyKg), and the date of that reading rides along so a stale weight is visible.
// BMR is Mifflin-St Jeor from the three (food-math.bmr); everyday movement is BMR × 0.35.
//   GET  /body                 { age, cm, kg, kg_from, bmr, base_burn }
//   POST /body { age?, cm? }   a number in range sets it; out of range is a 400
// ============================================================
const { getJSON, setJSON } = require('./storage');
const KEY = 'body-profile';
const DEFAULTS = { age: 48, cm: 178 };
const okAge = a => Number.isFinite(a) && a >= 14 && a <= 100;
const okCm = c => Number.isFinite(c) && c >= 120 && c <= 230;

async function stored() {
  const d = await getJSON(KEY, null).catch(() => null);
  return { age: d && okAge(+d.age) ? +d.age : DEFAULTS.age, cm: d && okCm(+d.cm) ? +d.cm : DEFAULTS.cm };
}
// the latest weigh-in: kg and the day it was taken
async function weighIn() {
  try {
    const w = await getJSON('weigh-in', { entries: [] });
    const latest = (w.entries || []).slice().sort((a, b) => a.ts - b.ts).pop();
    if (!latest || !(latest.lb > 100)) return { kg: null, kg_from: null };
    const day = latest.date || (latest.ts ? require('./tz').keyOf(new Date(latest.ts)) : null);
    return { kg: Math.round(latest.lb / 2.2046 * 10) / 10, kg_from: day };
  } catch (e) { return { kg: null, kg_from: null }; }
}
// everything the burn needs, in one read
async function profile() {
  const F = require('./food-math');
  const [s, w] = await Promise.all([stored(), weighIn()]);
  const p = { kg: w.kg || F.PROFILE.kg, cm: s.cm, age: s.age, activity: F.PROFILE.activity };
  return { age: s.age, cm: s.cm, kg: p.kg, kg_from: w.kg ? w.kg_from : null, kg_fallback: !w.kg, bmr: F.bmr(p), base_burn: F.baseBurn(p), activity: p.activity };
}
async function set(body) {
  const b = body || {}, cur = await stored();
  const next = Object.assign({}, cur);
  if (b.age != null && b.age !== '') { const a = Math.round(+b.age); if (!okAge(a)) { const e = new Error('age must be 14 to 100'); e.status = 400; throw e; } next.age = a; }
  if (b.cm != null && b.cm !== '') { const c = Math.round(+b.cm); if (!okCm(c)) { const e = new Error('height must be 120 to 230 cm'); e.status = 400; throw e; } next.cm = c; }
  await setJSON(KEY, Object.assign(next, { at: new Date().toISOString() }));
  return profile();
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/body', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await profile()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/body', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(Object.assign({ ok: true }, await set(req.body))); }
    catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, profile, stored, set, weighIn, DEFAULTS };
