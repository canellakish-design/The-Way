// ============================================================
// energy-math.js — live fuel, version 2: how much carbohydrate he has on
// board through the day, in two stores, from what was actually eaten.
//
// The QUICK store (liver glycogen plus blood glucose) is what he feels
// hour to hour and what bonking empties: about 110 g full, about 60 g
// after a night's sleep, carried over from the evening before. Every meal
// feeds it as the stomach empties (a gamma curve whose timing comes from
// the gastric half-time: ~25 min for a drink or gel, 55 min for plain
// food, longer with fat and much longer with protein). It pays a trickle
// at rest (6 g/h) and, on the bike, about a quarter of the carbohydrate
// burned (van Loon 2001 tracer data); the rest comes from the legs.
//
// The LEGS (muscle glycogen) hold about 320 g for him, drain only during
// rides, and refill only from carbs the quick store cannot hold, at the
// resynthesis rate (fast for four hours after a ride, slower later). They
// carry over day to day, which is why Sunday feels flat after Saturday.
//
// Protein adds about 0.15 g of glucose per gram, slowly, over the
// afternoon (Fromentin 2013); a salmon dinner is a small slow rise, not a
// spike. Carbs eaten on the bike count up to 60 g/h, 90 g/h for a
// glucose-plus-fructose mix (Jeukendrup 2010); more is not absorbed.
//
// Scale: 110 g in the quick store reads 100%. A hard session wants 60%
// of both stores; a long Zone 1 wants 40% quick and half-full legs; a
// short Zone 1 runs on fat and needs only 25%, as long as the legs are
// above the train-low floor (40%). A faint band carries the model's own
// uncertainty, about ±10 g at breakfast widening to ±25 g by evening.
// ============================================================
const STEP = 5, T0 = 5 * 60, T1 = 23 * 60 + 55;
const FULL_G = 110, CAP_G = 110, START_G = 60, LEGS_FULL_G = 320;
const REST_G_PER_H = 6;
const QUICK_SHARE = 0.24;
const PROTEIN_G_PER_G = 0.15;
const EXO_G_PER_H = 60, EXO_MIX_G_PER_H = 90;
const RESYNTH_FAST_G_H = 40, RESYNTH_SLOW_G_H = 18, RESYNTH_FAST_H = 4;
const LEGS_LOW_FLOOR = 40;
const MIX_RE = /tailwind|maurten|skratch|gel|precision|fructose|sports drink|carb mix|drink mix/i;
const FAST_RE = /tailwind|gel|sports drink|chocolate milk|skratch|maurten|precision|juice|gatorade|chew|block/i;

const toMin = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const say = m => { let h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, '0'); const ap = h < 12 ? 'a' : 'p'; h = h % 12 || 12; return h + ':' + mm + ap; };
const r5 = v => Math.round(v / 5) * 5;

// Gastric half-time, minutes: drinks and gels 25; food 55 plus 0.9 per gram
// of fat and 0.35 per gram of protein, capped at 110.
function halfTime(fat, protein, fast) { return fast ? 25 : Math.min(110, 55 + 0.9 * (fat || 0) + 0.35 * (protein || 0)); }
// Absorption kernel: a gamma(k=2, θ) curve in grams per 5 minutes summing to
// C, with θ set so the curve's median sits at the gastric half-time.
function kernel(carbs, fat, protein, fast, hours) {
  const theta = halfTime(fat, protein, fast) / 1.68;
  const span = (hours || (fast ? 2.5 : 5)) * 60;
  const w = []; let sum = 0;
  for (let t = 0; t <= span; t += STEP) { const v = t * Math.exp(-t / theta); w.push(v); sum += v; }
  return w.map(v => carbs * v / sum);
}
// Protein to glucose: 0.15 g/g, spread over eight hours, peaking in the fourth.
function proteinKernel(protein) {
  const theta = 110; const w = []; let sum = 0;
  for (let t = 0; t <= 480; t += STEP) { const v = t * Math.exp(-t / theta); w.push(v); sum += v; }
  return w.map(v => PROTEIN_G_PER_G * protein * v / sum);
}

