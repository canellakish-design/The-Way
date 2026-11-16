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
  assert.deepStrictEqual(C.ORDER, ['plan', 'sleep', 'water', 'food', 'micros', 'lift', 'fuel', 'work', 'recovery', 'weight', 'power']);
  assert.strictEqual(C.stateOf('fuel', 0.95), 'good'); assert.strictEqual(C.stateOf('fuel', 0.85), 'good'); assert.strictEqual(C.stateOf('fuel', 0.65), 'warn'); assert.strictEqual(C.stateOf('fuel', 0.5), 'bad');   // the share of what the rides asked for: 80 green, 60 amber assert.strictEqual(C.stateOf('plan', 0.9), 'good'); assert.strictEqual(C.stateOf('plan', 0.6), 'warn'); assert.strictEqual(C.stateOf('plan', 0.2), 'bad');
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
const hard = (o) => Object.assign({ name: 'VO2 40/20s', sport: 'VirtualRide', time: '07:00', minutes: 51, done: true, rx: { kind: 'hard', before_g: 39, during_g: 50, after_g: 39, after_protein_g: 45 } }, o || {});
const easy = (o) => Object.assign({ name: 'Zone 1, 60 min', sport: 'VirtualRide', time: '17:00', minutes: 60, done: true, rx: { kind: 'light', before_g: 25, during_g: 0, after_g: 39, after_protein_g: 45 } }, o || {});
const tankOf = (s, pct, legs) => ({ starts: [{ name: s.name, time: s.time, pct, need: s.rx.kind === 'hard' ? 60 : 25, legs_pct: legs == null ? 90 : legs, need_legs: s.rx.kind === 'hard' ? 60 : 0 }] });
ok('fuel today: a ride still ahead is not scored (3 a.m. before a 7:00 ride: nothing), and its after part waits for its window', () => {
  const tz = require('./tz'), parts0 = tz.parts, today = tz.todayKey(), s = hard({ done: false });
  const r = { date: today, sessions: [s], energy: tankOf(s, 80), entries: [{ time: '05:45', carbs_g: 40, kcal: 200 }] };
  try {
    tz.parts = () => ({ h: 3, mi: 25 }); assert.strictEqual(C.fuelChecks(r).length, 0);
    tz.parts = () => ({ h: 8, mi: 0 }); const kinds = C.fuelChecks(Object.assign({}, r, { sessions: [hard()] }))[0].parts.map(p => p.kind);
    assert.ok(kinds.includes('pre') && kinds.includes('bottle') && kinds.includes('supp') && !kinds.includes('after'), kinds.join());
  } finally { tz.parts = parts0; }
});
ok('fuel: a ride is scored on its own prescription; before is the tank at its start, whenever he ate', () => {
  const s = easy();
  // the plan had a 145 g lunch three hours before; the ride itself asks for 25 g and a tank of 25%
  const r = { sessions: [s], energy: tankOf(s, 100), meals: [{ slot: 'lunch', time: '14:00', carbs_g: 145 }],
    entries: [{ time: '13:10', carbs_g: 38, protein_g: 20, kcal: 400 }, { time: '18:40', carbs_g: 45, protein_g: 50, kcal: 600 }] };
  const c = C.fuelChecks(r)[0], p = Object.fromEntries(c.parts.map(x => [x.kind, x]));
  assert.strictEqual(p.pre.ratio, 1); assert.strictEqual(p.pre.by, 'tank'); assert.strictEqual(p.pre.plan_g, 25);
  assert.ok(!p.bottle && !p.supp);                                             // an easy hour: water only, no beetroot asked
  assert.strictEqual(c.pct, 100); assert.strictEqual(c.rx_kind, 'light'); assert.strictEqual(c.weight, 1);
  const lowTank = C.fuelChecks(Object.assign({}, r, { energy: tankOf(s, 15) }))[0];
  assert.strictEqual(lowTank.parts.find(x => x.kind === 'pre').ratio, 0.6); assert.ok(lowTank.pct < 100);
});
ok('fuel: every part stops at 100, so a surplus in one cannot hide a gap in another (the 142% ride)', () => {
  const s = easy({ time: '17:51', minutes: 90, rx: { kind: 'light', before_g: 25, during_g: 45, after_g: 39, after_protein_g: 45 } });
  const r = { sessions: [s], energy: tankOf(s, 100), entries: [{ time: '14:07', carbs_g: 93, protein_g: 40, kcal: 800 }, { time: '18:30', carbs_g: 0, kcal: 0, slot: 'on the bike' }, { time: '20:00', carbs_g: 19, protein_g: 10, kcal: 200 }] };
  const c = C.fuelChecks(r)[0], p = Object.fromEntries(c.parts.map(x => [x.kind, x]));
  assert.strictEqual(p.pre.ratio, 1); assert.strictEqual(p.bottle.ratio, 0); assert.ok(p.after.ratio < 0.5);
  assert.ok(c.pct <= 100 && c.pct < 65, c.pct); assert.ok(c.parts.every(x => x.ratio == null || (x.ratio >= 0 && x.ratio <= 1)));
});
ok('fuel: a hard ride weighs the food before and the bottle, wants bicarbonate too, and counts three easy rides in the week', () => {
  const s = hard();
  const r = { sessions: [s], energy: tankOf(s, 97, 87), entries: [{ time: '06:10', carbs_g: 27, kcal: 105 }, { time: '07:05', carbs_g: 37, kcal: 150, slot: 'on the bike' }, { time: '08:20', carbs_g: 45, protein_g: 35, kcal: 500 }, { supplement: true, key: 'beetroot', time: '04:30' }] };
  const c = C.fuelChecks(r)[0], p = Object.fromEntries(c.parts.map(x => [x.kind, x]));
  assert.strictEqual(p.supp.due, 2); assert.strictEqual(p.supp.got, 1); assert.strictEqual(p.bottle.got_g, 37);
  assert.strictEqual(c.pct, Math.round((1 * 0.35 + 0.74 * 0.35 + (0.6 * 1 + 0.4 * 35 / 45) * 0.25 + 0.5 * 0.05) * 100));
  assert.strictEqual(c.weight, 3);
  assert.strictEqual(Math.round(C.fuelScore([{ kind: 'ride', ratio: 1, weight: 3 }, { kind: 'ride', ratio: 0, weight: 1 }]) * 100), 75);
  assert.strictEqual(C.stateOf('fuel', 1.0), 'good'); assert.strictEqual(C.stateOf('fuel', 0.8), 'good'); assert.strictEqual(C.stateOf('fuel', 0.7), 'warn'); assert.strictEqual(C.stateOf('fuel', 0.5), 'bad');
  assert.strictEqual(C.fuelChecks({ sessions: [{ name: 'Push', sport: 'WeightTraining', time: '13:30', minutes: 55 }], meals: [], entries: [] }).length, 0);
});
ok('fuel: over costs only on a ride the plan keeps low', () => {
  const s = easy({ time: '08:00', rx: { kind: 'low', low: true, before_g: 20, during_g: 0, after_g: 39, after_protein_g: 45 } });
  const kept = C.fuelChecks({ sessions: [s], entries: [{ time: '07:15', carbs_g: 12, protein_g: 20, kcal: 150 }, { time: '09:30', carbs_g: 40, protein_g: 45, kcal: 500 }] })[0];
  assert.strictEqual(kept.parts.find(p => p.kind === 'pre').ratio, 1); assert.strictEqual(kept.pct, 100);
  const over = C.fuelChecks({ sessions: [s], entries: [{ time: '07:15', carbs_g: 75, protein_g: 20, kcal: 400 }, { time: '09:30', carbs_g: 40, protein_g: 45, kcal: 500 }] })[0];
  assert.ok(over.parts.find(p => p.kind === 'pre').ratio < 0.5 && over.pct < 100, JSON.stringify(over.parts[0]));
});
ok('fuel: the meal after an easy ride has three hours, and one that lands in the hour past them counts at half, not zero', () => {
  const s = easy({ time: '17:25' }), mk = t => ({ sessions: [s], energy: tankOf(s, 100), entries: [{ time: '12:30', carbs_g: 60, protein_g: 30, kcal: 600 }, { time: t, carbs_g: 69, protein_g: 105, kcal: 1365 }] });
  assert.strictEqual(C.fuelChecks(mk('20:30'))[0].pct, 100);                    // dinner 2 h 05 after the ride: inside the three hours
  const late = C.fuelChecks(mk('21:40'))[0], a = late.parts.find(p => p.kind === 'after');
  assert.ok(a.late && a.ratio > 0.5 && a.ratio <= 1 && /counted at half/.test(a.word), JSON.stringify(a));
  assert.strictEqual(C.fuelChecks(mk('22:40'))[0].parts.find(p => p.kind === 'after').ratio, 0);   // past the tail: it did not serve the ride
});
ok('fuel: a ride planned and never ridden is not a fuel check', () => {
  const s = easy({ done: false });
  assert.strictEqual(C.fuelChecks({ date: '2026-11-10', sessions: [s], energy: tankOf(s, 100), entries: [{ time: '12:00', carbs_g: 50, kcal: 400 }] }).length, 0);
});
ok('fuel: what was not logged is not scored as missed, and is named', () => {
  const s = easy({ minutes: 90, rx: { kind: 'light', before_g: 26, during_g: 45, after_g: 43, after_protein_g: 45 } });
  const none = C.fuelChecks({ sessions: [s], energy: tankOf(s, 50), entries: [] })[0];
  assert.strictEqual(none.ratio, null); assert.ok(none.not_logged); assert.strictEqual(C.fuelScore([none]), null);   // a day with no food in the journal
  const r = { sessions: [s], energy: tankOf(s, 50), entries: [{ time: '12:30', carbs_g: 60, protein_g: 30, kcal: 600 }, { time: '19:10', carbs_g: 60, protein_g: 50, kcal: 700 }] };
  const c = C.fuelChecks(r)[0], b = c.parts.find(p => p.kind === 'bottle');
  assert.ok(b.unlogged && b.ratio === null); assert.deepStrictEqual(c.unlogged, ['the bottle']); assert.strictEqual(c.pct, 100);   // scored on what is known
  const water = C.fuelChecks(Object.assign({}, r, { entries: r.entries.concat([{ time: '17:30', carbs_g: 0, kcal: 0, slot: 'on the bike' }]) }))[0];
  assert.strictEqual(water.parts.find(p => p.kind === 'bottle').ratio, 0);      // water logged on the bike: the carbs were not taken
});
ok('what got better: a link that moves up a colour is a move, and a win while it holds; grey says nothing', () => {
  const kept = { sleep: { s: 'warn', w: 6.6 }, food: { s: 'bad', w: 52 }, fuel: { s: 'good', w: 88 }, lift: { s: 'warn', w: 60 } };
  const links = { sleep: { state: 'good', week: 7 }, food: { state: 'warn', week: 61 }, fuel: { state: 'warn', week: 70 }, lift: { state: 'none', week: null }, power: { state: 'good', week: 148 } };
  const M = C.movesOf(kept, links, '2026-11-16T12:00:00Z', '2026-11-16');
  assert.deepStrictEqual(M.moves.map(m => [m.key, m.from, m.to, m.up]), [['sleep', 'warn', 'good', true], ['food', 'bad', 'warn', true], ['fuel', 'good', 'warn', false]]);
  assert.strictEqual(M.states.lift.s, 'warn');                       // grey today: what was kept stands, and nothing is said
  assert.strictEqual(M.states.power.s, 'good'); assert.ok(!M.moves.some(m => m.key === 'power'));   // first seen: no move
  const wins = C.winsOf(M.moves, links, '2026-11-16', 0);
  assert.deepStrictEqual(wins.map(w => w.key), ['sleep', 'food']);
  assert.strictEqual(wins[0].text, 'Sleep moved from amber to green: 7 h a night this week');
  assert.ok(/Macros moved from red to amber/.test(wins[1].text));
});
ok('what got better: a link that rose and fell back is not a win, and a win of four days ago is this week\'s, not today\'s', () => {
  const moves = [{ key: 'sleep', name: 'Sleep', from: 'warn', to: 'good', up: true, date: '2026-11-12' }, { key: 'water', name: 'Hydration', from: 'warn', to: 'good', up: true, date: '2026-11-16' }, { key: 'water', name: 'Hydration', from: 'good', to: 'warn', up: false, date: '2026-11-16' }];
  const links = { sleep: { state: 'good', week: 7.1 }, water: { state: 'warn', week: 40 } };
  assert.deepStrictEqual(C.winsOf(moves, links, '2026-11-16', 0).map(w => w.key), []);
  assert.deepStrictEqual(C.winsOf(moves, links, '2026-11-16', 6).map(w => w.key), ['sleep']);
  assert.deepStrictEqual(C.winsOf(moves, { sleep: { state: 'warn', week: 6.5 }, water: links.water }, '2026-11-16', 6).map(w => w.key), []);   // it did not hold
});
console.log(n + ' passed');
