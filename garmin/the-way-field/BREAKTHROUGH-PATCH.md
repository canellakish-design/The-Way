# Breakthroughs on the Edge: Maximal Power Available in the field

For the session on the Zwift Lab PC that holds the current field (`Documents\The-Way\garmin\the-way-field\source\TheWayField.mc`,
the bucket layout). The repo copy of that file is the older layout and is not touched here. Apply this to the PC
copy, build, check it in the simulator, side-load it to the Edge 1050, then commit the PC copy.

Not built or run anywhere yet: the bridge half is live and tested, the Monkey C below is written against the
field's structure as the repo copy has it and has never been compiled. Treat names of existing members as
placeholders where the PC copy differs.

## What the bridge now sends (`GET /garmin/session/today`)
One more key beside `steps`, `lines`, `colours` and `buckets_plan`:
```json
"signature": { "tp": 148, "hie_kj": 18.5, "pp": 424 }
```
- `tp` threshold power (watts), `hie_kj` the tank of work above it (kilojoules), `pp` peak power (watts): the
  fitness signature the Power page shows, read at ride start.
- `null` when there is no signature yet or it could not be read in four seconds. The field then draws no MPA
  and flags nothing.

## What the field does with it
Second by second, in `compute()`, the same model the workout player runs (`pwa/player.js` `mpaStep`) and the
bridge uses for a ride's trace (`bridge/signature.js` `mpaTrace`):
- the tank starts full (`hie_kj × 1000` joules);
- above TP it drains at `(power − tp)` joules a second; at or below TP it refills by `(full − tank) × (tp − power) / full`;
- with a fraction `u` of the tank spent, `MPA = tp + (pp − tp) × u / (−ln(1 − u))` (`MPA = pp` at `u = 0`, `tp` at `u = 1`);
- power at least 2% and 3 W above MPA for three seconds running is a breakthrough: say it once (tone, and the
  field's line turns to the breakthrough text for the rest of the ride).

### Members
```monkeyc
    // the signature (bridge: /garmin/session/today "signature"); 0 = none
    private var _sigTp as Number = 0;
    private var _sigHieJ as Float = 0.0f;
    private var _sigPp as Number = 0;
    private var _tankJ as Float = 0.0f;       // joules left above threshold
    private var _mpa as Number = 0;           // watts available right now
    private var _overRun as Number = 0;       // seconds running above MPA
    private var _btAt as Number = -1;         // timer second of the breakthrough, -1 = none
    private var _btWatts as Number = 0;
```

### In `onSession`, after the existing keys are read
```monkeyc
        var sig = data.get("signature");
        if (sig instanceof Dictionary) {
            var tp = sig.get("tp"); var hie = sig.get("hie_kj"); var pp = sig.get("pp");
            if ((tp instanceof Number) && (pp instanceof Number) && (hie != null) && (pp > tp) && (tp > 0)) {
                _sigTp = tp; _sigPp = pp; _sigHieJ = (hie as Numeric).toFloat() * 1000.0f;
                if (_tankJ == 0.0f && _timerS == 0) { _tankJ = _sigHieJ; _mpa = _sigPp; }
            }
        }
```
(`hie_kj` arrives as a Float or a Number depending on its value, hence `Numeric`.)

### In `compute`, once a second while the timer runs, after `_power` is read
```monkeyc
        if (_sigTp > 0 && _sigHieJ > 0.0f && _power != null) {
            var p = _power as Number;
            if (p > _sigTp) { _tankJ -= (p - _sigTp); if (_tankJ < 0.0f) { _tankJ = 0.0f; } }
            else { _tankJ += (_sigHieJ - _tankJ) * (_sigTp - p) / _sigHieJ; if (_tankJ > _sigHieJ) { _tankJ = _sigHieJ; } }
            var u = 1.0f - _tankJ / _sigHieJ;
            var share = 1.0f;
            if (u >= 0.999999f) { share = 0.0f; }
            else if (u > 0.000001f) { share = u / (-Math.ln(1.0f - u)); }
            _mpa = (_sigTp + (_sigPp - _sigTp) * share).toNumber();
            if (p * 100 >= _mpa * 102 && p - _mpa >= 3) {
                _overRun += 1;
                if (_overRun >= 3 && _btAt < 0) {
                    _btAt = _timerS; _btWatts = p;
                    if (Attention has :playTone) { Attention.playTone(Attention.TONE_SUCCESS); }
                    if (Attention has :backlight) { Attention.backlight(true); }
                }
            } else { _overRun = 0; }
        }
```
Do this in the same once-a-second branch that appends the sample (the guard on `_lastT`), so a second is never
counted twice. A paused timer adds nothing: the tank does not refill while the timer is stopped, the same as
the player.

### In `onUpdate`
Where the layout has room under the power number (the PC copy's layout decides the place and the font):
```monkeyc
        if (_sigTp > 0) {
            var line = (_btAt >= 0) ? ("BREAKTHROUGH " + _btWatts + " W") : ("MPA " + _mpa + "  " + ((_tankJ / _sigHieJ) * 100.0f).toNumber() + "%");
            dc.setColor((_btAt >= 0) ? Graphics.COLOR_YELLOW : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(x, y, Graphics.FONT_XTINY, line, Graphics.TEXT_JUSTIFY_CENTER);
        }
```

### In `onTimerReset` (a new ride)
```monkeyc
        _tankJ = _sigHieJ; _mpa = _sigPp; _overRun = 0; _btAt = -1; _btWatts = 0;
```

## Permissions
`Attention` needs no permission for a data field's tone on the Edge 1050; if the build warns, wrap as above
(`has :playTone`) and leave it. Nothing else changes in `manifest.xml`.

## How to check it in the simulator
1. Set the simulator's bridge property to the copy (`https://deploy-preview-2--thewayforward.netlify.app`) and
   start an activity: the request to `/garmin/session/today` should come back with `signature`.
2. Feed power at 110 W: the line reads `MPA 424  100%` (peak power, full tank) and stays there.
3. Feed a steady 220 W: MPA falls; with the signature above (148 / 18.5 / 424) the breakthrough comes at about
   four minutes ten seconds. The workout player with the same numbers calls it at 253 seconds.
4. End the ride: the ride reaches the site as before; the Power page gives the medal when the ride is read.
