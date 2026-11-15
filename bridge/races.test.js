// node bridge/races.test.js
const assert = require('assert');
const R = require('./races');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('a race is cleaned: a name and a date are needed; the kind is read from the name; B when no priority is given', () => {
  assert.throws(() => R.clean({ date: '2027-05-06' }), /needs a name/);
  assert.throws(() => R.clean({ name: 'Greenbelt crit', date: 'May 6' }), /needs its date/);
  const r = R.clean({ name: '  Greenbelt   Training Crit ', date: '2027-05-06', url: 'javascript:alert(1)', distance_mi: '22.5' });
  assert.deepStrictEqual([r.name, r.kind, r.priority, r.status, r.url, r.distance_mi], ['Greenbelt Training Crit', 'criterium', 'B', 'planned', '', 22.5]);
  assert.strictEqual(R.kindOf('Gran Fondo Maryland'), 'gran fondo'); assert.strictEqual(R.kindOf('Sportif Charm City Cross'), 'cyclocross');
  assert.strictEqual(R.kindOf('Fair Hill XC'), 'mountain bike'); assert.strictEqual(R.kindOf('Poolesville Road Race'), 'road race');
  // an edit keeps what was not sent; a result marks it done
  const e = R.clean({ priority: 'a', result: { place: 7, field: 31 } }, r);
  assert.deepStrictEqual([e.id, e.name, e.priority, e.status, e.result.place, e.distance_mi], [r.id, 'Greenbelt Training Crit', 'A', 'done', 7, 22.5]);
});
const list = [
  R.clean({ name: 'Charm City Cross', date: '2026-11-22', priority: 'C' }),
  R.clean({ name: 'Greenbelt crit', date: '2027-05-05', priority: 'B' }),
  R.clean({ name: 'Gran Fondo Maryland', date: '2027-05-09', priority: 'A', distance_mi: 57, climb_ft: 6200, location: 'Frederick, MD' }),
  R.clean({ name: 'Tour of Somewhere', date: '2027-03-01', status: 'skipped' }),
  R.clean({ name: 'Old race', date: '2026-09-20', result: { place: 12, field: 40 } })
];
ok('the view: upcoming in date order, the next one, the A race as the target, the season clock, past races last first', () => {
  const v = R.view(list, '2026-11-15');
  assert.deepStrictEqual(v.upcoming.map(r => r.name), ['Charm City Cross', 'Tour of Somewhere', 'Greenbelt crit', 'Gran Fondo Maryland']);
  assert.strictEqual(v.next.name, 'Charm City Cross'); assert.strictEqual(v.next.days_out, 7);
  assert.strictEqual(v.target.name, 'Gran Fondo Maryland'); assert.strictEqual(v.clock.phase, 'base'); assert.strictEqual(v.clock.weeks_out, 25);
  assert.deepStrictEqual(v.past.map(r => r.name), ['Old race']);
  // a B race four days before the A race is flagged; the skipped one never is the next
  assert.ok(v.upcoming.find(r => r.name === 'Greenbelt crit').crowded);
  assert.strictEqual(R.view(list, '2027-04-20').clock.phase, 'peak'); assert.strictEqual(R.view(list, '2027-05-05').clock.phase, 'taper'); assert.strictEqual(R.view(list, '2027-05-08').clock.phase, 'race week');
  // no A race ahead: base, and it says why
  const none = R.view(list.filter(r => r.priority !== 'A'), '2026-11-15');
  assert.strictEqual(none.target, null); assert.strictEqual(none.clock.phase, 'base'); assert.ok(/no A race/.test(none.clock.word));
});
ok('what the coach is told: the clock, each race with its distance in time, and plainly when there are none', () => {
  const t = R.aheadText(R.view(list, '2026-11-15'));
  assert.ok(/Season clock: Gran Fondo Maryland in 25 weeks, so base/.test(t), t);
  assert.ok(/C · Charm City Cross \(cyclocross\) on Sun, Nov 22 2026, in 7 days/.test(t), t);
  assert.ok(/A · Gran Fondo Maryland \(gran fondo\).*in 25 weeks, Frederick, MD, 57 mi, 6200 ft of climbing/.test(t), t);
  assert.ok(/none on his race calendar/.test(R.aheadText(R.view([], '2026-11-15'))));
});
console.log(n + ' passed');
