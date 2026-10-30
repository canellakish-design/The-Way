// ============================================================
// energy-math.js — live fuel: how much readily usable carbohydrate is
// on board through the day, from what was actually eaten.
//
// A pool of available carbohydrate (blood glucose plus the liver's quick
// store, in grams) runs through the day in five-minute steps:
//   + each logged meal's carbs arrive on an absorption curve (a gamma
//     shape peaking 40 to 90 minutes after eating; fat and protein in the
//     same meal slow it, a bottle of sports drink lands fast);
//   − the body burns a steady trickle at rest (about 45% of resting
//     energy from carbohydrate), and far more while training, scaled by
//     the session's intensity and his FTP;
//   • the pool is capped (anything above goes to muscle glycogen, which
//     this does not model) and floored at zero.
// Only meals already logged count for the past; for the hours ahead, the
// planned meals not yet eaten are drawn as a projection. Logging a meal
// re-runs the whole thing, so the curve is as live as the journal.
//
// Scale: 120 g on board reads 100%. Below 35% a hard session will feel
// flat; 60% and up is fuelled. The numbers are an estimate, honest about
// direction and timing rather than exact grams.
// ============================================================
const STEP = 5, T0 = 5 * 60, T1 = 23 * 60 + 55;
const FULL_G = 120, CAP_G = 150, START_G = 50;
// At rest the pool pays about 6 g an hour (resting carbohydrate oxidation is
// near 0.1 g/min; the liver's gluconeogenesis covers the rest). On the bike the
// session's own rate replaces it.
const REST_G_PER_H = 6;

const toMin = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

// Absorption kernel: gamma(k=2, θ) over 4 hours, in grams per 5 minutes, summing to C.
function kernel(carbs, fat, protein, fast) {
  const theta = fast ? 12 : Math.min(55, 22 + 0.45 * (fat || 0) + 0.15 * (protein || 0));
  const w = [];
  let sum = 0;
  for (let t = 0; t <= 240; t += STEP) { const v = t * Math.exp(-t / theta); w.push(v); sum += v; }
  return w.map(v => carbs * v / sum);
}

// Carbs burned per hour on the bike at a given intensity factor and FTP.
// Power → kcal/h at 23% efficiency; the carbohydrate share rises with intensity.
function rideCarbsPerHour(IF, ftp) {
  const watts = Math.max(0, IF) * (ftp || 175);
  const kcalH = watts * 3600 / 4184 / 0.23;
  const frac = Math.max(0.3, Math.min(0.95, 1.1 * IF - 0.2));
  return kcalH * frac / 4;
}
// Only part of the carbohydrate burned on the bike comes out of this pool;
// the rest is muscle glycogen, which this does not track. About 40% is the
// blood-glucose share at moderate intensity (Romijn), so that is what the
// pool pays. The full rate is reported so the session can say what it costs.
const POOL_SHARE = 0.4;
function sessionRate(s, ftp) {
  const mins = s.minutes || 60;
  if (/lift|weight|strength/i.test(s.name || '') || s.sport === 'WeightTraining') return 25 * POOL_SHARE;
  const IF = s.tss ? Math.sqrt(s.tss / (mins / 60) / 100) : (/vo2|40\s*\/\s*20|threshold/i.test(s.name || '') ? 0.9 : 0.6);
  return rideCarbsPerHour(Math.min(1.2, Math.max(0.4, IF)), ftp) * POOL_SHARE;
}

function band(pct) {
  if (pct == null) return { key: 'none', word: '', tone: 'neutral' };
  if (pct >= 60) return { key: 'green', word: 'fuelled', tone: 'good' };
  if (pct >= 35) return { key: 'yellow', word: 'ok', tone: 'warn' };
  return { key: 'red', word: 'low', tone: 'bad' };
}

