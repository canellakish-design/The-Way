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
  // the plan lives in intervals.icu: the day's totals grade it
  assert.strictEqual(dayCompliance([], { planned_min: 60, planned_tss: 40, done_min: 114, done_tss: 86 }, true, 1).band, 'green');
  assert.strictEqual(dayCompliance([], { planned_min: 60, planned_tss: 40, done_min: 20, done_tss: 10 }, true, 1).band, 'red');
});

ok('gradeOne: a VO2 session is graded by minutes above 147 when the heart rate was read', () => {
  const vo2 = { name: 'VO2 max: Zwift 40/20s #1', metrics: { duration_s: 3000, tss: 65 } };
  const ride = { minutes: 50, tss: 60, analysis: { hr: { minutes_above_hard: 9.5 } } };
  assert.strictEqual(gradeOne(vo2, [ride]).compliance.band, 'green');
  assert.ok(/above 147/.test(gradeOne(vo2, [ride]).compliance.basis));
  assert.strictEqual(gradeOne(vo2, [{ minutes: 50, tss: 60, analysis: { hr: { minutes_above_hard: 3 } } }]).compliance.band, 'red');
  // no heart rate read yet: time and load, as for any session
  assert.strictEqual(gradeOne(vo2, [{ minutes: 50, tss: 60 }]).compliance.band, 'green');
});

console.log(n + ' passed');
