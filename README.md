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
| Open | the availability engine | what is left between the blocking ones |

Under the day sits the **food log**, additive: every entry carries a running
total down the list and, when Hexis has landed, what is left of the day's
calories, carbs, protein and fat.

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
5. **Weigh-in** — `POST /weigh-in {"lb":176.4}`, or type it into the top strip.

## Honest v1 seams (by design, all flagged in code)
- Withings is **not connected**: the morning weigh-in is entered by hand on
  the front page and stored via `/weigh-in`. When the scale is wired up it can
  write to the same store and nothing downstream changes.
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
