// node bridge/courses.test.js
const assert = require('assert');
const C = require('./courses');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

// a loop: north 5 km, then back south 5 km on a parallel road
const loop = [];
for (let i = 0; i <= 50; i++) loop.push({ lat: 39.0 + i * 0.0009, lng: -76.6, ele: 50 + i });
for (let i = 50; i >= 0; i--) loop.push({ lat: 39.0 + i * 0.0009, lng: -76.605, ele: 50 + i });
loop.push({ lat: 39.0, lng: -76.6, ele: 50 });

ok('halves: the first half heads north, the second south; a route that returns to its start is a loop', () => {
  const h = C.halves(loop);
  assert.ok(h.bearing_out < 20 || h.bearing_out > 340, 'out ' + h.bearing_out);
  assert.ok(h.bearing_back > 160 && h.bearing_back < 200, 'back ' + h.bearing_back);
  assert.ok(h.km > 9 && h.km < 11, 'km ' + h.km);
  assert.ok(['loop', 'out and back'].includes(h.shape));
});

ok('score: a north wind makes it headwind out and tailwind home, which ranks first', () => {
  const hours = []; for (let hh = 0; hh < 24; hh++) hours.push({ hour: hh, wind_deg: 0, wind_mph: 12, gust_mph: 18, temp_f: 60, feels_f: 58, rain_pct: 0, grade: 'good' });
  const h = C.halves(loop);
  const s = C.score(Object.assign({ id: 'a', name: 'north loop', virtual: false }, h), hours, 9 * 60, 30, 20);
  assert.strictEqual(s.out, 'headwind'); assert.strictEqual(s.back, 'tailwind');
  assert.ok(/back coming home/.test(s.why), s.why);
  // a loop that heads south first and comes home northward: tailwind out, headwind home, scores lower
  const south = []; for (let i = 0; i <= 50; i++) south.push({ lat: 39.1 - i * 0.0009, lng: -76.6, ele: 50 }); for (let i = 50; i >= 0; i--) south.push({ lat: 39.1 - i * 0.0009, lng: -76.605, ele: 50 }); south.push({ lat: 39.1, lng: -76.6, ele: 50 });
  const rev = C.halves(south);
  const s2 = C.score(Object.assign({ id: 'b', name: 'south first', virtual: false }, rev), hours, 9 * 60, 30, 20);
  assert.strictEqual(s2.back, 'headwind');
  assert.ok(s.score > s2.score, `${s.score} vs ${s2.score}`);
});

ok('windOver: the mean of the hours in the window, as a direction it comes from', () => {
  const hours = [{ hour: 9, wind_deg: 350, wind_mph: 10, gust_mph: 15 }, { hour: 10, wind_deg: 10, wind_mph: 10, gust_mph: 20 }];
  const w = C.windOver(hours, 9 * 60, 11 * 60);
  assert.ok(w.deg < 5 || w.deg > 355, 'deg ' + w.deg); assert.strictEqual(w.mph, 10); assert.strictEqual(w.from, 'N'); assert.strictEqual(w.gust_mph, 20);
});
console.log(n + ' passed');
