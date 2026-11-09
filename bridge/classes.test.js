// node bridge/classes.test.js — a day with all three classes is a rest day: the Google events of the day
// are counted against the pattern in schedule-classes.json, and the placers refuse such a day.
const assert = require('assert');
const storage = require('./storage');
const mem = {};
storage.getJSON = async (k, f) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : f);
storage.setJSON = async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); };
const C = require('./classes');
const tz = require('./tz');

let n = 0;
function ok(name, fn) { return Promise.resolve().then(fn).then(() => { n++; console.log('ok ' + name); }); }

const at = (date, hm) => tz.zonedToUTC(+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10), +hm.slice(0, 2), +hm.slice(3, 5)).toISOString();
const cls = (date, hm, sec) => ({ summary: `(CP) World History I (Sec. ${sec})`, start: at(date, hm), end: at(date, hm), allDay: false });
const events = [
  cls('2026-11-12', '10:25', 'E'), cls('2026-11-12', '12:50', 'F'), cls('2026-11-12', '14:05', 'G'),   // all three
  cls('2026-11-10', '12:50', 'E'), cls('2026-11-10', '14:05', 'F'),                                   // two
  { summary: 'Practice', start: at('2026-11-10', '20:30'), end: at('2026-11-10', '22:00'), allDay: false },
  { summary: 'World History I all day', start: '2026-11-11', end: '2026-11-12', allDay: true }         // an all-day note is not a class
];

