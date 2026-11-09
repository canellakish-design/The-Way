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
    // a ride by feel is a Zone 1 ride (9 Nov 2026): it plans its whole time LOW, and its free steps go to the Edge
    // as the Zone 1 heart-rate band, so the field's bars show the Zone 1 target and its due line fills
    mem['plan-workouts'] = { workouts: { w_z1: { id: 'w_z1', date: today, time: '23:00', sport: 'VirtualRide', name: 'Zone 1, 120 min', steps: [{ kind: 'step', label: 'Zone 1', dur_s: 7200, target: { type: 'free' } }] } } };
    const s3 = await G.sessionToday(), v1 = s3.lines.vt1_hr;
    assert.deepStrictEqual(s3.buckets_plan, { low: 7200, high: 0, peak: 0 }); assert.deepStrictEqual(s3.steps, [[0, 7200, 0, v1 - 20, v1 - 1]]);
    // a mountain bike ride with no target the same: 90 min of Zone 1 to fill
    mem['plan-workouts'] = { workouts: { w_mtb: { id: 'w_mtb', date: today, time: '23:00', sport: 'Ride', name: 'Mountain bike, 90 min', steps: [{ kind: 'step', label: 'Bike handling', dur_s: 5400, target: { type: 'free' }, cadence: null }] } } };
    const s4 = await G.sessionToday();
    assert.deepStrictEqual(s4.buckets_plan, { low: 5400, high: 0, peak: 0 });
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
  await ok('next_event: the soonest timed event after now, never training, never all-day, short title', async () => {
    const now = Date.parse('2026-11-09T14:00:00Z');
    const ev = [
      { summary: 'Day 4', start: '2026-11-09', end: '2026-11-10', allDay: true, category: 'busy' },
      { summary: 'Earlier meeting', start: '2026-11-09T08:00:00-05:00', allDay: false, category: 'work' },
      { summary: 'Z1 trainer 60 min', start: '2026-11-09T09:30:00-05:00', allDay: false, category: 'training' },
      { summary: 'Push', start: '2026-11-09T09:40:00-05:00', allDay: false, category: 'busy', workout_id: 'w_x' },
      { summary: '(CP) World History I (Sec. G1)', start: '2026-11-09T11:25:00-05:00', allDay: false, category: 'work' },
      { summary: '(CP) World History I (Sec. F2)', start: '2026-11-09T10:30:00-05:00', allDay: false, category: 'work' },
    ];
    const x = G.nextEvent(ev, now);
    assert.strictEqual(x.start, Date.parse('2026-11-09T10:30:00-05:00') / 1000);
    assert.strictEqual(x.title, 'World History I');
    assert.strictEqual(G.nextEvent([{ summary: 'Junior-Senior Flag Football Game', start: '2026-11-10T11:30:00-05:00' }], now).title, 'Junior-Senior Flag');
    assert.ok(x.title.length <= 22);
    assert.strictEqual(G.nextEvent([], now), null);
    // other teams' calendars and the school-wide calendar never count down; his own team's does
    const cals = [
      { summary: 'U17 G MARYLAND UNITED ECNL - Practice', start: '2026-11-09T09:10:00-05:00', calendar: 'U17 G MARYLAND UNITED ECNL' },
      { summary: 'Office Hours', start: '2026-11-09T09:20:00-05:00', calendar: 'Upper School' },
      { summary: 'U16 G MARYLAND UNITED ECNL - Practice', start: '2026-11-09T09:30:00-05:00', calendar: 'U16 G MARYLAND UNITED ECNL' },
    ];
    assert.strictEqual(G.nextEvent(cals, now).start, Date.parse('2026-11-09T09:30:00-05:00') / 1000);
    assert.strictEqual(G.nextEvent(ev.slice(0, 4), now), null);
  });
  await ok('session/today carries next_event from the schedule\'s events, and null without one', async () => {
    const C = require('./calendar'); const real = C.eventsBetween;
    C.eventsBetween = async () => [];
    assert.strictEqual((await G.sessionToday()).next_event, null);
    const soon = new Date(Date.now() + 3600e3).toISOString();
    C.eventsBetween = async () => [{ summary: 'Zoom: Girls staff', start: soon, allDay: false, category: 'work' }];
    const s = await G.sessionToday();
    assert.deepStrictEqual(s.next_event, { start: Math.floor(Date.parse(soon) / 1000), title: 'Zoom: Girls staff' });
    C.eventsBetween = async () => { throw new Error('no calendar'); };
    assert.strictEqual((await G.sessionToday()).next_event, null);   // a dead calendar never breaks the field's session
    C.eventsBetween = real;
  });
  await ok('extras: fuel prompts follow the plan\'s on-bike rule, a hard session is always fed, short easy rides get none', () => {
    const X = require('./garmin-extras');
    assert.strictEqual(X.fuelPlan('Z1 trainer 60 min', 60), null);
    assert.deepStrictEqual(X.fuelPlan('Z1 road 120 min', 120), { every_min: 20, grams: 20, product: 'Tailwind', start_min: 20, g_per_h: 60 });
    assert.strictEqual(X.fuelPlan('Z1 road 90 min', 90).grams, 10);
    assert.strictEqual(X.fuelPlan('Long Z1', 180).grams, 30);
    assert.ok(X.fuelPlan('VO2 4 × 4 min · heart rate 139–147', 50).grams > 0);
  });
  await ok('extras: sunset at the SoccerPlex on 13 Nov is about 4:55 p.m., VO2 targets only on VO2 days, the Plex needs 45 minutes', () => {
    const X = require('./garmin-extras');
    const ss = X.sunsetEpoch('2026-11-13', X.SOCCERPLEX.lat, X.SOCCERPLEX.lon);
    const local = new Date(ss * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    const mins = (h => (+h[0] % 12 + 12) * 60 + +h[1])(local.replace(/\s*PM/, '').split(':'));
    assert.ok(Math.abs(mins - (16 * 60 + 55)) <= 6, 'sunset ' + local);
    assert.deepStrictEqual(X.vo2Of('VO2 4 × 4 min · heart rate 139–147'), { hr_floor: 147, goal_min: [8, 12] });
    assert.strictEqual(X.vo2Of('Z1 trainer 60 min'), null);
    assert.strictEqual(X.turnBuffer('Ride from the SoccerPlex lot').buffer_min, 45);
    assert.strictEqual(X.turnBuffer('Home trainer').buffer_min, 30);
    assert.strictEqual(X.eatBefore('EAT\nBefore: lunch at the fields by 1:30, carbs in it.\nOn the bike: x'), 'lunch at the fields by 1:30, carbs in it.');
  });
  await ok('extras: the tank is the session\'s start from the live fuel model, else now', () => {
    const X = require('./garmin-extras');
    const e = { full_g: 110, legs_full_g: 320, now: { pct: 50, legs_pct: 60 }, starts: [{ name: 'Z1 road 120 min', pct: 80, legs_pct: 75 }] };
    assert.deepStrictEqual(X.tankFor(e, 'Z1 road 120 min'), { quick_pct: 80, legs_pct: 75, quick_g: 88, legs_g: 240 });
    assert.strictEqual(X.tankFor(e, 'other').quick_pct, 50);
    assert.strictEqual(X.tankFor(null, 'x'), null);
  });
  await ok('extras: a fuel press logs on-bike carbs once; a rating keeps legs and breathing', async () => {
    const X = require('./garmin-extras'); const food = require('./food');
    const logged = []; const realAdd = food.addKnown, realRate = food.rateLegs;
    food.addKnown = async b => { logged.push(b); return { id: 'f_test' + logged.length }; };
    food.rateLegs = async () => ({ ok: true });
    const r1 = await X.logFuel({ ride_id: '1794', t: 1200, grams: 20 });
    const r2 = await X.logFuel({ ride_id: '1794', t: 1200, grams: 20 });
    assert.strictEqual(r1.entry, 'f_test1'); assert.strictEqual(r2.duplicate, true); assert.strictEqual(logged.length, 1);
    assert.strictEqual(logged[0].carbs_g, 20); assert.strictEqual(logged[0].kcal, 80);
    const r = await X.rateRide({ ride_id: '1794', legs: 4, breathing: 3, name: 'Z1 road 120 min' });
    assert.strictEqual(r.rating.legs, 4); assert.strictEqual(r.rating.breathing, 3);
    let bad = null; try { await X.rateRide({ ride_id: '1794', legs: 9 }); } catch (e) { bad = e; }
    assert.ok(bad && bad.status === 400);
    food.addKnown = realAdd; food.rateLegs = realRate;
  });
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
