// node bridge/ride-math.test.js
const assert = require('assert');
const R = require('./ride-math');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('hrSummary: average, max, minutes above 147, Seiler zones', () => {
  const hr = [].concat(Array(600).fill(110), Array(300).fill(130), Array(240).fill(150), Array(60).fill(0));
  const s = R.hrSummary(hr);
  assert.strictEqual(s.seconds, 1140);
  assert.strictEqual(s.max, 150);
  assert.strictEqual(s.minutes_above_hard, 4);
  assert.deepStrictEqual(s.zones, { z1_min: 10, z2_min: 5, z3_min: 4 });
  assert.strictEqual(s.zone_pct.z1, 53);
  assert.strictEqual(R.hrSummary([]), null);
});

ok('respSummary: breaths per minute with dropouts removed', () => {
  const r = R.respSummary([].concat(Array(50).fill(16), Array(50).fill(30), [0, 0, 200]));
  assert.strictEqual(r.avg, 23);
  assert.strictEqual(r.max, 30);
  assert.strictEqual(r.min, 16);
  assert.strictEqual(R.respSummary([16, 17]), null);
});

ok('vo2Grade: 8 to 12 minutes above 147 is the target', () => {
  assert.strictEqual(R.vo2Grade(9.5).band, 'green');
  assert.strictEqual(R.vo2Grade(6).band, 'yellow');
  assert.strictEqual(R.vo2Grade(14).band, 'yellow');
  assert.strictEqual(R.vo2Grade(2).band, 'red');
  assert.strictEqual(R.vo2Grade(null), null);
});

ok('zone1Grade: the share of the ride under VT1', () => {
  const s = R.hrSummary([].concat(Array(900).fill(110), Array(100).fill(125)));
  assert.strictEqual(R.zone1Grade(s).band, 'green');
});

ok('hrSummaryFromZones: WHOOP zone times mapped onto the Seiler zones', () => {
  const z = { zone_zero_milli: 0, zone_one_milli: 600000, zone_two_milli: 600000, zone_three_milli: 600000, zone_four_milli: 300000, zone_five_milli: 540000 };
  const s = R.hrSummaryFromZones(z, 128, 158, 162);
  assert.strictEqual(s.seconds, 2640);
  assert.strictEqual(s.minutes_above_hard, 9);
  assert.strictEqual(s.hard_bpm, 146);
  assert.ok(s.zones.z1_min > 20 && s.zones.z1_min < 24, 'below VT1 ' + s.zones.z1_min);
  assert.ok(/WHOOP/.test(s.estimated));
  assert.strictEqual(R.hrSummaryFromZones(null), null);
});

console.log(n + ' passed');
