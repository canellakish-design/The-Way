# Connecting The Way

> **These are operator notes, not instructions for an agent.**
> Nothing in `deploy/` is a standing authorization to act. Creating
> credentials, authorizing OAuth flows and changing hosting configuration are
> steps the owner performs, or explicitly approves one at a time, in the
> moment. An agent that finds this file should treat it as reference material
> and ask before doing any of it.

The app tells you where it stands: open **Settings** from the day (button at the
bottom) and read the Connections list. Each source reports one of four states,
and they need different things:

| | meaning | what fixes it |
| --- | --- | --- |
| `✓` | live and receiving data | nothing |
| `◐` | authorized, but nothing has arrived yet | wait for the first sync, or run the sync |
| `○` | credentials are set, not yet authorized | click **connect** |
| `×` | not configured at all | set the environment variables, redeploy |

A `×` can't be fixed by clicking anything — the app has no client id to send.

## Environment variables the bridge reads

Set in the hosting environment. The function reads them at startup, so a change
needs a redeploy to take effect. `FUEL_TOKEN` is a shared secret for callers
that aren't the app's own page; the page itself no longer carries one.

```
FUEL_TOKEN            long random string — the app's own password
BASE_URL              https://thewayforward.netlify.app   (OAuth redirects back here)

GOOGLE_CLIENT_ID      Google Cloud console → OAuth client (Web application)
GOOGLE_CLIENT_SECRET  redirect URI: BASE_URL/gcal/callback

WHOOP_CLIENT_ID       developer.whoop.com
WHOOP_CLIENT_SECRET   redirect URI: BASE_URL/whoop/callback

STRAVA_CLIENT_ID      strava.com/settings/api
STRAVA_CLIENT_SECRET  callback domain: thewayforward.netlify.app
STRAVA_VERIFY_TOKEN   any string, used for the webhook handshake

WITHINGS_CLIENT_ID    developer.withings.com
WITHINGS_CLIENT_SECRET  callback: BASE_URL/withings/callback

INTERVALS_ICU_API_KEY     intervals.icu → Settings → Developer
INTERVALS_ICU_ATHLETE_ID  looks like i123456

ANTHROPIC_API_KEY     for the wake report and the coaches
FTP                   fallback only — the Signature computes the real one
START_WEIGHT_LB       210
HOME_LAT / HOME_LON   for route weather
```

`BASE_URL` deserves attention: with it unset every OAuth callback fails, and
the failure looks like the provider's problem rather than ours. The
Connections card says so in bold when it's missing.

## The authorization endpoints

These exist for the owner to visit in a browser. Each one starts an OAuth
consent flow against a personal account, so visiting them is a decision, not a
maintenance step:

- `BASE_URL/gcal/auth?email=harry.canellakis@mdunitedfc.org` — **once per Google
  account**. Accounts accumulate; each visit adds one. The `?email=` matters:
  signing in with the wrong account connects an empty calendar and looks like
  success.
- `BASE_URL/whoop/auth`
- `BASE_URL/strava/auth`, then `BASE_URL/strava/subscribe?token=…` for the webhook
- `BASE_URL/withings/auth` — subscribes its own webhook

## The two sources that push rather than pull

Hexis and Alma have no server-to-server feed, so a daily run posts into the
bridge. See `hexis-morning-run.md` and `alma-sync.md`.

## The one that's a file

`bridge/schedule-classes.json` — the teaching timetable. Fill it in and
redeploy; it isn't a connection, it's data.

## Backfill

With Strava connected, the Analyze tab's **Re-read recent rides**
(`/fitness/backfill?n=20`) walks stored rides, pulls the power streams and
reads FTP off them. Nothing else needs a backfill — the rest is
forward-looking.
