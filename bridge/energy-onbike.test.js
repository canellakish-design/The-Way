// node bridge/energy-onbike.test.js
const assert = require('assert');
const E = require('./energy-math');
let n = 0; function ok(name, fn) { fn(); n++; console.log('ok ' + name); }
ok('a bottle logged at the end of the ride landed during the ride: nothing is still arriving an hour later', () => {
  const sessions = [{ name: 'Morning Ride', time: '09:49', minutes: 83, tss: 59, done: true, sport: 'Ride' }];
  const late = E.model({ ftp: 175, now_min: 12 * 60 + 52, sessions, meals: [], entries: [{ time: '11:01', slot: 'on the bike', meal: 'on the bike', name: 'One bottle of Tailwind, 2 scoops', carbs_g: 50, kcal: 200, fat_g: 0, protein_g: 0 }] });
  assert.ok((late.now.arriving_g || 0) < 3, 'arriving ' + late.now.arriving_g);
  const typed = E.model({ ftp: 175, now_min: 12 * 60 + 52, sessions: [], meals: [], entries: [{ time: '12:30', slot: 'lunch', meal: 'lunch', name: 'rice bowl', carbs_g: 80, kcal: 600, fat_g: 10, protein_g: 40 }] });
  assert.ok(typed.now.arriving_g > 20, 'a plate just eaten is still landing: ' + typed.now.arriving_g);
});
console.log(n + ' passed');
