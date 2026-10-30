// ============================================================
// signature.js — the fitness signature, Xert's way, from his own power.
//
// Three numbers describe what he can do on a bike:
//   TP   threshold power, watts: what the aerobic engine holds
//   HIE  high-intensity energy, kilojoules: the tank of work above TP
//   PP   peak power, watts: the most for a second or two
// From them, the whole power-duration curve (Morton's three-parameter
// critical-power model, the form Xert publishes):
//   P(t) = TP + (HIE / t) · (1 − e^(−t · (PP − TP) / HIE))
// which runs to PP as t → 0 and to TP as t grows.
//
// The curve is fitted to his mean-maximal power: for every ride with power
// in the last 90 days, the best average over each of 26 durations (1 s to
// 90 min), and the best of those across the rides. PP is read straight off
// the 5-second best; TP and HIE are the least-squares fit to the points of
// two minutes and longer, weighted toward the long end, since TP is what
// the plan runs on.
//
// Maximal Power Available (MPA): second by second, the most he could put
// out right then. Above TP the tank drains at (P − TP) joules a second;
// below TP it refills in proportion to what is missing (Skiba 2015's
// differential form). MPA sits at PP with a full tank and falls to TP as it
// empties. Power above MPA is a breakthrough: the signature was wrong, low,
// and the ride says so. Xert's own recovery curve is proprietary; this is
// the published physiology it is built on, and his rides tune it.
//
// Honesty: a signature is only as fresh as its last real effort. Weeks of
// Zone 1 riding leave the long-duration points low, so TP reads as a floor.
// The report says how old the points are and how well the curve fits, and
// it never writes the planning FTP; that stays his to set.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const Z = require('./zones');

const DURS = [1, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600, 720, 900, 1200, 1500, 1800, 2400, 3000, 3600, 4500, 5400];
const LOOKBACK_DAYS = 90;
const BESTS_MIN = [20, 30, 40, 50, 60];

// mean-maximal power at each duration, by prefix sums: O(n) per duration
function mmpCurve(watts) {
  const n = watts.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + (watts[i] || 0);
  const out = {};
  for (const d of DURS) {
    if (d > n) break;
    let best = 0;
    for (let i = 0; i + d <= n; i++) { const v = pre[i + d] - pre[i]; if (v > best) best = v; }
    out[d] = Math.round(best / d);
  }
  return out;
}

function pd(t, tp, hieJ, pp) {
  if (t <= 0) return pp;
  const k = (pp - tp) / hieJ;
  return tp + (hieJ / t) * (1 - Math.exp(-t * k));
}

// Fit TP and HIE to the points of two minutes and up; PP from the 5-s best.
function fit(points) {
  const pts = points.filter(p => p.dur_s >= 120 && p.watts > 0);
  const pp = Math.max((points.find(p => p.dur_s === 5) || {}).watts || 0, ...pts.map(p => p.watts)) || null;
  if (pts.length < 4 || !pp) return null;
  const longest = pts[pts.length - 1];
  const weight = p => Math.log(p.dur_s / 60 + 1);          // the long end counts for more
  let best = null;
  const tpLo = Math.round(longest.watts * 0.7), tpHi = Math.round(Math.min(pp - 20, longest.watts * 1.4));
  for (let tp = tpLo; tp <= tpHi; tp += 1) {
    for (let hie = 4; hie <= 45; hie += 0.5) {
      const hieJ = hie * 1000;
      let err = 0, wsum = 0;
      for (const p of pts) {
        // the curve may sit above a point (he never tested that duration) at
        // small cost; a point above the curve is a breakthrough and costs full
        const m = pd(p.dur_s, tp, hieJ, pp), r = (m - p.watts) / p.watts;
        const w = weight(p) * (r > 0 ? 0.35 : 1);
        err += w * r * r; wsum += w;
      }
      const e = err / wsum;
      if (!best || e < best.e) best = { tp, hie, e };
    }
  }
  const rmse = Math.round(Math.sqrt(best.e) * 1000) / 10;   // % of the point
  return { tp: best.tp, hie_kj: best.hie, pp, rmse_pct: rmse, points: pts.length };
}

