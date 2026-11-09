# Handover: Claude Code · a fresh start for The Way's scores, from Monday 9 Nov 2026

Repo `canellakish-design/The-Way`. Netlify builds `main`. Branch first, keep `npm test` green, and ask Harry before pushing to `main`.

## What Harry asked for (8 Nov)
"Reset the starting point of The Way to tomorrow." Asked which parts, he chose **scores and streaks only**:
- Everything that grades him starts counting on **Monday 9 Nov 2026**.
- His rides, meals, lifts, weigh-ins and journal stay stored and visible. They're just not scored against him.
- Nothing is deleted.

## The setting
- One stored value, `fresh-start` → `{ date: 'YYYY-MM-DD', at, note }`. Set it to `2026-11-09`.
- Add a small `freshStart()` reader. With no value set, it returns null, which means no cut-off and behaves exactly as today.
- Put a line on Setup: "Scores count from Mon 9 Nov", with a date picker and **Clear**, so Harry can move it again himself.
- `POST /fresh-start { date }` and `GET /fresh-start`, behind the usual `auth`.

## Where it applies (graded things only)
1. **`bridge/chain.js`**, the front page's seven-day links (sleep, water, food, micros, lift, fuel, work, recovery):
   - Days before the fresh start drop out of each link's seven-day value.
   - On Monday each link reads one day; by Sunday 15 Nov it reads seven.
   - A link with no days since the start shows its "none" state, never "bad".
   - The plan link (the coming week) is unaffected.
2. **Lift week count** (`bridge/lifts.js`, `weekCountPlaced` and the "sessions due since it started" rule):
   - The first week is counted from the fresh start: "1 of 1 due" on 9 Nov.
   - The 12 Nov Day page and the Lift page agree.
3. **Ride and food compliance roll-ups and any "in a row" / days-on counts:**
   - Only days on or after the fresh start count: `days_logged`, `days_on`, any week average, `workout-debt`, and the `audit` and `progress` pages where they grade.
   - Each day's own grade on its own page is unchanged. It simply isn't rolled up.
4. **The coach** (`bridge/coach.js` context): when it quotes a week's adherence, it uses the same cut-off and says "since Mon 9 Nov".

## Not reset (physiology, not behaviour)
- Fitness and fatigue (CTL/ATL in `scores.js`), HRV and resting-HR baselines, the weight trend, power curves and zones.
- These measure the body, and cutting their history would make the numbers wrong. That's Claude's call as Harry's coach; tell him in one line if he asks why.

## Tests
- `chain.test.js`:
  - With the fresh start on the 9th and "today" the 11th, food/water/work weeks average three days.
  - Days before the 9th are ignored even when they hold data.
  - With no setting, the result is identical to before.
- `lifts.test.js`: with the start on the 9th, the 9th reads "1 of 1 due".
- The reader: null when unset; a bad date is rejected with 400.

## Done when
- On Monday morning the front page shows fresh links: one day each, no red carried over from before.
- Setup shows the date and can move or clear it.
- `npm test` is green, and Harry has approved the push to `main`.
