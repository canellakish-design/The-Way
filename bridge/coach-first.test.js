// node bridge/coach-first.test.js
const assert = require('assert');
const F = require('./coach-first'), V = require('./voice');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const R = { wake: 390, bed: 1350 };                      // 6:30a to 10:30p

ok('nothing reaches him inside the sleep window or in its last hour', () => {
  assert.strictEqual(F.mayReach(6 * 60, R), false);        // 6:00a, asleep
  assert.strictEqual(F.mayReach(6 * 60 + 40, R), false);   // ten minutes after waking
  assert.strictEqual(F.mayReach(6 * 60 + 50, R), true);
  assert.strictEqual(F.mayReach(21 * 60 + 30, R), true);   // an hour before bed
  assert.strictEqual(F.mayReach(21 * 60 + 35, R), false);
  assert.strictEqual(F.mayReach(23 * 60, R), false);
});
ok('the morning briefing: once a day, from twenty minutes after waking until noon', () => {
  assert.strictEqual(F.morningDue(6 * 60 + 45, R, null, '2026-11-16'), false);
  assert.strictEqual(F.morningDue(6 * 60 + 50, R, null, '2026-11-16'), true);
  assert.strictEqual(F.morningDue(6 * 60 + 55, R, { date: '2026-11-16' }, '2026-11-16'), false);   // already written
  assert.strictEqual(F.morningDue(7 * 60, R, { date: '2026-11-15' }, '2026-11-16'), true);        // yesterday's does not count
  assert.strictEqual(F.morningDue(12 * 60, R, null, '2026-11-16'), false);                         // a day begun after noon gets none
});
ok('the review: Sunday from 6:00p for its own week, Monday morning for the week just ended, once', () => {
  assert.strictEqual(F.reviewDue('2026-11-22', 0, 17 * 60 + 55, R, null), null);
  assert.strictEqual(F.reviewDue('2026-11-22', 0, 18 * 60, R, null), '2026-11-16');
  assert.strictEqual(F.reviewDue('2026-11-22', 0, 21 * 60 + 5, R, null), null);                    // too near bed: it waits for Monday
  assert.strictEqual(F.reviewDue('2026-11-23', 1, 7 * 60, R, null), '2026-11-16');
  assert.strictEqual(F.reviewDue('2026-11-23', 1, 7 * 60, R, { week_of: '2026-11-16', status: 'done' }), null);
  assert.strictEqual(F.reviewDue('2026-11-23', 1, 13 * 60, R, null), null);
  assert.strictEqual(F.reviewDue('2026-11-18', 3, 19 * 60, R, null), null);                         // a Wednesday
});
ok('alerts: a session the tank will not cover, 45 to 100 minutes before it, and not one already done', () => {
  const day = { energy: { sessions: [{ name: 'VO2 max: Zwift 40/20s #1', time: '16:30', need: 60, need_legs: 60, pct: 41, legs_pct: 70 }, { name: 'Zone 1, 60 min', time: '16:30', need: 25, need_legs: 30, pct: 41, legs_pct: 70 }] }, entries: [{ kcal: 500 }], target: {}, actual: {} };
  const a = F.alertsFor(day, 15 * 60 + 15);
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].key, 'fuel-16:30');
  assert.ok(/Eat before VO2 max at 4:30p/.test(a[0].title) && /needs 60%/.test(a[0].body) && /41%/.test(a[0].body), JSON.stringify(a[0]));
  assert.strictEqual(F.alertsFor(day, 14 * 60).length, 0);          // two and a half hours off: too early
  assert.strictEqual(F.alertsFor(day, 16 * 60).length, 0);          // half an hour off: too late to digest
  day.energy.sessions[0].done = true; assert.strictEqual(F.alertsFor(day, 15 * 60 + 15).length, 0);
});
ok('alerts: an empty journal in the early afternoon, protein far behind in the evening, each in its window only', () => {
  const empty = { entries: [{ supplement: true, kcal: 0 }], target: { protein_g: 187 }, actual: { protein_g: 0 } };
  assert.deepStrictEqual(F.alertsFor(empty, 13 * 60 + 45).map(x => x.key), ['journal']);
  assert.strictEqual(F.alertsFor(empty, 11 * 60).length, 0);
  assert.strictEqual(F.alertsFor(empty, 19 * 60).length, 0);        // nothing logged: the protein figure would be a guess
  const behind = { entries: [{ kcal: 600 }], target: { protein_g: 187 }, actual: { protein_g: 92 } };
  const p = F.alertsFor(behind, 19 * 60);
  assert.deepStrictEqual(p.map(x => x.key), ['protein']); assert.ok(/Protein: 92 of 187 g/.test(p[0].title) && /95 g to go/.test(p[0].body) && /Huel/.test(p[0].body) && !/whey/i.test(p[0].body));
  assert.strictEqual(F.alertsFor(Object.assign({}, behind, { actual: { protein_g: 150 } }), 19 * 60).length, 0);
  assert.strictEqual(F.alertsFor(null, 19 * 60).length, 0);
});
ok('the review asks for the week Monday to Sunday and next week from the planner, in the debrief\'s shape', () => {
  const t = F.reviewText('2026-11-16');
  assert.ok(/2026-11-16 to 2026-11-22/.test(t) && /\/planner\/week\?from=2026-11-23/.test(t) && /^SAY:/m.test(t) && /The one thing to change/.test(t) && /12-hour/.test(t));
});
ok('asked on the bike: the coach is given the heart rate and power on the screen at that second', () => {
  const w = V.rideWords({ state: 'riding', name: 'Zone 1, 60 min', elapsed_s: 1260, total_s: 3600, hr: 108, power: 112, target_w: 111, cadence: 86, step: 'Zone 1', step_left_s: 2340 });
  assert.ok(/ON THE BIKE NOW/.test(w) && /21:00 in of 60:00/.test(w) && /heart rate 108/.test(w) && /power 112 W against a target of 111 W/.test(w), w);
  assert.ok(/heart rate no reading/.test(V.rideWords({ state: 'paused', hr: 'x', power: 0 })) && /\(paused\)/.test(V.rideWords({ state: 'paused' })));
  assert.strictEqual(V.rideWords({ state: 'ended', hr: 120 }), ''); assert.strictEqual(V.rideWords(undefined), '');
});
console.log(`\n${n} checks, all good`);
