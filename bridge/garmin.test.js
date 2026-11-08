// node bridge/garmin.test.js — the Edge's data field recording into the site (garmin.js): batches of
// seconds land in the player's store as one ride, holes filled, a batch sent twice adds nothing, and
// the calendar counts the ride done, outdoors.
const assert = require('assert');
const storage = require('./storage');
const mem = {};
storage.getJSON = async (k, f) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : f);
storage.setJSON = async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); };
const G = require('./garmin');
const P = require('./player');
const { playerRideAsDone } = require('./workouts');

let n = 0;
function ok(name, fn) { return Promise.resolve().then(fn).then(() => { n++; console.log('ok ' + name); }); }

const START = Math.floor(Date.now() / 1000) - 7200;   // seconds since the epoch, two hours ago
const batch = (from, count, done) => ({ id: START, device: 'edge', name: 'Zone 1, 120 min', workout_id: 'w_test',
  t: Array.from({ length: count }, (_, i) => from + i), p: Array.from({ length: count }, () => 150), h: Array.from({ length: count }, (_, i) => 110 + (i % 3)),
  c: Array.from({ length: count }, () => 85), s: Array.from({ length: count }, () => 28.8), done: !!done });

(async () => {
  await ok('a first batch under two minutes is kept but not yet counted', async () => {
    const r = await G.receive(batch(0, 30));
    assert.strictEqual(r.ok, true); assert.strictEqual(r.counted, false); assert.strictEqual(r.seconds, 30);
    assert.ok(!mem[P.INDEX], 'nothing in the index yet');
  });
  await ok('from two minutes the ride is in the player\'s store and the index, live', async () => {
    await G.receive(batch(30, 30)); await G.receive(batch(60, 30)); const r = await G.receive(batch(90, 30));
    assert.strictEqual(r.counted, true); assert.strictEqual(r.seconds, 120);
    const idx = mem[P.INDEX]; assert.strictEqual(idx.rides.length, 1);
    const row = idx.rides[0];
    assert.strictEqual(row.id, START * 1000); assert.strictEqual(row.name, 'Zone 1, 120 min'); assert.strictEqual(row.device, 'edge'); assert.strictEqual(row.live, true);
    assert.strictEqual(row.avg_w, 150); assert.strictEqual(row.seconds, 120); assert.strictEqual(row.workout_id, 'w_test');
    const rec = mem[P.rideKey(START * 1000)]; assert.strictEqual(rec.samples.t.length, 120); assert.strictEqual(rec.samples.s[0], 28.8);
  });
  await ok('a batch sent twice adds nothing', async () => {
    const r = await G.receive(batch(90, 30));
    assert.strictEqual(r.added, 0); assert.strictEqual(r.seconds, 120);
  });
  await ok('a hole in the seconds is filled, empty, so the columns stay one a second', async () => {
    const r = await G.receive(batch(150, 30));
    assert.strictEqual(r.seconds, 180); const rec = mem[P.rideKey(START * 1000)];
    assert.strictEqual(rec.samples.t[120], 120); assert.strictEqual(rec.samples.p[125], null); assert.strictEqual(rec.samples.p[150], 150);
  });
  await ok('the done batch closes the ride, and the calendar counts it as an outdoor ride', async () => {
    const r = await G.receive(batch(180, 10, true));
    assert.strictEqual(r.done, true);
    const row = mem[P.INDEX].rides[0]; assert.strictEqual(row.live, false);
    const d = playerRideAsDone(row, { ftp: 175 });
    assert.strictEqual(d.type, 'Ride'); assert.strictEqual(d.source, 'player'); assert.strictEqual(d.name, 'Zone 1, 120 min'); assert.strictEqual(d.minutes, 3);
    assert.ok(d.tss > 0);
  });
  await ok('a bad id is refused', async () => {
    let err = null; try { await G.receive({ id: 12, t: [0] }); } catch (e) { err = e; }
    assert.ok(err && err.status === 400);
  });
  await ok('the session serves the field its lines, colours and plan; a new threshold reaches it with no rebuild', async () => {
    const tz = require('./tz'), today = tz.todayKey();
    const step = (dur_s, lo, hi) => ({ kind: 'step', label: '', dur_s, target: { type: 'power', lo, hi: hi == null ? lo : hi }, cadence: null });
    mem['plan-workouts'] = { workouts: { w_bk: { id: 'w_bk', date: today, time: '23:00', sport: 'VirtualRide', name: 'Bucket test',
      steps: [step(300, 55, 60), { kind: 'repeat', label: '3 x', count: 3, steps: [step(180, 125, 130), step(180, 55)] }, step(300, 100, 105), step(300, 50)] } } };
    const s = await G.sessionToday();
    assert.deepStrictEqual(s.steps.map(x => x[2]), [101, 223, 96, 223, 96, 223, 96, 179, 88]);
    assert.deepStrictEqual(s.buckets_plan, { low: 1140, high: 300, peak: 540 });
    assert.deepStrictEqual(s.colours, { low: '#0099FF', high: '#FFAA00', peak: '#E00000' });
    assert.strictEqual(s.lines.vt1_w, 169); assert.strictEqual(s.lines.vt2_w, 208); assert.strictEqual(s.lines.vt2_hr, 139);
    await require('./thresholds').set({ date: today, vt1_w: 180, vt2_w: 220, vt1_hr: 118, vt2_hr: 141, source: 'Tymewear' });
    const s2 = await G.sessionToday();
    assert.strictEqual(s2.lines.vt1_w, 180); assert.strictEqual(s2.vt2_hr, 141);
    assert.deepStrictEqual(s2.buckets_plan, { low: 1440, high: 0, peak: 540 });   // 179 W is under the new 180 W VT1: LOW
    // a ride-by-feel session plans nothing, and its free steps carry no band
    mem['plan-workouts'] = { workouts: { w_z1: { id: 'w_z1', date: today, time: '23:00', sport: 'VirtualRide', name: 'Zone 1, 120 min', steps: [{ kind: 'step', label: 'Zone 1', dur_s: 7200, target: { type: 'free' } }] } } };
    const s3 = await G.sessionToday();
    assert.strictEqual(s3.buckets_plan, null); assert.deepStrictEqual(s3.steps, [[0, 7200, 0, 0, 0]]);
    await require('./thresholds').remove(today);
  });
  await ok('the PC\'s build reports: kept, the last 30, and the build on the Edge remembered', async () => {
    const r = await G.noteBuild({ ok: true, commit: 'abc123', tree: 'tree1', built: true, bytes: 19126, copied: 'Edge 1050 (MTP) GARMIN\\Apps', mode: 'auto', host: 'ZWIFT-LAB' });
    assert.strictEqual(r.ok, true); assert.strictEqual(r.bytes, 19126);
    await G.noteBuild({ ok: true, commit: 'def456', tree: 'tree2', built: true, bytes: 19200, copied: null, note: 'the Edge is not plugged in' });
    const d = mem['garmin-build'];
    assert.strictEqual(d.runs.length, 2); assert.strictEqual(d.on_edge.commit, 'abc123');   // the newer build did not reach the Edge
    for (let i = 0; i < 40; i++) await G.noteBuild({ ok: true });
    assert.strictEqual(mem['garmin-build'].runs.length, 30);
  });
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
