// ============================================================
// energy-meter.js — the dial beside CTL (Harry, 8 Nov 2026): "Noon on the meter is maintaining weight.
// Left of noon is losing weight. Right of noon is gaining weight. It adjusts based on food eaten and
// exercise done, along with daily calorie expenditure based on weight and age."
// Today's needle is the day report's own balance (food.js dayReport → food-math.balanceSeries), so the
// meter and the Food page never disagree; this module adds what a single day cannot: the seven days
// before today averaged (the needle in the breakdown, and "≈ −0.8 lb a week at this rate"), and the body
// the burn is worked from (body.js: age and height as settings, weight from the latest weigh-in).
// A past day's end balance is kept in 'energy-days' and read again only when its journal changes.
// Not cut at the fresh start (fresh-start.js): the rate is the body's, not a score.
//   GET /energy/meter   { today: {now, end, target_end, parts, meter}, avg7, avg_days, lb_week, avg_deg, body }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const F = require('./food-math');
const NEW_PER_CALL = 3;   // past days read fresh per call; the rest wait for the next

// what a day's journal holds, as a short signature: a day is read again only when it changes
const sigOf = doc => { const es = ((doc && doc.entries) || []).filter(e => e && !e.supplement && (e.kcal || 0) > 0);
  return es.length + ':' + Math.round(es.reduce((a, e) => a + (e.kcal || 0), 0)); };

// the seven days before today: each one's balance at midnight, averaged over the days with food logged
async function week(today) {
  const food = require('./food');
  const store = await getJSON('energy-days', { days: {} }).catch(() => ({ days: {} }));
  store.days = store.days || {};
  let dirty = false, fresh = 0;
  const rows = [];
  for (let i = 7; i >= 1; i--) {
    const d = tz.shiftKey(today, -i);
    const doc = await getJSON('food-' + d, null).catch(() => null);
    const sig = sigOf(doc);
    if (sig.startsWith('0:')) { rows.push({ date: d, end: null, logged: false }); continue; }
    const hit = store.days[d];
    // a row read before the day was over is read again: its sessions may have landed since
    if (hit && hit.sig === sig && hit.final) { rows.push({ date: d, end: hit.end, logged: true }); continue; }
    if (fresh >= NEW_PER_CALL) { rows.push(hit && hit.end != null ? { date: d, end: hit.end, logged: true, stale: true } : { date: d, end: null, logged: true, pending: true }); continue; }
    try {
      const r = await food.dayReport(d); fresh++;
      const end = r && r.balance ? r.balance.end : null;
      store.days[d] = { sig, end, final: true, at: new Date().toISOString() }; dirty = true;
      rows.push({ date: d, end, logged: true });
    } catch (e) { /* that day stays unread */ }
  }
  if (dirty) { for (const k of Object.keys(store.days)) if (k < tz.shiftKey(today, -30)) delete store.days[k]; await setJSON('energy-days', store).catch(() => {}); }
  const ends = rows.filter(r => r.logged && r.end != null).map(r => r.end);
  const avg = ends.length ? Math.round(ends.reduce((a, b) => a + b, 0) / ends.length) : null;
  return { avg7: avg, avg_days: ends.length, lb_week: F.lbPerWeek(avg), avg_deg: F.meterAngle(avg), days: rows };
}

async function meter() {
  const today = tz.todayKey();
  const food = require('./food');
  const [r, wk, body] = await Promise.all([
    food.dayReport(today).catch(() => null),
    week(today).catch(() => ({ avg7: null, avg_days: 0, lb_week: null, avg_deg: null, days: [] })),
    require('./body').profile().catch(() => null)
  ]);
  const b = r && r.balance;
  return Object.assign({ date: today,
    today: b ? { now: b.now, end: b.end, target_end: b.target_end, parts: b.parts, meter: b.meter, now_min: b.now_min } : null,
    body, scale: F.METER_SCALE }, wk);
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/energy/meter', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await meter()); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, meter, week, sigOf };
