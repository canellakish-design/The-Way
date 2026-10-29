// node bridge/workouts.test.js
const assert = require('assert');
const { pastNow } = require('./workouts');
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

console.log(n + ' passed');
