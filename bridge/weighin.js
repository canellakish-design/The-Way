// ============================================================
// weighin.js — the morning weigh-in, storage-backed so it works hosted.
// withings-weight.js is the eventual automatic path, but it writes to a real
// disk and is only mounted locally, so on Netlify there is no weight at all
// until Withings is wired up. This module is the honest interim: the number
// is entered by hand, stored like everything else, and the front page shows
// where it came from. When Withings lands, it can write here and nothing
// downstream has to change.
//   GET  /weigh-in     today's weigh-in + 7-day trend
//   POST /weigh-in     { lb }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const { auth } = require('./fuel-log');

const KEEP = 365 * 864e5;
// Where the program starts. The scale readings tell you where you are; this is
// what "down 12 lb" is measured against. Override per-deployment with the env
// var, or once at runtime with POST /weigh-in/start.
const START_LB = Number(process.env.START_WEIGHT_LB || 210);
const isToday = ts => tz.isToday(new Date(ts));

async function db() { return getJSON('weigh-in', { entries: [] }); }

// The scale writes into this same store (see withings-weight.js), so nothing
// downstream has to care whether a number was weighed or typed.
const KG_TO_LB = 2.20462;
async function withingsEntries() {
  try {
    const w = await getJSON('withings', { weights: [] });
    return (w.weights || []).map(x => ({
      ts: x.ts, lb: x.kg * KG_TO_LB, source: 'withings',
      // Carry composition here too: this path is what's read when the mirror
      // into the weigh-in store hasn't run, and dropping it would show a
      // weight with no body composition for no reason.
      fat_pct: x.fat_pct ?? null,
      fat_mass_lb: x.fat_mass_kg != null ? x.fat_mass_kg * KG_TO_LB : null,
      fat_free_lb: x.fat_free_kg != null ? x.fat_free_kg * KG_TO_LB : null,
      muscle_lb: x.muscle_kg != null ? x.muscle_kg * KG_TO_LB : null,
      water_lb: x.water_kg != null ? x.water_kg * KG_TO_LB : null,
      bone_lb: x.bone_kg != null ? x.bone_kg * KG_TO_LB : null
    }));
  } catch { return []; }
}

// A single day's reading bounces a pound or two on water alone, so direction
// comes from the 7-day average against the week before it, not from today
// against yesterday. Inside the flat band it says holding rather than
// inventing a trend out of noise.
const FLAT_BAND_LB = 0.3;
function direction(ma7, prev7) {
  if (ma7 == null || prev7 == null) return { arrow: '·', word: 'not enough data yet', tone: 'muted' };
  const delta = ma7 - prev7;
  if (Math.abs(delta) < FLAT_BAND_LB) return { arrow: '→', word: 'holding', tone: 'muted', delta };
  // The goal is weight loss, so down is the good direction. If that ever
  // changes, this is the one place that decides which way is good.
  return delta < 0
    ? { arrow: '↓', word: 'losing', tone: 'good', delta }
    : { arrow: '↑', word: 'gaining', tone: 'bad', delta };
}

const COMP_FIELDS = ['fat_pct', 'fat_mass_lb', 'fat_free_lb', 'muscle_lb', 'water_lb', 'bone_lb'];
// The latest reading that actually carried body composition — a hand-typed
// weight has none, and shouldn't blank out what the scale last reported.
function latestComposition(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (COMP_FIELDS.some(f => e[f] != null)) {
      const out = { at: new Date(e.ts).toISOString() };
      for (const f of COMP_FIELDS) if (e[f] != null) out[f] = Math.round(e[f] * 10) / 10;
      return out;
    }
  }
  return null;
}

function trend(entries) {
  const all = entries.slice().sort((a, b) => a.ts - b.ts);
  const latest = all.length ? all[all.length - 1] : null;
  const since = ms => all.filter(e => Date.now() - e.ts < ms);
  const avg = xs => xs.length ? xs.reduce((a, e) => a + e.lb, 0) / xs.length : null;
  const ma7 = avg(since(7 * 864e5));
  const prev7 = avg(all.filter(e => {
    const age = Date.now() - e.ts;
    return age >= 7 * 864e5 && age < 14 * 864e5;
  }));
  return {
    latest: latest ? {
      lb: Math.round(latest.lb * 10) / 10,
      at: new Date(latest.ts).toISOString(),
      logged_today: isToday(latest.ts),
      source: latest.source || 'manual'
    } : null,
    ma7_lb: ma7 == null ? null : Math.round(ma7 * 10) / 10,
    week_change_lb: (ma7 == null || prev7 == null) ? null : Math.round((ma7 - prev7) * 10) / 10,
    direction: direction(ma7, prev7),
    composition: latestComposition(all),
    readings_7d: since(7 * 864e5).length,
    entries: all.length
  };
}

async function state() {
  const d = await db();
  // Dedupe: Withings mirrors its readings into this store, so the same weigh-in
  // can appear on both sides. Same source within a minute is the same reading.
  const mirrored = await withingsEntries();
  const merged = d.entries.concat(
    mirrored.filter(m => !d.entries.some(e => e.source === 'withings' && Math.abs(e.ts - m.ts) < 60000)));
  const t = trend(merged);
  const start = d.start_lb || START_LB;
  let withings_connected = false;
  try { withings_connected = await require('./withings-weight').connected(); } catch (e) { /* not configured */ }
  return {
    ...t,
    start_lb: start,
    change_since_start_lb: t.latest ? Math.round((t.latest.lb - start) * 10) / 10 : null,
    withings_connected
  };
}

function attach(app) {
  app.get('/weigh-in', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await state()); }
    catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/weigh-in/start', async (req, res) => { if (!auth(req, res)) return;
    try {
      const lb = Number((req.body || {}).lb);
      if (!lb || lb < 50 || lb > 500) return res.status(400).json({ error: 'lb required (50–500)' });
      const d = await db();
      d.start_lb = lb;
      await setJSON('weigh-in', d);
      res.json({ ok: true, ...(await state()) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/weigh-in', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      const lb = Number(b.lb);
      if (!lb || lb < 50 || lb > 500) return res.status(400).json({ error: 'lb required (50–500)' });
      // Composition is optional, and any source can supply it — an Apple
      // Shortcut reading Health, a sync run, or the scale via Withings. The
      // box doesn't care which; it only needs the numbers.
      const num = (v, max) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 10) / 10 : null;
      };
      const d = await db();
      d.entries.push({ ts: b.at ? Date.parse(b.at) || Date.now() : Date.now(), lb,
        source: b.source || 'manual',
        fat_pct: num(b.fat_pct, 75), fat_mass_lb: num(b.fat_mass_lb, 300),
        fat_free_lb: num(b.fat_free_lb, 400), muscle_lb: num(b.muscle_lb, 400),
        water_lb: num(b.water_lb, 400), bone_lb: num(b.bone_lb, 50) });
      d.entries = d.entries.filter(e => Date.now() - e.ts < KEEP);
      await setJSON('weigh-in', d);
      res.json({ ok: true, ...(await state()) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, state, direction, trend };
