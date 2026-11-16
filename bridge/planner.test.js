// node bridge/planner.test.js
const assert = require('assert');
const P = require('./planner');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const m = (h, mi) => h * 60 + (mi || 0);
const good = () => null, cold = () => '38°F, under 50';
// Harry's week of 16 Nov 2026 as the calendar held it (minutes from midnight): school, drives, practices, the lifts
const week = () => [
  { date: '2026-11-16', rest: 'three classes', blocks: [], earliest: 450, latest: 1230, sunrise: m(6, 48), sunset: m(16, 52) },
  { date: '2026-11-17', blocks: [[m(10), m(10, 55), 15, 15], [m(12, 10), m(12, 55)], [m(13, 4), m(13, 50)], [m(14, 5), m(15, 15)], [m(15, 30), m(16, 21)], [m(17), m(17, 15)], [m(17, 30), m(19)], [m(19, 15), m(19, 27)]],
    earliest: 450, latest: 1230, sunrise: m(6, 49), sunset: m(16, 51), weather: good, prefer: [{ type: 'vo2', time: '07:00' }] },
  { date: '2026-11-18', blocks: [[m(7, 27), m(8, 15)], [m(8, 30), m(12, 5)], [m(12, 20), m(13, 5)], [m(17, 17), m(17, 45)], [m(18), m(19, 15)], [m(20, 30), m(22)], [m(22, 15), m(22, 35)]],
    earliest: 450, latest: 1230, sunrise: m(6, 50), sunset: m(16, 50), weather: good, prefer: [{ type: 'z1', time: '13:55' }] },
  { date: '2026-11-19', blocks: [[m(10), m(10, 50), 15, 15], [m(11, 50), m(12, 35)], [m(12, 50), m(15, 15)], [m(15, 30), m(16, 26)], [m(20, 2), m(20, 15)], [m(20, 30), m(22)], [m(22, 15), m(22, 26)]],
    earliest: 450, latest: 1230, sunrise: m(6, 51), sunset: m(16, 50), weather: cold, prefer: [{ type: 'z1', time: '07:00' }] },
  { date: '2026-11-20', blocks: [[m(7, 31), m(8, 15)], [m(8, 30), m(9, 45)], [m(10), m(10, 44)], [m(15, 1), m(15, 56), 15, 15]], heavy: [[m(15, 1), m(15, 56)]],
    earliest: 450, latest: 1230, sunrise: m(6, 52), sunset: m(16, 49), weather: good, prefer: [{ type: 'vo2', time: '11:10' }] },
  { date: '2026-11-21', away: 'a 180 min drive', blocks: [], earliest: 450, latest: 1230 },
  { date: '2026-11-22', away: 'at a place a 180 min drive from home', blocks: [[m(9, 40), m(11, 25)]], earliest: 450, latest: 1230 }
];
const by = plan => Object.fromEntries(plan.map(d => [d.date, d]));

