// node bridge/food-math.test.js
const assert = require('assert');
const F = require('./food-math');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('fuelDay: VO2, two hours or 80 TSS is a higher carb day; a 90-minute Zone 1 is normal; nothing is rest', () => {
  assert.strictEqual(F.fuelDay([{ name: 'VO2 max: Zwift 40/20s #1', minutes: 50, tss: 55 }]), 'high');
  assert.strictEqual(F.fuelDay([{ name: 'Zone 1, 120 min', minutes: 120 }]), 'high');
  assert.strictEqual(F.fuelDay([{ name: 'Zone 1, 90 min', minutes: 90, tss: 59 }]), 'normal');
  assert.strictEqual(F.fuelDay([{ name: 'Zone 1, 45 min', minutes: 45, tss: 25 }]), 'normal');
  assert.strictEqual(F.fuelDay([{ name: 'Mountain bike handling, 60 min', minutes: 60 }]), 'normal');
  assert.strictEqual(F.fuelDay([]), 'rest');
});

ok('targets: Mifflin energy, the deficit, protein per kg, carb floors by day', () => {
  assert.strictEqual(F.bmr(F.PROFILE), 1883);
  assert.strictEqual(F.baseBurn(F.PROFILE), 2542);
  const t = F.targets('high', 600);
  assert.strictEqual(t.kcal, 2700);                 // the 3 g/kg floor trims the deficit by a few kcal
  assert.ok(t.deficit_trimmed > 0 && t.deficit_trimmed < 20, 'trimmed ' + t.deficit_trimmed);
  assert.strictEqual(t.protein_g, 198);
  assert.ok(t.carbs_g >= 312, 'high day carbs at least 3 g/kg: ' + t.carbs_g);
  assert.ok(t.fat_g >= 73, 'fat floor');
  assert.strictEqual(t.fuel_day, 'higher carb day');
  const r = F.targets('rest', 0);
  assert.strictEqual(r.kcal, 2090);
  assert.ok(r.carbs_g >= 156 && r.carbs_g < t.carbs_g, 'rest day carbs ' + r.carbs_g);
  assert.strictEqual(r.deficit_trimmed, 0);
  // the scale moves the numbers; a rest-ordered day drops the deficit
  assert.ok(F.targets('rest', 0, { kg: 98 }).protein_g < r.protein_g);
  assert.strictEqual(F.targets('rest', 0, { deficit: 0 }).kcal, 2540);
});

ok('workoutKcal: Strava kcal when done, TSS estimate when planned', () => {
  assert.strictEqual(F.workoutKcal([{ kcal: 500 }, { tss: 100 }], 175), 500 + 630);
});

ok('guidelines: every day has protein and plants; the carb rule follows the day', () => {
  assert.ok(F.guidelines('high').some(g => g.key === 'pre'));
  assert.ok(F.guidelines('rest').some(g => /one meal only/i.test(g.text)));
  assert.ok(F.guidelines('high').some(g => /2 hours/i.test(g.text)));
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
  // the ride ended at 9:30 and lunch at 12:00 is outside the two-hour window
  const g0 = F.guidelineScore('normal', e, [{ end_at: at(9).replace('09:00', '09:30') }]);
  assert.strictEqual(g0.checks.find(c => c.key === 'post').ok, false);
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
  assert.strictEqual(F.cue('normal', done, at(11).replace('11:00', '11:50')).key, 'post');
  assert.strictEqual(F.cue('normal', done, at(13)).key, 'after');
  // a Zone 1 morning: low carb breakfast before it, a protein smoothie
  const z1 = [{ name: 'Zone 1, 60 min', start_at: at(9), time: '09:00' }];
  assert.ok(/low carb breakfast/i.test(F.cue('normal', z1, at(7)).text));
  const dawn = [{ name: 'Zone 1, 45 min', start_at: at(6), time: '06:00' }];
  assert.ok(/coffee and a 20 g whey/i.test(F.cue('normal', dawn, at(4)).text));
  assert.ok(F.guidelines('normal').some(g => /low carb breakfast/i.test(g.text)));
  assert.strictEqual(F.cue('rest', [], at(13)).key, 'rest');
});

