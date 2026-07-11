# The Way — Netlify Function migration (changelog)

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
