// node bridge/supps.test.js
const assert = require('assert');
const S = require('./supps');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('due: creatine every day, beetroot before the first ride, bicarbonate only before a hard one, magnesium in the evening', () => {
  const easy = S.dueFor('2026-11-02', [{ name: 'Z1 trainer 90 min', time: '09:30', sport: 'VirtualRide' }], [], 8 * 60, []);
  const keys = easy.due.map(d => d.key);
  assert.deepStrictEqual(keys, ['creatine', 'beetroot', 'magnesium']);
  assert.strictEqual(easy.due.find(d => d.key === 'beetroot').time, '07:00');
  assert.strictEqual(easy.due.find(d => d.key === 'magnesium').time, '21:00');
  const hard = S.dueFor('2026-11-03', [{ name: 'VO2 40/20s', time: '17:00', sport: 'VirtualRide' }], [{ supplement: true, key: 'creatine', time: '07:10' }], 8 * 60, [{ supplement: true, key: 'magnesium', time: '21:30' }]);
  assert.ok(hard.due.some(d => d.key === 'sodium_bicarb' && d.time === '15:45'));
  assert.strictEqual(hard.due.find(d => d.key === 'creatine').taken, true);
  assert.strictEqual(hard.magnesium_last_night, true);
  const lift = S.dueFor('2026-11-04', [{ name: 'Push', time: '07:00', sport: 'WeightTraining' }], [], null, []);
  assert.ok(!lift.due.some(d => d.key === 'beetroot'));
});

ok('the week: taken against due, beetroot only on ride days, bicarbonate only on hard days', () => {
  const rows = [
    { supps: ['creatine', 'beetroot', 'magnesium'], ride: true, hard: false },
    { supps: ['creatine'], ride: false, hard: false },
    { supps: ['creatine', 'beetroot', 'sodium_bicarb', 'magnesium'], ride: true, hard: true },
    { supps: ['magnesium'], ride: false, hard: false }
  ];
  const w = S.weekOf(rows);
  assert.deepStrictEqual(w.creatine, { taken: 3, due: 4 });
  assert.deepStrictEqual(w.beetroot, { taken: 2, due: 2 });
  assert.deepStrictEqual(w.sodium_bicarb, { taken: 1, due: 1 });
  assert.deepStrictEqual(w.magnesium, { taken: 3, due: 4 });
});
console.log(n + ' passed');
