// node bridge/routes.test.js
const assert = require('assert');
const R = require('./routes');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

const lib = [
  { id: '101', name: 'Loch Raven Loop', miles: 28.4, gain_ft: 2100 },
  { id: '102', name: 'Annapolis to Davidsonville 30', miles: 30.1, gain_ft: 1500 },
  { id: '103', name: 'Davidsonville short loop', miles: 14, gain_ft: 600 },
  { id: '104', name: 'BWI Trail', miles: 12.5, gain_ft: 300 }
];
ok('the route his words point at: all his words in the name wins; half or more is enough; nothing in common is no match', () => {
  assert.strictEqual(R.match(lib, 'the Loch Raven loop').id, '101');
  assert.strictEqual(R.match(lib, 'my Annapolis 30').id, '102');
  assert.strictEqual(R.match(lib, 'Davidsonville short').id, '103');
  assert.strictEqual(R.match(lib, 'bwi').id, '104');
  assert.strictEqual(R.match(lib, 'Skyline Drive'), null);
  assert.strictEqual(R.match(lib, 'the route'), null);
  assert.strictEqual(R.match([], 'Loch Raven'), null);
});
ok('a GPX file from points: a track with a name, five decimals, the name made safe', () => {
  const g = R.gpx([[38.98, -76.49], [39.001234567, -76.5]], 'Loop <north> & back');
  assert.ok(g.startsWith('<?xml'));
  assert.ok(g.includes('<name>Loop &lt;north&gt; &amp; back</name>'));
  assert.ok(g.includes('<trkpt lat="38.98000" lon="-76.49000"></trkpt><trkpt lat="39.00123" lon="-76.50000"></trkpt>'));
});
ok('the corners of a loop: an equal-sided triangle on the map whose sides add up to the length asked, out along the bearing', () => {
  const start = { lat: 38.98, lon: -76.49 }, km = (a, b) => { const ky = 110.57, kx = 111.32 * Math.cos(38.98 * Math.PI / 180); return Math.hypot((a.lat - b.lat) * ky, (a.lon - b.lon) * kx); };
  const [B, C] = R.corners(start, 30, 0);
  const per = km(start, B) + km(B, C) + km(C, start);
  assert.ok(Math.abs(per - 30) < 0.3, String(per));
  assert.ok(B.lat > start.lat && C.lat > start.lat, 'north of the start');
  assert.ok(B.lon < start.lon && C.lon > start.lon, 'one corner each side of the bearing');
  const [W1, W2] = R.corners(start, 30, 270);
  assert.ok(W1.lon < start.lon && W2.lon < start.lon, 'west of the start');
});
ok('what the coach is told about his library', () => {
  assert.ok(/not connected/.test(R.libraryText({ connected: false })));
  assert.ok(/library is empty/.test(R.libraryText({ connected: true, routes: [] })));
  assert.ok(/HIS ROUTES in Ride with GPS \(4; newest first\): Loch Raven Loop \(28\.4 mi, 2100 ft\); /.test(R.libraryText({ connected: true, routes: lib })));
});
// a square loop about 4 km a side, drawn clockwise from its south-west corner and closed
const sq = []; { const a = [39.00, -77.00], dLat = 4 / 110.57, dLon = 4 / (111.32 * Math.cos(39 * Math.PI / 180));
  for (let k = 0; k <= 20; k++) sq.push([a[0] + dLat * k / 20, a[1]]);                 // north up the west side
  for (let k = 1; k <= 20; k++) sq.push([a[0] + dLat, a[1] + dLon * k / 20]);          // east along the top
  for (let k = 1; k <= 20; k++) sq.push([a[0] + dLat - dLat * k / 20, a[1] + dLon]);   // south down the east side
  for (let k = 1; k <= 20; k++) sq.push([a[0], a[1] + dLon - dLon * k / 20]); }        // west along the bottom, home
