// node bridge/calendar-hide.test.js — hiding an event in The Way never touches Google
const assert = require('assert');
const storage = require('./storage');
const mem = {};
storage.getJSON = async (k, f) => (k in mem ? JSON.parse(JSON.stringify(mem[k])) : f);
storage.setJSON = async (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); };
let fetched = 0; global.fetch = async () => { fetched++; return { ok: true, status: 200, json: async () => ({}) }; };
const C = require('./calendar');
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok ' + name); });
const KEY = 'g:mcdonogh.org_bslm3fjfcfe1qiuc0ftp4j9ieg@group.calendar.google.com:u3p2t26okgqpr1jt2mqdkods74';
const ev = { summary: 'Athletics Signing Day', gid: 'u3p2t26okgqpr1jt2mqdkods74', calendar_id: 'mcdonogh.org_bslm3fjfcfe1qiuc0ftp4j9ieg@group.calendar.google.com', start: '2026-11-11T20:45:00Z', end: '2026-11-11T21:15:00Z' };
const mine = { summary: 'Mine', gid: 'abc', calendar_id: 'harry.canellakis@mdunitedfc.org', start: '2026-11-11T15:00:00Z', end: '2026-11-11T16:00:00Z' };
(async () => {
  await ok('his own calendar is his; the school\'s, the club\'s and team feeds are shared', () => {
    assert.strictEqual(C.sharedCalendar('harry.canellakis@mdunitedfc.org'), false);
    assert.strictEqual(C.sharedCalendar('mcdonogh.org_bslm3fjfcfe1qiuc0ftp4j9ieg@group.calendar.google.com'), true);
    assert.strictEqual(C.sharedCalendar('mdunitedfc.org_m17usavbqqet5h6vecvh52e02k@group.calendar.google.com'), true);
    assert.strictEqual(C.sharedCalendar('nd1koenp6fjho77ehtm31fa32hlo7lt4@import.calendar.google.com'), true);
  });
  await ok('a hidden event leaves The Way\'s day and Google is not called; showing it again brings it back', async () => {
    mem.gcal = { accounts: [{ id: 'a', tokens: {} }], events: [ev, mine] };
    await C.hideEvent(KEY, { summary: ev.summary, date: '2026-11-11' });
    assert.strictEqual(fetched, 0);
    const d = mem.gcal; assert.deepStrictEqual(C.applyOverrides([ev, mine], d.overrides).map(e => e.summary), ['Mine']);
    assert.deepStrictEqual((await C.hiddenEvents()).map(x => x.summary), ['Athletics Signing Day']);
    assert.strictEqual(await C.unhideEvent(KEY), true); assert.strictEqual(C.applyOverrides([ev, mine], mem.gcal.overrides).length, 2);
  });
  await ok('the trash button on a shared calendar\'s event hides it instead of deleting it on Google', async () => {
    mem.gcal = { accounts: [{ id: 'a', tokens: {} }], events: [ev] };
    assert.strictEqual(await C.deleteAny(KEY), true); assert.strictEqual(fetched, 0); assert.ok(mem.gcal.overrides[KEY].hidden);
    assert.strictEqual(mem.gcal.events.length, 1);
  });
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
