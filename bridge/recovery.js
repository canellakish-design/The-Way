// ============================================================
// recovery.js — one recovery model, read by everything that speaks of it: the Day's tile and its
// advice (scores.js), and the chain's Recovery link (chain.js). Before this each had its own: the tile
// read the watch's score, the chain the week's HRV against a 60-day band, the Day's HRV guide seven
// days against 28, and they could disagree on the same morning.
//
// The model: the week's HRV (the mean of ln rMSSD over the last seven nights) against a 60-day
// baseline of the same, with a step of half the baseline's night-to-night spread (the smallest
// worthwhile change, Plews and Buchheit). Inside or above the band is green; one step under is a dip;
// two steps under, or one step under with the resting heart rate up and short sleep, is red. Fewer than
// fourteen nights and there is no band yet. The baseline moves with the rider, so green keeps meaning
// normal for the rider he is now. HRV and resting HR come from the current watch only.
//
// The watch's own morning number (readiness, or WHOOP's recovery) stays as the day's line beside it,
// read on the published bands: 67 and up green, 34 to 66 amber, under 34 red.
// ============================================================
const tz = require('./tz');

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const sd = xs => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };

function recoveryState(o) {
  const n = (o.hrv_week || []).length + (o.hrv_base || []).length;
  if (n < 14 || (o.hrv_week || []).length < 3 || (o.hrv_base || []).length < 7) return { state: 'none', steps: null, pct: null, why: `${n} nights so far; a band needs fourteen` };
  const lw = mean(o.hrv_week.map(Math.log)), lb = mean(o.hrv_base.map(Math.log)), s = Math.max(0.03, (sd(o.hrv_base.map(Math.log)) || 0.08) * 0.5);
  const steps = (lw - lb) / s, pct = Math.round((Math.exp(lw - lb) - 1) * 100);
  const rhrUp = o.rhr_week != null && o.rhr_base != null && o.rhr_sd != null && o.rhr_week > o.rhr_base + Math.max(0.8, 0.5 * o.rhr_sd);
  const shortSleep = o.sleep_week != null && o.sleep_week < 6.25;
  let state, why;
  if (steps <= -2) { state = 'bad'; why = `HRV ${pct}% under your band, two steps down`; }
  else if (steps <= -1 && rhrUp && shortSleep) { state = 'bad'; why = `HRV ${pct}% under your band with resting HR up and short sleep`; }
  else if (steps <= -1) { state = 'warn'; why = `HRV ${pct}% under your band: a dip`; }
  else { state = 'good'; why = steps >= 1 ? `HRV ${pct > 0 ? '+' : ''}${pct}% above your band` : `HRV inside your band (${pct > 0 ? '+' : ''}${pct}%)`; }
  return { state, steps: Math.round(steps * 10) / 10, pct, rhr_up: !!rhrUp, why };
}

// The guide the Day's advice reads, from the same band: the rule the trials used (Vesterinen 2016,
// Javaloyes 2019). Inside or above: train as planned; a dip: swap the hard session for easy, keep the
// volume; red: rest.
function guideFromBand(band, nights) {
  if (!band || band.state === 'none') return { state: 'warming', days: nights || 0, note: band && band.why ? band.why : 'HRV band not set yet' };
  const state = band.state === 'bad' ? 'low2' : band.state === 'warn' ? 'low' : band.steps >= 1 ? 'high' : 'ok';
  return { state, days: nights || null, trusted: true, steps: band.steps, pct: band.pct,
    note: state === 'ok' ? 'HRV inside your band: train as planned'
      : state === 'high' ? 'HRV above your band: good week to go hard'
      : state === 'low' ? 'HRV below your band: swap the hard session for easy, keep the volume'
      : 'HRV well below your band: rest' };
}

// The week against the band, from the watch's mornings through intervals.icu with the hand-entered
// mornings laid over. weekFrom: the first day of the week being judged (the chain's seven-day clock).
async function weekBand(today, weekFrom) {
  const out = { nights: [], recs: [], band: { state: 'none', why: 'no watch' }, hrv_week_ms: null, hrv_base_ms: null, rhr_week: null, all: [] };
  const iv = require('./intervals');
  if (!iv.configured()) return out;
  const w = await iv.wellnessRange(tz.shiftKey(today, -60), today);
  const all = await require('./wellness').overlay(w.days || []);   // a morning entered by hand wins for its date
  const from = weekFrom || tz.shiftKey(today, -6), baseFrom = tz.shiftKey(today, -60);
  const DV = require('./devices'), since = DV.WEARABLE_SINCE, mine = d => d.date >= since;
  const hrvWeek = all.filter(d => mine(d) && d.date >= from && d.hrv > 0).map(d => d.hrv);
  const hrvBase = all.filter(d => mine(d) && d.date >= baseFrom && d.date < from && d.hrv > 0).map(d => d.hrv);
  const rhrW = all.filter(d => mine(d) && d.date >= from && d.rhr > 0).map(d => d.rhr), rhrB = all.filter(d => mine(d) && d.date >= baseFrom && d.date < from && d.rhr > 0).map(d => d.rhr);
  const sleepW = all.filter(d => d.date >= from && d.sleep_h >= 2.5).map(d => d.sleep_h);
  const band = recoveryState({ hrv_week: hrvWeek, hrv_base: hrvBase, rhr_week: mean(rhrW), rhr_base: mean(rhrB), rhr_sd: sd(rhrB), sleep_week: mean(sleepW) });
  if (band.state === 'none' && since > baseFrom) band.why = `a new watch (${DV.WEARABLE}) since ${tz.labelOf ? tz.labelOf(since) : since}: ${hrvWeek.length + hrvBase.length} of 14 nights before its own band is set; until then each morning reads on its own`;
  out.band = band; out.all = all; out.nights_on_record = hrvWeek.length + hrvBase.length;
  out.hrv_week_ms = hrvWeek.length ? Math.round(mean(hrvWeek)) : null; out.hrv_base_ms = hrvBase.length ? Math.round(mean(hrvBase)) : null; out.rhr_week = rhrW.length ? Math.round(mean(rhrW)) : null;
  const M = require('./scores-math');
  for (const d of all) {
    if (d.date < from) continue;
    // a night under two and a half hours is the watch off the wrist, not a night: kept in the list, left out of the mean
    if (d.sleep_h != null) out.nights.push({ date: d.date, hours: d.sleep_h, score: d.sleep_score, counted: d.sleep_h >= 2.5, manual: d.manual || null });
    let score = d.readiness;
    if (score == null && (d.hrv != null || d.sleep_h != null)) {
      const hist = all.filter(x => x.date < d.date && x.hrv != null && x.date >= since).slice(-30).map(x => x.hrv);
      const b = M.vsBaseline ? M.vsBaseline(d.hrv, hist) : { delta_pct: 0 };
      score = Math.max(10, Math.min(100, Math.round(60 + ((b && b.delta_pct) || 0) * 1.2 + ((d.sleep_h || 7) - 7) * 8)));
    }
    if (score != null) out.recs.push({ date: d.date, score, hrv: d.hrv, estimated: d.readiness == null, manual: d.manual || null });
  }
  return out;
}

module.exports = { recoveryState, guideFromBand, weekBand, mean, sd };
