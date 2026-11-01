// node bridge/dedupe.test.js
const assert = require('assert');
const { dedupeRides } = require('./workouts');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('dedupe: the Garmin copy of a Zwift ride folds into the one with power; two real rides stay two', () => {
  const rides = [
    { id: 2, date: '2026-11-01', time: '09:49', name: 'Morning Ride', type: 'Ride', minutes: 83, avg_w: null, avg_hr: 121 },
    { id: 1, date: '2026-11-01', time: '09:49', name: 'Zwift - Flat Route in Watopia', type: 'VirtualRide', minutes: 74, avg_w: 128, avg_hr: null },
    { id: 3, date: '2026-11-01', time: '15:00', name: 'Afternoon spin', type: 'Ride', minutes: 40, avg_w: null, avg_hr: 110 }
  ];
  const out = dedupeRides(rides);
  assert.strictEqual(out.length, 2, JSON.stringify(out));
  const z = out.find(r => r.id === 1); assert.ok(z, 'zwift kept'); assert.strictEqual(z.twin.id, 2); assert.strictEqual(z.avg_hr, 121);
  assert.ok(out.find(r => r.id === 3));
  const two = dedupeRides([{ id: 4, date: '2026-11-02', time: '07:00', minutes: 60 }, { id: 5, date: '2026-11-02', time: '09:00', minutes: 60 }]);
  assert.strictEqual(two.length, 2);
});
console.log(n + ' passed');
