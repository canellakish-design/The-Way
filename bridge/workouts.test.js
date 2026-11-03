// node bridge/workouts.test.js
const assert = require('assert');
const { pastNow, gradeOne, dayCompliance, hrLoad, clean, nameForLength, gradeDay, liftMatches } = require('./workouts');
const tz = require('./tz');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const steps = [{ kind: 'step', label: 'Ride', dur_s: 3600, target: { type: 'free' }, cadence: null }];

ok('pastNow: saved after its date is a log, saved before its date is a plan', () => {
  // saved on the 29th for the 26th: logged
  assert.strictEqual(pastNow({ date: '2026-10-26', time: '18:00', steps, created: tz.noonOf('2026-10-29').toISOString() }, '2026-10-29'), true);
  // planned on the 26th for the 27th, never ridden: still a plan, so a miss
  assert.strictEqual(pastNow({ date: '2026-10-27', time: '06:00', steps, created: tz.noonOf('2026-10-26').toISOString() }, '2026-10-29'), false);
  // saved the same day after the ride ended: logged
  assert.strictEqual(pastNow({ date: '2026-10-29', time: '06:00', steps, created: tz.zonedToUTC(2026, 10, 29, 8, 0).toISOString() }, '2026-10-29'), true);
  // saved the same day before the ride: a plan
  assert.strictEqual(pastNow({ date: '2026-10-29', time: '06:00', steps, created: tz.zonedToUTC(2026, 10, 29, 5, 0).toISOString() }, '2026-10-29'), false);
  assert.strictEqual(pastNow({ date: '2026-10-29', steps }, '2026-10-29'), false);
});

ok('gradeOne: TrainingPeaks bands, over-doing counts, Zone 1 discipline', () => {
  const w = { metrics: { duration_s: 3600, tss: 40 } };
  assert.strictEqual(gradeOne(w, []).compliance.band, 'red');
  assert.strictEqual(gradeOne(w, [{ minutes: 58, tss: 38 }]).compliance.band, 'green');
  assert.strictEqual(gradeOne(w, [{ minutes: 40, tss: 30 }]).compliance.pct, 67);
  assert.strictEqual(gradeOne(w, [{ minutes: 40, tss: 30 }]).compliance.band, 'yellow');
  assert.strictEqual(gradeOne(w, [{ minutes: 20, tss: 12 }]).compliance.band, 'red');
  // twice the plan is not compliance either
  assert.strictEqual(gradeOne(w, [{ minutes: 80, tss: 55 }]).compliance.band, 'yellow');
  assert.strictEqual(gradeOne(w, [{ minutes: 200, tss: 140 }]).compliance.band, 'red');
  // no power and no heart rate: time alone, not a phantom zero load
  assert.strictEqual(gradeOne(w, [{ minutes: 60, tss: null }]).compliance.band, 'green');
  assert.strictEqual(gradeOne(Object.assign({ logged: true }, w), []).compliance.band, 'green');
  const g = gradeOne(w, [{ minutes: 58, tss: 38 }]);
  assert.strictEqual(dayCompliance([g], { planned_min: 60 }, true, 1).band, 'green');
  // a Zone 1 ride that spent a quarter of its time above VT1 is not a Zone 1 ride
  const z1 = { name: 'Zone 1, 60 min', metrics: { duration_s: 3600, tss: 40 } };
  const hot = { minutes: 60, tss: 40, analysis: { hr: { seconds: 3600, zones: {}, zone_pct: { z1: 75, z2: 20, z3: 5 }, minutes_above_hard: 0 } } };
  assert.strictEqual(gradeOne(z1, [hot]).compliance.band, 'red');
  const ok1 = { minutes: 60, tss: 40, analysis: { hr: { seconds: 3600, zones: {}, zone_pct: { z1: 94, z2: 6, z3: 0 }, minutes_above_hard: 0 } } };
  assert.strictEqual(gradeOne(z1, [ok1]).compliance.band, 'green');
  assert.strictEqual(dayCompliance([], { planned_min: 0 }, true, 1).band, 'extra');
  assert.strictEqual(dayCompliance([], { planned_min: 0 }, true, 0), null);
  // the plan lives in intervals.icu: the day's totals grade it
  // nearly double the plan is not compliance either: red, flagged as over
  const over = dayCompliance([], { planned_min: 60, planned_tss: 40, done_min: 114, done_tss: 86 }, true, 1);
  assert.strictEqual(over.band, 'red'); assert.strictEqual(over.over, true);
  assert.strictEqual(dayCompliance([], { planned_min: 60, planned_tss: 40, done_min: 62, done_tss: 44 }, true, 1).band, 'green');
  assert.strictEqual(dayCompliance([], { planned_min: 60, planned_tss: 40, done_min: 20, done_tss: 10 }, true, 1).band, 'red');
});

