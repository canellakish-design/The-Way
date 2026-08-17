# The Way — changelog

# The scale connected to the wrong account

## Fixed
- **`/withings/disconnect` could not clean up after a demo account.** The demo
  label is only set when the connect went through `/withings/auth?demo=1` — it
  rides along in the OAuth state. Sign into a demo or test account through the
  ordinary flow and the readings arrive labelled as real, are mirrored into the
  shared weigh-in store as real, and nothing downstream can tell: a scale that
  reported 143 lb and 249 lb on consecutive days is stored exactly like a
  person. Disconnect only ever removed entries flagged demo, so those readings
  survived the disconnect and stayed in the trend after reconnecting.
  `?purge=1` now removes everything the scale mirrored, flagged or not
- Not the default, deliberately: disconnecting a real scale must not delete a
  true history, and it would be gone for good — the same call clears the
  scale's own store, which is the other place those readings live
- Disconnect now reports `readings_removed` and `purged`, so it is possible to
  tell what it actually did

## Notes
- The app still cannot detect a demo account connected through the ordinary
  flow. The only signal is the OAuth state round-trip. A plausibility check on
  the readings themselves — no one loses 79 lb overnight — would catch it, and
  is not written

# The scale moves up

## Changed
- The scale card sits directly below recovery, above the day. It was below the
  schedule and the food log, on the reasoning that a weight next to a recovery
  score competes for the same glance; Harry wants the two morning numbers read
  together. Markup order only — the logic that hides today-only cards when the
  day stepper is on another date works off IDs

# Tests for WHOOP, the weigh-in, the calendar and Hexis

## Added
- `bridge/whoop.test.js`, `bridge/weighin.test.js`, `bridge/calendar.test.js`,
  `bridge/macros.test.js` — 372 assertions across the six suites, `npm test`
  runs the lot and exits non-zero on the first failure. Same shape as the zones
  and ics tests already here: plain node, no framework
- The Hexis path: what the morning run's POST will accept (the `carbs`/
  `protein`/`fat` aliases the doc promises, `day_type` for `fuel_day`, a scrape's
  strings coerced, junk stored as null rather than NaN, a date the wrong way
  round falling back to today), the periodized week posting in one call, a
  second run correcting the day rather than doubling it, the 60-day prune, and
  `have:false` rather than yesterday's targets dressed as today's
- The compliance scoring underneath it: over and under costing the same, the
  score flooring at zero, calories shown but not double-counted in the overall,
  an empty day scoring zero rather than perfect, Alma as tracker of record with
  The Way's own food log standing in when it hasn't posted, and the snack
  suggester refusing to close a macro gap by pushing calories past the ceiling
- `bridge/test-helpers.js` — an in-memory `./storage`, a real Express app on an
  ephemeral port, and a scriptable stand-in for the outbound `fetch`. Route
  behaviour is tested through real routing and real status codes rather than a
  hand-rolled req/res double
- The WHOOP fixes in the section below now have tests holding them down: the
  `scope=offline` refresh grant, the webhook bypassing the sync cache, the
  401-mid-sync retry, the last-write-wins token guard, and `/whoop/status`
  naming the next action when a refresh token has died
- Pinned regressions with a cost attached: "slept" reporting time asleep rather
  than time in bed; yesterday's nap clearing instead of sitting on this
  morning's card; clock times read in Harry's zone rather than the server's UTC;
  the Withings dedupe matching on "came from the scale" rather than an exact
  label; a hand-typed weight not blanking the last scale reading; credentials
  trimmed of the quotes and newlines a hosting dashboard adds

