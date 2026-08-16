// ============================================================
// zones.js — FTP, threshold HR and zone math. Pure functions, no I/O, so the
// whole pipeline can be tested against synthetic streams.
// Implements the FTP / HR Zone / Power Zone spec:
//   §2a test-derived FTP · §2b power-only eFTP · §2c ventilatory FTP
//   §2d reconciliation · §3 threshold HR · §4 power zones · §5 HR zones
// ============================================================

// Tymewear's ramp stages are 3 minutes, too short to accumulate the fatigue a
// real 60-minute effort does, so raw VT2 overestimates sustainable power by
// 5–10%. 0.925 is the midpoint of the validated 0.90–0.95 range.
const VT2_DISCOUNT = 0.925;

// §2b lookback and decay. An effort that hasn't been repeated is worth a
// little less each week — the estimate should track current fitness, not a
// lifetime peak — but it decays, it doesn't fall off a cliff at 90 days.
const LOOKBACK_DAYS = 90;
const DECAY_PER_WEEK = 0.01;
const DECAY_FLOOR = 0.85;

// A dedicated test stays authoritative for this long (§2d.1).
const TEST_FRESH_DAYS = 60;

// Divergence that earns a "consider retesting" prompt (§2d.3).
const RETEST_DIVERGENCE = 0.05;

const DAY_MS = 864e5;
const daysBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / DAY_MS;

/* ---------------- streams ---------------- */

// Strava/FIT streams can have gaps and stopped time. Resample onto a 1 Hz grid
// so every window length below means real seconds, not sample counts.
function resample1Hz(time, values) {
  if (!Array.isArray(values) || !values.length) return [];
  if (!Array.isArray(time) || time.length !== values.length) return values.map(v => Number(v) || 0);
  const out = [];
  const end = time[time.length - 1];
  let i = 0;
  for (let t = time[0]; t <= end; t++) {
    while (i < time.length - 1 && time[i + 1] <= t) i++;
    // A gap longer than 5s is stopped time, not coasting — count it as zero.
    const gap = t - time[i];
    out.push(gap > 5 ? 0 : (Number(values[i]) || 0));
  }
  return out;
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

// Normalized Power: 30s rolling average, raised to the 4th power, averaged,
// 4th root. The standard weighting for how metabolically costly a ride was.
function normalizedPower(watts) {
  if (!watts || watts.length < 30) return null;
  let sum = 0;
  const roll = [];
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i];
    if (i >= 30) sum -= watts[i - 30];
    if (i >= 29) roll.push(sum / 30);
  }
  if (!roll.length) return null;
  return Math.round(Math.pow(mean(roll.map(v => Math.pow(v, 4))), 0.25));
}

// Best normalized power for a window of `seconds`, plus where it happened, so
// the matching HR can be pulled from the same window.
function bestWindow(watts, seconds) {
  if (!watts || watts.length < seconds) return null;
  let best = null;
  // Coarse stride keeps a 5-hour ride cheap; 15s granularity is far finer
  // than the noise in the underlying estimate.
  const stride = watts.length > 7200 ? 15 : 5;
  for (let start = 0; start + seconds <= watts.length; start += stride) {
    const slice = watts.slice(start, start + seconds);
    const np = normalizedPower(slice);
    if (np == null) continue;
    if (!best || np > best.np) best = { np, start, seconds, avg: Math.round(mean(slice)) };
  }
  return best;
}

/* ---------------- §2b power-only eFTP ---------------- */

// The spec anchors two corrections: ×0.95 for a 20-minute best, none for a
// genuine 45–60 minute effort. Between those it interpolates linearly rather
// than stepping, so a 30-minute effort isn't treated as either extreme.
function durationCorrection(minutes) {
  if (minutes <= 20) return 0.95;
  if (minutes >= 45) return 1.0;
  return 0.95 + 0.05 * (minutes - 20) / 25;
}

const EFFORT_MINUTES = [20, 30, 40, 45, 60];
// Variability index (NP / average) above this is a ragged effort — intervals
// or a group ride, not a sustainable steady state worth reading FTP off.
const MAX_VI = 1.2;

