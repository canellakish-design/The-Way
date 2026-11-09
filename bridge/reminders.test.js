// node bridge/reminders.test.js
// Reminders (push.js) and medicines (meds.js): what is due when, what goes in one notification, and
// that nothing taken, already sent, or more than half an hour old is sent.
const assert = require('assert');
const path = require('path');
const mem = new Map();
const sp = path.join(__dirname, 'storage.js');
require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: {
  getJSON: async (k, fb) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : fb),
  setJSON: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); }, withScope: fn => fn(), ON_NETLIFY: false, SANDBOX: false } };
const M = require('./meds'), P = require('./push'), SW = require('./sleep-window');
const tests = []; const ok = (n, f) => tests.push([n, f]);
const m = hm => +hm.slice(0, 2) * 60 + +hm.slice(3);

ok('medicines: eye drops at 6:45 a.m. and 10:00 p.m., BP medicine at 10:00 p.m.; they move with the sleep window', () => {
  const d = M.dueFor('2026-11-09', {});
  assert.deepStrictEqual(d.map(x => `${x.time} ${x.key}`), ['06:45 eye_am', '22:00 bp', '22:00 eye_pm']);
  const early = M.dueFor('2026-11-09', { bp: '2026-11-10T02:00:00Z' }, SW.rules({ bed: '22:00', wake: '06:00' }));
  assert.deepStrictEqual(early.map(x => x.time), ['06:15', '21:30', '21:30']);
  assert.strictEqual(early.find(x => x.key === 'bp').taken, true);
});

ok('marking taken: today, once; undo takes it back; an unknown medicine is a 400', async () => {
  mem.clear();
  let r = await M.mark('bp');
  assert.strictEqual(r.due.find(x => x.key === 'bp').taken, true);
  const first = r.due.find(x => x.key === 'bp').taken_at;
  r = await M.mark('bp'); assert.strictEqual(r.due.find(x => x.key === 'bp').taken_at, first, 'a second tap keeps the first time');
  r = await M.mark('bp', true); assert.strictEqual(r.due.find(x => x.key === 'bp').taken, false);
  await assert.rejects(() => M.mark('aspirin'), e => e.status === 400);
});

ok('what goes now: due in the last half hour, not taken, not sent; the 10:00 p.m. pair in one notification', () => {
  const items = [
    { kind: 'supp', key: 'beetroot', name: 'Beetroot (nitrate)', time: '12:30', why: '2 to 3 h before', taken: false },
    { kind: 'med', key: 'bp', name: 'Blood pressure medicine', time: '22:00', taken: false },
    { kind: 'med', key: 'eye_pm', name: 'Eye drops (PM)', time: '22:00', taken: false },
    { kind: 'supp', key: 'magnesium', name: 'Magnesium glycinate, 200 mg', time: '21:30', taken: true }
  ];
  assert.deepStrictEqual(P.pick(items, m('12:29'), {}), []);
  assert.deepStrictEqual(P.pick(items, m('12:30'), {}).map(g => g.map(x => x.key)), [['beetroot']]);
  assert.deepStrictEqual(P.pick(items, m('12:59'), {}).map(g => g.map(x => x.key)), [['beetroot']]);
  assert.deepStrictEqual(P.pick(items, m('13:00'), {}), [], 'half an hour late is too late');
  assert.deepStrictEqual(P.pick(items, m('12:40'), { 'supp:beetroot': 'x' }), [], 'sent once');
  assert.deepStrictEqual(P.pick(items, m('21:35'), {}), [], 'magnesium is taken');
  const night = P.pick(items, m('22:05'), {});
  assert.deepStrictEqual(night.map(g => g.map(x => x.key)), [['bp', 'eye_pm']]);
  const pl = P.payloadFor('2026-11-09', night[0]);
  assert.strictEqual(pl.title, '10:00p · Blood pressure medicine + Eye drops (PM)');
  assert.strictEqual(pl.url, '/#take?items=med:bp,med:eye_pm');
  assert.deepStrictEqual(pl.items.map(x => x.kind + ':' + x.key), ['med:bp', 'med:eye_pm']);
});

ok('a late session: a reminder that falls inside it comes 10 minutes after it ends; one before it stays', () => {
  const items = [{ kind: 'supp', key: 'magnesium', time: '21:30' }, { kind: 'med', key: 'bp', time: '22:00' }, { kind: 'med', key: 'eye_pm', time: '22:00' }, { kind: 'supp', key: 'beetroot', time: '18:30' }];
  const late = P.shiftAfter(items, [{ start: m('20:45'), end: m('21:45') }]);   // a ride 8:45 to 9:45 p.m.
  assert.deepStrictEqual(late.map(x => `${x.key} ${x.time}`), ['magnesium 21:55', 'bp 22:00', 'eye_pm 22:00', 'beetroot 18:30']);
  assert.strictEqual(late[0].moved_from, '21:30'); assert.strictEqual(late[0].after_session, true);
  // a session over 10:00 moves the bedtime pair after it, and they still go together
  const later = P.shiftAfter(items, [{ start: m('21:00'), end: m('22:15') }]);
  assert.deepStrictEqual(later.map(x => x.time), ['22:25', '22:25', '22:25', '18:30']);
  assert.deepStrictEqual(P.pick(later, m('22:30'), {}).map(g => g.length), [3]);
  // back to back: past the end of the second
  assert.strictEqual(P.shiftAfter([{ time: '21:30' }], [{ start: m('21:00'), end: m('21:40') }, { start: m('21:45'), end: m('22:30') }])[0].time, '22:40');
  assert.strictEqual(P.shiftAfter(items, [])[0], items[0], 'no session: nothing moves');
});
ok('a subscription without its keys is refused; a phone subscribed twice is kept once', async () => {
  mem.clear();
  await assert.rejects(() => P.subscribe({ endpoint: 'https://push.example/1' }), e => e.status === 400);
  const sub = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } };
  await P.subscribe(sub); const r = await P.subscribe(sub);
  assert.strictEqual(r.devices, 1);
  assert.strictEqual((await P.unsubscribe(sub.endpoint)).devices, 0);
});

(async () => { let n = 0; for (const [name, fn] of tests) { await fn(); n++; console.log('ok ' + name); } console.log(`\n${n} passed`); })().catch(e => { console.error(e); process.exit(1); });
