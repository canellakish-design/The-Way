// node bridge/food-math.test.js
const assert = require('assert');
const F = require('./food-math');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('fuelDay: VO2 or 90 min or 80 TSS is a higher carb day; a short ride is normal; nothing is rest', () => {
  assert.strictEqual(F.fuelDay([{ name: 'VO2 max: Zwift 40/20s #1', minutes: 50, tss: 55 }]), 'high');
  assert.strictEqual(F.fuelDay([{ name: 'Zone 1, 120 min', minutes: 120 }]), 'high');
  assert.strictEqual(F.fuelDay([{ name: 'Zone 1, 45 min', minutes: 45, tss: 25 }]), 'normal');
  assert.strictEqual(F.fuelDay([{ name: 'Mountain bike handling, 60 min', minutes: 60 }]), 'normal');
  assert.strictEqual(F.fuelDay([]), 'rest');
});

ok('targets: energy bank minus the deficit, protein fixed, carbs take what is left', () => {
  const t = F.targets('high', 600);
  assert.strictEqual(t.kcal, 2200);
  assert.strictEqual(t.protein_g, 190);
  assert.strictEqual(t.fat_g, Math.round(2200 * 0.2 / 9));
  assert.strictEqual(t.carbs_g, Math.round((2200 - 760 - t.fat_g * 9) / 4));
  assert.strictEqual(t.fuel_day, 'higher carb day');
  const r = F.targets('rest', 0);
  assert.strictEqual(r.kcal, 1600);
  assert.ok(r.carbs_g < t.carbs_g, 'rest day carries fewer carbs');
});

ok('workoutKcal: Strava kcal when done, TSS estimate when planned', () => {
  assert.strictEqual(F.workoutKcal([{ kcal: 500 }, { tss: 100 }], 175), 500 + 630);
});

ok('guidelines: every day has protein and plants; the carb rule follows the day', () => {
  assert.ok(F.guidelines('high').some(g => g.key === 'pre'));
  assert.ok(F.guidelines('rest').some(g => /no extra carbs/i.test(g.text)));
  assert.ok(F.guidelines('normal').every(g => g.text.length < 120));
});

ok('guidelineScore: photos against the rules, with the post-ride window', () => {
  const at = h => `2026-10-29T${String(h).padStart(2, '0')}:00:00Z`;
  const e = [
    { at: at(7), assessment: { protein_source: true, carbs: 'heavy', vegetables: true, processed: false, fits: 'yes' } },
    { at: at(12), assessment: { protein_source: true, carbs: 'some', vegetables: true, processed: false, fits: 'yes' } },
    { at: at(19), assessment: { protein_source: false, carbs: 'heavy', vegetables: false, processed: true, fits: 'no' } }
  ];
  const g = F.guidelineScore('normal', e, [{ end_at: at(10).replace('10:00', '10:30') }]);
  assert.strictEqual(g.meals, 3);
  assert.ok(g.checks.find(c => c.key === 'protein').ok === false);
  assert.ok(g.checks.find(c => c.key === 'plants').ok === true);
  assert.ok(g.checks.find(c => c.key === 'processed').ok === false);
  // the ride ended at 10:30 and lunch at 12:00 is outside the 60-minute window
  assert.strictEqual(g.checks.find(c => c.key === 'post').ok, false);
  const g2 = F.guidelineScore('normal', e, [{ end_at: at(11).replace('11:00', '11:30') }]);
  assert.strictEqual(g2.checks.find(c => c.key === 'post').ok, true);
  assert.ok(g.score > 0 && g.score < 100);
  assert.strictEqual(F.guidelineScore('rest', [], []).score, null);
});

ok('cue: follows the next scheduled session and the post-ride window', () => {
  const at = h => `2026-10-29T${String(h).padStart(2, '0')}:00:00Z`;
  const planned = [{ name: 'VO2 max: Zwift 40/20s #1', start_at: at(9), time: '09:00' }];
  assert.strictEqual(F.cue('high', planned, at(6)).key, 'pre');
  assert.ok(/oats/.test(F.cue('high', planned, at(7)).text));
  assert.strictEqual(F.cue('high', planned, at(8).replace('08:00', '08:30')).key, 'pre-close');
  assert.strictEqual(F.cue('high', planned, at(9).replace('09:00', '09:20')).key, 'during');
  assert.strictEqual(F.cue('high', planned, at(4)).key, 'ahead');
  const done = [{ name: 'Zone 1, 60 min', done: true, end_at: at(10) }];
  assert.strictEqual(F.cue('normal', done, at(10).replace('10:00', '10:20')).key, 'post');
  assert.strictEqual(F.cue('normal', done, at(13)).key, 'after');
  // a Zone 1 morning: low carb breakfast before it, a protein smoothie
  const z1 = [{ name: 'Zone 1, 60 min', start_at: at(9), time: '09:00' }];
  assert.ok(/low carb breakfast/i.test(F.cue('normal', z1, at(7)).text));
  const dawn = [{ name: 'Zone 1, 45 min', start_at: at(6), time: '06:00' }];
  assert.ok(/coffee and go/i.test(F.cue('normal', dawn, at(4)).text));
  assert.ok(F.guidelines('normal').some(g => /protein smoothie/i.test(g.text)));
  assert.strictEqual(F.cue('rest', [], at(13)).key, 'rest');
});

ok('mealPlan: meals are timed around the session', () => {
  const vo2 = F.mealPlan('high', [{ name: 'VO2 max: Zwift 40/20s #1', time: '09:00', minutes: 50 }], F.targets('high', 400));
  const slots = vo2.map(m => m.slot);
  assert.deepStrictEqual(slots.slice(0, 3), ['breakfast', 'on the bike', 'after']);
  assert.strictEqual(vo2[0].time, '06:30');
  assert.ok(/oats/.test(vo2[0].what));
  assert.strictEqual(vo2[2].time, '10:05');
  const z1 = F.mealPlan('normal', [{ name: 'Zone 1, 60 min', time: '09:00', minutes: 60 }], F.targets('normal', 300));
  assert.ok(/low carb breakfast/i.test(z1[0].what) && /smoothie/i.test(z1[0].what));
  assert.ok(/water/i.test(z1.find(m => m.slot === 'on the bike').what));
  const early = F.mealPlan('normal', [{ name: 'Zone 1, 45 min', time: '05:30', minutes: 45 }], F.targets('normal', 200));
  assert.strictEqual(early[0].slot, 'before');
  assert.strictEqual(early[0].time, '04:45');
  const rest = F.mealPlan('rest', [], F.targets('rest', 0));
  assert.strictEqual(rest.length, 4);
  assert.ok(rest.every(m => /^\d{2}:\d{2}$/.test(m.time)));
  assert.strictEqual(F.slotFor(vo2, '06:45'), 'breakfast');
  assert.strictEqual(F.slotFor(vo2, '15:00'), null);
});

ok('overall and band', () => {
  assert.strictEqual(F.overall(80, 60), 70);
  assert.strictEqual(F.overall(null, 60), 60);
  assert.strictEqual(F.overall(null, null), null);
  assert.strictEqual(F.band(92).word, 'on target');
  assert.strictEqual(F.band(75).word, 'close');
  assert.strictEqual(F.band(40).word, 'off');
});

console.log(n + ' passed');
