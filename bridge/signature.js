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
// Decay, the part of Xert's signature that works between breakthroughs: the signature drifts down when nothing
// renews it, so that it stays within reach and a real effort shows as a breakthrough. Xert ties its decay to
// training load and keeps the numbers to itself; here it is the plain form of the same idea. An effort counts in
// full for four weeks; after that its worth fades a percent a week, to nine tenths at the least, and at ninety days
// it leaves the window. `asOf` is the day the signature is being read for (a past day for a breakthrough check).
const DECAY_AFTER_DAYS = 28, DECAY_PER_WEEK = 0.01, DECAY_FLOOR = 0.9;
const dayGap = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const decayOf = age => age <= DECAY_AFTER_DAYS ? 1 : Math.max(DECAY_FLOOR, 1 - DECAY_PER_WEEK * (age - DECAY_AFTER_DAYS) / 7);
const pointsOf = (rides, asOf) => {
  const out = [];
  for (const dur of DURS) {
    let best = null;
    for (const r of rides) { const raw = r.mmp && r.mmp[dur]; if (!raw) continue;
      const k = asOf ? decayOf(dayGap(r.date, asOf)) : 1, v = Math.round(raw * k);
      if (!best || v > best.watts) best = { dur_s: dur, watts: v, raw_watts: raw, faded: k < 1 ? Math.round((1 - k) * 1000) / 10 : 0, date: r.date, name: r.name, id: r.id }; }
    if (best) out.push(best);
  }
  return out;
};
// The medal, Xert's: bronze when one of the three numbers rose, silver two, gold all three. A ride that came within
// 3% of the curve without beating it is a near breakthrough: it earns no medal and confirms the signature.
const NEAR = 0.97;
const medalOf = moved => { if (!moved) return null; const up = (moved.tp > 0 ? 1 : 0) + (moved.hie_kj > 0 ? 1 : 0) + (moved.pp > 0 ? 1 : 0); return up >= 3 ? 'gold' : up === 2 ? 'silver' : up === 1 ? 'bronze' : null; };
function breakthroughsOf(rides) { return scanRides(rides).list; }
function scanRides(rides) {
  const sorted = rides.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const out = [], nears = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    // a baseline needs something to stand on: three rides and eight durations before this one
    if (i < 3) continue;
    const ptsBefore = pointsOf(sorted.slice(0, i), r.date);
    if (ptsBefore.filter(p => p.dur_s >= 120).length < 8) continue;
    const before = fit(ptsBefore, { floor: false });
    if (!before || !r.mmp) continue;
    const hits = [];
    for (const dur of DURS) {
      if (dur < 60 || !r.mmp[dur]) continue;
      const curve = pd(dur, before.tp, before.hie_kj * 1000, before.pp);
      if (r.mmp[dur] > curve * 1.02 && r.mmp[dur] - curve >= 3) hits.push({ dur_s: dur, watts: r.mmp[dur], curve_watts: Math.round(curve), over_pct: Math.round((r.mmp[dur] / curve - 1) * 100) });
    }
    if (!hits.length) {
      // close to the curve without beating it: a near breakthrough
      let near = null;
      for (const dur of DURS) { if (dur < 60 || !r.mmp[dur]) continue; const curve = pd(dur, before.tp, before.hie_kj * 1000, before.pp), ratio = r.mmp[dur] / curve;
        if (ratio >= NEAR && (!near || ratio > near.ratio)) near = { dur_s: dur, watts: r.mmp[dur], curve_watts: Math.round(curve), ratio }; }
      if (near) nears.push({ id: r.id, date: r.date, name: r.name, dur_s: near.dur_s, watts: near.watts, curve_watts: near.curve_watts, under_pct: Math.max(0, Math.round((1 - near.ratio) * 1000) / 10),
        text: `${sayDur(near.dur_s)} at ${near.watts} W, within ${Math.max(0, Math.round((1 - near.ratio) * 100))}% of the ${near.curve_watts} W the signature allowed: it confirms the signature.` });
      continue;
    }
    const after = fit(pointsOf(sorted.slice(0, i + 1), r.date), { floor: false });
    const top = hits.slice().sort((a, b) => b.over_pct - a.over_pct)[0];
    const moved = after ? { tp: after.tp - before.tp, hie_kj: Math.round((after.hie_kj - before.hie_kj) * 10) / 10, pp: after.pp - before.pp } : null;
    out.push({ id: r.id, date: r.date, name: r.name, minutes: r.minutes, hits, top, medal: medalOf(moved) || 'bronze',
      before: { tp: before.tp, hie_kj: before.hie_kj, pp: before.pp },
      after: after ? { tp: after.tp, hie_kj: after.hie_kj, pp: after.pp } : null,
      moved,
      text: `${sayDur(top.dur_s)} at ${top.watts} W, where the signature said ${top.curve_watts} W was the most available (${top.over_pct}% over)` +
        (after ? `. The signature moved: TP ${before.tp} → ${after.tp} W${after.hie_kj !== before.hie_kj ? `, HIE ${before.hie_kj} → ${after.hie_kj} kJ` : ''}${after.pp !== before.pp ? `, PP ${before.pp} → ${after.pp} W` : ''}.` : '.') });
  }
  return { list: out, nears };
}
// New bests: a ride in the last two weeks that rode a length (5 minutes and up) harder than any ride before it
// in the window. Not the same as a breakthrough: a best beats what you have ridden, a breakthrough beats what
// the curve already said you could ride. Each comes with the curve's own number from before the ride.
function newBestsOf(rides, since) {
  const sorted = rides.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]; if (r.date < since || !r.mmp) continue;
    const prior = sorted.slice(0, i).filter(x => x.date < r.date);
    if (prior.length < 3) continue;
    const pts = pointsOf(prior, r.date); const sig = pts.filter(p => p.dur_s >= 120).length >= 8 ? fit(pts, { floor: false }) : null;
    for (const dur of DURS) {
      if (dur < 300 || !r.mmp[dur]) continue;
      let prev = null; for (const x of prior) { const v = x.mmp && x.mmp[dur]; if (v && (!prev || v > prev.watts)) prev = { watts: v, date: x.date, name: x.name }; }
      if (prev && r.mmp[dur] < prev.watts + 2) continue;
      const curve = sig ? Math.round(pd(dur, sig.tp, sig.hie_kj * 1000, sig.pp)) : null;
      out.push({ id: r.id, date: r.date, name: r.name, dur_s: dur, watts: r.mmp[dur], prev_watts: prev ? prev.watts : null, prev_date: prev ? prev.date : null, curve_before: curve });
    }
  }
  return out;
}
function sayDur(s) { return s < 60 ? `${s} seconds` : s % 60 === 0 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
async function breakthroughs(wantNears) {
  const d = await db();
  const today = tz.todayKey(), floor = tz.shiftKey(today, -LOOKBACK_DAYS);
  const rides = Object.values(d.rides).filter(r => r.date >= floor);
  const key = rides.map(r => r.id).sort().join(',') + '|' + floor + '|v3';
  if (d.bt && d.bt.key === key) return wantNears ? { list: d.bt.list, nears: d.bt.nears || [] } : d.bt.list;
  const S = scanRides(rides);
  d.bt = { key, list: S.list, nears: S.nears, at: Date.now() };
  await setJSON('signature', d).catch(() => {});
  return wantNears ? S : S.list;
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
      // a ride from The Way's own player: its power is in its own samples, one a second
      if (r.source === 'player') {
        const rec = await getJSON(require('./player').rideKey(r.id), null);
        const w = rec && rec.samples && Array.isArray(rec.samples.p) ? rec.samples.p.map(v => v == null ? 0 : v) : [];
        if (w.length >= 60) { d.rides[String(r.id)] = { id: r.id, date: r.date, name: r.name, minutes: r.minutes, mmp: mmpCurve(w), seconds: w.length }; read.push({ id: r.id, name: r.name, ok: true }); }
        else read.push({ id: r.id, name: r.name, ok: false, reason: 'no power samples' });
        d.scanned.push(String(r.id));
        continue;
      }
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
  // the curve is fitted to each effort at what it is worth today (faded past four weeks); the bests are as ridden
  const points = pointsOf(rides, today), rawPoints = pointsOf(rides);
  const sig = fit(points);
  const bests = {};
  for (const m of BESTS_MIN) {
    const p = rawPoints.find(x => x.dur_s === m * 60);
    bests[m] = p ? { watts: p.watts, date: p.date, name: p.name, curve: sig ? Math.round(pd(m * 60, sig.tp, sig.hie_kj * 1000, sig.pp)) : null } : null;
  }
  const scanned = await breakthroughs(true).catch(() => ({ list: [], nears: [] })), bts = scanned.list, nears = scanned.nears;
  const nbs = newBestsOf(rides, tz.shiftKey(today, -13));
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
    power: await powerOf(sig, points, rides, bts, nears, today, st).catch(() => null), nears: nears.slice(-6),
    decay: { after_days: DECAY_AFTER_DAYS, pct_per_week: DECAY_PER_WEEK * 100, floor_pct: DECAY_FLOOR * 100 },
    ramp,
    confidence, why, rides: rides.length, lookback_days: LOOKBACK_DAYS, newest_long_effort: newest ? { date: newest.date, name: newest.name, age_days: ageDays } : null,
    planning_ftp: st.ftp, bests, points, breakthroughs: bts.slice(-10), new_bests: nbs,
    curve: sig ? DURS.map(t => ({ dur_s: t, watts: Math.round(pd(t, sig.tp, sig.hie_kj * 1000, sig.pp)) })) : [],
    left: null
  };
}