ok('mealPlan: meals are timed around the session', () => {
  const vo2 = F.mealPlan('high', [{ name: 'VO2 max: Zwift 40/20s #1', time: '09:00', minutes: 50 }], F.targets('high', 400));
  const slots = vo2.map(m => m.slot);
  assert.deepStrictEqual(slots.slice(0, 3), ['breakfast', 'on the bike', 'after']);
  assert.strictEqual(vo2[0].time, '06:30');
  assert.ok(/oats/.test(vo2[0].what));
  assert.strictEqual(vo2[2].time, '10:20');
  const z1 = F.mealPlan('normal', [{ name: 'Zone 1, 60 min', time: '09:00', minutes: 60 }], F.targets('normal', 300));
  assert.ok(/low carb breakfast/i.test(z1[0].what) && /smoothie/i.test(z1[0].what));
  assert.ok(/water/i.test(z1.find(m => m.slot === 'on the bike').what));
  const long = F.mealPlan('high', [{ name: 'Zone 1, 150 min', time: '08:00', minutes: 150 }], F.targets('high', 900));
  assert.strictEqual(long.find(m => m.slot === 'on the bike').carbs_g, 150);
  assert.ok(/2 hours/.test(long.find(m => m.slot === 'breakfast').what));   // breakfast would be 5:30, so it moves after the ride
  const early = F.mealPlan('normal', [{ name: 'Zone 1, 45 min', time: '05:30', minutes: 45 }], F.targets('normal', 200));
  assert.strictEqual(early[0].slot, 'before');
  assert.strictEqual(early[0].time, '04:45');
  assert.strictEqual(early[2].slot, 'breakfast');            // after a dawn ride, the post-ride meal is breakfast
  // an evening ride: breakfast and lunch as normal, light before, the post-ride meal is dinner
  const eve = F.mealPlan('normal', [{ name: 'Zone 1, 90 min', time: '19:00', minutes: 90 }], F.targets('normal', 370));
  assert.deepStrictEqual(eve.map(m => m.slot), ['breakfast', 'lunch', 'before', 'on the bike', 'dinner']);
  assert.strictEqual(eve[0].time, '09:00'); assert.strictEqual(eve[2].time, '17:00'); assert.strictEqual(eve[4].time, '21:00');   // sleep in
  assert.ok(eve.every(m => F.toMin(m.time) >= 5 * 60), 'nothing wraps past midnight');
  // a midday ride: breakfast is the pre-ride meal, lunch is the post-ride meal
  const mid = F.mealPlan('high', [{ name: 'VO2 max: Zwift 40/20s #1', time: '12:00', minutes: 50 }], F.targets('high', 400));
  assert.deepStrictEqual(mid.map(m => m.slot), ['breakfast', 'on the bike', 'lunch', 'dinner', 'snack']);
  assert.strictEqual(mid[0].time, '09:30');   // the latest breakfast before a midday ride
  assert.strictEqual(mid[2].time, '13:20');
  const rest = F.mealPlan('rest', [], F.targets('rest', 0));
  assert.strictEqual(rest.length, 4);
  assert.ok(rest.every(m => /^\d{2}:\d{2}$/.test(m.time)));
  assert.strictEqual(F.slotFor(vo2, '06:45'), 'breakfast');
  assert.strictEqual(F.slotFor(vo2, '15:00'), null);
});

