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
  assert.strictEqual(easy.due.find(d => d.key === 'magnesium').time, '21:30');   // an hour before a 10:30 bed
  const hard = S.dueFor('2026-11-03', [{ name: 'VO2 40/20s', time: '17:00', sport: 'VirtualRide' }], [{ supplement: true, key: 'creatine', time: '07:10' }], 8 * 60, [{ supplement: true, key: 'magnesium', time: '21:30' }]);
  assert.ok(hard.due.some(d => d.key === 'sodium_bicarb' && d.time === '15:45'));
  assert.strictEqual(hard.due.find(d => d.key === 'creatine').taken, true);
  assert.strictEqual(hard.magnesium_last_night, true);
  const lift = S.dueFor('2026-11-04', [{ name: 'Push', time: '07:00', sport: 'WeightTraining' }], [], null, []);
  assert.ok(!lift.due.some(d => d.key === 'beetroot'));
});

ok('sleep first: nothing before waking (6:30); beetroot for a ride under 2 h after waking is on waking', () => {
  // Mon 9 and Tue 10 Nov: a 7:00 ride put beetroot at 4:30
  const seven = S.dueFor('2026-11-10', [{ name: 'Zone 1, 60 min', time: '07:30', sport: 'VirtualRide' }], [], 5 * 60, []);
  const b = seven.due.find(d => d.key === 'beetroot');
  assert.strictEqual(b.time, '06:30'); assert.strictEqual(b.on_waking, true);
  assert.ok(/on waking \(6:30\)/.test(b.why) && /less than the full 2 h, still worth it/.test(b.why), b.why);
  const half = S.dueFor('2026-11-10', [{ name: 'Zone 1', time: '08:30', sport: 'VirtualRide' }], [], null, []);
  const hb = half.due.find(d => d.key === 'beetroot');
  assert.strictEqual(hb.time, '06:30'); assert.strictEqual(hb.on_waking, false); assert.ok(/2 to 3 h before/.test(hb.why));
  const nine = S.dueFor('2026-11-10', [{ name: 'Zone 1', time: '09:30', sport: 'VirtualRide' }], [], null, []);
  assert.strictEqual(nine.due.find(d => d.key === 'beetroot').time, '07:00');
  // a hard ride at 7:30 would put bicarbonate at 6:15: it moves to waking
  const dawn = S.dueFor('2026-11-10', [{ name: 'VO2 40/20s', time: '07:30', sport: 'VirtualRide' }], [], null, []);
  for (const d of dawn.due) if (d.time) assert.ok(S.toMin(d.time) >= 390, d.key + ' at ' + d.time);
  // another window moves all of it: bed 10:00, up at 6:00
  const W = require('./sleep-window').rules({ bed: '22:00', wake: '06:00' });
  const other = S.dueFor('2026-11-10', [{ name: 'Zone 1', time: '07:00', sport: 'VirtualRide' }], [], null, [], W);
  assert.strictEqual(other.due.find(d => d.key === 'beetroot').time, '06:00');
  assert.strictEqual(other.due.find(d => d.key === 'magnesium').time, '21:00');
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
