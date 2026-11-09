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
  const P104 = Object.assign({}, F.PROFILE, { kg: 104, age: 55 });   // the numbers below were worked at 104 kg and the old age 55
  assert.strictEqual(F.bmr(P104), 1883);
  assert.strictEqual(F.baseBurn(P104), 2542);
  const t = F.targets('high', 600, { kg: 104, age: 55 });
  assert.strictEqual(t.kcal, 2700);                 // the 3 g/kg floor trims the deficit by a few kcal
  assert.ok(t.deficit_trimmed > 0 && t.deficit_trimmed < 20, 'trimmed ' + t.deficit_trimmed);
  assert.strictEqual(t.protein_g, 198);
  assert.ok(t.carbs_g >= 312, 'high day carbs at least 3 g/kg: ' + t.carbs_g);
  assert.ok(t.fat_g >= 73, 'fat floor');
  assert.strictEqual(t.fuel_day, 'higher carb day');
  const r = F.targets('rest', 0, { kg: 104, age: 55 });
  assert.strictEqual(r.kcal, 2090);
  assert.ok(r.carbs_g >= 156 && r.carbs_g < t.carbs_g, 'rest day carbs ' + r.carbs_g);
  assert.strictEqual(r.deficit_trimmed, 0);
  // the scale moves the numbers; a rest-ordered day drops the deficit
  assert.ok(F.targets('rest', 0, { kg: 98 }).protein_g < r.protein_g);
  assert.strictEqual(F.targets('rest', 0, { deficit: 0, kg: 104, age: 55 }).kcal, 2540);
});