ok('dueSoFar: the plan\'s meals whose time has come', () => {
  const tg = F.targets('normal', 370);
  const meals = F.mealPlan('normal', [{ name: 'Zone 1, 90 min', time: '19:00', minutes: 90 }], tg);
  assert.strictEqual(F.dueSoFar(meals, tg, '06:00').kcal, 0);                       // before breakfast: nothing due
  assert.strictEqual(F.dueSoFar(meals, tg, '08:00').meals, 0);                     // breakfast is at 9:00 now: nothing due at 8
  const ten = F.dueSoFar(meals, tg, '10:00');
  assert.strictEqual(ten.meals, 1); assert.ok(ten.kcal > 300 && ten.kcal < tg.kcal * 0.35, 'breakfast share ' + ten.kcal);
  assert.strictEqual(ten.next, '13:00');
  const night = F.dueSoFar(meals, tg, '23:00');
  assert.ok(night.share >= 0.9, 'whole day by night ' + night.share);
});

ok('overall and band', () => {
  assert.strictEqual(F.overall(80, 60), 70);
  assert.strictEqual(F.overall(null, 60), 60);
  assert.strictEqual(F.overall(null, null), null);
  assert.strictEqual(F.band(92).word, 'on target');
  assert.strictEqual(F.band(75).word, 'close');
  assert.strictEqual(F.band(40).word, 'off');
});


ok('mealMatch: a plate within 20% is green, 40% yellow, further is red either way; protein only when short', () => {
  const plan = { kcal: 500, carbs_g: 60, protein_g: 30 };
  assert.strictEqual(F.mealMatch(plan, []), null);
  assert.strictEqual(F.mealMatch(plan, [{ kcal: 520, carbs_g: 55, protein_g: 32 }]).key, 'green');
  assert.strictEqual(F.mealMatch(plan, [{ kcal: 650, carbs_g: 70, protein_g: 30 }]).key, 'yellow');
  const red = F.mealMatch(plan, [{ kcal: 520, carbs_g: 110, protein_g: 30 }]);
  assert.strictEqual(red.key, 'red'); assert.ok(/carbs 83% over/.test(red.word), red.word);
  assert.strictEqual(F.mealMatch(plan, [{ kcal: 500, carbs_g: 60, protein_g: 10 }]).key, 'yellow');   // protein short is never red
  assert.strictEqual(F.mealMatch(plan, [{ kcal: 500, carbs_g: 60, protein_g: 60 }]).key, 'green');    // extra protein is fine
  assert.strictEqual(F.mealMatch({ kcal: 120, carbs_g: 30, protein_g: 0 }, [{ kcal: 110, carbs_g: 28 }]).key, 'green');
});

ok('a low-carb breakfast is low carb: 20 g, and eating under it is as planned', () => {
  const plan = F.mealPlan('normal', [{ name: 'Zone 1, 90 min', time: '09:00', minutes: 90 }], F.targets('normal', 600));
  const b = plan.find(m => m.slot === 'breakfast');
  assert.ok(b.low_carb && b.carbs_g === 20 && b.protein_g === 30, JSON.stringify(b));
  assert.ok(/under 20 g of carbs/.test(b.what), b.what);
  const after = plan.find(m => m.slot === 'after');
  assert.ok(after.carbs_g > b.carbs_g * 3, 'the carbs moved to after the ride: ' + after.carbs_g);
  assert.strictEqual(F.mealMatch(b, [{ kcal: 175, carbs_g: 0, protein_g: 27 }]).key, 'green');     // whey and eggs, no carbs: the point
  assert.strictEqual(F.mealMatch(b, [{ kcal: 500, carbs_g: 60, protein_g: 30 }]).key, 'red');      // toast and oats: not low carb
  assert.strictEqual(F.mealMatch(b, [{ kcal: 120, carbs_g: 0, protein_g: 10 }]).key, 'yellow');    // protein short
  const bike = plan.find(m => m.slot === 'on the bike');
  assert.strictEqual(F.mealMatch(bike, [{ kcal: 0, carbs_g: 0, fluid_ml: 600, drink_only: true }]), null);   // water is not the bottle of Tailwind
  assert.strictEqual(F.mealMatch(bike, [{ kcal: 180, carbs_g: 45, fluid_ml: 600, drink_only: true }]).key, 'green');
});
console.log(n + ' passed');
