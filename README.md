# THE WAY — v1

One ledger, one doctrine, eight devices, one voice.
Spec: see the-way-master-spec.md (v1.1). Doctrine: fuel the work; take
the deficit at the margins; settle the day in the green band.

## Repo map
- `bridge/`  — the brain (Node/Express): fuel ledger, prescriptions,
  Withings + WHOOP + Strava webhooks, route weather, podcasts, the Agent
- `pwa/`     — the face: one app, role-aware (bedroom / kitchen /
  cockpit / phone), Morning Mode → close-out, Energy Bank, alarm,
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

## Honest v1 seams (by design, all flagged in code)
- Strava Signature analysis is stubbed: rides are ingested, eFTP/EF/LTHR
  math is the next milestone; W/kg uses set FTP until then.
- Photo→macros endpoint not yet wired in the PWA (manual + favorites
  work); vision call is a small bridge addition.
- WHOOP/Withings endpoint names follow current docs — verify on first run.
- Everything degrades visibly: bridge down → PWA queues meals locally,
  Edge falls back to `≈ SETTINGS`, weigh-in falls back to manual.
