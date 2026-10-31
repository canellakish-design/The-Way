// node bridge/chain.test.js
const assert = require('assert');
const C = require('./chain');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('states: one rule a link', () => {
  assert.strictEqual(C.stateOf('sleep', 7.2), 'good'); assert.strictEqual(C.stateOf('sleep', 6.5), 'warn'); assert.strictEqual(C.stateOf('sleep', 5.9), 'bad');
  assert.strictEqual(C.stateOf('food', 84), 'good'); assert.strictEqual(C.stateOf('work', 0.9), 'good'); assert.strictEqual(C.stateOf('work', 0.5), 'bad');
  assert.strictEqual(C.stateOf('weight', -0.8), 'good'); assert.strictEqual(C.stateOf('weight', 0.1), 'warn'); assert.strictEqual(C.stateOf('weight', 1.2), 'bad');
  assert.strictEqual(C.stateOf('weight', null), 'none');
});

ok('verdict: the first link from the left that is off is the break; all good and flat blames the target', () => {
  const L = { sleep: { week: 7.4, state: 'good' }, food: { week: 71, state: 'warn', days_on: 3, days_logged: 7 }, micros: { week: 90, state: 'good', gaps: [] }, water: { week: 90, state: 'good' }, work: { week: 95, state: 'good', done_min: 300, planned_min: 315 }, lift: { week: 80, state: 'good', sessions: 4, target: 5 }, recovery: { week: 72, state: 'good' }, weight: { week: 0.2, state: 'warn' } };
  const v = C.verdict(L);
  assert.strictEqual(v.break_at, 'food'); assert.ok(/breaks at macros: on plan 3 of 7/.test(v.text), v.text); assert.ok(/flat this week/.test(v.text));
  const all = Object.assign({}, L, { food: { week: 88, state: 'good', days_on: 6, days_logged: 7 } });
  const v2 = C.verdict(all);
  assert.strictEqual(v2.break_at, null); assert.ok(/calorie target is the suspect/.test(v2.text), v2.text);
  const down = Object.assign({}, all, { weight: { week: -0.9, state: 'good' } });
  assert.ok(/chain holds: weight down 0.9 lb/.test(C.verdict(down).text));
  const sleepy = Object.assign({}, all, { sleep: { week: 6.0, state: 'bad' } });
  assert.strictEqual(C.verdict(sleepy).break_at, 'sleep');
  const lowMicro = Object.assign({}, all, { micros: { week: 55, state: 'bad', gaps: ['iron', 'calcium'] } });
  const v3 = C.verdict(lowMicro); assert.strictEqual(v3.break_at, 'micros'); assert.ok(/low on iron, calcium/.test(v3.text), v3.text);
  assert.deepStrictEqual(C.ORDER, ['sleep', 'water', 'food', 'micros', 'lift', 'work', 'recovery', 'weight']);
  const noLift = Object.assign({}, all, { lift: { week: 20, state: 'bad', sessions: 1, target: 5 } });
  assert.ok(/breaks at lifting: 1 of 5 sessions/.test(C.verdict(noLift).text));
  const noRide = Object.assign({}, all, { work: { week: 40, state: 'bad', done_min: 120, planned_min: 300 } });
  assert.ok(/breaks at riding: 120 of 300 planned minutes ridden/.test(C.verdict(noRide).text));
  assert.strictEqual(C.stateOf('lift', 0.8), 'good'); assert.strictEqual(C.stateOf('lift', 0.6), 'warn');
});
console.log(n + ' passed');
