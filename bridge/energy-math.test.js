// node bridge/energy-math.test.js
const assert = require('assert');
const E = require('./energy-math');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('kernel: sums to the carbs, peaks later with fat, fast for a bottle', () => {
  const k = E.kernel(60, 0, 0); const s = k.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(s - 60) < 0.01);
  const peak = k.indexOf(Math.max(...k)) * 5;
  const kf = E.kernel(60, 40, 30); const peakF = kf.indexOf(Math.max(...kf)) * 5;
  const kb = E.kernel(30, 0, 0, true); const peakB = kb.indexOf(Math.max(...kb)) * 5;
  assert.ok(peakB < peak && peak < peakF, `bottle ${peakB} < plain ${peak} < fatty ${peakF}`);
});

ok('burn: a Zone 1 hour costs far less carbohydrate than a VO2 hour', () => {
  const z1 = E.rideCarbsPerHour(0.6, 175), vo2 = E.rideCarbsPerHour(0.9, 175);
  assert.ok(z1 > 30 && z1 < 60, 'z1 ' + z1);
  assert.ok(vo2 > 90 && vo2 < 140, 'vo2 ' + vo2);
  assert.strictEqual(E.sessionRate({ name: 'Lifting', sport: 'WeightTraining', minutes: 60 }, 175), 10);
});

ok('model: a logged breakfast lifts the curve, the ride drains it, the plan projects ahead', () => {
  const base = { base_burn_kcal: 2400, ftp: 175, now_min: 8 * 60 + 30,
    entries: [{ time: '07:00', carbs_g: 60, protein_g: 40, fat_g: 15, meal: 'breakfast', name: 'oats' }],
    sessions: [{ name: 'Zone 1, 90 min', time: '09:00', minutes: 90, tss: 58 }],
    meals: [{ time: '07:30', slot: 'breakfast', carbs_g: 40, logged: ['x'] }, { time: '13:00', slot: 'lunch', carbs_g: 90, logged: [] }] };
  const m = E.model(base);
  const at = t => m.series.find(p => p.t === t);
  assert.ok(at('08:30').g > at('07:00').g, 'breakfast lifts: ' + at('07:00').g + ' → ' + at('08:30').g);
  assert.ok(at('10:30').g < at('09:00').g, 'the ride drains: ' + at('09:00').g + ' → ' + at('10:30').g);
  assert.ok(at('14:30').g > at('13:00').g && at('14:30').projected, 'lunch projects ahead');
  assert.strictEqual(m.sessions.length, 1); assert.strictEqual(m.sessions[0].time, '09:00');
  assert.ok(m.now.pct > 0 && m.peak, JSON.stringify(m.now) + ' ' + JSON.stringify(m.peak));
  // nothing eaten: the ride starts low and the advice says what to eat
  const empty = E.model(Object.assign({}, base, { entries: [], meals: [] }));
  assert.strictEqual(empty.sessions[0].band.key === 'green', false);
  assert.ok(/g of carbs by 8:30a/.test(empty.advice), empty.advice);
});

ok('model: on the bike carbs land during the ride and hold the pool up', () => {
  const o = { base_burn_kcal: 2400, ftp: 175, now_min: 23 * 60, sessions: [{ name: 'Zone 1, 90 min', time: '09:00', minutes: 90, tss: 58 }],
    entries: [{ time: '07:30', carbs_g: 40, protein_g: 45, fat_g: 10, meal: 'breakfast' }], meals: [] };
  const dry = E.model(o);
  const fed = E.model(Object.assign({}, o, { entries: o.entries.concat([{ time: '09:00', carbs_g: 45, meal: 'on the bike', name: 'Tailwind' }]) }));
  const g = (m, t) => m.series.find(p => p.t === t).g;
  assert.ok(g(fed, '10:30') > g(dry, '10:30'), 'bottle helps ' + g(dry, '10:30') + ' → ' + g(fed, '10:30'));
});
console.log(n + ' passed');
