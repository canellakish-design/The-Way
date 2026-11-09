// node bridge/nights.test.js
// The 3 a.m. tracker (nights.js): the evening read into factors, and with/without each factor.
const assert = require('assert');
const N = require('./nights');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const BED = 22 * 60 + 30;

ok('the evening: drinks from 6 p.m., the last food, fluid after 8 p.m., the last session end, BP at night, magnesium', () => {
  const f = N.eveningFactors({ bed: BED,
    entries: [
      { time: '12:30', kcal: 600, fluid_ml: 300 },
      { time: '17:30', kcal: 150, alcohol: 1 },                 // before 6 p.m.: not the evening's
      { time: '19:00', kcal: 800 }, { time: '20:30', kcal: 220, alcohol: 2, fluid_ml: 0 },
      { time: '21:00', kcal: 250, fluid_ml: 350 }, { time: '21:40', kcal: 0, fluid_ml: 250 },
      { time: '21:30', supplement: true, key: 'magnesium', kcal: 0 }],
    meds: { bp: '2026-11-09T03:00:00Z' },                       // 10:00 p.m. Eastern
    sessions: [{ end: 16 * 60 }, { end: 20 * 60 + 15 }] });
  assert.strictEqual(f.alcohol, 2); assert.strictEqual(f.fluid_after8_ml, 600);
  assert.strictEqual(f.last_food_min, 21 * 60); assert.strictEqual(f.last_session_end_min, 20 * 60 + 15);
  assert.strictEqual(f.bp_night, true); assert.strictEqual(f.magnesium, true);
  const T = Object.fromEntries(N.FACTORS.map(F => [F.key, F.test(f)]));
  assert.deepStrictEqual(T, { alcohol: true, late_meal: true, late_fluid: true, late_workout: true, bp_night: true, magnesium: true });
  const quiet = N.eveningFactors({ bed: BED, entries: [{ time: '18:30', kcal: 700 }], meds: {}, sessions: [] });
  assert.deepStrictEqual(Object.fromEntries(N.FACTORS.map(F => [F.key, F.test(quiet)])), { alcohol: false, late_meal: false, late_fluid: false, late_workout: false, bp_night: false, magnesium: false });
});

ok('with and without: two nights on each side at least; the biggest gap first', () => {
  const night = (woke, alcohol, fluid) => ({ woke, factors: { alcohol, fluid_after8_ml: fluid, last_food_min: 18 * 60, last_session_end_min: null, bp_night: true, magnesium: true, bed_min: BED } });
  const nights = [night(true, 2, 600), night(true, 1, 100), night(true, 3, 700), night(false, 0, 100), night(false, 0, 650), night(true, 0, 100)];
  const a = N.analyse(nights);
  assert.strictEqual(a[0].key, 'alcohol');
  assert.deepStrictEqual(a[0].with, { nights: 3, woke_pct: 100 }); assert.deepStrictEqual(a[0].without, { nights: 3, woke_pct: 33 });
  assert.ok(!a.some(x => x.key === 'bp_night'), 'every night had it: nothing to compare');
  assert.deepStrictEqual(N.analyse(nights.slice(0, 3)), [], 'too few nights');
});
console.log(`\n${n} passed`);