// Carbohydrate burned per hour on the bike at an intensity factor and FTP:
// power → kcal/h at 23% efficiency; the carbohydrate share rises with intensity.
function rideCarbsPerHour(IF, ftp) {
  const watts = Math.max(0, IF) * (ftp || 175);
  const kcalH = watts * 3600 / 4184 / 0.23;
  const frac = Math.max(0.3, Math.min(0.95, 1.1 * IF - 0.2));
  return kcalH * frac / 4;
}
// The quick store's share of a session's burn, g/h (the whole rate is kept on the session).
function sessionRate(s, ftp, share) {
  return sessionBurn(s, ftp) * (share == null ? QUICK_SHARE : share);
}
function sessionBurn(s, ftp) {
  const mins = s.minutes || 60;
  if (/lift|weight|strength/i.test(s.name || '') || s.sport === 'WeightTraining') return 25;
  const IF = s.tss ? Math.sqrt(s.tss / (mins / 60) / 100) : (/vo2|40\s*\/\s*20|threshold/i.test(s.name || '') ? 0.9 : 0.6);
  return rideCarbsPerHour(Math.min(1.2, Math.max(0.4, IF)), ftp);
}
const isHard = s => /vo2|40\s*\/\s*20|threshold|race|interval/i.test(s.name || '');
const isLift = s => /lift|weight|strength/i.test(s.name || '') || s.sport === 'WeightTraining';
// What each session needs at its start, as percentages of the two stores.
function needFor(s) {
  if (isHard(s)) return { quick: 60, legs: 60 };
  if (isLift(s)) return { quick: 25, legs: 0 };
  if ((s.minutes || 60) >= 120) return { quick: 40, legs: 50 };
  return { quick: 25, legs: 0 };
}

function band(pct) {
  if (pct == null) return { key: 'none', word: '', tone: 'neutral' };
  if (pct >= 60) return { key: 'green', word: 'fuelled', tone: 'good' };
  if (pct >= 35) return { key: 'yellow', word: 'ok', tone: 'warn' };
  return { key: 'red', word: 'low', tone: 'bad' };
}

