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
| 5 Nov | The Day still showed yesterday's recovery of 95 on a 44 morning | The WHOOP token has been dead since 29 Oct and the Garmin had no row for the day by 8 a.m.; the morning check said so but nothing filled the gap | his WHOOP numbers entered by hand; reconnecting WHOOP is his | new case |
| 6 Nov | Hibiscus tea logged at 3:56 a.m. counted on today | A drink logged after midnight is filed on the calendar day; the journal had no way to move an entry to another day | `78831a0` (move to another day), entry moved | new case |
| 6 Nov | Magnesium logged at 3:54 a.m. counted on today | Same cause | entry moved | new case |
| 6 Nov | The site took too long to load | A dozen bridge calls behind the Day, each re-reading the same blobs one after another, and nothing on screen until all landed | `6e717a8`, `a1674c4` | new case |
| 6 Nov | The class schedule was not updated for the special schedule | No live calendar source; the snapshot lacked the Upper School calendar and nothing read a special schedule | `0a956ac` | new case |
| 6 Nov | Sleep 4.7 h on the site; WHOOP said 5 h 28 | Two devices, two nights: the Garmin's row won with the WHOOP dead | WHOOP's figure entered by hand | disagreement |
| 6 Nov | "Your rides say you are nearer 205" (FTP), asked how | Claude stated a reconciliation of the ramp test and Tymewear as if the rides showed it; the power curve says 152 on old efforts | answer corrected; FTP stays 175 | my mistake |
| 8 Nov | "Ride it" still on Saturday's McKeldin ride after he rode it | The button hid only on a green grade | `f10dafd`: hides once a ride answers the session | disagreement |
| 8 Nov | Saturday's easy trail ride graded "partly 74%" | A session with heart-rate targets but no "Zone 1" in its name is graded on load (29 of 39 TSS), not as an easy ride | open: his call on grading easy rides and the trail floor | disagreement |
| 9 Nov | Beetroot due at 4:30 a.m. before a 7:00 ride (Mon 9, Tue 10) | Beetroot was placed 2.5 h before the ride whatever the hour | nothing before 5:30; a ride before 8:30 takes it on waking (supps.js, the Nov 9 commit) | new case |
| 9 Nov | The day's burn worked from age 55; he is 48 | The food model's profile carried the 2033 goal age as his age | age and height are settings (Setup, body.js), 48 now: BMR +35, base burn +47 a day | my mistake |
| 9 Nov | "I don't do whey. Huel plant protein shakes." | Whey was written into the plan's words, the snack list, the protein nudge and the advisor's rules | every whey becomes a Huel plant protein shake (105 kcal, 20 g protein a scoop); "whey" in a log still matches the shake | new case |
| 9 Nov | The coach's sushi dinner (175 g carbs) graded "carbs 312% over" against a 43 g low carb plan | The plan never loaded carbs the night before a 7:00 a.m. VO2, and the coach sized dinner to the whole day's totals instead of the plan's meal | dinner before a hard ride before 10 a.m. is High carb (~1.2 g/kg); the coach follows the plan's meal and says so when it disagrees | disagreement |
| 9 Nov | "Protein at every main meal: missed 1 of 1 day" | The soy sauce logged beside the sushi counted as a meal of its own | add-ons fold into their meal for every rule; a meal is judged as a whole | disagreement |
| 9 Nov | "Z1 +-40%" on a ride under the Zone 1 floor, and two debriefs for one ride | A below-floor share printed after "+"; a 0-minute false start got its own debrief | "Z1 low 40%" / "Below Z1"; no debrief under 5 minutes or for a second save | my mistake |

