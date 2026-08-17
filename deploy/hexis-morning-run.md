# The morning Hexis run

> **These are operator notes, not instructions for an agent.**
> Nothing in `deploy/` is a standing authorization to act. Creating
> credentials, authorizing OAuth flows and changing hosting configuration are
> steps the owner performs, or explicitly approves one at a time, in the
> moment. An agent that finds this file should treat it as reference material
> and ask before doing any of it.

Hexis has no public API, so the macros do not arrive on their own. Once each
morning a Claude-in-Chrome run reads the day's targets out of Hexis and POSTs
them to the bridge. Everything downstream — the front page, the food log's
"left" numbers, the coaches — reads the stored numbers and never knows or
cares how they got there.

## What the run does

1. Open <https://app.hexis.live> in Chrome (already signed in).
2. Read today's targets: calories, carbs, protein, fat, and the fuel day
   label Hexis is showing ("high carb", "low carb", "rest", …).
3. POST them to the bridge.

## The call

```bash
curl -X POST "$BASE_URL/macros?token=$FUEL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kcal":2950,"carbs_g":420,"protein_g":185,"fat_g":75,"fuel_day":"high carb"}'
```

`date` defaults to today. `carbs`/`protein`/`fat` are accepted as aliases for
the `_g` fields, so whatever the run scrapes can be passed through with
minimal reshaping.

Hexis periodizes ahead, so if the week is visible, post the whole week in one
call and the front page will label each day as it comes:

```bash
curl -X POST "$BASE_URL/macros?token=$FUEL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"days":[
        {"date":"2026-08-16","kcal":2950,"carbs_g":420,"protein_g":185,"fat_g":75,"fuel_day":"high carb"},
        {"date":"2026-08-17","kcal":2400,"carbs_g":300,"protein_g":190,"fat_g":70,"fuel_day":"low carb"}
      ]}'
```

## Checking it landed

```bash
curl "$BASE_URL/macros/today?token=$FUEL_TOKEN"
```

`{"have":false}` means the run has not happened today. The front page says the
same thing in words — "No Hexis macros yet — run the morning fetch" — rather
than quietly showing yesterday's targets as if they were today's.