ok('gradeOne: a VO2 session is graded by minutes above 152 when the heart rate was read', () => {
  const vo2 = { name: 'VO2 max: Zwift 40/20s #1', metrics: { duration_s: 3000, tss: 65 } };
  const ride = { minutes: 50, tss: 60, analysis: { hr: { minutes_above_hard: 9.5, zones: {}, zone_pct: {} } } };
  assert.strictEqual(gradeOne(vo2, [ride]).compliance.band, 'green');
  assert.ok(/above 152/.test(gradeOne(vo2, [ride]).compliance.basis));
  assert.strictEqual(gradeOne(vo2, [{ minutes: 50, tss: 60, analysis: { hr: { minutes_above_hard: 3, zones: {}, zone_pct: {} } } }]).compliance.band, 'red');
  // no heart rate read yet: time and load, as for any session
  assert.strictEqual(gradeOne(vo2, [{ minutes: 50, tss: 60 }]).compliance.band, 'green');
});

ok('hrLoad: an hour at threshold is 100; easy hours score far less', () => {
  const st = { lthr: 139, hr_rest: 55, hr_max: 162 };
  assert.strictEqual(Math.round(hrLoad(3600, 139, st)), 100);
  const easy = hrLoad(3600, 110, st);
  assert.ok(easy > 25 && easy < 50, 'easy hour ' + easy);
  assert.ok(hrLoad(3600, 150, st) > 130, 'hard hour above threshold');
});


ok('no workouts before 7 a.m.: 06:30 is refused on the server, 07:00 is accepted; a cleared time is fine', () => {
  assert.throws(() => clean({ name: 'Zone 1, 60 min', sport: 'Ride', date: '2026-11-02', time: '06:30', steps }), /No workouts before 7 a\.m\./);
  assert.strictEqual(clean({ name: 'Zone 1, 60 min', sport: 'Ride', date: '2026-11-02', time: '07:00', steps }).time, '07:00');
  assert.strictEqual(clean({ name: 'Zone 1, 60 min', sport: 'Ride', date: '2026-11-02', time: '', steps }).time, null);
  // an update that keeps an old early time is refused too
  assert.throws(() => clean({ steps }, { id: 'w_1', date: '2026-11-02', time: '06:30', name: 'x', steps }), /No workouts before 7 a\.m\./);
});
ok('a library-shaped name follows the length of its steps; a custom name is left alone', () => {
  assert.strictEqual(nameForLength('Zone 1, 60 min', [{ kind: 'step', dur_s: 5400 }]), 'Zone 1, 90 min');
  assert.strictEqual(nameForLength('Zone 1, 60 min · mountain bike', [{ kind: 'step', dur_s: 5400 }]), 'Zone 1, 90 min · mountain bike');
  assert.strictEqual(nameForLength('Mountain bike handling, 60 min', [{ kind: 'repeat', count: 2, steps: [{ kind: 'step', dur_s: 1800 }] }]), 'Mountain bike handling, 60 min');
  assert.strictEqual(nameForLength('Saturday club ride', [{ kind: 'step', dur_s: 7200 }]), 'Saturday club ride');
  assert.strictEqual(clean({ name: 'Zone 1, 60 min', sport: 'Ride', date: '2026-11-02', time: '15:00', steps: [{ kind: 'step', label: 'Zone 1', dur_s: 5400, target: { type: 'free' } }] }).name, 'Zone 1, 90 min');
});

