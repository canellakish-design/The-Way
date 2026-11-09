// node bridge/chain.test.js
const assert = require('assert');
const C = require('./chain');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('states: one rule a link', () => {
  assert.strictEqual(C.stateOf('sleep', 7.2), 'good'); assert.strictEqual(C.stateOf('sleep', 6.5), 'warn'); assert.strictEqual(C.stateOf('sleep', 5.9), 'bad');
  assert.strictEqual(C.stateOf('food', 84), 'good'); assert.strictEqual(C.stateOf('water', 55), 'good'); assert.strictEqual(C.stateOf('water', 30), 'warn'); assert.strictEqual(C.stateOf('water', 10), 'bad'); assert.strictEqual(C.stateOf('work', 0.9), 'good'); assert.strictEqual(C.stateOf('work', 0.5), 'bad');
  assert.strictEqual(C.stateOf('weight', -0.8), 'good'); assert.strictEqual(C.stateOf('weight', -1.2), 'good'); assert.strictEqual(C.stateOf('weight', -0.5), 'warn'); assert.strictEqual(C.stateOf('weight', 0.1), 'warn'); assert.strictEqual(C.stateOf('weight', 1.2), 'bad');
  assert.strictEqual(C.stateOf('weight', null), 'none');
});

ok('verdict: the first link from the left that is off is the break; all good and flat blames the target', () => {
  const L = { sleep: { week: 7.4, state: 'good' }, food: { week: 71, state: 'warn', days_on: 3, days_logged: 7 }, micros: { week: 90, state: 'good', gaps: [] }, water: { week: 90, state: 'good' }, work: { week: 95, state: 'good', done_min: 300, planned_min: 315 }, lift: { week: 80, state: 'good', sessions: 4, target: 5 }, recovery: { week: 72, state: 'good' }, weight: { week: 0.2, state: 'warn' } };
  const v = C.verdict(L);
  assert.strictEqual(v.break_at, 'food'); assert.ok(/weak at macros: 3 of 7 days on plan/.test(v.text), v.text);   // amber is a weak link, red a break assert.ok(/Weight flat/.test(v.text), v.text);
  const all = Object.assign({}, L, { food: { week: 88, state: 'good', days_on: 6, days_logged: 7 } });
  const v2 = C.verdict(all);
  assert.strictEqual(v2.break_at, null); assert.ok(/check the calorie target/.test(v2.text), v2.text);
  const down = Object.assign({}, all, { weight: { week: -0.9, state: 'good' } });
  assert.ok(/Chain holds\. Weight down 0\.9 lb\/wk, on pace/.test(C.verdict(down).text), C.verdict(down).text);
  const slow = Object.assign({}, all, { weight: { week: -0.4, state: 'warn' } });
  assert.ok(/under 1 lb.*check the calorie target/.test(C.verdict(slow).text), C.verdict(slow).text);
  const sleepy = Object.assign({}, all, { sleep: { week: 6.0, state: 'bad' } });
  assert.strictEqual(C.verdict(sleepy).break_at, 'sleep');
  const lowMicro = Object.assign({}, all, { micros: { week: 55, state: 'bad', gaps: ['iron', 'calcium'] } });
  const v3 = C.verdict(lowMicro); assert.strictEqual(v3.break_at, 'micros'); assert.ok(/low iron, calcium/.test(v3.text), v3.text);
  assert.deepStrictEqual(C.ORDER, ['plan', 'sleep', 'water', 'food', 'micros', 'lift', 'fuel', 'work', 'recovery', 'weight']);
  assert.strictEqual(C.stateOf('fuel', 0.95), 'good'); assert.strictEqual(C.stateOf('fuel', 0.85), 'warn'); assert.strictEqual(C.stateOf('fuel', 0.5), 'bad');   // 100% is the plan now assert.strictEqual(C.stateOf('plan', 0.9), 'good'); assert.strictEqual(C.stateOf('plan', 0.6), 'warn'); assert.strictEqual(C.stateOf('plan', 0.2), 'bad');
  const unplanned = Object.assign({}, all, { plan: { week: 20, state: 'bad', ride_min: 60, ride_target_min: 360, lifts: 1, untimed: 1 } });
  assert.ok(/breaks at planning: 60 of 360 ride min placed, 1 of 5 lifts, 1 untimed/.test(C.verdict(unplanned).text), C.verdict(unplanned).text);
  const noLift = Object.assign({}, all, { lift: { week: 20, state: 'bad', sessions: 1, target: 5 } });
  assert.ok(/breaks at lifting: 1 of 5\./.test(C.verdict(noLift).text));
  const noRide = Object.assign({}, all, { work: { week: 40, state: 'bad', done_min: 120, planned_min: 300 } });
  assert.ok(/breaks at riding: 120 of 300 min/.test(C.verdict(noRide).text));
  assert.strictEqual(C.stateOf('lift', 0.8), 'good'); assert.strictEqual(C.stateOf('lift', 0.6), 'warn'); assert.strictEqual(C.stateOf('lift', 0), 'bad');
});

