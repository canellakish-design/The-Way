// The 8 a.m. check (Eastern): whatever the 30-minute pulls did overnight, at eight the site reads the
// night again from both devices, WHOOP (sleep and recovery) and the Garmin through intervals.icu (HRV,
// resting heart rate, sleep, readiness), recomputes the morning's score and keeps a record of what each
// said. Netlify's clock is UTC, so it fires at 12:00 and 13:00 UTC and only the one that is 8 a.m. in
// New York runs; the other returns at once.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default async () => {
  const tz = require('../../bridge/tz.js');
  const { getJSON, setJSON } = require('../../bridge/storage.js');
  const p = tz.parts(new Date());
  if (p.h !== 8) return new Response(JSON.stringify({ ok: true, skipped: `it is ${tz.hm12(String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'))} Eastern, not 8 a.m.` }), { headers: { 'Content-Type': 'application/json' } });
  const out = { at: new Date().toISOString(), date: tz.todayKey(), whoop: null, garmin: null, shown: null };
  // 1. WHOOP: a forced pull, so a token that died overnight is found now, not at noon
  try {
    const W = require('../../bridge/whoop.js');
    const r = await W.sleepLatest({ sync: true });
    const d = await getJSON('whoop', {});
    out.whoop = { ok: !d.auth_error, synced_at: d.synced_at || null, error: d.auth_error ? d.auth_error.detail : null,
      recovery: r && r.recovery ? r.recovery.score : null, sleep_h: r && r.sleep ? r.sleep.hours : null };
  } catch (e) { out.whoop = { ok: false, error: e.message }; }
  // 2. the Garmin, through intervals.icu: today's row
  try {
    const iv = require('../../bridge/intervals.js');
    if (iv.configured()) {
      const w = await iv.wellnessRange(tz.shiftKey(tz.todayKey(), -1), tz.todayKey());
      const rows = (w.days || []).filter(d => d.hrv != null || d.rhr != null || d.sleep_h != null);
      const latest = rows[rows.length - 1] || null;
      out.garmin = latest ? { ok: true, date: latest.date, synced_at: latest.updated || null, readiness: latest.readiness ?? null, hrv: latest.hrv ?? null, rhr: latest.rhr ?? null, sleep_h: latest.sleep_h ?? null }
        : { ok: false, error: 'no row for today or yesterday on intervals.icu' };
    } else out.garmin = { ok: false, error: 'intervals.icu is not configured' };
  } catch (e) { out.garmin = { ok: false, error: e.message }; }
  // 3. the score the site shows this morning, recomputed
  try {
    const base = (process.env.URL || '').replace(/\/$/, '');
    if (base) {
      const r = await fetch(base + '/.netlify/functions/api/scores', { headers: { 'x-the-way-app': '1' } });
      const j = await r.json();
      out.shown = { source: j.sources && j.sources.recovery ? j.sources.recovery.source : null, score: j.recovery ? j.recovery.score : null, hrv: j.recovery ? j.recovery.hrv : null, sleep_h: j.recovery ? j.recovery.sleep_h : null };
    }
  } catch (e) { out.shown = { error: e.message }; }
  const log = await getJSON('morning-check', { runs: [] });
  log.last = out; log.runs = (log.runs || []).concat([out]).slice(-30);
  await setJSON('morning-check', log).catch(() => {});
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
};

export const config = { schedule: '0 12,13 * * *' };
