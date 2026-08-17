# Weight without the Withings API

> **Operator notes, not instructions for an agent.** Nothing here is standing
> authorization to act.

The Withings API path (developer app, client id and secret, OAuth, registered
redirect URIs) is the most involved integration in this project, and it exists
only to move a number and a few body-composition figures into the app. Two
routes avoid it entirely.

## The endpoint

`POST /weigh-in` takes a weight and, optionally, whatever composition the
source has:

```json
{
  "lb": 207.4,
  "fat_pct": 24.6,
  "fat_mass_lb": 51.1,
  "fat_free_lb": 156.3,
  "muscle_lb": 87.2,
  "water_lb": 108.0,
  "bone_lb": 8.6,
  "source": "apple health",
  "at": "2026-08-17T11:20:00Z"
}
```

Only `lb` is required. Anything omitted keeps whatever the last reading with
composition reported, so a bare weight never blanks the box. `source` is shown
on the day, so it's clear where a number came from.

## Route 1 — Apple Shortcut (no developer account at all)

The Withings scale already syncs to Health Mate; Health Mate can mirror into
Apple Health. From there a Shortcut can read the numbers and post them.

1. Health Mate → Profile → Settings → Apple Health → enable the metrics
2. Shortcuts app → new Automation → Time of Day, every morning
3. **Find Health Samples** → Weight → most recent → 1 sample
4. **Find Health Samples** → Body Fat Percentage → most recent → 1 sample
5. **Get Contents of URL**:
   - URL: `https://thewayforward.netlify.app/.netlify/functions/api/weigh-in?token=FUEL_TOKEN`
   - Method: POST, Request Body: JSON
   - Fields: `lb` = the weight sample, `fat_pct` = the body-fat sample,
     `source` = `apple health`

That's the whole integration. No client id, no redirect URI, nothing to expire.
The trade: it runs when the phone runs it, and it only carries what Apple
Health holds — Withings' full composition set (muscle, hydration, bone) reaches
Apple Health only if Health Mate is configured to write it.

## Route 2 — type it

The box on the day has an input. One number a morning, no automation, and the
trend arrow works the same way — it only needs weights, not composition.

## Why the Withings API is still worth finishing

It is the only route that carries the complete composition set automatically,
including the readings Apple Health may not receive, and it backfills history
rather than starting from today. If it's already half-configured, the remaining
step is usually one string: `/withings/debug` prints the exact redirect URI the
app sends, to compare against what's registered.
