// ============================================================
// workout-library.js — the only three workouts in the plan (Harry, 26 Oct 2026):
//   1. Zone 1 rides (heart rate led, length varies)
//   2. VO2 max: Zwift's "40/20's #1" (ridden in Zwift; mirrored here so the
//      load shows on the calendar and in intervals.icu)
//   3. Mountain bike handling, once a week, no targets
// Each carries simple eating guidelines for the day in its notes.
// ============================================================
const m = n => n * 60;
const step = (label, dur_s, target, cadence) => ({ kind: 'step', label, dur_s, target, cadence: cadence || null });
const rep = (label, count, steps) => ({ kind: 'repeat', label, count, steps });
const hr = (lo, hi) => ({ type: 'hr', lo, hi });
const cad = (lo, hi) => ({ lo, hi: hi == null ? lo : hi });
const pc = (lo, hi) => ({ type: 'power', lo, hi: hi == null ? lo : hi });

const EAT = {
  short: `ZONE 1 on the trainer: ERG holds 105 to 120 W. Heart rate still rules: if it goes to 117, drop the bias 5% and stay there.

EAT
Before: low carb breakfast, under 20 g of carbs, 30 g protein (eggs, Greek yogurt, a smoothie). Zone 1 needs no carbs before it.
On the bike: water. Nothing to eat under 75 minutes.
After: a real meal within 2 hours, 45 g protein and carbs.
The day: normal.`,
  mid: `ZONE 1 on the trainer: ERG holds 105 to 120 W. Heart rate still rules: at 117, drop the bias 5%.

EAT
Before: low carb breakfast, under 20 g of carbs, 30 g protein, 1 to 2 hours before. Zone 1 needs no carbs before it.
On the bike: Tailwind, 1 scoop a bottle: about 30 g carbs an hour from the first 20 minutes.
After: a real meal within 2 hours, 45 g protein and carbs.
The day: normal.`,
  long: `LONG ZONE 1: heart rate 116 and under. Flat route, R5.

EAT
Before: carb breakfast 2 to 3 hours before (oats and fruit): two hours and more makes it a higher carb day.
On the bike: 60 g carbs an hour from the first 20 minutes. Tailwind 2 scoops a bottle plus a fig bar (37 g) each hour. Over 2.5 hours: 90 g an hour, glucose and fructose together. No Nuun in the Tailwind.
After: a real meal within 2 hours, 45 g protein and carbs.
The day: higher carb day.`,
  vo2: `VO2 MAX: ride Zwift's 40/20's #1 (Workouts > VO2 Max). The steps below only mirror it so the load shows here.
Judge it by one number: minutes above 152 bpm, target 8 to 12.
When done: SAVE the ride in Zwift. Never exit without saving.

EAT
Ride fed and fresh, never fasted.
Before: carb breakfast 2 to 3 hours before (70 g oats and fruit). Carbs the evening before too.
On the bike: one bottle of Tailwind, 2 scoops (50 g carbs). Fan on.
After: a real meal within 2 hours, 45 g protein and carbs.
The day: higher carb day.`,
  lift: `LIFTING: Bigger Leaner Stronger, five days a week (push, pull, upper, legs, upper), each once every seven days. Legs goes the day before a day off the bike or a long coaching day. Heavy and short: 4 to 6 reps on the big lifts, three minutes between hard sets. Log it set by set on the Lift tab; it tells you the next weight.

EAT
Before: a normal meal 1 to 2 hours before, or the whey shake if it is first thing.
After: protein within 2 hours, 45 g. No extra carbs for lifting.
The day: normal.`,
  mtb: `MOUNTAIN BIKE: bike handling only. No power or heart rate target. Cornering, braking late, line choice, descending.

EAT
Before: low carb breakfast, under 20 g of carbs, 30 g protein.
On the bike: water under 75 minutes; from 75, Tailwind 1 scoop a bottle, about 30 g carbs an hour.
After: a real meal within 2 hours, 45 g protein and carbs.
The day: normal.`
};

// Trainer rides carry a power target so Zwift's ERG can hold it (and so the
// session shows on Zwift's home screen); road rides are heart-rate led.
const z1 = min => min >= 90
  ? [step('Settle', m(10), hr(95, 110)), step('Zone one', m(min - 15), hr(100, 116)), step('Easy', m(5), hr(90, 105))]
  : [step('Settle', m(5), pc(50, 58), cad(85, 95)), step('Zone one', m(min - 8), pc(60, 68), cad(85, 95)), step('Easy', m(3), pc(50))];
// 90 and 105 minutes are road rides (heart-rate led), so their note says so.
const roadHead = t => t.replace(/^ZONE 1 on the trainer:[^\n]*/, 'ZONE 1 on the road: heart rate under 116 the whole ride. Flat route. If it climbs, the watts come down.');
const z1Notes = min => min >= 120 ? EAT.long : min >= 90 ? roadHead(EAT.mid) : min >= 75 ? EAT.mid : EAT.short;
// Step for step the same as Zwift's own "40/20's #1", so the copy intervals.icu
// pushes to the Zwift home screen is the real session.
const set = (label, off_s) => rep(label, 5, [step('On', 40, pc(109), cad(95)), step('Off', off_s, pc(55), cad(80))]);

const LIBRARY = [
  ...[45, 60, 75, 90, 105, 120, 135, 150].map(min => ({
    key: 'z1-' + min, name: `Zone 1, ${min} min`, sport: min >= 90 ? 'Ride' : 'VirtualRide',
    notes: z1Notes(min), steps: z1(min)
  })),
  {
    key: 'vo2-4020', name: 'VO2 max: Zwift 40/20s #1', sport: 'VirtualRide', notes: EAT.vo2,
    steps: [
      step('Easy', m(3), pc(50)),
      rep('Openers', 4, [step('Opener', 10, pc(175), cad(110)), step('Easy', 50, pc(50), cad(80))]),
      step('Steady', m(3), pc(70), cad(95)), step('Easy', m(2), pc(50)),
      step('Tempo', m(5), pc(90), cad(90)), step('Easy', m(3), pc(50), cad(85)),
      set('Set one', 30), step('Recover', m(5), pc(50), cad(85)),
      set('Set two', 20), step('Recover', m(5), pc(50), cad(85)),
      set('Set three', 20), step('Cool down', m(5), pc(50), cad(85))
    ]
  },
  ...[60, 75, 90].map(min => ({
    key: 'mtb-' + min, name: `Mountain bike handling, ${min} min`, sport: 'Ride', notes: EAT.mtb,
    steps: [step('Bike handling', m(min), { type: 'free' })]
  })),
  // The five lifting sessions (lifts.js has the exercises, sets and the
  // progression); here each is a block the calendar can hold.
  { key: 'lift-push', name: 'Push', sport: 'WeightTraining', notes: EAT.lift, steps: [step('Lift', m(55), { type: 'free' })] },
  { key: 'lift-pull', name: 'Pull and calves', sport: 'WeightTraining', notes: EAT.lift, steps: [step('Lift', m(55), { type: 'free' })] },
  { key: 'lift-upper-1', name: 'Upper body and core (Upper 1)', sport: 'WeightTraining', notes: EAT.lift, steps: [step('Lift', m(50), { type: 'free' })] },
  { key: 'lift-legs', name: 'Legs', sport: 'WeightTraining', notes: EAT.lift, steps: [step('Lift', m(55), { type: 'free' })] },
  { key: 'lift-upper-2', name: 'Upper body and core (Upper 2)', sport: 'WeightTraining', notes: EAT.lift, steps: [step('Lift', m(50), { type: 'free' })] }
];

module.exports = { LIBRARY, EAT };
