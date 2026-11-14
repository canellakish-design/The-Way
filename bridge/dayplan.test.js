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
  // the ride starts two minutes after the drive home ends: too tight to change, moved to 15 minutes after it
  const ride = rows.find(r => r.workout_id === 'w2');
  assert.ok(ride.clash && ride.clash.tight && ride.clash.need === 15 && ride.clash.side === 'after', JSON.stringify(ride.clash));
  assert.strictEqual(ride.clash.fix_min, m(16, 28));
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
ok('changeover: into a workout 15 minutes, out of one 20, none between two of a kind', () => {
  assert.strictEqual(D.changeover({ category: 'commute' }, { category: 'training' }), 15);
  assert.strictEqual(D.changeover({ category: 'training' }, { category: 'coaching' }), 20);
  assert.strictEqual(D.changeover({ category: 'work' }, { category: 'work' }), 0);
  assert.strictEqual(D.changeover({ category: 'commute' }, { category: 'coaching' }), 0, 'the drive arrives by the arrival time');
  const rows = [row('Practice', 'coaching', m(17, 30), m(19)), row('Z1 60', 'training', m(16, 20), m(17, 20), { workout_id: 'w' })];
  D.markClashes(rows, { wake: 390, bed: 1350 });
  assert.ok(rows[1].clash.tight && rows[1].clash.side === 'before' && rows[1].clash.need === 20, JSON.stringify(rows[1].clash));
  assert.strictEqual(rows[1].clash.fix_min, m(16, 10), 'done by 5:10: 20 minutes to shower before practice');
});
ok('lunch on a game day away: eaten at the field before warm-ups (packed), not after the ride', () => {
  const evs = friday().map(r => Object.assign({}, r));
  evs.splice(2, 1, row('Cycle 3 Planning', 'busy', m(9, 27), m(10, 57)));   // moved before the drive
  const busy = D.blocksOf(evs, { eat: true, categories: new Set(['coaching', 'work', 'travel', 'commute']) })
    .map(b => Object.assign(b, { name: b.name.replace(/ · \d+ min.*$/, '') })).concat([{ start: m(16, 15), end: m(17, 45), name: 'Z1 trainer' }]);
  const r = F.placeSnacks([{ time: '08:55', slot: 'breakfast', kcal: 370 }, { time: '13:00', slot: 'lunch', kcal: 665 }, { time: '18:30', slot: 'dinner', kcal: 900 }], { busy, wake: 390, bed: 1350 });
  const lunch = r.find(x => x.slot === 'lunch');
  assert.strictEqual(lunch.time, '12:00', JSON.stringify(lunch));
  assert.ok(/^Pack it: at Maryland SoccerPlex, before .*VDA/.test(lunch.what), lunch.what);
});
ok('a school day: lunch is the dining hall, between classes, never packed', () => {
  const busy = [{ start: m(7, 25), end: m(8, 15), name: 'Drive to McDonogh', category: 'commute' },
    { start: m(8, 30), end: m(9, 30), name: 'World History I (Sec. E1)', category: 'work' }, { start: m(10, 25), end: m(11, 25), name: 'World History I (Sec. F2)', category: 'work' },
    { start: m(12, 50), end: m(13, 50), name: 'World History I (Sec. G1)', category: 'work' }, { start: m(14, 5), end: m(14, 55), name: 'Drive home', category: 'commute' }];
  const r = F.placeSnacks([{ time: '06:45', slot: 'breakfast', kcal: 400 }, { time: '13:00', slot: 'lunch', kcal: 650 }, { time: '18:30', slot: 'dinner', kcal: 800 }], { busy, wake: 390, bed: 1350 });
  const lunch = r.find(x => x.slot === 'lunch');
  assert.ok(lunch.time >= '11:25' && lunch.time < '12:50', lunch.time);
  assert.ok(/In the dining hall at school\.$/.test(lunch.what) && !/Pack it/.test(lunch.what), lunch.what);
  assert.ok(!/dining hall/.test(r.find(x => x.slot === 'dinner').what || ''), 'dinner is at home');
});
ok('practice, then a meeting until ten: dinner is packed between them, and the snack is never left inside the meeting', () => {
  const busy = [{ start: m(17, 17), end: m(17, 45), name: 'Drive to Liberty Sports Park', category: 'commute' },
    { start: m(17, 30), end: m(19, 15), name: 'Practice', category: 'coaching' }, { start: m(20, 30), end: m(22), name: 'Staff Meeting (in person)', category: 'work' },
    { start: m(22, 15), end: m(22, 35), name: 'Drive home', category: 'commute' }];
  const r = F.placeSnacks([{ time: '13:05', slot: 'lunch', kcal: 650 }, { time: '18:30', slot: 'dinner', kcal: 800, what: 'Protein and vegetables.' }, { time: '20:45', slot: 'snack', kcal: 240, what: 'A Huel shake.' }], { busy, wake: 390, bed: 1350 });
  const dinner = r.find(x => x.slot === 'dinner'), snack = r.find(x => x.slot === 'snack');
  assert.strictEqual(dinner.time, '19:15'); assert.ok(/Pack it: at Liberty Sports Park/.test(dinner.what), dinner.what);
  const t = F.toMin(snack.time);
  assert.ok(!busy.some(b => t < b.end && t + 30 > b.start), 'the snack at ' + snack.time + ' is clear of everything');
  assert.ok(t >= m(19, 45) && t <= m(20), snack.time);
});
ok('the meal before a session stays before it: moved earlier when the ride moves, folded into lunch when there is no room', () => {
  const sessions = [{ start: m(15, 15), end: m(16, 10), name: 'Pull', kind: 'lift' }, { start: m(16, 15), end: m(17, 15), name: 'Z1 60 min', kind: 'easy' }];
  const busy = [{ start: m(12, 30), end: m(13, 36), name: 'Drive home' }].concat(sessions.map(x => ({ start: x.start, end: x.end, name: x.name })));
  const plan = () => [{ time: '13:00', slot: 'lunch', kcal: 670, carbs_g: 95, protein_g: 50, what: 'Rice and chicken.' }, { time: '14:15', slot: 'before', kcal: 250, carbs_g: 25, protein_g: 20, what: 'Something light.' }, { time: '18:30', slot: 'dinner', kcal: 900 }];
  const r = F.placeSnacks(plan(), { busy, sessions, wake: 390, bed: 1350 });
  const pre = r.find(x => x.slot === 'before');
  assert.ok(pre && F.toMin(pre.time) >= m(14, 6) && F.toMin(pre.time) + 30 <= m(15, 15), pre && pre.time);
  // no room at all between lunch and the lift: it folds into lunch
  const tight = F.placeSnacks(plan(), { busy: busy.concat([{ start: m(13, 40), end: m(15, 15), name: 'Meeting' }]), sessions, wake: 390, bed: 1350 });
  assert.ok(!tight.some(x => x.slot === 'before'), 'no pre-ride snack after the ride');
  const lunch = tight.find(x => x.slot === 'lunch');
  assert.strictEqual(lunch.kcal, 920); assert.ok(/also the fuel for Pull/.test(lunch.what), lunch.what);
});
console.log(n + ' passed');

