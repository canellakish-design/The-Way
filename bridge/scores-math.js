// ============================================================
// scores-math.js — the three numbers on the front page, as arithmetic.
// Pure: no storage, no network (node bridge/scores-math.test.js).
//
// Training and Fatigue follow the Banister impulse-response model as
// TrainingPeaks, intervals.icu and Strava run it:
//   Fitness  (CTL) = exponentially weighted average of daily TSS, 42-day constant
//   Fatigue  (ATL) = the same with a 7-day constant
//   Form     (TSB) = yesterday's Fitness − yesterday's Fatigue
// Each day: X = X_prev + (TSS − X_prev) / days.
//
// Bands come from the coaching heuristics those apps publish:
//   Form zones (Friel): > +25 transition, +5..+25 fresh, −10..+5 grey,
//     −30..−10 productive, < −30 overreached.
//   Weekly CTL ramp (Friel): +5 to +8 a week is the sustainable build.
//   Acute:chronic ratio (Gabbett): 0.8–1.3 is the safe band, ≥ 1.5 a spike.
//   Recovery (WHOOP): 67+ green, 34–66 yellow, under 34 red; HRV and resting
//     HR are read against a personal baseline (Oura, Garmin do the same).
// ============================================================

// 42 and 7 are TrainingPeaks' nominal constants. The fatigue constant is
// what moves form, and the masters evidence (perceived recovery still down
// at 48 h, neuromuscular function back at 48 h not 24; Coggan used 10 days
// for himself at 57) says 10 for a 55-year-old, not 7.
const CTL_DAYS = 42, ATL_DAYS = 10;
const round1 = x => Math.round(x * 10) / 10;

// days: [{date, tss}] in ascending date order, one entry per calendar day.
// Returns one row per day with ctl/atl after that day's load, and tsb as the
// form you woke up with (yesterday's fitness − yesterday's fatigue).
function pmc(days, opts) {
  const o = Object.assign({ ctlDays: CTL_DAYS, atlDays: ATL_DAYS, ctl0: 0, atl0: 0 }, opts || {});
  let ctl = o.ctl0, atl = o.atl0;
  const out = [];
  for (const d of days) {
    const tss = Number.isFinite(Number(d.tss)) ? Number(d.tss) : 0;
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / o.ctlDays;
    atl = atl + (tss - atl) / o.atlDays;
    out.push({ date: d.date, tss, ctl: round1(ctl), atl: round1(atl), tsb: round1(tsb) });
  }
  return out;
}

// Contiguous daily series from a list of dated loads, zero-filled.
function dailyLoads(loads, from, to, shiftKey) {
  const byDate = {};
  for (const l of loads || []) {
    if (!l || !l.date) continue;
    byDate[l.date] = (byDate[l.date] || 0) + (Number(l.tss) || 0);
  }
  const out = [];
  for (let k = from; k <= to; k = shiftKey(k, 1)) {
    out.push({ date: k, tss: Math.round(byDate[k] || 0) });
    if (out.length > 400) break;
  }
  return out;
}

function formZone(tsb) {
  if (tsb == null) return null;
  if (tsb > 25) return { key: 'transition', word: 'transition', tone: 'warn',
    note: 'Very fresh. More than a week or two here and fitness starts to go.' };
  if (tsb >= 5) return { key: 'fresh', word: 'fresh', tone: 'good',
    note: 'Rested and ready. The place to be for a test or a race.' };
  if (tsb >= -10) return { key: 'grey', word: 'neutral', tone: 'neutral',
    note: 'Neither fresh nor loaded. Normal mid-week.' };
  if (tsb >= -30) return { key: 'productive', word: 'productive', tone: 'good',
    note: 'Carrying training fatigue in the range that builds fitness.' };
  return { key: 'overreached', word: 'overreached', tone: 'bad',
    note: 'Deep in the hole. Back off before something breaks.' };
}

// Weekly fitness ramp. Friel's 5 to 8 is a pro-derived heuristic; for an
// amateur in his fifties the coaching range is 3 to 5 (Couzens), so
// building runs 2 to 6 and above 6 is too fast. No trial has tested either.
function rampBand(ramp) {
  if (ramp == null) return null;
  if (ramp < -2) return { key: 'losing', word: 'losing', tone: 'warn' };
  if (ramp < 2) return { key: 'holding', word: 'holding', tone: 'neutral' };
  if (ramp <= 6) return { key: 'building', word: 'building', tone: 'good' };
  return { key: 'too-fast', word: 'too fast', tone: 'bad' };
}

// The acute:chronic ratio is gone: Impellizzeri's reanalysis showed its
// injury "signal" reproduces with a constant or random denominator. Foster's
// monotony stays as an honest, individual flag: a week of same-sized days
// carries more strain than the same load varied.
function monotony(last7) {
  const xs = (last7 || []).map(d => d.tss);
  if (xs.length < 7) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  if (!sd) return mean ? { value: 9.9, strain: Math.round(mean * 7 * 9.9), band: 'high' } : null;
  const m = Math.round(mean / sd * 100) / 100;
  return { value: m, strain: Math.round(mean * 7 * m), band: m >= 2 ? 'high' : 'ok' };
}

