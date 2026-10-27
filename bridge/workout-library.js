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
const pc = (lo, hi) => ({ type: 'power', lo, hi: hi == null ? lo : hi });

const EAT = {
  short: `ZONE 1: heart rate under 116 the whole ride. If it climbs, the watts come down.

EAT
Before: normal breakfast, or ride first and eat straight after.
On the bike: water, one bottle.
After: protein within the hour (whey, oats).
The day: a normal day, no extra carbs.`,
  mid: `ZONE 1: heart rate under 116 the whole ride.

EAT
Before: normal breakfast 1 to 2 hours before.
On the bike: one bottle of Tailwind, 2 scoops (50 g carbs).
After: protein and carbs within the hour.
The day: normal.`,
  long: `LONG ZONE 1: heart rate under 116. Flat route, R5.

EAT
Before: carb breakfast 2 to 3 hours before (oats and fruit).
On the bike: 60 g carbs an hour from the first 20 minutes. Tailwind 2 scoops a bottle plus a fig bar (37 g) each hour. Over 2 hours: 75 to 85 g an hour. No Nuun in the Tailwind.
After: whey and carbs within 30 minutes.
The day: higher carb day.`,
  vo2: `VO2 MAX: ride Zwift's 40/20's #1 (Workouts > VO2 Max). The steps below only mirror it so the load shows here.
Judge it by one number: minutes above 147 bpm, target 8 to 12.
When done: SAVE the ride in Zwift. Never exit without saving.

EAT
Ride fed and fresh, never fasted.
Before: carb breakfast 2 to 3 hours before (70 g oats and fruit). Carbs the evening before too.
On the bike: one bottle of Tailwind, 2 scoops (50 g carbs). Fan on.
After: whey and carbs within 30 minutes.
The day: higher carb day.`,
  mtb: `MOUNTAIN BIKE: bike handling only. No power or heart rate target. Cornering, braking late, line choice, descending.

EAT
Before: normal breakfast.
On the bike: one bottle of Tailwind, 2 scoops, and one fig bar.
After: a normal meal with protein.
The day: normal.`
};

const z1 = min => [step('Settle', m(5), hr(95, 110)), step('Zone one', m(min - 8), hr(100, 116)), step('Easy', m(3), hr(90, 105))];
const z1Notes = min => min >= 90 ? EAT.long : min >= 75 ? EAT.mid : EAT.short;
const set = label => rep(label, 5, [step('On', 40, pc(120)), step('Off', 20, pc(50))]);

const LIBRARY = [
  ...[45, 60, 75, 90, 105, 120, 135, 150].map(min => ({
    key: 'z1-' + min, name: `Zone 1, ${min} min`, sport: min >= 90 ? 'Ride' : 'VirtualRide',
    notes: z1Notes(min), steps: z1(min)
  })),
  {
    key: 'vo2-4020', name: 'VO2 max: Zwift 40/20s #1', sport: 'VirtualRide', notes: EAT.vo2,
    steps: [
      step('Build', m(10), { type: 'ramp', from: 50, to: 75 }),
      rep('Openers', 3, [step('Opener', 15, pc(150)), step('Easy', 45, pc(55))]),
      step('Steady', m(4), pc(65)), step('Tempo', m(3), pc(85)), step('Easy', m(3), pc(55)),
      set('Set one'), step('Recover', m(4), pc(55)),
      set('Set two'), step('Recover', m(4), pc(55)),
      set('Set three'), step('Cool down', m(4), pc(50))
    ]
  },
  ...[60, 75, 90].map(min => ({
    key: 'mtb-' + min, name: `Mountain bike handling, ${min} min`, sport: 'Ride', notes: EAT.mtb,
    steps: [step('Bike handling', m(min), { type: 'free' })]
  }))
];

module.exports = { LIBRARY, EAT };
