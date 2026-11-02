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
  const P104 = Object.assign({}, F.PROFILE, { kg: 104 });   // the numbers below were worked at 104 kg
  assert.strictEqual(F.bmr(P104), 1883);
  assert.strictEqual(F.baseBurn(P104), 2542);
  const t = F.targets('high', 600, { kg: 104 });
  assert.strictEqual(t.kcal, 2700);                 // the 3 g/kg floor trims the deficit by a few kcal
  assert.ok(t.deficit_trimmed > 0 && t.deficit_trimmed < 20, 'trimmed ' + t.deficit_trimmed);
  assert.strictEqual(t.protein_g, 198);
  assert.ok(t.carbs_g >= 312, 'high day carbs at least 3 g/kg: ' + t.carbs_g);
  assert.ok(t.fat_g >= 73, 'fat floor');
  assert.strictEqual(t.fuel_day, 'higher carb day');
  const r = F.targets('rest', 0, { kg: 104 });
  assert.strictEqual(r.kcal, 2090);
  assert.ok(r.carbs_g >= 156 && r.carbs_g < t.carbs_g, 'rest day carbs ' + r.carbs_g);
  assert.strictEqual(r.deficit_trimmed, 0);
  // the scale moves the numbers; a rest-ordered day drops the deficit
  assert.ok(F.targets('rest', 0, { kg: 98 }).protein_g < r.protein_g);
  assert.strictEqual(F.targets('rest', 0, { deficit: 0, kg: 104 }).kcal, 2540);
});

