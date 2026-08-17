# Connecting The Way with Claude in Chrome

A run-book for a Claude-in-Chrome session on your own machine. Everything here
needs a browser signed in as you — the bridge can't do any of it itself, and
neither can a Claude session without your logins.

**Never paste a client secret into a chat.** Copy it from the provider's console
straight into Netlify. The prompts below are written so the agent moves secrets
between two browser tabs and never repeats them back.

---

## Phase 1 — the two variables everything else needs

> In Netlify, open the site **thewayforward** → Site configuration →
> Environment variables. Add two variables, scoped to all deploy contexts:
> `FUEL_TOKEN` set to a long random string you generate (32+ chars, letters and
> digits), and `BASE_URL` set to `https://thewayforward.netlify.app`. Show me
> the FUEL_TOKEN value once so I can save it, then trigger a redeploy from
> Deploys → Trigger deploy → Deploy site. Tell me when the deploy is published.

`FUEL_TOKEN` is the app's own password — you'll type it into the app's Settings
screen on each device. `BASE_URL` is where every OAuth provider redirects back
to; with it unset, every authorization fails in a way that looks like the
provider's fault.

Then open the site, go to **Settings**, paste the token, and read the
Connections list. That list is the checklist for everything below.

---

## Phase 2 — create the OAuth apps

Each of these creates an app in a provider's developer console and produces an
id and a secret. You need to be present: they involve consent screens, terms,
and occasionally a verification step no agent should click through on your
behalf.

### Google Calendar

> Go to console.cloud.google.com. Create a project called "The Way" if there
> isn't one. Enable the **Google Calendar API**. Configure the OAuth consent
> screen as **External**, add me as a test user, and add the scope
> `https://www.googleapis.com/auth/calendar.readonly`. Then create an OAuth
> client ID of type **Web application** with the authorized redirect URI
> `https://thewayforward.netlify.app/gcal/callback`. When it shows the client
> id and secret, copy each one directly into Netlify as `GOOGLE_CLIENT_ID` and
> `GOOGLE_CLIENT_SECRET` — do not print the secret in our conversation.

### WHOOP

> Go to developer.whoop.com and open my app (or create one called "The Way").
> Set the redirect URI to `https://thewayforward.netlify.app/whoop/callback`
> and the scopes to `read:sleep`, `read:recovery` and `offline`. The `offline`
> scope is required — without it the connection dies about an hour after each
> authorization. Copy the client id and secret into Netlify as
> `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` without printing the secret.

### Strava

> Go to strava.com/settings/api. Set the Authorization Callback Domain to
> `thewayforward.netlify.app`. Copy the client id and secret into Netlify as
> `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`, and add
> `STRAVA_VERIFY_TOKEN` set to any random string.

### Withings

> Go to developer.withings.com and open my application (or create one). Set the
> callback URI to `https://thewayforward.netlify.app/withings/callback`. Copy
> the client id and secret into Netlify as `WITHINGS_CLIENT_ID` and
> `WITHINGS_CLIENT_SECRET`.

### intervals.icu — no OAuth app needed

> Go to intervals.icu → Settings → Developer. Copy the API key into Netlify as
> `INTERVALS_ICU_API_KEY`, and the athlete id shown on that page (it looks like
> i123456) as `INTERVALS_ICU_ATHLETE_ID`.

### Anthropic — for the wake report and the coaches

> Copy an API key from console.anthropic.com into Netlify as
> `ANTHROPIC_API_KEY`.

**Redeploy after the last one.** Environment variables only reach the running
function on a new deploy.

---

## Phase 3 — authorize, one link each

These are quick: each opens a consent screen and redirects back with a message
saying what connected.

> Visit each of these in turn and tell me what each page says when it returns:
> 1. `https://thewayforward.netlify.app/gcal/auth?email=harry.canellakis@mdunitedfc.org`
>    — sign in as that account. The page will list the calendars it found;
>    confirm **16 ECNL** is among them.
> 2. `https://thewayforward.netlify.app/whoop/auth`
> 3. `https://thewayforward.netlify.app/strava/auth`
> 4. `https://thewayforward.netlify.app/withings/auth`

If a Google account holds only part of the schedule, run step 1 again with a
different `?email=` — accounts accumulate rather than replace.

---

## Phase 4 — check, then backfill

> Open `https://thewayforward.netlify.app` → Settings and read the Connections
> list back to me: every source, its state symbol, and any "→" fix text.

Aim for `✓` on Google, WHOOP, Strava, Withings and intervals.icu. Hexis and
Alma stay `○` until their daily runs post (see `hexis-morning-run.md` and
`alma-sync.md`); the class schedule stays `×` until its file is filled in.

Then, with Strava connected:

> Open the app at `https://thewayforward.netlify.app/#analyze` and click
> **Re-read recent rides**. Tell me the FTP it reports and where it came from.

---

## If something says the wrong thing

The Connections list distinguishes four states deliberately:

- `×` **not configured** — the environment variable is missing or the deploy
  hasn't picked it up. Clicking connect can't help.
- `○` **credentials set, not authorized** — click connect.
- `◐` **authorized, nothing received** — for WHOOP that's normal until the
  first sync; for Strava it means no rides stored yet.
- `✓` — done.

For a stubborn one, `https://thewayforward.netlify.app/.netlify/functions/api/whoop/status?token=YOUR_TOKEN`
(and the equivalent `/gcal/status`, `/strava/status`, `/withings/status`)
returns the raw reason, including a `fix` field naming the next action.
