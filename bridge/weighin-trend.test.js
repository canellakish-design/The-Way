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
ok('weekly, on Wednesdays: three readings over two weeks draw the line; the week is this reading against last week\'s', () => {
  const now = Date.now(), wk = 7 * 864e5;
  // five Wednesdays, down a pound a week, each weighed at a slightly different time of day
  const e = [0, 1, 2, 3, 4].map(k => ({ ts: now - (4 - k) * wk + (k % 2 ? 40 : -25) * 6e4, lb: 220 - k }));
  const t = W.trend(e);
  assert.ok(t.trend_lb_wk <= -0.9 && t.trend_lb_wk >= -1.1, 'slope ' + t.trend_lb_wk);
  assert.strictEqual(t.week_change_lb, -1);
  // two readings only: no line yet, but the week's change is there
  const two = W.trend(e.slice(-2));
  assert.strictEqual(two.trend_lb_wk, null); assert.strictEqual(two.week_change_lb, -1);
  // last week's reading a little under seven days old falls in this week's window: still the week's change
  const close = W.trend([{ ts: now - wk + 30 * 6e4, lb: 219 }, { ts: now, lb: 218 }]);
  assert.strictEqual(close.week_change_lb, -1);
  assert.strictEqual(t.weigh_day, 3);
});
ok('a weight as a Shortcut sends a Health sample: a number, "217.9 lb", "98.8 kg"', () => {
  assert.strictEqual(W.lbOf(217.9), 217.9); assert.strictEqual(W.lbOf('217.9 lb'), 217.9);
  assert.strictEqual(W.lbOf('98.8 kg'), 217.8); assert.strictEqual(W.lbOf('217,9'), 217.9); assert.strictEqual(W.lbOf('none'), null);
});
ok('what he weighs is his last weigh-in, said with its day; the average is named as an average', () => {
  const at = (d, h) => Date.parse(`2026-11-${String(d).padStart(2, '0')}T${h}:00:00-05:00`);
  // 217.9 on the 11th and 216.4 on the 12th: the coach said 217 (their average, 217.2)
  const w = W.weightWords([{ ts: at(11, '09'), lb: 217.9 }, { ts: at(12, '09'), lb: 216.4 }], '2026-11-15');
  assert.ok(/^HIS WEIGHT: 216\.4 lb, his last weigh-in \(Thu, Nov 12, 3 days ago\)/.test(w), w);
  assert.ok(/average 217\.2 lb: an average, for the trend only/.test(w), w);
  assert.ok(/First on record: 217\.9 lb .*down 1\.5 lb since/.test(w), w);
  assert.ok(!/more than three days old/.test(w));
  const old = W.weightWords([{ ts: at(8, '09'), lb: 218 }], '2026-11-15');
  assert.ok(/7 days ago/.test(old) && /more than three days old/.test(old) && !/average/.test(old), old);
  assert.ok(/, today\)/.test(W.weightWords([{ ts: at(15, '07'), lb: 216 }], '2026-11-15')));
  assert.ok(/no weigh-in on record/.test(W.weightWords([], '2026-11-15')));
});
console.log(n + ' passed');

