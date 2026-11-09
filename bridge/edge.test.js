// node bridge/edge.test.js — the Edge 1050 beside the player (pwa/edge.js) does what the field does
const assert = require('assert');
const E = require('../pwa/edge.js'), B = require('../pwa/buckets.js');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
// today's ride: Z1 trainer 90 min (5 min settle, 82 min Zone 1, 3 min easy)
const Z1 = [{ start_s: 0, dur_s: 300, target_w: 94, kind: 'power' }, { start_s: 300, dur_s: 4920, target_w: 112, kind: 'power' }, { start_s: 5220, dur_s: 180, target_w: 88, kind: 'power' }];
const ride = (f, secs, sess) => { const e = E.create({ intervals: Z1, ftp: 175, rideId: 1, name: 'Z1 trainer 90 min', session: sess }); const evs = []; for (let t = 1; t <= secs; t++) evs.push(...e.second(Object.assign({ t, wt: t - 1 }, f(t)))); return { e, m: e.model(Date.now()), evs }; };

ok('the buckets: a Zone 1 trainer ride plans 90:00 LOW, the due line moves, the lit bucket is the one ridden', () => {
  const { m } = ride(() => ({ w: 112, hr: 105, cad: 90 }), 600);
  assert.deepStrictEqual(m.plan, [5400, 0, 0]); assert.deepStrictEqual(m.done, [600, 0, 0]); assert.strictEqual(m.due[0], 600); assert.strictEqual(m.lit, 0); assert.strictEqual(m.onPlan, 100);
});
ok('a ride by feel (the mountain bike) still plans its time LOW, and the bridge\'s plan wins when it sends one', () => {
  const e = E.create({ intervals: [{ start_s: 0, dur_s: 5400, target_w: null, kind: 'free' }], ftp: 175 });
  assert.deepStrictEqual(e.model().plan, [5400, 0, 0]);
  const e2 = E.create({ intervals: Z1, ftp: 175, session: { buckets_plan: { low: 1140, high: 300, peak: 540 }, steps: [[0, 1980, 100, 0, 0]] } });
  assert.deepStrictEqual(e2.model().plan, [1140, 300, 540]);
});
ok('decoupling: the field\'s rule (skip 10 min, halves, EF), "--" before 20:00, the tile green, yellow, red', () => {
  assert.strictEqual(ride(() => ({ w: 112, hr: 100 }), 1100).m.dec, null);
  const flat = ride(() => ({ w: 112, hr: 100 }), 2400).m; assert.strictEqual(flat.dec, 0); assert.strictEqual(flat.decColour, E.DEC.green);
  const drift = ride(t => ({ w: 112, hr: t < 1500 ? 100 : 108 }), 2400).m; assert.ok(drift.dec > 5 && drift.dec <= 10, drift.dec); assert.strictEqual(drift.decColour, E.DEC.yellow);
  assert.strictEqual(E.decColour(12), E.DEC.red);
});
ok('the Zone 1 guardrail: 30 s over 116 buzzes once, the time over is kept; drifting past 5% alerts once', () => {
  const { m, evs } = ride(t => ({ w: 112, hr: t > 100 && t <= 160 ? 121 : 105 }), 300);
  assert.strictEqual(m.z1.over, 60); assert.strictEqual(evs.filter(e => /Over 116/.test(e.text || '')).length, 1);
  const d = ride(t => ({ w: 112, hr: t < 1500 ? 100 : 112 }), 2400).evs; assert.strictEqual(d.filter(e => /Drifting 5/.test(e.text || '')).length, 1);
});
ok('fuel prompts: at 20, 40, 60 min; LAP within 5 min logs it to The Way; a missed one nags once', () => {
  const sess = { fuel: { every_min: 20, grams: 10, product: 'Tailwind', start_min: 20 }, buckets_plan: { low: 5400, high: 0, peak: 0 } };
  const e = E.create({ intervals: Z1, ftp: 175, rideId: 77, session: sess });
  let evs = []; for (let t = 1; t <= 1260; t++) evs.push(...e.second({ t, wt: t - 1, w: 112, hr: 105 }));
  assert.ok(evs.some(x => x.text === 'Fuel: Tailwind 10 g'));
  const lap = e.lap(); const post = lap.find(x => x.type === 'post'); assert.strictEqual(post.path, '/garmin/fuel'); assert.strictEqual(post.body.grams, 10); assert.strictEqual(post.body.ride_id, '77');
  for (let t = 1261; t <= 2400 + 301; t++) evs.push(...e.second({ t, wt: t - 1, w: 112, hr: 105 }));
  assert.ok(evs.some(x => x.text === 'Fuel now: Tailwind 10 g'));
  const m = e.model(); assert.strictEqual(m.fuel.eaten, 1); assert.strictEqual(m.fuel.passed, 2); assert.deepStrictEqual(m.fuel.marks.slice(0, 3), ['eaten', 'missed', 'due']);
});
ok('the fuel tank drains from the session\'s start, and logged fuel comes back in', () => {
  const sess = { tank: { quick_pct: 70, legs_pct: 80, quick_g: 77, legs_g: 256 }, buckets_plan: { low: 5400, high: 0, peak: 0 } };
  const m = ride(() => ({ w: 112, hr: 105 }), 1800, sess).m; assert.ok(m.tank.quick < 70 && m.tank.quick > 55, m.tank.quick); assert.ok(m.tank.legs < 80, m.tank.legs);
});
ok('VO2 mode swaps the bottom half: rep, time left in it, minutes above 147 of 8 to 12', () => {
  const ivs = [{ start_s: 0, dur_s: 600, target_w: 100 }, { start_s: 600, dur_s: 240, target_w: 230 }, { start_s: 840, dur_s: 240, target_w: 90 }];
  const e = E.create({ intervals: ivs, ftp: 175, session: { vo2: { hr_floor: 147, goal_min: [8, 12] } } });
  for (let t = 1; t <= 700; t++) e.second({ t, wt: t - 1, w: t > 600 ? 230 : 100, hr: t > 640 ? 150 : 120 });
  const m = e.model(); assert.strictEqual(m.vo2.rep, 2); assert.strictEqual(m.vo2.left, 140); assert.strictEqual(m.vo2.above, 60); assert.strictEqual(m.vo2.reached, false);
});
ok('the rating in the last 5 minutes: LAP presses count, 10 s each, then it goes to The Way', () => {
  const e = E.create({ intervals: Z1, ftp: 175, rideId: 5 }); const out = [];
  for (let t = 1; t <= 5110; t++) out.push(...e.second({ t, wt: t - 1, w: 112, hr: 105 }));
  assert.ok(out.some(x => x.text === 'Legs? press lap 1 to 5'));
  e.lap(); e.lap(); e.lap(); e.lap();
  for (let t = 5111; t <= 5125; t++) out.push(...e.second({ t, wt: t - 1, w: 112, hr: 105 }));
  e.lap(); e.lap(); e.lap();
  for (let t = 5126; t <= 5140; t++) out.push(...e.second({ t, wt: t - 1, w: 112, hr: 105 }));
  const p = out.find(x => x.type === 'post'); assert.deepStrictEqual([p.path, p.body.legs, p.body.breathing], ['/garmin/rating', 4, 3]);
});
ok('the energy line and the pre-ride screen', () => {
  const sess = { energy: { base_burn: 2514, eaten_kcal: 1020, day_target_net: -450 }, recovery: 67, eat_before: 'Lunch covers it', buckets_plan: { low: 5400, high: 0, peak: 0 } };
  const pre = E.create({ intervals: Z1, ftp: 175, session: sess }).model(); assert.deepStrictEqual(pre.pre, { recovery: 67, eat: 'Lunch covers it' });
  const m = ride(() => ({ w: 112, hr: 105 }), 3600, sess).m; assert.strictEqual(m.kcal, 403); assert.strictEqual(m.eatAfter, Math.round((-450 + 2514 + 403.2 - 1020) / 50) * 50); assert.strictEqual(m.pre, null);
});
ok('the next event counts down every second, as on the Edge', () => {
  const now = Date.now(), e = E.create({ intervals: Z1, session: { next_event: { start: Math.floor(now / 1000) + 3725, title: 'U16 G HUDL training' } } });
  assert.strictEqual(e.model(now).next, 'U16 G HUDL training  -1:02:05');
});
console.log(n + ' passed');
