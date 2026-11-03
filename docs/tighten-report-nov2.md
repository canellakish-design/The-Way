# The Way: an hour on the copy, finding where it can be tighter (Mon 2 Nov 2026, 9:20 to 10:00p)

**How it was run:**
- **Where:** https://deploy-preview-2--thewayforward.netlify.app only. The amber "The copy · test freely" banner showed on every page opened. The real site was never opened.
- **Width:** Claude in Chrome, 390 px, inside a frame on the copy's own origin. The Chrome window won't go narrower than 927 px.
- **Rules kept:** planning numbers untouched, all times typed in 12-hour form, no logins, no keys.
- **Clean up:** everything added was removed. The Day chain, Food totals and journal match the start; only the water balance had drifted with the clock.

**One change to the script:** the hour started at 9:21p, so "a ride 3 hours from now" would have fallen after midnight. The test ride went in at 10:00p instead, moved to 11:00p, then lengthened to 90 min. The ride then ran past midnight, which turned up its own faults (#8, #9).

**Screenshots** are in `tighten-screens.zip`:
- `a-day-baseline`
- `b-hydration-after-glass`
- `c-editor-630a-refused`

Everything else was read from the page text.

## 1. Findings, most frequent first

Kinds: 1 two numbers · 2 stale · 3 wrong kind of session · 4 doubles · 5 wasted words · 6 dead ends and extra taps · 7 layout · 8 advisor out of step.

| # | Page | What I did | What I saw | What I expected | Kind | Shot |
|---|---|---|---|---|---|---|
| 1 | Food, Day | Wrote "two eggs, toast, a banana", then photo + "chicken 180 g, rice 1 cup" at 9:26p | Verdict says **SNACK**. Journal card header says **dinner** (both entries). Card body says "snack slot". Day files both under the 9:04p **snack** row. Dinner (6:30p) stays "LOG", open. | One slot name everywhere. Dinner unlogged at 9:26p means this is dinner. | 1 | – |
| 2 | Food, Day | Added and moved a ride | Harry's real 9:04p chips were re-graded three times: PROTEIN LOW, then MISS, then PROCESSED. With the 10p ride, the chips moved off the snack row into an 8:00p "before" row. | A logged meal keeps its slot and the plan it was graded against. | 2 | – |
| 3 | Food | Logged the chicken | Verdict: "the slot wanted 235 kcal · 20C · 25P". The same card, opened: "Graded against the plan as it stood at 9:28p: 220 kcal · 15C · 25P". | One plan object for the verdict and the card. | 1 | – |
| 4 | Food vs Hydration | Read both | Food: "4 drinks today, on the Hydration page". Hydration: "Today's drinks · 6". After a glass and beers: Food 5 and 6, Hydration 7 and 8. | The same count, or Food says what it leaves out (the two shakes). | 1 | – |
| 5 | Hydration | Wrote "two beers" | Logged as **480 ml** (two 12 oz beers are about 710 ml). The balance **rose** from −47 to +52 ml; Live said beers after 8p *cost* water. "Drank 2.6 L", but the drinks listed add up to 2.3 L. No evening note about alcohol, on Hydration, Day, Live or Sleep. | Alcohol counted as a net loss, a note before bed, and a "drank" figure that matches the list. | 1 | – |
| 6 | Hydration | Tapped Glass 250 | "Drank" went up 0.2 L (1.6 to 1.8), but the balance went up only 51 ml (−98 to −47). | Either the balance moves by the glass, or one line explains the difference. | 1 | b |
| 7 | Day, Food | Logged 410 kcal, then 502 kcal | The Macros box stayed at **51** through both logs and a reload. It moved (to 40) only after the kcal correction. The 51 appears nowhere on the Food page. | The box follows every log, and its number is on the page it opens. | 2, 1 | – |
| 8 | Day | Ride at 11:00p, 90 min | Day row "11:00p **12:30p**". Earlier dinner row "11:30p **12:00p**". | 12:30a, 12:00a. | 1 | – |
| 9 | Day | Lengthened the late ride to 90 min | Dinner vanished from the day entirely. No post-ride meal was scheduled after 12:30a. | A post-ride meal or a bedtime snack, not nothing. | 3 | – |
| 10 | Day | Put Pull on the calendar at 5:30p | Dinner became "6:55p · **Within 2 hours of the ride**: 45 g protein and carbs · 1045 kcal · 170C". | A lift gets no post-ride-sized meal and isn't called a ride. | 3 | – |
| 11 | Day, Food | Advisor: "I ran 30 minutes on the treadmill at noon" | The advisor says "logged". The Day row reads "**PLAN**". Food's note reads "Ridden 0 of 90 min planned (**null%**)". | The run marked done; no "null". | 3, 5 | – |
| 12 | Day, Fuel | 90-min ride planned | No on-the-bike bottle on Day or Fuel. Fuel only shows "92% at 11:00p". | ~30 g/h for 90 min, per his rules. | 3 | – |
| 13 | Day | Added the 10p ride at 9:37p | A "before" slot at **8:00p** and Beetroot "due 7:30p", both already past when they appeared. | Slots that already passed don't appear; say "too late for beetroot". | 6 | – |
| 14 | Ride | Opened at 9 pm, nothing planned | "WEAR AT **9:00A**" and "COURSES FOR **9:00A**" under today's header. With the 10p ride the grade is F "dark", yet it shows "Wear at 10:00p: short bibs…" and road loops ranked "for the wind at your back on the way home" under "INDOORS". | Indoors means trainer kit and no outdoor courses; times that are ahead of now. | 1, 3 | – |
| 15 | Workout editor | Zone 1, 60 min, sport Road | Notes read "ZONE 1 **on the trainer**: ERG holds 105 to 120 W". | Road notes for a road ride. | 3 | c |
| 16 | Food | Same Write text twice, 22 s apart | Both logged (+360 kcal). No warning on Food. Day's audit flagged it later. | "Looks like the same entry again — keep both?" at logging time. | 4 | – |
| 17 | Day (audit line) | Read it | "**2 things** to look at", then 4 to 5 pairs, including **yesterday's** Tailwind, Nov 1's beers, and the 2:20p water pair twice. | A count that matches the list; today only. | 1 | a |
| 18 | Calendar | Read Monday | "1:50 planned · 1:50 done" for a single 55-min Push. The copy holds **two Push entries today**, one untimed and one at 1:30p. | One Push. Remove the untimed copy, or merge them. | 4 | – |
| 19 | Day vs Calendar | Read both | Plan box "100% ahead"; Calendar "Done of plan 16%". The chain's week is Oct 27 – Nov 2; the Calendar's is "Week of Nov 2". | One week, one percent, or two clearly different labels. | 1 | a |
| 20 | Day vs Lift | Read both | Lift box "100% plan"; Lift page "1 of 5 this week". After the Pull was saved: the strip dropped Push from Monday and showed Pull on both Mon and Wed. The strip shows "Sat 7 · Up 2", but Calendar Saturday is "Rest". | One count; the strip mirrors the calendar. | 1, 4 | – |
| 21 | Day vs Fuel | Read both | Fuel box shows "58% fed" and "86%" together. Fuel page: "Week 58%" pill vs "Fuel now 87%". Live repeats Fuel now (87%) and the "How did the legs feel on Push?" 1–5 row. | One headline number per box; one place for the legs question. | 1, 5 | – |
| 22 | Food | Log, correct, remove | The correction took 9 to 17 s to show, and removals over 6 s, with no "saving…" between. | Instant local update, then sync. | 2, 6 | – |
| 23 | Food | Logged meals at 9:26 to 9:31p | Advice on food already eaten: "skip the rice tonight or save this for tomorrow", "skip it and stop eat…". | Advice about what's next, not undoing what's logged. | 8 | – |
| 24 | Advisor vs Day | "what's left to eat today?" | Advisor: carbs; "a banana or a small rice bowl before 11:00p, then rice or potatoes after". Day: a 9:00p "before" slot of "something light with protein, Greek yogurt", and a 6:55p dinner still open at 1045 kcal. | The advisor names the open slots the page shows. | 8 | – |
| 25 | Food | Read the bars | Carbs shows **✓** at 213/205 and 239/205, while protein and fat show "+77" and "+39". | Over is over: "+34". | 1 | – |
| 26 | Food | Logged eggs and yogurt | Eggs, toast, banana and plain Greek yogurt are tagged **PROCESSED**. Yogurt is also tagged "KCAL 845% OVER", because the grade is for the whole snack slot. | Whole foods untagged; grade the item, or say "the snack slot is 845% over". | 1, 5 | – |
| 27 | Food | Verdict text | It stops mid-sentence: "…no butter, and ·". | Whole sentence. | 5 | – |
| 28 | Day | First screen | The ten chain boxes fill the whole first screen; the schedule starts two screens down. A "Push · 55 min · 28 TSS" pill repeats the row below it. | The next thing due near the top; no repeated pill. | 5 | a |
| 29 | Day | Chain boxes | Units cut off: Plan "100% ah…" and Lift "100% pl…". | Fits, or drop the unit word. | 7 | a |
| 30 | Several | Scrolled | The floating mic covers the row trash icons on Day, a step's ✕ in the workout editor, and sits on the photo form's Log-it row. | Bottom padding so nothing sits under the mic. | 7 | – |
| 31 | Workout editor | Saved a 6:30a start | The refusal is plain words now, but it shows **below the fold**; the field still shows 6:30 AM. | Message beside Save, field reset to 7:00a. | 6 | c |
| 32 | Workout editor | Opened it | Three ways back: "‹ Calendar", "‹ Day", "← The week". A new workout for today defaults to 9:00p when it's 9:36p. | One back link; default to the next free hour ahead. | 6 | c |
| 33 | Ride, Hydration, Fuel, Sleep, Recovery, Weight, Micros | Opened each | "loading…" for 2.9 to 3.7 s each; Day and Calendar take about 0.4 s. | Under a second, or show last-known numbers while loading. | 6 | – |
| 34 | Workout editor | Opened a workout id that isn't in the copy | "Couldn't load · bridge 404 — no such workout". | "This workout was removed", plus a link to the week. | 6 | – |
| 35 | Lift, advisor | Read text | ISO dates: "last: Push, 2026-11-02"; advisor "Treadmill run, 2026-11-02 at 12:00p". | "Mon, Nov 2". | 5 | – |
| 36 | Weight | First screen | Big **217** from **Aug 17**; "This week —"; three sentences of explanation; Withings not connected. | Say "last weigh-in Aug 17" up top; collapse the rest until there's data. | 5 | – |
| 37 | Micros | First screen | "Low: fibre", but fibre isn't on the first screen; iron, calcium and magnesium at 100 are listed first. | Shortfalls first. | 5 | – |
| 38 | Live, Recovery, Hydration | First screens | Explanation paragraphs above or beside the numbers: "The 87% is what is in the blood…", "The week: a new watch…". The hydration line "0.0 L down on the morning" says nothing. | Numbers first; explanations behind "Why". | 5 | b |
| 39 | Food | Tapped "Log it" with the box empty | Nothing happens, with no message. | "Write what you ate first." | 6 | – |
| 40 | Calendar | First screen | The week's bar chart fills only Monday; planned Tue to Sun show "—". | Planned bars drawn as outlines. | 5 | – |

**What worked:**
- Every chain box opens the page it names: Plan to Calendar, Sleep, Water to Hydration, Macros to Food, Micros, Lift, Fuel, Ride to Ride, Recovery, Weight.
- Photo plus words logs as one entry, showing the photo and the words.
- After the kcal correction, the grade, bars and Day row all follow.
- The glass stays off the Food list.
- The ride's name follows its length ("Zone 1, 90 min").
- 6:30a is refused in plain words, with no "bridge 400" prefix.
- The lift form takes "5:30p", and its confirmation reads "Mon, Nov 2".
- A lift saved with ticks shows LOGGED on Day and is counted in the Lift box.
- The run adds 330 kcal and doesn't count as ride minutes.
- The advisor's "is my lift done?" answer matches the pages.
- No sweetener was suggested anywhere.

## 2. Top ten ways to tighten
1. **One slot per meal, chosen once:** the verdict, the journal card, the Day row and the Macros box all use the slot saved on the entry. After 8 p.m., with dinner open, a meal is dinner.
2. **Freeze logged meals:** keep the grade, slot and plan snapshot from the moment of logging. Plan changes reshape only the open slots.
3. **Hydration and Food count drinks the same way:** Food says "6 drinks (2 shakes are here as meals)" or drops the line. Beers count as about 355 ml each and as a net loss, with one bedtime note.
4. **Session kind decides the food:** a lift never gets "within 2 hours of the ride" or a ride-sized dinner. A run logged by the advisor is done, not PLAN. Every ride over 75 min gets its bottle on Day and Fuel.
5. **Past midnight works:** times after midnight read "12:30a", and a late ride keeps a post-ride meal.
6. **Day top screen = what's next:** shrink the chain to one compact row of ten numbers (or a 2×5 grid without the subtitles). Put "Next: Zone 1, 90 min at 11:00p · eat X before" right under it. Drop the duplicate session pill.
7. **One number per box:**
   - Fuel shows the week %, not week % plus fuel now.
   - Plan matches the Calendar's "done of plan", or is labelled "placed".
   - The Lift box shows "1 of 5", as the Lift page does.
   - The Macros box number is printed at the top of Food.
8. **Merge Live into Fuel and Hydration:** they repeat Fuel now, the legs question and the hydration line. That's one fewer tab.
9. **Instant feedback:** corrections and removals update the card at once with "saving…". The double-log check runs at logging time on Food, not only in the Day audit, and the audit's count matches its list (today only).
10. **Cut words above the numbers:**
    - Weight: "Last weigh-in Aug 17" up top; collapse the rest.
    - Live, Recovery, Hydration: the explanations go behind "Why".
    - Hydration: drop "Anything with calories…", since the Write tile already says it.
    - Micros: shortfalls first.
    - Verdicts: no mid-sentence cut.
    - Dates as "Mon, Nov 2" everywhere.

## 3. Numbers that disagreed
| Thing | Value one (page) | Value two (page) |
|---|---|---|
| Slot of a 9:26p meal | SNACK (Food verdict) | dinner (Food journal header); snack row (Day) |
| Plan for the snack slot | 235 kcal · 20C · 25P (Food verdict, Day row) | 220 kcal · 15C · 25P (Food journal card) |
| Drinks today | 4 / 5 / 6 (Food) | 6 / 7 / 8 (Hydration) |
| Drank, after beers | 2.6 L (Hydration, Live) | 2.3 L, the sum of the list (Hydration) |
| Effect of a 250 ml glass | +0.2 L drank (Hydration) | +51 ml balance (Hydration, Day Water box) |
| Effect of two beers | +0.8 L drank, +99 ml balance (Hydration) | "beers after 8 p.m. cost water" (Live's own note) |
| Macros today | 51, unchanged after +912 kcal (Day box) | 2,921 / 2,190 kcal (Food) |
| Carbs | ✓ at 239 / 205 (Food) | protein "+77", fat "+39" on the same bars |
| Plan | 100% ahead (Day box) | Done of plan 16% (Calendar) |
| This week | Oct 27 – Nov 2 (Day chain) | Week of Nov 2 (Calendar) |
| Lift this week | 100% plan (Day box) | 1 of 5 (Lift page) |
| Saturday | Up 2 (Lift strip) | Rest (Calendar) |
| Monday lift time | 55 min Push (Day row) | 1:50 planned (Calendar) |
| Fuel | 58% fed and 86% (Day box) | Week 58% pill and Fuel now 87% (Fuel page) |
| Audit | "2 things to look at" (Day) | 4 to 5 pairs listed in the same line |
| A run at noon | "logged" (advisor), done (Food) | PLAN (Day row) |
| 11:00p ride end | 12:30p (Day row) | 12:30a (the clock) |

## 4. Console errors and layout faults
- **Console errors:** none. Error hooks were placed in the frame for the whole hour, and Chrome's console reader was checked.
- **scrollWidth:** 390 on every page: Day, Ride, Calendar, Workout editor, Food, Hydration, Fuel, Live, Sleep, Recovery, Weight, Micros, Lift, Zones, Settings.
- **Clipped text:**
  - Day: the Plan box unit "ahead" and the Lift box unit "plan" are cut with "…".
  - Zones: the five zone percentages (13%, 18%, 17%, 14%, 21%) are cut inside their bars.
- **Hidden behind the floating mic:**
  - Day: trash icons on the rows.
  - Workout editor: a step's ✕.
  - Food: the right edge of the photo form's Log-it row.
  - Calendar: the LOGGED pill on today's row.
- **Slow first paint (2.9 to 3.7 s of "loading…"):** Ride, Hydration, Fuel, Sleep, Recovery, Weight, Micros.

## First screen of each page, one line
- **Day:** The chain fills it. The most useful thing, what's next and when, is two screens down.
- **Ride:** At 9 p.m. a giant F for right now plus clothes for 9:00a; the planned ride, when there is one, sits below.
- **Calendar:** The three numbers are right at the top. The week chart below is mostly empty.
- **Workout editor:** Name, date and start are on top. Time, TSS and IF are below the notes and off the first screen. Three back links.
- **Food:** Good. kcal and three bars on top, then logging tiles.
- **Hydration:** Good. Balance on top. The "Anything with calories…" sentence repeats the Write tile.
- **Fuel:** Fuel now and legs on top. The Week 58% pill is a second headline.
- **Live:** It repeats Fuel, with a paragraph above the chart.
- **Sleep:** Good. Week average and last night on top.
- **Recovery:** The numbers are on top, but the paragraph about the new watch sits between the chart and this morning.
- **Weight:** A two-month-old 217 is the headline, and it's mostly setup text.
- **Micros:** The shortfall (fibre) isn't on screen.
- **Lift:** The week strip and next session are on top.
- **Zones:** Signature numbers are on top. The long confidence and ramp-test text could fold.
- **Settings:** Connections on top, 3 of 10 live. WHOOP shows "auth error", and Calendar feeds show "no feeds set".