ok('burnList: a third ride nobody planned adds its calories; the plan still ahead counts too', () => {
  const done = [{ name: 'Zwift', kcal: 450, done: true }, { name: 'MTB', kcal: 380, done: true }, { name: 'third ride', kcal: 300, done: true }];
  const ahead = [{ name: 'Zone 1, 60 min', tss: 30 }];
  assert.strictEqual(F.workoutKcal(F.burnList(done, ahead), 175), 450 + 380 + 300 + Math.round(30 * 175 * 0.036));
  assert.strictEqual(F.workoutKcal(F.burnList(done.slice(0, 2), []), 175), 830);
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
  assert.strictEqual(F.slotFor(vo2, '00:30'), null);   // far from every slot
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


ok('alcohol: counted, never on plan; one drink partly, three no; the slot it sits in says so', () => {
  assert.strictEqual(F.alcoholOf({ name: 'Three pints of lager beer', kcal: 600, assessment: { fits: 'yes' } }), 3);
  assert.strictEqual(F.alcoholOf({ name: 'Pint of lager beer', kcal: 200 }), 1);
  assert.strictEqual(F.alcoholOf({ name: 'Glass of water', drink: 'glass of water' }), 0);
  assert.strictEqual(F.alcoholOf({ name: 'Greek wrap with grilled chicken', drink: 'bottled water' }), 0);
  assert.strictEqual(F.alcoholOf({ name: 'Two glasses of red wine', kcal: 250 }), 2);
  assert.strictEqual(F.alcoholOf({ name: 'three beers', drink: 'three beers', kcal: 460 }), 3);
  assert.strictEqual(F.alcoholOf({ name: 'two lagers', kcal: 300 }), 2);
  // a drink never reads "no protein source": it was never asked to bring any
  const dinnerPlan = { slot: 'dinner', kcal: 725, carbs_g: 75, protein_g: 55 };
  const soda = F.mealMatch(dinnerPlan, [{ name: 'Large cola', drink: 'cola', kcal: 200, carbs_g: 50, protein_g: 0, assessment: { fits: 'no', protein_source: false } }, { kcal: 520, carbs_g: 15, protein_g: 112, assessment: { fits: 'yes', protein_source: true } }]);
  assert.notStrictEqual(soda.rules.word, 'no protein source');
  // a bare starch logged beside a plate with vegetables and protein is judged with the plate
  const bread = F.mealMatch(dinnerPlan, [{ name: 'Dinner roll', kcal: 150, carbs_g: 28, protein_g: 4, assessment: { fits: 'partly', protein_source: false, vegetables: false, carbs: 'some', why: 'A roll on its own.' } }, { kcal: 520, carbs_g: 15, protein_g: 112, assessment: { fits: 'yes', protein_source: true, vegetables: true } }]);
  assert.ok(!/no protein|no vegetables/.test(bread.rules.word), bread.rules.word);
  const alone = F.mealMatch(dinnerPlan, [{ name: 'Dinner roll', kcal: 150, carbs_g: 28, protein_g: 4, assessment: { fits: 'partly', protein_source: false, vegetables: false, carbs: 'some' } }]);
  assert.strictEqual(alone.rules.word, 'no protein source');
  assert.strictEqual(F.alcoholRule({ name: 'Three pints of lager beer', kcal: 600, assessment: { fits: 'yes' } }).assessment.fits, 'no');
  assert.strictEqual(F.alcoholRule({ name: 'Pint of lager beer', kcal: 200, assessment: { fits: 'yes' } }).assessment.fits, 'partly');
  const dinner = { slot: 'dinner', kcal: 725, carbs_g: 75, protein_g: 55 };
  const withPint = F.mealMatch(dinner, [F.alcoholRule({ name: 'Pint of lager beer', kcal: 200, carbs_g: 17, protein_g: 2, drink: 'pint of lager', assessment: { fits: 'yes' } }), { kcal: 520, carbs_g: 15, protein_g: 112, assessment: { fits: 'yes' } }], { day_kcal: 2400, target_kcal: 2020 });
  assert.strictEqual(withPint.key, 'yellow', JSON.stringify(withPint)); assert.strictEqual(withPint.rules.word, 'one drink');
  const pintFirst = F.mealMatch(dinner, [F.alcoholRule({ name: 'Pint of lager beer', kcal: 200, carbs_g: 17, protein_g: 2, drink: 'pint of lager', assessment: { fits: 'yes', why: 'One pint is fine, but you still need 45 g of protein at dinner.' } }), { kcal: 520, carbs_g: 15, protein_g: 112, assessment: { fits: 'yes', why: 'This is exactly the right dinner.' } }]);
  assert.strictEqual(pintFirst.rules.why, 'This is exactly the right dinner.'); assert.strictEqual(pintFirst.rules.word, 'one drink');
  const withThree = F.mealMatch(dinner, [F.alcoholRule({ name: 'Three pints of lager beer', kcal: 600, carbs_g: 51, protein_g: 6, assessment: { fits: 'yes' } }), { kcal: 520, carbs_g: 15, protein_g: 112, assessment: { fits: 'yes' } }]);
  assert.strictEqual(withThree.key, 'red'); assert.strictEqual(withThree.rules.word, '3 drinks');
});

ok('mealMatch: a light plate with its protein is never red; green when the day is already at its calories', () => {
  const dinner = { slot: 'dinner', kcal: 725, carbs_g: 75, protein_g: 55 };
  const shrimp = [{ kcal: 520, carbs_g: 15, protein_g: 112, assessment: { fits: 'yes' } }];
  const alone = F.mealMatch(dinner, shrimp);
  assert.strictEqual(alone.key, 'yellow', JSON.stringify(alone)); assert.ok(/carbs \d+% under/.test(alone.word), alone.word);
  const full = F.mealMatch(dinner, shrimp, { day_kcal: 2400, target_kcal: 2020 });
  assert.strictEqual(full.key, 'green', JSON.stringify(full)); assert.strictEqual(full.word, 'as planned'); assert.strictEqual(full.macros.word, 'light plate, day covered');
  const noProtein = F.mealMatch(dinner, [{ kcal: 300, carbs_g: 10, protein_g: 12, assessment: { fits: 'yes' } }], { day_kcal: 2400, target_kcal: 2020 });
  assert.notStrictEqual(noProtein.key, 'green');
  const over = F.mealMatch(dinner, [{ kcal: 1400, carbs_g: 160, protein_g: 60 }], { day_kcal: 2400, target_kcal: 2020 });
  assert.strictEqual(over.key, 'red');
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
ok('slotFor: the word he used wins; an early breakfast is breakfast; far from everything is nothing', () => {
  const plan = [{ slot: 'breakfast', time: '09:00' }, { slot: 'lunch', time: '13:00' }, { slot: 'dinner', time: '18:30' }, { slot: 'snack', time: '20:30' }];
  assert.strictEqual(F.slotFor(plan, '06:47', 'breakfast'), 'breakfast');
  assert.strictEqual(F.slotFor(plan, '06:47'), 'breakfast');           // up to four hours before the first slot
  assert.strictEqual(F.slotFor(plan, '11:58', 'lunch'), 'lunch');
  assert.strictEqual(F.slotFor(plan, '15:20'), 'lunch');               // within two and a half hours of the nearest
  assert.strictEqual(F.slotFor(plan, '15:40'), null);                  // beyond it
  assert.strictEqual(F.slotFor(plan, '04:00'), null);
  assert.strictEqual(F.slotFor(plan, '19:10', 'snack'), 'snack');
  assert.strictEqual(F.slotFor(plan, '06:19', 'snack'), null);           // a morning coffee is not the evening snack
});
ok('mealMatch: one grade from macros and the rules; a wrap that hits the macros but breaks the starch rule is yellow, and says why', () => {
  const lunch = { slot: 'lunch', time: '13:00', kcal: 585, carbs_g: 50, protein_g: 50 };
  const wrap = [{ kcal: 580, carbs_g: 52, protein_g: 40, assessment: { protein_source: true, carbs: 'some', vegetables: true, processed: false, fits: 'partly', why: 'the tortilla is the second starch' } }];
  const m = F.mealMatch(lunch, wrap);
  assert.strictEqual(m.key, 'yellow'); assert.strictEqual(m.macros.key, 'green'); assert.strictEqual(m.rules.key, 'yellow'); assert.ok(/rules partly met|starch/.test(m.word), m.word);
  const clean = F.mealMatch(lunch, [{ kcal: 580, carbs_g: 52, protein_g: 48, assessment: { protein_source: true, carbs: 'some', vegetables: true, processed: false, fits: 'yes' } }]);
  assert.strictEqual(clean.key, 'green'); assert.strictEqual(clean.word, 'as planned');
  const biscuit = F.mealMatch({ slot: 'breakfast', time: '09:00', kcal: 505, carbs_g: 25, protein_g: 45 }, [{ kcal: 550, carbs_g: 39, protein_g: 21, assessment: { protein_source: false, carbs: 'heavy', vegetables: false, processed: true, fits: 'no' } }]);
  assert.strictEqual(biscuit.key, 'red'); assert.ok(/processed|carbs/.test(biscuit.word), biscuit.word);
  const noAssess = F.mealMatch(lunch, [{ kcal: 580, carbs_g: 52, protein_g: 48 }]);
  assert.strictEqual(noAssess.key, 'green');
});

ok('rollForward: a post-ride meal that ran over leaves lunch a protein plate; a low-carb slot and a far slot roll nothing', () => {
  const plan = [
    { slot: 'breakfast', time: '08:00', kcal: 335, carbs_g: 20, protein_g: 30, low_carb: true, what: 'eggs' },
    { slot: 'on the bike', time: '09:30', kcal: 0, carbs_g: 0, protein_g: 0, extra: true, what: 'water' },
    { slot: 'after', time: '10:55', kcal: 560, carbs_g: 85, protein_g: 50, what: 'rice and chicken' },
    { slot: 'lunch', time: '12:55', kcal: 450, carbs_g: 40, protein_g: 50, what: 'Protein with rice or potatoes, vegetables.' },
    { slot: 'dinner', time: '18:30', kcal: 670, carbs_g: 55, protein_g: 55, what: 'dinner' }
  ];
  const entries = [
    { slot: 'breakfast', time: '06:39', kcal: 500, carbs_g: 45, protein_g: 27 },             // low carb slot over: no credit forward
    { slot: 'after', time: '11:39', kcal: 700, carbs_g: 96, protein_g: 34 }                   // sushi: 140 kcal and 11 g carbs over, protein short
  ];
  const r = F.rollForward(plan, entries);
  const bike = r.find(m => m.slot === 'on the bike'), lunch = r.find(m => m.slot === 'lunch'), dinner = r.find(m => m.slot === 'dinner'), after = r.find(m => m.slot === 'after');
  assert.strictEqual(bike.kcal, 0); assert.ok(!bike.rolled_from);
  assert.ok(after.rolled_out && after.rolled_out.to === 'lunch');
  // 140 kcal and 11 g carbs off lunch; the 16 g of protein the sushi missed lands there with its calories
  assert.strictEqual(lunch.plan_kcal, 450); assert.strictEqual(lunch.kcal, 375); assert.strictEqual(lunch.carbs_g, 30); assert.strictEqual(lunch.protein_g, 65);
  assert.ok(/Lighter/.test(lunch.what), lunch.what);
  assert.ok(!lunch.covered_by);
  assert.strictEqual(dinner.kcal, 670); assert.ok(!dinner.rolled_from);                        // too far from lunch, and lunch has nothing logged
  // the after slot's calories over are not a miss once they have rolled on; protein short still is
  const mt = F.mealMatch(after, entries.filter(e => e.slot === 'after'));
  assert.strictEqual(mt.key, 'yellow'); assert.ok(/protein/.test(mt.word), mt.word);
  // a plate big enough to be both meals covers the next slot
  const big = F.rollForward(plan, [{ slot: 'after', time: '11:39', kcal: 950, carbs_g: 120, protein_g: 60 }]);
  const l2 = big.find(m => m.slot === 'lunch');
  assert.strictEqual(l2.covered_by, 'after'); assert.ok(/covered/.test(l2.what));
  assert.strictEqual(F.mealMatch(l2, [{ slot: 'lunch', kcal: 150, carbs_g: 5, protein_g: 25 }]).covered, true);
  assert.strictEqual(F.nextSlot(big.filter(m => !m.covered_by).map(m => Object.assign({}, m, { logged: m.slot === 'after' ? ['x'] : [] })), '12:00').slot, 'dinner');
});

ok('ride minutes and the day type come from rides only: a lift and a run beside the rides change neither', () => {
  const rides = [{ name: 'Zone 1, 150 min', sport: 'VirtualRide', minutes: 150, tss: 76 }, { name: 'Zone 1, 60 min · mountain bike', sport: 'Ride', minutes: 60, tss: 30 }];
  const extras = [{ name: 'Push', sport: 'WeightTraining', minutes: 55, tss: 20 }, { name: 'Indoor run', sport: 'Run', minutes: 30, tss: 30 }];
  assert.strictEqual(rides.concat(extras).filter(F.isRideSession).reduce((a, s) => a + s.minutes, 0), 210);
  assert.strictEqual(F.fuelDay(rides.concat(extras)), F.fuelDay(rides));
  assert.strictEqual(F.fuelDay(extras), 'rest');
});

ok('a second session later in the day moves the meals around it: dinner after an evening ride, lunch clear of an afternoon one', () => {
  const morning = { name: 'Morning Ride', sport: 'Ride', time: '09:49', end_time: '11:12', minutes: 83, done: true };
  const evening = { name: 'Zone 1, 60 min · mountain bike', sport: 'Ride', time: '18:00', minutes: 60 };
  const plan = F.mealPlan('normal', [morning, evening]);
  const dinner = plan.find(m => m.slot === 'dinner');
  assert.ok(F.toMin(dinner.time) >= 19 * 60 + 30, 'dinner ' + dinner.time);
  const long = F.mealPlan('normal', [morning, Object.assign({}, evening, { minutes: 120 })]);
  assert.ok(long.some(m => m.slot === 'on the bike' && m.time === '18:00'), 'a bottle for a two-hour evening ride');
  const afternoon = { name: 'Zone 1, 60 min · mountain bike', sport: 'Ride', time: '15:00', minutes: 60 };
  const plan2 = F.mealPlan('normal', [morning, afternoon]);
  const lunch = plan2.find(m => m.slot === 'lunch');
  assert.ok(lunch && F.toMin(lunch.time) <= 14 * 60, 'lunch clear of the ride: ' + (lunch && lunch.time));
  assert.ok(plan2.every((m, i) => i === 0 || F.toMin(m.time) >= F.toMin(plan2[i - 1].time)), 'in time order');
});

ok('the Now line names the meal by the clock: no breakfast talk before an afternoon ride', () => {
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const start = new Date(); start.setHours(15, 0, 0, 0);
  const c = F.cue('normal', [{ name: 'Zone 1, 60 min', time: '15:00', minutes: 60, start_at: start.toISOString() }], at(13, 55));
  assert.ok(c && !/breakfast/i.test(c.text), c && c.text);
  assert.ok(/light|protein/i.test(c.text), c.text);
});
console.log(n + ' passed');
