// node bridge/naps.test.js
const assert = require('assert');
const N = require('./naps');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const m = (h, mi) => h * 60 + (mi || 0);
const ev = (summary, category, s, e) => ({ summary, category, start_min: s, end_min: e });
ok('a nap is offered only after a short night: under 7 hours yes, 7 or more no, a night not known no', () => {
  assert.ok(N.slotFor([], { lastNightH: 6.4 }));
  assert.strictEqual(N.slotFor([], { lastNightH: 7 }), null);
  assert.strictEqual(N.slotFor([], { lastNightH: 7.3 }), null);
  assert.strictEqual(N.slotFor([], { lastNightH: null }), null);
});
ok('where it goes: the first free half hour from 1 p.m., ending by 3; 25 minutes; never later', () => {
  const s = N.slotFor([], { lastNightH: 6.1 });
  assert.deepStrictEqual([s.start, s.end, s.minutes], [m(13), m(13, 30), 25]); assert.ok(/6\.1 h/.test(s.why));
  // home from the game at 1:36p, the lift at 3:15p: after the drive, clear of the lift
  const sat = [ev('Drive to Maryland SoccerPlex · 58 min', 'commute', m(7, 2), m(8)), ev('Coaching', 'coaching', m(9), m(12, 15)), ev('Drive home · 66 min', 'commute', m(12, 30), m(13, 36)), ev('Pull', 'training', m(15, 15), m(16, 10))];
  assert.strictEqual(N.slotFor(sat, { lastNightH: 6.4 }).start, m(13, 40));
  // it is already 2:12p: from the next five minutes; at 2:40p there is no half hour left before 3
  assert.strictEqual(N.slotFor(sat, { lastNightH: 6.4, nowMin: m(14, 12) }).start, m(14, 20));
  assert.strictEqual(N.slotFor(sat, { lastNightH: 6.4, nowMin: m(14, 40) }), null);
});
ok('not at school, not inside anything, and not in the 20 minutes before a workout', () => {
  const school = [ev('Drive to McDonogh · 45 min', 'commute', m(7, 30), m(8, 15)), ev('(CP) World History I', 'work', m(8, 30), m(9, 45)), ev('Drive home · 44 min', 'commute', m(15, 20), m(16, 4))];
  assert.strictEqual(N.slotFor(school, { lastNightH: 5.9 }), null, 'at school until after 3');
  const busy = [ev('Cycle 3 Planning', 'busy', m(13), m(14, 10)), ev('Z1 trainer', 'training', m(14, 55), m(16))];
  assert.strictEqual(N.slotFor(busy, { lastNightH: 5.9 }), null, '2:10 to 2:40 would end inside the 20 minutes before the ride');
  const busy2 = [ev('Cycle 3 Planning', 'busy', m(13), m(13, 40)), ev('Z1 trainer', 'training', m(14, 55), m(16))];
  assert.strictEqual(N.slotFor(busy2, { lastNightH: 5.9 }).start, m(13, 40));
});
ok('a nap counts toward the day: the night plus the nap, the night kept apart; the row shows the nap taken', () => {
  const nights = [{ date: '2026-11-13', hours: 7.2, counted: true }, { date: '2026-11-14', hours: 6.4, counted: true }];
  const by = N.totals([{ date: '2026-11-14', minutes: 25 }, { date: '2026-11-14', minutes: 20 }, { date: '2026-11-10', minutes: 30 }]);
  const w = N.withNaps(nights, by);
  assert.strictEqual(w[0].hours, 7.2); assert.ok(!w[0].nap_min);
  assert.strictEqual(w[1].hours, 7.15); assert.strictEqual(w[1].night_hours, 6.4); assert.strictEqual(w[1].nap_min, 45);
  const rows = N.rowsFor('2026-11-14', [], [{ id: 'n_1', date: '2026-11-14', time: '13:40', minutes: 25 }], { lastNightH: 6.4 });
  assert.strictEqual(rows.length, 1); assert.strictEqual(rows[0].taken, true); assert.strictEqual(rows[0].start_min, m(13, 40)); assert.strictEqual(rows[0].rx_key, 'nap');
  const offer = N.rowsFor('2026-11-14', [], [], { lastNightH: 6.4 });
  assert.strictEqual(offer[0].taken, false); assert.ok(/Not after 3 p\.m\./.test(offer[0].detail));
  assert.strictEqual(N.rowsFor('2026-11-14', [], [], { lastNightH: 7.5 }).length, 0);
});
console.log(n + ' passed');
