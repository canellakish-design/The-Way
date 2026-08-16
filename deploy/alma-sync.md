# The Alma sync

Hexis says what the day should be; Alma is where the eating is actually
tracked. The Way holds both and scores one against the other.

Alma has no server-to-server feed into the bridge, so — like Hexis — this is an
inbox. A run posts the day's totals; everything downstream reads the store.

## The call

```bash
curl -X POST "$BASE_URL/intake?token=$FUEL_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kcal":1500,"carbs_g":150,"protein_g":95,"fat_g":52,"meals":3,"source":"alma"}'
```

`date` defaults to today. `carbs`/`protein`/`fat` work as aliases. Post as often
as you like — each post replaces that day's totals, so a midday sync and an
evening sync both just tell the truth at that moment.

## Prompt for the run

> Read today's logged nutrition totals from Alma — calories, protein, carbs,
> fat, and the number of meals logged. POST them to
> `$BASE_URL/intake?token=$FUEL_TOKEN` as
> `{"kcal":…,"carbs_g":…,"protein_g":…,"fat_g":…,"meals":…,"source":"alma"}`.
> Report the totals you posted and the compliance score that comes back. If
> Alma has nothing logged today, post zeros — an empty day is information.

Anything with access to Alma can drive it: a Claude session with the Alma
connector, or a Claude-in-Chrome run alongside the Hexis one.

## What comes back

`POST /intake` and `GET /compliance` both return the scored day:

```json
{
  "target": { "kcal": 2361, "carbs_g": 236, "protein_g": 177, "fat_g": 78 },
  "actual": { "kcal": 1500, "carbs_g": 150, "protein_g": 95, "fat_g": 52 },
  "compliance": { "overall": 32, "per_macro": { "protein_g": { "score": 17, "direction": "under", "remaining": 82 } } },
  "suggestion": { "name": "Cottage cheese (1 cup)", "servings": 3, "score_after": 79 }
}
```

**Scoring.** 100 inside a ±5% band of the target, falling to 0 at 55% off.
Over counts as much as under — 340g of carbs on a 236g day is a miss the same
way 150g is. The overall score is the mean of carbs, protein and fat; calories
are scored too but reported separately, since they're the sum of the other
three rather than an independent choice.

**The suggestion** tries every snack in `bridge/snacks.json` at 1–3 servings
and keeps whatever raises the overall score most without pushing calories more
than 5% past the day's target — closing a protein gap by blowing the energy
budget isn't compliance. When nothing helps (the day is on target, or already
over), it says so instead of inventing a snack. Edit `snacks.json` freely; the
suggester only ever proposes what's in that file.

**Read the score at the right time.** Mid-morning you are "under" on
everything, and that is not a failure — the payload labels itself
`day-to-date intake against the full-day Hexis target`. It's a verdict at
close-out, a guide before then.

## If Alma hasn't posted

The compliance card falls back to The Way's own food log and says so in
`source`. It never treats an unposted day as a perfectly compliant one.