ok('recovery: the week against the rider\'s own band; a dip is one step, two is red; no band under fourteen nights', () => {
  const base = []; for (let i = 0; i < 40; i++) base.push(50 * Math.exp(((i % 7) - 3) * 0.03));
  const inBand = C.recoveryState({ hrv_week: [50, 52, 49, 51, 50, 53, 48], hrv_base: base, rhr_week: 52, rhr_base: 52, rhr_sd: 2, sleep_week: 7 });
  assert.strictEqual(inBand.state, 'good');
  const up = C.recoveryState({ hrv_week: [58, 60, 59, 61, 57, 60, 58], hrv_base: base, rhr_week: 50, rhr_base: 52, rhr_sd: 2, sleep_week: 7 });
  assert.strictEqual(up.state, 'good'); assert.ok(up.pct > 10, 'pct ' + up.pct);
  const dip = C.recoveryState({ hrv_week: [47, 46, 48, 47, 46, 47, 48], hrv_base: base, rhr_week: 52, rhr_base: 52, rhr_sd: 2, sleep_week: 7 });
  assert.strictEqual(dip.state, 'warn', JSON.stringify(dip));
  const red = C.recoveryState({ hrv_week: [42, 41, 43, 42, 40, 42, 41], hrv_base: base, rhr_week: 56, rhr_base: 52, rhr_sd: 2, sleep_week: 6 });
  assert.strictEqual(red.state, 'bad');
  const few = C.recoveryState({ hrv_week: [50, 52], hrv_base: base.slice(0, 5) });
  assert.strictEqual(few.state, 'none');
  const L = { sleep: { week: 7.4, state: 'good' }, water: { week: 90, state: 'good' }, food: { week: 88, state: 'good', days_on: 6, days_logged: 7 }, micros: { week: 90, state: 'good', gaps: [] }, lift: { week: 20, state: 'bad', sessions: 1, target: 5 }, work: { week: 30, state: 'bad', done_min: 60, planned_min: 200 }, recovery: { week: 4, state: 'good', why: 'HRV inside your band (+4%)' }, weight: { week: 0.1, state: 'warn' } };
  assert.ok(/little asked/.test(C.verdict(L).text), C.verdict(L).text);
});

ok('macros box: today\'s kcal and protein against the targets, the Food page\'s own numbers, moving with every log', () => {
  const before = C.macrosToday({ kcal: 2009, protein_g: 140, target_kcal: 2190, target_protein_g: 170, due_protein_g: 150, logged: true });
  assert.strictEqual(before.kcal_today, 2009); assert.strictEqual(before.kcal_target, 2190); assert.strictEqual(before.protein_today, 140); assert.strictEqual(before.protein_target, 170);
  assert.strictEqual(before.today_state, 'good');
  // a 410 kcal log and then a 502 kcal log, already over: the number moves with each, and the tone goes red past 20% over
  const one = C.macrosToday({ kcal: 2419, protein_g: 160, target_kcal: 2190, target_protein_g: 170, due_protein_g: 170, logged: true });
  const two = C.macrosToday({ kcal: 2921, protein_g: 180, target_kcal: 2190, target_protein_g: 170, due_protein_g: 170, logged: true });
  assert.strictEqual(one.kcal_today, 2419); assert.strictEqual(one.today_state, 'warn');
  assert.strictEqual(two.kcal_today, 2921); assert.strictEqual(two.today_state, 'bad');
  // protein short of what is due by now
  assert.strictEqual(C.macrosToday({ kcal: 900, protein_g: 40, target_kcal: 2190, target_protein_g: 170, due_protein_g: 80, logged: true }).today_state, 'bad');
  // nothing logged: no number, grey
  const none = C.macrosToday({ kcal: 0, protein_g: 0, target_kcal: 2190, target_protein_g: 170, logged: false });
  assert.strictEqual(none.kcal_today, null); assert.strictEqual(none.today_state, 'none'); assert.strictEqual(none.kcal_target, 2190);
  assert.strictEqual(C.macrosToday(null).today_state, 'none');
  // the verdict at macros names today's numbers, not the compliance average
  const L = { sleep: { week: 7.4, state: 'good' }, water: { week: 90, state: 'good' }, food: Object.assign({ week: 51, state: 'bad', days_on: 1, days_logged: 4 }, two) };
  const v = C.verdict(L); assert.strictEqual(v.break_at, 'food');
  assert.ok(/today 2,921 of 2,190 kcal, 180 of 170 g protein/.test(v.text), v.text); assert.ok(!/averaging 51/.test(v.text), v.text);
});