ok('the point on a route nearest him lies on the line, between its points', () => {
  const here = [39.0181, -76.95];                       // just east of the east side, about half way up
  const nr = R.nearest(sq, here);
  assert.ok(Math.abs(nr.at[1] - sq[45][1]) < 1e-9, 'on the east side');
  assert.ok(Math.abs(nr.at[0] - 39.0181) < 1e-6, 'level with him, not at a corner of the line: ' + nr.at[0]);
  assert.ok(nr.km > 0.2 && nr.km < 0.6, String(nr.km));
  assert.strictEqual(R.compass(here, nr.at), 'west');
  assert.strictEqual(R.nearest([], here), null);
});
ok('a loop begun at that point: it starts and ends there, goes the same way round, and is as long as before', () => {
  const here = [39.0181, -76.95], nr = R.nearest(sq, here), out = R.restart(sq, nr);
  assert.ok(R.isLoop(sq) && R.isLoop(out));
  assert.deepStrictEqual(out[0], out[out.length - 1]);
  assert.ok(Math.abs(out[0][0] - 39.0181) < 1e-4 && Math.abs(out[0][1] - sq[45][1]) < 1e-4, JSON.stringify(out[0]));
  assert.ok(out[1][0] < out[0][0], 'still heading south down the east side, as the route was drawn');
  assert.ok(Math.abs(R.lengthKm(out) - R.lengthKm(sq)) < 0.02, R.lengthKm(out) + ' vs ' + R.lengthKm(sq));
  // every point of the route is still on it
  for (const p of sq) assert.ok(out.some(q => q[0] === p[0] && q[1] === p[1]), JSON.stringify(p));
  // standing at the route's own start: the route as it was
  const same = R.restart(sq, R.nearest(sq, sq[0]));
  assert.ok(Math.abs(R.lengthKm(same) - R.lengthKm(sq)) < 0.001);
});
ok('a one-way route begun at that point runs from there to its end', () => {
  const line = sq.slice(0, 41), nr = R.nearest(line, [39.02, -77.01]), out = R.restart(line, nr);   // up the west side, along the top
  assert.ok(!R.isLoop(line));
  assert.deepStrictEqual(out[out.length - 1], line[line.length - 1]);
  assert.ok(R.lengthKm(out) < R.lengthKm(line) && R.lengthKm(out) > 4, String(R.lengthKm(out)));
});
ok('the corners box of a route: nothing to cover inside it, the gap outside it', () => {
  const box = [39.0, -77.0, 39.04, -76.95];
  assert.strictEqual(R.boxKm(box, [39.02, -76.97]), 0);
  assert.ok(Math.abs(R.boxKm(box, [39.0, -77.1]) - 8.65) < 0.2, String(R.boxKm(box, [39.0, -77.1])));
  assert.strictEqual(R.boxKm(null, [39, -77]), Infinity);
});
ok('best first: the way to the route counts most, then how far its length is from the time he has', () => {
  const rows = [{ name: 'far, right length', join_km: 9, km: 36 }, { name: 'close, right length', join_km: 1, km: 34 }, { name: 'closest, far too long', join_km: 0.2, km: 110 }];
  assert.deepStrictEqual(R.rank(rows, 36).map(x => x.name), ['close, right length', 'far, right length', 'closest, far too long']);
  assert.deepStrictEqual(R.rank(rows, 0).map(x => x.name), ['closest, far too long', 'close, right length', 'far, right length']);
});
ok('where to go, in a line', () => {
  assert.strictEqual(R.hereText({ name: 'Sugarloaf Loop', miles: 31.2, gain_ft: 1900, minutes: 125, loop: true, place: 'Clopper Rd, Germantown', join_miles: 1.3, direction: 'north' }),
    'Sugarloaf Loop: 31.2 mi, 1900 ft, about 125 min; start on Clopper Rd, Germantown, 1.3 mi north of you');
  assert.ok(/you are on it now/.test(R.hereText({ name: 'A', miles: 10, loop: true, place: 'Main St', join_miles: 0 })));
  assert.ok(/one way from there/.test(R.hereText({ name: 'A', miles: 10, loop: false, place: null, join_miles: 2, direction: 'east' })));
});
console.log(n + ' passed');
