// node bridge/energy-meter.test.js
// The energy meter beside CTL: food-math.balanceSeries (one source, the day report's balance), the dial's
// angle and clamp, BMR from age and height as settings (body.js), and Kettlebell Blasts at 6 kcal a minute.
const assert = require('assert');
const path = require('path');
const mem = new Map();
const sp = path.join(__dirname, 'storage.js');
require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: {
  getJSON: async (k, fb) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : fb),
  setJSON: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); }, withScope: fn => fn(), ON_NETLIFY: false, SANDBOX: false } };
const F = require('./food-math');
const B = require('./body');

const tests = [];
const ok = (name, fn) => tests.push([name, fn]);

ok('BMR and base burn: 98.4 kg, 178 cm, 48 is BMR 1,862 and 2,514 with everyday movement (BMR × 1.35)', () => {
  const p = { kg: 98.4, cm: 178, age: 48, activity: 1.35 };
  assert.strictEqual(F.bmr(p), 1862); assert.strictEqual(F.baseBurn(p), 2514);
  assert.strictEqual(F.PROFILE.age, 48, 'the fallback age is his age, not the 2033 goal');
  const t = F.targets('normal', 0, { kg: 98.4, cm: 178, age: 48 });
  assert.strictEqual(t.bmr, 1862); assert.strictEqual(t.base_burn, 2514); assert.strictEqual(t.age, 48); assert.strictEqual(t.cm, 178);
});

ok('an age change moves BMR by 5 kcal a year, and base burn by 5 × 1.35', () => {
  const at = age => ({ kg: 98.4, cm: 178, age, activity: 1.35 });
  assert.strictEqual(F.bmr(at(48)) - F.bmr(at(49)), 5);
  assert.strictEqual(F.bmr(at(48)) - F.bmr(at(55)), 35);
  const d = F.baseBurn(at(48)) - F.baseBurn(at(58));
  assert.ok(Math.abs(d - 67.5) <= 1, 'ten years ' + d);
  // the target follows the age passed in
  assert.ok(F.targets('normal', 0, { kg: 98.4, age: 48 }).base_burn > F.targets('normal', 0, { kg: 98.4, age: 55 }).base_burn);
});

ok('the needle at noon: breakfast 600 against half a day of 2,400 burned is −600, 54° left of noon', () => {
  const b = F.balanceSeries({ baseBurn: 2400, bmr: 1778, nowMin: 720, eaten: [{ min: 480, kcal: 600, label: 'breakfast' }], sessions: [] });
  assert.strictEqual(b.now, -600);
  assert.strictEqual(F.meterAngle(b.now), -54);
  // the parts: BMR and everyday movement accrue by the minute, and add to the base
  assert.strictEqual(b.parts.bmr, 889); assert.strictEqual(b.parts.daily, 311); assert.strictEqual(b.parts.base, 1200);
  assert.strictEqual(b.parts.bmr_day, 1778); assert.strictEqual(b.parts.daily_day, 622);
  assert.strictEqual(b.parts.eaten, 600); assert.strictEqual(b.parts.exercise, 0); assert.strictEqual(b.parts.net, -600);
  assert.strictEqual(F.meterAngle(0), 0, 'noon is eaten = burned');
  assert.ok(F.meterAngle(300) > 0, 'right of noon is a surplus');
});

ok('the clamp: past ±1,000 the needle stops at 9 or 3 o\'clock; the true number is kept', () => {
  assert.strictEqual(F.meterAngle(-1000), -90); assert.strictEqual(F.meterAngle(-1600), -90);
  assert.strictEqual(F.meterAngle(1000), 90); assert.strictEqual(F.meterAngle(2500), 90);
  assert.strictEqual(F.meterAngle(-500), -45);
  assert.strictEqual(F.meterAngle(null), null);
});

ok('no food logged: the needle sits left of noon by the base burn times the fraction of the day gone', () => {
  for (const nowMin of [360, 600, 900]) {
    const b = F.balanceSeries({ baseBurn: 2514, bmr: 1862, nowMin, eaten: [], sessions: [] });
    assert.strictEqual(b.now, Math.round(-2514 * nowMin / 1440));
    assert.ok(F.meterAngle(b.now) < 0);
  }
});

ok('exercise counts toward now only once done; a planned session burns in the projection from now', () => {
  const ride = { name: 'Zone 1, 60 min', start: 540, end: 600, kcal: 500 };
  const planned = F.balanceSeries({ baseBurn: 2400, nowMin: 720, eaten: [], sessions: [Object.assign({ done: false }, ride)] });
  const done = F.balanceSeries({ baseBurn: 2400, nowMin: 720, eaten: [], sessions: [Object.assign({ done: true }, ride)] });
  assert.strictEqual(planned.parts.exercise, 0); assert.strictEqual(planned.now, -1200);
  assert.strictEqual(done.parts.exercise, 500); assert.strictEqual(done.now, -1700);
  // the ghost needle (midnight) carries the planned ride either way
  assert.strictEqual(planned.end, -2400 - 500); assert.strictEqual(done.end, -2400 - 500);
  // a past day: only what was done
  const past = F.balanceSeries({ baseBurn: 2400, nowMin: 1440, eaten: [{ min: 600, kcal: 1900 }], sessions: [Object.assign({ done: false }, ride)] });
  assert.strictEqual(past.end, 1900 - 2400);
});

ok('a week at −500 a day is about −1 lb a week (× 7 ÷ 3,500)', () => {
  assert.strictEqual(F.lbPerWeek(-500), -1); assert.strictEqual(F.lbPerWeek(-400), -0.8); assert.strictEqual(F.lbPerWeek(null), null);
});

ok('Kettlebell Blasts: about 6 kcal a minute, 180 for the half hour, whatever the TSS says', () => {
  assert.strictEqual(F.workoutKcal([{ name: 'Kettlebell Blast A · home', sport: 'WeightTraining', minutes: 30, tss: 40 }], 175), 180);
  assert.strictEqual(F.workoutKcal([{ name: 'Kettlebell Blast B · home', sport: 'WeightTraining', minutes: 30, kcal: 420 }], 175), 180);
  assert.strictEqual(F.isBlast({ name: 'Push' }), false);
});

ok('body settings: age 48 and 178 cm by default, a weigh-in sets kg with its date, out of range is a 400', async () => {
  mem.clear();
  const p0 = await B.profile();
  assert.strictEqual(p0.age, 48); assert.strictEqual(p0.cm, 178); assert.strictEqual(p0.kg_fallback, true);
  mem.set('weigh-in', { entries: [{ ts: Date.parse('2026-11-08T12:00:00Z'), lb: 216.9 }] });
  const p1 = await B.profile();
  assert.strictEqual(p1.kg, 98.4); assert.strictEqual(p1.kg_from, '2026-11-08'); assert.strictEqual(p1.bmr, 1862); assert.strictEqual(p1.base_burn, 2514);
  const p2 = await B.set({ age: 49 });
  assert.strictEqual(p2.age, 49); assert.strictEqual(p2.bmr, 1857); assert.strictEqual(p2.cm, 178);
  await assert.rejects(() => B.set({ age: 200 }), e => e.status === 400);
  await assert.rejects(() => B.set({ cm: 50 }), e => e.status === 400);
  assert.strictEqual((await B.stored()).age, 49, 'a rejected value leaves the setting as it was');
});

(async () => {
  let n = 0;
  for (const [name, fn] of tests) { await fn(); n++; console.log('ok ' + name); }
  console.log(`\n${n} passed`);
})().catch(e => { console.error(e); process.exit(1); });