| 10 Nov | Push placed again on Tuesday, the day after Monday's Push | The placer looked seven days forward and never back | a session done in the last six days is not placed again | disagreement |
| 10 Nov | The Day painted yesterday's plan as today's | The kept copy of the day was drawn before the fresh one landed, whatever its date | a kept day is only drawn when it is today's | my mistake |
| 10 Nov | FX Physical Therapy on his day | A shared calendar's event that is not his to attend | left off the day, its free windows and the plan | new case |
| 10 Nov | A recovery dinner read "Low carb" | The label's cut-offs | cut-offs at 20% and 45% | disagreement |
| 10 Nov | A moved snack lost its "Before Practice" note | The protein words were rewritten over the whole note | the note is kept | my mistake |
| 11 Nov | The same weigh-in counted twice | The iPhone Shortcut sends Health's reading again each morning | the same reading replaces the one kept | new case |
| 11 Nov | A weigh-in sent as "217.9 lb" was not read | The Shortcut sends the sample as text with its unit | read with its unit, kg too | new case |
| 12 Nov | A drive chained to a venue that had not been looked up | The new drives joined consecutive events before the place was known | no chaining to a place not looked up yet | my mistake |
| 13 Nov | Tomorrow's page showed no meals | The Day drew meals for today only | every day shows its meals; scripts/smoke.js checks it before every push | my mistake |
| 13 Nov | Wednesday's staff meeting and practice at Liberty read as two places | One place written two ways on the calendar | one place however the calendar writes it | disagreement |
| 13 Nov | The deficit rule used the watch's 3.6 h, not the WHOOP's 6.4 h he entered | Hand-entered sleep did not win for its date | the hand-entered night wins | disagreement |
| 13 Nov | Lunch "packed" on a school day | The plan did not know the dining hall | school days: lunch between classes is the dining hall | new case |
| 14 Nov | "Whenever any event is on top of another event you have to move stuff around" | Overlaps were marked and left for him to fix | a workout over something fixed is moved by The Way (dayplan.js autoMove) | disagreement |
| 14 Nov | His IDP meetings (with a Meet link) were moved by The Way | The new auto-move treated any block of his as movable | a meeting, a call or anything with guests is never moved | my mistake |
| 14 Nov | The U18 game he added was moved to 8:45p, twice | It was read as his own free block; the first fix did not cover an event with a place | games and events with a place are fixed | my mistake |
| 14 Nov | "U13 to U18 Girls Staff Meeting" read as a game | The rule written to catch the game was too wide | rule narrowed | my mistake |
| 14 Nov | A moved ride left its pre-ride snack after the ride | The meal before a session did not move with it | the meal before a session stays before it | disagreement |
| 14 Nov | A shake placed inside a drive | The added shake skipped the free-time rule every meal follows | it goes in free time like every meal | disagreement |
| 14 Nov | An event marked Free in Google sat on his day | Free and busy were read alike | an event marked Free is information | new case |
| 14 Nov | Hold to talk cut the sentence off at a pause | The phone ends its listening on a pause | what was heard is kept and it listens on | new case |
| 14 Nov | The coach's voice was silent on the iPhone | Web Audio is muted by the silent switch | the voice plays as media | new case |
| 14 Nov | The coach could not say what he ate on Monday | The coach saw today only | history.js: 120 days on record and a look_back tool | new case |
| 14 Nov | The coach said the app only reads heart rate from mountain bike rides | The model misread the grading rule for rides with no power meter | explained; the coach's rules say what is read from which ride | advisor |
| 14 Nov | "The open back and forth conversation isn't working" | Each turn had to be started by hand, and the page listened to its own voice | one conversation: its own listening, the mic shut while the coach speaks, a pause sends | new case |
| 14 Nov | Two games back to back: lunch was planned for 5:51p | A main meal displaced past six hours with a gap between the games | packed, eaten at the field between them | new case |
| 15 Nov | Heart rate sat too low in the player on a Zone 1 ride | ERG held watts; nothing steered by heart rate | the player holds heart rate near 110 | new case |
| 15 Nov | Pressed Start by accident, in bed, with no way back | Start had no undo | two taps when far from the planned time, and an undo | new case |
| 15 Nov | A weather grade on a kettlebell workout | Anything on the plan that was not a lift by name was treated as a ride outside | kettlebell, lifts and indoor sessions carry no weather | my mistake |
| 15 Nov | "Clashes with … pick one" on two games at the same field | The second game's arrive-by time overlapped the first | two events at one venue use their real start | disagreement |
| 15 Nov | A stale "Recommended ride · yes" banner | A yes stayed open after its ride was gone | a yes is spent when its ride no longer exists | disagreement |
| 15 Nov | The Next line said "by 6:30a" at 7:23a | It named a time already past | it says "eat … now" | disagreement |
| 15 Nov | A race he did not want on his race calendar | Claude added Capital Cross Classic from a list it had offered | removed; nothing is added unless he adds it | my mistake |
| 15 Nov | Upper 1 Friday, Pull Saturday, Upper 2 Sunday: the same workout three days running | Missed sessions were packed into the first open days with no rule between the two upper days | spacing rules; then the week made Monday to Sunday so nothing stacks | disagreement |
| 15 Nov | Legs on the calendar twice in a week and no Upper 2 | A swap by hand was never checked against the week | the week is checked as it stands (checkWeek) and listed on the Lift page | disagreement |
| 15 Nov | Macros 57: a breakfast eaten before the plan's clock scored 0 as "over" | During the day the figure due so far was both floor and ceiling | the ceiling is the whole day's figure | disagreement |
| 15 Nov | Protein over its target lowered the score (258 g scored 34) | Over and under were scored alike on every macro | protein over costs nothing | disagreement |
| 15 Nov | "The listen button is kind of glitchy. It sometimes freezes the page on the coach's page" | The 3D figure was built half a second after the page opened, holding the page still for a second or more: a tap in that window sat there until it was over. And the phone's recogniser was trusted to answer: one that never started or never ended left the button dead, one that closed at once was reopened every 60 to 250 ms | the figure waits for 2.5 s with no touch and a closed microphone; watches on start and stop, a longer wait after each instant close, then a plain message; a quarter second between his voice stopping and the microphone opening | my mistake |
| 15 Nov | "I think I only have one 45-pound kettlebell at home" | The Blasts, the Pump and the home notes were written for bells of several sizes, two at a time | every Blast exercise uses the one 45 lb bell and progresses in reps; one-bell carries; the Pump's bell lifts moved to the Bowflex | new case |