// HRV-guided readiness, the rule the trials used (Vesterinen 2016, Javaloyes
// 2019): the 7-day mean of ln(rMSSD) against the 28-day mean, with a band of
// half a standard deviation. Inside or above the band: train as planned.
// Below it: swap the hard session for easy, keep the volume. Below it two
// days running: rest. Needs 14 nights before it speaks; 28 to be trusted.
function hrvGuide(wellness, todayHrv) {
  const hist = (wellness || []).map(w => w && w.hrv).filter(v => Number.isFinite(v) && v > 0);
  const all = todayHrv > 0 ? hist.concat([todayHrv]) : hist.slice();
  if (all.length < 14) return { state: 'warming', days: all.length, note: `HRV guide needs ${14 - all.length} more nights` };
  const ln = all.map(Math.log);
  const base = ln.slice(-28);
  const mean = base.reduce((a, b) => a + b, 0) / base.length;
  const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / base.length);
  const lo = mean - 0.5 * sd, hi = mean + 0.5 * sd;
  const week = ln.slice(-7); const m7 = week.reduce((a, b) => a + b, 0) / week.length;
  const prevWeek = ln.slice(-8, -1); const m7prev = prevWeek.length ? prevWeek.reduce((a, b) => a + b, 0) / prevWeek.length : m7;
  const below = m7 < lo, belowYesterday = m7prev < lo;
  const state = !below ? (m7 > hi ? 'high' : 'ok') : belowYesterday ? 'low2' : 'low';
  return { state, days: all.length, trusted: all.length >= 28,
    week_mean: Math.round(Math.exp(m7)), band_lo: Math.round(Math.exp(lo)), band_hi: Math.round(Math.exp(hi)),
    note: state === 'ok' ? 'HRV inside your band: train as planned'
      : state === 'high' ? 'HRV above your band: good week to go hard'
      : state === 'low' ? 'HRV below your band: swap the hard session for easy, keep the volume'
      : 'HRV below your band two days running: rest' };
}

function recoveryBand(score) {
  if (score == null) return null;
  if (score >= 67) return { key: 'green', word: 'green', tone: 'good' };
  if (score >= 34) return { key: 'yellow', word: 'yellow', tone: 'warn' };
  return { key: 'red', word: 'red', tone: 'bad' };
}

function median(values) {
  const v = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// value against the median of a trailing window; needs a few days to mean anything.
function vsBaseline(value, history, minDays) {
  const base = median(history);
  if (value == null || base == null || (history || []).filter(Number.isFinite).length < (minDays || 7)) {
    return { baseline: base, delta: null, delta_pct: null };
  }
  const delta = value - base;
  return { baseline: round1(base), delta: round1(delta), delta_pct: Math.round(delta / base * 100) };
}

// The whole front-page payload from the raw parts. Kept pure so the test can
// run it without Strava or WHOOP.
function scores(input) {
  const { loads, from, to, today, shiftKey, whoop, wellness } = input;
  const days = dailyLoads(loads, from, to, shiftKey);
  const series = pmc(days);
  const i = series.findIndex(r => r.date === today);
  const now = i >= 0 ? series[i] : series[series.length - 1] || null;
  const weekAgo = i >= 7 ? series[i - 7] : null;
  const ramp = now && weekAgo ? round1(now.ctl - weekAgo.ctl) : null;
  const last7 = series.slice(Math.max(0, i - 6), i + 1);
  const tss7 = last7.reduce((s, r) => s + r.tss, 0);
  const yesterday = i >= 1 ? series[i - 1] : null;

  const training = now ? {
    ctl: Math.round(now.ctl), ramp_7d: ramp, ramp: rampBand(ramp),
    tss_7d: tss7, tss_today: now.tss, days_of_data: series.length
  } : null;

  const fatigue = now ? {
    atl: Math.round(now.atl), tsb: Math.round(now.tsb), form: formZone(now.tsb),
    monotony: monotony(last7),
    tss_yesterday: yesterday ? yesterday.tss : 0
  } : null;

  const rec = whoop && whoop.recovery ? whoop.recovery : null;
  const hist = (wellness || []).filter(w => w && w.date !== today).slice(-30);
  const hrv = vsBaseline(rec ? rec.hrv : null, hist.map(w => w.hrv));
  const rhr = vsBaseline(rec ? rec.rhr : null, hist.map(w => w.rhr));
  const resp = vsBaseline(rec ? rec.resp : null, hist.map(w => w.resp));
  const recovery = {
    resp: rec ? rec.resp ?? null : null, resp_baseline: resp.baseline, resp_delta: resp.delta,
    spo2: rec ? rec.spo2 ?? null : null, skin_temp_c: rec ? rec.skin_temp_c ?? null : null,
    score: rec && rec.score != null ? Math.round(rec.score) : null,
    band: recoveryBand(rec ? rec.score : null),
    hrv: rec ? rec.hrv ?? null : null, hrv_baseline: hrv.baseline, hrv_delta_pct: hrv.delta_pct,
    rhr: rec ? rec.rhr ?? null : null, rhr_baseline: rhr.baseline, rhr_delta: rhr.delta,
    guide: hrvGuide(hist, rec ? rec.hrv : null),
    sleep_h: whoop && whoop.sleep ? whoop.sleep.hours ?? null : null,
    sleep_performance: whoop && whoop.sleep ? whoop.sleep.performance ?? null : null,
    baseline_days: hist.filter(w => Number.isFinite(w.hrv)).length
  };

  return { today, training, fatigue, recovery,
    series: series.slice(Math.max(0, i - 27), i + 1).map(r => ({ date: r.date, tss: r.tss, ctl: r.ctl, atl: r.atl })) };
}

module.exports = { CTL_DAYS, ATL_DAYS, pmc, dailyLoads, formZone, rampBand, monotony, hrvGuide,
  recoveryBand, median, vsBaseline, scores };