(async () => {
  await ok('three sections on a day make it a rest day; two do not; an all-day note does not count', () => {
    assert.strictEqual(C.restReason('2026-11-12', events), 'three classes');
    assert.strictEqual(C.restReason('2026-11-10', events), null);
    assert.strictEqual(C.restReason('2026-11-11', events), null);
    assert.strictEqual(C.restReason('2026-11-13', events), null);
  });
  await ok('the rest days between two dates come from every source the schedule reads', async () => {
    require('./calendar').eventsBetween = async () => events;   // the merged sources, stood in for
    const r = await C.restDaysBetween('2026-11-09', '2026-11-15');
    assert.deepStrictEqual(r, { '2026-11-12': 'three classes' });
  });
  await ok('a session is refused on a rest day, placed with force, and moved off one freely', async () => {
    mem['workout-settings'] = { ftp: 175 }; mem['plan-workouts'] = { workouts: {} };
    const W = require('./workouts');
    let err = null; try { await W.create({ name: 'Z1 trainer 60 min', date: '2026-11-12', time: '07:00', steps: [] }); } catch (e) { err = e; }
    assert.ok(err && err.status === 400 && /rest day \(three classes\)/.test(err.message), String(err && err.message));
    const forced = await W.create({ name: 'Z1 trainer 60 min', date: '2026-11-12', time: '07:00', steps: [], force: true });
    assert.strictEqual(forced.date, '2026-11-12');
    const moved = await W.update(forced.id, { date: '2026-11-13' });
    assert.strictEqual(moved.date, '2026-11-13');
    let back = null; try { await W.update(forced.id, { date: '2026-11-12' }); } catch (e) { back = e; }
    assert.ok(back && back.status === 400);
    const same = await W.update(forced.id, { time: '08:00' });   // a change that keeps the day is not a placement
    assert.strictEqual(same.time, '08:00');
  });
  await ok('a special schedule re-times the day\'s classes by period, and drops a class whose period does not meet', () => {
    const desc = 'Spirit Parade and Pep Rally (Friday, November 6 - Day 3)\n8:15 Advisory\n8:30 - 9:30 Period 1 (60 min)\n9:35 - 10:55 Period 2 (80 min)\n11:15 - 12:00 Period 3 (45 min)\n12:05 Lunch\n12:45 - 1:30 Period 4 (45 min)\n1:45 - 3:00 Parade and Pep Rally';
    const p = C.specialPeriods(desc);
    assert.deepStrictEqual(p[4], { start_min: 12 * 60 + 45, end_min: 13 * 60 + 30 }); assert.deepStrictEqual(p[1], { start_min: 510, end_min: 570 });
    const special = { summary: 'Special Schedule: Spirit Parade and Pep Rally', allDay: true, start: '2026-11-06', end: '2026-11-07', description: desc, calendar: 'Upper School' };
    const period4 = cls('2026-11-06', '14:05', 'E1');                 // the regular Period 4 block
    const period3 = cls('2026-11-06', '12:50', 'F');                  // a Period 3 class: it meets at 11:15 on the special day
    const other = cls('2026-11-05', '14:05', 'G');                    // another day: untouched
    const outEv = C.applySpecialSchedules([special, period4, period3, other, { summary: 'Practice', start: at('2026-11-06', '20:30'), end: at('2026-11-06', '22:00'), allDay: false }]);
    const e1 = outEv.find(e => e.summary.includes('E1')), f = outEv.find(e => e.summary.includes('Sec. F'));
    assert.strictEqual(tz.minutesOf(new Date(e1.start)), 12 * 60 + 45); assert.strictEqual(tz.minutesOf(new Date(e1.end)), 13 * 60 + 30); assert.strictEqual(e1.period, 4); assert.strictEqual(e1.special, 'Spirit Parade and Pep Rally');
    assert.strictEqual(tz.minutesOf(new Date(f.start)), 11 * 60 + 15); assert.strictEqual(f.period, 3);
    assert.strictEqual(tz.minutesOf(new Date(outEv.find(e => e.summary.includes('Sec. G')).start)), 14 * 60 + 5);
    assert.strictEqual(outEv.length, 5);
    // a schedule with only three periods drops the fourth's class
    const three = Object.assign({}, special, { description: '8:30 - 10:00 Period 1\n10:15 - 11:45 Period 2\n12:30 - 2:00 Period 3' });
    assert.strictEqual(C.applySpecialSchedules([three, period4]).length, 1);
    // a second pass leaves a moved class where it is: on a two-hour-delay day, Period 1 at 10:30 sits within
    // half an hour of Period 2's regular 10:25 and would otherwise move again to Period 2's time
    const delay = Object.assign({}, special, { start: '2026-11-09', end: '2026-11-10', description: '10:30 - 11:20 Period 1 (50 min)\n11:25 - 12:35 Period 2 (70 min)\n1:30 - 2:20 Period 3 (50 min)\n2:25 - 3:15 Period 4 (50 min)' });
    const p1 = cls('2026-11-09', '08:30', 'F2');
    const once = C.applySpecialSchedules([delay, p1]), twice = C.applySpecialSchedules(once);
    const f2 = l => l.find(e => e.summary.includes('F2'));
    assert.strictEqual(tz.minutesOf(new Date(f2(once).start)), 10 * 60 + 30);
    assert.strictEqual(tz.minutesOf(new Date(f2(twice).start)), 10 * 60 + 30);
    // the other spelling on the school's notes: a start and a length, no end
    const flag = C.specialPeriods('8:15 Advisory\n8:30 - 9:40 Period 1 (70 min)\n9:45 - 11:25 Period 2 (100 min)\n12:05 Lunch\n12:50 Period 3 (70 min)\n2:05 Period 4 (70 min)\n4:00 Regular buses depart');
    assert.deepStrictEqual(flag[3], { start_min: 12 * 60 + 50, end_min: 14 * 60 }); assert.deepStrictEqual(flag[4], { start_min: 14 * 60 + 5, end_min: 15 * 60 + 15 }); assert.deepStrictEqual(flag[2], { start_min: 585, end_min: 685 });
  });
  await ok('a class already moved to the special day\'s period time stays put (no second re-timing)', () => {
    const desc = '8:00 - 10:00    PLC/Weather-Related Delay\n10:15 Advisory\n10:30 - 11:20 Period 1 (50 min)\n11:25 - 12:35 Period 2 (70 min)\n12:35 Lunch\n1:30 - 2:20 Period 3 (50 min)\n2:25 - 3:15 Period 4 (50 min)';
    const special = { summary: 'Special Schedule: Faculty Professional Development (Two-Hour Delay)', allDay: true, start: '2026-11-09', end: '2026-11-10', description: desc, calendar: 'Upper School' };
    const movedF2 = cls('2026-11-09', '10:30', 'F2'), movedG1 = cls('2026-11-09', '11:25', 'G1'), notMoved = cls('2026-11-09', '08:30', 'E1');
    const outEv = C.applySpecialSchedules([special, movedF2, movedG1, notMoved]);
    const at_ = k => tz.minutesOf(new Date(outEv.find(e => e.summary.includes('Sec. ' + k)).start));
    assert.strictEqual(at_('F2'), 10 * 60 + 30); assert.strictEqual(at_('G1'), 11 * 60 + 25);
    assert.strictEqual(at_('E1'), 10 * 60 + 30);   // a regular 8:30 class still moves to Period 1
  });
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
