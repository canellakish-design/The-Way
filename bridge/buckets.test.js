// node bridge/buckets.test.js — the magic buckets: the lines, the fallback to heart rate, the plan from
// a workout's steps (and the player's and the Garmin field's shapes of it), the due marker, the ride in
// seconds per bucket, and the thresholds store that moves the lines.
const assert = require('assert');
const storage = require('./storage');
const mem = {};
storage.getJSON = async (k, f) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : f);
storage.setJSON = async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); };
const B = require('./buckets');
const T = require('./thresholds');
const P = require('./player');

let n = 0;
function ok(name, fn) { return Promise.resolve().then(fn).then(() => { n++; console.log('ok ' + name); }); }

// the worked example: 300 s at 55-60%, 3 x (180 s at 125-130%, 180 s at 55%), 300 s at 100-105%, 300 s at 50%
const step = (dur_s, lo, hi) => ({ kind: 'step', label: '', dur_s, target: { type: 'power', lo, hi: hi == null ? lo : hi }, cadence: null });
const EXAMPLE = [step(300, 55, 60), { kind: 'repeat', label: '3 x', count: 3, steps: [step(180, 125, 130), step(180, 55)] }, step(300, 100, 105), step(300, 50)];

(async () => {
  await ok('the lines and the colours are the handover\'s', () => {
    assert.deepStrictEqual(Object.assign({}, B.LINES), { vt1_w: 169, vt2_w: 208, vt1_hr: 117, vt2_hr: 139 });
    assert.deepStrictEqual(Object.assign({}, B.COLOURS), { low: '#0099FF', high: '#FFAA00', peak: '#E00000' });
    assert.strictEqual(B.PLANNING_FTP, 175);
  });
  await ok('power boundaries: 168 LOW, 169 HIGH, 207 HIGH, 208 PEAK', () => {
    assert.strictEqual(B.bucketOf({ w: 168 }), 0); assert.strictEqual(B.bucketOf({ w: 169 }), 1);
    assert.strictEqual(B.bucketOf({ w: 207 }), 1); assert.strictEqual(B.bucketOf({ w: 208 }), 2);
  });
  await ok('heart-rate boundaries, used only without power: 116 LOW, 117 HIGH, 138 HIGH, 139 PEAK', () => {
    assert.strictEqual(B.bucketOf({ w: null, hr: 116 }), 0); assert.strictEqual(B.bucketOf({ w: null, hr: 117 }), 1);
    assert.strictEqual(B.bucketOf({ hr: 138 }), 1); assert.strictEqual(B.bucketOf({ hr: 139 }), 2);
  });
  await ok('power decides when it exists; 0 W coasting is LOW whatever the heart rate; nothing is null', () => {
    assert.strictEqual(B.bucketOf({ w: 0, hr: 150 }), 0);
    assert.strictEqual(B.bucketOf({ w: 150, hr: 150 }), 0);
    assert.strictEqual(B.bucketOf({ w: 250, hr: 100 }), 2);
    assert.strictEqual(B.bucketOf({ w: null, hr: null }), null);
    assert.strictEqual(B.bucketOf({ hr: 0 }), null);                  // a strap's zero is no reading
    assert.strictEqual(B.bucketOf({}), null);
  });
  await ok('the worked example plans LOW 19:00, HIGH 5:00, PEAK 9:00 (1140 / 300 / 540 s)', () => {
    const p = B.planFromSteps(EXAMPLE, 175);
    assert.deepStrictEqual(B.planOf(p), { low: 1140, high: 300, peak: 540 });
    assert.strictEqual(p.total, 1980); assert.strictEqual(p.planned, true);
  });
  await ok('the player\'s expansion gives the handover\'s watts, and its intervals plan the same', () => {
    const ivs = P.expand(EXAMPLE, { ftp: 175 });
    assert.deepStrictEqual(ivs.map(x => x.target_w), [101, 223, 96, 223, 96, 223, 96, 179, 88]);
    assert.deepStrictEqual(B.planOf(B.planFromSteps(ivs)), { low: 1140, high: 300, peak: 540 });
    // the Garmin field's arrays: [start_s, dur_s, target_w, hr_lo, hr_hi]
    const arr = ivs.map(x => [x.start_s, x.dur_s, x.target_w || 0, 0, 0]);
    assert.deepStrictEqual(B.planOf(B.planFromSteps(arr)), { low: 1140, high: 300, peak: 540 });
  });
  await ok('a free step fills no bucket; a heart-rate band goes by its middle; a ramp by the middle of its ends', () => {
    const free = [{ kind: 'step', dur_s: 3600, target: { type: 'free' } }];
    const p = B.planFromSteps(free); assert.deepStrictEqual(B.planOf(p), { low: 0, high: 0, peak: 0 }); assert.strictEqual(p.planned, false);
    assert.deepStrictEqual(B.planOf(B.planFromSteps([{ dur_s: 240, target: { type: 'hr', lo: 139, hi: 147 } }])), { low: 0, high: 0, peak: 240 });
    assert.deepStrictEqual(B.planOf(B.planFromSteps([{ dur_s: 240, target: { type: 'hr', lo: 110, hi: 122 } }])), { low: 240, high: 0, peak: 0 });   // middle 116: LOW
    assert.deepStrictEqual(B.planOf(B.planFromSteps([{ dur_s: 240, target: { type: 'hr', lo: 112, hi: 124 } }])), { low: 0, high: 240, peak: 0 });   // middle 118: HIGH
    assert.deepStrictEqual(B.planOf(B.planFromSteps([{ dur_s: 600, target: { type: 'ramp', from: 50, to: 100 } }], 175)), { low: 600, high: 0, peak: 0 });   // 75% of 175 = 131 W
  });
  await ok('the due marker: how much of each bucket the plan has reached by a point in the ride', () => {
    const p = B.planFromSteps(EXAMPLE, 175);
    assert.deepStrictEqual(p.dueAt(0), { low: 0, high: 0, peak: 0 });
    assert.deepStrictEqual(p.dueAt(300), { low: 300, high: 0, peak: 0 });
    assert.deepStrictEqual(p.dueAt(400), { low: 300, high: 0, peak: 100 });
    assert.deepStrictEqual(p.dueAt(1380), { low: 840, high: 0, peak: 540 });
    assert.deepStrictEqual(p.dueAt(1500), { low: 840, high: 120, peak: 540 });
    assert.deepStrictEqual(p.dueAt(99999), { low: 1140, high: 300, peak: 540 });
  });
  await ok('the ride in seconds per bucket, from samples in each shape it arrives in', () => {
    const rows = [{ w: 100 }, { w: 0, hr: 160 }, { w: 180 }, { w: 220 }, { w: null, hr: 120 }, { w: null, hr: null }];
    assert.deepStrictEqual(B.actualFromSamples(rows), { low: 2, high: 2, peak: 1, total: 5 });
    assert.deepStrictEqual(B.actualFromSamples({ p: [100, 0, 180, 220, null, null], h: [null, 160, null, null, 120, null] }), { low: 2, high: 2, peak: 1, total: 5 });
    assert.deepStrictEqual(B.actualFromSamples({ watts: [210, 210], heartrate: [100, 100] }), { low: 0, high: 0, peak: 2, total: 2 });
  });
  await ok('other lines move every answer', () => {
    const L = { vt1_w: 180, vt2_w: 220, vt1_hr: 120, vt2_hr: 142 };
    assert.strictEqual(B.bucketOf({ w: 175 }, L), 0); assert.strictEqual(B.bucketOf({ hr: 140 }, L), 1);
    assert.deepStrictEqual(B.planOf(B.planFromSteps(EXAMPLE, 175, L)), { low: 1440, high: 0, peak: 540 });   // 179 W is LOW under a 180 W VT1
  });
  await ok('the thresholds store: defaults until a test is entered, the newest on or before a day after', async () => {
    const d0 = await T.current('2026-11-07');
    assert.strictEqual(d0.vt1_w, 169); assert.strictEqual(d0.vt2_hr, 139); assert.strictEqual(d0.source, 'Tymewear');
    await T.set({ date: '2026-10-01', vt1_w: 172, vt2_w: 210, vt1_hr: 118, vt2_hr: 140 });
    assert.strictEqual((await T.current('2026-09-30')).vt1_w, 169);     // before the test: the defaults
    assert.strictEqual((await T.current('2026-10-05')).vt1_w, 172);
    const L = await B.currentLines('2026-10-05'); assert.strictEqual(L.vt2_w, 210); assert.strictEqual(L.date, '2026-10-01');
    await T.set({ date: '2026-10-01', vt1_w: 170, vt2_w: 209, vt1_hr: 117, vt2_hr: 139 });   // the same date again replaces it
    assert.strictEqual((await T.all()).history.length, 1); assert.strictEqual((await T.current('2026-10-05')).vt1_w, 170);
    assert.strictEqual(await T.remove('2026-10-01'), true); assert.strictEqual((await T.current('2026-10-05')).vt1_w, 169);
  });
  await ok('the store refuses a VT1 at or over VT2, a number out of range, and a future date', () => {
    const bad = b => { try { T.check(b); return null; } catch (e) { return e.status; } };
    assert.strictEqual(bad({ date: '2026-10-01', vt1_w: 210, vt2_w: 208, vt1_hr: 117, vt2_hr: 139 }), 400);
    assert.strictEqual(bad({ date: '2026-10-01', vt1_w: 169, vt2_w: 208, vt1_hr: 140, vt2_hr: 139 }), 400);
    assert.strictEqual(bad({ date: '2026-10-01', vt1_w: 'x', vt2_w: 208, vt1_hr: 117, vt2_hr: 139 }), 400);
    assert.strictEqual(bad({ date: '2099-01-01', vt1_w: 169, vt2_w: 208, vt1_hr: 117, vt2_hr: 139 }), 400);
  });
  await ok('a session\'s buckets: the lines, the colours and the plan, null when nothing is planned', () => {
    const s = B.sessionBuckets(EXAMPLE, Object.assign({}, B.LINES, { date: '2026-08-14', source: 'Tymewear' }));
    assert.deepStrictEqual(s.buckets_plan, { low: 1140, high: 300, peak: 540 });
    assert.strictEqual(s.colours.peak, '#E00000'); assert.strictEqual(s.lines.vt2_w, 208); assert.strictEqual(s.lines.source, 'Tymewear');
    assert.strictEqual(B.sessionBuckets([{ dur_s: 3600, target: { type: 'free' } }], B.LINES).buckets_plan, null);
  });
  await ok('a Strava ride\'s seconds: stopped time counts nowhere, and estimated power is not power', () => {
    const RD = require('./rides');
    const s = RD.streamSeconds([0, 1, 2, 10, 11], [250, 250, 0, 100, 100], [150, 150, 150, 110, 110], true);
    assert.strictEqual(s.length, 10);                                  // 0..7 (a gap of five seconds or less is coasting), then 10, 11; 8 and 9 are stopped
    assert.deepStrictEqual(B.actualFromSamples(s), { low: 8, high: 0, peak: 2, total: 10 });
    const noMeter = RD.streamSeconds([0, 1, 2], [300, 300, 300], [120, 120, 120], false);
    assert.deepStrictEqual(B.actualFromSamples(noMeter), { low: 0, high: 3, peak: 0, total: 3 });   // the heart rate decides
    assert.strictEqual(RD.isBucketRide({ type: 'Run' }), false); assert.strictEqual(RD.isBucketRide({ type: 'WeightTraining' }), false);
    assert.strictEqual(RD.isBucketRide({ type: 'VirtualRide' }), true); assert.strictEqual(RD.isBucketRide({ type: 'Ride' }), true);
  });
  await ok('the calendar: a planned ride carries its plan, a run none, and a ride its seconds beside the plan it answers', async () => {
    const tz = require('./tz'), W = require('./workouts'), day = tz.shiftKey(tz.todayKey(), -1);
    mem['plan-workouts'] = { workouts: {
      w_vo2: { id: 'w_vo2', date: day, time: '07:00', sport: 'VirtualRide', name: 'VO2 example', steps: EXAMPLE, created: '2026-01-01T00:00:00Z' },
      w_run: { id: 'w_run', date: day, time: '17:00', sport: 'Run', name: 'Easy run', steps: [step(1800, 60)], created: '2026-01-01T00:00:00Z' } } };
    const start = tz.zonedToUTC(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), 7, 2).getTime();
    const S = { t: [], p: [], c: [], h: [], s: [], tg: [], e: [], i: [] };
    for (let t = 0; t < 600; t++) { S.t.push(t); S.p.push(t < 300 ? 120 : t < 420 ? 190 : 230); S.c.push(90); S.h.push(130); S.s.push(30); }
    const sum = P.summarize({ start_ms: start, name: 'VO2 example', ftp: 175, workout_id: 'w_vo2' }, P.cleanSamples(S));
    mem[P.rideKey(sum.id)] = { summary: sum, samples: P.cleanSamples(S) };
    mem[P.INDEX] = { rides: [sum] };
    const cal = await W.calendar(day, day);
    const d = cal.days[0];
    const vo2 = d.planned.find(w => w.id === 'w_vo2'), run = d.planned.find(w => w.id === 'w_run');
    assert.deepStrictEqual(vo2.buckets_plan, { low: 1140, high: 300, peak: 540 });
    assert.strictEqual(run.buckets_plan, undefined);
    const r = d.done.find(x => x.source === 'player');
    assert.ok(r, 'the player ride is on the day');
    assert.strictEqual(r.plan_wid, 'w_vo2');
    assert.deepStrictEqual({ low: r.buckets.low, high: r.buckets.high, peak: r.buckets.peak }, { low: 300, high: 120, peak: 180 });
  });
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
