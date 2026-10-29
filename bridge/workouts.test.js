// node bridge/workouts.test.js
const assert = require('assert');
const { pastNow, gradeOne, dayCompliance } = require('./workouts');
const tz = require('./tz');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const steps = [{ kind: 'step', label: 'Ride', dur_s: 3600, target: { type: 'free' }, cadence: null }];

ok('pastNow: saved after its date is a log, saved before its date is a plan', () => {
  // saved on the 29th for the 26th: logged
  assert.strictEqual(pastNow({ date: '2026-10-26', time: '18:00', steps, created: tz.noonOf('2026-10-29').toISOString() }, '2026-10-29'), true);
  // planned on the 26th for the 27th, never ridden: still a plan, so a miss
  assert.strictEqual(pastNow({ date: '2026-10-27', time: '06:00', steps, created: tz.noonOf('2026-10-26').toISOString() }, '2026-10-29'), false);
  // saved the same day after the ride ended: logged
  assert.strictEqual(pastNow({ date: '2026-10-29', time: '06:00', steps, created: tz.zonedToUTC(2026, 10, 29, 8, 0).toISOString() }, '2026-10-29'), true);
  // saved the same day before the ride: a plan
  assert.strictEqual(pastNow({ date: '2026-10-29', time: '06:00', steps, created: tz.zonedToUTC(2026, 10, 29, 5, 0).toISOString() }, '2026-10-29'), false);
  assert.strictEqual(pastNow({ date: '2026-10-29', steps }, '2026-10-29'), false);
});

ok('gradeOne: the plan against the ride, by the smaller of time and load', () => {
  const w = { metrics: { duration_s: 3600, tss: 40 } };
  assert.strictEqual(gradeOne(w, []).compliance.band, 'red');
  assert.strictEqual(gradeOne(w, [{ minutes: 58, tss: 38 }]).compliance.band, 'green');
  assert.strictEqual(gradeOne(w, [{ minutes: 40, tss: 30 }]).compliance.pct, 67);
  assert.strictEqual(gradeOne(w, [{ minutes: 40, tss: 30 }]).compliance.band, 'yellow');
  assert.strictEqual(gradeOne(w, [{ minutes: 20, tss: 12 }]).compliance.band, 'red');
  // no power and no heart rate: time alone, not a phantom zero load
  assert.strictEqual(gradeOne(w, [{ minutes: 60, tss: null }]).compliance.band, 'green');
  assert.strictEqual(gradeOne(Object.assign({ logged: true }, w), []).compliance.band, 'green');
  const g = gradeOne(w, [{ minutes: 58, tss: 38 }]);
  assert.strictEqual(dayCompliance([g], { planned_min: 60 }, true, 1).band, 'green');
  assert.strictEqual(dayCompliance([], { planned_min: 0 }, true, 1).band, 'extra');
  assert.strictEqual(dayCompliance([], { planned_min: 0 }, true, 0), null);
});

console.log(n + ' passed');
