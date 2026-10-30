// node bridge/lifts.test.js
const assert = require('assert');
const L = require('./lifts');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const swing = L.TEMPLATES[0].exercises[0], press = L.TEMPLATES[0].exercises[2], plank = L.TEMPLATES[0].exercises[4];

ok('first time: start light at the bottom of the range', () => {
  const t = L.target(swing, null);
  assert.strictEqual(t.lb, 35); assert.strictEqual(t.reps, 12); assert.strictEqual(t.progress, false);
});
ok('double progression: hold the weight until every set tops the range, then the next bell', () => {
  const held = L.target(swing, { sets: [{ reps: 15, lb: 35 }, { reps: 14, lb: 35 }, { reps: 12, lb: 35 }, { reps: 12, lb: 35 }] });
  assert.strictEqual(held.lb, 35); assert.strictEqual(held.reps, 13); assert.strictEqual(held.progress, false);
  const up = L.target(swing, { sets: [{ reps: 15, lb: 35 }, { reps: 15, lb: 35 }, { reps: 15, lb: 35 }, { reps: 16, lb: 35 }] });
  assert.strictEqual(up.lb, 44); assert.strictEqual(up.reps, 12); assert.strictEqual(up.progress, true);
  const bow = L.target(press, { sets: [{ reps: 12, lb: 90 }, { reps: 12, lb: 90 }, { reps: 12, lb: 90 }] });
  assert.strictEqual(bow.lb, 100);
});
ok('timed and bodyweight work progresses in seconds and reps', () => {
  const p = L.target(plank, { sets: [{ reps: 60, lb: 0 }, { reps: 60, lb: 0 }, { reps: 60, lb: 0 }] });
  assert.strictEqual(p.reps, 75); assert.strictEqual(p.lb, 0);
});
ok('strength as an estimated one-rep max, and the bells step up the ladder', () => {
  assert.strictEqual(L.e1rm(100, 10), 133); assert.strictEqual(L.e1rm(0, 10), null);
  assert.strictEqual(L.nextBell(35), 44); assert.strictEqual(L.nextBell(88), 98);
});
console.log(n + ' passed');
