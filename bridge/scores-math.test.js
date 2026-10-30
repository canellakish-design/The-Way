// node bridge/scores-math.test.js
const assert = require('assert');
const M = require('./scores-math');
const tz = require('./tz');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('pmc: the TrainingPeaks recurrence, 42 and 10 day constants', () => {
  const days = [{ date: 'd1', tss: 84 }, { date: 'd2', tss: 0 }];
  const s = M.pmc(days);
  assert.strictEqual(s[0].ctl, 2);            // 84/42
  assert.strictEqual(s[0].atl, 8.4);          // 84/10: the masters fatigue constant
  assert.strictEqual(s[0].tsb, 0);            // woke up with nothing
  assert.strictEqual(s[1].tsb, -6.4);         // yesterday's fitness − fatigue
  assert.strictEqual(s[1].ctl, Math.round((2 - 2 / 42) * 10) / 10);
});

ok('pmc: steady load converges on the load', () => {
  const days = Array.from({ length: 400 }, (_, i) => ({ date: 'd' + i, tss: 60 }));
  const last = M.pmc(days).pop();
  assert.ok(Math.abs(last.ctl - 60) < 0.1 && Math.abs(last.atl - 60) < 0.1 && Math.abs(last.tsb) < 0.1);
});

ok('dailyLoads: zero-fills the gaps and sums a day with two rides', () => {
  const d = M.dailyLoads([{ date: '2026-10-01', tss: 40 }, { date: '2026-10-01', tss: 20 }, { date: '2026-10-03', tss: 90 }],
    '2026-10-01', '2026-10-03', tz.shiftKey);
  assert.deepStrictEqual(d.map(x => x.tss), [60, 0, 90]);
});

ok('bands: Friel form zones, ramp, Gabbett ratio, WHOOP colours', () => {
  assert.strictEqual(M.formZone(30).key, 'transition');
  assert.strictEqual(M.formZone(10).key, 'fresh');
  assert.strictEqual(M.formZone(0).key, 'grey');
  assert.strictEqual(M.formZone(-20).key, 'productive');
  assert.strictEqual(M.formZone(-31).key, 'overreached');
  assert.strictEqual(M.rampBand(5).key, 'building');
  assert.strictEqual(M.rampBand(7).key, 'too-fast');
  assert.strictEqual(M.rampBand(-3).key, 'losing');
  assert.strictEqual(M.monotony([{tss:50},{tss:50},{tss:50},{tss:50},{tss:50},{tss:50},{tss:50}]).band, 'high');
  assert.strictEqual(M.monotony([{tss:100},{tss:0},{tss:60},{tss:0},{tss:120},{tss:0},{tss:40}]).band, 'ok');
  assert.strictEqual(M.recoveryBand(67).key, 'green');
  assert.strictEqual(M.recoveryBand(66).key, 'yellow');
  assert.strictEqual(M.recoveryBand(33).key, 'red');
});

ok('vsBaseline: median baseline, and silent until a week of history', () => {
  const few = M.vsBaseline(50, [40, 42, 44]);
  assert.strictEqual(few.delta_pct, null);
  const r = M.vsBaseline(55, [40, 42, 44, 46, 48, 50, 100]);
  assert.strictEqual(r.baseline, 46);
  assert.strictEqual(r.delta_pct, 20);
});

ok('scores: the front-page payload from rides, WHOOP and the wellness log', () => {
  const today = '2026-10-29', from = tz.shiftKey(today, -119);
  const loads = [];
  for (let k = from; k <= today; k = tz.shiftKey(k, 1)) {
    const dow = new Date(k + 'T12:00:00Z').getUTCDay();
    if (dow === 0) loads.push({ date: k, tss: 120 });
    else if (dow !== 6) loads.push({ date: k, tss: 50 });
  }
  const wellness = Array.from({ length: 20 }, (_, i) => ({ date: tz.shiftKey(today, -20 + i), hrv: 40 + (i % 3), rhr: 52 }));
  const s = M.scores({ loads, from, to: today, today, shiftKey: tz.shiftKey,
    whoop: { recovery: { score: 71, hrv: 46, rhr: 50 }, sleep: { hours: 7.2, performance: 88 } }, wellness });
  assert.strictEqual(s.today, today);
  assert.ok(s.training.ctl > 40 && s.training.ctl < 60, 'ctl ' + s.training.ctl);
  assert.ok(s.training.ramp, 'has a ramp band');
  assert.ok(s.fatigue.form && s.fatigue.monotony);
  assert.strictEqual(s.recovery.guide.state, 'ok');
  assert.strictEqual(s.recovery.score, 71);
  assert.strictEqual(s.recovery.band.key, 'green');
  assert.strictEqual(s.recovery.hrv_baseline, 41);
  assert.strictEqual(s.recovery.rhr_delta, -2);
  assert.strictEqual(s.series.length, 42);
});

ok('hrvGuide: the 7-day mean against the 28-day band', () => {
  const steady = Array.from({ length: 28 }, (_, i) => ({ hrv: 40 + (i % 4) }));
  assert.strictEqual(M.hrvGuide(steady, 41).state, 'ok');
  const dip = steady.slice(0, 21).concat(Array.from({ length: 7 }, () => ({ hrv: 28 })));
  assert.strictEqual(M.hrvGuide(dip, 27).state, 'low2');
  assert.strictEqual(M.hrvGuide(steady.slice(0, 10), 40).state, 'warming');
  assert.strictEqual(M.hrvGuide(steady, 60).state, 'high');
});

ok('scores: no WHOOP, no rides — nulls, never a fake number', () => {
  const today = '2026-10-29';
  const s = M.scores({ loads: [], from: tz.shiftKey(today, -30), to: today, today, shiftKey: tz.shiftKey, whoop: null, wellness: [] });
  assert.strictEqual(s.training.ctl, 0);
  assert.strictEqual(s.fatigue.monotony, null);
  assert.strictEqual(s.recovery.guide.state, 'warming');
  assert.strictEqual(s.recovery.score, null);
  assert.strictEqual(s.recovery.band, null);
});

console.log(n + ' passed');
