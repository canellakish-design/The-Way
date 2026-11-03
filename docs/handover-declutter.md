# Handover: Claude in Chrome · take the words off The Way

Harry knows what every number on the site means now. The sentences under them, the labels beside them and the hints around them no longer help: they get in the way. The job is to take them off, page by page, until each screen is the numbers, their one-word names, and nothing else.

## Where to work
- Look at **https://deploy-preview-2--thewayforward.netlify.app** (the copy, amber banner on every page). Never log anything on **thewayforward.netlify.app**.
- Change the code in the repo **canellakish-design/The-Way**, on branch `main`, directory `pwa/`. A push to `main` goes live; then merge `main` into `copy` so the copy matches.
- Check every page at **390 px wide** (iPhone) and the player at **1280 px** (the PC).
- Screenshot harness: `node /home/user/shots/localshot.js <pwaDir> <hash> <out.png> [full]` draws a local `pwa/` against the live data, read-only (every non-GET is aborted). Use it, not the live site, to check a change before pushing.

## The rule
A screen is a number, its name, and its colour. Everything else has to earn its place.

**Take off**
- Any sentence under a number that explains what the number is ("the hardest interval", "TSS planned", "of plan", "so far today").
- Any line that explains how the page works ("Takes a minute or two…", "Close Zwift first…", "Tap the keyboard's microphone…", "Start counts in 3 seconds").
- Chips and badges that restate the title ("reads the whole site · current research").
- Example prompts and suggested questions.
- Keys and legends where the colours already say it (zone colours, the chain's green/amber/red).
- Repeated units ("W", "bpm", "kcal", "g") where the name of the field already says it. One unit per field at most, and small.
- Second lines on list rows that repeat the first line in other words.
- "why" folds and footnotes that nobody opens. If a fold holds something Harry corrects from, keep the fold; take off the sentence that introduces it.
- Empty-state prose ("Nothing asked yet.", "loading the conversation…"): a blank is fine, or one word.

**Keep**
- Every number, every grade, every colour.
- The one-word label over a number (POWER, HEART RATE, SLEEP).
- A unit when it stops a misreading (minutes vs hours, g vs %), as the small suffix, once.
- The time of a thing, in 12-hour form ("4:30p"), and dates as "Mon, Nov 3".
- A warning that stops a mistake: the "no workouts before 7 a.m." refusal, "End always saves the ride", the sandbox banner on the copy. One line, no more.
- Anything Harry acts on: a button, a link, a fuel cue with its grams and time.

**When in doubt:** take it off, screenshot, and ask "can I still read the number and act on it?" If yes, it stays off.

## Standing rules (never break, even in the copy)
- Planning numbers: **FTP 175, LTHR 139, max HR 162.** Never type 196. Zone 1 is heart rate 116 and under.
- 12-hour times only. Dates as "Mon, Nov 3".
- No workouts before 7 a.m.
- Delete nothing of Harry's: no journal entries, no workouts, no rides. Removals are his.
- No passwords, no keys, no logins.
- Every push to `main` must pass `npm test`, show a 390 px scrollWidth of 390 on every page touched, and have no console errors.
- Commit messages say what changed and why, in plain words. No model names in commits.

## The tour, in order
Do the pages in this order; each one, the same way: screenshot, list every piece of text that is not a number or its one-word name, cut, screenshot again, push.

| Page | Hash | Known clutter to start from |
|---|---|---|
| Day | `#today` | The verdict sentence under the chain; the second line on schedule rows; "Ride it" sits fine. The fitness strip's sub-labels. |
| Coach | `#coach` | Now just the box and Ask. In the answers: the steps list while it works can stay (it shows progress); the "sources · n" fold stays; the "You · date" label can lose "You". |
| Food | `#food` | The line under each macro bar; the card line "fuel slot…"; meal cards' second lines; the pre-ride option's explanation; the "why" folds; the Write box's placeholder. |
| Fuel | `#fuel` | "Fuelled this week" / "Today" headline wording; the parts under each ride row (pre / bottle / supp) should be three numbers, not three phrases; the Live energy chart's caption; the magnesium rule's sentence. |
| Hydration | `#water` | The balance's explanation; the evening note; glass buttons' sublabels. |
| Micros | `#micros` | Any sentence under a bar. |
| Lift | `#lift` | Session cards' second lines; "counts as done" wording. |
| Ride | `#ride` | Zone table captions; the FTP/LTHR fields' help text (the fields stay: they are Harry's to set); the power-curve explanation. |
| Calendar | `#calendar` | Session cards' subtext; the grade's "basis" sentence (keep it in a fold, not on the card). |
| Sleep, Recovery, Weight | `#sleep` `#recovery` `#weight` | Captions under charts; "interim" explanations; the 14-night note (one word "interim" at most). |
| Player | `#player` | Start screen: "the hardest interval", "TSS planned", "Connect, then start", the "Close Zwift…" hint (keep "End always saves the ride" as the only line); the fuel rows' "Before · time" labels can shrink to the time. Ride screen: the key under the chart (target / your power / now) goes; the "of 3:00" and "19:32 ridden" sub-lines stay as numbers only; "bias 0%" shows only when bias is not 0; "Zone 1 · ≤ 116" becomes "Z1". Goal circle: "GOAL" label goes, the words under it stay to one line. |

Also open the voice advisor's answer and the food logger's confirmation line once each: trim their wording the same way (the text lives in `bridge/voice.js` and `bridge/food.js`; keep what they *do*, shorten what they *say*).

## How to work each page
1. `node /home/user/shots/localshot.js /home/user/the-way/pwa <hash> before.png full`
2. Read the screenshot. Write down every line of text that is not a number or its one-word name, with the file and line it comes from (`grep -n` the words in `pwa/*.js` and `pwa/*.css`).
3. Cut. Prefer deleting the element to hiding it. If a number loses its only label, give it a one-word `k` label.
4. `npm test`, then the screenshot again. scrollWidth 390, no errors, nothing clipped, nothing behind the floating microphone.
5. Bump the version on the file's `<script>` or `<link>` tag in `pwa/index.html` and `SHELL` in `pwa/service-worker.js`.
6. Commit (plain words), push `main`, merge into `copy`, push `copy`.
7. Move to the next page. Do not come back to polish; a second pass at the end is cheaper than ten.

## Report, at the end
A short file `docs/declutter-report-<date>.md`:
- Per page: what came off (one line each), with before/after screenshots at 390 px attached or linked.
- Anything you left on and why (one line each).
- Anything that looked like a bug rather than clutter (a wrong number, a stale value, a clipped label): note it, do not fix it here.
- The commits, oldest first.

Send the report, then stop. Harry reads it and decides the second pass.
