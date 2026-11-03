// node bridge/audit.test.js
const assert = require('assert');
const A = require('./audit');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('#17 doubles: three copies of one water are one thing to look at, listed once; a lone pair reads as a pair', () => {
  const plates = [
    { id: 'w1', time: '14:20', name: 'Water, 250 ml', drink: 'water', kcal: 0 },
    { id: 'w2', time: '14:21', name: 'Water, 250 ml', drink: 'water', kcal: 0 },
    { id: 'w3', time: '14:24', name: 'Water, 250 ml', drink: 'water', kcal: 0 },
    { id: 'e1', time: '19:23', name: 'Two eggs and toast', written: 'two eggs, toast' },
    { id: 'm', time: '19:30', name: 'Salmon and rice' },
    { id: 'e2', time: '19:31', name: 'Two eggs and toast', written: 'two eggs, toast' }
  ];
  const r = A.doublesOf(plates);
  assert.strictEqual(r.groups.length, 2, JSON.stringify(r.groups));
  assert.strictEqual(r.mark.w2, 'w1'); assert.strictEqual(r.mark.w3, 'w1'); assert.strictEqual(r.mark.e2, 'e1');
  assert.ok(/logged 3 times/.test(r.groups[0].text), r.groups[0].text);
  assert.ok(/7:31p Two eggs and toast looks like 7:23p/.test(r.groups[1].text), r.groups[1].text);
});

ok('#17 the self-check line counts what it lists', () => {
  const checks = [
    { key: 'journal-today', ok: false, items: ['a', 'b', 'c'] },
    { key: 'rides', ok: true, items: [] },
    { key: 'sessions', ok: false, detail: 'one ride is grading two sessions', items: [] },
    { key: 'dup', ok: false, items: ['a'] }
  ];
  const w = A.wordOf(checks, 0);
  assert.strictEqual(w.flagged, 4);
  assert.ok(/^4 things to look at: a · b · c · one ride is grading two sessions$/.test(w.word), w.word);
  assert.strictEqual(A.wordOf([{ ok: true, items: [] }], 2).word, 'Checked: 2 small repairs made, nothing to decide.');
  assert.strictEqual(A.wordOf([], 0).flagged, 0);
});
console.log(n + ' passed');
