// node bridge/history.test.js
const assert = require('assert');
const H = require('./history');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

// Monday 9 Nov 2026 as the site holds it: the day Harry asked the coach about ("the coach wasn't able to tell me what I ate on Monday")
const monday = {
  date: '2026-11-09',
  report: { fuel_day: 'moderate carb day', actual: { kcal: 2550 }, target: { kcal: 2730 },
    compliance: { overall: 80, band: { word: 'on target' },
      macros: { per_macro: { carbs_g: { actual: 266, target: 295 }, protein_g: { actual: 162, target: 187 }, fat_g: { actual: 89, target: 89 } } },
      guidelines: { checks: [{ label: 'protein at the main meals', ok: true }, { label: 'starch where the plan puts it', ok: false }] } },
    entries: [
      { time: '09:10', slot: 'breakfast', name: 'Breakfast: two fried eggs', portion: '2 large eggs', kcal: 190, carbs_g: 1, protein_g: 13 },
      { time: '10:31', slot: 'breakfast', name: 'Water, 1000 ml', kcal: 0, drink_only: true },
      { time: '13:12', slot: 'lunch', name: 'Lunch: teriyaki chicken with almonds, fried rice and broccoli', kcal: 790, carbs_g: 83, protein_g: 47 },
      { time: '19:02', slot: 'dinner', name: 'Dinner: salmon sashimi, rolls, rice and edamame', kcal: 1410, carbs_g: 175, protein_g: 78 }
    ] },
  cal: { compliance: { pct: 98 }, planned: [{ name: 'Z1 trainer 90 min' }], done: [{ name: 'Z1 trainer 90 min', type: 'VirtualRide', time: '16:04', minutes: 86, tss: 56, avg_hr: 98 }] },
  lifts: [{ name: 'Push', volume_lb: 5406 }], night: { hours: 5.28, score: 61 }, rec: { score: 67, hrv: 27.5 }, lb: 217.4
};

