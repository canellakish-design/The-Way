// ============================================================
// ride-math.js — what a ride's streams say, as arithmetic. Pure.
//
// Heart rate is read for every ride: average, max, minutes above 147 bpm
// (the VO2 session's one yardstick: 8 to 12 is the target) and minutes in
// the three Seiler zones (VT1 117 bpm, VT2 139 bpm). Breathing comes from
// the Garmin's respiration stream when the device recorded one; the same
// summary applies.
// ============================================================
const HR = { vt1: 117, vt2: 139, hard: 147 };
const VO2_TARGET = { lo: 8, hi: 12 };

const r1 = x => Math.round(x * 10) / 10;

// hr: 1 Hz samples, zeros for dropouts (resample1Hz's convention).
function hrSummary(hr, thresholds) {
  const t = Object.assign({}, HR, thresholds || {});
  const xs = (hr || []).map(Number).filter(v => v > 30 && v < 230);
  if (!xs.length) return null;
  let z1 = 0, z2 = 0, z3 = 0, hard = 0, sum = 0, max = 0;
  for (const v of xs) {
    sum += v; if (v > max) max = v;
    if (v < t.vt1) z1++; else if (v < t.vt2) z2++; else z3++;
    if (v > t.hard) hard++;
  }
  return {
    avg: Math.round(sum / xs.length), max,
    seconds: xs.length,
    minutes_above_hard: r1(hard / 60), hard_bpm: t.hard,
    zones: { z1_min: r1(z1 / 60), z2_min: r1(z2 / 60), z3_min: r1(z3 / 60) },
    zone_pct: { z1: Math.round(z1 / xs.length * 100), z2: Math.round(z2 / xs.length * 100), z3: Math.round(z3 / xs.length * 100) }
  };
}

// breaths per minute, 1 Hz or sparser; zeros and nonsense dropped.
function respSummary(resp) {
  const xs = (resp || []).map(Number).filter(v => v > 4 && v < 90);
  if (xs.length < 10) return null;
  const sorted = xs.slice().sort((a, b) => a - b);
  return {
    avg: r1(xs.reduce((a, b) => a + b, 0) / xs.length),
    max: r1(sorted[sorted.length - 1]),
    p90: r1(sorted[Math.floor(sorted.length * 0.9)]),
    min: r1(sorted[0]),
    samples: xs.length
  };
}

// The VO2 session's grade: minutes above 147.
function vo2Grade(minutesAbove) {
  if (minutesAbove == null) return null;
  const m = minutesAbove;
  if (m >= VO2_TARGET.lo && m <= VO2_TARGET.hi) return { pct: 100, band: 'green', basis: `${m} min above ${HR.hard} bpm (target ${VO2_TARGET.lo} to ${VO2_TARGET.hi})` };
  if (m >= 5 && m < VO2_TARGET.lo) return { pct: Math.round(50 + (m - 5) / (VO2_TARGET.lo - 5) * 34), band: 'yellow', basis: `${m} min above ${HR.hard} bpm, short of ${VO2_TARGET.lo}` };
  if (m > VO2_TARGET.hi && m <= 16) return { pct: 80, band: 'yellow', basis: `${m} min above ${HR.hard} bpm, past ${VO2_TARGET.hi}: more than the session asks` };
  if (m > 16) return { pct: 60, band: 'yellow', basis: `${m} min above ${HR.hard} bpm, well past the target: too hard` };
  return { pct: Math.round(m / 5 * 49), band: 'red', basis: `${m} min above ${HR.hard} bpm, target ${VO2_TARGET.lo} to ${VO2_TARGET.hi}` };
}

// A Zone 1 ride's discipline: the share of the ride under VT1 (117 bpm).
function zone1Grade(summary) {
  if (!summary) return null;
  const pct = summary.zone_pct.z1;
  return { pct, band: pct >= 85 ? 'green' : pct >= 60 ? 'yellow' : 'red',
    basis: `${pct}% under ${HR.vt1} bpm, avg ${summary.avg}, max ${summary.max}` };
}

module.exports = { HR, VO2_TARGET, hrSummary, respSummary, vo2Grade, zone1Grade };
