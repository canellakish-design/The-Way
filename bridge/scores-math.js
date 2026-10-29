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

const CTL_DAYS = 42, ATL_DAYS = 7;
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

function rampBand(ramp) {
  if (ramp == null) return null;
  if (ramp < -2) return { key: 'losing', word: 'losing', tone: 'warn' };
  if (ramp < 2) return { key: 'holding', word: 'holding', tone: 'neutral' };
  if (ramp <= 8) return { key: 'building', word: 'building', tone: 'good' };
  return { key: 'too-fast', word: 'too fast', tone: 'bad' };
}

function acwr(atl, ctl) {
  if (!ctl || ctl < 5) return null;        // nothing to compare against yet
  return Math.round(atl / ctl * 100) / 100;
}
function acwrBand(r) {
  if (r == null) return null;
  if (r < 0.8) return { key: 'under', word: 'under-loaded', tone: 'neutral' };
  if (r <= 1.3) return { key: 'safe', word: 'safe', tone: 'good' };
  if (r < 1.5) return { key: 'high', word: 'high', tone: 'warn' };
  return { key: 'spike', word: 'spike', tone: 'bad' };
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

  const ratio = now ? acwr(now.atl, now.ctl) : null;
  const fatigue = now ? {
    atl: Math.round(now.atl), tsb: Math.round(now.tsb), form: formZone(now.tsb),
    acwr: ratio, acwr_band: acwrBand(ratio),
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
    sleep_h: whoop && whoop.sleep ? whoop.sleep.hours ?? null : null,
    sleep_performance: whoop && whoop.sleep ? whoop.sleep.performance ?? null : null,
    baseline_days: hist.filter(w => Number.isFinite(w.hrv)).length
  };

  return { today, training, fatigue, recovery,
    series: series.slice(Math.max(0, i - 27), i + 1).map(r => ({ date: r.date, tss: r.tss, ctl: r.ctl, atl: r.atl })) };
}

module.exports = { CTL_DAYS, ATL_DAYS, pmc, dailyLoads, formZone, rampBand, acwr, acwrBand,
  recoveryBand, median, vsBaseline, scores };
