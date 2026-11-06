# Correction log

Every time Harry has to correct the site, it goes here: the date, what he saw, why it happened, the fix, and which kind it was. The point is the count. It should fall from daily to weekly within two weeks of 1 Nov, and from structural to small within a month.

**Kinds**
- **new case**: a real-world situation the site had not met (a trail ride with no power meter, two files for one ride).
- **disagreement**: two parts of the site computing the same thing their own way and showing different answers.
- **my mistake**: Claude Code changed something wrong, or a fix broke something else.
- **advisor**: the language model said something untrue.

**Standing plan, agreed 1 Nov**
- No new features from 1 Nov to 15 Nov. Fixes only, plus one cleanup a day that makes two disagreeing parts read from one source.
- Claude in Chrome runs `docs/handover-chrome-plan-tests.md` once a week. Its findings go in the second table, not this one: they are caught before Harry sees them.
- Review on 15 Nov: if the count has not clearly fallen, change the plan.
- One exception to the freeze, asked for by Harry on 1 Nov: the chain boxes became the navigation and the tab bar went.

## Corrections Harry made

| Date | What he saw | Cause | Fix | Kind |
|---|---|---|---|---|
| 1 Nov | Shrimp dinner graded red for "carbs 57% under" while its reading called it the right dinner | Macros graded under and over the same way; a light plate with its protein was a red | `9c83afe` | disagreement |
| 1 Nov | Three beers graded "on plan" | The plate reader was told a lone drink fits; nothing checked it for alcohol | `150dd11` | new case |
| 1 Nov | The beers he told the advisor about seemed not to be logged | They were logged, but drinks claim no meal slot, so the Day card had no row for them | `0017878` | disagreement |
| 1 Nov | Dinner card told him he needed 45 g more protein on a pound of shrimp | The slot showed the pint's sentence, written at 7:20 before dinner existed | `91281e4` | disagreement |
| 1 Nov | "No protein source" on a 117 g protein dinner | "Three beers" (plural) was not read as alcohol, and a slot's flags came from one item, not the plate | `cbb17d1`, `222d34b` | new case |
| 1 Nov | Advisor sheet stuck on screen, close button off the edge | Header could not wrap on a phone | `7109822` | new case |
| 1 Nov | Recovery detail rows squeezed to one letter a line | Row layout let the right column take the width | `643b8a9` | new case |
| 1 Nov | Two rows for one trainer ride, graded "over 311%" | Garmin and Zwift both upload the same ride to Strava | `2c2dc57` | new case |
| 1 Nov | Advisor said the morning ride was done in full | Claude shortened the planned ride to 75 min so the file would fit, hiding 67 missed minutes | plan restored; `911db8d` | my mistake |
| 1 Nov | The afternoon ride was graded against the morning file | One ride graded every planned session of the day | `911db8d` | disagreement |
| 1 Nov | Breakfast "240% over" on carbs | Graded against the low-carb breakfast the plan drew after the ride moved, not the one he ate under | `186562e` | disagreement |
| 1 Nov | Live fuel "31 g landing, peak 1:00p" an hour after the ride | Bottles logged at the end of the ride were landed at the minute typed | `76ff30b` | new case |
| 1 Nov | Claude treated "switching to indoor" as a run | Misread his message | ride re-added as a trainer ride | my mistake |
| 1 Nov | Advisor named a "1:00 run" that did not exist | The model paraphrased the day loosely | `bb5a130` | advisor |
| 1 Nov | Plan detail formatting broken on a phone | Same row layout issue | `f5fba04` | new case |
| 1 Nov | The now dot stuck near the top of the day card | It read the whole-day free band as a row | `89db4ec` | new case |
| 1 Nov | Mountain bike ride graded "short 57%" | Strava's estimated power, from a ride with no meter, was read as real power; Zone 1 was marked down for low load | `c75c6e2`, `b523eed` | new case |
| 1 Nov | Three beers logged twice, at 7:23p and 7:25p | The advisor did not see the beers already logged in an earlier turn, and the audit only compared neighbouring entries, so the shrimp logged between them hid the double | voice context lists the last three hours of the journal; the same words within twenty minutes are refused unless he says another; the audit compares every pair within ten minutes | advisor |
| 1 Nov | Journal cards squeezed the meal name to a word a line | The grade badge carried the whole sentence and sat in its own column | badge under the name, first clause only | new case |
| 1 Nov | Asked whether the calories follow the rides; they followed the plan when the plan was kept | A kept plan carried the planned ride's estimate, and a ride nobody planned was left out | the target carries every ride done plus what is still ahead | disagreement |
| 1 Nov | Today's 20 minutes at 164 W, his best in 90 days, got "no breakthrough yet" and nothing else | The page only knew breakthroughs (beating the curve, which already allowed 174 W); a best against his own rides had no line | new bests listed beside breakthroughs, with the curve's number | new case |