// o: { entries, meals (the plan), sessions, now_min (null = whole day actual), base_burn_kcal, ftp }
function model(o) {
  const now = o.now_min == null ? T1 : o.now_min;
  const restRate = REST_G_PER_H / 60 * STEP;   // g per step
  const n = Math.floor((T1 - T0) / STEP) + 1;
  const absorb = new Array(n).fill(0), absorbProj = new Array(n).fill(0), burn = new Array(n).fill(0);
  const idx = m => Math.round((m - T0) / STEP);
  const add = (arr, atMin, k) => { const i0 = idx(atMin); for (let j = 0; j < k.length; j++) { const i = i0 + j; if (i >= 0 && i < n) arr[i] += k[j]; } };
  const meals = [];
  for (const e of o.entries || []) {
    if (e.supplement || !e.time) continue;
    const c = e.carbs_g || 0; if (!c) continue;
    const m = toMin(e.time); if (m == null) continue;
    add(absorb, m, kernel(c, e.fat_g, e.protein_g, e.meal === 'on the bike' || /tailwind|gel|sports drink|chocolate milk/i.test(e.name || '')));
    meals.push({ time: e.time, min: m, carbs_g: c, name: e.name, logged: true });
  }
  // the plan's meals still ahead, as a projection (a logged slot does not project twice)
  for (const p of o.meals || []) {
    const m = toMin(p.time); if (m == null || m < now) continue;
    if ((p.logged || []).length) continue;
    const c = p.carbs_g || 0; if (!c) continue;
    add(absorbProj, m, kernel(c, 0, p.protein_g || 0, p.slot === 'on the bike'));
    meals.push({ time: p.time, min: m, carbs_g: c, name: p.slot, logged: false });
  }
  const sessions = [];
  for (const s of o.sessions || []) {
    const m = toMin(s.time); if (m == null) continue;
    const rate = sessionRate(s, o.ftp) / 60 * STEP;
    const mins = s.minutes || 60;
    for (let t = m; t < m + mins; t += STEP) { const i = idx(t); if (i >= 0 && i < n) burn[i] += rate; }
    sessions.push({ name: s.name, time: s.time, min: m, end_min: m + mins, minutes: mins, done: !!s.done, g_per_h: Math.round(rate / STEP * 60 / POOL_SHARE) });
  }
  const series = [];
  let g = START_G;
  for (let i = 0; i < n; i++) {
    const t = T0 + i * STEP;
    const projected = t > now;
    g = g + absorb[i] + (projected ? absorbProj[i] : 0) - (burn[i] ? burn[i] : restRate);
    g = Math.max(0, Math.min(CAP_G, g));
    series.push({ t: toHM(t), m: t, g: Math.round(g), pct: Math.min(100, Math.round(g / FULL_G * 100)), projected });
  }
  const at = m => series[Math.max(0, Math.min(n - 1, idx(m)))];
  const nowPt = at(now);
  // the peak within the next eight hours
  const ahead = series.filter(p => p.m >= now && p.m <= now + 480);
  const peak = ahead.length ? ahead.reduce((a, p) => p.pct > a.pct ? p : a) : null;
  // every session ahead: the fuel at its start, and what to eat if it is short
  const upcoming = sessions.filter(s => s.min >= now - 10).map(s => {
    const p = at(s.min); const b = band(p.pct);
    const short = Math.max(0, Math.round(0.6 * FULL_G - p.g));
    const by = Math.max(now, s.min - 90);
    return { name: s.name, time: s.time, end_min: s.end_min, minutes: s.minutes, g_per_h: s.g_per_h, pct: p.pct, g: p.g, band: b, advice: short > 10 ? `${short} g of carbs by ${toHM(by)} for ${s.name}` : null };
  });
  // the low stretches ahead: where the curve drops under 35% before bedtime
  const lows = []; let run = null;
  for (const p of series) { if (p.m < now) continue; if (p.pct < 35) { if (!run) run = { from: p.t, to: p.t }; else run.to = p.t; } else { if (run) lows.push(run); run = null; } }
  if (run) lows.push(run);
  return { series, now: { time: toHM(now), pct: nowPt.pct, g: nowPt.g, band: band(nowPt.pct) }, peak: peak ? { time: peak.t, pct: peak.pct } : null,
    sessions: upcoming, lows, meals, full_g: FULL_G, step: STEP,
    advice: upcoming.find(s => s.advice) ? upcoming.find(s => s.advice).advice : (lows.length && lows[0].from !== toHM(now) ? `Fuel runs low around ${lows[0].from}; a carb snack an hour before.` : null) };
}

module.exports = { model, kernel, rideCarbsPerHour, sessionRate, band, FULL_G, START_G, toMin, toHM };