// MPA through a ride; breakthroughs are seconds above it.
function mpaTrace(watts, sig, step) {
  const tp = sig.tp, hieJ = sig.hie_kj * 1000, pp = sig.pp;
  let w = hieJ, over = 0, maxOverPct = 0, minMpa = pp, lowest = pp;
  const trace = [];
  for (let i = 0; i < watts.length; i++) {
    const p = watts[i] || 0;
    if (p > tp) w = Math.max(0, w - (p - tp));
    else w = Math.min(hieJ, w + (hieJ - w) * (tp - p) / hieJ);
    const mpa = tp + (pp - tp) * (w / hieJ);
    if (mpa < lowest) lowest = mpa;
    if (p > mpa + 2) { over++; maxOverPct = Math.max(maxOverPct, Math.round((p - mpa) / mpa * 100)); }
    if (step && i % step === 0) trace.push({ t: i, p, mpa: Math.round(mpa) });
    minMpa = Math.min(minMpa, mpa);
  }
  return { over_s: over, max_over_pct: maxOverPct, lowest_mpa: Math.round(lowest), tank_left_kj: Math.round(w / 100) / 10, trace };
}

async function db() { return getJSON('signature', { rides: {}, scanned: [] }); }

// Read a few unread rides' streams and store their MMP curves.
async function scan(n) {
  const W = require('./workout-math');
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const { stravaDone } = require('./workouts');
  const today = tz.todayKey();
  const done = await stravaDone(tz.shiftKey(today, -LOOKBACK_DAYS), today, st).catch(() => ({ connected: false, rides: [] }));
  const d = await db();
  const todo = (done.rides || []).filter(r => !d.scanned.includes(String(r.id))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, n || 3);
  const read = [];
  for (const r of todo) {
    try {
      const s = await require('./strava').apiFetch(`/activities/${r.id}/streams?keys=time,watts&key_by_type=true`);
      const watts = s && s.watts && s.watts.data;
      if (watts && watts.length >= 60) {
        const w = Z.resample1Hz(s.time && s.time.data, watts);
        d.rides[String(r.id)] = { id: r.id, date: r.date, name: r.name, minutes: r.minutes, mmp: mmpCurve(w), seconds: w.length };
        read.push({ id: r.id, name: r.name, ok: true });
      } else read.push({ id: r.id, name: r.name, ok: false, reason: 'no power stream' });
    } catch (e) { read.push({ id: r.id, name: r.name, ok: false, reason: e.message }); }
    d.scanned.push(String(r.id));
  }
  // forget rides that fell out of the window
  const floor = tz.shiftKey(today, -LOOKBACK_DAYS - 7);
  for (const k of Object.keys(d.rides)) if (d.rides[k].date < floor) { delete d.rides[k]; d.scanned = d.scanned.filter(x => x !== k); }
  await setJSON('signature', d);
  const left = (done.rides || []).filter(r => !d.scanned.includes(String(r.id))).length;
  return { read, left, total: (done.rides || []).length, connected: !!done.connected };
}

