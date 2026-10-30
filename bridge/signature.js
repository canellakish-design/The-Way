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
// The fit, Xert's way round: the signature is the LOWEST curve that stays
// above every effort of the last 90 days. A point under the curve is a
// ride that was not all-out at that length (an easy hour sits far below
// the curve and says nothing about threshold); it costs only a little, in
// proportion to the gap, so the curve settles down onto the efforts that
// were maximal. A point above the curve is a breakthrough: it costs a lot,
// so the curve is pushed up to it. That is why a 5-minute all-out and a
// 20-second all-out are enough to set TP: the short one pins PP and HIE,
// the long one then pins TP, and no hour-long test is needed.
// Without an all-out effort of 20 minutes or more, TP and HIE trade off:
// the 2 to 10 minute points fit a low TP with a big tank as well as a
// higher TP with a typical one. Xert holds HIE near where it has been and
// moves it only when a breakthrough demands it; here a soft prior does the
// same, pulling HIE toward HIE_TYPICAL unless the efforts say otherwise.
// The fit with no prior at all is kept too, as the floor TP cannot be under.
const HIE_TYPICAL = 20, HIE_PRIOR = 1;
function fit(points, o) {
  const opts = o || {};
  const pts = points.filter(p => p.dur_s >= 120 && p.watts > 0);
  const pp = Math.max((points.find(p => p.dur_s === 5) || {}).watts || 0, ...pts.map(p => p.watts)) || null;
  if (pts.length < 4 || !pp) return null;
  const longest = pts[pts.length - 1];
  const tpLo = Math.round(longest.watts * 0.9), tpHi = Math.round(Math.min(pp - 20, Math.max(...pts.map(p => p.watts))));
  const search = lam => {
    let best = null;
    for (let tp = tpLo; tp <= tpHi; tp += 1) {
      for (let hie = 4; hie <= 45; hie += 0.5) {
        const hieJ = hie * 1000;
        let err = lam * Math.pow((hie - HIE_TYPICAL) / 10, 2);
        for (const p of pts) {
          const m = pd(p.dur_s, tp, hieJ, pp), r = (m - p.watts) / p.watts;
          // a point above the curve is a breakthrough the curve must rise to: heavy. A point
          // under it pulls gently, and one more than 10% under (plainly not all-out at that
          // length, an easy hour) pulls no harder than that: Xert ignores sub-maximal data.
          err += r < 0 ? 400 * r * r : Math.min(r, 0.10);
        }
        if (!best || err < best.e) best = { tp, hie, e: err };
      }
    }
    return best;
  };
  const best = search(opts.prior == null ? HIE_PRIOR : opts.prior);
  const floor = opts.floor === false ? null : search(0);
  // how tight the curve sits on the efforts that shape it: RMS gap over the points within 5% of it
  const hieJ = best.hie * 1000;
  const gaps = pts.map(p => (pd(p.dur_s, best.tp, hieJ, pp) - p.watts) / p.watts);
  const tight = gaps.filter(g => Math.abs(g) <= 0.05);
  const rmse = tight.length ? Math.round(Math.sqrt(tight.reduce((a, g) => a + g * g, 0) / tight.length) * 1000) / 10 : null;
  return { tp: best.tp, hie_kj: best.hie, pp, rmse_pct: rmse, points: pts.length, binding: tight.length,
    tp_floor: floor ? floor.tp : null, hie_floor_kj: floor ? floor.hie : null,
    binding_durations: pts.filter((p, k) => Math.abs(gaps[k]) <= 0.05).map(p => p.dur_s) };
}