## Notes
- `classify()` does not recognise an intervals.icu-style session title ("VO2 6x4
  (dawn)") as training — it falls through to `busy`. Harmless today, because
  planned work arrives already categorised from `intervals.js`, but a Google
  event titled that way blocks the window it describes. Pinned as current
  behaviour rather than changed
- `whoop.js` now exports `syncLatest` and `storeTokens`. No behaviour change —
  the night-vs-nap pick and the token race guard are not reachable through the
  routes on their own

# WHOOP, properly

## Fixed
- **The refresh grant was missing `scope=offline`.** WHOOP only issues a
  replacement refresh token when the refresh request asks for offline access —
  without it you get an access token, the refresh token you just spent is
  retired, and nothing replaces it. The connection dies roughly an hour after
  every authorization. Demonstrated against a WHOOP stub that rotates the way
  the real one does: old code, refresh #1 succeeds and leaves a token WHOOP no
  longer accepts; new code keeps a valid token across refreshes. This bug
  predates the concurrency fix and is the likely root cause of "it was working"
- **The webhook had become a no-op.** The 10-minute sync cache applied to it
  too, so WHOOP saying "there is new data" was ignored if anything had synced
  recently. It forces now
- A 401 mid-sync (token revoked or reissued elsewhere, before its clock expiry)
  refreshes once and retries instead of returning nothing

## Added
- `/whoop/status` reports `configured` (client id/secret present), whether
  BASE_URL is set, and a `fix` field naming the next action — missing env vars
  are invisible otherwise

# More than one Google account

## Added
- The calendar store holds a list of accounts rather than one token pair, and
  merges every account's calendars into the same day. `/gcal/auth` adds an
  account instead of replacing the one already connected; `?email=` sets
  Google's `login_hint` so the right account is preselected
- `/gcal/status` reports per-account calendars, sync time and auth errors;
  `/gcal/disconnect?account=` removes one; `/gcal/calendars` spans accounts
- An account that can't refresh is named on the page, and the day still renders
  from the accounts that work
- Legacy single-account stores migrate on read, and adopt their real email
  address from the primary calendar on the next sync

# One day at a time

## Changed
- The front page shows a single day, not the week. Large type — readable from
  across a kitchen — with `‹`/`›`, arrow keys, Home, and swipe to step days
- `/schedule?back=N` returns days before today, and the Google sync window
  reaches 7 days back; it started at midnight today, so yesterday would have
  rendered as an empty day rather than an unsynced one
- Recovery, weigh-in and food log hide on any day but today
- The demo payload spans the same window as the real one, so demo mode can
  step days too

# The day refreshes itself

## Added
- Three cadences on the front page: clock every second, now/next markers
  repainted every 30s from cache, a fetch every 5 minutes. Hidden tabs don't
  fetch; visibilitychange/focus/online catch up if the data is over a minute
  old. Crossing local midnight reloads the page so the week rebuilds from today
- A freshness stamp ("updated 11:32a"), and "offline — showing the last good
  copy" instead of wiping the schedule on a failed fetch

## Fixed
- The app booted its view twice: assigning `location.hash` fires `hashchange`,
  which calls `nav()`, and `nav()` was then called again directly. Two copies
  of the day raced — duplicate fetches, and one run's DOM wiring hitting
  elements the other had already replaced (a null `onclick` crash)
- Timers are tracked and cleared on view entry, so re-entering the day can't
  stack intervals

# WHOOP, the scale, and compliance

## Fixed
- **WHOOP kept dropping out.** The day page asks three routes for recovery at
  once and each refreshed the token independently — but WHOOP rotates the
  refresh token on use, so the first refresh retires the token the other two
  are spending. Measured: 3 refresh attempts, 2 rejected, 1 of 3 readers got
  data; the rest fell back to demo numbers. Refresh/sync is now single-flighted
  with a 10-minute cache, token writes never overwrite a newer pair, and a dead
  refresh token surfaces as `auth_error` + `reauthorize` on /whoop/status
  instead of failing silently
- Passive readers (`/schedule`, `/availability*`, the fitness wellness
  snapshot, race week) call `sleepLatest({sync:false})` — stored data, no
  WHOOP round trip
- **Withings could never be connected on the hosted site**: the module was
  filesystem-backed and mounted only when not on Netlify, so `/withings/auth`
  was a 404 there. Ported to the storage layer and always mounted; scale
  readings mirror into the same `weigh-in` store a typed number goes to
- Demo data no longer fabricates anything measured about the athlete. A fake
  recovery score is indistinguishable from a real one on screen, and it hid
  this outage behind plausible numbers

## Added
- Starting weight (210 lb, `START_WEIGHT_LB` or `POST /weigh-in/start`), with
  change-since-start on the day
- bridge/intake.js — Alma's tracked intake (`POST /intake`), scored against the
  Hexis target per macro, with a suggested snack chosen from bridge/snacks.json
  to close the biggest gap without overshooting calories (`GET /compliance`)
- deploy/alma-sync.md — the sync run, the scoring rules, and what the score
  does and doesn't mean mid-day

# The Signature — FTP, threshold HR, zones

Implements the FTP / HR Zone / Power Zone spec.

## Added
- bridge/zones.js — the math, pure and testable: normalized power, best-effort
  scan, §2b eFTP with duration correction and recency decay, §2c ventilatory
  breakpoint detection, §2d reconciliation, §4 power zones, §5 HR zones
- bridge/zones.test.js — 40+ assertions against synthetic streams, including a
  noise sweep. Run `node bridge/zones.test.js`
- bridge/fitness.js — state, Strava stream ingestion, §6 recalculation
  triggers, audit log. `/fitness`, `/fitness/zones`, `/fitness/log`,
  `/fitness/test`, `/fitness/override`, `/fitness/breathing`,
  `/fitness/scan`, `/fitness/backfill`
- Analyze view rebuilt: the Signature, both zone tables, per-signal breakdown,
  Tymewear test entry, manual pin, and a "why FTP changed" log

## Changed
- strava.js — the Signature TODO is done: a new ride with power now pulls its
  streams and re-reads eFTP. `apiFetch` exported for stream access
- /profile serves the computed FTP, falling back to the FTP env var
- Analyze's weigh-in card reads /weigh-in (works hosted) and quotes the same
  FTP the Signature shows, rather than a hardcoded 195W

## Deliberately conservative
- The ventilatory fit refuses rather than guesses: too few segments, no steady
  work above 85% FTP, a single inflection, or split-half fits disagreeing by
  >25W each return a reason instead of a number. Across a noise sweep it is
  either within 30W of the true VT2 or it declines — never confidently wrong
- A fresh dedicated test is never silently overwritten; divergence raises a
  retest prompt instead
- Threshold HR derived from a power-only effort is labelled as a stand-in for
  a measured VT2, not presented as one

# The day (front page)

## Added
- `GET /schedule?days=N` — N days starting today, every source merged into one
  timeline per day: Google calendars, classes, intervals.icu, Hexis macros,
  and the free windows between them
- bridge/classes.js + bridge/schedule-classes.json — the weekly teaching
  timetable, expanded onto dates; class time blocks training windows
- bridge/intervals.js — planned intervals and lifting from intervals.icu
  (`/intervals/status`, `/intervals/day`), 10-minute cache
- bridge/macros.js — Hexis targets inbox (`POST /macros`, `GET /macros/today`),
  filled by the morning Claude-in-Chrome run (deploy/hexis-morning-run.md)
- bridge/weighin.js — storage-backed weigh-in (`GET`/`POST /weigh-in`) that
  works hosted, since Withings is not connected yet
- `GET`/`POST /gcal/calendars` — see and pin which calendars feed the day
- pwa `#today` view: live clock, recovery + weigh-in strip, day-by-day
  timeline, additive food log with running totals against the Hexis targets
- .gitignore — node_modules and the local storage files (seed-recipes.json and
  schedule-classes.json are real data and stay tracked)

## Changed
- Google sync now covers **every readable calendar**, not just primary, so the
  16 ECNL coaching calendar lands on the day; events carry their calendar and a
  source, and a coaching calendar sets the category for everything on it
- Day keys are local dates — `toISOString()` rolled "today" over at 8pm Eastern
- Sync horizon 8 → 15 days; `defaultView()` is the day on every role

## Still open
- Classes: schedule-classes.json is empty until the real timetable goes in
- intervals.icu + Hexis need their credentials / morning run before those lanes
  show anything
- Withings still not connected — weigh-in is manual by design for now

# Netlify Function migration

## Added
- netlify/functions/api.js — the entire bridge as one serverless function
- netlify.toml — publish `pwa`, functions `netlify/functions`
- package.json (repo root) — express, serverless-http, @netlify/blobs
- bridge/storage.js — persistence layer: **Netlify Blobs** in production,
  local JSON files on the Zwift PC. Same code, two homes.
- bridge/app.js — shared Express app (no listen); server.js is now a
  thin local runner
- /whoop/status and /whoop/sync routes

## Changed
- All modules (fuel-log, plan, weather, race, prescriptions, whoop, agent)
  rewritten async on the storage layer; agent tools now call module
  functions directly (no self-HTTP — required in serverless)
- pwa/app.js — API base auto-selects: explicit Settings URL > local
  bridge (port 8420) > /.netlify/functions/api on Netlify. Demo data only
  as a fallback when a request fails.
- pwa/service-worker.js — v2 network-first (updates always land)

## Persistence: the honest part
Netlify Functions have NO durable disk. Local JSON files are not storage
there — anything written to the filesystem vanishes between invocations.
This migration therefore uses **Netlify Blobs** (built into your Netlify
site, no extra account) for: meals, plan, race week, WHOOP tokens, agent
thread. Consequences:
- Local PC and Netlify are two separate data stores. Meals logged on the
  phone (Netlify) will NOT appear on the PC's localhost bridge, and vice
  versa. Pick one as primary (recommend Netlify once WHOOP is connected
  there) — or keep PC for the cockpit and treat it as dev.
- Podcast caching is local-PC only (functions can't store MP3s).
- Withings/Strava modules stay local-only in this pass; they move to
  storage-layer versions when those integrations go live.

## Deployment steps
1. GitHub repo (web UI): upload/replace these paths from the zip:
   - netlify.toml, package.json (repo ROOT)
   - netlify/functions/api.js  (new folders: create by typing
     "netlify/functions/api.js" in the new-file name field)
   - all files in bridge/  (replace)
   - all files in pwa/     (replace)
   Commit.
2. Netlify → Site configuration → Environment variables → add:
   FUEL_TOKEN            = (mint a NEW private phrase — the old example
                            one is public; do not reuse it on the internet)
   ANTHROPIC_API_KEY     = sk-ant-...
   BASE_URL              = https://thewayforward.netlify.app/.netlify/functions/api
   HOURS_PER_WEEK        = 8
   WHOOP_CLIENT_ID       = (when ready)
   WHOOP_CLIENT_SECRET   = (when ready)
3. Deploys → Trigger deploy → Clear cache and deploy site.
4. Phone: open the app → Settings → leave Bridge URL EMPTY (auto-selects
   the function), Token = the NEW phrase → Save.
5. WHOOP dashboard: set redirect URI to the BASE_URL callback:
   https://thewayforward.netlify.app/.netlify/functions/api/whoop/callback
   Then visit .../api/whoop/auth once from any browser.
6. Zwift PC keeps working unchanged: start-bridge.ps1 → localhost:8420.
