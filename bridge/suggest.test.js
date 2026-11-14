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
  assert.ok(/not enough light/.test(S.fit({ ride: { minutes: 120 }, trip, place, route, sunset_min: m(15, 50), hours: hrs(58, 85) }).no), 'under an hour of light left: none');
});
ok('the pick: the dirt when the planned ride is a mountain-bike one, else the best-scored route', () => {
  const routes = [{ type: 'road', name: 'Sugarloaf Mountain', score: 16 }, { type: 'mtb', name: 'Schaeffer Farm', score: 11 }];
  assert.strictEqual(S.pick(routes, { name: 'Z1 trainer 90 min' }).name, 'Sugarloaf Mountain');
  assert.strictEqual(S.pick(routes, { name: 'Mountain bike handling, 75 min' }).name, 'Schaeffer Farm');
  assert.strictEqual(S.pick([], {}), null);
});
ok('fitted to the workout: a hard day gets a 1 to 3 km climb, Zone 1 a path or flat road, a handling ride trails; no dirt after rain', () => {
  const routes = [
    { type: 'road', name: 'Sugarloaf climb', km: 2.4, grade: 6, climb: 1, score: 16 },
    { type: 'road', name: 'Comus Road', km: 6, grade: 0.8, climb: 0, score: 13 },
    { type: 'path', name: 'C&O Canal Towpath', score: 10 },
    { type: 'mtb', name: 'Schaeffer Farm', score: 11 }];
  assert.strictEqual(S.pick(routes, { name: 'VO2 4 × 4 min' }).name, 'Sugarloaf climb');
  assert.ok(/one climb a rep/.test(S.pick(routes, { name: 'VO2 4 × 4 min' }).fit_note));
  assert.strictEqual(S.pick(routes, { name: 'Z1 trainer 90 min' }).name, 'Comus Road', 'the most ridden flat thing');
  assert.strictEqual(S.pick(routes.filter(r => r.name !== 'Comus Road'), { name: 'Z1 trainer 90 min' }).name, 'C&O Canal Towpath');
  const flat = S.pick(routes.filter(r => r.name !== 'Sugarloaf climb'), { name: 'VO2 4 × 4 min' });
  assert.strictEqual(flat.name, 'Comus Road'); assert.ok(/steady stretch/.test(flat.fit_note), 'a hard day with no climb near: a steady road');
  assert.strictEqual(S.pick(routes, { name: 'Mountain bike handling, 75 min' }).name, 'Schaeffer Farm');
  assert.strictEqual(S.pick(routes, { name: 'Mountain bike handling, 75 min' }, { wet: true }).type !== 'mtb', true, 'wet: no trails');
  assert.strictEqual(S.rideKind({ name: '40/20s' }), 'hard'); assert.strictEqual(S.rideKind({ name: 'Z1 road 120 min' }), 'easy');
});
ok('the trail search, read: a path is a path, a shop is nothing, a park with trails is dirt', () => {
  assert.strictEqual(S.trailKind('East Coast Greenway', []), 'path');
  assert.strictEqual(S.trailKind('Bike Doctor Cycles', []), null);
  assert.strictEqual(S.trailKind('Schaeffer Farm Trail Area', []), 'mtb');
  assert.strictEqual(S.trailKind('Rockburn Branch Park', ['park']), 'mtb');
  assert.strictEqual(S.trailKind('Main Street', []), null);
});
ok('the loop: the turn point makes a triangle of the planned length; the light shortens a ride rather than drop it', () => {
  const a = { lat: 39.25, lon: -77.40 }, b = { lat: 39.27, lon: -77.39 };
  const c = S.turnPoint(a, b, 30);
  const R = 6371, t = x => x * Math.PI / 180, km = (p, q) => 2 * R * Math.asin(Math.sqrt(Math.sin(t(q.lat - p.lat) / 2) ** 2 + Math.cos(t(p.lat)) * Math.cos(t(q.lat)) * Math.sin(t(q.lon - p.lon) / 2) ** 2));
  const per = km(a, b) + km(b, c) + km(c, a);
  assert.ok(Math.abs(per - 30) < 1, per);
  const f = S.fit({ ride: { minutes: 90 }, trip: { label: 'McDonogh', back: m(14, 30) }, place: a, route: a, sunset_min: m(16, 0), hours: hrs(56, 85) });
  assert.ok(!f.no && f.end - f.start === 65 && f.shortened === 25 && /65 min, not 90, for the light/.test(f.why), JSON.stringify(f));
  assert.ok(/<trkpt lat="39.25" lon="-77.4">/.test(S.gpxOf({ route: { name: 'x' }, loop: { points: [[39.25, -77.4]] } })));
});
console.log(n + ' passed');