// o: { entries, meals (the plan), sessions, now_min (null = whole day actual),
//      ftp, quick_start_g, legs_start_g, cal: { quick_share, rest_g_h } }
function model(o) {
  const now = o.now_min == null ? T1 : o.now_min;
  const cal = o.cal || {};
  const share = cal.quick_share > 0 ? Math.max(0.12, Math.min(0.45, cal.quick_share)) : QUICK_SHARE;
  const restH = cal.rest_g_h > 0 ? Math.max(3, Math.min(12, cal.rest_g_h)) : REST_G_PER_H;
  const restRate = restH / 60 * STEP;
  const n = Math.floor((T1 - T0) / STEP) + 1;
  const idx = m => Math.round((m - T0) / STEP);
  const absorb = new Array(n).fill(0), absorbProj = new Array(n).fill(0), burn = new Array(n).fill(0), burnLegs = new Array(n).fill(0);
  const inRide = new Array(n).fill(false), afterRide = new Array(n).fill(false);
  const sessions = [];
  for (const s of o.sessions || []) {
    const m = toMin(s.time); if (m == null) continue;
    const mins = s.minutes || 60;
    const whole = sessionBurn(s, o.ftp) / 60 * STEP;
    for (let t = m; t < m + mins; t += STEP) { const i = idx(t); if (i >= 0 && i < n) { burn[i] += whole * share; burnLegs[i] += whole * (1 - share); inRide[i] = true; } }
    for (let t = m + mins; t < m + mins + RESYNTH_FAST_H * 60; t += STEP) { const i = idx(t); if (i >= 0 && i < n) afterRide[i] = true; }
    sessions.push({ name: s.name, time: s.time, min: m, end_min: m + mins, minutes: mins, done: !!s.done, slid_from: s.slid_from || null, g_per_h: Math.round(whole / STEP * 60), need: needFor(s), hard: isHard(s) });
  }
  // an on-the-bike feed is capped at what the gut can take
  const add = (arr, atMin, k, capPerStep) => { const i0 = idx(atMin); for (let j = 0; j < k.length; j++) { const i = i0 + j; if (i >= 0 && i < n) arr[i] += capPerStep ? Math.min(capPerStep, k[j]) : k[j]; } };
  const meals = [];
  for (const e of o.entries || []) {
    if (e.supplement || !e.time) continue;
    const m = toMin(e.time); if (m == null) continue;
    const c = e.carbs_g || 0, pr = e.protein_g || 0;
    const onBike = e.meal === 'on the bike' || (inRide[Math.max(0, Math.min(n - 1, idx(m)))] && FAST_RE.test(e.name || ''));
    const fast = onBike || (e.drink_only && c > 0) || FAST_RE.test(e.name || '');
    if (c) add(absorb, m, kernel(c, e.fat_g, e.protein_g, fast), onBike ? (MIX_RE.test(e.name || '') ? EXO_MIX_G_PER_H : EXO_G_PER_H) / 12 : 0);
    if (pr >= 10) add(absorb, m, proteinKernel(pr));
    if (c || pr >= 10 || (e.kcal || 0) >= 80) meals.push({ time: e.time, min: m, carbs_g: c, protein_g: pr, name: e.name, logged: true, protein_only: !c && pr >= 10 });
  }
  for (const p of o.meals || []) {
    const m = toMin(p.time); if (m == null || m < now) continue;
    if ((p.logged || []).length) continue;
    const c = p.carbs_g || 0; if (!c) continue;
    add(absorbProj, m, kernel(c, 0, p.protein_g || 0, p.slot === 'on the bike'));
    meals.push({ time: p.time, min: m, carbs_g: c, name: p.slot, logged: false });
  }
  // the march through the day, twice: as it stands (with the plan ahead) and
  // actual-only to the end, which is what tomorrow starts from
  const run = project => {
    const out = [];
    let q = o.quick_start_g > 0 ? Math.min(CAP_G, o.quick_start_g) : START_G;
    let legs = o.legs_start_g >= 0 && o.legs_start_g != null ? Math.min(LEGS_FULL_G, o.legs_start_g) : LEGS_FULL_G * 0.85;
    let flow = 0;
    for (let i = 0; i < n; i++) {
      const t = T0 + i * STEP;
      const projected = t > now;
      const inflow = absorb[i] + (projected && project ? absorbProj[i] : 0);
      const drain = inRide[i] ? burn[i] : (t < 6 * 60 || t >= 22 * 60 ? restRate * 0.7 : restRate);   // asleep, the liver pays less
      q = q + inflow - drain;
      legs = legs - burnLegs[i];
      if (q > CAP_G) {
        // overflow into the legs, at the resynthesis rate; beyond that it is not stored here
        const rate = (afterRide[i] ? RESYNTH_FAST_G_H : RESYNTH_SLOW_G_H) / 60 * STEP;
        const over = q - CAP_G;
        legs = Math.min(LEGS_FULL_G, legs + Math.min(rate, over));
        q = CAP_G;
      }
      q = Math.max(0, q); legs = Math.max(0, legs);
      flow += inflow + drain + burnLegs[i] * 0.3;
      const hw = Math.min(28, 10 + 0.06 * flow);
      out.push({ t: toHM(t), m: t, g: Math.round(q), pct: Math.min(100, Math.round(q / FULL_G * 100)),
        legs_g: Math.round(legs), legs_pct: Math.min(100, Math.round(legs / LEGS_FULL_G * 100)),
        lo: Math.max(0, Math.round((q - hw) / FULL_G * 100)), hi: Math.min(100, Math.round((q + hw) / FULL_G * 100)), projected });
    }
    return out;
  };
  const series = run(true);
  const actual = o.now_min == null ? series : run(false);
  const endPt = actual[actual.length - 1];
  const at = m => series[Math.max(0, Math.min(n - 1, idx(m)))];
  const nowPt = at(now);
  const ahead = series.filter(p => p.m >= now && p.m <= now + 480);
  const peak = ahead.length ? ahead.reduce((a, p) => p.pct > a.pct ? p : a) : null;
  const upcoming = sessions.filter(s => s.end_min >= now - 10).map(s => {
    const p = at(s.min), need = s.need;
    const quickOk = p.pct >= need.quick, legsOk = p.legs_pct >= need.legs, legsFloor = p.legs_pct >= LEGS_LOW_FLOOR;
    const nearQ = p.pct >= need.quick - 12, nearL = p.legs_pct >= need.legs - 12;
    const b = quickOk && legsOk ? { key: 'green', word: 'enough for this', tone: 'good' }
      : nearQ && nearL ? { key: 'yellow', word: 'a little short', tone: 'warn' } : { key: 'red', word: 'short', tone: 'bad' };
    const short = r5(Math.max(0, need.quick / 100 * FULL_G - p.g));
    const by = Math.max(now, s.min - 75);
    const short1 = s.name.replace(/,.*$/, '');
    let advice = null;
    if (short > 10 && s.min > now && need.quick > 25) advice = `${short} g of carbs by ${say(by)} for ${short1}${short >= 40 ? ': rice or oats and a banana, or a bottle of Tailwind' : ': a banana, or toast'}.${!legsOk && s.hard ? ` Legs are low too (${p.legs_pct}%): a carb dinner tonight, or move it a day.` : ''}`;
    else if (!legsOk && s.hard) advice = `Legs are low (${p.legs_pct}%) for ${short1}. A carb dinner tonight, or move it a day.`;
    else if (!legsOk && need.legs) advice = `Legs are low (${p.legs_pct}%) for ${short1}. Carbs on the bike, 60 g an hour, and a carb dinner.`;
    else if (!legsFloor && !s.hard) advice = `Legs are low (${p.legs_pct}%). Ride ${short1} easy and eat carbs tonight.`;
    else if (need.quick <= 25 && p.pct < 35 && s.min > now) advice = `Low on purpose: ${short1} runs on fat. Nothing more needed before it.`;
    return { name: s.name, time: s.time, slid_from: s.slid_from, min: s.min, end_min: s.end_min, minutes: s.minutes, g_per_h: s.g_per_h, pct: p.pct, g: p.g, legs_pct: p.legs_pct,
      need: need.quick, need_legs: need.legs, band: b, advice };
  });
  const lows = []; let runLow = null;
  for (const p of series) { if (p.m < now) continue; if (p.pct < 35) { if (!runLow) runLow = { from: p.t, to: p.t }; else runLow.to = p.t; } else { if (runLow) lows.push(runLow); runLow = null; } }
  if (runLow) lows.push(runLow);
  const first = upcoming.find(s => s.advice);
  return { series, now: { time: toHM(now), pct: nowPt.pct, g: nowPt.g, legs_pct: nowPt.legs_pct, legs_g: nowPt.legs_g, band: band(nowPt.pct), legs_band: band(nowPt.legs_pct) },
    peak: peak ? { time: peak.t, pct: peak.pct } : null,
    sessions: upcoming, lows, meals, full_g: FULL_G, legs_full_g: LEGS_FULL_G, step: STEP,
    quick_end_g: endPt.g, legs_end_g: endPt.legs_g, share, rest_g_h: restH,
    // a low stretch only matters when something hard is ahead of it; a rest day or a Zone 1 day is allowed to run low
    advice: first ? first.advice : (lows.length && lows[0].from !== toHM(now) && upcoming.some(s => s.need >= 40 && s.min > toMin(lows[0].from)) ? `Fuel runs low around ${say(toMin(lows[0].from))}; a carb snack an hour before.` : null) };
}

