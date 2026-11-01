// node bridge/weather-grade.test.js
const assert = require('assert');
const W = require('./weather');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const H = (o) => Object.assign({ hour: 10, feels_f: 65, wind_mph: 5, gust_mph: 8, rain_pct: 0, rain_in: 0 }, o);
ok('conditions grade: a perfect hour is A+, his wind bands step it down, dark or rain is an F', () => {
  assert.strictEqual(W.gradeRide([W.scoreHour(H({}), 7, 18)]).letter, 'A+');
  assert.strictEqual(W.gradeRide([W.scoreHour(H({ feels_f: 55, wind_mph: 10 }), 7, 18)]).letter, 'A');
  const amber = W.gradeRide([W.scoreHour(H({ feels_f: 48, wind_mph: 14 }), 7, 18)]); assert.ok(/^B|^C\+/.test(amber.letter), amber.letter);
  const red = W.gradeRide([W.scoreHour(H({ wind_mph: 18, gust_mph: 30 }), 7, 18)]); assert.ok(/^C−|^D/.test(red.letter), red.letter + ' ' + red.score);
  assert.strictEqual(W.gradeRide([W.scoreHour(H({ wind_mph: 27 }), 7, 18)]).letter, 'F');
  assert.strictEqual(W.gradeRide([W.scoreHour(H({ hour: 5 }), 7, 18)]).letter, 'F');
  assert.strictEqual(W.gradeRide([W.scoreHour(H({ rain_pct: 80, rain_in: 0.12 }), 7, 18)]).letter, 'F');
  const cold = W.gradeRide([W.scoreHour(H({ feels_f: 30 }), 7, 18)]); assert.ok(/^D|^F/.test(cold.letter), cold.letter);
  // a ride leans on its worst hour: two fine hours and one dark one is still an F
  assert.strictEqual(W.gradeRide([W.scoreHour(H({ hour: 16 }), 7, 18), W.scoreHour(H({ hour: 17 }), 7, 18), W.scoreHour(H({ hour: 18 }), 7, 18)]).letter, 'F');
  const g = W.gradeRide([W.scoreHour(H({ wind_mph: 14, feels_f: 50 }), 7, 18)]); assert.ok(g.why.some(w => /wind 14/.test(w)), JSON.stringify(g.why));
});
console.log(n + ' passed');