ok('plan link: the planning score on its own week, labelled so it cannot read as the calendar\'s done of plan', () => {
  assert.strictEqual(C.planWeekLabel('2026-11-02'), 'Nov 2 – Nov 8');
  assert.strictEqual(C.planWeekLabel('2026-12-29'), 'Dec 29 – Jan 4');
  const L = { plan: { week: 40, state: 'bad', ride_min: 60, ride_target_min: 360, lifts: 1, untimed: 0, week_label: 'Nov 2 – Nov 8' } };
  assert.ok(/placed \(Nov 2 – Nov 8\)/.test(C.verdict(L).text), C.verdict(L).text);
});

ok('lift link: the verdict reads the Lift page\'s count, "1 of 1 due" in the first week', () => {
  const L = { lift: { week: 0, state: 'bad', sessions: 0, target: 5, count_word: '0 of 1 due' } };
  assert.ok(/lifting: 0 of 1 due\./.test(C.verdict(L).text), C.verdict(L).text);
});
ok('fuel today: food and supplements not due yet are not asked for (3 a.m. before a 7:00 ride: nothing to score)', () => {
  const tz = require('./tz'), parts0 = tz.parts, today = tz.todayKey();
  tz.parts = () => ({ h: 3, mi: 25 });
  try {
    const r = { date: today, sessions: [{ name: 'Z1 trainer 60', sport: 'VirtualRide', time: '07:00', minutes: 60, planned: true, done: false, awaiting: null }],
      meals: [{ slot: 'before', time: '05:45', carbs_g: 40 }, { slot: 'on the bike', time: '07:00', carbs_g: 30 }], entries: [],
      supps: { due: [{ key: 'beetroot', time: '05:30' }] } };
    assert.deepStrictEqual(C.fuelChecks(r).map(c => c.parts.filter(p => p.kind !== 'bottle').length), [0]);
    tz.parts = () => ({ h: 6, mi: 0 });
    const kinds = C.fuelChecks(r)[0].parts.map(p => p.kind);
    assert.ok(kinds.includes('pre') && kinds.includes('supp'), kinds.join());
  } finally { tz.parts = parts0; }
});
ok('fuel: a ride scores what went in against the plan (before, on the bike, supplements); under below 100, over above', () => {
  const r = { sessions: [{ name: 'VO2 40/20s', sport: 'VirtualRide', time: '07:00', minutes: 51, done: true }],
    meals: [{ slot: 'before', time: '06:15', carbs_g: 35 }, { slot: 'on the bike', time: '07:00', carbs_g: 50 }, { slot: 'breakfast', time: '08:20', carbs_g: 90 }],
    entries: [{ time: '06:10', carbs_g: 27, kcal: 105 }, { time: '07:05', carbs_g: 50, kcal: 200, slot: 'on the bike' }, { supplement: true, key: 'beetroot', time: '04:30' }] };
  const c = C.fuelChecks(r);
  assert.strictEqual(c.length, 1);
  const p = Object.fromEntries(c[0].parts.map(x => [x.kind, x]));
  assert.strictEqual(p.pre.got_g, 27); assert.strictEqual(p.pre.plan_g, 35);
  assert.strictEqual(p.bottle.got_g, 50);
  assert.strictEqual(p.supp.due, 2); assert.strictEqual(p.supp.got, 1);          // a hard session wants bicarbonate too
  // the parts weigh as a coach would: the bottle 0.4, the food before 0.3, the meal after 0.2, the supplements 0.1
  assert.strictEqual(c[0].pct, Math.round(((27 / 35) * 0.3 + 1 * 0.4 + 0.5 * 0.1) / 0.8 * 100));
  const over = C.fuelChecks(Object.assign({}, r, { entries: r.entries.concat([{ time: '06:00', carbs_g: 60, kcal: 240 }, { supplement: true, key: 'sodium_bicarb', time: '05:30' }]) }));
  assert.ok(over[0].pct > 100, over[0].pct);
  assert.strictEqual(C.stateOf('fuel', 1.0), 'good'); assert.strictEqual(C.stateOf('fuel', 1.3), 'bad'); assert.strictEqual(C.stateOf('fuel', 0.8), 'warn');
  assert.strictEqual(C.fuelChecks({ sessions: [{ name: 'Push', sport: 'WeightTraining', time: '13:30', minutes: 55 }], meals: [], entries: [] }).length, 0);
});
console.log(n + ' passed');
