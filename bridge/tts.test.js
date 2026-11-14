// node bridge/tts.test.js
const assert = require('assert');
const T = require('./tts');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('what is read aloud: no markdown or links, times and units as a person says them, capped', () => {
  assert.strictEqual(T.clean('**Fitness** is 16. Ride at 4:15p, Z1 for 90 min: 45 g carbs. See https://x.y/z'), 'Fitness is 16. Ride at 4:15 p.m., Zone 1 for 90 minutes: 45 grams carbs. See');
  assert.strictEqual(T.clean('VO2 at 7:00a, 56°F, 2 h, 600 kcal'), 'V O 2 at 7 a.m., 56 degrees, 2 hours, 600 calories');
  assert.strictEqual(T.clean('x'.repeat(5000)).length, T.MAX);
  assert.strictEqual(T.clean(''), '');
});
console.log(n + ' passed');
