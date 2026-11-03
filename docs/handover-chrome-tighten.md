# Handover: Claude in Chrome · one hour to make The Way tighter

## Where to work: the copy only
- Use only **https://copy--thewayforward.netlify.app**.
- Every page there shows an amber banner: "The copy · test freely · nothing here reaches the real site, intervals.icu or your calendar". If the banner is missing, stop and work nowhere else.
- Never open **thewayforward.netlify.app** (no "copy--" in front). That is Harry's real site.

The copy opens on a snapshot of Harry's real data. Everything you add, move, log or delete there stays in the copy. Writes to intervals.icu and Google Calendar are held back on the server.

Set the window to **390 px wide** (iPhone) for the whole hour, because that is how Harry uses it.

## What "tighter" means here
Harry corrects the site several times a day. The goal is fewer corrections. Look for:

1. **Two numbers for one thing.** The same quantity shows different values on two pages: calories, protein, a ride's minutes, a grade, the hydration balance, the chain's percent against its page.
2. **Stale after a change.** You change something, and a page still shows the old value until a reload.
3. **Wrong kind of session.** A lift or a run treated as a ride, or a ride as a lift: meal timing, fuel slots, the Ride tab, the chain.
4. **Doubles.** The same meal, drink, lift or workout counted twice.
5. **Words that waste the screen.** A sentence where a number would do, explanations above the fold, labels cut off with "…", text overlapping a line or a tick.
6. **Dead ends and extra taps.** A box that does not open the page it names, a log action that takes three taps where one would do, a form that loses what was typed.
7. **Layout faults at 390 px.** Sideways scroll, clipped text, two lines where one fits, buttons that wrap into odd stacks, anything hidden behind the floating microphone.
8. **The advisor out of step.** What the advisor says compared with what the page shows: the sessions, what is eaten, what is due.

## Standing rules (never break, even in the copy)
- **Planning numbers:** FTP 175, threshold HR 139, max HR 162. Never type 196 anywhere. Do not change the planning numbers.
- **Times:** 12-hour in everything you type ("4:30p").
- **Early starts:** no workouts before 7 a.m. The site should refuse them; note how it does.
- **Breakfast:** as late as possible.
- **Sweeteners:** none recommended, ever (sucralose, aspartame, acesulfame, saccharin). Flag any page or advisor answer that suggests one.
- **Passwords and keys:** do not log in anywhere, and do not type passwords or keys. Settings → connections can be looked at, not changed.

## The hour

### 0:00 to 0:05 · Baseline
- Load the Day page. Screenshot the top (fitness strip, ten chain boxes with arrows, verdict) and the schedule.
- Open each box once and note where it goes. The expected targets:

| Box | Page |
|---|---|
| Plan | Calendar |
| Sleep | Sleep |
| Water | Hydration |
| Macros | Food |
| Micros | Micros |
| Lift | Lift |
| Fuel | Fuel |
| Ride | Ride |
| Recovery | Recovery |
| Weight | Weight |

- Note the browser console errors and the page's scrollWidth on every page you open. The scrollWidth must be 390.

### 0:05 to 0:20 · Food and drink
1. **Write a meal.** Food → Write → "two eggs, toast, a banana" → Log it. Check the macro bars, the Day row, the Food row and the Macros box. Do they agree?
2. **Photo plus words.** Snap or Camera roll (any food photo from the web saved to disk will do) and write "chicken 180 g, rice 1 cup" in the box under it. It should log as one entry showing the photo and the words.
3. **Correct it.** Open the entry → Save correction → kcal 900. Grade, bars and Day row should all follow.
4. **A drink.** Hydration → tap Glass 250. It must appear on Hydration, not in the Food list, and the glass should rise.
5. **A beer.** Write "two beers" on Hydration. Look at the balance, the Food bars, and the evening note.
6. **A double.** Log the same Write text twice within a minute. What happens?
7. **Remove.** Remove what you added (trash icons). Every page should return to the baseline.

### 0:20 to 0:35 · Training
1. **Add a ride.** Calendar → plan a workout → "Zone 1, 60 min", Ride, today, 3 hours from now. Then check:
   - Day row
   - Ride tab ("every ride of the day")
   - Food meal times (lunch before, dinner after)
   - Fuel on-the-bike slot
   - the chain's Plan box
2. **Move it** an hour later, then **lengthen it** to 90 min. Do the meal times, the name ("Zone 1, 90 min") and the food target follow?
3. **Too early.** Try moving it to 6:30a. It should be refused, in plain words.
4. **A lift.** Lift → put today's session on the calendar at 5:30p. The food plan must **not** get a "before" meal or an on-the-bike slot for it.
   - Then save the session on the Lift page with the ticks. The Day row should read LOGGED, and the Lift box should count it.
5. **A run.** Use the advisor (Type) to say: "I ran 30 minutes on the treadmill at noon". It should land on the calendar as a run, add about 330 kcal, and not count as ride minutes.
6. **The advisor.** Ask: "what's left to eat today?" and "is my lift done?". Compare its answers with the pages.
7. **Remove** everything you added.

### 0:35 to 0:50 · Every page, read for waste
Visit each page and list what could go, merge, shrink or move:
- Day
- Ride
- Calendar
- Workout editor
- Food
- Hydration
- Fuel
- Live
- Sleep
- Recovery
- Weight
- Micros
- Lift
- Zones
- Settings

For each page, write one line on its first screen: does the most important number sit at the top, and is anything above it that should not be?

### 0:50 to 1:00 · Write the report

## Report
Put it in one Markdown file with these four parts:
1. **Findings table.** Columns: # · page · what you did · what you saw · what you expected · kind (1–8 above) · screenshot.
   - Rank by how often Harry would hit it. A daily annoyance comes first.
2. **Top ten ways to tighten.** One line each, concrete, e.g. "Hydration: drop the 'Anything with calories…' sentence; the Write tile already says it".
3. **Numbers that disagreed.** Each pair of values and the two pages they were on.
4. **Console errors and layout faults.** Page, error text, and scrollWidth if over 390.

Leave the copy as you found it: remove what you added.