// The Power box (chain.js, the Power page): the signature's threshold power as his FTP the way Xert reads it, what it
// is per kilo, where it was four weeks ago, the last breakthrough and its medal, whether the efforts that hold the
// curve up are fading, and what would be a breakthrough today at three lengths.
async function powerOf(sig, points, rides, bts, nears, today, st) {
  if (!sig) return null;
  let lb = null; try { const w = await require('./weighin').state(); const all = (w && w.all) || []; lb = all.length ? all[all.length - 1].lb : (w && w.latest ? w.latest.lb : null); } catch (e) { lb = null; }
  const kg = lb ? lb / 2.2046 : null;
  // the same reading four weeks ago, from the rides there were then
  const then = tz.shiftKey(today, -28), before = rides.filter(r => r.date <= then);
  const ptsThen = pointsOf(before, then), sigThen = ptsThen.filter(p => p.dur_s >= 120).length >= 8 ? fit(ptsThen, { floor: false }) : null;
  const last = bts.length ? bts[bts.length - 1] : null, lastNear = nears.length ? nears[nears.length - 1] : null;
  const touch = [last && last.date, lastNear && lastNear.date].filter(Boolean).sort().pop() || null;
  const binding = new Set(sig.binding_durations || []), holders = points.filter(p => binding.has(p.dur_s));
  const youngest = holders.length ? Math.min(...holders.map(p => dayGap(p.date, today))) : null;
  const fading = youngest != null && youngest > DECAY_AFTER_DAYS;
  const since = bts.filter(b => b.date >= tz.shiftKey(today, -LOOKBACK_DAYS));
  const count = m => since.filter(b => b.medal === m).length;
  const targets = [[60, '1 minute'], [300, '5 minutes'], [1200, '20 minutes']].map(([d, word]) => { const c = pd(d, sig.tp, sig.hie_kj * 1000, sig.pp); return { dur_s: d, word, curve_watts: Math.round(c), watts: Math.max(Math.ceil(c * 1.02), Math.round(c) + 3) }; });
  return { ftp: sig.tp, hie_kj: sig.hie_kj, pp: sig.pp, planning_ftp: st.ftp,
    weight_lb: lb, wkg: kg ? Math.round(sig.tp / kg * 100) / 100 : null,
    ftp_28d_ago: sigThen ? sigThen.tp : null, change_w: sigThen ? sig.tp - sigThen.tp : null,
    last_breakthrough: last ? { date: last.date, name: last.name, medal: last.medal, days_ago: dayGap(last.date, today), text: last.text } : null,
    last_near: lastNear ? { date: lastNear.date, name: lastNear.name, days_ago: dayGap(lastNear.date, today), text: lastNear.text } : null,
    days_since_touch: touch ? dayGap(touch, today) : null,
    medals: { gold: count('gold'), silver: count('silver'), bronze: count('bronze'), near: nears.length },
    fading, holders_age_days: youngest,
    fade_note: fading ? `The efforts that hold this number up are ${Math.round(youngest / 7)} weeks old, so it is fading a percent a week. One hard effort renews it.` : null,
    targets };
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

module.exports = { attach, mmpCurve, fit, pd, mpaTrace, report, scan, DURS, breakthroughs, breakthroughMap, breakthroughsOf, scanRides, newBestsOf, pointsOf, decayOf, medalOf, powerOf };