// The signature from everything read so far.
async function report() {
  const W = require('./workout-math');
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const d = await db();
  const today = tz.todayKey(), floor = tz.shiftKey(today, -LOOKBACK_DAYS);
  const rides = Object.values(d.rides).filter(r => r.date >= floor).sort((a, b) => a.date.localeCompare(b.date));
  const points = [];
  for (const dur of DURS) {
    let best = null;
    for (const r of rides) { const v = r.mmp && r.mmp[dur]; if (v && (!best || v > best.watts)) best = { dur_s: dur, watts: v, date: r.date, name: r.name, id: r.id }; }
    if (best) points.push(best);
  }
  const sig = fit(points);
  const bests = {};
  for (const m of BESTS_MIN) {
    const p = points.find(x => x.dur_s === m * 60);
    bests[m] = p ? { watts: p.watts, date: p.date, name: p.name, curve: sig ? Math.round(pd(m * 60, sig.tp, sig.hie_kj * 1000, sig.pp)) : null } : null;
  }
  // the ride-by-ride breakthrough check against the fitted signature
  let breakthroughs = [];
  if (sig) {
    for (const r of rides) {
      // a ride breaks through when any of its own MMP points sits above the curve by 3% or more
      const hits = DURS.filter(dur => r.mmp[dur] && r.mmp[dur] > pd(dur, sig.tp, sig.hie_kj * 1000, sig.pp) * 1.03 && dur >= 60);
      if (hits.length) breakthroughs.push({ date: r.date, name: r.name, id: r.id, durations_s: hits });
    }
  }
  const newest = points.filter(p => p.dur_s >= 1200).sort((a, b) => b.date.localeCompare(a.date))[0];
  const ageDays = newest ? Math.round((new Date(today) - new Date(newest.date)) / 864e5) : null;
  const hardEvidence = sig && points.some(p => p.dur_s >= 180 && p.dur_s <= 600 && p.watts >= sig.tp * 1.12);
  const longEvidence = sig && points.some(p => p.dur_s >= 1200 && p.watts >= sig.tp * 0.97);
  const confidence = !sig ? 'none' : rides.length < 5 ? 'low' : (hardEvidence && longEvidence && sig.rmse_pct < 6) ? 'high' : (hardEvidence || longEvidence) ? 'medium' : 'low';
  const why = !sig ? 'Fewer than four durations of two minutes or more have been read yet.'
    : confidence === 'high' ? `A hard effort and a long steady one both sit on the curve; the fit is within ${sig.rmse_pct}%.`
    : !hardEvidence && !longEvidence ? 'Every point came from easy riding, so TP is a floor: nothing in the last 90 days tested it. One 8 to 20 minute hard effort would set it.'
    : !longEvidence ? 'The short efforts shape the curve but no ride held near TP for 20 minutes or more, so TP leans on the model.'
    : 'Long steady riding pins TP; no short effort has tested PP and HIE, which are read from the curve more than from him.';
  return {
    signature: sig ? { tp: sig.tp, hie_kj: sig.hie_kj, pp: sig.pp, rmse_pct: sig.rmse_pct, points: sig.points } : null,
    confidence, why, rides: rides.length, lookback_days: LOOKBACK_DAYS, newest_long_effort: newest ? { date: newest.date, name: newest.name, age_days: ageDays } : null,
    planning_ftp: st.ftp, bests, points, breakthroughs: breakthroughs.slice(-10),
    curve: sig ? DURS.map(t => ({ dur_s: t, watts: Math.round(pd(t, sig.tp, sig.hie_kj * 1000, sig.pp)) })) : [],
    left: null
  };
}

function attach(app) {
  app.get('/signature', async (req, res) => { if (!auth(req, res)) return;
    try {
      const r = await report();
      // how many rides are still unread, so the page can offer to read on
      try {
        const W = require('./workout-math'); const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
        const { stravaDone } = require('./workouts'); const today = tz.todayKey();
        const done = await stravaDone(tz.shiftKey(today, -LOOKBACK_DAYS), today, st); const d = await db();
        r.left = (done.rides || []).filter(x => !d.scanned.includes(String(x.id))).length; r.total = (done.rides || []).length; r.connected = !!done.connected;
      } catch (e) { r.left = null; }
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/signature/scan', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await scan(Math.max(1, Math.min(4, Number((req.body || {}).n) || 3)))); } catch (e) { res.status(500).json({ error: e.message }); } });
  // one ride's MPA trace, for the chart over its power
  app.get('/signature/ride/:id', async (req, res) => { if (!auth(req, res)) return;
    try {
      const r = await report(); if (!r.signature) return res.status(400).json({ error: 'no signature yet' });
      const s = await require('./strava').apiFetch(`/activities/${req.params.id}/streams?keys=time,watts&key_by_type=true`);
      const watts = s && s.watts && s.watts.data; if (!watts) return res.status(404).json({ error: 'no power stream' });
      const w = Z.resample1Hz(s.time && s.time.data, watts);
      res.json(Object.assign({ id: req.params.id, seconds: w.length, signature: r.signature }, mpaTrace(w, r.signature, Math.max(1, Math.round(w.length / 600)))));
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, mmpCurve, fit, pd, mpaTrace, report, scan, DURS };