ok('burnList: a third ride nobody planned adds its calories; the plan still ahead counts too', () => {
  const done = [{ name: 'Zwift', kcal: 450, done: true }, { name: 'MTB', kcal: 380, done: true }, { name: 'third ride', kcal: 300, done: true }];
  const ahead = [{ name: 'Zone 1, 60 min', tss: 30 }];
  assert.strictEqual(F.workoutKcal(F.burnList(done, ahead), 175), 450 + 380 + 300 + Math.round(30 * 175 * 0.036));
  assert.strictEqual(F.workoutKcal(F.burnList(done.slice(0, 2), []), 175), 830);
});
ok('mealPlan: a lift is not a ride: no before meal, no on-the-bike slot, lunch at its usual hour', () => {
  const day = F.mealPlan('rest', [{ name: 'Push', sport: 'WeightTraining', time: '13:30', minutes: 55 }], F.targets('rest', 0));
  assert.ok(!day.some(m => m.slot === 'on the bike' || m.slot === 'before'), JSON.stringify(day.map(m => m.slot)));
  assert.strictEqual(day.find(m => m.slot === 'lunch').time, '13:00');
  const both = F.mealPlan('normal', [{ name: 'Push', sport: 'WeightTraining', time: '08:00', minutes: 55 }, { name: 'Zone 1, 60 min', sport: 'Ride', time: '16:00', minutes: 60 }], F.targets('normal', 300));
  assert.strictEqual(both.filter(m => m.slot === 'on the bike').length, 1);
  assert.strictEqual(both.find(m => m.slot === 'on the bike').time, '16:00');
});
ok('balanceSeries: burn runs through the day, a ride burns over its minutes, food is a step, the plan after now', () => {
  const b = F.balanceSeries({ baseBurn: 2400, nowMin: 360, sessions: [{ start: 420, end: 480, kcal: 600, name: 'ride' }],
    eaten: [{ min: 300, kcal: 200, label: 'shake' }], planned: [{ min: 540, kcal: 700, label: 'breakfast' }, { min: 200, kcal: 999, label: 'missed slot' }] });
  assert.strictEqual(b.points[0].kcal, 0);
  assert.strictEqual(b.now, Math.round(200 - 2400 / 1440 * 360));                 // 200 eaten, 6 h of base burn
  assert.strictEqual(b.end, Math.round(200 + 700 - 2400 - 600));                 // a past open slot is not counted as eaten
  assert.ok(b.points.find(p => p.m === 480).kcal < b.points.find(p => p.m === 420).kcal - 600);
  assert.strictEqual(b.points.find(p => p.m === 375).projected, true);
});
ok('mealPlan: the bottle is inside the day: every slot together adds up to the target', () => {
  const t = F.targets('high', 384);
  const day = F.mealPlan('high', [{ name: 'VO2 40/20s', sport: 'VirtualRide', time: '07:00', minutes: 51 }], t);
  assert.ok(day.some(m => m.slot === 'on the bike'));
  const sum = day.reduce((a, m) => a + (m.kcal || 0), 0);
  assert.ok(Math.abs(sum - t.kcal) <= 30, `${sum} vs ${t.kcal}`);
});
ok('mealMatch: a pre-ride snack is judged on its carbs, not the plate rules (no protein, no vegetables, starch are fine before a ride)', () => {
  const plan = { slot: 'before', kcal: 205, carbs_g: 35, protein_g: 0 };
  const m = F.mealMatch(plan, [{ kcal: 300, carbs_g: 54, protein_g: 9, fat_g: 5, assessment: { fits: 'partly', carbs: 'heavy', protein_source: false, vegetables: false, why: 'Good carbs, but more than planned.' } }]);
  assert.ok(!/starch|protein|vegetables/.test(m.word), m.word);
  assert.strictEqual(m.rules.key, 'green');
});
ok('mealMatch: starch is only a fault where the plan asked for few carbs; a carb meal on a training day is not "heavy on starch"', () => {
  const plate = [{ kcal: 640, carbs_g: 95, protein_g: 45, fat_g: 12, assessment: { fits: 'partly', carbs: 'heavy', protein_source: true, vegetables: true, why: 'A big bowl, but heavy on rice.' } }];
  assert.ok(!/starch/.test(F.mealMatch({ slot: 'breakfast', kcal: 640, carbs_g: 90, protein_g: 45 }, plate).rules.word));
  assert.strictEqual(F.mealMatch({ slot: 'dinner', kcal: 640, carbs_g: 20, protein_g: 45, low_carb: true }, plate).rules.word, 'heavy on starch');
});
ok('mealMatch: an overage taken from a later meal stays green but says so', () => {
  const m = F.mealMatch({ slot: 'before', kcal: 205, carbs_g: 35, protein_g: 0, rolled_out: { to: 'breakfast', kcal: 95 } }, [{ kcal: 300, carbs_g: 54, protein_g: 9, assessment: { fits: 'yes' } }]);
  assert.strictEqual(m.key, 'green'); assert.ok(/over, taken from breakfast/.test(m.word), m.word);
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
  assert.ok(/coffee and a Huel shake/i.test(F.cue('normal', dawn, at(4), { train_low: true }).text));
  assert.ok(/banana|small bowl/i.test(F.cue('normal', dawn, at(4)).text));
  assert.ok(F.guidelines('normal').some(g => /light carbs with protein/i.test(g.text)))
  assert.ok(F.guidelines('normal', { rx: { train_low: true } }).some(g => /train-low day/i.test(g.text)));
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
  assert.strictEqual(F.mealMatch(b, [{ kcal: 175, carbs_g: 0, protein_g: 27 }]).key, 'green');     // a Huel shake and eggs, no carbs: the point
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

// ---- the tighten review of 2 Nov: one slot, frozen meals, late rides, lifts, bottles ----
const lateRide = { name: 'Zone 1, 90 min', sport: 'VirtualRide', time: '23:00', end_time: '00:30', minutes: 90, tss: 59 };
const pullLift = { name: 'Pull', sport: 'WeightTraining', time: '17:30', end_time: '18:25', minutes: 55 };

ok('#1 one slot: after 8 p.m. with dinner open a meal is dinner; once dinner holds food the nearest slot takes it; his word wins', () => {
  const plan = F.mealPlan('rest', [], F.targets('rest', 0));
  assert.strictEqual(F.slotFor(plan, '21:26'), 'dinner');
  assert.strictEqual(F.slotFor(plan, '21:26', '', { logged: ['dinner'] }), 'snack');
  assert.strictEqual(F.slotFor(plan, '21:26', 'snack'), 'snack');
  assert.strictEqual(F.slotFor(plan, '19:30'), 'dinner');
  assert.strictEqual(F.slotFor(plan, '20:40', '', { logged: ['dinner'] }), 'snack');
  // the rows say what is logged when no list is given
  const rows = plan.map(m => Object.assign({}, m, { logged: m.slot === 'dinner' ? ['x'] : [] }));
  assert.strictEqual(F.slotFor(rows, '21:26'), 'snack');
  // the photo of the chicken a few minutes after the eggs is the same dinner, not the snack nearest the clock
  assert.strictEqual(F.slotFor(plan, '21:31', '', { logged: ['dinner', 'snack'], last: { slot: 'dinner', time: '21:26' } }), 'dinner');
  // dinner still open beats the chips logged twenty minutes before
  assert.strictEqual(F.slotFor(plan, '21:26', '', { logged: ['snack'], last: { slot: 'snack', time: '21:04' } }), 'dinner');
});

ok('#2 #3 a logged meal is frozen: its slot, its plan and its grade stay when the plan is redrawn; the snapshot is the row it was logged against', () => {
  const t = F.targets('rest', 0);
  const plan = F.mealPlan('rest', [], t);
  const before = F.dayMeals(plan, [], { target_kcal: t.kcal });
  const snackRow = before.find(r => r.slot === 'snack');
  const chips = { id: 'c1', time: '21:04', slot: 'snack', name: 'Chips', kcal: 300, carbs_g: 30, protein_g: 4, fat_g: 18, assessment: { fits: 'no', processed: true, why: 'Chips.' } };
  chips.plan = F.planSnapshot(snackRow, chips.time);
  const now = F.dayMeals(plan, [chips], { target_kcal: t.kcal });
  const row = now.find(r => r.logged.includes('c1'));
  assert.strictEqual(row.slot, 'snack');
  assert.deepStrictEqual([row.kcal, row.carbs_g, row.protein_g], [chips.plan.kcal, chips.plan.carbs_g, chips.plan.protein_g], 'the verdict and the card read one object');
  const grade = row.match.word;
  // a 10 p.m. ride is added: the plan has no snack any more and a "before" slot appears
  const ride = { name: 'Zone 1, 60 min', sport: 'VirtualRide', time: '22:00', minutes: 60, tss: 36 };
  const plan2 = F.mealPlan('normal', [ride], F.targets('normal', 200));
  assert.ok(!plan2.some(m => m.slot === 'snack'), 'the new plan has no snack slot');
  const later = F.dayMeals(plan2, [chips], { target_kcal: t.kcal });
  const still = later.find(r => r.logged.includes('c1'));
  assert.ok(still, 'the chips keep their row');
  assert.strictEqual(still.slot, 'snack');
  assert.strictEqual(still.time, snackRow.time);
  assert.strictEqual(still.kcal, chips.plan.kcal);
  assert.strictEqual(still.match.word, grade, 'the grade never moves');
  assert.ok(!later.some(r => r.slot === 'before' && r.logged.includes('c1')), 'never re-filed under the new "before" row');
  // a slot that keeps its name keeps its numbers even when the plan for it changes
  const dinner = { id: 'd1', time: '18:40', slot: 'dinner', name: 'Salmon and rice', kcal: 700, carbs_g: 70, protein_g: 50, fat_g: 20, assessment: { fits: 'yes', why: 'Good.' } };
  dinner.plan = F.planSnapshot(before.find(r => r.slot === 'dinner'), dinner.time);
  const moved = plan.map(m => m.slot === 'dinner' ? Object.assign({}, m, { kcal: m.kcal + 300, carbs_g: m.carbs_g + 60 }) : m);
  const dr = F.dayMeals(moved, [dinner], { target_kcal: t.kcal }).find(r => r.slot === 'dinner');
  assert.strictEqual(dr.kcal, dinner.plan.kcal); assert.strictEqual(dr.carbs_g, dinner.plan.carbs_g);
  assert.ok(dr.frozen && dr.logged.includes('d1'));
});

ok('#2 plan changes reshape only open slots: an overage rolls into an open slot, never into one that already holds food', () => {
  const plan = [{ time: '11:00', slot: 'after', kcal: 600, carbs_g: 80, protein_g: 45 }, { time: '12:55', slot: 'lunch', kcal: 600, carbs_g: 60, protein_g: 50 }];
  const sushi = { id: 's', time: '11:39', slot: 'after', kcal: 1100, carbs_g: 150, protein_g: 50, assessment: { fits: 'yes' } };
  const open = F.dayMeals(plan, [sushi]);
  assert.ok(open.find(r => r.slot === 'lunch').kcal < 600, 'open lunch is lighter');
  const lunchPlate = { id: 'l', time: '13:00', slot: 'lunch', kcal: 300, carbs_g: 10, protein_g: 40, plan: { slot: 'lunch', time: '12:55', kcal: 600, carbs_g: 60, protein_g: 50, at: '13:00' }, assessment: { fits: 'yes' } };
  const both = F.dayMeals(plan, [sushi, lunchPlate]);
  const l = both.find(r => r.slot === 'lunch');
  assert.strictEqual(l.kcal, 600, 'a logged lunch keeps the plan it was eaten under');
  assert.ok(both.find(r => r.slot === 'after').rolled_out, 'the post-ride meal still rolled (its own grade does not change)');
});

ok('#9 #12 a late ride past midnight keeps dinner, gets its bottle, and a bedtime snack after it, sorted last', () => {
  const day = F.fuelDay([lateRide]);
  const p = F.mealPlan(day, [lateRide], F.targets(day, 300));
  const dn = p.find(m => m.slot === 'dinner');
  assert.ok(dn && F.toMin(dn.time) <= 18 * 60 + 30, 'dinner at dinner time: ' + (dn && dn.time));
  const bottle = p.find(m => m.slot === 'on the bike');
  assert.ok(bottle && bottle.carbs_g >= 40, 'a 90-minute ride carries its bottle: ' + JSON.stringify(bottle));
  const after = p[p.length - 1];
  assert.strictEqual(after.slot, 'after');
  assert.strictEqual(after.time, '01:00'); assert.strictEqual(after.next_day, true); assert.strictEqual(after.at_min, 1500);
  assert.ok(/before bed/.test(after.what) && after.protein_g >= 20, after.what);
  assert.ok(p.every((m, i) => i === 0 || F.mmin(m) >= F.mmin(p[i - 1])), 'in time order, the snack after midnight last');
  // a 10 p.m. hour still gets its post-ride bite, at 11:30p
  const tenPm = F.mealPlan('normal', [{ name: 'Zone 1, 60 min', sport: 'VirtualRide', time: '22:00', minutes: 60, tss: 36 }], F.targets('normal', 200));
  assert.ok(tenPm.some(m => m.slot === 'after' && m.time === '23:30'), JSON.stringify(tenPm.map(m => m.time + ' ' + m.slot)));
  assert.ok(tenPm.some(m => m.slot === 'dinner'));
  // nothing after midnight is ever due this morning
  const due = F.dueSoFar(p, F.targets(day, 300), '07:00');
  assert.ok(!due.meals || due.kcal < after.kcal + 1000, 'not counted as due at 7 a.m.');
  assert.ok(F.dueSoFar(p, F.targets(day, 300), '02:00').kcal === 0 || F.dueSoFar(p, F.targets(day, 300), '02:00').meals === 0);
});

ok('#10 a lift never takes the ride\'s post-ride meal or its words', () => {
  const day = F.fuelDay([pullLift, lateRide]);
  const p = F.mealPlan(day, [pullLift, lateRide], F.targets(day, 300));
  const dn = p.find(m => m.slot === 'dinner');
  assert.ok(!/within 2 hours of the ride/i.test(dn.what), dn.what);
  assert.ok(F.toMin(dn.time) >= 18 * 60 + 25, 'dinner after the lift: ' + dn.time);
  assert.ok(!p.some(m => /within 2 hours of the ride/i.test(m.what) && F.mmin(m) < 23 * 60), 'no ride-sized meal hung on the lift');
  // a lift alone: no ride meals at all
  const lone = F.mealPlan('rest', [pullLift], F.targets('rest', 150));
  assert.ok(!lone.some(m => /ride/i.test(m.what) || m.slot === 'on the bike' || m.slot === 'before' || m.slot === 'after'), JSON.stringify(lone.map(m => m.slot)));
  // a ride at 3 p.m. and a lift at 5:30: the post-ride meal stays right after the ride
  const r3 = { name: 'Zone 1, 60 min', sport: 'VirtualRide', time: '15:00', minutes: 60, tss: 36 };
  const p3 = F.mealPlan('normal', [r3, pullLift], F.targets('normal', 200));
  const post = p3.find(m => m.post_ride);
  assert.ok(F.toMin(post.time) >= 16 * 60 && F.toMin(post.time) <= 17 * 60, 'post-ride after the ride, before the lift: ' + post.time);
});

ok('#12 every ride of 75 minutes or more gets its bottle, the second ride as much as the first', () => {
  const am = { name: 'Zone 1, 75 min', sport: 'VirtualRide', time: '09:00', minutes: 75, tss: 48 };
  const pm = { name: 'Zone 1, 90 min', sport: 'VirtualRide', time: '17:00', minutes: 90, tss: 59 };
  const p = F.mealPlan('normal', [am, pm], F.targets('normal', 500));
  const bottles = p.filter(m => m.slot === 'on the bike');
  assert.strictEqual(bottles.length, 2, JSON.stringify(bottles));
  assert.ok(bottles.every(b => b.carbs_g > 0), JSON.stringify(bottles));
  assert.ok(F.onBike(75).carbs > 0 && F.onBike(74).carbs === 0);
});

ok('#13 a slot that appeared after its time had passed is not shown today; one there from the morning is', () => {
  const ride = { name: 'Zone 1, 60 min', sport: 'VirtualRide', time: '22:00', minutes: 60, tss: 36 };
  const plain = F.mealPlan('rest', [], F.targets('rest', 0));
  const first = F.pastOnArrival(plain, {}, '07:00');
  assert.strictEqual(first.hide.size, 0); assert.ok(Object.values(first.seen).every(v => v === '00:00'));
  const plan = F.mealPlan('normal', [ride], F.targets('normal', 200));
  const later = F.pastOnArrival(plan, first.seen, '21:37');
  assert.ok(later.hide.has('before#0'), 'the 8:00p "before" added at 9:37p is hidden: ' + JSON.stringify([...later.hide]));
  assert.ok(!later.hide.has('dinner#0'), 'dinner, there since the morning, stays');
  const rows = F.dayMeals(plan, [], { hide: later.hide });
  assert.ok(!rows.some(r => r.slot === 'before'));
  assert.ok(rows.some(r => r.slot === 'dinner') && rows.some(r => r.slot === 'on the bike'));
  // a slot with food in it is never hidden
  const bite = { id: 'b', time: '20:05', slot: 'before', kcal: 150, carbs_g: 10, protein_g: 15, assessment: { fits: 'yes' } };
  assert.ok(F.dayMeals(plan, [bite], { hide: later.hide }).some(r => r.slot === 'before' && r.logged.includes('b')));
});

ok('#11 the work note never prints null', () => {
  const note = F.workNote({ pm: 90, dm: 0, pct: null, plannedDay: 'normal', actualDay: 'normal' });
  assert.ok(!/null/.test(note), note);
  assert.ok(/\(92%\)/.test(F.workNote({ pm: 90, dm: 83, pct: 92, plannedDay: 'normal', actualDay: 'normal' })));
  assert.ok(!/null/.test(F.workNote({ pm: 120, dm: 40, pct: null, plannedDay: 'high', actualDay: 'normal' })));
});

ok('#27 the coach\'s sentence is never cut mid-sentence', () => {
  assert.strictEqual(F.tidyWhy('Good plate: eggs and toast. Keep dinner to protein and vegetables, no butter, and'), 'Good plate: eggs and toast.');
  assert.strictEqual(F.tidyWhy('Protein is in and the day is on plan, no butter, and'), 'Protein is in and the day is on plan, no butter.');
  const long = 'A sentence that is fine. '.repeat(30);
  const t = F.tidyWhy(long, 420);
  assert.ok(t.length <= 420 && /\.$/.test(t), t.slice(-30));
  assert.strictEqual(F.tidyWhy('All good.'), 'All good.');
});

ok('#16 the same words within twenty minutes are a double, unless he says it was more', () => {
  const es = [{ id: 'a', time: '19:23', name: 'Two eggs, toast and a banana', written: 'two eggs, toast, a banana' }];
  assert.strictEqual(F.twinOf(es, 'two eggs, toast, a banana', 19 * 60 + 40).id, 'a');
  assert.strictEqual(F.twinOf(es, 'two eggs, toast, a banana', 19 * 60 + 50), null, 'past twenty minutes');
  assert.strictEqual(F.twinOf(es, 'another two eggs, toast, a banana', 19 * 60 + 30), null);
  assert.strictEqual(F.twinOf(es, 'rice 200 g', 19 * 60 + 30), null);
});

ok('#4 one drinks list: Hydration lists it, Food counts it, drank is its sum', () => {
  const es = [
    { id: 'w', name: 'Water, 250 ml', fluid_ml: 250, drink_only: true, is_drink: true },
    { id: 'b', name: 'Two beers', fluid_ml: 0, alcohol: 2, is_drink: true },
    { id: 's', name: 'Protein shake', fluid_ml: 400, kcal: 250, protein_g: 40, is_drink: false },
    { id: 'm', name: 'Salmon and rice', kcal: 700, is_drink: false },
    { id: 'x', name: 'Creatine', supplement: true }
  ];
  const d = F.drinksOf(es, [{ id: 'w', ml: 250 }, { id: 'b', ml: 710, net_ml: -280 }, { id: 's', ml: 400 }]);
  assert.deepStrictEqual(d.ids, ['w', 'b', 's']);
  assert.strictEqual(d.count, 3); assert.strictEqual(d.food_count, 1);
  assert.strictEqual(d.ml, 1360);
  assert.strictEqual(d.rows.find(r => r.id === 'b').net_ml, -280);
});
console.log(n + ' passed');

ok('fuel for the work: a prescription per session, the day as the sum of the work, one low ride a week and never before a hard day', () => {
  const vo2 = [{ name: 'VO2 40/20s', sport: 'VirtualRide', time: '07:00', minutes: 51, tss: 61 }];
  const r = F.fuelRx(vo2, 98, 175, {});
  assert.strictEqual(r.level, 'high'); assert.strictEqual(r.day, 'high');
  assert.strictEqual(r.sessions[0].kind, 'hard'); assert.strictEqual(r.sessions[0].during.carbs_g, 50);
  assert.ok(r.per_kg >= 2.5 && r.per_kg <= 3.5, 'a VO2 day near 3 g/kg: ' + r.per_kg);
  const z1 = [{ name: 'Z1 trainer 60 min', sport: 'VirtualRide', time: '07:00', minutes: 60, tss: 30 }];
  const low = F.fuelRx(z1, 98, 175, {});
  assert.strictEqual(low.level, 'low'); assert.ok(low.train_low); assert.strictEqual(low.sessions[0].before.carbs_g, 20); assert.ok(low.sessions[0].before.low);
  assert.strictEqual(low.sessions[0].during.carbs_g, 0); assert.ok(low.per_kg < 2.2, 'a low day under 2.2 g/kg: ' + low.per_kg);
  // the low ride is used up for the week, or tomorrow is hard: the same ride is light
  assert.strictEqual(F.fuelRx(z1, 98, 175, { low_used_week: 1 }).sessions[0].kind, 'light');
  assert.strictEqual(F.fuelRx(z1, 98, 175, { hard_tomorrow: true }).sessions[0].kind, 'light');
  // a long ride is fed whole; a rest day is the floor; a lift alone is a rest day for carbs
  const long = F.fuelRx([{ name: 'Zone 1, 150 min', sport: 'Ride', time: '09:45', minutes: 150, tss: 95 }], 98, 175, {});
  assert.strictEqual(long.sessions[0].kind, 'long'); assert.strictEqual(long.sessions[0].during.carbs_g, 150); assert.ok(long.per_kg >= 3.5, long.per_kg);
  assert.strictEqual(F.fuelRx([], 98, 175, {}).per_kg, 1.5);
  assert.strictEqual(F.fuelRx([{ name: 'Pull', sport: 'WeightTraining', time: '09:30', minutes: 55 }], 98, 175, {}).level, 'rest');
  // the targets take the prescription's carbs; the meals carry the windows and still add up to the day
  const t = F.targets(r.day, F.workoutKcal(vo2, 175), { kg: 98, rx: r });
  assert.strictEqual(t.carbs_g, r.carbs_g); assert.strictEqual(t.fuel_day, 'higher carb day');
  const meals = F.mealPlan(r.day, vo2, t);
  const before = meals.find(m => m.slot === 'before'), post = meals.find(m => m.post_ride);
  assert.ok(before.fixed && before.carbs_g <= 30, 'an early bite holds 30 g at most: ' + before.carbs_g);
  assert.ok(post.fixed && post.carbs_g >= r.sessions[0].after.carbs_g, 'the rest of the before carbs land after: ' + post.carbs_g);
  assert.ok(Math.abs(meals.reduce((a, m) => a + m.carbs_g, 0) - t.carbs_g) <= 10, 'the day adds up');
  const tl = F.targets(low.day, F.workoutKcal(z1, 175), { kg: 98, rx: low });
  const lm = F.mealPlan(low.day, z1, tl);
  assert.ok(lm.find(m => m.slot === 'before').low_carb && /water/i.test(lm.find(m => m.slot === 'on the bike').what));
});

ok('fuel for the work: a real breakfast before a long ride, and more carbs than planned before it is fuel, not a miss', () => {
  const long = F.fuelRx([{ name: 'Zone 1, 120 min', sport: 'Ride', time: '10:00', minutes: 120, tss: 77 }], 98, 175, {});
  assert.ok(long.sessions[0].before.carbs_g >= 59, 'at least 0.6 g/kg before a long ride: ' + long.sessions[0].before.carbs_g);
  const plan = { slot: 'breakfast', kcal: 700, carbs_g: 59, protein_g: 45, fixed: true, rx: 'long' };
  const plate = [{ kcal: 810, carbs_g: 81, protein_g: 41, fat_g: 35, assessment: { fits: 'yes', carbs: 'some', protein_source: true, vegetables: true, why: 'Good.' } }];
  const m = F.mealMatch(plan, plate);
  assert.strictEqual(m.key, 'green', m.word);
  const post = F.mealMatch({ slot: 'after', kcal: 700, carbs_g: 55, protein_g: 45, fixed: true, rx: 'long', post_ride: true }, [{ kcal: 900, carbs_g: 110, protein_g: 45, fat_g: 20, assessment: { fits: 'yes', why: 'ok' } }]);
  assert.notStrictEqual(post.key, 'green', 'the meal after is judged as planned: ' + post.word);
});