// Every qualifying sustained effort in one ride, best estimate first.
function effortsFromRide(watts, hr, meta) {
  const efforts = [];
  const totalMin = watts.length / 60;
  for (const m of EFFORT_MINUTES) {
    if (totalMin < m) continue;
    const w = bestWindow(watts, m * 60);
    if (!w || !w.avg) continue;
    const vi = w.np / w.avg;
    const estimate = Math.round(w.np * durationCorrection(m));
    const hrSlice = hr && hr.length >= w.start + w.seconds ? hr.slice(w.start, w.start + w.seconds) : null;
    efforts.push({
      minutes: m, np: w.np, avg_watts: w.avg, vi: Math.round(vi * 100) / 100,
      estimate, qualifying: vi <= MAX_VI,
      avg_hr: hrSlice ? Math.round(mean(hrSlice.filter(Boolean))) || null : null,
      activity_id: meta && meta.activity_id, at: (meta && meta.at) || new Date().toISOString(),
      name: meta && meta.name
    });
  }
  return efforts.sort((a, b) => b.estimate - a.estimate);
}

function decayFor(ageDays) {
  return Math.max(DECAY_FLOOR, 1 - (DECAY_PER_WEEK / 7) * Math.max(0, ageDays));
}

// Decayed peak across the lookback window: the best effort still standing,
// discounted for how long ago it was set.
function eftpFromEfforts(efforts, now) {
  const t = now || new Date().toISOString();
  const live = (efforts || []).filter(e => e.qualifying && daysBetween(e.at, t) <= LOOKBACK_DAYS);
  if (!live.length) return null;
  let best = null;
  for (const e of live) {
    const age = daysBetween(e.at, t);
    const value = e.estimate * decayFor(age);
    if (!best || value > best.value) best = { value, effort: e, age };
  }
  return {
    ftp: Math.round(best.value),
    from: { minutes: best.effort.minutes, np: best.effort.np, estimate: best.effort.estimate,
      at: best.effort.at, activity_id: best.effort.activity_id, name: best.effort.name },
    avg_hr: best.effort.avg_hr,
    decay: Math.round(decayFor(best.age) * 1000) / 1000,
    efforts_considered: live.length
  };
}

/* ---------------- §2c ventilatory ---------------- */

// Breathing lags power by 20–60+ seconds, so the head of every steady block is
// still reflecting the previous effort. Trim it before averaging.
const SEGMENT_MIN_S = 180, SEGMENT_TRIM_S = 75;
// A block counts as steady while power stays within this band of its own mean.
const STEADY_TOLERANCE = 0.08;

function steadySegments(watts, ve, meta, opts) {
  const o = Object.assign({ minSeconds: SEGMENT_MIN_S, trimSeconds: SEGMENT_TRIM_S, tolerance: STEADY_TOLERANCE }, opts || {});
  const segs = [];
  let start = 0;
  const flush = (end) => {
    const len = end - start;
    if (len < o.minSeconds + o.trimSeconds) return;
    const p = watts.slice(start + o.trimSeconds, end);
    const v = ve.slice(start + o.trimSeconds, end).filter(x => Number.isFinite(x) && x > 0);
    if (!p.length || v.length < p.length / 2) return;
    segs.push({
      power: Math.round(mean(p)), ve: Math.round(mean(v) * 10) / 10, seconds: p.length,
      at: (meta && meta.at) || new Date().toISOString(), activity_id: meta && meta.activity_id
    });
  };
  for (let i = 1; i < watts.length; i++) {
    const window = watts.slice(start, i);
    const m = mean(window);
    if (m > 0 && Math.abs(watts[i] - m) > m * o.tolerance) { flush(i); start = i; }
  }
  flush(watts.length);
  return segs;
}

