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
console.log(n + ' passed');
