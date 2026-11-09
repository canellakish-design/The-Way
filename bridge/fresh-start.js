// ============================================================
// fresh-start.js — the day the scores start counting from (Harry, 8 Nov 2026: "reset the starting point of
// The Way to tomorrow"; asked which parts, he chose scores and streaks only).
// Everything that grades him (the chain's seven-day links, the Lift count, the Food page's week, the
// micronutrient look-back, the coach's week figures) counts only days on or after this date. His rides,
// meals, lifts, weigh-ins and journal stay stored and visible; nothing is deleted. Physiology is not reset:
// fitness and fatigue, HRV and resting-HR baselines, the weight trend, the power curve and the zones keep
// their history, because cutting it would make those numbers wrong.
// With nothing set, freshStart() is null: no cut-off, everything as before.
//   GET  /fresh-start            { date, at, note } or { date: null }
//   POST /fresh-start { date }   a date sets it, null or "" clears it; a bad date is a 400
// ============================================================
const { getJSON, setJSON } = require('./storage');
const KEY = 'fresh-start';
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));

async function get() { const d = await getJSON(KEY, null); return d && isDate(d.date) ? d : { date: null }; }
// the date, or null for no cut-off
async function freshStart() { try { return (await get()).date || null; } catch (e) { return null; } }
async function set(date, note) {
  if (date === null || date === '' || date === undefined) { await setJSON(KEY, { date: null, at: new Date().toISOString(), note: 'cleared' }); return { date: null }; }
  if (!isDate(date)) { const e = new Error('date must be YYYY-MM-DD'); e.status = 400; throw e; }
  const row = { date, at: new Date().toISOString(), note: note ? String(note).slice(0, 200) : null };
  await setJSON(KEY, row);
  return row;
}
// a day counts when there is no fresh start or it falls on or after it
const counts = (day, fs) => !fs || String(day) >= fs;

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/fresh-start', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await get()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/fresh-start', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(Object.assign({ ok: true }, await set((req.body || {}).date, (req.body || {}).note))); }
    catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, get, set, freshStart, counts, isDate };
