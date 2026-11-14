// node bridge/where.test.js
const assert = require('assert');
const X = require('./where');
const D = require('./dayplan');
const WK = require('./workouts');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const hr = (hour, temp_f, cscore, cwhy) => ({ hour, temp_f, cscore, cwhy: cwhy || [] });
ok('where each session is done: lifts at Life Time, kettlebells at home, the trainer in the pain cave, a ride outside', () => {
  assert.strictEqual(X.placeOf({ sport: 'WeightTraining', name: 'Pull and calves' }), 'Life Time');
  assert.strictEqual(X.placeOf({ sport: 'WeightTraining', name: 'Kettlebell Blast B · home' }), 'home');
  assert.strictEqual(X.placeOf({ sport: 'VirtualRide', name: 'Z1 trainer 60 min' }), 'pain cave');
  assert.strictEqual(X.placeOf({ sport: 'Ride', name: 'Z1 road 150 min' }), 'outside');
  assert.strictEqual(X.placeOf({ sport: 'Ride', name: 'Z1 road 150 min', indoor: { why: '44°F, under 50' } }), 'pain cave');
  assert.strictEqual(X.placeOf({ sport: 'Ride', name: 'MTB', location: 'Kingsview Village Avenue, Boyds, MD' }), null, 'a ride with its own place keeps it');
});
ok('bad weather sends a ride indoors: under 50°F, or grading under a B; a fine afternoon does not; no forecast is no call', () => {
  assert.strictEqual(X.badWeather([hr(8, 44, 60), hr(9, 46, 70)], 480, 570), '44°F, under 50');
  assert.ok(/grades [C-F]/.test(X.badWeather([hr(13, 58, 40, ['rain 80%']), hr(14, 58, 45, ['rain 70%'])], 780, 870)));
  assert.strictEqual(X.badWeather([hr(13, 60, 100), hr(14, 60, 100)], 780, 870), null);
  assert.strictEqual(X.badWeather([hr(13, 60, 100)], 480, 540), null);
});
ok('the calls: rides outside today (not started) and three days on; trainer rides, lifts and rides with a place are left', () => {
  const W = { a: { id: 'a', sport: 'Ride', name: 'Z1 road', date: '2026-11-14', time: '08:00', steps: [{ dur_s: 3600 }] },                 // started
    b: { id: 'b', sport: 'Ride', name: 'Z1 road 60', date: '2026-11-14', time: '16:15', steps: [{ dur_s: 3600 }] },
    c: { id: 'c', sport: 'VirtualRide', name: 'Z1 trainer', date: '2026-11-15', time: '09:00' }, d: { id: 'd', sport: 'WeightTraining', name: 'Push', date: '2026-11-15', time: '10:00' },
    e: { id: 'e', sport: 'Ride', name: 'MTB', date: '2026-11-15', time: '14:20', location: 'Boyds, MD' },
    f: { id: 'f', sport: 'Ride', name: 'Z1 road 90', date: '2026-11-16', time: '13:00', steps: [{ dur_s: 5400 }], indoor: { why: 'old' } },
    g: { id: 'g', sport: 'Ride', name: 'far', date: '2026-11-20', time: '13:00' } };
  const days = { '2026-11-14': { hours: [hr(16, 48, 69), hr(17, 47, 0, ['dark 40 min'])] }, '2026-11-16': { hours: [hr(13, 60, 100), hr(14, 61, 100)] } };
  const c = X.calls(W, days, '2026-11-14', 13 * 60);
  assert.deepStrictEqual(c.map(x => [x.id, x.why, x.had]), [['b', '47°F, under 50', null], ['f', null, 'old']]);
});
ok('never a ride at Life Time: one is refused when planned or renamed; a lift there is fine; moving an old one in time still works', () => {
  assert.throws(() => WK.clean({ sport: 'Ride', name: 'Z1 60 min · Life Time bike', date: '2026-11-20', time: '16:15' }), /never rides at Life Time/);
  assert.throws(() => WK.clean({ sport: 'VirtualRide', name: 'Z1 60', notes: 'On a Lifetime bike after the lift', date: '2026-11-20', time: '16:15' }), /never rides at Life Time/);
  assert.strictEqual(WK.clean({ sport: 'WeightTraining', name: 'Pull', notes: 'Life Time Annapolis', date: '2026-11-20', time: '15:15' }).sport, 'WeightTraining');
  const old = { id: 'w_1', sport: 'Ride', name: 'Z1 60 min · Life Time bike', date: '2026-11-20', time: '16:15', steps: [] };
  assert.strictEqual(WK.clean({ time: '16:30' }, old).time, '16:30');
  assert.strictEqual(WK.clean({ name: 'Z1 trainer 60 min', sport: 'VirtualRide', notes: 'In the pain cave.' }, old).name, 'Z1 trainer 60 min');
});
ok('the mark is kept on the workout and cleared by a new time', () => {
  const w = WK.clean({ indoor: { why: '47°F, under 50' } }, { id: 'w_2', sport: 'Ride', name: 'Z1 road 60', date: '2026-11-20', time: '16:15', steps: [] });
  assert.strictEqual(w.indoor.why, '47°F, under 50');
  assert.strictEqual(WK.clean({ time: '13:00' }, w).indoor, null);
  assert.strictEqual(WK.clean({ notes: 'x' }, w).indoor.why, '47°F, under 50');
});
ok('the lift at Life Time, then the ride in the pain cave: 15 minutes between them, and the later one gives way', () => {
  const m = (h, mi) => h * 60 + (mi || 0);
  const lift = { category: 'training', summary: 'Pull', place: 'Life Time', start_min: m(15, 15), end_min: m(16, 10) };
  const ride = { category: 'training', summary: 'Z1 trainer 60 min', place: 'pain cave', start_min: m(16, 15), end_min: m(17, 15) };
  assert.strictEqual(D.changeover(lift, ride), 15);
  assert.strictEqual(D.changeover(lift, Object.assign({}, lift)), 0, 'two sessions in one place need none');
  const rows = [Object.assign({}, lift), Object.assign({}, ride)]; D.markClashes(rows, { wake: 390, bed: 1350 });
  assert.ok(!rows[0].clash, 'the lift stays'); assert.ok(rows[1].clash && rows[1].clash.tight, JSON.stringify(rows[1].clash));
  assert.strictEqual(rows[1].clash.fix_min, m(16, 25));
});
ok('Start: the session takes the minute he pressed, and what follows today moves back behind it (15 minutes between two places)', () => {
  const st = s => [{ dur_s: s * 60 }];
  const day = [{ id: 'pull', sport: 'WeightTraining', name: 'Pull and calves', time: '15:15', steps: st(55) }, { id: 'z1', sport: 'VirtualRide', name: 'Z1 trainer 60 min', time: '16:25', steps: st(60) }, { id: 'kb', sport: 'WeightTraining', name: 'Kettlebell Blast B · home', time: '19:30', steps: st(30) }];
  // he starts the lift at 4:11p, 56 minutes late: it ends 5:06p, the ride (at home) is 15 minutes on, rounded up to 5:25p; the evening session is untouched
  assert.deepStrictEqual(WK.startPlan(day, 'pull', 16 * 60 + 11), [{ id: 'pull', time: '16:11' }, { id: 'z1', time: '17:25' }]);
  // started early: nothing after it needs to move
  assert.deepStrictEqual(WK.startPlan(day, 'pull', 15 * 60 + 5), [{ id: 'pull', time: '15:05' }]);
  // the ride started late pushes the kettlebells only if it runs into them (same place: no gap needed)
  assert.deepStrictEqual(WK.startPlan(day, 'z1', 18 * 60 + 50), [{ id: 'z1', time: '18:50' }, { id: 'kb', time: '19:50' }]);
  // a start before 7 a.m. is a fact, kept as it is; planning one there is still refused
  assert.strictEqual(WK.clean({ time: '06:40', started_at: '2026-11-20T11:40:00Z' }, { id: 'w', sport: 'Ride', name: 'Z1', date: '2026-11-20', time: '07:30', steps: [] }, '07:30', true).time, '06:40');
  assert.throws(() => WK.clean({ time: '06:40' }, { id: 'w', sport: 'Ride', name: 'Z1', date: '2026-11-20', time: '07:30', steps: [] }, '07:30'), /before 7/);
});
console.log(n + ' passed');
