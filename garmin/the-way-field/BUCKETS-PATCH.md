# The field reads its lines, colours and plan from the bridge

For the session on the Zwift Lab PC that holds the bucket layout (uncommitted in
`Documents\The-Way\garmin\the-way-field\source\TheWayField.mc`). The repo copy of the file is the older
layout. Apply this to the PC copy, build, check it in the simulator, then commit the PC copy so the repo
carries the bucket layout.

## What the bridge now sends (`GET /garmin/session/today`)
```json
{ "name": "…", "workout_id": "…", "time": "07:00", "vt2_hr": 139,
  "steps": [[0, 300, 101, 0, 0], [300, 180, 223, 0, 0], …],
  "lines":   { "vt1_w": 169, "vt2_w": 208, "vt1_hr": 117, "vt2_hr": 139, "date": "2026-08-14", "source": "Tymewear" },
  "colours": { "low": "#0099FF", "high": "#FFAA00", "peak": "#E00000" },
  "buckets_plan": { "low": 1140, "high": 300, "peak": 540 } }
```
- `buckets_plan` is `null` when nothing is planned (no session, or a ride-by-feel session such as a
  Zone 1 ride). Then the bars share the ride time, with no "of" totals and no due line. The field must
  not work out its own plan from `steps` when the key is present, so the field and the site always agree.
- `steps` no longer carries a heart-rate band on a free Zone 1 step (it was there for the target line the
  new layout dropped); a free step is `[start, dur, 0, 0, 0]`.
- The lines come from the thresholds store (`/thresholds`), so a new Tymewear test reaches the Edge at
  the next ride start.

## The change in `onSession`
Keep the built-in 169 / 208 / 117 / 139 and the three colours as the fallback; take the bridge's when they
arrive. Use the names the PC copy already has for these; the ones below are placeholders.
```monkeyc
    var lines = data.get("lines");
    if (lines instanceof Dictionary) {
        var v;
        v = lines.get("vt1_w");  if (v instanceof Number) { _vt1W = v; }
        v = lines.get("vt2_w");  if (v instanceof Number) { _vt2W = v; }
        v = lines.get("vt1_hr"); if (v instanceof Number) { _vt1Hr = v; }
        v = lines.get("vt2_hr"); if (v instanceof Number) { _vt2Hr = v; _vt2 = v; }
    }
    var cols = data.get("colours");
    if (cols instanceof Dictionary) {
        var c;
        c = hexColour(cols.get("low"));  if (c != null) { _colLow = c; }
        c = hexColour(cols.get("high")); if (c != null) { _colHigh = c; }
        c = hexColour(cols.get("peak")); if (c != null) { _colPeak = c; }
    }
    if (data.hasKey("buckets_plan")) {
        var bp = data.get("buckets_plan");
        if (bp instanceof Dictionary) {
            _planLow = bp.get("low"); _planHigh = bp.get("high"); _planPeak = bp.get("peak");
            _hasPlan = true;
        } else {
            _hasPlan = false;   // no plan: bars share ride time, no totals, no due line
        }
        _planFromBridge = true; // do not recompute the plan from steps
    }
```
```monkeyc
    // "#0099FF" to 0x0099FF; null if it does not parse
    private function hexColour(s) as Number or Null {
        if (!(s instanceof String) || s.length() != 7) { return null; }
        return s.substring(1, 7).toNumberWithBase(16);
    }
```
- The due line still comes from `steps` (the plan's timeline). It only needs each step's bucket, which is
  the same rule: target watts against the lines when watts > 0, else the middle of the heart-rate band,
  else none.
- Build: Monkey C: Build for Device → edge1050. Check in the simulator against the copy that the "of"
  totals still read 19:00 / 5:00 / 9:00 on the worked example, and that a Zone 1 session shows no totals.