ok('a day\'s row: the meals by name with their numbers (no water), the score and what it missed, the ride with the meal before it, the lift, sleep, weight', () => {
  const r = H.rowOf(monday);
  assert.strictEqual(r.dow, 'Mon'); assert.strictEqual(r.food.score, 80); assert.deepStrictEqual(r.food.missed, ['starch where the plan puts it']);
  assert.deepStrictEqual(r.meals.map(m => m.name), ['two fried eggs', 'teriyaki chicken with almonds, fried rice and broccoli', 'salmon sashimi, rolls, rice and edamame']);
  const ride = r.done.find(d => d.kind === 'ride');
  assert.strictEqual(ride.before.name, 'teriyaki chicken with almonds, fried rice and broccoli'); assert.strictEqual(ride.before.min_before, 172); assert.strictEqual(ride.before.c, 83);
  assert.ok(r.done.some(d => d.kind === 'lift' && d.volume_lb === 5406));
  assert.strictEqual(r.sleep_h, 5.3); assert.strictEqual(r.recovery, 67); assert.strictEqual(r.lb, 217.4); assert.strictEqual(r.plan_pct, 98);
  const l = H.line(r);
  assert.ok(/^Mon Nov 9: food 80 \(2550 of 2730 kcal, protein 162\/187 g/.test(l), l);
  assert.ok(/lunch teriyaki chicken with almonds, fried rice and broccoli \(790 kcal, 83C 47P, 1:12p\)/.test(l), l);
  assert.ok(/172 min after teriyaki chicken/.test(l) && /Push lift \(5406 lb moved\)/.test(l) && /slept 5\.3 h \(score 61\)/.test(l), l);
});
ok('a day with nothing logged says so; a planned session not done is named', () => {
  const r = H.rowOf({ date: '2026-11-08', report: { entries: [] }, cal: { planned: [{ name: 'Zone 1, 60 min' }], done: [] } });
  assert.strictEqual(r.food, null); const l = H.line(r);
  assert.ok(/no food logged/.test(l) && /planned but not done: Zone 1, 60 min/.test(l), l);
});

// a fortnight: good days eat a real breakfast early and ride within a meal's reach; bad days do not
const mk = (date, score, o) => H.rowOf({ date,
  report: { actual: { kcal: 2400 }, target: { kcal: 2500 }, compliance: { overall: score, macros: { per_macro: { protein_g: { actual: o.p || 150, target: 187 }, carbs_g: { actual: 250, target: 280 } } }, guidelines: { checks: [] } },
    entries: [{ time: o.bfAt || '07:30', slot: 'breakfast', name: o.bf || 'Breakfast: eggs and oats', kcal: 450, carbs_g: 40, protein_g: o.bfP != null ? o.bfP : 35 }, { time: '12:30', slot: 'lunch', name: 'Lunch: chicken and rice', kcal: 700, carbs_g: o.lunchC != null ? o.lunchC : 70, protein_g: 45 }] },
  cal: o.ride ? { compliance: { pct: o.pct }, done: [{ name: 'Zone 1, 60 min', type: 'Ride', time: o.ride, minutes: 60, tss: 40 }] } : {},
  night: { hours: o.sleep || 7.2 }, lb: o.lb });
const rows = [
  mk('2026-11-01', 82, { ride: '13:45', pct: 100, lb: 218 }), mk('2026-11-02', 85, { ride: '14:00', pct: 96, lb: 217.8 }), mk('2026-11-03', 78, { ride: '13:30', pct: 100 }),
  mk('2026-11-04', 55, { bfP: 12, bfAt: '10:15', ride: '17:30', pct: 60, sleep: 5.9 }), mk('2026-11-05', 48, { bfP: 10, bfAt: '10:40', ride: '18:00', pct: 55, sleep: 6.1 }),
  mk('2026-11-10', 88, { ride: '13:40', pct: 104, lb: 216.2 }), mk('2026-11-11', 52, { bfP: 8, bfAt: '09:50', sleep: 6.0, lb: 216 })
];
ok('patterns: his best food days first with their meals, the habits each with its count, the trends', () => {
  const P = H.patterns(rows, '2026-11-12');
  assert.deepStrictEqual(P.best_food_days.map(b => b.score), [88, 85, 82, 78]);
  assert.ok(P.best_food_days[0].meals.some(m => m.name === 'eggs and oats'));
  const bf = P.food_habits.find(p => /30 g protein or more/.test(p[0].label));
  assert.deepStrictEqual([bf[0].n, bf[0].mean, bf[1].n, bf[1].mean], [4, 83, 3, 52]);
  const gap = P.ride_habits.find(p => /within 90 min of eating/.test(p[0].label));
  assert.deepStrictEqual(gap.map(g => [g.n, g.mean]), [[3, 101], [1, 96], [2, 58]], JSON.stringify(gap));   // the two fasted-late rides fell short
  const late = P.ride_habits.find(p => p.some(g => /after 3 p\.m\./.test(g.label))).find(g => /after 3 p\.m\./.test(g.label));
  assert.deepStrictEqual([late.n, late.mean], [2, 58]);
  assert.ok(P.trends.find(t => t.label === 'food score').last7 != null);
  // today's own row is never part of the look back
  assert.strictEqual(H.patterns(rows, '2026-11-11').days, 6);
});
ok('the digest the coach always has: days newest first, the best days as the model, habits and trends in words', () => {
  const t = H.digestText(rows, '2026-11-12', 14);
  const lines = t.split('\n');
  assert.ok(/^LOOK BACK: his last 7 days/.test(lines[0]), lines[0]); assert.ok(/^Wed Nov 11:/.test(lines[1]), lines[1]);
  assert.ok(/HIS BEST FOOD DAYS.*Tue Nov 10 scored 88.*breakfast eggs and oats/.test(t), t.slice(-900));
  assert.ok(/FOOD HABITS.*breakfast with 30 g protein or more: 83 \(4 days\) vs breakfast under 30 g protein: 52 \(3 days\)/.test(t));
  assert.ok(/RIDE HABITS/.test(t) && /TRENDS/.test(t));
  assert.strictEqual(H.digestText([], '2026-11-12'), '');
});
ok('week by week: each Monday-to-Sunday week rolled up, oldest first, and in the digest', () => {
  const W = H.weeks(rows, '2026-11-12');
  assert.deepStrictEqual(W.map(w => w.week_of), ['2026-10-26', '2026-11-02', '2026-11-09']);
  const w2 = W[1];   // Mon 2 Nov to Thu 5 Nov: 85, 78, 55, 48
  assert.deepStrictEqual([w2.food_days, w2.food_score, w2.good_food_days, w2.rides, w2.ride_min], [4, 67, 2, 4, 240]);
  assert.ok(/WEEK BY WEEK.*week of Nov 2: food 67 over 4 days \(2 good\).*4 rides 240 min/.test(H.digestText(rows, '2026-11-12', 14)));
});
console.log(n + ' passed');
