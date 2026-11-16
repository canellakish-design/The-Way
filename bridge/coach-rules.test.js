// node bridge/coach-rules.test.js
// The corrections Harry has made to the coach (docs/corrections.md), kept as checks: what the coach is told, in the
// standing prompt and in the day's lines, must never drift back to the thing he corrected. No model is called here;
// scripts/coach-eval.js asks the real coach the same questions when that is wanted.
const assert = require('assert');
const V = require('./voice'), H = require('./history');
const brief = require('./coach-brief'), advisor = require('./advisor-brief'), sys = V.systemText();
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const all = [['coach-brief', brief], ['advisor-brief', advisor], ['the quick coach\'s prompt', sys]];

ok('15 Nov, "why did the coach say 217 when I logged 216": no brief carries a weight of his, a sleep average or a threshold power from memory', () => {
  for (const [name, t] of all) {
    assert.ok(!/\b21\d(\.\d)?\s*lb\b/.test(t), `${name} names a weight in pounds`);
    assert.ok(!/98 kg \(/.test(t), `${name} gives the planning weight as his weight`);
    assert.ok(!/5 to 6 h/.test(t), `${name} carries an old sleep average`);
    assert.ok(!/\b152 W\b/.test(t), `${name} carries an old threshold power`);
  }
  assert.ok(/latest weigh-in/.test(brief));
});
ok('15 Nov, 51 of 90 minutes ridden: a short ride is never called done in full, and its ridden minutes are said', () => {
  const work = { planned_min: 90, done_min: 51, pct: 57, compliant: false, note: 'Rode 51 of 90 planned minutes.' };
  const w = V.doneWords({ name: 'Zone 1, 90 min', sport: 'VirtualRide', minutes: 51, done: true }, work);
  assert.ok(/ridden: 51 min/.test(w) && !/\(done/.test(w), w);
  assert.ok(/51 of 90 planned minutes ridden, graded 57%/.test(V.workWords(work)) && /NOT the full plan/.test(V.workWords(work)));
  assert.ok(/\(done, 88 min\)/.test(V.doneWords({ sport: 'Ride', minutes: 88, done: true }, { planned_min: 90, done_min: 88, pct: 98, compliant: true })));
  assert.strictEqual(V.doneWords({ sport: 'WeightTraining', done: true }, null), ' (done)');
  assert.strictEqual(V.workWords(null), null);
});
ok('last night is given by itself, and a night that has not synced is said, not guessed', () => {
  assert.ok(/LAST NIGHT he slept 6 h 24 min/.test(V.nightWords({ date: '2026-11-16', hours: 6.4 }, '2026-11-16')));
  assert.ok(/no reading for last night/.test(V.nightWords({ date: '2026-11-15', hours: 6.4 }, '2026-11-16')));
  assert.ok(/no reading for last night/.test(V.nightWords(null, '2026-11-16')));
});
ok('a ride on a day with no food logged is not a fasted ride, in the day\'s line or in the habits', () => {
  const ride = (date, time) => ({ date, report: { entries: [] }, cal: { compliance: { pct: 90 }, planned: [{ name: 'Z1' }], done: [{ name: 'Z1', type: 'Ride', time, minutes: 60 }] } });
  const fed = date => ({ date, report: { fuel_day: 'x', actual: { kcal: 2000 }, target: { kcal: 2200 }, compliance: { overall: 70, band: { word: 'ok' }, macros: { per_macro: {} }, guidelines: { checks: [] } },
    entries: [{ time: '08:00', slot: 'breakfast', name: 'Eggs', kcal: 400, carbs_g: 50, protein_g: 30 }] }, cal: { compliance: { pct: 100 }, planned: [{ name: 'Z1' }], done: [{ name: 'Z1', type: 'Ride', time: '09:00', minutes: 60 }] } });
  const rows = [H.rowOf(ride('2026-11-10', '09:00')), H.rowOf(ride('2026-11-11', '09:00')), H.rowOf(fed('2026-11-12')), H.rowOf(fed('2026-11-13'))];
  assert.ok(!/nothing (eaten|logged) before it/.test(H.line(rows[0])), H.line(rows[0]));
  const P = H.patterns(rows, '2026-11-16'), eat = P.ride_habits.flat().filter(g => /eating|carbs/.test(g.label));
  assert.ok(eat.every(g => g.n <= 2), JSON.stringify(eat));      // only the two days with food logged are counted
  assert.ok(!eat.some(g => /fasted/.test(g.label)));
});
ok('1 Nov and since: the standing rules he has corrected are all still in what the coach reads', () => {
  assert.ok(/never rides there/.test(brief) && /Never plan, suggest or name a ride at Life Time/.test(brief));          // "I will never ride my bike at lifetime"
  for (const t of [brief, advisor]) assert.ok(/artificial sweeteners/.test(t));
  assert.ok(/no whey/.test(advisor) && /Huel plant protein/.test(advisor));                                              // 9 Nov
  assert.ok(/12-hour/.test(brief) && /12-hour form/.test(sys));
  assert.ok(/Never use or suggest 196/.test(brief) && /never push or write an FTP of 196/.test(advisor));
  assert.ok(/one 45 lb kettlebell/.test(brief) && /one 45 lb kettlebell/.test(advisor) && !/kettlebells in each note/.test(advisor));   // 15 Nov
  assert.ok(!/at school or at Lifetime/.test(advisor));
  assert.ok(/NOTHING EATEN TODAY YET/.test(require('fs').readFileSync(require.resolve('./voice'), 'utf8')));             // 3 Nov, "you're fuelled for it now"
  assert.ok(/never a run when the list says ride/.test(require('fs').readFileSync(require.resolve('./voice'), 'utf8'))); // 1 Nov, the "1:00 run"
  assert.ok(/ALREADY IN THE JOURNAL/.test(require('fs').readFileSync(require.resolve('./voice'), 'utf8')));              // 1 Nov, the beers logged twice
});
ok('10 Nov, "Harry does not like bananas": nothing the site or the coach writes suggests one', () => {
  const fs = require('fs');
  for (const f of ['food-math.js', 'energy-math.js', 'coach-first.js', 'expert.js']) assert.ok(!/banana/i.test(fs.readFileSync(require.resolve('./' + f), 'utf8')), f + ' suggests a banana');
  assert.ok(/does not like bananas/.test(advisor));
});
ok('one rule where there were two: Zone 1, the earliest session, the shape of the week, the recovery source', () => {
  const src = require('fs').readFileSync(require.resolve('./voice'), 'utf8');
  assert.ok(!/Zone 1 is heart rate 116 and under\./.test(src) && /Zone 1 is heart rate 100 to 116/.test(src));
  assert.ok(!/WHOOP recovery today/.test(src));
  for (const t of [brief, advisor]) assert.ok(!/no workout (starts )?before 7:30 a\.m\./.test(t));
  assert.ok(!/a light teaching day is a long Zone 1 day/.test(advisor) && /TRAINING MODEL/.test(advisor));
  assert.ok(!/with one VO2 session/.test(brief));
  assert.ok(!/Unasked, raise a change only for/.test(sys));
});
ok('the notebook: he can tell the coach to remember something, and both coaches read it', () => {
  assert.ok(/- remember: /.test(sys) && /THE NOTEBOOK/.test(sys));
  const src = require('fs').readFileSync(require.resolve('./voice'), 'utf8');
  assert.ok(/case 'remember'/.test(src) && /getJSON\('coach-notebook'/.test(src) && /WHAT HE TOLD YOU/.test(src));
});
ok('16 Nov, "a more complex question seems to time out": the answer has a deadline, and a big question is handed on, not dropped', () => {
  const src = require('fs').readFileSync(require.resolve('./voice'), 'utf8');
  assert.ok(/- research: /.test(sys) && /case 'research'/.test(src) && /startJob\(text, base, \{ kind: 'handoff' \}\)/.test(src));
  assert.ok(/AbortSignal\.timeout/.test(src) && /deadline: tAll \+ 20000/.test(src) && /Date\.now\(\) - tStart < 10000/.test(src));
  assert.ok(/ONLY when he asks for a week to be planned/.test(src));                    // asked about sleep, it laid out a week
});
console.log(`\n${n} checks, all good`);
