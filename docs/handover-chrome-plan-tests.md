# Handover: Claude in Chrome · plan-change tests for The Way

Site: https://thewayforward.netlify.app (no login; the PWA talks to its bridge at `/.netlify/functions/api`, which accepts the app's own requests). Use a phone-width window (390 px) for every check, since that is how Harry uses it.

## What the site is

A cycling training and food app for one rider. Six tabs: **Day** (the chain, the day card), **Ride** (conditions grade, windows, courses), **Calendar** (the week's sessions, the workout builder), **Food** (meal plan, journal, advisor), **Live** (fuel and hydration curves), **Lift** (the five-day plan). Every tab reads the same stores on the bridge. The point of these tests: when the plan changes in one place, every other place must follow, with no stale number left anywhere.

The bridge also audits itself on every Day page load and prints one line under the chain (`#auditNote`): "Checked: every page reads the same day." when clean, or "N things to look at: …" in amber. Read that line after every change.

## Standing rules (never break while testing)

- Planning FTP stays 175. Never set 196 anywhere. Do not touch Settings → planning numbers.
- 12-hour clock in anything you type ("4:30p", not 16:30).
- No workouts before 7 a.m. If you try to move one earlier, the app or the advisor should push back; note what it does.
- Do not delete Harry's real journal entries. The Tailwind entry marked "looks like … again" is his to remove, not yours.
- Everything you add is cleaned up at the end (list below).
- A Zwift ride is always saved, never exited (not relevant here, but do not touch Zwift).

## Baseline: capture before any change

On each tab take a screenshot and note:
- **Day**: the nine chain boxes (week number, colour) and their today cells; the "Today:" line; the audit line; every row of the day card (times, titles, tags); the Food detail's macro bars (tap the Macros box).
- **Ride**: the big grade and the line "Your ride at …"; the planned-ride cue; the windows list.
- **Calendar**: today's row(s): planned sessions, their compliance word, done rides.
- **Food**: day type and targets (kcal, carbs, protein); meal times and slots; the journal.
- **Live**: the fuel curve's session markers; hydration line.
- **Lift**: the week strip (which days carry a lift).
- Browser console: no errors; page `scrollWidth` equals window width (no sideways scroll).

## Scenario 1 · move the afternoon ride

Calendar → today's "Zone 1, 60 min · mountain bike" at 3:00p → change the start to 4:30p and save.

Expect, after reload of each tab:
- Day card: the ride row moves to 4:30p; the lunch and dinner rows move with it (lunch sits before the ride, dinner after); the chain's Plan today cell still counts it; "Today:" line names 4:30p.
- Ride: "Your ride at 4:30p" with a grade for 4:30 to 5:30 (it ends near sunset at 5:05p, so the grade should fall, possibly to F for the dark hour).
- Food: meal times shift the same way; day type unchanged (normal day).
- Live: the session marker moves on both curves.
- Audit line: clean.

Record anything that did not move.

## Scenario 2 · lengthen it

Change the same ride from 60 to 90 minutes.

Expect: Day card row end time; Ride tab cue "90 min"; Food targets rise (kcal and carbs up; the day may flip from "normal day" to "higher carb day" once the day's riding passes the threshold); the on-the-bike slot's carbs rise; chain Ride today cell reads 83/240; Plan box percent unchanged or up.

## Scenario 3 · remove it

Delete the afternoon ride (trash icon on its Day card row or in Calendar).

Expect: Food targets fall back; lunch and dinner return to the no-ride times; Ride tab's big grade falls back to "right now" with no ride line, or shows the morning ride as "Ridden, 83 of 150 min"; chain Plan box percent falls; Ride today cell reads 83/150; the meals already logged keep their grades (a logged meal is graded against the plan it was eaten under, never a plan redrawn later: the breakfast row's "(plan 640 · 90C · 45P)" must not change).

Then re-add it: Calendar → plan a workout → "Zone 1, 60 min", sport Ride, today 3:00p. Confirm everything returns to the baseline.

## Scenario 4 · a lift today

Lift tab → "Put this one on the calendar" for the next session (Push), today 5:30p.

Expect: chain Lift today cell changes from "—" to the session name with a time; Plan box percent rises (five lifts placed counts three tenths); Day card gets a lift row; Food plan unchanged except the lift's small fuel note. Remove it afterwards (trash on the row) and confirm the cells revert.

## Scenario 5 · log a meal, then correct it

Food → "Write it instead" → "two eggs and toast" → Log it.

Expect: a verdict card with the slot and grade; the Day card gets the meal on its row with the grade word; the Food plan ticks the slot; the Food detail's macro bars fill; if the grade is green, a green check pops and settles on the meal card (and a chime, if sound is on). The audit line stays clean (the entry carries its plan snapshot: open the journal card and confirm it shows the plan it was graded against).

Then on the journal card: Save correction → change kcal to 900 → save. Expect the grade to change on the journal card, the Food plan row, and the Day card row, all three, with no reload mismatch.

Remove the entry at the end (Remove on its journal card). Confirm the slot opens again everywhere.

## Scenario 6 · a drink

Log "a glass of water" by text. Expect: it appears in the journal as a drink, the Live hydration line steps up, and **no** meal slot is claimed (the Day card does not add a meal row for it; a drink with calories would get its own drink row, water does not). Remove it.

## Scenario 7 · a run by voice or text

Advisor (microphone or Type) → "I ran 30 minutes on the treadmill at 1pm".

Expect: a Run on today's calendar at 1:00p; Food targets rise by about 330 kcal; the Day card shows it; the chain Ride box does **not** count it (rides only). Remove the run afterwards (trash on its row).

## Scenario 8 · the rule against early starts

Calendar → tomorrow's ride at 7:00a → try to move it to 6:30a. Note what happens: the app should refuse or warn. Ask the advisor "move tomorrow's ride to 6:30" and note its answer. Restore 7:00a if anything moved.

## Scenario 9 · stale copies

After each change, without reloading, switch tabs and back. Note any tab that still shows the old value. Then reload (the app also reloads itself on focus when a new version is live). Note any value that differed between the two.

## Cleanup

- Afternoon ride back to "Zone 1, 60 min · mountain bike", Ride, today 3:00p, 60 min.
- Test lift removed. Test meals and the water removed. Test run removed.
- Tomorrow's ride at 7:00a.
- Nothing else changed.

## Report

One table: scenario · what changed · each tab (Day, Ride, Calendar, Food, Live, Lift) · followed? · screenshot. Then a list of every mismatch, with the two values and the tabs they were on. Console errors and any sideways scroll go in their own list.