// Tomorrow's start from tonight's end: the quick store loses the night's
// trickle (five hours to the model's 5 a.m. start), the legs keep what they had.
function carryOver(prev) {
  if (!prev) return {};
  const quick = prev.quick_end_g != null ? Math.max(35, Math.min(CAP_G, prev.quick_end_g - 5 * REST_G_PER_H * 0.7)) : null;
  return { quick_start_g: quick, legs_start_g: prev.legs_end_g != null ? prev.legs_end_g : null };
}

// The legs tap: after each ride he says how the legs felt, 1 to 5. Against
// the modelled quick store at the start, after 30 rides, two constants are
// nudged: the quick-store share of ride burn (all rides) and the resting
// trickle (rides started before the first meal). Nothing else is tuned.
function calibrate(ratings) {
  const r = (ratings || []).filter(x => x.legs >= 1 && x.legs <= 5 && x.pct != null);
  if (r.length < 30) return { quick_share: QUICK_SHARE, rest_g_h: REST_G_PER_H, rides: r.length, tuned: false };
  // felt 1..5 → the pct the body reports; modelled − felt > 0 means the model is too optimistic
  const bias = r.reduce((a, x) => a + (x.pct - (x.legs - 1) * 25), 0) / r.length / 100;   // in tank fractions
  const share = Math.max(0.12, Math.min(0.45, QUICK_SHARE * (1 + bias)));
  const fasted = r.filter(x => x.fasted);
  const fb = fasted.length >= 10 ? fasted.reduce((a, x) => a + (x.pct - (x.legs - 1) * 25), 0) / fasted.length / 100 : 0;
  const rest = Math.max(3, Math.min(12, REST_G_PER_H * (1 + fb)));
  return { quick_share: Math.round(share * 100) / 100, rest_g_h: Math.round(rest * 10) / 10, rides: r.length, tuned: true };
}

module.exports = { model, kernel, proteinKernel, halfTime, rideCarbsPerHour, sessionRate, sessionBurn, needFor, band, carryOver, calibrate,
  FULL_G, START_G, LEGS_FULL_G, QUICK_SHARE, toMin, toHM };
