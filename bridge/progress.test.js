// node bridge/progress.test.js
const assert = require('assert');
const P = require('./progress');
const R = require('./ride-math');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('progress states: up is good for power and watts a beat, down is good for decoupling, under 5% is good regardless', () => {
  assert.strictEqual(P.stateOf('tp', 156, 152), 'good'); assert.strictEqual(P.stateOf('tp', 152, 152), 'warn'); assert.strictEqual(P.stateOf('tp', 148, 152), 'bad');
  assert.strictEqual(P.stateOf('p5', 240, 232), 'good'); assert.strictEqual(P.stateOf('p5', 230, 232), 'warn');
  assert.strictEqual(P.stateOf('ef', 1.30, 1.25), 'good'); assert.strictEqual(P.stateOf('ef', 1.25, 1.25), 'warn'); assert.strictEqual(P.stateOf('ef', 1.20, 1.25), 'bad');
  assert.strictEqual(P.stateOf('decoup', 8, 11), 'good'); assert.strictEqual(P.stateOf('decoup', 4, 4), 'good'); assert.strictEqual(P.stateOf('decoup', 9, 9), 'warn'); assert.strictEqual(P.stateOf('decoup', 12, 9), 'bad');
  assert.strictEqual(P.stateOf('tp', null, 152), 'none'); assert.strictEqual(P.stateOf('ef', 1.3, 1.2, { now: 0, before: 3 }), 'none');
});
ok('decoupling: a steady ride whose heart rate drifts 8% for the same watts reads 8%; a short ride reads nothing', () => {
  const n = 7200, watts = [], hr = [];
  for (let i = 0; i < n; i++) { watts.push(140); hr.push(i < n / 2 ? 110 : 119); }
  const d = R.decoupling(watts, hr);
  assert.ok(d && d.steady, JSON.stringify(d)); assert.ok(d.pct > 6 && d.pct < 9, 'pct ' + d.pct); assert.ok(Math.abs(d.ef - 140 / 114.5) < 0.05, 'ef ' + d.ef);
  assert.strictEqual(R.decoupling(watts.slice(0, 1800), hr.slice(0, 1800)), null);
  const spiky = watts.map((w, i) => i % 60 < 10 ? 400 : 60);
  assert.strictEqual(R.decoupling(spiky, hr).steady, false);
});
console.log(n + ' passed');