| 2 Nov | Say stuck on "Listening… tap to stop" on Food | The phone's recognizer went quiet without ending, and the reset waited on it | a tap always resets, eight seconds of silence stops it, an error puts the cursor in the box | new case |
| 2 Nov | Magnesium "Due" at 6:25 a.m. | The new Sleep page called anything not yet logged today due | 8:45p until half an hour before | my mistake |
| 2 Nov | Last night 4.4 h; the WHOOP said 5.9 h | First Garmin night, both watches worn; Claude first guessed the 4.4 was the WHOOP's | WHOOP's night entered at Harry's word | my mistake |
| 2 Nov | Macros "off" (24) at 2 p.m. after a normal lunch | The meal plan laid the day around the first session of any kind, so the Push lift got a before meal and an on-the-bike slot, lunch moved to 3:50p, the chicken and rice was graded as on-bike food and the day was judged as a third gone. The 1 Nov fix covered ride minutes and the day type, not the meal timing | meal plan built around rides only; a test with a lift alone and a lift plus a ride | disagreement |
| 2 Nov | Lift box red after the first Push of the plan, on schedule | The plan's first week was counted against a full five, though the code already worked out how many were due | first week judged against the sessions due since the start | my mistake |
| 2 Nov | Push saved on the Lift page, still "plan" on the Day card | The Day card's lift row only knew "logged by hand" from the calendar; a session saved on the Lift page never reached it | the calendar marks a planned lift done when the Lift page saved that session that day | disagreement |
| 2 Nov | The advisor did not know the Push was done | The day's sessions (what the advisor and the food plan read) still judged a lift by the clock, so the saved Push read as not started and slid to 8:35p | one shared check: a lift saved on the Lift page is done everywhere | disagreement |
| 2 Nov | Snack reading cut off mid-word; the day's target 180 kcal and 45 g carbs too high | Readings were cut at 240 characters; the advisor added a second, untimed Push at 8:19p when told the lift was done, and both copies were counted | readings to 420 characters and asked for 35 words; the advisor will not add a lift already on the calendar; an untimed copy of a timed lift counts once | advisor |
| 3 Nov | Advisor said "you're fuelled for it now" at 5:34a with nothing eaten | The fuel figure (71%) is what is left from yesterday after the night; the advisor read it as having eaten | the advisor is told when nothing is eaten today and never says he is fuelled; it names what to eat before the session | advisor |
| 3 Nov | Contradictions on the porridge before the VO2: "no real protein, no vegetables" and "heavy on starch" on a pre-ride snack whose plan asked for 0 g protein; the day's meals summed 200 kcal over the target; Fuel today read "no ride yet" with the pre-ride food in | Plate rules applied to fuel slots; the bottle was added on top of the day; today's fuel waited for the ride to start | fuel slots judged on carbs only; meals share the target after the bottle; today's fuel counts from four hours before a ride | disagreement |

**1 Nov: 21 corrections.** 11 new case, 6 disagreement, 2 my mistake, 2 advisor.
**2 Nov: 8.** 1 new case, 3 disagreement, 3 my mistake, 1 advisor.
**3 Nov so far: 2.** 1 disagreement, 1 advisor.

## Found by the Chrome tests (before Harry saw them)

