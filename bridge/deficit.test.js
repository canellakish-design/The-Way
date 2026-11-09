// node bridge/deficit.test.js — the body's say on the day's deficit (food.js deficitFromBody):
// red recovery or low HRV two days running: maintenance; under 6 hours asleep: half; otherwise the plan's.
const assert = require('assert');
const { deficitFromBody } = require('./food');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok ' + name); };
ok('red recovery means maintenance, whatever the sleep', () => {
  assert.strictEqual(deficitFromBody({ recovery: 30, sleep_h: 8 }).deficit, 0);
  assert.strictEqual(deficitFromBody({ recovery: 30, sleep_h: 4 }).deficit, 0);
});
ok('HRV low two days running means maintenance', () => {
  assert.strictEqual(deficitFromBody({ recovery: 70, hrv_state: 'low2', sleep_h: 8 }).deficit, 0);
});
ok('under 6 hours asleep halves the deficit (5.3 h on 9 Nov: -450 becomes -220)', () => {
  const r = deficitFromBody({ recovery: 67, sleep_h: 5.3, base_deficit: -450 });
  assert.strictEqual(r.deficit, -220); assert.ok(/5.3 h asleep/.test(r.why));
  assert.strictEqual(deficitFromBody({ recovery: 67, sleep_h: 5.99, base_deficit: -450 }).deficit, -220);
});
ok('6 hours or more, or no reading, leaves the plan alone', () => {
  assert.strictEqual(deficitFromBody({ recovery: 67, sleep_h: 6 }).deficit, undefined);
  assert.strictEqual(deficitFromBody({ recovery: 67 }).deficit, undefined);
  assert.strictEqual(deficitFromBody({}).deficit, undefined);
});
console.log(n + ' passed');
