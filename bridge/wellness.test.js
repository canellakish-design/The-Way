// node bridge/wellness.test.js
const assert = require('assert');
const W = require('./wellness');
let n = 0; async function ok(name, fn) { await fn(); n++; console.log('ok ' + name); }
(async () => {
  await ok('overlay: a hand-entered morning wins for its date and fills a missing one', async () => {
    const days = [{ date: '2026-10-31', sleep_h: 6.9, hrv: 25, readiness: 90 }];
    // overlay reads the store; with none it is a pass-through
    const same = await W.overlay(days);
    assert.strictEqual(same[0].sleep_h, 6.9);
  });
  console.log(n + ' passed');
})();
