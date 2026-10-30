// node bridge/menus.test.js
const assert = require('assert');
const M = require('./menus');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

ok('a place matches its brand by name or brand field, loosely', () => {
  assert.strictEqual(M.brandFor({ name: 'Chipotle Mexican Grill' }).key, 'chipotle');
  assert.strictEqual(M.brandFor({ name: 'Wawa #8042', brand: 'Wawa' }).key, 'wawa');
  assert.strictEqual(M.brandFor({ name: "Jersey Mike's Subs" }).key, 'jerseymikes');
  assert.strictEqual(M.brandFor({ name: 'Chick-fil-A' }).key, 'chickfila');
  assert.strictEqual(M.brandFor({ name: "Bob's Diner" }), null);
});

ok('the order follows the slot: a carb cap keeps the bowl off the rice, a post-ride slot wants the carbs back', () => {
  const chip = M.brandFor({ name: 'Chipotle' });
  const low = M.choose(chip, { kcal: 450, carbs_g: 20, protein_g: 40, low_carb: true, slot: 'lunch' });
  assert.ok(/no rice|salad/.test(low[0].name), low[0].name);
  assert.ok(low[0].carbs_g <= 45, 'carbs ' + low[0].carbs_g);
  const post = M.choose(chip, { kcal: 650, carbs_g: 90, protein_g: 45, low_carb: false, slot: 'after' });
  assert.ok(post[0].carbs_g >= 60 && post[0].protein_g >= 36, post[0].name + ' ' + post[0].carbs_g + 'C');
  assert.ok(post.every(o => !/chips and guacamole/i.test(o.name)), 'fried chips do not win');
});

ok('a snack slot may be a drink or a side alone; his usual comes first when it is close', () => {
  const wawa = M.brandFor({ name: 'Wawa' });
  const snack = M.choose(wawa, { kcal: 250, carbs_g: 30, protein_g: 20, low_carb: false, slot: 'snack' });
  assert.ok(snack.length === 3 && snack[0].kcal <= 400, JSON.stringify(snack[0]));
  const usual = M.choose(wawa, { kcal: 450, carbs_g: 55, protein_g: 30, slot: 'lunch' }, [{ name: 'Turkey hoagie, shorti, on wheat with lettuce and tomato', count: 4 }]);
  assert.ok(usual[0].yours && /Turkey hoagie, shorti/.test(usual[0].name), usual[0].name);
});
console.log(n + ' passed');
