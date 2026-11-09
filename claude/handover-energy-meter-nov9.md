# Handover: Claude Code · the energy-balance meter next to CTL, plus two nutrition fixes (9 Nov 2026)

Repo `canellakish-design/The-Way`. Branch first, keep `npm test` green, and ask Harry before pushing to `main`.

## 1. The meter (Harry, 8 Nov)
"At the top next to CTL put a meter. Noon on the meter is maintaining weight. Left of noon is losing weight. Right of noon is gaining weight. It adjusts based on food eaten and exercise done, along with daily calorie expenditure based on weight and age."

**Where:** the front page, beside the Training (CTL) score in the scores row (`scores.js` / the PWA's score tiles). Same size as its neighbours.

**What it shows:** a half-dial gauge, 9 o'clock to 3 o'clock.
- **Needle at noon:** eaten = burned, so weight is holding.
- **Left of noon:** a deficit (losing). Right of noon: a surplus (gaining).
- **Full scale:** ±1,000 kcal. Clamp past that and show the true number.
- **A thin tick at the day's target deficit**, from `targets()` (about −450, less on a high-carb or red-recovery day).
- **Under the dial:** "−380 kcal so far · target −450" and a small line "≈ −0.8 lb a week at this rate" (7-day average × 7 ÷ 3,500).

**The numbers:** one source only, the `balance` that `food.js` `dayReport` already builds from `food-math.balanceSeries`.
- **Out:**
  - Base burn = Mifflin-St Jeor (10·kg + 6.25·cm − 5·age + 5) × activity 1.35.
  - kg comes from the latest weigh-in.
  - Plus the kcal of sessions actually **done**: rides from Strava/Garmin, and lifts and kettlebell blasts logged.
- **In:** food logged so far.
- **Solid needle:** `balance.now`, what has happened to this minute.
- **Faint ghost needle:** `balance.end`, the projected day if the plan's remaining meals and sessions happen.
- **Tap for detail:** a small breakdown opens, and the 7-day average needle.
- **BMR shown explicitly (Harry, 9 Nov: "that needs to be added to this meter").** The breakdown lists the burn in three parts, never one lump:
  1. **BMR**, at rest: Mifflin-St Jeor from weight, height and age, e.g. "BMR 1,830".
  2. **Everyday movement**: BMR × 0.35 (teaching, coaching, on his feet), e.g. "+ daily 640".
  3. **Exercise done**: rides, lifts and blasts finished so far, e.g. "+ exercise 420".
  - Then **eaten** and **net**, e.g. "eaten 2,410 · net −480".
  - Each part accrues through the day (BMR and everyday movement by the minute, exercise when done), so the needle drifts left until meals land.
  - Put a small "BMR 1,830/day" caption under the dial itself, so the baseline is always visible without tapping.

**Age must be a setting, not a constant.**
- `food-math.js` `PROFILE` has `age: 55`, which is the goal age for 2033, not Harry's age now. **Harry is 48 (he said so on 9 Nov 2026). Set 48 now**, and store age in the profile with a Setup field so he can change it. Same for height (178 cm).
- At 98.4 kg, 178 cm and 48, BMR is 1,862 and base burn is 2,513, up from 1,827 and 2,466 at age 55. Every day's kcal target rises by about 50.
- Weight follows the latest weigh-in. Show "from weigh-in, 8 Nov" so a stale weight is visible.

**Colour:** ink and grey only, with numbers in ink, following the colour principles in `claude/handover-magic-buckets-nov7.md`. No green for "losing": position carries the meaning.

**Tests:**
- `balanceSeries` at noon with known inputs gives the expected needle angle.
- Clamp at ±1,000.
- An age change moves base burn by 5 kcal per year.
- With no food logged, the needle sits left of noon by base burn × fraction of the day.

## 2. Beetroot timing for early rides (supps.js)
- **Problem:** beetroot is placed "2 to 3 h before" each ride, so a 7:00 ride gets beetroot at 4:30 a.m. (seen on Mon 9 and Tue 10 Nov).
- **Fix:** never schedule a supplement before 5:30 a.m. For a ride before 8:30, show beetroot "on waking (5:30)", with the note "less than the full 2 h, still worth it". Add a test.

## 3. Kettlebell Blasts count as exercise
- Workouts named "Kettlebell Blast …" (sport WeightTraining, 30 min) are Harry's at-home extras, alongside the five gym lifts.
- Estimate them at about 6 kcal a minute (≈180 kcal), not the cycling "free ride" estimate.
- Count them in the meter's exercise once logged. They are not one of the five lifts in the Lift count; show them as "+1" like the Pump.

## Done when
- The meter sits next to CTL on the front page, moves when a meal is logged or a ride lands, and noon means maintenance.
- Age and height are settings.
- No supplement shows before 5:30 a.m.
- `npm test` is green.
