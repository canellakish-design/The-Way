// node bridge/suggest.test.js
const assert = require('assert');
const S = require('./suggest');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const m = (h, mi) => h * 60 + (mi || 0);
const hrs = (t, cs) => [14, 15, 16].map(h => ({ hour: h, temp_f: t, feels_f: t - 3, rain_pct: 5, cscore: cs }));
ok('the fit: after the trip, the drive to the start and the changeover; home before dark; a nice day only', () => {
  const trip = { label: 'McDonogh', back: m(14, 30) };
  const place = { lat: 39.39, lon: -76.77 }, route = { lat: 39.40, lon: -76.80 };
  const f = S.fit({ ride: { minutes: 90 }, trip, place, route, sunset_min: m(16, 55), hours: hrs(56, 85) });
  assert.ok(!f.no, f.no); assert.ok(f.start >= m(14, 45) && f.start <= m(15, 0), f.start); assert.strictEqual(f.end - f.start, 90);
  assert.ok(/^after McDonogh, 56°F, weather [AB]/.test(f.why), f.why);
  assert.ok(/under 50/.test(S.fit({ ride: { minutes: 90 }, trip, place, route, sunset_min: m(16, 55), hours: hrs(46, 85) }).no));
  assert.ok(/under a B/.test(S.fit({ ride: { minutes: 90 }, trip, place, route, sunset_min: m(16, 55), hours: hrs(58, 60) }).no));
  assert.ok(/rain/.test(S.fit({ ride: { minutes: 90 }, trip, place, route, sunset_min: m(16, 55), hours: hrs(58, 85).map(h => Object.assign(h, { rain_pct: 60 })) }).no));
  assert.ok(/not enough light/.test(S.fit({ ride: { minutes: 120 }, trip, place, route, sunset_min: m(16, 30), hours: hrs(58, 85) }).no));
});
ok('the pick: the dirt when the planned ride is a mountain-bike one, else the best-scored route', () => {
  const routes = [{ type: 'road', name: 'Sugarloaf Mountain', score: 16 }, { type: 'mtb', name: 'Schaeffer Farm', score: 11 }];
  assert.strictEqual(S.pick(routes, { name: 'Z1 trainer 90 min' }).name, 'Sugarloaf Mountain');
  assert.strictEqual(S.pick(routes, { name: 'Mountain bike handling, 75 min' }).name, 'Schaeffer Farm');
  assert.strictEqual(S.pick([], {}), null);
});
console.log(n + ' passed');