// §2c confound handling: ventilation at a given power runs meaningfully higher
// on a fatigued or ill day, so those segments would drag the inflection down.
function flagConfounded(segments, wellness) {
  if (!wellness || !wellness.length) return segments.map(s => ({ ...s, confounded: false }));
  const byDate = {};
  for (const w of wellness) byDate[String(w.date).slice(0, 10)] = w;
  const hrvs = wellness.map(w => w.hrv).filter(Number.isFinite);
  const rhrs = wellness.map(w => w.rhr).filter(Number.isFinite);
  const sd = xs => { if (xs.length < 2) return null; const m = mean(xs);
    return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
  const hrvM = mean(hrvs), hrvSD = sd(hrvs), rhrM = mean(rhrs), rhrSD = sd(rhrs);
  return segments.map(s => {
    const w = byDate[String(s.at).slice(0, 10)];
    let confounded = false;
    if (w) {
      if (hrvSD && Number.isFinite(w.hrv) && w.hrv < hrvM - 1.5 * hrvSD) confounded = true;
      if (rhrSD && Number.isFinite(w.rhr) && w.rhr > rhrM + 1.5 * rhrSD) confounded = true;
    }
    return { ...s, confounded };
  });
}

// Bin power, then compare the VE/power slope before and after each bin and
// flag where it steepens. The lowest breakpoint is VT1; the sharpest one above
// it is VT2.
//
// Slopes are least-squares fits over a window of bins rather than bin-to-bin
// differences: with sparse data, neighbouring bins hold one segment each and
// consecutive differences zig-zag, which manufactures a "jump" at every other
// bin. A proper segmented regression (ruptures, pwlf) would be better still —
// this stays the documented heuristic, and labels itself as one.
const BIN_W = 10, SLOPE_JUMP = 1.5, SLOPE_WIN = 3;
// Ratios alone are not enough: down where VE barely rises, a slope of 0.04
// against 0.02 is a ratio of 2 and pure noise. A breakpoint also has to be a
// real steepening in absolute terms (L/min of ventilation per watt).
const MIN_SLOPE_GAIN = 0.05;

// Least-squares slope of ve against power over a slice of bins.
function slopeOf(bins) {
  if (!bins || bins.length < 2) return null;
  const mx = mean(bins.map(b => b.power)), my = mean(bins.map(b => b.ve));
  let num = 0, den = 0;
  for (const b of bins) { num += (b.power - mx) * (b.ve - my); den += (b.power - mx) ** 2; }
  return den === 0 ? null : num / den;
}

// Public entry point: run the fit, then check it against itself. Splitting the
// segments into two interleaved halves and refitting is a cheap stability
// test — if the two halves disagree about where VT2 is, the curve is too noisy
// to read and the honest answer is "not yet", not a confident wrong FTP.
const STABILITY_TOLERANCE_W = 25;

function ventilatoryBreakpoints(segments, currentFtp) {
  const main = detectBreakpoints(segments, currentFtp);
  if (!main.ok) return main;
  const pts = (segments || []).filter(s => !s.confounded && Number.isFinite(s.power) && Number.isFinite(s.ve));
  const a = detectBreakpoints(pts.filter((_, i) => i % 2 === 0), currentFtp);
  const b = detectBreakpoints(pts.filter((_, i) => i % 2 === 1), currentFtp);
  if (a.ok && b.ok) {
    const spread = Math.abs(a.vt2_power - b.vt2_power);
    if (spread > STABILITY_TOLERANCE_W) {
      return { ok: false, method: 'binned-slope',
        reason: `VT2 unstable — split-half fits disagree by ${spread}W (${a.vt2_power} vs ${b.vt2_power}). More steady-state data needed.`,
        vt1_power: main.vt1_power, max_power: main.max_power, points: main.points };
    }
    return { ...main, stability: 'confirmed by split-half fit', split_half_spread_w: spread };
  }
  // Only one half (or neither) produced a VT2 — the fit stands, but say that
  // it hasn't been cross-checked rather than implying it has.
  return { ...main, stability: 'unverified — not enough data to cross-check' };
}

function detectBreakpoints(segments, currentFtp) {
  const pts = (segments || []).filter(s => !s.confounded && Number.isFinite(s.power) && Number.isFinite(s.ve));
  if (pts.length < 6) return { ok: false, reason: 'not enough steady-state segments yet (need 6+)', points: pts.length };
  const bins = new Map();
  for (const p of pts) {
    const k = Math.round(p.power / BIN_W) * BIN_W;
    const b = bins.get(k) || { power: k, ves: [] };
    b.ves.push(p.ve); bins.set(k, b);
  }
  const raw = [...bins.values()].map(b => ({ power: b.power, ve: mean(b.ves), n: b.ves.length }))
    .sort((a, b) => a.power - b.power);
  if (raw.length < 4) return { ok: false, reason: 'steady-state data spans too few power bins', points: pts.length };
  // 3-bin moving average — ride-to-ride ventilation scatter is large, and an
  // unsmoothed curve breaks at whichever bin happened to run high.
  const ordered = raw.map((b, i) => ({
    power: b.power, n: b.n,
    ve: mean(raw.slice(Math.max(0, i - 1), Math.min(raw.length, i + 2)).map(x => x.ve))
  }));

  const candidates = [];
  for (let i = SLOPE_WIN; i <= ordered.length - 1 - SLOPE_WIN; i++) {
    const before = slopeOf(ordered.slice(i - SLOPE_WIN, i + 1));
    const after = slopeOf(ordered.slice(i, i + SLOPE_WIN + 1));
    if (before == null || after == null || before <= 0) continue;
    const ratio = after / before;
    if (ratio >= SLOPE_JUMP && after - before >= MIN_SLOPE_GAIN) {
      candidates.push({ power: ordered[i].power, ratio: Math.round(ratio * 100) / 100, gain: after - before });
    }
  }
  // One inflection spreads across the bins on either side of it; collapse each
  // run of adjacent candidates to its sharpest bin so a single breakpoint is
  // reported once, not three times.
  const jumps = [];
  for (const c of candidates) {
    const last = jumps[jumps.length - 1];
    if (last && c.power - last.power <= BIN_W * SLOPE_WIN) {
      if (c.ratio > last.ratio) jumps[jumps.length - 1] = c;
    } else jumps.push(c);
  }
  const maxPower = ordered[ordered.length - 1].power;
  // Order by power, not by sharpness: VT2 always sits above VT1
  // physiologically, and the two have similar slope ratios, so ranking by
  // sharpness lets noise swap them. Lowest breakpoint is VT1, highest is VT2.
  const vt1 = jumps[0] || null;
  const vt2 = jumps.length > 1 ? jumps[jumps.length - 1] : null;
  // A lone breakpoint is VT1, not VT2: one steepening in an aerobic-range data
  // set is the first threshold, and calling it VT2 would invent an FTP.
  const soleBreakpoint = jumps.length < 2;

  // §2c.7 — without steady-state data above ~85% of current FTP, the curve
  // simply doesn't reach VT2, and a "VT2" read off it would be fiction.
  const reach = currentFtp ? maxPower / currentFtp : null;
  if (currentFtp && maxPower < currentFtp * 0.85) {
    return { ok: false, reason: 'insufficient range to estimate VT2 — no steady work above 85% FTP',
      vt1_power: vt1 ? vt1.power : null, max_power: maxPower, reach, points: pts.length, method: 'binned-slope' };
  }
  if (!vt2 || soleBreakpoint) {
    return { ok: false, reason: 'no second inflection found — VT1 only',
      vt1_power: (vt1 || vt2) ? (vt1 || vt2).power : null, max_power: maxPower,
      points: pts.length, method: 'binned-slope' };
  }
  return {
    ok: true, method: 'binned-slope',
    vt1_power: vt1 ? vt1.power : null, vt2_power: vt2.power,
    ftp: Math.round(vt2.power * VT2_DISCOUNT),
    points: pts.length, bins: ordered.length, max_power: maxPower,
    excluded_confounded: (segments || []).filter(s => s.confounded).length
  };
}

/* ---------------- §2a test-derived ---------------- */

function ftpFromTest(test) {
  if (!test || !Number.isFinite(Number(test.vt2_power))) return null;
  return {
    ftp: Math.round(Number(test.vt2_power) * VT2_DISCOUNT),
    vt2_power: Number(test.vt2_power),
    // §3 — HR at VT2 needs no discount; only power does.
    threshold_hr: Number.isFinite(Number(test.vt2_hr)) ? Math.round(Number(test.vt2_hr)) : null,
    vt1_power: Number.isFinite(Number(test.vt1_power)) ? Number(test.vt1_power) : null,
    vt1_hr: Number.isFinite(Number(test.vt1_hr)) ? Number(test.vt1_hr) : null,
    at: test.date || test.at || new Date().toISOString()
  };
}

/* ---------------- §2d reconciliation ---------------- */

function reconcile(signals, now) {
  const t = now || new Date().toISOString();
  const { test, eftp, ventilatory, override } = signals || {};
  const notes = [];

  if (override && Number.isFinite(Number(override.ftp))) {
    return { ftp: Math.round(Number(override.ftp)),
      threshold_hr: Number.isFinite(Number(override.threshold_hr)) ? Math.round(Number(override.threshold_hr)) : null,
      source: 'manual override', confidence: 'pinned',
      notes: ['Manually pinned — clear the override to resume automatic estimates.'] };
  }

  const testFresh = test && daysBetween(test.at, t) <= TEST_FRESH_DAYS;
  const others = [eftp && eftp.ftp, ventilatory && ventilatory.ok && ventilatory.ftp].filter(Boolean);

  if (test && testFresh) {
    // §2d.3 — if both continuous signals agree with each other but drift from
    // the test, say so; never silently overwrite a measured test.
    if (others.length === 2) {
      const [a, b] = others;
      const agree = Math.abs(a - b) / Math.max(a, b) <= RETEST_DIVERGENCE;
      const drift = Math.abs((a + b) / 2 - test.ftp) / test.ftp;
      if (agree && drift > RETEST_DIVERGENCE) {
        notes.push(`Your fitness has likely shifted since your last test — eFTP and the ventilatory curve `
          + `both read about ${Math.round((a + b) / 2)}W against a tested ${test.ftp}W. Consider retesting.`);
      }
    }
    return { ftp: test.ftp, threshold_hr: test.threshold_hr, source: 'dedicated test (VT2 × 0.925)',
      confidence: 'high', tested_at: test.at, notes };
  }

  if (test && !testFresh) notes.push(`Last dedicated test was ${Math.round(daysBetween(test.at, t))} days ago — beyond the ${TEST_FRESH_DAYS}-day window, so it no longer sets FTP.`);

  if (eftp && eftp.ftp) {
    if (ventilatory && ventilatory.ok) {
      const gap = Math.abs(ventilatory.ftp - eftp.ftp) / eftp.ftp;
      notes.push(gap <= RETEST_DIVERGENCE
        ? `Ventilatory curve agrees (${ventilatory.ftp}W).`
        : `Ventilatory curve reads ${ventilatory.ftp}W — ${Math.round(gap * 100)}% apart from eFTP.`);
    }
    return { ftp: eftp.ftp,
      // No VT2 HR exists on a power-only signal; the HR held during the best
      // qualifying effort is the honest stand-in, and is labelled as such.
      threshold_hr: eftp.avg_hr || null,
      threshold_hr_source: eftp.avg_hr ? 'average HR during the best qualifying effort (not a measured VT2)' : null,
      source: `eFTP — best ${eftp.from.minutes} min effort`, confidence: 'medium', notes };
  }

  if (ventilatory && ventilatory.ok) {
    return { ftp: ventilatory.ftp, threshold_hr: null, source: 'ventilatory curve (VT2 × 0.925)',
      confidence: 'medium', notes };
  }
  return { ftp: null, threshold_hr: null, source: null, confidence: 'none',
    notes: notes.concat(['No qualifying effort, test, or breathing data yet.']) };
}

/* ---------------- §4 power zones ---------------- */

const POWER_ZONES = [
  ['Z1', 'Active Recovery', 0, 0.55], ['Z2', 'Endurance', 0.55, 0.75],
  ['Z3', 'Tempo', 0.75, 0.90], ['Z4', 'Threshold', 0.90, 1.05],
  ['Z5', 'VO2max', 1.05, 1.20], ['Z6', 'Anaerobic Capacity', 1.20, 1.50],
  ['Z7', 'Neuromuscular', 1.50, null]
];
function powerZones(ftp) {
  if (!ftp) return null;
  return POWER_ZONES.map(([z, name, lo, hi]) => ({
    zone: z, name, pct: hi ? `${Math.round(lo * 100)}–${Math.round(hi * 100)}%` : `${Math.round(lo * 100)}%+`,
    from: Math.round(ftp * lo), to: hi ? Math.round(ftp * hi) : null
  }));
}

/* ---------------- §5 HR zones (%LT, never %max) ---------------- */

const HR_ZONES = [
  ['Z1', 'Recovery', 0, 0.80], ['Z2', 'Aerobic', 0.80, 0.89],
  ['Z3', 'Tempo', 0.89, 0.95], ['Z4', 'SubThreshold', 0.95, 1.00],
  ['Z5', 'SuperThreshold', 1.00, 1.03], ['Z6', 'Aerobic Capacity', 1.03, 1.06],
  ['Z7', 'Anaerobic', 1.06, null]
];
function hrZones(thresholdHr) {
  if (!thresholdHr) return null;
  return HR_ZONES.map(([z, name, lo, hi]) => ({
    zone: z, name, pct: hi ? `${Math.round(lo * 100)}–${Math.round(hi * 100)}%` : `${Math.round(lo * 100)}%+`,
    from: Math.round(thresholdHr * lo), to: hi ? Math.round(thresholdHr * hi) : null
  }));
}

module.exports = {
  VT2_DISCOUNT, LOOKBACK_DAYS, TEST_FRESH_DAYS, RETEST_DIVERGENCE, MAX_VI, EFFORT_MINUTES,
  resample1Hz, normalizedPower, bestWindow, durationCorrection,
  effortsFromRide, eftpFromEfforts, decayFor,
  steadySegments, flagConfounded, ventilatoryBreakpoints,
  ftpFromTest, reconcile, powerZones, hrZones, daysBetween
};