ok('a run or a lift is never graded against a Strava ride: logged once past, else ahead; the ride grades the ride', () => {
  const plan = (name, sport, time, min, logged) => ({ name, sport, time, logged: !!logged, metrics: { duration_s: min * 60, tss: Math.round(min * 0.5) } });
  const planned = [plan('Zone 1, 150 min', 'VirtualRide', '09:45', 150), plan('Treadmill run', 'Run', '13:00', 30, true), plan('Push', 'WeightTraining', '17:30', 55)];
  const out = gradeDay(planned, [{ id: 1, time: '09:49', minutes: 83, tss: 59 }], false, 14 * 60);
  assert.strictEqual(out[0].compliance.pct, 55);
  assert.strictEqual(out[1].compliance.pct, 100); assert.ok(/logged by hand/.test(out[1].compliance.basis));
  assert.ok(!out[2].compliance, 'the lift ahead is not graded');
});

ok('a Zone 1 ride is graded on time and discipline: low load is the point; a trail gets room on heart rate', () => {
  const z1 = { name: 'Zone 1, 60 min · mountain bike', sport: 'Ride', time: '15:00', metrics: { duration_s: 3600, tss: 30 } };
  const hr = pct => ({ hr: { seconds: 3240, zones: { z1_min: 1, z2_min: 1, z3_min: 1 }, zone_pct: { z1: 100 - pct, z2: pct, z3: 0 } } });
  const ride = (z, type) => ({ id: 9, time: '15:47', minutes: 54, tss: 17, type, analysis: hr(z) });
  const a = gradeOne(z1, [ride(29, 'MountainBikeRide')]);
  assert.strictEqual(a.compliance.pct, 90, JSON.stringify(a.compliance));
  assert.strictEqual(a.compliance.band, 'yellow'); assert.strictEqual(a.compliance.zone_over, 29);
  const b = gradeOne(z1, [ride(15, 'MountainBikeRide')]);
  assert.strictEqual(b.compliance.band, 'green'); assert.strictEqual(b.compliance.zone_over, null);
  const road = gradeOne({ name: 'Zone 1, 60 min', sport: 'Ride', time: '07:00', metrics: { duration_s: 3600, tss: 30 } }, [ride(15, 'Ride')]);
  assert.strictEqual(road.compliance.band, 'yellow', 'a road Zone 1 ride keeps the tighter line');
});

ok('a short ride above its zone is called short, not above Z1', () => {
  const z1 = { name: 'Zone 1, 150 min', sport: 'VirtualRide', time: '09:45', metrics: { duration_s: 9000, tss: 76 } };
  const r = gradeOne(z1, [{ id: 1, time: '09:49', minutes: 83, tss: 59, type: 'VirtualRide', analysis: { hr: { seconds: 4980, zones: { z1_min: 1, z2_min: 1, z3_min: 1 }, zone_pct: { z1: 76, z2: 21, z3: 3 } } } }]);
  assert.strictEqual(r.compliance.band, 'red'); assert.strictEqual(r.compliance.zone_over, null); assert.ok(/24% at 117/.test(r.compliance.basis), r.compliance.basis);
});
ok('a lift saved on the Lift page answers its planned lift; a ride never does', () => {
  const saved = [{ key: 'push', names: ['push', 'push', 'push'] }];
  assert.strictEqual(liftMatches({ name: 'Push', sport: 'WeightTraining' }, saved, 1), true);
  assert.strictEqual(liftMatches({ name: 'Lift', sport: 'WeightTraining' }, saved, 1), true);     // one planned, one saved
  assert.strictEqual(liftMatches({ name: 'Pull', sport: 'WeightTraining' }, saved, 2), false);    // two planned: names must match
  assert.strictEqual(liftMatches({ name: 'Zone 1, 60 min', sport: 'Ride' }, saved, 1), false);
  assert.strictEqual(liftMatches({ name: 'Push', sport: 'WeightTraining' }, [], 1), false);
});

