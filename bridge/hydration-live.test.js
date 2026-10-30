// node bridge/hydration-live.test.js
const assert = require('assert');
const H = require('./hydration-live');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const kg = 98;

ok('sweat: still air on the trainer doubles the fan; cool roads are light, hot roads heavy', () => {
  const fan = H.sweatRate(110, kg, { temp_c: 22, humidity: 50, air_ms: 1.5 });
  const still = H.sweatRate(110, kg, { temp_c: 22, humidity: 50, air_ms: 0.3 });
  const cool = H.sweatRate(110, kg, { temp_c: 13, humidity: 60, air_ms: 6 });
  const hot = H.sweatRate(110, kg, { temp_c: 29, humidity: 70, air_ms: 6 });
  assert.ok(fan >= 400 && fan <= 700, 'fan ' + fan);
  assert.ok(still > fan * 1.7, 'still ' + still);
  assert.ok(cool < fan && cool >= 250, 'cool ' + cool);
  assert.ok(hot > fan, 'hot ' + hot);
  assert.ok(H.sweatRate(150, kg, { temp_c: 22, humidity: 50, air_ms: 1.5 }) > fan, 'harder is wetter');
});

ok('bands: 1% down is fine, 2% is dry, a gain is over', () => {
  assert.strictEqual(H.band(-500, kg).key, 'green');
  assert.strictEqual(H.band(-1500, kg).key, 'yellow');
  assert.strictEqual(H.band(-2100, kg).key, 'red');
  assert.strictEqual(H.band(400, kg).key, 'blue');
});

ok('model: drinks lift the line, the ride drops it, the session ahead gets a number and a time', () => {
  const m = H.model({ kg, ftp: 175, now_min: 14 * 60,
    entries: [{ time: '07:00', fluid_ml: 350, name: 'coffee', drink_only: true }, { time: '07:30', kcal: 500, carbs_g: 60, name: 'oats' }, { time: '10:30', fluid_ml: 600, name: 'bottle', drink_only: true }],
    sessions: [{ name: 'Zone 1, 90 min', time: '09:00', minutes: 90, tss: 58, sport: 'VirtualRide', done: true }, { name: 'VO2 max: Zwift 40/20s #1', time: '17:00', minutes: 51, tss: 60, sport: 'VirtualRide' }] });
  const at = t => m.series.find(p => p.t === t);
  assert.ok(at('08:00').ml > at('06:30').ml, 'coffee lifts');
  assert.ok(at('10:30').ml < at('09:00').ml - 600, 'the ride drops: ' + at('09:00').ml + ' → ' + at('10:30').ml);
  assert.ok(at('11:30').ml > at('10:30').ml, 'the bottle after the ride lifts');
  assert.ok(at('18:00').projected && at('18:00').ml < at('17:00').ml, 'the session ahead projects a drop');
  assert.strictEqual(m.now.band.key, 'green');
  assert.ok(Math.abs(m.now.pct - 0.77) < 0.05, 'pct of body mass ' + m.now.pct);
  assert.strictEqual(m.sessions.length, 1);
  assert.ok(/\d+ ml by 4:15p/.test(m.sessions[0].advice), m.sessions[0].advice);
  assert.strictEqual(m.sessions[0].sweat_ml_h, 850);
  assert.strictEqual(m.sessions.find(s => /Zone 1/.test(s.name)), undefined);   // done and long past
});

ok('model: a gain over the morning says stop; a sodium drink after a ride is kept better than water', () => {
  const o = { kg, ftp: 175, now_min: 13 * 60, sessions: [{ name: 'Zone 1, 60 min', time: '09:00', minutes: 60, tss: 36, sport: 'VirtualRide', done: true }],
    entries: [{ time: '07:00', fluid_ml: 1000, drink_only: true }, { time: '08:00', fluid_ml: 1000, drink_only: true }, { time: '10:30', fluid_ml: 1000, drink_only: true }, { time: '11:30', fluid_ml: 1000, drink_only: true }] };
  const m = H.model(o);
  assert.strictEqual(m.now.band.key, 'blue'); assert.ok(/Stop drinking/.test(m.advice), m.advice);
  const water = H.model({ kg, ftp: 175, now_min: 12 * 60, sessions: o.sessions, entries: [{ time: '10:30', fluid_ml: 600, name: 'water', drink_only: true }] });
  const salt = H.model({ kg, ftp: 175, now_min: 12 * 60, sessions: o.sessions, entries: [{ time: '10:30', fluid_ml: 600, name: 'Tailwind', drink_only: true }] });
  assert.ok(salt.now.ml > water.now.ml, 'salt keeps more: ' + water.now.ml + ' vs ' + salt.now.ml);
});

ok('calibration: three weigh-ins pull halfway, five count in full, clamped', () => {
  assert.deepStrictEqual(H.calibrate([]), { k: 1, points: 0 });
  const pts = [{ measured_ml: 1200, modelled_ml: 800 }, { measured_ml: 1300, modelled_ml: 850 }, { measured_ml: 1100, modelled_ml: 800 }];
  assert.ok(Math.abs(H.calibrate(pts).k - 1.17) < 0.03, JSON.stringify(H.calibrate(pts)));
  const five = pts.concat([{ measured_ml: 1250, modelled_ml: 800 }, { measured_ml: 1200, modelled_ml: 800 }]);
  assert.ok(Math.abs(H.calibrate(five).k - 1.5) < 0.05, JSON.stringify(H.calibrate(five)));
  assert.strictEqual(H.measured(98.4, 97.3, 600, 90), Math.round((1100 + 600) * 0.95));
  assert.strictEqual(H.measured(null, 97, 0, 60), null);
});

ok('carry-over: a deficit at bedtime is still there in the morning, a surplus is not; the scale has a say', () => {
  assert.deepStrictEqual(H.carryOver(-900, null), { start_ml: -900 - H.NIGHT_ML, from: 'yesterday' });
  assert.strictEqual(H.carryOver(400, null).start_ml, 0);
  assert.strictEqual(H.carryOver(-4000, null).start_ml, -1500);
  assert.strictEqual(H.carryOver(null, null).start_ml, 0);
  const both = H.carryOver(-900, { today_kg: 97.6, baseline_kg: 98.2 });
  assert.strictEqual(both.from, 'both'); assert.ok(both.start_ml < -600 && both.start_ml > -1200, JSON.stringify(both));
  const m = H.model({ kg, ftp: 175, now_min: 7 * 60, entries: [], sessions: [], start_ml: -1150 });
  assert.ok(m.series[0].ml <= -1150 && m.series[0].ml > -1160, 'starts from the carried deficit: ' + m.series[0].ml); assert.strictEqual(m.now.band.key, 'yellow');
  assert.ok(/down/.test(m.advice), m.advice);
});
console.log(n + ' passed');
