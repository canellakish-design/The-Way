// node bridge/pack.test.js
const assert = require('assert');
const P = require('./pack');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('the packing list: the meals marked "Pack it", with where, when and how much; the dining hall is not on it', () => {
  const items = P.listFrom([
    { time: '07:00', slot: 'breakfast', kcal: 400, carbs_g: 50, protein_g: 30, what: 'Oats, fruit, a Huel shake.' },
    { time: '12:00', slot: 'lunch', kcal: 665, carbs_g: 95, protein_g: 50, what: 'High carb: protein and rice or pasta. Pack it: at Maryland SoccerPlex, before U18 ECNL vs VDA.' },
    { time: '12:15', slot: 'lunch', kcal: 600, carbs_g: 70, protein_g: 45, what: 'Balanced. In the dining hall at school.' }
  ]);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].where, 'Maryland SoccerPlex'); assert.strictEqual(items[0].at, '12:00p');
  assert.ok(/^Lunch, 12:00p at Maryland SoccerPlex: about 665 kcal, 95 g carbs, 50 g protein\. High carb/.test(items[0].line), items[0].line);
});
console.log(n + ' passed');