| Date | Run | Found | Fixed in |
|---|---|---|---|
| 1 Nov | first run | 13 mismatches | `03729b5`, `7d62306` |
| 1 Nov | re-run | 14 mismatches, 10 earlier fixes confirmed | `cf035e8` |

## 3 Nov · the VO2 line
- The VO2 session goal was "8 to 12 min above 152". No ride on record held 152 for more than 18 s (best: Nov 1, max 155), so every VO2 session graded red. Harry set the line at VT2, 139. Tymewear's own VO2max training target is HR 147 and 216 W; the 40/20 "on" blocks at 191 W sit under that.

## 3 Nov · hydration
- The carry from yesterday pinned at the −1.5 L cap every morning (Nov 1, 2 and 3 all started −1,500), so no day could start clean and every evening read "1.8 L down". Now half of the night's deficit is carried, capped at 750 ml; the day's target includes the carry (one number, not "2.0 of 2.1 L" beside "−1,754"); the 70% post-ride retention applies only after a ride of an hour or more or a hard one.

## 3 Nov · fuel for the work required
- The food model moved from three day tiers (rest/normal/high by the ride's name) to a prescription per session (Impey 2018), the day's carbs the sum of the work; one train-low ride a week, never on or before a quality session. Spec: docs/fuel-for-the-work.md.

## 6 Nov · a Zone 1 floor
- Zone 1 had a ceiling only (116; up to 10% of a ride at 117 or above passed), so a ride spent coasting or stopped graded the same as one ridden at 110. Harry asked for a floor as well. It is 100 bpm (ride-math `HR.z1_floor`): a Zone 1 ride passes with up to a quarter of it under 100 (a third on a trail), is a warning past that and a different ride past 40% (50 on a trail). The ride analysis carries the share under the floor (`zone_pct.under`); rides analysed earlier have none and are judged on the ceiling alone. The player counts the minutes at 100 to 116 and shows both shares; the Edge field shows the band; the briefs say 100 to 116.

## 6 Nov · rest days
- "When I have all three classes, those should be my rest days." The three sections (World History I, E, F and G) come through Google Calendar; a day carrying all three is a rest day (bridge/classes.js, the pattern and the count in schedule-classes.json). A session cannot be placed on one (the add and move routes refuse it unless told to force), the lift placer skips it, the Calendar marks the day, and the briefs carry the rule. Thu Nov 12 had a trainer hour on it; it moved to Fri Nov 13.

## 6 Nov · three scoring fixes (the review)
- **Ride link:** today's planned minutes counted in the week's ratio at dawn, so it read 26% before the day could be ridden. A session on today counts once its start has passed (an untimed one from 9 p.m.).
- **Recovery:** three models could disagree on one morning (the tile on the watch's score, the chain on the week's HRV against a 60-day band, the Day's guide on seven days against 28). One model now (bridge/recovery.js): the week against the band feeds the chain's link, the tile's week word and the Day's advice; the watch's morning number stays as the day's line on the published bands (67 green, 34 amber), the same floor everywhere.
- **Fuel:** a ride's parts were a plain mean, so a missed beetroot cost as much as a ride with no carbs. Weighted now: the bottle 0.4, the food before 0.3, the meal after 0.2, the supplements 0.1 (chain-days rows re-read, ROW_V 8).

## 6 Nov · the class schedule and special days
- "My class schedule wasn't updated today." The site has no live calendar source: no Google account is connected (the school domain does not allow the app) and no feed is set, so the Day runs on the calendar snapshot taken Oct 29. Today's special schedule (the Spirit Parade: Period 4 at 12:45, not 2:05) was only an all-day note on the Upper School calendar, which the snapshot did not hold. Now: the Upper School calendar is in the snapshot through Dec 27 (refreshed from Google here; its class calendar is not readable from this account), and a "Special Schedule" note re-times that day's classes by period (bridge/classes.js, the regular period starts in schedule-classes.json); a period that does not meet drops its class. The durable fix is a live feed: the secret iCal addresses of the class calendar and the Upper School calendar pasted into Settings from the school account.
