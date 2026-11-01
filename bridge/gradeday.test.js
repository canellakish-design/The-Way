// node bridge/gradeday.test.js
const assert = require('assert');
const { gradeDay } = require('./workouts');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('gradeDay: one ride grades the nearest planned session only; the afternoon one stays ahead until its time', () => {
  const plan = (name, time, min) => ({ name, time, metrics: { duration_s: min * 60, tss: Math.round(min * 0.5) } });
  const planned = [plan('Zone 1, 150 min', '09:45', 150), plan('Zone 1, 60 min · mountain bike', '15:00', 60)];
  const ride = { id: 1, time: '09:49', minutes: 83, tss: 59 };
  const out = gradeDay(planned, [ride], false, 12 * 60);
  assert.ok(out[0].compliance && out[0].compliance.pct === 55, JSON.stringify(out[0].compliance));
  assert.ok(!out[1].compliance, 'afternoon not graded yet');
  const later = gradeDay(planned, [ride], false, 17 * 60);
  assert.ok(later[1].compliance && later[1].compliance.pct === 0 && /no ride/.test(later[1].compliance.basis), JSON.stringify(later[1].compliance));
  const two = gradeDay(planned, [ride, { id: 2, time: '15:10', minutes: 62, tss: 31 }], false, 17 * 60);
  assert.ok(two[1].compliance.pct >= 100 && two[1].compliance.band === 'green', JSON.stringify(two[1].compliance));
});
console.log(n + ' passed');
