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
  assert.strictEqual(E.sessionRate({ name: 'Lifting', sport: 'WeightTraining', minutes: 60 }, 175), 6);   // 25 g/h, the quick store's 24%
});

ok('model: a logged breakfast lifts the curve, the ride drains it, the plan projects ahead', () => {
  const base = { ftp: 175, now_min: 8 * 60 + 30,
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
  assert.ok(/Low on purpose/.test(empty.advice), empty.advice);          // Zone 1 asks for no carbs
  const hard = E.model(Object.assign({}, base, { entries: [], meals: [], sessions: [{ name: 'VO2 max: Zwift 40/20s #1', time: '09:00', minutes: 51, tss: 60 }] }));
  assert.ok(/g of carbs by 8:30a/.test(hard.advice), hard.advice);         // the hard session does
});

ok('model: on the bike carbs land during the ride and hold the pool up', () => {
  const o = { base_burn_kcal: 2400, ftp: 175, now_min: 23 * 60, sessions: [{ name: 'Zone 1, 90 min', time: '09:00', minutes: 90, tss: 58 }],
    entries: [{ time: '07:30', carbs_g: 40, protein_g: 45, fat_g: 10, meal: 'breakfast' }], meals: [] };
  const dry = E.model(o);
  const fed = E.model(Object.assign({}, o, { entries: o.entries.concat([{ time: '09:00', carbs_g: 45, meal: 'on the bike', name: 'Tailwind' }]) }));
  const g = (m, t) => m.series.find(p => p.t === t).g;
  assert.ok(g(fed, '10:30') > g(dry, '10:30'), 'bottle helps ' + g(dry, '10:30') + ' → ' + g(fed, '10:30'));
});

ok('v2: two stores. A long ride empties the legs, not the quick store; tomorrow starts from tonight', () => {
  const day = E.model({ ftp: 175, now_min: 23 * 60, meals: [], entries: [{ time: '07:00', carbs_g: 80, protein_g: 20, fat_g: 10, name: 'oats' }],
    sessions: [{ name: 'Zone 1, 180 min', time: '09:00', minutes: 180, tss: 110, done: true }] });
  const at = t => day.series.find(p => p.t === t);
  assert.ok(at('12:00').legs_g < at('09:00').legs_g - 80, 'legs drained ' + at('09:00').legs_g + ' → ' + at('12:00').legs_g);
  assert.ok(at('12:00').g > 50, 'the quick store held up on a quarter share: ' + at('12:00').g);
  const carry = E.carryOver(day);
  assert.strictEqual(carry.legs_start_g, day.legs_end_g);
  assert.ok(carry.quick_start_g >= 35 && carry.quick_start_g <= Math.max(35, day.quick_end_g), JSON.stringify(carry));
  const tomorrow = E.model(Object.assign({ ftp: 175, now_min: 7 * 60, entries: [], meals: [], sessions: [{ name: 'VO2 max: Zwift 40/20s #1', time: '17:00', minutes: 51, tss: 60 }] }, carry));
  assert.ok(tomorrow.now.legs_pct < 60 && /Legs are low/.test(tomorrow.advice), tomorrow.advice);
});

ok('v2: protein is a small slow rise, not a spike; a bottle on the bike is capped at the gut', () => {
  const pk = E.proteinKernel(40); const sum = pk.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 6) < 0.01, 'about 6 g from 40 g protein: ' + sum);
  assert.ok(pk.indexOf(Math.max(...pk)) * 5 > 90, 'peaks after an hour and a half');
  assert.ok(Math.abs(E.halfTime(10, 0) - E.halfTime(0, 24)) < 2, 'fat and protein slow the stomach alike per calorie');
  assert.ok(E.halfTime(0, 0, true) < E.halfTime(0, 0) && E.halfTime(60, 60) === 110, 'drinks fast, a feast capped');
  const o = { ftp: 175, now_min: 23 * 60, meals: [], sessions: [{ name: 'Zone 1, 120 min', time: '09:00', minutes: 120, tss: 80, done: true }],
    entries: [{ time: '07:00', carbs_g: 60, name: 'oats' }] };
  const big = E.model(Object.assign({}, o, { entries: o.entries.concat([{ time: '09:00', carbs_g: 200, meal: 'on the bike', name: 'Tailwind' }]) }));
  const ok90 = E.model(Object.assign({}, o, { entries: o.entries.concat([{ time: '09:00', carbs_g: 90, meal: 'on the bike', name: 'Tailwind' }]) }));
  const g = (m, t) => m.series.find(p => p.t === t).g;
  assert.ok(g(big, '10:00') - g(ok90, '10:00') < 8, 'the second hundred grams did not land: ' + g(ok90, '10:00') + ' vs ' + g(big, '10:00'));
});

ok('v2: the legs tap tunes nothing until thirty rides, then nudges the share', () => {
  assert.strictEqual(E.calibrate([]).tuned, false);
  const optimistic = Array.from({ length: 30 }, () => ({ legs: 2, pct: 70 }));   // the model said fuelled, he felt flat
  const c = E.calibrate(optimistic);
  assert.ok(c.tuned && c.quick_share > E.QUICK_SHARE, JSON.stringify(c));
  const fine = Array.from({ length: 30 }, () => ({ legs: 4, pct: 72 }));
  assert.ok(Math.abs(E.calibrate(fine).quick_share - E.QUICK_SHARE) < 0.02, JSON.stringify(E.calibrate(fine)));
});
console.log(n + ' passed');
