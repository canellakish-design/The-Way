// node bridge/micro-math.test.js
const assert = require('assert');
const M = require('./micro-math');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('findFood: the longest matching phrase wins', () => {
  assert.strictEqual(M.findFood('roast sweet potato').name, 'sweet potato, baked');
  assert.strictEqual(M.findFood('jasmine rice').name, 'white rice, cooked');
  assert.strictEqual(M.findFood('grilled salmon fillet').name, 'salmon, cooked');
  assert.strictEqual(M.findFood('mystery sauce'), null);
});

ok('plateMicros: a rice bowl adds up from the table, unknowns take the model share', () => {
  const r = M.plateMicros([{ name: 'white rice', grams: 200 }, { name: 'salmon', grams: 150 }, { name: 'spinach', grams: 90 }, { name: 'gochujang sauce', grams: 20 }],
    { iron_mg: 4, vitamin_c_mg: 40 });
  assert.ok(r.micros.omega3_mg > 2500, 'omega-3 from salmon ' + r.micros.omega3_mg);
  assert.ok(r.micros.iron_mg > 3.5, 'iron ' + r.micros.iron_mg);
  assert.strictEqual(r.matched_pct, 96);
  assert.deepStrictEqual(r.unknown, ['gochujang sauce']);
});

ok('dayScore: capped per nutrient, averaged, three-day rolling', () => {
  const full = Object.fromEntries(M.KEYS.map(k => [k, M.TABLE.targets[k] * 2]));
  assert.strictEqual(M.dayScore([full]).score, 100);
  const half = Object.fromEntries(M.KEYS.map(k => [k, M.TABLE.targets[k] / 2]));
  assert.strictEqual(M.dayScore([half]).score, 50);
  // two empty days after a full one: 3-day nutrients read 33, 7-day ones read 100 (only three days held)
  const exact = Object.fromEntries(M.KEYS.map(k => [k, M.TABLE.targets[k]]));
  const s5 = M.dayScore([exact, M.zero(), M.zero(), M.zero(), M.zero()]);
  assert.strictEqual(s5.per.find(p => p.key === 'fiber_g').pct, 33);   // 3-day window
  assert.strictEqual(s5.per.find(p => p.key === 'iron_mg').pct, 20);   // 7-day window, five days held
  assert.strictEqual(s5.per.find(p => p.key === 'iron_mg').settled, false);
  assert.strictEqual(M.dayScore([half], { ride_hours: 2 }).per.find(p => p.key === 'sodium_mg').target, 3500);
  const s = M.dayScore([half]);
  assert.strictEqual(s.gaps.length, 3);
  assert.strictEqual(s.band.word, 'low');
});

ok('suggest: foods and supplements that lift the score, iron gated, carbs capped by the day', () => {
  const today = M.zero(); today.iron_mg = 7; today.vitamin_d_ug = 0; today.omega3_mg = 0;
  const s = M.suggest([today], { day: 'rest' });
  assert.ok(s.supplements.some(x => x.key === 'vitamin_d3'), 'vitamin D suggested');
  assert.ok(!s.supplements.some(x => x.key === 'iron'), 'iron not suggested when iron is near target');
  assert.ok(s.foods.every(f => !/rice|pasta|potato/.test(f.name)), 'no starch on a rest day: ' + s.foods.map(f => f.name));
  assert.ok(s.foods.length && s.foods[0].score_after > s.score);
  // everything covered but iron: the iron tablet is the obvious lift, and it is allowed because iron is low
  const ironLow = Object.fromEntries(M.KEYS.map(k => [k, M.TABLE.targets[k]])); ironLow.iron_mg = 1;
  assert.ok(M.suggest([ironLow], { day: 'high' }).supplements.some(x => x.key === 'iron'), 'iron suggested when iron is empty');
});

console.log(n + ' passed');
