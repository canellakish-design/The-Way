# Netlify handoff — The Way

Everything that needs doing in Netlify (and the provider consoles) to get the
site working and connected. Written to be handed to someone with a browser
signed in as Harry.

## The site

- **URL**: https://thewayforward.netlify.app
- **Repo**: `canellakish-design/The-Way`, branch `main`, auto-deploys on push
- **netlify.toml**: publishes `pwa/`, functions in `netlify/functions/`,
  bundled with esbuild. No build command — the PWA is plain static files.
- **The whole backend is one function**: `netlify/functions/api.js` wraps an
  Express app. Everything is reached at
  `https://thewayforward.netlify.app/.netlify/functions/api/<route>`.
- **Storage is Netlify Blobs** — no database to configure. If Blobs aren't
  available to the function, every read falls back to empty and nothing
  persists, which looks like "connected but no data".

## Task 1 — the page renders blank (do this first)

The page went blank in a browser. It renders correctly from the repo at the
current commit, so this is about what's being served, not the code.

Diagnose in this order and report findings:

1. Load `https://thewayforward.netlify.app/?reset=1`. That unregisters the
   service worker, clears caches and reloads. If the page comes back, the
   cause was a poisoned service-worker cache and it's fixed.
2. DevTools → Network, reload, look at **`app.js`**: status code and
   `Content-Type`. It must be `200` and a JavaScript content type. If it
   returns HTML or a 404, the static file isn't being served — check the
   deploy contents and whether the catch-all redirect in `netlify.toml`
   (`/*` → `/.netlify/functions/api/:splat`) is swallowing it.
3. Netlify → **Deploys** → most recent: published or failed? If failed, the
   build log's last 20 lines say why. A failed deploy keeps serving the
   previous version, so the site can be stale rather than broken.
4. DevTools → Console: any red errors, in full.

The page can no longer be silently blank — a load failure now shows "The app
did not start" plus the error. If it's blank with **no** text at all, that
itself is the finding: `index.html` isn't being served either.

## Task 2 — environment variables

Netlify → Site configuration → **Environment variables**. Scope them to all
deploy contexts. **Redeploy after changing them** — a running function keeps
the values it started with.

| Variable | Where it comes from |
| --- | --- |
| `FUEL_TOKEN` | invent a long random string (32+ chars). This is the app's own password; it gets typed into the app's Settings screen on each device |
| `BASE_URL` | `https://thewayforward.netlify.app` — every OAuth provider redirects back here |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud console, OAuth client (Web application) |
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | developer.whoop.com |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | strava.com/settings/api |
| `STRAVA_VERIFY_TOKEN` | any random string (webhook handshake) |
| `WITHINGS_CLIENT_ID` / `WITHINGS_CLIENT_SECRET` | developer.withings.com |
| `INTERVALS_ICU_API_KEY` / `INTERVALS_ICU_ATHLETE_ID` | intervals.icu → Settings → Developer. Athlete id looks like `i123456` |
| `ANTHROPIC_API_KEY` | console.anthropic.com — powers the wake report and the coaches |
| `START_WEIGHT_LB` | `210` |
| `FTP` | fallback only; the app computes the real FTP from Strava power data |
| `HOME_LAT` / `HOME_LON` | for route weather (approx. `38.97` / `-76.50`) |

**`BASE_URL` is the one that breaks everything quietly.** Unset, every OAuth
callback fails in a way that looks like the provider's fault.

**Never paste a client secret into a chat.** Copy it from the provider's
console straight into Netlify.

## Task 3 — create the OAuth apps

Each needs an interactive login as Harry. Exact redirect URIs:

| Provider | Redirect / callback URI | Notes |
| --- | --- | --- |
| Google | `https://thewayforward.netlify.app/gcal/callback` | Enable the **Google Calendar API**. Consent screen: External, Harry as a test user, scope `calendar.readonly`. Client type: Web application |
| WHOOP | `https://thewayforward.netlify.app/whoop/callback` | Scopes **must** include `read:sleep`, `read:recovery` and **`offline`**. Without `offline` the connection dies about an hour after each authorization — this was a real bug |
| Strava | callback **domain** only: `thewayforward.netlify.app` | Strava asks for a domain, not a full URI |
| Withings | `https://thewayforward.netlify.app/withings/callback` | |
| intervals.icu | none — API key, no OAuth | |

## Task 4 — authorize

Visit each once; each returns a page saying what connected.

1. `https://thewayforward.netlify.app/gcal/auth?email=harry.canellakis@mdunitedfc.org`
   — **the schedule lives on this account.** Signing in with a different one
   connects an empty calendar and looks like success. The response lists the
   calendars found; confirm **16 ECNL** is among them. Repeat with a different
   `?email=` to add another Google account — they accumulate, they don't
   replace.
2. `https://thewayforward.netlify.app/whoop/auth`
3. `https://thewayforward.netlify.app/strava/auth`, then
   `https://thewayforward.netlify.app/.netlify/functions/api/strava/subscribe?token=FUEL_TOKEN`
   to register the webhook
4. `https://thewayforward.netlify.app/withings/auth` — subscribes its own webhook

## Task 5 — verify

Open the site → **Settings** (button at the bottom of the day). The
Connections card lists all nine sources with a state each:

- `✓` live and receiving
- `◐` authorized, no data yet
- `○` credentials set, not authorized → click connect
- `×` not configured → the environment variable is missing or the deploy
  hasn't picked it up. Clicking connect cannot help.

Target: `✓` on Google, WHOOP, Strava, Withings, intervals.icu. Hexis and Alma
stay `○` until their daily sync runs post data. Class schedule stays `×` until
`bridge/schedule-classes.json` is filled in — that's a repo file, not a
connection.

Raw detail for a stubborn one:
`https://thewayforward.netlify.app/.netlify/functions/api/status?token=FUEL_TOKEN`
returns every source with a `fix` field naming the next action. Per-source:
`/whoop/status`, `/gcal/status`, `/strava/status`, `/withings/status`.

## Task 6 — backfill

Once Strava is connected, open `https://thewayforward.netlify.app/#analyze`
and click **Re-read recent rides**. It pulls power streams from stored rides
and computes FTP, threshold HR and both zone sets. Report the FTP and the
source it names.

## What can't be done in Netlify

- **The teaching timetable** — `bridge/schedule-classes.json` in the repo,
  needs Harry's actual class times, then a redeploy.
- **Hexis and Alma** — no API; a daily browser run posts into the bridge. See
  `deploy/hexis-morning-run.md` and `deploy/alma-sync.md`.
- **Tymewear ramp tests** — no API; typed into the Analyze tab.
