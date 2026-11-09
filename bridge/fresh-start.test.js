// node bridge/fresh-start.test.js
// The fresh start (fresh-start.js): scores and streaks count from a date; the stored history stays.
// Storage is an in-memory map here, and the reads the chain makes elsewhere (the day report, the
// calendar, the watch, the scale) are stubbed, so the test reads only what it seeds.
const assert = require('assert');
const path = require('path');
const mem = new Map();
const storageStub = {
  getJSON: async (k, fb) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : fb),
  setJSON: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); },
  withScope: fn => fn(), ON_NETLIFY: false, SANDBOX: false
};
const sp = path.join(__dirname, 'storage.js');
require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: storageStub };

const FSm = require('./fresh-start');
const tz = require('./tz');
const C = require('./chain');
const L = require('./lifts');
const food = require('./food');
const workouts = require('./workouts');
const recovery = require('./recovery');
const weighin = require('./weighin');

let n = 0;
const tests = [];
function ok(name, fn) { tests.push([name, fn]); }

// the stubbed world: today is Wed 11 Nov; every day of the week holds food and water, the days before
// the 9th scoring far lower, so a leak of an old day shows in the average
const TODAY = '2026-11-11';
tz.todayKey = () => TODAY;
const OLD = { '2026-11-05': 20, '2026-11-06': 30, '2026-11-07': 25, '2026-11-08': 35 };
const NEW = { '2026-11-09': 80, '2026-11-10': 90 };
function seed() {
  mem.clear();
  const days = {};
  for (const [d, v] of Object.entries(Object.assign({}, OLD, NEW))) days[d] = { v: C.ROW_V, fuel: [], food: v, logged: true, water: v, drunk_ml: 2000, target_ml: 3000, supps: [], ride: false, hard: false };
  mem.set('chain-days', { days });
}
food.dayReport = async () => ({ entries: [{ kcal: 600 }], compliance: { overall: 70 }, hydration: { now: { ml: 1500 }, score: 70, drunk_ml: 1500, target_ml: 3000 }, sessions: [], actual: { kcal: 600, protein_g: 40 }, target: { kcal: 2400, protein_g: 170 } });
// the calendar: an hour planned each day and an hour ridden only on the old days
workouts.calendar = async (from, to) => {
  const days = [];
  for (let d = from; d <= to; d = tz.shiftKey(d, 1)) {
    const old = d < '2026-11-09';
    days.push({ date: d, planned: [{ name: 'Zone 1', sport: 'Ride', metrics: { duration_s: 3600 } }], intervals: [], done: old ? [{ name: 'Zone 1', sport: 'Ride', minutes: 60 }] : [] });
  }
  return { days };
};
recovery.weekBand = async () => ({ nights: [], recs: [], band: { state: 'none', why: 'test' }, hrv_week_ms: null, hrv_base_ms: null, rhr_week: null });
weighin.state = async () => null;

ok('the reader: null when nothing is set, a set date read back, a bad date a 400, a cleared date null again', async () => {
  mem.clear();
  assert.strictEqual(await FSm.freshStart(), null);
  assert.deepStrictEqual(await FSm.get(), { date: null });
  await FSm.set('2026-11-09', 'Harry, 8 Nov');
  assert.strictEqual(await FSm.freshStart(), '2026-11-09');
  for (const bad of ['9 Nov', '2026-13-40', '2026/11/09', 'tomorrow']) {
    await assert.rejects(() => FSm.set(bad), e => e.status === 400, bad);
  }
  assert.strictEqual(await FSm.freshStart(), '2026-11-09', 'a rejected date leaves the setting as it was');
  await FSm.set('');
  assert.strictEqual(await FSm.freshStart(), null);
  mem.set('fresh-start', { date: 'garbage' });
  assert.strictEqual(await FSm.freshStart(), null, 'a stored bad value reads as no cut-off');
  assert.strictEqual(FSm.counts('2026-11-08', '2026-11-09'), false);
  assert.strictEqual(FSm.counts('2026-11-09', '2026-11-09'), true);
  assert.strictEqual(FSm.counts('2026-11-01', null), true);
});

ok('the chain, fresh start on the 9th and today the 11th: food and water average three days, the days before are ignored', async () => {
  seed(); mem.set('fresh-start', { date: '2026-11-09' });
  const r = await C.report();
  assert.strictEqual(r.fresh_start, '2026-11-09'); assert.strictEqual(r.week_from, '2026-11-09');
  // 80, 90 and today's 70
  assert.strictEqual(r.links.food.days_logged, 3); assert.strictEqual(r.links.food.week, 80);
  assert.strictEqual(r.links.water.week, 80);
  assert.strictEqual(r.read_days, 3);
  // work: only the 9th to today are graded; the hours ridden before the 9th do not count, and nothing planned today has ended
  const graded = r.links.work.planned_min;
  assert.ok(graded <= 180 && graded >= 120, 'planned ' + graded);
  assert.strictEqual(r.links.work.done_min, 0);
  // the plan link looks ahead and is untouched
  assert.strictEqual(r.links.plan.from, TODAY);
});

ok('the chain with no setting is the seven days as before', async () => {
  seed();
  const r = await C.report();
  assert.strictEqual(r.fresh_start, null); assert.strictEqual(r.week_from, tz.shiftKey(TODAY, -6));
  // the six past days 20, 30, 25, 35, 80, 90 and today's 70
  assert.strictEqual(r.links.food.days_logged, 7); assert.strictEqual(r.links.food.week, Math.round((20 + 30 + 25 + 35 + 80 + 90 + 70) / 7));
  assert.strictEqual(r.links.work.done_min, 60 * 4);
});

ok('a fresh start later than today: nothing is graded yet, every link reads "none", never red', async () => {
  seed(); mem.set('fresh-start', { date: '2026-11-12' });
  const r = await C.report();
  assert.strictEqual(r.links.food.days_logged, 0); assert.strictEqual(r.links.food.state, 'none');
  assert.strictEqual(r.links.water.week, null); assert.strictEqual(r.links.water.state, 'none');
  assert.strictEqual(r.links.micros.state, 'none');
});

ok('lifts: with the start on the 9th, the 9th reads "1 of 1 due"; the deload cycle keeps its real first week', () => {
  const s = (date, template) => ({ date, template, exercises: [] });
  const sessions = [s('2026-11-02', 'push'), s('2026-11-04', 'pull'), s('2026-11-06', 'legs'), s('2026-11-09', 'upper-1')];
  const c = L.weekCount(sessions, '2026-11-09', undefined, '2026-11-09');
  assert.strictEqual(c.sessions, 1); assert.strictEqual(c.of, 1); assert.strictEqual(c.word, '1 of 1 due'); assert.strictEqual(c.first_week, true);
  assert.strictEqual(c.first_count, '2026-11-09'); assert.strictEqual(c.week_no, 2);
  const wed = L.weekCount(sessions, '2026-11-11', undefined, '2026-11-09');
  assert.strictEqual(wed.word, '1 of 3 due');
  const after = L.weekCount(sessions.concat([s('2026-11-16', 'push')]), '2026-11-16', undefined, '2026-11-09');
  assert.strictEqual(after.first_week, false); assert.strictEqual(after.of, 5);
  // no setting: as before
  const before = L.weekCount(sessions, '2026-11-09');
  assert.strictEqual(before.word, '3 of 5'); assert.strictEqual(before.first_count, '2026-11-02');
});

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log('ok ' + name); }
  console.log(`\n${n} passed`);
})().catch(e => { console.error(e); process.exit(1); });
