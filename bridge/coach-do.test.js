// node bridge/coach-do.test.js
// The deep coach's do_action: one action in the quick coach's own shape, run through the same function.
const assert = require('assert');
const C = require('./coach'), V = require('./voice');
const t = C.allTools(), d = t.find(x => x.name === 'do_action');
assert.ok(d, 'do_action is on the list');
assert.deepStrictEqual(t.map(x => x.name), ['read_site', 'write_note', 'schedule_workout', 'change_workout', 'log_food', 'do_action', 'web_search', 'web_fetch']);
const kinds = d.input_schema.properties.type.enum;
['medicine', 'supplement', 'weigh_in', 'remove_workout', 'event', 'event_change', 'nap', 'lift', 'race'].forEach(k => assert.ok(kinds.includes(k), k));
// what has a tool of its own, or needs the phone in his hand, is not here
['meal', 'drink', 'workout', 'workout_change', 'plan_week', 'player', 'route_here', 'save_place', 'research', 'question'].forEach(k => assert.ok(!kinds.includes(k), k));
// every kind it offers is one the quick coach really runs, and each is described in the quick coach's own words
const all = V.SCHEMA().properties.actions.items.properties.type.enum;
kinds.forEach(k => { assert.ok(all.includes(k), k + ' is a real action'); assert.ok(new RegExp('^- ' + k + ':', 'm').test(d.description), k + ' is described'); });
assert.deepStrictEqual(d.input_schema.properties.medicine.enum, ['', 'bp', 'eye_am', 'eye_pm']);
assert.strictEqual(d.strict, true); assert.strictEqual(d.input_schema.additionalProperties, false);
(async () => {
  // the action itself: a medicine marked taken shows on the day's list; an unknown one is refused
  const blank = { text: '', meal: '', supplement: '', medicine: '', lb: 0, date: '', time: '', new_date: '', library_key: '', name: '', minutes: 0, sport: '', sleep_h: 0, sleep_score: 0, recovery: 0, hrv: 0, rhr: 0 };
  const out = await V.run(Object.assign({}, blank, { type: 'medicine', medicine: 'bp' }), {});
  assert.ok(out.ok && /Taken: Blood pressure medicine/.test(out.summary), JSON.stringify(out));
  const due = (await require('./meds').today()).due.find(x => x.key === 'bp'); assert.strictEqual(due.taken, true);
  await require('./meds').mark('bp', true);
  const bad = await V.run(Object.assign({}, blank, { type: 'medicine', medicine: 'aspirin' }), {}); assert.strictEqual(bad.ok, false);
  console.log('coach do_action: ok');
})().catch(e => { console.error(e); process.exit(1); });