ok('the model in words, and the changes the coach writes from his', () => {
  assert.ok(/two rides of one hour each, at least 4 hours apart/.test(P.modelWords(P.DEFAULT_MODEL)));
  assert.ok(/VO2 days: Tue and Fri; VO2 stays VO2/.test(P.modelWords(P.DEFAULT_MODEL)));
  assert.deepStrictEqual(P.parseChanges('base=single; single=90; vo2=Tue'), { base: 'single', single_minutes: 90, vo2_days: [2] });
  assert.deepStrictEqual(P.parseChanges('base = two a day; hours = 2; long = 2.5 h; vo2 = none'), { base: 'double', base_minutes: 120, long_minutes: 150, vo2_days: [] });
  assert.ok(/one Zone 1 ride of 90 minutes/.test(P.modelWords({ base: 'single' })));
  assert.strictEqual(P.cleanModel({ base_minutes: 500, long_minutes: 133 }).base_minutes, 120, 'out of range falls back');
  assert.strictEqual(P.cleanModel({ long_minutes: 133 }).long_minutes, 135, 'lengths are the library\'s');
  assert.deepStrictEqual(P.parseOverrides('2026-11-20=long:150@14:00; 2026-11-22=off; nonsense'), { '2026-11-20': { kind: 'long', minutes: 150, time: '14:00' }, '2026-11-22': { kind: 'off', minutes: null, time: null } });
});
ok('free time: between the fixed things, with twenty minutes before the next and a quarter hour after the last', () => {
  assert.deepStrictEqual(P.freeOf([[m(9), m(10)], [m(12), m(13)]], m(7, 30), m(20, 30)), [[m(7, 30), m(8, 40)], [m(10, 15), m(11, 40)], [m(13, 15), m(20, 30)]]);
  assert.deepStrictEqual(P.freeOf([], m(7, 30), m(20, 30)), [[m(7, 30), m(20, 30)]]);
  assert.deepStrictEqual(P.freeOf([[m(7), m(21)]], m(7, 30), m(20, 30)), []);
});
ok('his week, two hours a base day: two one-hour rides apart where the day has two stretches, VO2 where it was, nothing on a rest day or away', () => {
  const plan = by(P.buildWeek(week(), P.DEFAULT_MODEL, {}));
  assert.strictEqual(plan['2026-11-16'].kind, 'rest'); assert.strictEqual(plan['2026-11-16'].rides.length, 0);
  // Tuesday's VO2 keeps its 7:00a; Friday's its 11:10a, three hours clear of the Pull at 3:01p
  assert.deepStrictEqual(plan['2026-11-17'].rides.map(r => [r.type, r.time]), [['vo2', '07:00']]);
  assert.deepStrictEqual(plan['2026-11-20'].rides.map(r => [r.type, r.time]), [['vo2', '11:10']]);
  // Thursday: a free morning and a free late afternoon: one hour in each, on the trainer (cold, then dark)
  const thu = plan['2026-11-19'].rides;
  assert.deepStrictEqual(thu.map(r => [r.time, r.minutes, r.outside]), [['07:00', 60, false], ['16:45', 60, false]]);
  assert.ok(m(16, 45) - m(7) >= 240);
  // Wednesday: one free stretch between school and practice: the two hours as one ride, outside in the light
  const wed = plan['2026-11-18'];
  assert.strictEqual(wed.rides.length, 1); assert.strictEqual(wed.rides[0].minutes, 120); assert.strictEqual(wed.rides[0].outside, true);
  assert.ok(/one free stretch in the day: the two hours as one ride/.test(wed.note), wed.note);
  assert.ok(m(...wed.rides[0].time.split(':').map(Number)) >= m(13, 20) && m(...wed.rides[0].time.split(':').map(Number)) + 120 <= m(16, 35), wed.rides[0].time);
  // away: no ride is invented in New Jersey
  assert.strictEqual(plan['2026-11-21'].kind, 'away'); assert.strictEqual(plan['2026-11-22'].kind, 'away'); assert.strictEqual(plan['2026-11-22'].rides.length, 0);
});
ok('one free stretch and bad weather: the short ride on the trainer; a lift in the stretch leaves what fits', () => {
  const w = week(); w[2].weather = cold;
  const wed = by(P.buildWeek(w, P.DEFAULT_MODEL, {}))['2026-11-18'];
  assert.deepStrictEqual(wed.rides.map(r => [r.minutes, r.outside]), [[60, false]]); assert.ok(/on the trainer \(38°F, under 50\): 60 minutes/.test(wed.note), wed.note);
  const w2 = week(); w2[2].blocks.push([m(15, 25), m(16, 20), 15, 15]);   // Legs 2 at 3:25p
  const wed2 = by(P.buildWeek(w2, P.DEFAULT_MODEL, {}))['2026-11-18'];
  assert.strictEqual(wed2.rides[0].minutes, 105); assert.ok(/room for 105 minutes/.test(wed2.note), wed2.note);
});
ok('the model changed back to one ride a day: a base day is one ride of 90 minutes', () => {
  const plan = by(P.buildWeek(week(), { base: 'single', single_minutes: 90 }, {}));
  assert.deepStrictEqual(plan['2026-11-19'].rides.map(r => r.minutes), [90]);
  assert.deepStrictEqual(plan['2026-11-18'].rides.map(r => r.minutes), [90]);
});
ok('a day that is mostly free takes the longer ride, outside in the light; a day set by hand is as he set it', () => {
  // a Saturday with nothing on it
  const w = week(); w[5] = { date: '2026-11-21', blocks: [], earliest: 450, latest: 1230, sunrise: m(6, 53), sunset: m(16, 49), weather: good };
  const sat = by(P.buildWeek(w, P.DEFAULT_MODEL, {}))['2026-11-21'];
  assert.strictEqual(sat.kind, 'long'); assert.deepStrictEqual(sat.rides.map(r => [r.minutes, r.outside]), [[150, true]]);
  const t = m(...sat.rides[0].time.split(':').map(Number)); assert.ok(t >= m(7, 23) && t + 150 <= m(16, 34), sat.rides[0].time);
  // this week only: Friday is the long ride at 2:00p (on the way to New Jersey) and Sunday a ride on the way home
  const plan = by(P.buildWeek(week(), P.DEFAULT_MODEL, P.parseOverrides('2026-11-20=long:150@14:00; 2026-11-22=single:120@13:45')));
  assert.deepStrictEqual(plan['2026-11-20'].rides.map(r => [r.type, r.minutes]), [['z1', 150]]);
  assert.deepStrictEqual(plan['2026-11-22'].rides.map(r => [r.time, r.minutes]), [['13:45', 120]]);
  assert.strictEqual(by(P.buildWeek(week(), P.DEFAULT_MODEL, P.parseOverrides('2026-11-19=off')))['2026-11-19'].rides.length, 0);
});
ok('what a yes would change: rides kept, changed in place, added, and the ones the week has no use for taken off', () => {
  const have = [{ id: 'a', date: '2026-11-17', time: '07:00', minutes: 51, name: 'VO2 40/20s', sport: 'VirtualRide' }, { id: 'b', date: '2026-11-18', time: '13:55', minutes: 75, name: 'Z1 trainer 75 min', sport: 'VirtualRide' },
    { id: 'c', date: '2026-11-19', time: '07:00', minutes: 60, name: 'Z1 trainer 60 min', sport: 'VirtualRide' }, { id: 'd', date: '2026-11-20', time: '11:10', minutes: 51, name: 'VO2 40/20s', sport: 'VirtualRide' },
    { id: 'e', date: '2026-11-21', time: '07:40', minutes: 150, name: 'Z1 road 150 min', sport: 'Ride' }];
  const plan = P.buildWeek(week(), P.DEFAULT_MODEL, {}), ops = P.diff(plan, have), of = id => ops.find(o => o.id === id);
  assert.strictEqual(of('a').op, 'keep'); assert.strictEqual(of('d').op, 'keep'); assert.strictEqual(of('c').op, 'keep');
  assert.strictEqual(of('b').op, 'change'); assert.strictEqual(of('b').ride.minutes, 120);
  assert.strictEqual(of('e').op, 'remove');
  assert.deepStrictEqual(ops.filter(o => o.op === 'add').map(o => [o.date, o.ride.time]), [['2026-11-19', '16:45']]);
  const text = P.lines(plan, ops, [{ date: '2026-11-19', name: 'Upper body and core', time: '10:00' }]).join('\n');
  assert.ok(/Thu, Nov 19: Zone 1, 60 min at 7:00a \(trainer: dark\); Zone 1, 60 min at 4:45p \(trainer: dark\); lift Upper body and core 10:00a/.test(text), text);
  assert.ok(/Sat, Nov 21: Away .*\(comes off: Z1 road 150 min 7:40a\)/.test(text), text);
  assert.ok(/Mon, Nov 16: Rest day \(three classes\)/.test(text), text);
});
console.log(n + ' passed');
