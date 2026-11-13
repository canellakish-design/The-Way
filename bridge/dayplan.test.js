// node bridge/dayplan.test.js
const assert = require('assert');
const D = require('./dayplan');
const F = require('./food-math');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const m = (h, mi) => h * 60 + (mi || 0);
// Friday 13 Nov as it was: the drive, Cycle 3 Planning on top of it, the game (arrive by 12:00), the drive home, the ride
const row = (summary, category, s, e, o) => Object.assign({ summary, category, start_min: s, end_min: e, allDay: false }, o || {});
const friday = () => [
  row('Upper body and core (Upper 1)', 'training', m(7, 30), m(8, 20), { workout_id: 'w1' }),
  row('Drive to Maryland SoccerPlex · 63 min', 'commute', m(10, 57), m(12)),
  row('Cycle 3 Planning', 'busy', m(11, 15), m(12, 45)),
  row('Coaching · Bethesda Premier Cup: U18 ECNL vs VDA (Field 8)', 'coaching', m(13), m(14, 45), { description: 'Arrive by 12:00 PM. Kickoff 1:00 PM.' }),
  row('Drive home · 73 min', 'commute', m(15), m(16, 13)),
  row('Z1 trainer 90 min', 'training', m(16, 15), m(17, 45), { workout_id: 'w2' })
];

ok('the blocks: coaching counts from its "Arrive by" time', () => {
  const b = D.blocksOf(friday(), { categories: D.FIXED });
  assert.deepStrictEqual(b.map(x => [x.start, x.end]), [[m(10, 57), m(12)], [m(12), m(14, 45)], [m(15), m(16, 13)]]);
});
ok('his own block over the drive and the game: marked, with the nearest free hour and a half that fits', () => {
  const rows = D.markClashes(friday(), { wake: 390, bed: 1350 });
  const plan = rows.find(r => r.summary === 'Cycle 3 Planning');
  assert.ok(plan.clash && /Drive to Maryland SoccerPlex/.test(plan.clash.with), JSON.stringify(plan.clash));
  assert.strictEqual(plan.clash.fix_min, m(10, 57) - 90, 'just before he leaves: 9:27');
  assert.ok(!rows.find(r => r.category === 'commute').clash, 'the drive is fixed: it is not the one to move');
  assert.ok(rows.find(r => r.category === 'commute').clash_by);
  assert.ok(!rows.find(r => r.workout_id === 'w2').clash, 'the ride starts after the drive home: no clash');
});
ok('a ride over a concert moves, and two fixed things both get the mark with no fix', () => {
  const sat = [row('Pull and calves', 'training', m(17, 15), m(18, 10)), row('Z1 60 min · Life Time bike', 'training', m(18, 15), m(19, 15), { workout_id: 'w3' }),
    row('Dance Concert', 'work', m(19), m(21))];
  D.markClashes(sat, { wake: 390, bed: 1350 });
  const ride = sat[1];
  assert.strictEqual(ride.clash.with, 'Dance Concert');
  assert.strictEqual(ride.clash.fix_min, m(16, 15), 'before Pull, the nearest hour that touches nothing');
  const two = [row('Class', 'work', m(9), m(10)), row('Meeting', 'coaching', m(9, 30), m(10, 30))];
  D.markClashes(two, null);
  assert.ok(two[0].clash.both_fixed && two[1].clash.both_fixed && two[0].clash.fix_min === null);
});
ok('a dose inside a block: just before the stretch, else just after', () => {
  const b = D.blocksOf(friday(), { categories: D.FIXED });
  const p = D.placeDose(m(13, 45), 10, b, 390);                // beetroot at 1:45, mid-game
  assert.strictEqual(p.moved, true); assert.strictEqual(p.min, m(10, 57) - 15); assert.ok(/before Drive to Maryland SoccerPlex/.test(p.why), p.why);
  assert.strictEqual(D.placeDose(m(9), 10, b, 390).moved, false);
  const early = D.placeDose(m(6, 50), 10, [{ start: m(6, 30), end: m(8), name: 'Drive to McDonogh' }], m(6, 30));
  assert.strictEqual(early.min, m(8, 10)); assert.ok(/after/.test(early.why));
});
ok('every meal out of the blocks: lunch during the game goes before he leaves, at least an hour and a quarter after breakfast', () => {
  const busy = D.blocksOf(friday(), { categories: new Set(['commute', 'coaching', 'busy']) }).concat([{ start: m(16, 15), end: m(17, 45), name: 'Z1 trainer' }]);
  const meals = [
    { time: '09:00', slot: 'breakfast', kcal: 265, carbs_g: 15, protein_g: 10 },
    { time: '13:00', slot: 'lunch', kcal: 665, carbs_g: 95, protein_g: 50 },
    { time: '18:30', slot: 'dinner', kcal: 700, carbs_g: 60, protein_g: 50 }
  ];
  const r = F.placeSnacks(meals, { busy, wake: 390, bed: 1350 });
  const lunch = r.find(x => x.slot === 'lunch');
  assert.strictEqual(lunch.time, '10:27', JSON.stringify(lunch));   // half an hour before he leaves at 10:57
  assert.ok(/Before Drive to Maryland SoccerPlex/.test(lunch.what), lunch.what);
  assert.strictEqual(r.find(x => x.slot === 'dinner').time, '18:30', 'dinner was free: it stays');
  const nothing = F.placeSnacks(meals, { busy: [], wake: 390, bed: 1350 });
  assert.strictEqual(nothing.find(x => x.slot === 'lunch').time, '13:00');
});
console.log(n + ' passed');
