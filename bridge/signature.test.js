// node bridge/signature.test.js
const assert = require('assert');
const S = require('./signature');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('the curve runs to PP at zero and to TP as time grows', () => {
  assert.ok(Math.abs(S.pd(0.001, 180, 15000, 800) - 800) < 1);
  assert.ok(Math.abs(S.pd(36000, 180, 15000, 800) - 180) < 1);
  assert.ok(S.pd(60, 180, 15000, 800) > S.pd(300, 180, 15000, 800));
});

ok('mean-maximal power: a 40/20 session reads its own structure', () => {
  const w = []; for (let i = 0; i < 3000; i++) w.push(i < 600 ? 110 : (i % 60 < 40 ? 191 : 96));
  const m = S.mmpCurve(w);
  assert.strictEqual(m[5], 191); assert.ok(m[60] > 150 && m[60] < 170, '1 min ' + m[60]); assert.ok(m[1200] > 150 && m[1200] < 165);
  assert.strictEqual(m[3600], undefined);   // shorter than an hour
});

ok('fit: a rider drawn from the model is read back within a few watts', () => {
  const tp = 180, hie = 15000, pp = 800;
  const pts = S.DURS.filter(t => t <= 3600).map(t => ({ dur_s: t, watts: Math.round(S.pd(t, tp, hie, pp)) }));
  const f = S.fit(pts);
  assert.ok(Math.abs(f.tp - tp) <= 3, 'tp ' + f.tp); assert.ok(Math.abs(f.hie_kj - 15) <= 2, 'hie ' + f.hie_kj); assert.ok(f.rmse_pct < 1.5);
  assert.strictEqual(S.fit(pts.slice(0, 3)), null);
});

ok('MPA: steady riding under TP never breaks through; a surge far above the curve does', () => {
  const sig = { tp: 175, hie_kj: 15, pp: 700 };
  const easy = Array(1800).fill(120);
  const e = S.mpaTrace(easy, sig);
  assert.strictEqual(e.over_s, 0); assert.strictEqual(e.tank_left_kj, 15);
  const surge = Array(600).fill(120).concat(Array(300).fill(260));   // 5 min at 260 W drains 25 kJ: more than the tank
  const s = S.mpaTrace(surge, sig);
  assert.ok(s.over_s > 0 && s.lowest_mpa <= 176, JSON.stringify({ over: s.over_s, low: s.lowest_mpa }));
});

ok('fit: easy long rides under the curve do not pull TP down; the curve is the lowest that stays above every effort', () => {
  const tp = 180, hie = 15000, pp = 800;
  const hard = S.DURS.filter(t => t >= 120 && t <= 600).map(t => ({ dur_s: t, watts: Math.round(S.pd(t, tp, hie, pp)) }));
  const easy = [1200, 1800, 2400, 3600, 5400].map(t => ({ dur_s: t, watts: 110 }));          // an easy hour at 110 W
  const f = S.fit([{ dur_s: 5, watts: pp }].concat(hard, easy));
  assert.ok(Math.abs(f.tp - tp) <= 6, 'tp ' + f.tp);                                          // the 5 and 10 minute efforts set TP, not the easy hour
  assert.ok(f.binding_durations.includes(300) && !f.binding_durations.includes(3600));
});

ok('breakthroughs: a ride that beats the curve the rides before it drew is one, and the signature moves up', () => {
  const mk = (id, date, tp, hie, pp, durs) => { const mmp = {}; for (const t of durs) mmp[t] = Math.round(S.pd(t, tp, hie, pp)); return { id, date, name: 'r' + id, minutes: 60, mmp }; };
  const base = S.DURS.filter(t => t <= 1800);
  const rides = [mk(1, '2026-09-01', 170, 14000, 700, base), mk(2, '2026-09-08', 170, 14000, 700, base), mk(3, '2026-09-15', 168, 14000, 700, base),
    mk(4, '2026-09-22', 185, 16000, 700, base)];                                                 // the fourth beats the curve
  const bt = S.breakthroughsOf(rides);
  assert.strictEqual(bt.length, 1); assert.strictEqual(bt[0].id, 4);
  assert.ok(bt[0].after.tp > bt[0].before.tp, JSON.stringify(bt[0].moved));
  assert.ok(/signature moved/.test(bt[0].text), bt[0].text);
  assert.ok(bt[0].hits.every(h => h.over_pct >= 2));
});
console.log(n + ' passed');
