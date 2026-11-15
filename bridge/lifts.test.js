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
  assert.strictEqual(t.lb, 135); assert.strictEqual(t.reps, 4); assert.strictEqual(t.progress, false);
});
ok('Matthews: a set at the top of the range adds weight (ten on the bar, five on a dumbbell or a small lift, the next bell at home)', () => {
  const up = L.target(chest, { sets: [{ reps: 6, lb: 135 }, { reps: 5, lb: 135 }, { reps: 4, lb: 135 }] });
  assert.strictEqual(up.lb, 145); assert.strictEqual(up.reps, 4); assert.strictEqual(up.progress, true);
  const db = L.target(floor, { sets: [{ reps: 6, lb: 50 }, { reps: 4, lb: 50 }, { reps: 4, lb: 50 }] });
  assert.strictEqual(db.lb, 55);
  const small = L.target(pushdown, { sets: [{ reps: 8, lb: 50 }, { reps: 7, lb: 50 }, { reps: 6, lb: 50 }] });
  assert.strictEqual(small.lb, 55);
  const bell = L.target(L.PUMP.exercises[2], { sets: [{ reps: 15, lb: 26 }, { reps: 12, lb: 26 }] });
  assert.strictEqual(bell.lb, 35);
  const hold = L.target(chest, { sets: [{ reps: 5, lb: 135 }, { reps: 5, lb: 135 }, { reps: 4, lb: 135 }] });
  assert.strictEqual(hold.lb, 135); assert.strictEqual(hold.reps, 5); assert.strictEqual(hold.progress, false);
});
ok('a set under the bottom of the range takes the weight back a step', () => {
  const back = L.target(chest, { sets: [{ reps: 4, lb: 145 }, { reps: 3, lb: 145 }, { reps: 3, lb: 145 }] });
  assert.strictEqual(back.lb, 135); assert.strictEqual(back.back, true);
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
  const chest = w => push.rows[w - 1].targets.find(t => t.name === 'Barbell bench press');
  assert.strictEqual(chest(1).lb, 135); assert.ok(chest(8).lb > chest(1).lb, 'climbs');
  assert.strictEqual(chest(10).reps_lo, 6); assert.strictEqual(chest(10).reps_hi, 8);          // block 2: two reps higher
  assert.ok(chest(10).lb < chest(8).lb, 'block 2 starts lighter');
  assert.ok(chest(19).lb > chest(8).lb, 'block 3 climbs from block 1\'s end'); assert.strictEqual(chest(19).reps_lo, 4);
  assert.strictEqual(push.rows[8].deload, true); assert.ok(push.rows[8].targets[0].half_sets);
  // a logged session moves the starting point
  const P2 = L.periodization(L.TEMPLATES, [{ date: '2026-11-02', template: 'push', exercises: [{ name: 'Barbell bench press', sets: [{ reps: 6, lb: 155 }, { reps: 5, lb: 155 }, { reps: 5, lb: 155 }] }] }], '2026-11-03');
  const c2 = P2.templates.find(t => t.key === 'push').rows[0].targets.find(t => t.name === 'Barbell bench press');
  assert.strictEqual(c2.lb, 165);
  assert.strictEqual(P2.week_now, 1);
});
ok('the week\'s count: one rule for the Day box and the Lift page, "1 of 1 due" on day one, "of 5" after the first week', () => {
  const s = (date, template) => ({ date, template, exercises: [] });
  const day1 = L.weekCount([s('2026-11-02', 'push')], '2026-11-02');
  assert.strictEqual(day1.sessions, 1); assert.strictEqual(day1.of, 1); assert.strictEqual(day1.first_week, true); assert.strictEqual(day1.word, '1 of 1 due');
  const day3 = L.weekCount([s('2026-11-02', 'push')], '2026-11-04');
  assert.strictEqual(day3.of, 3); assert.strictEqual(day3.word, '1 of 3 due');
  const wk2 = L.weekCount([s('2026-11-02', 'push'), s('2026-11-09', 'pull'), s('2026-11-10', 'pump')], '2026-11-10');
  assert.strictEqual(wk2.first_week, false); assert.strictEqual(wk2.of, 5); assert.strictEqual(wk2.word, '1 of 5');   // Nov 2 has left the seven days
  assert.strictEqual(wk2.pumps, 1); assert.strictEqual(wk2.week_no, 2);
  const none = L.weekCount([], '2026-11-02');
  assert.strictEqual(none.started, false); assert.strictEqual(none.word, '0 of 5');
});
ok('a calendar name to its session: the two upper days by their bracket, Pull by its short name', () => {
  assert.strictEqual(L.templateOf('Push'), 'push');
  assert.strictEqual(L.templateOf('Pull'), 'pull');
  assert.strictEqual(L.templateOf('Pull and calves'), 'pull');
  assert.strictEqual(L.templateOf('Upper body and core (Upper 2)'), 'upper-2');
  assert.strictEqual(L.templateOf('Upper body and core (Upper 1)'), 'upper-1');
  assert.strictEqual(L.templateOf('Legs'), 'legs');
  assert.strictEqual(L.templateOf('Zone 1, 60 min'), null);
});
ok('the strip mirrors the calendar: a day with Push done and Pull planned keeps both; Pull is not placed again; an empty day is only a suggestion', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'].map(date => ({ date, ride: null, coaching_min: 0, long_coaching: false }));
  days[0].locks = ['push', 'pull']; days[0].locked = 'push';
  days[3].locks = ['legs']; days[3].locked = 'legs';
  const w = L.placeWeek(days, { done: { '2026-11-02': 'push' } });
  assert.strictEqual(w[0].lift, 'push'); assert.deepStrictEqual(w[0].lifts, ['push', 'pull']); assert.strictEqual(w[0].on_calendar, true);
  assert.strictEqual(w.filter(x => x.lift === 'pull').length, 0, 'pull is held on Monday, not placed on another day');
  assert.strictEqual(w.filter(x => x.lift === 'push').length, 1);
  assert.strictEqual(w[3].lift, 'legs'); assert.strictEqual(w[3].suggested, false);
  for (const x of w.filter(x => x.lift && !x.on_calendar)) assert.strictEqual(x.suggested, true);
  assert.ok(w.some(x => x.suggested), 'the rest are suggestions');
});
ok('a session lifted in the six days before the window is not placed again inside it (Push on Monday, Tuesday\'s window)', () => {
  const days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map(date => ({ date, ride: null, coaching_min: 0, long_coaching: false }));
  days[0].ride = { name: 'VO2 4 × 4 min', minutes: 40, tss: 52, hard: true };
  days[1].locks = ['legs']; days[1].locked = 'legs';
  const w = L.placeWeek(days, { recent: { push: '2026-11-09' } });
  assert.strictEqual(w.filter(x => x.lift === 'push').length, 0, JSON.stringify(w.map(x => x.lift)));
  assert.deepStrictEqual(w.filter(x => x.lift).map(x => x.lift).sort(), ['legs', 'pull', 'upper-1', 'upper-2']);
  assert.ok(w.some(x => /Push was done/.test(x.why)), w.map(x => x.why).join(' | '));
  // without the recent Push, it is placed as before
  assert.strictEqual(L.placeWeek(days).filter(x => x.lift === 'push').length, 1);
});
ok('legs sit two to three days before the VO2 session and never the day before one; the two upper days are not back to back', () => {
  const ride = (name, minutes, tss) => ({ name, minutes, tss, hard: /vo2|40\s*\/\s*20|threshold/i.test(name) });
  // Harry's week of 16 Nov: Monday a rest day (three classes), VO2 on Tuesday and Friday, the long ride Saturday
  const days = [
    { date: '2026-11-16', ride: null, coaching_min: 0, long_coaching: false, rest: 'three classes' },                 // Mon
    { date: '2026-11-17', ride: ride('VO2 40/20s', 51, 55), coaching_min: 90, long_coaching: false },                // Tue, hard
    { date: '2026-11-18', ride: ride('Z1 trainer 75 min', 75, 48), coaching_min: 0, long_coaching: false },           // Wed
    { date: '2026-11-19', ride: ride('Z1 trainer 60 min', 60, 40), coaching_min: 0, long_coaching: false },           // Thu
    { date: '2026-11-20', ride: ride('VO2 40/20s', 51, 55), coaching_min: 0, long_coaching: false },                 // Fri, hard
    { date: '2026-11-21', ride: ride('Z1 road 150 min', 150, 100), coaching_min: 0, long_coaching: false },           // Sat, biggest
    { date: '2026-11-22', ride: ride('Z1 trainer 60 min', 60, 40), coaching_min: 0, long_coaching: false }            // Sun
  ];
  const w = L.placeWeek(days), by = Object.fromEntries(w.map(x => [x.date, x.lift]));
  // Wednesday: two days before Friday's VO2, a day after Tuesday's; not Thursday (the day before the VO2)
  assert.strictEqual(by['2026-11-18'], 'legs', JSON.stringify(by));
  assert.ok(/two days before VO2 40\/20s/.test(w[2].why), w[2].why);
  assert.notStrictEqual(by['2026-11-19'], 'pull', 'no deadlifts the day before the VO2');
  assert.strictEqual(by['2026-11-16'], null, 'the rest day carries nothing');
  const u1 = w.findIndex(x => x.lift === 'upper-1'), u2 = w.findIndex(x => x.lift === 'upper-2');
  if (u1 >= 0 && u2 >= 0) assert.ok(Math.abs(u1 - u2) > 1, JSON.stringify(by));
  // an upper day already on the calendar: the other upper is not put beside it
  const locked = days.map(x => x.date === '2026-11-19' ? Object.assign({}, x, { locked: 'upper-1' }) : x);
  const w2 = L.placeWeek(locked), b2 = Object.fromEntries(w2.map(x => [x.date, x.lift]));
  assert.notStrictEqual(b2['2026-11-18'], 'upper-2', JSON.stringify(b2)); assert.notStrictEqual(b2['2026-11-20'], 'upper-2', JSON.stringify(b2));
  // legs the day before a VO2 is never chosen while any other day is open
  for (const x of L.placeWeek(days)) if (x.lift === 'legs') { const nx = days[days.findIndex(y => y.date === x.date) + 1]; assert.ok(!(nx && nx.ride && nx.ride.hard), x.date); }
});
ok('legs on a hard-ride day only when nothing else is open; the deadlift day counts when it is on the calendar or just done', () => {
  const ride = (name, minutes, tss) => ({ name, minutes, tss, hard: L.HARD.test(name) });
  // VO2 on Tuesday and Thursday (the week the old rule put Legs on the Tuesday itself: the 60 for a hard day lost to the 70)
  const days = [
    { date: '2026-11-16', ride: null, coaching_min: 0, long_coaching: false, rest: 'three classes' },
    { date: '2026-11-17', ride: ride('VO2 40/20s', 51, 55), coaching_min: 0, long_coaching: false },
    { date: '2026-11-18', ride: ride('Z1 trainer 75 min', 75, 48), coaching_min: 0, long_coaching: false },
    { date: '2026-11-19', ride: ride('VO2 4 x 4 min', 60, 62), coaching_min: 0, long_coaching: false },
    { date: '2026-11-20', ride: ride('Z1 trainer 60 min', 60, 40), coaching_min: 0, long_coaching: false },
    { date: '2026-11-21', ride: ride('Z1 road 150 min', 150, 100), coaching_min: 0, long_coaching: false },
    { date: '2026-11-22', ride: ride('Z1 trainer 60 min', 60, 40), coaching_min: 0, long_coaching: false }
  ];
  const w = L.placeWeek(days), legs = w.find(x => x.lift === 'legs');
  assert.ok(legs && !legs.ride.hard, 'not on a VO2 day: ' + legs.date);
  assert.notStrictEqual(legs.date, '2026-11-18', 'nor the day before one');
  // the deadlift day beside it: with days otherwise alike, Legs is not the day after a Pull just done, nor beside one on the calendar
  const easy = k => ({ date: `2026-12-0${k}`, ride: ride('Z1 trainer 60 min', 60, 40), coaching_min: 0, long_coaching: false });
  const alike = [1, 2, 3, 4, 5].map(easy);
  assert.strictEqual(L.placeWeek(alike).find(x => x.lift === 'legs').date, '2026-12-01');
  assert.strictEqual(L.placeWeek(alike, { recent: { pull: '2026-11-30' } }).find(x => x.lift === 'legs').date, '2026-12-02');
  const held = alike.map((x, i) => i === 0 ? Object.assign({}, x, { locked: 'pull' }) : x);
  assert.strictEqual(L.placeWeek(held).find(x => x.lift === 'legs').date, '2026-12-03');
  assert.ok(L.HARD.test('Sweet spot 3 x 12') && L.HARD.test('FTP test') && !L.HARD.test('Zone 1, 90 min') && !L.HARD.test('THE WAY TEST'));
});
ok('the week checked as it stands: a session twice, the one left out, legs and deadlifts before a hard ride, the upper days together', () => {
  const day = (date, lifts, o) => Object.assign({ date, lifts, done_keys: [], ride: null, rest: null }, o || {});
  const vo2 = { name: 'VO2 40/20s', hard: true };
  // Harry's week of 15 Nov as the calendar held it: Legs Sunday (swapped in by hand) and Legs again Wednesday, no Upper 2
  const week = [day('2026-11-15', ['legs']), day('2026-11-16', [], { rest: 'three classes' }), day('2026-11-17', ['push'], { ride: vo2 }), day('2026-11-18', ['legs']),
    day('2026-11-19', ['upper-1']), day('2026-11-20', ['pull'], { ride: vo2 }), day('2026-11-21', [])];
  const P = L.checkWeek(week, [{ date: '2026-11-13', template: 'upper-1' }, { date: '2026-11-14', template: 'pull' }]);
  const kinds = P.map(p => p.kind);
  assert.ok(P.some(p => p.kind === 'again' && p.key === 'legs' && p.date === '2026-11-18' && /3 days after another Legs/.test(p.text)), JSON.stringify(P));
  assert.ok(P.some(p => p.kind === 'missing' && /Upper 2 is not in the week/.test(p.text)), JSON.stringify(P));
  assert.ok(!kinds.includes('legs_before_hard'), 'Wednesday is two days before Friday: fine');
  // a clean week says nothing
  const clean = [day('2026-11-16', [], { rest: 'three classes' }), day('2026-11-17', ['push'], { ride: vo2 }), day('2026-11-18', ['legs']), day('2026-11-19', ['upper-1']),
    day('2026-11-20', ['pull'], { ride: vo2 }), day('2026-11-21', []), day('2026-11-22', ['upper-2'])];
  assert.deepStrictEqual(L.checkWeek(clean, []), []);
  // what each rule catches
  const bad = [day('2026-11-16', ['upper-2'], { rest: 'three classes' }), day('2026-11-17', ['upper-1']), day('2026-11-18', ['pull']), day('2026-11-19', ['legs'], { ride: vo2 }),
    day('2026-11-20', ['push'], { ride: vo2, close: [] }), day('2026-11-21', []), day('2026-11-22', [])];
  const B = L.checkWeek(bad, []).map(p => p.kind).sort();
  assert.deepStrictEqual(B, ['legs_before_hard', 'pull_before_hard', 'rest_day', 'uppers_together']);
  // a lift already done is not a problem to fix
  const done = [day('2026-11-18', ['pull'], { done_keys: ['pull'] }), day('2026-11-19', [], { ride: vo2 })];
  assert.deepStrictEqual(L.checkWeek(done, [{ date: '2026-11-18', template: 'pull' }]).filter(p => p.kind === 'pull_before_hard'), []);
  // Legs within three hours of the hard ride on its own day
  const close = L.checkWeek([day('2026-11-20', ['pull'], { ride: vo2, close: [{ key: 'pull', ride: 'VO2 40/20s', gap_min: 15, after: true }] })], []);
  assert.ok(close.some(p => p.kind === 'close_to_hard' && /15 min after VO2/.test(p.text)));
});
ok('the count is of the five, each once: Legs twice and no Upper 2 is four, and it never reads 6 of 5', () => {
  const s = (date, template) => ({ date, template, exercises: [] });
  const all = [s('2026-11-02', 'push'), s('2026-11-10', 'push'), s('2026-11-11', 'pull'), s('2026-11-12', 'upper-1'), s('2026-11-13', 'legs'), s('2026-11-15', 'legs'), s('2026-11-16', 'pump')];
  const c = L.weekCount(all, '2026-11-16');
  assert.strictEqual(c.sessions, 4); assert.strictEqual(c.repeats, 1); assert.strictEqual(c.pumps, 1); assert.strictEqual(c.word, '4 of 5');
});
ok('the two upper days carry their number in their name, and every older name still reads', () => {
  assert.strictEqual(L.nameOf('upper-1'), 'Upper 1: upper body and core'); assert.strictEqual(L.nameOf('upper-2'), 'Upper 2: upper body and core');
  assert.strictEqual(L.templateOf('Upper 2: upper body and core'), 'upper-2'); assert.strictEqual(L.templateOf('Upper 1: upper body and core'), 'upper-1');
  assert.strictEqual(L.templateOf('Upper body and core (Upper 2)'), 'upper-2'); assert.strictEqual(L.templateOf('Upper body and core'), 'upper-1');
  assert.strictEqual(L.templateOf('Kettlebell Blast B'), null);
});
console.log(n + ' passed');

