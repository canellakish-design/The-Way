// node bridge/player-remove.test.js — a player ride Harry asks to delete leaves The Way and intervals.icu
const assert = require('assert');
const storage = require('./storage');
const mem = {};
storage.getJSON = async (k, f) => (k in mem && mem[k] !== null ? JSON.parse(JSON.stringify(mem[k])) : f);
storage.setJSON = async (k, v) => { mem[k] = v === null ? null : JSON.parse(JSON.stringify(v)); };
const P = require('./player');
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok ' + name); });
(async () => {
  mem[P.INDEX] = { rides: [{ id: 1794257998849, name: 'Z1 trainer 90 min', date: '2026-11-09', minutes: 0, intervals_id: 'i207999319' }, { id: 1794260000000, name: 'Z1 trainer 90 min', date: '2026-11-09', minutes: 90 }] };
  mem[P.rideKey(1794257998849)] = { summary: {}, samples: { t: [1] } };
  await ok('the ride leaves the index and its seconds are cleared; the other ride stays', async () => {
    const calls = [];
    const r = await P.removeRide('1794257998849', { fetch: async (u, o) => { calls.push([u, o.method]); return { ok: false, status: 404 }; } });
    assert.strictEqual(r.ok, true); assert.deepStrictEqual(mem[P.INDEX].rides.map(x => x.id), [1794260000000]); assert.strictEqual(mem[P.rideKey(1794257998849)], null);
    assert.ok(/\/activity\/i207999319$/.test(calls[0][0])); assert.strictEqual(calls[0][1], 'DELETE'); assert.strictEqual(r.intervals.removed, true);   // already gone there is fine
  });
  await ok('an unknown ride is a 404, and nothing changes', async () => {
    await assert.rejects(P.removeRide('123'), e => e.status === 404); assert.strictEqual(mem[P.INDEX].rides.length, 1);
  });
  console.log(n + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
