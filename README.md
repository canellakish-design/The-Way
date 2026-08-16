# THE WAY — v1

One ledger, one doctrine, eight devices, one voice.
Spec: see the-way-master-spec.md (v1.1). Doctrine: fuel the work; take
the deficit at the margins; settle the day in the green band.

## The front page — the day
Every device opens on **the day**: a live clock, last night and this morning
at the top, then one timeline per day starting with today. Five lanes feed
each day, and the page says plainly which of them are actually connected:

| Lane | Source | Notes |
| --- | --- | --- |
| Coaching | Google Calendar — **16 ECNL** | every readable calendar syncs, not just primary; a coaching calendar makes everything on it coaching |
| Classes | `bridge/schedule-classes.json` | the fixed weekly timetable, expanded onto each date |
| Intervals + lifting | intervals.icu | planned sessions only; completed rides still come from Strava |
| Macros | Hexis | posted each morning by the Chrome run — see `deploy/hexis-morning-run.md` |
| Compliance | Hexis target vs Alma intake | scored per macro, with the snack that closes the gap — `deploy/alma-sync.md` |
| Open | the availability engine | what is left between the blocking ones |

Under the day sits the **food log**, additive: every entry carries a running
total down the list and, when Hexis has landed, what is left of the day's
calories, carbs, protein and fat. Above it, the compliance block puts Hexis's
recommendation next to Alma's tracking, scores each macro on its own, and
names the snack that would raise the score most without overshooting calories.

The page keeps itself current: the clock ticks every second, the now/next
markers repaint every 30s off cached data, and a real fetch runs every 5
minutes — skipped while the tab is hidden, and caught up the moment it comes
back. Crossing midnight reloads outright, so "today" is today and any new
deploy lands with it. A network blip leaves the last good day on screen and
says so rather than blanking the schedule.

The bedside clock did not go anywhere — it is a button on the day, it is the
Sleep tab, and it is still where the alarm lands.

## Repo map
- `bridge/`  — the brain (Node/Express): fuel ledger, prescriptions,
  Withings + WHOOP + Strava webhooks, route weather, podcasts, the Agent,
  and the day (`calendar.js`, `classes.js`, `intervals.js`, `macros.js`,
  `weighin.js`)
- `pwa/`     — the face: one app, role-aware (bedroom / kitchen /
  cockpit / phone), the day → Morning Mode → close-out, Energy Bank, alarm,
  gear check, push-to-talk Agent
- `garmin/`  — The Way — Ride: Connect IQ field, Edge 530 + 130 Plus
  targets, RICE accumulator, substrate model, fuel-state fetch
- `watch/`   — Apple Watch Ultra channel (Siri Shortcut, v1)
- `deploy/`  — Windows service + Cloudflare Tunnel + env checklist

## Build order (from the spec)
1. Garmin field through the CIQ simulator → sideload to the 530
2. Bridge on the Zwift PC + tunnel (deploy/install-windows.md)
3. Devices onboarded (Settings tab on each)
4. OAuth visits: Withings, WHOOP, Strava; ANTHROPIC_API_KEY for the Agent
5. Batch-cook the rice balls; weigh; update seed-recipes.json perUnit

## The Signature — FTP, threshold HR, zones
`bridge/zones.js` is the math (pure, tested: `node bridge/zones.test.js`);
`bridge/fitness.js` holds the state, the ingestion and the audit log. Three
signals, reconciled rather than trusted individually:

| Signal | Where from | Weight |
| --- | --- | --- |
| Dedicated test | Tymewear ramp, typed in — FTP = VT2 × 0.925 | authoritative for 60 days |
| eFTP | best 20–60 min effort in the last 90 days, from Strava power streams | primary when no fresh test |
| Ventilatory | VE-vs-power breakpoints from breathing data | cross-check |

- The 20-minute best gets ×0.95, a genuine 45–60 minute effort none, and
  durations between the two interpolate. Ragged efforts (NP/avg > 1.2) don't
  count — that's an interval session, not a threshold.