// Breakthroughs, Xert's meaning: a ride whose power at some length beat
// what the signature of the day BEFORE it predicted, so the signature
// moved up. Each ride is checked against the curve fitted to the rides
// before it (once four durations exist), and the curve fitted with it says
// how far the three numbers moved. Cached against the set of rides read.
const pointsOf = rides => {
  const out = [];
  for (const dur of DURS) {
    let best = null;
    for (const r of rides) { const v = r.mmp && r.mmp[dur]; if (v && (!best || v > best.watts)) best = { dur_s: dur, watts: v, date: r.date, name: r.name, id: r.id }; }
    if (best) out.push(best);
  }
  return out;
};
function breakthroughsOf(rides) {
  const sorted = rides.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const before = fit(pointsOf(sorted.slice(0, i)), { floor: false });
    if (!before || !r.mmp) continue;
    const hits = [];
    for (const dur of DURS) {
      if (dur < 60 || !r.mmp[dur]) continue;
      const curve = pd(dur, before.tp, before.hie_kj * 1000, before.pp);
      if (r.mmp[dur] > curve * 1.02 && r.mmp[dur] - curve >= 3) hits.push({ dur_s: dur, watts: r.mmp[dur], curve_watts: Math.round(curve), over_pct: Math.round((r.mmp[dur] / curve - 1) * 100) });
    }
    if (!hits.length) continue;
    const after = fit(pointsOf(sorted.slice(0, i + 1)), { floor: false });
    const top = hits.slice().sort((a, b) => b.over_pct - a.over_pct)[0];
    out.push({ id: r.id, date: r.date, name: r.name, minutes: r.minutes, hits, top,
      before: { tp: before.tp, hie_kj: before.hie_kj, pp: before.pp },
      after: after ? { tp: after.tp, hie_kj: after.hie_kj, pp: after.pp } : null,
      moved: after ? { tp: after.tp - before.tp, hie_kj: Math.round((after.hie_kj - before.hie_kj) * 10) / 10, pp: after.pp - before.pp } : null,
      text: `${sayDur(top.dur_s)} at ${top.watts} W, where the signature said ${top.curve_watts} W was the most available (${top.over_pct}% over)` +
        (after ? `. The signature moved: TP ${before.tp} → ${after.tp} W${after.hie_kj !== before.hie_kj ? `, HIE ${before.hie_kj} → ${after.hie_kj} kJ` : ''}${after.pp !== before.pp ? `, PP ${before.pp} → ${after.pp} W` : ''}.` : '.') });
  }
  return out;
}
function sayDur(s) { return s < 60 ? `${s} seconds` : s % 60 === 0 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
async function breakthroughs() {
  const d = await db();
  const today = tz.todayKey(), floor = tz.shiftKey(today, -LOOKBACK_DAYS);
  const rides = Object.values(d.rides).filter(r => r.date >= floor);
  const key = rides.map(r => r.id).sort().join(',') + '|' + floor;
  if (d.bt && d.bt.key === key) return d.bt.list;
  const list = breakthroughsOf(rides);
  d.bt = { key, list, at: Date.now() };
  await setJSON('signature', d).catch(() => {});
  return list;
}
async function breakthroughMap() {
  const list = await breakthroughs();
  const m = {};
  for (const b of list) m[String(b.id)] = b;
  return m;
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
  const bts = await breakthroughs().catch(() => []);
  const newest = points.filter(p => p.dur_s >= 1200).sort((a, b) => b.date.localeCompare(a.date))[0];
  const ageDays = newest ? Math.round((new Date(today) - new Date(newest.date)) / 864e5) : null;
  // What sets the curve. The short end (20 s to 1 min) pins PP and HIE; a
  // 3 to 10 minute effort then pins TP. Both are judged by whether a point
  // of that length is binding (on the curve) and looks maximal for its
  // length: the mid effort well above TP, the short one well above that.
  const binding = sig ? new Set(sig.binding_durations) : new Set();
  const midEvidence = sig && points.some(p => p.dur_s >= 180 && p.dur_s <= 600 && binding.has(p.dur_s) && p.watts >= sig.tp * 1.10);
  const shortEvidence = sig && points.some(p => p.dur_s >= 20 && p.dur_s <= 60 && p.watts >= sig.tp * 1.8);
  const longEvidence = sig && points.some(p => p.dur_s >= 1200 && binding.has(p.dur_s) && p.watts >= sig.tp * 0.97);
  const recent = bts.some(b => b.date >= tz.shiftKey(today, -42));
  // High needs the two efforts AND a breakthrough inside six weeks: a curve that nothing
  // has beaten lately sits on old data, and whether those efforts were all-out cannot be
  // read from the numbers alone.
  const confidence = !sig ? 'none' : rides.length < 5 ? 'low' : (midEvidence && shortEvidence && recent) ? 'high' : (midEvidence || longEvidence) ? 'medium' : 'low';
  const spread = sig && sig.tp_floor != null && sig.tp_floor !== sig.tp ? ` TP reads ${sig.tp} W with a typical tank (HIE ${sig.hie_kj} kJ) and ${sig.tp_floor} W if the tank is as big as ${sig.hie_floor_kj} kJ; only an all-out 20 minutes or more settles which.` : '';
  const why = !sig ? 'Fewer than four durations of two minutes or more have been read yet.'
    : confidence === 'high' ? `A 3 to 10 minute all-out effort and a short one both sit on the curve, and a breakthrough inside six weeks tested it${sig.rmse_pct != null ? `; the fit on them is within ${sig.rmse_pct}%` : ''}.`
    : midEvidence && shortEvidence ? `A 3 to 10 minute effort and a short one shape the curve, but nothing has beaten it in six weeks, so it rests on old rides and may be drifting.${spread}`
    : midEvidence ? `A 3 to 10 minute effort shapes the curve, but no short all-out effort (20 seconds to a minute) has pinned PP and HIE, so TP leans on the model.${spread}`
    : longEvidence ? 'Long steady riding sits on the curve, so TP is a floor; one all-out 5-minute effort and one 20-second one would set it.'
    : 'Nothing in the last 90 days was all-out at any length, so TP is a floor, not a measurement: the lowest curve that stays above every ride. One all-out 5-minute effort and one 20-second effort would set it.';
  // A ramp test in the window is its own reading: FTP about 75% of the best minute of it.
  const rampRide = rides.filter(r => /ramp/i.test(r.name || '') && r.mmp && r.mmp[60]).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
  const ramp = rampRide ? { date: rampRide.date, name: rampRide.name, one_min_w: rampRide.mmp[60], ftp_est: Math.round(rampRide.mmp[60] * 0.75) } : null;
  return {
    signature: sig ? { tp: sig.tp, hie_kj: sig.hie_kj, pp: sig.pp, rmse_pct: sig.rmse_pct, points: sig.points, tp_floor: sig.tp_floor, hie_floor_kj: sig.hie_floor_kj } : null,
    ramp,
    confidence, why, rides: rides.length, lookback_days: LOOKBACK_DAYS, newest_long_effort: newest ? { date: newest.date, name: newest.name, age_days: ageDays } : null,
    planning_ftp: st.ftp, bests, points, breakthroughs: bts.slice(-10),
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

module.exports = { attach, mmpCurve, fit, pd, mpaTrace, report, scan, DURS, breakthroughs, breakthroughMap, breakthroughsOf, pointsOf };
