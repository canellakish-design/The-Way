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
console.log(n + ' passed');
