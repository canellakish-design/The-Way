// node bridge/lifts.test.js
const assert = require('assert');
const L = require('./lifts');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const push = L.TEMPLATES.find(t => t.key === 'push');
const chest = push.exercises[0], floor = push.exercises[2], pushdown = push.exercises[3];
const core = L.TEMPLATES.find(t => t.key === 'upper-1').exercises[3];

ok('five workouts in the book\'s order, nine to twelve hard sets each, 4 to 6 on the big lifts', () => {
  assert.deepStrictEqual(L.TEMPLATES.map(t => t.key), ['push', 'pull', 'upper-1', 'legs', 'upper-2']);
  for (const t of L.TEMPLATES) {
    const hard = t.exercises.reduce((a, e) => a + e.sets, 0);
    assert.ok(hard >= 9 && hard <= 12, t.key + ' ' + hard);
    assert.ok(t.exercises[0].reps_hi === 6, t.key + ' first lift is heavy');
  }
});
ok('first time: start at the bottom of the range', () => {
  const t = L.target(chest, null);
  assert.strictEqual(t.lb, 110); assert.strictEqual(t.reps, 4); assert.strictEqual(t.progress, false);
});
ok('Matthews: a set at the top of the range adds weight (ten on the Bowflex, the next bell, five on a small lift)', () => {
  const up = L.target(chest, { sets: [{ reps: 6, lb: 110 }, { reps: 5, lb: 110 }, { reps: 4, lb: 110 }] });
  assert.strictEqual(up.lb, 120); assert.strictEqual(up.reps, 4); assert.strictEqual(up.progress, true);
  const bell = L.target(floor, { sets: [{ reps: 6, lb: 44 }, { reps: 4, lb: 44 }, { reps: 4, lb: 44 }] });
  assert.strictEqual(bell.lb, 53);
  const small = L.target(pushdown, { sets: [{ reps: 8, lb: 50 }, { reps: 7, lb: 50 }, { reps: 6, lb: 50 }] });
  assert.strictEqual(small.lb, 55);
  const hold = L.target(chest, { sets: [{ reps: 5, lb: 110 }, { reps: 5, lb: 110 }, { reps: 4, lb: 110 }] });
  assert.strictEqual(hold.lb, 110); assert.strictEqual(hold.reps, 5); assert.strictEqual(hold.progress, false);
});
ok('a set under the bottom of the range takes the weight back a step', () => {
  const back = L.target(chest, { sets: [{ reps: 4, lb: 120 }, { reps: 3, lb: 120 }, { reps: 3, lb: 120 }] });
  assert.strictEqual(back.lb, 110); assert.strictEqual(back.back, true);
  assert.strictEqual(L.prevBell(53), 44); assert.strictEqual(L.nextBell(88), 98);
});
ok('core work progresses in reps', () => {
  const p = L.target(core, { sets: [{ reps: 15, lb: 0 }, { reps: 15, lb: 0 }, { reps: 15, lb: 0 }] });
  assert.strictEqual(p.reps, 17); assert.strictEqual(p.lb, 0);
  assert.strictEqual(L.e1rm(100, 10), 133); assert.strictEqual(L.e1rm(0, 10), null);
});
ok('the week: legs the day before a day off the bike or a long coaching day; no lift on the two biggest rides; pull a day clear of legs', () => {
  const ride = (name, minutes, tss) => ({ name, minutes, tss, hard: /vo2|40\s*\/\s*20|threshold/i.test(name) });
  const days = [
    { date: '2026-11-02', ride: ride('Z1 trainer 90 min', 90, 59), coaching_min: 0, long_coaching: false },      // Mon
    { date: '2026-11-03', ride: ride('VO2 max: Zwift 40/20s #1', 50, 55), coaching_min: 0, long_coaching: false }, // Tue, hard
    { date: '2026-11-04', ride: null, coaching_min: 0, long_coaching: false },                                       // Wed, off the bike
    { date: '2026-11-05', ride: ride('Z1 trainer 60 min', 60, 40), coaching_min: 300, long_coaching: true },      // Thu, long coaching
    { date: '2026-11-06', ride: ride('Z1 trainer 60 min', 60, 40), coaching_min: 90, long_coaching: false },      // Fri
    { date: '2026-11-07', ride: ride('Long ride', 180, 150), coaching_min: 0, long_coaching: false },              // Sat, biggest
    { date: '2026-11-08', ride: null, coaching_min: 0, long_coaching: false }                                        // Sun, off
  ];
  const w = L.placeWeek(days);
  const by = Object.fromEntries(w.map(x => [x.date, x.lift]));
  assert.strictEqual(by['2026-11-04'], 'legs', JSON.stringify(by));       // Wednesday: off the bike, and the day before the long coaching Thursday
  assert.strictEqual(by['2026-11-03'], null); assert.strictEqual(by['2026-11-07'], null);   // the 40/20s and the long ride carry no lift
  assert.notStrictEqual(by['2026-11-05'], 'pull');                          // deadlift not the day after the Romanian deadlift
  assert.strictEqual(w.filter(x => x.lift).length, 5);
  assert.deepStrictEqual(w.filter(x => x.lift).map(x => x.lift).sort(), ['legs', 'pull', 'push', 'upper-1', 'upper-2']);
  assert.ok(/day before a long coaching day/.test(w[2].why), w[2].why);
  // a legs session already logged holds its day
  const w2 = L.placeWeek(days.map(x => x.date === '2026-11-06' ? Object.assign({}, x, { locked: 'legs' }) : x), { done: { '2026-11-06': 'legs' } });
  assert.strictEqual(w2.find(x => x.date === '2026-11-06').lift, 'legs');
  assert.strictEqual(w2.filter(x => x.lift === 'legs').length, 1);
});
ok('periodization: 27 weeks in three blocks with deloads; weights climb from the start, block 2 lighter and two reps higher, block 3 above block 1', () => {
  const P = L.periodization(L.TEMPLATES, [], '2026-11-02');
  const push = P.templates.find(t => t.key === 'push');
  assert.strictEqual(push.rows.length, 27);
  assert.strictEqual(push.rows.filter(r => r.deload).length, 3);
  const chest = w => push.rows[w - 1].targets.find(t => t.name === 'Bowflex chest press');
  assert.strictEqual(chest(1).lb, 110); assert.ok(chest(8).lb > chest(1).lb, 'climbs');
  assert.strictEqual(chest(10).reps_lo, 6); assert.strictEqual(chest(10).reps_hi, 8);          // block 2: two reps higher
  assert.ok(chest(10).lb < chest(8).lb, 'block 2 starts lighter');
  assert.ok(chest(19).lb > chest(8).lb, 'block 3 climbs from block 1\'s end'); assert.strictEqual(chest(19).reps_lo, 4);
  assert.strictEqual(push.rows[8].deload, true); assert.ok(push.rows[8].targets[0].half_sets);
  // a logged session moves the starting point
  const P2 = L.periodization(L.TEMPLATES, [{ date: '2026-11-02', template: 'push', exercises: [{ name: 'Bowflex chest press', sets: [{ reps: 6, lb: 130 }, { reps: 5, lb: 130 }, { reps: 5, lb: 130 }] }] }], '2026-11-03');
  const c2 = P2.templates.find(t => t.key === 'push').rows[0].targets.find(t => t.name === 'Bowflex chest press');
  assert.strictEqual(c2.lb, 140);
  assert.strictEqual(P2.week_now, 1);
});
console.log(n + ' passed');
