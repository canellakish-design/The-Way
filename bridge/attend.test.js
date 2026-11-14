// node bridge/attend.test.js
const assert = require('assert');
const T = require('./attend');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const ev = (summary, calendar, category, o) => Object.assign({ summary, calendar, category, start: '2026-11-15T22:00:00Z', end: '2026-11-15T23:30:00Z', allDay: false }, o || {});
ok('the defaults: his own, his classes, his team, the tech staff calls go; the school, the club and other teams are information', () => {
  const A = { calendars: {}, events: {}, series: {} };
  assert.strictEqual(T.calendarMode(' Personal Events', A), 'go');
  assert.strictEqual(T.calendarMode('McDonogh Class Schedule', A), 'go');
  assert.strictEqual(T.calendarMode('U16 G MARYLAND UNITED ECNL', A), 'go');
  assert.strictEqual(T.calendarMode('Technical Staff Calendar', A), 'go');
  assert.strictEqual(T.calendarMode('Pod 7: Girls Technical Staff', A), 'go');
  assert.strictEqual(T.calendarMode('U16 G MARYLAND UNITED ECNL RL', A), 'info');
  assert.strictEqual(T.calendarMode('Upper School', A), 'info');
  assert.strictEqual(T.calendarMode('Club Calendar', A), 'info');
  assert.strictEqual(T.calendarMode(undefined, A), 'go', 'added in The Way');
});
ok('not going: kept on the day as information, blocking nothing; a "possible" one is a maybe', () => {
  const A = { calendars: {}, events: {}, series: {} };
  const [concert, practice, scrim, drive] = T.apply([ev('Dance Concert', 'Upper School', 'work'), ev('U16 G MARYLAND UNITED ECNL - Practice', 'U16 G MARYLAND UNITED ECNL', 'coaching'),
    ev('U16 G MARYLAND UNITED ECNL - Possible Scrimmage', 'U16 G MARYLAND UNITED ECNL', 'coaching'), { summary: 'Drive home', source: 'commute', category: 'commute' }], A);
  assert.strictEqual(concert.category, 'info'); assert.strictEqual(concert.orig_category, 'work'); assert.strictEqual(concert.attend, 'info');
  assert.strictEqual(practice.category, 'coaching'); assert.strictEqual(practice.attend, 'go');
  assert.strictEqual(scrim.attend, 'maybe'); assert.strictEqual(scrim.category, 'info');
  assert.strictEqual(drive.category, 'commute'); assert.ok(!drive.attend, "The Way's own rows are untouched");
});
ok('the narrowest answer wins: this one, then every one like it, then the calendar', () => {
  const concert = ev('Dance Concert', 'Upper School', 'work', { gid: 'g1', calendar_id: 'school@x' });
  const A = { calendars: {}, events: { 'g:school@x:g1': 'go' }, series: {} };
  assert.strictEqual(T.apply([concert], A)[0].category, 'work', 'Going to this one');
  const B = { calendars: {}, events: {}, series: { [T.seriesOf(concert)]: 'go' } };
  assert.strictEqual(T.modeOf(concert, B).by, 'series');
  const C = { calendars: { 'Upper School': 'go' }, events: { 'g:school@x:g1': 'no' }, series: {} };
  assert.strictEqual(T.apply([concert], C)[0].category, 'info', 'the calendar says go, this one says no');
  assert.strictEqual(T.modeOf(ev('Advisory Time', 'Upper School', 'work'), C).mode, 'go');
});
ok('marked Free in Google: information, not on his day; his own answer still wins; never a class, never an all-day one', () => {
  const A = { calendars: {}, events: {}, series: {} };
  const idp = ev('IDP Meetings | U13 ECNL (Darrell)', ' Personal Events', 'busy', { free: true, gid: 'abc', calendar_id: 'h@mdunitedfc.org' });
  assert.deepStrictEqual(T.modeOf(idp, A), { mode: 'info', by: 'free' });
  const x = T.apply([idp], A)[0]; assert.strictEqual(x.category, 'info'); assert.strictEqual(x.orig_category, 'busy');
  assert.strictEqual(T.modeOf(idp, { calendars: {}, series: {}, events: { 'g:h@mdunitedfc.org:abc': 'go' } }).mode, 'go', 'he said he is going to this one');
  assert.strictEqual(T.modeOf(ev('(CP) World History I (Sec. E1)', ' Personal Events', 'work', { free: true }), A).mode, 'go');
  assert.strictEqual(T.modeOf(ev('Bethesda Premier Cup', ' Personal Events', 'coaching', { free: true, allDay: true }), A).mode, 'go');
  assert.strictEqual(T.modeOf(ev('Cycle 3 Planning', ' Personal Events', 'busy'), A).mode, 'go');
});
console.log(n + ' passed');