| 15 Nov | "Why is my ride logged for this morning. Just finished it" | The Day pairs each ride that happened with its planned card and moves the card to the real time. A lift saved on the Lift page is a done session too, and was taken for a ride: Legs at 7:30a pulled the Zone 1 card to 7:30a, and the ride's real time, 5:51p, then landed on the Kettlebell Blast planned beside it | only rides are rides that happened; a done ride takes the card with its name, else the nearest planned ride, never a lift, a Blast or the Pump | my mistake |
**1 Nov: 21 corrections.** 11 new case, 6 disagreement, 2 my mistake, 2 advisor.
**2 Nov: 8.** 1 new case, 3 disagreement, 3 my mistake, 1 advisor.
**3 Nov: 2.** 1 disagreement, 1 advisor.
**4 Nov:** not logged at the time (the corrections of 3 to 5 Nov are partly in the notes below, not counted).
**5 Nov: 1.** 1 new case.
**6 Nov: 6.** 4 new case, 1 disagreement, 1 my mistake.
**7 Nov: 0** logged.
**8 Nov: 2.** 2 disagreement.
**9 Nov: 6.** 2 new case, 2 disagreement, 2 my mistake.

**10 Nov: 5.** 1 new case, 2 disagreement, 2 my mistake.
**11 Nov: 2.** 2 new case.
**12 Nov: 1.** 1 my mistake.
**13 Nov: 4.** 1 new case, 2 disagreement, 1 my mistake.
**14 Nov: 13.** 6 new case, 3 disagreement, 3 my mistake, 1 advisor.
**15 Nov: 14.** 3 new case, 7 disagreement, 4 my mistake.

