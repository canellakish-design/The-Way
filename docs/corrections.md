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

**1 Nov: 20 corrections.** 10 new case, 6 disagreement, 2 my mistake, 2 advisor.

## Found by the Chrome tests (before Harry saw them)

| Date | Run | Found | Fixed in |
|---|---|---|---|
| 1 Nov | first run | 13 mismatches | `03729b5`, `7d62306` |
| 1 Nov | re-run | 14 mismatches, 10 earlier fixes confirmed | `cf035e8` |
