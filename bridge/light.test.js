// node bridge/light.test.js — light, not just sunset (pwa/light.js, Harry 9 Nov 2026)
const assert = require('assert');
const Light = require('./light'), W = require('./weather'), G = require('./garmin-extras');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const L = Light.lightDay('2026-11-09', 39.0, '06:42', '16:57');   // Annapolis, 9 Nov
const H = (o) => Object.assign({ hour: 15, feels_f: 62, wind_mph: 6, gust_mph: 10, rain_pct: 0, rain_in: 0 }, o);
const ride = (from, to, woods) => { const hs = []; for (let h = Math.floor(from / 60); h * 60 < to; h++) hs.push(Object.assign(H({ hour: h }), W.scoreHour(H({ hour: h }), 7, 17, { L, woods, from, to }))); return W.gradeRide(hs); };

ok('the bridge and the page read light from the same file', () => assert.strictEqual(Light, require('../pwa/light.js')));
ok('civil twilight in Annapolis in November is about 28 minutes', () => assert.ok(L.twilight_min >= 26 && L.twilight_min <= 30, L.twilight_min));
ok('the four kinds of light on 9 Nov, road and trail', () => {
  const at = (hm, w) => Light.levelAt(Light.hm(hm), L, w);
  assert.deepStrictEqual(['15:00', '16:30', '17:10', '17:40'].map(t => at(t)), ['day', 'low', 'twilight', 'dark']);
  assert.deepStrictEqual(['15:30', '16:00', '16:40', '17:00'].map(t => at(t, true)), ['day', 'low', 'twilight', 'dark']);
});
ok('the 9 Nov mountain bike ride, 3:00 to 4:30 on a clear 62 degree day, is no longer an F', () => {
  const road = ride(900, 990, false), trail = ride(900, 990, true);
  assert.ok(/^A/.test(road.letter), road.letter + ' ' + road.score);
  assert.ok(/^A|^B\+/.test(trail.letter), trail.letter + ' ' + trail.score);
  assert.ok(trail.score < road.score, 'the woods dim sooner');
});
ok('only the minutes ridden count: finishing at 4:30 is not marked down for the dark at 5', () => {
  assert.ok(ride(900, 990, false).score > ride(900, 1050, false).score);
});
ok('a road ride into the dark is marked down hard, a trail ride after sunset is an F', () => {
  const late = ride(960, 1080, false); assert.ok(/^C|^D|^F/.test(late.letter), late.letter + ' ' + late.score);
  const trail = ride(990, 1080, true); assert.strictEqual(trail.letter, 'F', trail.score);
  assert.ok(trail.why.some(w => /dark under the trees/.test(w)), JSON.stringify(trail.why));
});
ok('the whole-hour strip: the 4 p.m. hour is amber for low sun and a few minutes of dusk, not red', () => {
  const g = W.gradeHour(H({ hour: 16 }), 7, 16, L); assert.strictEqual(g.grade, 'ok', JSON.stringify(g));
  assert.strictEqual(W.gradeHour(H({ hour: 17 }), 7, 16, L).grade, 'bad');
  assert.strictEqual(W.gradeHour(H({ hour: 12 }), 7, 16, L).grade, 'good');
});
ok('the plain words and the Edge times', () => {
  const s = Light.summary(L, true); assert.strictEqual(s.good_until, '3:57p'); assert.strictEqual(s.lights_from, '4:27p'); assert.strictEqual(s.dark_at, '4:57p');
  assert.strictEqual(Light.summary(L, false).dark_at, Light.clock(L.dusk));
  const sunset = Date.UTC(2026, 10, 9, 21, 57) / 1000, e = G.lightFor(sunset, '2026-11-09', 38.978, true);
  assert.strictEqual(e.dark_at, sunset); assert.strictEqual(e.lights_from, sunset - 1800); assert.strictEqual(e.good_until, sunset - 3600);
  assert.ok(G.lightFor(sunset, '2026-11-09', 38.978, false).dark_at > sunset);
});
ok('a mountain bike is told by its name', () => { assert.ok(Light.isWoods('Mountain bike, 90 min', 'Ride')); assert.ok(Light.isWoods('MTB 75', 'Ride')); assert.ok(!Light.isWoods('Z1 road 120 min', 'Ride')); });
console.log(n + ' passed');