const W2 = require('./workouts');
ok('a run logged after the fact (advisor, 9:30p, "ran 30 minutes at noon") is done and carries the logged grade, ride or none', () => {
  const run = { date: '2026-11-02', time: '12:00', sport: 'Run', name: 'Treadmill run', steps: [{ kind: 'step', label: 'Run', dur_s: 1800, target: { type: 'free' } }], created: tz.zonedToUTC(2026, 11, 2, 21, 30).toISOString() };
  assert.strictEqual(pastNow(run, '2026-11-02'), true);
  const m = W2.markLogged(run);
  assert.strictEqual(m.logged, true); assert.strictEqual(m.compliance.band, 'green'); assert.strictEqual(m.compliance.pct, 100); assert.ok(/logged by hand/.test(m.compliance.basis));
  // a grade it already has is kept (saved on the Lift page)
  assert.ok(/Lift page/.test(W2.markLogged(Object.assign({}, run, { compliance: { pct: 100, band: 'green', basis: 'saved on the Lift page' } })).compliance.basis));
  // planned that morning for noon, saved before it: a plan, not a log
  assert.strictEqual(pastNow(Object.assign({}, run, { created: tz.zonedToUTC(2026, 11, 2, 9, 0).toISOString() }), '2026-11-02'), false);
});

ok('an untimed copy of a timed session with the same name on the same day counts once', () => {
  const w = (id, name, time, sport, date) => ({ id, name, time, sport: sport || 'WeightTraining', date: date || '2026-11-02', metrics: { duration_s: 3300, tss: 28 } });
  const kept = W2.dropUntimedCopies([w('a', 'Push', '13:30'), w('b', 'push ', null), w('c', 'Zone 1, 60 min', null, 'Ride'), w('d', 'Push', null, 'WeightTraining', '2026-11-03')]);
  assert.deepStrictEqual(kept.map(x => x.id), ['a', 'c', 'd']);
  assert.deepStrictEqual(kept[0].copies, ['b']);
  // the day's totals then read one 55-minute Push, not 1:50
  assert.strictEqual(Math.round(kept.filter(x => x.date === '2026-11-02' && x.sport === 'WeightTraining').reduce((s, x) => s + x.metrics.duration_s, 0) / 60), 55);
  // two timed sessions of one name are two sessions; a ride never folds into a lift of the same name
  assert.strictEqual(W2.dropUntimedCopies([w('a', 'Push', '07:00'), w('b', 'Push', '17:00')]).length, 2);
  assert.strictEqual(W2.dropUntimedCopies([w('a', 'Zone 1', '07:00', 'Ride'), w('b', 'Zone 1', null, 'Run')]).length, 2);
});

ok('times past midnight read as the next morning: 11:00p for 90 minutes ends at 12:30a', () => {
  assert.strictEqual(W2.fmtMin(23 * 60), '11:00p');
  assert.strictEqual(W2.fmtMin(23 * 60 + 90), '12:30a');
  assert.strictEqual(W2.fmtMin(24 * 60), '12:00a');
  assert.strictEqual(W2.fmtMin(12 * 60 + 30), '12:30p');
  assert.strictEqual(W2.fmtMin(0), '12:00a');
});

ok('a library note follows the sport: a road Zone 1 says road and heart rate, a Zwift one trainer and ERG; written notes are left alone', () => {
  const { LIBRARY, notesFor, ROAD_HEAD } = require('./workout-library');
  const z60 = LIBRARY.find(t => t.key === 'z1-60');
  assert.ok(/on the trainer/.test(z60.notes));
  const road = clean({ name: z60.name, sport: 'Ride', date: '2026-11-04', time: '08:00', notes: z60.notes, steps: z60.steps });
  assert.ok(road.notes.startsWith(ROAD_HEAD), road.notes.slice(0, 80)); assert.ok(!/trainer|ERG/.test(road.notes.split('\n')[0]));
  assert.ok(/EAT/.test(road.notes), 'the eating part stays');
  const back = notesFor(road.notes, 'VirtualRide');
  assert.ok(/^ZONE 1 on the trainer: ERG/.test(back));
  assert.strictEqual(notesFor('My own words about the trainer.', 'Ride'), 'My own words about the trainer.');
  const z90 = LIBRARY.find(t => t.key === 'z1-90');
  assert.ok(/^ZONE 1 on the road/.test(z90.notes));
  assert.ok(/^ZONE 1 on the trainer/.test(notesFor(z90.notes, 'VirtualRide')));
});
console.log(n + ' passed');
