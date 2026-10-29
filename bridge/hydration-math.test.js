// node bridge/hydration-math.test.js
const assert = require('assert');
const H = require('./hydration-math');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('target: 30 ml/kg of drinks, never under 2 L, 600 ml an hour on the bike', () => {
  assert.deepStrictEqual(H.target(104, 0), { base: 3100, ride: 0, total: 3100 });
  assert.strictEqual(H.target(50, 0).base, 2000);
  assert.strictEqual(H.target(null, 1.5).ride, 900);
  assert.strictEqual(H.target(null, 0).base, 3100);   // the profile's 104 kg
});

ok('paced through the day: breakfast is not judged against the whole target', () => {
  const glass = [{ id: 'a', time: '07:10', fluid_ml: 350, name: 'coffee' }];
  const morning = H.score(glass, { kg: 104, now_min: 8 * 60 });   // 2 h in: 3100 × 2/16 ≈ 400 due
  assert.strictEqual(morning.due_ml, 400);
  assert.strictEqual(morning.score, 88);
  assert.strictEqual(morning.band.key, 'green');
  const noon = H.score(glass, { kg: 104, now_min: 12 * 60 });    // 6 h in: 1150 due
  assert.strictEqual(noon.score, 30);
  assert.strictEqual(noon.band.key, 'red');
  assert.ok(/behind/.test(noon.note) && /Drink 500 ml/.test(noon.note));
});

ok('a finished ride adds its sweat to what is due', () => {
  const e = [{ id: 'a', time: '07:10', fluid_ml: 1000 }, { id: 'b', time: '12:00', fluid_ml: 500, name: 'bottle' }];
  const s = H.score(e, { kg: 104, ride_hours: 1.5, now_min: 13 * 60 });
  assert.strictEqual(s.target.ride, 900);
  assert.strictEqual(s.due_ml, 1350 + 900);
  assert.strictEqual(s.score, 67);
  assert.strictEqual(s.band.key, 'yellow');
  assert.strictEqual(s.drinks.length, 2);
  assert.strictEqual(s.drinks[1].name, 'bottle');
});

ok('nothing logged is no score; meals without a drink score zero; a past day is judged whole', () => {
  assert.strictEqual(H.score([], { kg: 104, now_min: 10 * 60 }).score, null);
  assert.strictEqual(H.score([{ id: 'x', supplement: true }], { kg: 104, now_min: 10 * 60 }).score, null);
  const dry = H.score([{ id: 'm', fluid_ml: 0, kcal: 600 }], { kg: 104, now_min: 10 * 60 });
  assert.strictEqual(dry.score, 0); assert.strictEqual(dry.band.key, 'red');
  const whole = H.score([{ id: 'm', fluid_ml: 3100 }], { kg: 104, now_min: null });
  assert.strictEqual(whole.score, 100); assert.strictEqual(whole.left_ml, 0);
  assert.ok(/Done for the day/.test(whole.note));
});

console.log(n + ' passed');
