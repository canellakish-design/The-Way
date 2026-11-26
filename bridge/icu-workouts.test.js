// node bridge/icu-workouts.test.js — a workout planned in intervals.icu, as the player rides it
const assert = require('assert');
process.env.INTERVALS_ICU_API_KEY = 'k'; process.env.INTERVALS_ICU_ATHLETE_ID = 'i1';
const I = require('./icu-workouts');
const W = require('./workout-math');
const P = require('./player');
const st = { ftp: 175, lthr: 139, hr_rest: 55 };
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok ' + name); });

// the shape intervals.icu sends with resolve=true (its own FTP, 196 here, must never set the watts)
const event = { id: 98765, category: 'WORKOUT', type: 'VirtualRide', name: 'Z1 + 40/20s', start_date_local: '2026-11-26T16:00:00', description: 'easy, then 40/20s',
  workout_doc: { ftp: 196, lthr: 139, steps: [
    { duration: 600, warmup: true, ramp: true, power: { start: 50, end: 65, units: '%ftp' }, _power: { start: 98, end: 127 } },
    { duration: 1200, hr: { start: 100, end: 116, units: 'bpm' }, text: 'Hold Zone 1' },
    { reps: 3, text: '3x', steps: [ { duration: 40, power: { value: 120, units: '%ftp' }, _power: { value: 235 }, cadence: { value: 95, units: 'rpm' } }, { duration: 20, power: { value: 150, units: 'w' } } ] },
    { duration: 300, hr: { start: 70, end: 80, units: '%lthr' } },
    { duration: 300, power: { value: 2, units: 'power_zone' }, _power: { start: 98, end: 131 } },
    { duration: 120, freeride: true } ] } };

(async () => {
  await ok('each step becomes the player\'s own: ramps and % of FTP stay percentages, watts stay watts, HR in bpm', () => {
    const w = I.workoutOf(event, st);
    assert.strictEqual(w.id, 'icu-98765'); assert.strictEqual(w.date, '2026-11-26'); assert.strictEqual(w.time, '16:00');
    assert.strictEqual(w.sync.intervals_event_id, 98765, 'the ride goes back paired with the plan');
    const items = W.normItems(w.steps);
    assert.deepStrictEqual(items[0].target, { type: 'ramp', from: 50, to: 65 }); assert.strictEqual(items[0].label, 'Warm-up');
    assert.deepStrictEqual(items[1].target, { type: 'hr', lo: 100, hi: 116 });
    assert.strictEqual(items[2].kind, 'repeat'); assert.strictEqual(items[2].count, 3);
    assert.deepStrictEqual(items[2].steps[0].target, { type: 'power', lo: 120, hi: 120 }); assert.deepStrictEqual(items[2].steps[0].cadence, { lo: 95, hi: 95 });
    assert.deepStrictEqual(items[2].steps[1].target, { type: 'watts', lo: 150, hi: 150 });
    assert.deepStrictEqual(items[3].target, { type: 'hr', lo: 97, hi: 111 }, '% of LTHR from the planning LTHR 139');
    assert.deepStrictEqual(items[4].target, { type: 'watts', lo: 98, hi: 131 }, 'a zone takes the watts intervals.icu worked out');
    assert.deepStrictEqual(items[5].target, { type: 'free' });
  });
  await ok('the watts are worked out at the planning FTP 175, not intervals.icu\'s 196', () => {
    const x = P.expand(I.workoutOf(event, st).steps, st);
    const vo2 = x.find(s => s.rep === '1 of 3');
    assert.strictEqual(vo2.target_w, 210);   // 120% of 175
    assert.strictEqual(x[1].kind, 'hr'); assert.strictEqual(x[1].target_w, null); assert.deepStrictEqual(x[1].target_hr, { lo: 100, hi: 116 });
  });
  await ok('today\'s rides are read from the calendar, workouts only, lifts left out', async () => {
    const seen = [];
    const fake = async (u) => { seen.push(u); return { ok: true, json: async () => [event, Object.assign({}, event, { id: 2, type: 'WeightTraining', name: 'Lift' })] }; };
    const rides = await I.ridesOn('2026-11-26', st, { fetch: fake });
    assert.deepStrictEqual(rides.map(r => r.id), ['icu-98765']);
    assert.ok(/\/athlete\/i1\/events\?oldest=2026-11-26&newest=2026-11-26&category=WORKOUT&resolve=true$/.test(seen[0]), seen[0]);
  });
  console.log(`${n} passed`);
})().catch(e => { console.error(e); process.exit(1); });