- Old efforts decay ~1%/week rather than standing forever, so FTP tracks
  current fitness instead of a lifetime peak.
- If eFTP and the ventilatory curve agree with each other but drift >5% from
  the last test, the app says "consider retesting" — it never silently
  overwrites a measured test.
- Threshold HR is VT2 HR, undiscounted. On a power-only signal there is no
  VT2 HR, so the HR held during the best effort stands in **and is labelled
  as a stand-in**. HR zones anchor to threshold, never to a max-HR guess.
- Every change is logged with what caused it: `GET /fitness/log`, or the
  "Why FTP changed" card in Analyze.

The ventilatory fit refuses more often than it guesses: too few segments, no
steady work above 85% of FTP, only one inflection, or two split-half fits that
disagree by more than 25W all return a reason instead of a number. Tested
across noise levels, it is either right within 30W or it declines.

## Feeding the day
1. **Google Calendar** — visit `/gcal/auth` once. Every calendar the account
   can read is synced (holidays/birthdays skipped). `GET /gcal/calendars`
   lists them; `POST /gcal/calendars {"calendars":[ids]}` pins an explicit set.
2. **Classes** — edit `bridge/schedule-classes.json`: one array per weekday,
   `{ "from": "08:00", "to": "08:45", "name": "…", "room": "…" }`. Class time
   blocks training windows exactly like a calendar event does.
3. **intervals.icu** — set `INTERVALS_ICU_API_KEY` and
   `INTERVALS_ICU_ATHLETE_ID`. Rides and lifting are separated by workout
   type; a session with no time on it shows as planned-today rather than 12am.
4. **Hexis macros** — `deploy/hexis-morning-run.md`.
5. **Weigh-in** — the Withings scale pushes automatically once `/withings/auth`
   is visited (it runs hosted now, not just on the PC), and writes into the
   same store as a hand-typed `POST /weigh-in {"lb":208.6}`. Starting weight is
   210 lb — `START_WEIGHT_LB`, or `POST /weigh-in/start`.
6. **Alma intake** — `deploy/alma-sync.md`.

## Honest v1 seams (by design, all flagged in code)
- Tymewear has no API — ramp tests are typed into Analyze (spec §7).
- Breathing streams have no automatic feed yet: `POST /fitness/breathing`
  takes segments or raw streams, but nothing parses FIT files into it. Until
  something does, the ventilatory signal stays empty and says so.
- The §2c confound filter needs a trailing HRV/RHR baseline, and WHOOP only
  stores its latest reading — so the baseline accumulates from the day this
  shipped, and the filter is inert until there are enough days.
- Withings is storage-backed and mounted in production now, but until
  `/withings/auth` is visited the weigh-in is whatever gets typed into the top
  strip. Both paths write to the same store.
- WHOOP rotates its refresh token on every use, so concurrent refreshes fail.
  Syncs are single-flighted and cached for 10 minutes; passive readers (the
  day, availability, the training log) read stored data and never trigger a
  pull. Only the Sleep card, the webhook and `/whoop/sync` go to WHOOP.
- intervals.icu field names follow the current API — verify on the first live
  run; the front page names the lane as unconfigured or errored rather than
  rendering an empty day as if it were a rest day.
- Hexis is scraped by a daily Chrome run, not an API. No run, no macros — and
  the day says so instead of showing yesterday's targets.
- Strava Signature analysis is stubbed: rides are ingested, eFTP/EF/LTHR
  math is the next milestone; W/kg uses set FTP until then.
- Photo→macros endpoint not yet wired in the PWA (manual + favorites
  work); vision call is a small bridge addition.
- WHOOP/Withings endpoint names follow current docs — verify on first run.
- Everything degrades visibly: bridge down → PWA queues meals locally,
  Edge falls back to `≈ SETTINGS`, weigh-in falls back to manual.
