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
  await ok('the rest days between two dates come from the synced Google events', async () => {
    mem['gcal'] = { accounts: [], events };
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
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
