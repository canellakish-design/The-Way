// node bridge/commute.test.js
const assert = require('assert');
const M = require('./commute');
const tz = require('./tz');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
const at = (date, h, mi) => { const [y, mo, d] = date.split('-').map(Number); return tz.zonedToUTC(y, mo, d, h, mi).toISOString(); };
const S = Object.assign({}, M.DEF);
const day = '2026-11-17';
const ev = (summary, h1, m1, h2, m2, o) => Object.assign({ summary, start: at(day, h1, m1), end: at(day, h2, m2), allDay: false, category: 'work' }, o || {});
const school = [ev('(CP) World History I (Sec. E1)', 8, 30, 9, 30), ev('(CP) World History I (Sec. F2)', 14, 5, 15, 15)];
const practice = ev('U16 G MARYLAND UNITED ECNL - Practice', 17, 30, 19, 0, { category: 'coaching', location: '1130 Anne Chambers Way, Crownsville, MD, USA' });
const fx = ev('U16 G MARYLAND UNITED ECNL - College Seminar | Zoom', 19, 0, 20, 30, { category: 'coaching', location: 'TBD' });

ok('a class day: first and last class; a day with none has no drive', () => {
  assert.deepStrictEqual(M.classTimes(day, school), { first: 510, last: 915 });
  assert.strictEqual(M.classTimes('2026-11-18', school), null);
});
ok('the trips of a day: school, then practice (15 min early); a Zoom with no venue is not a trip', () => {
  const t = M.tripsFor(day, school.concat(practice, fx), S);
  assert.deepStrictEqual(t.map(x => [x.kind, x.label, x.arrive]), [['school', 'McDonogh', 495], ['training', '1130 Anne Chambers Way', 1035]]);
});
ok('an away game: in by its "Arrive by" time; two games at one venue are one trip', () => {
  const d = '2026-11-21';
  const g1 = { summary: 'U16 G MARYLAND UNITED ECNL - Game', category: 'coaching', allDay: false, start: at(d, 14, 40), end: at(d, 16, 25), location: '1 Upper Pond Rd, Somerset, NJ 08873, USA',
    description: 'Arrive by 1:40 PM\nPDA Girls Invitational.' };
  const g2 = Object.assign({}, g1, { start: at(d, 18, 0), end: at(d, 19, 45), description: 'Arrive by 5:00 PM' });
  const t = M.tripsFor(d, [g1, g2], S);
  assert.strictEqual(t.length, 1); assert.strictEqual(t[0].kind, 'game'); assert.strictEqual(t[0].arrive, 13 * 60 + 40); assert.strictEqual(t[0].back, 19 * 60 + 45 + 15);
  assert.strictEqual(M.arriveBy('Arrive by 8:40 AM'), 520);
  assert.strictEqual(M.awayGames(day, [practice], S).length, 0, 'practice at home is not an away game');
});
ok('the rows: sized by the traffic reading, the usual drive for school until one comes, nothing for a venue not looked up', () => {
  const [sc, pr] = M.tripsFor(day, school.concat(practice), S);
  const plain = M.rowsFor(day, sc, S, null);
  assert.strictEqual(tz.minutesOf(new Date(plain[0].end)), 495); assert.strictEqual(tz.minutesOf(new Date(plain[0].start)), 445);
  assert.ok(/Drive to McDonogh · 50 min/.test(plain[0].summary), plain[0].summary);
  assert.strictEqual(tz.minutesOf(new Date(plain[1].start)), 930);
  const busy = M.rowsFor(day, sc, S, { to: { min: 68, usual_min: 50 } });
  assert.ok(/68 min · heavy traffic/.test(busy[0].summary), busy[0].summary);
  assert.strictEqual(M.rowsFor(day, pr, S, null).length, 0);
  assert.strictEqual(M.rowsFor(day, pr, S, { est: 30 }).length, 2);
});
ok('no time to get home between school and practice: no drive home, practice driven from school', () => {
  const early = Object.assign({}, practice, { start: at(day, 16, 30), end: at(day, 18, 0) });   // in by 4:15
  const t = M.chain(M.tripsFor(day, school.concat(early), S), { 'go:1130 anne chambers way, crownsville, md, usa': { est: 40 } }, S);
  assert.strictEqual(t[0].back, null); assert.strictEqual(t[1].from, 'school');
  const rows = M.rowsFor(day, t[1], S, { to: { min: 45 } });
  assert.ok(/from McDonogh/.test(rows[0].detail), rows[0].detail);
  const unknown = M.chain(M.tripsFor(day, school.concat(early), S), {}, S);   // the venue not looked up: school keeps its drive home
  assert.strictEqual(unknown[0].back, 930);
  const evening = Object.assign({}, practice, { start: at(day, 19, 0), end: at(day, 20, 30) });   // in by 6:45: home first
  const late = M.chain(M.tripsFor(day, school.concat(evening), S), { 'go:1130 anne chambers way, crownsville, md, usa': { est: 40 } }, S);
  assert.strictEqual(late[0].back, 930); assert.ok(!late[1].from);
});
ok('a far venue two days running: no drive home the first night, none out the next morning', () => {
  const trip = { id: 'go:x', kind: 'game' }, store = { 'go:x': { to: { min: 190 } } };
  const byDate = { '2026-11-21': [trip], '2026-11-22': [trip] };
  assert.deepStrictEqual(M.overnightFor('2026-11-21', trip, store, byDate), { back: true, out: false });
  assert.deepStrictEqual(M.overnightFor('2026-11-22', trip, store, byDate), { back: false, out: true });
  assert.strictEqual(M.overnightFor('2026-11-21', trip, { 'go:x': { to: { min: 40 } } }, byDate), null);
});
ok('heavy traffic: 8 minutes and a fifth over the usual', () => {
  assert.strictEqual(M.heavy({ min: 68 }, 50), true); assert.strictEqual(M.heavy({ min: 57 }, 50), false);
  assert.strictEqual(M.heavy({ min: 110 }, 90), true); assert.strictEqual(M.heavy({ min: 105 }, 90), false);
});
ok('the alerts: a heads-up when traffic is heavy and leaving is half an hour off, then "leave now" once, nothing after', () => {
  const target = 495, r = { min: 68, usual_min: 50 };          // leave by 7:07
  assert.strictEqual(M.decide(380, target, r, 50, {}), null);
  const h = M.decide(400, target, r, 50, {});
  assert.strictEqual(h.kind, 'heavy'); assert.ok(/68 min right now \(usually 50\)\. Leave by 7:07a/.test(h.body), h.body);
  assert.strictEqual(M.decide(405, target, r, 50, { heavy: 'x' }), null);
  const l = M.decide(423, target, r, 50, { heavy: 'x' });
  assert.strictEqual(l.kind, 'leave'); assert.strictEqual(l.title, 'Leave now · heavy traffic');
  assert.strictEqual(M.decide(430, target, r, 50, { heavy: 'x', leave: 'x' }), null);
  assert.strictEqual(M.decide(500, target, r, 50, {}), null);
  const g = M.decide(780, 820, { min: 41, usual_min: 40 }, 40, {}, 'Maryland SoccerPlex');
  assert.strictEqual(g.title, 'Time to leave for Maryland SoccerPlex');
});
ok('a drive for everything with a real place: a doctor, dinner out; none for a call, home, campus, a route name, TBD', () => {
  const s = Object.assign({}, S, { home: { lat: 38.98, lon: -76.55, label: '1915 Towne Centre Boulevard, Annapolis, MD 21401' } });
  const e = (summary, location, o) => Object.assign({ summary, location, category: 'busy', allDay: false, start: at(day, 10, 0), end: at(day, 11, 0) }, o || {});
  assert.strictEqual(M.isTrip(e('Dentist', '12 Main St, Annapolis, MD'), s), true);
  assert.strictEqual(M.isTrip(e('Dinner', 'Carrol\'s Creek Cafe, Annapolis'), s), true);
  assert.strictEqual(M.isTrip(e('Staff call', 'https://zoom.us/j/123'), s), false);
  assert.strictEqual(M.isTrip(e('Faculty meeting', 'A104'), s), false, 'a campus room stretches the school day instead');
  assert.strictEqual(M.isTrip(e('Ride', 'Butler side roads'), s), false, 'a route name is no address');
  assert.strictEqual(M.isTrip(e('Lunch', 'TBD'), s), false);
  assert.strictEqual(M.isTrip(e('Home', '1915 Towne Centre Blvd'), s), false);
  assert.strictEqual(M.isTrip(e('IDP call', 'Indian Creek, Crownsville, MD'), s), true, 'a meeting with a real place is a trip');
  assert.strictEqual(M.isTrip(e('Dance Concert', 'McDonogh Theatre, Owings Mills', { category: 'info' }), s), false, 'not going: no drive');
  const t = M.tripsFor(day, [e('Dentist', '12 Main St, Annapolis, MD', { start: at(day, 17, 0), end: at(day, 18, 0) })], s);
  assert.strictEqual(t[0].kind, 'errand'); assert.strictEqual(t[0].label, 'Dentist', 'a street address is labelled by the event');
  assert.strictEqual(M.rowsFor(day, t[0], s, { est: 20, skip: 'walk' }).length, 0, 'a walk from home: no drive');
  const camp = [ev('(CP) World History I (Sec. E1)', 8, 30, 9, 30), { summary: 'Faculty meeting', location: 'A104', category: 'work', allDay: false, start: at(day, 15, 30), end: at(day, 16, 30) }];
  assert.strictEqual(M.classTimes(day, camp).last, 990, 'the meeting in A104 keeps him on campus to 4:30');
});
console.log(n + ' passed');

