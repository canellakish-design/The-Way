// ============================================================
// meds.js — Harry's medicines, due at times set by his sleep window (Harry, 9 Nov 2026: "Add my blood
// pressure medicine and eye drops, AM and PM"; "BP medicine before bed").
//   eye drops (AM)          15 minutes after waking   (6:45 a.m.)
//   eye drops (PM)          30 minutes before bed     (10:00 p.m.)
//   blood pressure medicine 30 minutes before bed     (10:00 p.m.)
// Taken is kept per day in 'meds-YYYY-MM-DD' ({ taken: { key: iso } }), apart from the food journal:
// a medicine has no calories and no place in the food score. Reminders come from push.js.
//   GET  /meds/today            { date, due: [{ key, name, time, taken }] }
//   POST /meds/taken { key }    marks it taken now (today); { key, undo: true } takes the mark back
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const SW = require('./sleep-window');

const MEDS = [
  { key: 'eye_am', name: 'Eye drops (AM)', short: 'eye drops', at: R => R.wake + 15 },
  { key: 'bp', name: 'Blood pressure medicine', short: 'BP medicine', at: R => R.bed - 30 },
  { key: 'eye_pm', name: 'Eye drops (PM)', short: 'eye drops', at: R => R.bed - 30 }
];
const key = date => 'meds-' + date;

// the day's medicines with their times and whether each is taken; pure, given the taken map
function dueFor(date, taken, win) {
  const R = win || SW.DEFAULT_RULES, t = taken || {};
  return MEDS.map(m => ({ key: m.key, name: m.name, short: m.short, time: SW.toHM(m.at(R)), taken: !!t[m.key], taken_at: t[m.key] || null }))
    .sort((a, b) => a.time.localeCompare(b.time));
}
async function today() {
  const date = tz.todayKey();
  const [doc, win] = await Promise.all([getJSON(key(date), { taken: {} }), SW.get().catch(() => null)]);
  return { date, due: dueFor(date, doc.taken, win) };
}
async function mark(k, undo) {
  if (!MEDS.some(m => m.key === k)) { const e = new Error('unknown medicine: ' + k); e.status = 400; throw e; }
  const date = tz.todayKey();
  const doc = await getJSON(key(date), { taken: {} });
  doc.taken = doc.taken || {};
  if (undo) delete doc.taken[k]; else if (!doc.taken[k]) doc.taken[k] = new Date().toISOString();
  await setJSON(key(date), doc);
  return today();
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/meds/today', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await today()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/meds/taken', async (req, res) => { if (!auth(req, res)) return;
    try { const b = req.body || {}; res.json(Object.assign({ ok: true }, await mark(String(b.key || ''), !!b.undo))); }
    catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, MEDS, dueFor, today, mark };
