// ============================================================
// macros.js — the day's macro targets, as defined by Hexis.
// Hexis has no public API, so this is an inbox, not a fetcher: the morning
// Claude-in-Chrome run reads Hexis and POSTs the numbers here. Everything
// downstream (front page, prescriptions, the coaches) reads from this store,
// so it never matters how the numbers arrived.
//   POST /macros            one day, or {days:[…]} for the periodized week
//   GET  /macros/today      today's targets (have:false until the run lands)
// See deploy/hexis-morning-run.md for the run itself.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');

const KEEP_DAYS = 60;

function dateKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
    + '-' + String(d.getDate()).padStart(2, '0');
}
async function db() { return getJSON('macros', { days: {} }); }

const num = v => (v == null || v === '' || isNaN(Number(v))) ? null : Math.round(Number(v));

// One posted day. Unknown fields are dropped rather than stored half-typed.
function clean(row) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')) ? row.date : dateKey(new Date());
  return {
    date,
    kcal: num(row.kcal),
    carbs_g: num(row.carbs_g ?? row.carbs),
    protein_g: num(row.protein_g ?? row.protein),
    fat_g: num(row.fat_g ?? row.fat),
    // Hexis periodizes: "high carb", "low carb", "rest day", etc.
    fuel_day: row.fuel_day || row.day_type || null,
    note: row.note || null,
    source: row.source || 'hexis',
    posted_at: new Date().toISOString()
  };
}

async function save(rows) {
  const d = await db();
  const saved = rows.map(clean);
  for (const r of saved) d.days[r.date] = r;
  // keep the store from growing forever
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const floor = dateKey(cutoff);
  for (const k of Object.keys(d.days)) if (k < floor) delete d.days[k];
  await setJSON('macros', d);
  return saved;
}

async function forDate(date) {
  const d = await db();
  return d.days[date] || null;
}
// Map of date -> targets, for the days the front page is drawing.
async function forDates(dates) {
  const d = await db();
  const out = {};
  for (const k of dates) if (d.days[k]) out[k] = d.days[k];
  return out;
}
// Hexis targets are the day's plan; if this morning's run never happened,
// say so rather than showing yesterday's numbers as if they were today's.
async function todayState() {
  const key = dateKey(new Date());
  const m = await forDate(key);
  return m ? { have: true, ...m } : { have: false, date: key };
}

function attach(app) {
  app.post('/macros', async (req, res) => { if (!auth(req, res)) return;
    try {
      const body = req.body || {};
      const rows = Array.isArray(body.days) ? body.days : [body];
      if (!rows.length) return res.status(400).json({ error: 'no days posted' });
      const saved = await save(rows);
      res.json({ ok: true, saved });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/macros/today', async (req, res) => { if (!auth(req, res)) return;
    res.json(await todayState()); });
  app.get('/macros', async (req, res) => { if (!auth(req, res)) return;
    const date = req.query.date;
    if (date) return res.json((await forDate(date)) || { have: false, date });
    res.json(await db()); });
}

module.exports = { attach, forDate, forDates, todayState, dateKey };
