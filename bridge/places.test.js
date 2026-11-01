// node bridge/places.test.js
const assert = require('assert');
const P = require('./places');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('places: distance and the fit of an order against what the plan wants next', () => {
  assert.ok(Math.abs(P.dist(39.29, -76.61, 39.29, -76.60) - 862) < 20, 'dist ' + P.dist(39.29, -76.61, 39.29, -76.60));
  const need = { kcal: 640, carbs_g: 90, protein_g: 45, low_carb: false };
  assert.strictEqual(P.fitOf({ name: 'Sunrise burrito', kcal: 650, carbs_g: 80, protein_g: 30 }, need), 'partly');
  assert.strictEqual(P.fitOf({ name: 'Sunrise burrito', kcal: 640, carbs_g: 85, protein_g: 45 }, need), 'yes');
  assert.strictEqual(P.fitOf({ name: 'Local burrito', kcal: 1200, carbs_g: 70, protein_g: 50 }, need), 'no');
  assert.strictEqual(P.fitOf({ name: 'the usual' }, need), 'yes');
  assert.strictEqual(P.fitOf({ name: 'oats', kcal: 300, carbs_g: 60, protein_g: 10 }, { kcal: 300, carbs_g: 15, protein_g: 30, low_carb: true }), 'no');
});
console.log(n + ' passed');
