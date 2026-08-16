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
const { getJSON, setJSON, ON_NETLIFY } = require('./storage');
const { auth } = require('./fuel-log');

const KEEP = 90 * 864e5;
const isToday = ts => new Date(ts).toDateString() === new Date().toDateString();

async function db() { return getJSON('weigh-in', { entries: [] }); }

// Local dev may already have real scale data sitting next door; read it so the
// two paths agree instead of showing different numbers on the same morning.
function withingsLocal() {
  if (ON_NETLIFY) return [];
  try {
    const w = require('./withings.json');
    return (w.weights || []).map(x => ({ ts: x.ts, lb: x.kg * 2.20462, source: 'withings' }));
  } catch { return []; }
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
    entries: all.length
  };
}

async function state() {
  const d = await db();
  const merged = d.entries.concat(withingsLocal());
  return { ...trend(merged), withings_connected: false };
}

function attach(app) {
  app.get('/weigh-in', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await state()); }
    catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/weigh-in', async (req, res) => { if (!auth(req, res)) return;
    try {
      const lb = Number((req.body || {}).lb);
      if (!lb || lb < 50 || lb > 500) return res.status(400).json({ error: 'lb required (50–500)' });
      const d = await db();
      d.entries.push({ ts: Date.now(), lb, source: 'manual' });
      d.entries = d.entries.filter(e => Date.now() - e.ts < KEEP);
      await setJSON('weigh-in', d);
      res.json({ ok: true, ...(await state()) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, state };
