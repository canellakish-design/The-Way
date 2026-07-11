# The Way Bridge — home deploy on the Zwift PC (Windows)

## 1. Install
- Install Node.js LTS (nodejs.org).
- Copy the `bridge/` and `pwa/` folders to e.g. `C:\the-way\`.
- In `C:\the-way\bridge`: `npm install`, copy `deploy/env.example` values
  into system environment variables (or use a `.env` loader of choice).
- Test: `node server.js` → open http://localhost:8420 — The Way loads.

## 2. Run as a service (survives reboots)
Simplest: Task Scheduler → Create Task →
- Trigger: At startup · Action: Start a program → `node.exe`,
  arguments `C:\the-way\bridge\server.js`, start in `C:\the-way\bridge`
- "Run whether user is logged on or not", restart on failure ×3.
(NSSM works too if you prefer a real Windows service wrapper.)

## 3. Cloudflare Tunnel (public HTTPS, no open ports)
- Add your domain to Cloudflare (free plan fine).
- Install `cloudflared`, then:
  `cloudflared tunnel login`
  `cloudflared tunnel create the-way`
  `cloudflared tunnel route dns the-way bridge.yourdomain.com`
  Config: service `http://localhost:8420`
  `cloudflared service install` (runs at boot)
- Set env `BASE_URL=https://bridge.yourdomain.com`.

## 4. Connect the externals (each is a one-time visit)
- Withings: create app at developer.withings.com
  (callback `BASE_URL/withings/callback`) → visit `BASE_URL/withings/auth`.
- WHOOP: create app at developer.whoop.com → visit `BASE_URL/whoop/auth`,
  then set webhook URL in their dashboard to `BASE_URL/whoop/webhook`.
- Strava: create API app, then create the webhook subscription (one curl,
  see developers.strava.com/docs/webhooks) pointing at
  `BASE_URL/strava/webhook` with your STRAVA_VERIFY_TOKEN.
- Agent: set ANTHROPIC_API_KEY (console.anthropic.com).

## 5. Devices
- Tablets/phone on home WiFi: The Way at `http://ZWIFT-PC-IP:8420`
  (or the tunnel URL from anywhere). Add to Home Screen. Settings tab →
  set role (bedroom/kitchen/cockpit/phone), bridge URL, token.
- Kiosk tablets: Android "screen pinning" / Fully Kiosk Browser; disable
  sleep while charging. Set Windows Active Hours to protect 5–7 am.
- Watch: see `watch/shortcut-setup.md`.
- Garmin: build `garmin/` per its README; enter tunnel URL + token in
  field settings.
