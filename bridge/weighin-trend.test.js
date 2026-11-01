// node bridge/weighin-trend.test.js
const assert = require('assert');
const W = require('./weighin');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('trend: a straight line through three weeks of noisy readings reads the pound a week', () => {
  const now = Date.now(), e = [];
  for (let d = 20; d >= 0; d--) e.push({ ts: now - d * 864e5, lb: 220 - (20 - d) / 7 * 1.0 + ((d * 7) % 3 - 1) * 0.6 });   // down 1 lb/wk with ±0.6 lb noise
  const t = W.trend(e);
  assert.ok(t.trend_lb_wk <= -0.8 && t.trend_lb_wk >= -1.2, 'slope ' + t.trend_lb_wk);
  assert.strictEqual(W.trend(e.slice(-3)).trend_lb_wk, null);   // too few readings: no line
});
console.log(n + ' passed');
