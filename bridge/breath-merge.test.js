// node bridge/breath-merge.test.js — a trainer ride gets its breathing from the Garmin that recorded alongside
const assert = require('assert');
const RD = require('./rides');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const ride = { id: 1794347623767, source: 'player', date: '2026-11-10', time: '16:53', intervals_id: 'i208486278' };
const acts = [
  { id: 'i208486278', name: 'VO2 4 × 4 (the player\'s upload)', start_date_local: '2026-11-10T16:53:00', average_respiration: 30 },
  { id: 'i208490000', name: 'Indoor Cycling (Edge)', start_date_local: '2026-11-10T16:55:12', average_respiration: 31.4 },
  { id: 'i208490001', name: 'Walk', start_date_local: '2026-11-10T18:40:00', average_respiration: 18 },
  { id: 'i208490002', name: 'Indoor Cycling (no strap)', start_date_local: '2026-11-10T16:54:00' },
];
ok('the Garmin recording that started within 15 minutes and carries breathing is picked, never the player\'s own upload', () => {
  assert.strictEqual(RD.pickRecorder(acts, ride).id, 'i208490000');
  assert.strictEqual(RD.pickRecorder(acts.filter(a => a.id !== 'i208490000'), ride), null);   // no breathing nearby: nothing merged
});
ok('a player ride without breathing is looked at again, at most every 20 minutes, for 3 days', () => {
  const today = require('./tz').todayKey();
  const r = Object.assign({}, ride, { date: today });
  assert.strictEqual(RD.needsBreath({ resp: null, ve: null }, r), true);
  assert.strictEqual(RD.needsBreath({ resp: null, ve: null, breath_checked_at: new Date().toISOString() }, r), false);
  assert.strictEqual(RD.needsBreath({ resp: { avg: 30 } }, r), false);
  assert.strictEqual(RD.needsBreath({ resp: null }, Object.assign({}, r, { date: '2020-01-01' })), false);
  assert.strictEqual(RD.needsBreath({ resp: null }, Object.assign({}, r, { source: 'strava' })), false);
});
console.log(n + ' passed');
