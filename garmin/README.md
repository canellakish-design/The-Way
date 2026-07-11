# Fuel Dashboard — Edge 530 custom data field

Full-screen data field: 3s power, NP, IF (zone-colored), TSS, kcal, and a
live fat/carb substrate split — informed by the breakfast you log on the
Coach Tadej Fuel kitchen tablet.

## Build & sideload
1. Install the Connect IQ SDK via the SDK Manager and the "Monkey C"
   VS Code extension. Add the Edge 530 device in the SDK Manager.
2. Open this folder in VS Code → Ctrl/Cmd+Shift+P → "Monkey C: Build
   Current Project" → target `edge530`.
3. Test: "Monkey C: Run" launches the simulator (Simulation > Activity
   Data to feed fake power).
4. Sideload: plug the Edge 530 in via USB and copy the built `.prg`
   into the device's `/Garmin/Apps/` folder. Reboot the Edge.
5. On the Edge: ride profile → data screens → set a 1-field layout →
   Connect IQ → Fuel Dashboard.

## Settings (Garmin Connect app on your phone)
More → Garmin Devices → Edge 530 → Connect IQ Apps → Data Fields →
Fuel Dashboard → Settings:
- FTP (watts)
- Fasted ride (fallback toggle when the bridge is unreachable)
- Carb curve shift % (negative = fat-adapted)
- Fuel bridge URL (https://your-app.onrender.com) + token

## Bridge integration
1. In strava-bridge.js add:  `require('./morning-fuel')(app);`
   (ensure `app.use(express.json())` is active) and set env var
   `FUEL_TOKEN` to a shared secret.
2. Deploy (Render works; Connect IQ requires HTTPS, which Render
   provides by default).
3. Add the `logBreakfast()` snippet (bottom of morning-fuel.js) to the
   kitchen dashboard so logging breakfast POSTs to the bridge.
4. Enter the URL + token in the field settings.

At ride start (phone tethered via Garmin Connect), the field GETs
`/morning-fuel`. Status line semantics — no silent failures:
- `BKFST 85g` / `BKFST: FASTED` — fresh log pulled from the bridge
- `SYNC...` — request in flight (retries twice, 2 min apart)
- `≈ SETTINGS` / `≈ FASTED (SET)` — bridge unreachable or log stale;
  using the phone-settings fallback

## Model notes (estimates, not measurements)
- Mechanical kJ ≈ metabolic kcal (gross efficiency ~24% offsets kJ→kcal).
- Carb fraction follows a crossover curve on 30s-smoothed %FTP
  (~45% carbs at ≤50% FTP → 100% at ≥95% FTP).
- Fasted mode shifts the curve ~8% fat-ward (5% after hour one).
- Glycogen drift: fat-ward after ~90 min, delayed ~0.5 min per gram of
  breakfast carbs logged.