*10 to 15 Nov were not logged at the time. The rows above were written on 15 Nov from the commits and the conversation, so their count is a floor, and the kind is Claude's reading after the fact.*

## Review, 15 Nov

| | Total | New case | Disagreement | My mistake | Advisor |
|---|---|---|---|---|---|
| Week 1 (1 to 7 Nov) | 38 | 17 | 11 | 6 | 4 |
| Week 2 (8 to 14 Nov) | 33 | | | | |
| 15 Nov alone | 14 | | | | |

- **The count has not fallen from daily to weekly.** It fell in the middle of week 2 (one to five a day) and rose again on 14 and 15 Nov (13 and 14), when the scheduler (auto-move, drives, clashes) and the lifting week were being changed.
- **The kind shifted** from new real-world cases to two parts disagreeing and to Claude's own mistakes in new code. Since 10 Nov: 13 new case, 14 disagreement, 11 my mistake, 1 advisor.
- **The plan was not kept.** The log stopped on 9 Nov; the feature freeze ended in practice that day (about 110 commits by 15 Nov, most of them features Harry asked for); the weekly Chrome run has not run since 1 Nov.
- **Changed plan, put to Harry on 15 Nov:** the log is written as part of every fix; lifting reads from one Monday-to-Sunday week; the push check covers lifting; next review 29 Nov. A one-week freeze on the scheduler and lifting (fixes only) is proposed and is his call.

## Found before Harry saw them (the Chrome tests, audits, the push check)

| Date | Run | Found | Fixed in |
|---|---|---|---|
| 1 Nov | first run | 13 mismatches | `03729b5`, `7d62306` |
| 1 Nov | re-run | 14 mismatches, 10 earlier fixes confirmed | `cf035e8` |
| 15 Nov | the lifting audit (a read of the code and the live week) | Pull put 15 minutes after the VO2 by the auto-mover; Legs could land on a hard-ride day (its penalty lost to the new bonus); the count could read "6 of 5"; a planned Upper 2 marked done by a saved Legs; "move my lift" took the ride; Upper 2 at Life Time on a day in New Jersey | `795c1eb`, `b9a4fcf`, and the Monday-to-Sunday commit |
| 15 Nov | the live check after a push | Ride with GPS read as not connected on the live site (the new code looked for the sign-in in the wrong place) | `c4595ad` |
| 15 Nov | the push check | The Day page took ten seconds to draw today's meals on a first visit (22 days of schedule asked for before anything was drawn) | today and its neighbours are drawn first |

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

## 7 Nov · the magic buckets (handover: Garmin field, site, workout player)
- One rule set (pwa/buckets.js, wrapped by bridge/buckets.js): LOW / HIGH / PEAK by power against VT1 169 W and VT2 208 W (Tymewear, 14 Aug 2026), by heart rate against 117 and 139 only when there is no power; 0 W coasting is LOW. A plan's step goes by its target watts (mid % of the planning FTP, 175), a heart-rate band by its middle, a free step nowhere. Colours #0099FF, #FFAA00, #E00000, meaning bucket and nothing else.
- The lines live in a dated thresholds store (bridge/thresholds.js, the Zones page's Bucket lines card). The Garmin field reads lines, colours and plan from /garmin/session/today at each ride start.
- The field's steps no longer carry the Zone 1 band (100 to 116) on a free step: the new layout dropped the target line it fed, and the bucket rule plans a free step as nothing. A Zone 1 ride therefore shows no plan, its bars sharing the ride time.
- The player's ride view mirrors the Edge (buckets on top, time, heart rate and power below, numbers in ink) and the player lost its other colours (status green, the red heart-rate trace, the blue breathing line, the coloured zone ladder): ink and grey now.
- A Strava ride's bucket seconds leave out stopped time (a gap over five seconds), and use power only from a meter.
