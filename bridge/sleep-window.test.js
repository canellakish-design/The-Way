// node bridge/sleep-window.test.js
// Sleep first (Harry, 9 Nov 2026; window 10:30 p.m. to 6:30 a.m.): what the window rules out and flags.
const assert = require('assert');
const path = require('path');
const mem = new Map();
const sp = path.join(__dirname, 'storage.js');
require.cache[sp] = { id: sp, filename: sp, loaded: true, exports: {
  getJSON: async (k, fb) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : fb),
  setJSON: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); }, withScope: fn => fn(), ON_NETLIFY: false, SANDBOX: false } };
const SW = require('./sleep-window');
const tests = []; const ok = (n, f) => tests.push([n, f]);

ok('the default window: 10:30 p.m. to 6:30 a.m., 8 h; workouts from 7:30, magnesium 9:30, the bedtime snack 9:00', () => {
  const R = SW.DEFAULT_RULES;
  assert.strictEqual(R.hours, 8); assert.strictEqual(R.earliest_workout_hm, '07:30');
  assert.strictEqual(SW.toHM(R.magnesium), '21:30'); assert.strictEqual(SW.toHM(R.bedtime_snack), '21:00');
  // never before 7 a.m., even waking at 5:30
  assert.strictEqual(SW.rules({ bed: '21:30', wake: '05:30' }).earliest_workout_hm, '07:00');
});

ok('cuts sleep: a ride ending within 2 h of bed, a hard one within 3 h, or one starting under an hour after waking', () => {
  assert.strictEqual(SW.lateFlag({ name: 'Zone 1, 60 min', time: '19:00', minutes: 60 }), null);           // ends 8:00, 2.5 h before bed
  const z = SW.lateFlag({ name: 'Zone 1, 60 min', time: '20:00', minutes: 60 });                          // ends 9:00
  assert.ok(z && z.cuts_sleep && /1\.5 h before bed: cuts sleep/.test(z.word), JSON.stringify(z));
  const v = SW.lateFlag({ name: 'VO2 40/20s', time: '19:00', minutes: 60 });                              // hard, ends 8:00
  assert.ok(v && v.hard && /hard, ends 2\.5 h before bed/.test(v.word), JSON.stringify(v));
  const am = SW.lateFlag({ name: 'Zone 1, 60 min', time: '07:00', minutes: 60 });
  assert.ok(am && am.early && /starts before 7:30/.test(am.word), JSON.stringify(am));
  assert.strictEqual(SW.lateFlag({ name: 'Push', time: '07:30', minutes: 55 }), null);
  assert.strictEqual(SW.lateFlag({ name: 'Zone 1' }), null, 'untimed: nothing to say');
});

ok('the setting: stored, read back with its rules; a window under 6 or over 10 hours, or a bad time, is a 400', async () => {
  mem.clear();
  assert.strictEqual((await SW.get()).bed_hm, '22:30');
  const r = await SW.set({ bed: '22:00', wake: '06:00' });
  assert.strictEqual(r.hours, 8); assert.strictEqual(r.earliest_workout_hm, '07:00'); assert.strictEqual(SW.toHM(r.magnesium), '21:00');
  await assert.rejects(() => SW.set({ bed: '01:00', wake: '06:00' }), e => e.status === 400);
  await assert.rejects(() => SW.set({ bed: '22:00', wake: '9am' }), e => e.status === 400);
  assert.strictEqual((await SW.get()).wake_hm, '06:00', 'a rejected window leaves the setting as it was');
});

(async () => { let n = 0; for (const [name, fn] of tests) { await fn(); n++; console.log('ok ' + name); } console.log(`\n${n} passed`); })().catch(e => { console.error(e); process.exit(1); });
