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
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
