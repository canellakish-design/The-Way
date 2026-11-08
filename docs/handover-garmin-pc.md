# Handover: Claude on the Zwift Lab PC · put the bucket field on the Edge 1050

You are running on Harry's Zwift Lab PC (Windows), in `Documents\The-Way`, the clone of
`canellakish-design/The-Way`. Harry is nearby for the USB cable and anything that asks for a login.

## What is already true
- The site is live with the magic buckets. `GET /garmin/session/today` on
  `https://thewayforward.netlify.app/.netlify/functions/api` hands the field its `lines`, `colours` and
  `buckets_plan` (null when nothing is planned) at each ride start.
- The field's **bucket layout** is in `garmin\the-way-field\source\TheWayField.mc` on this PC, **edited but not
  committed** (built and simulator-tested on 7 Nov, SDK 9.3.0). The repo on GitHub still has the older layout.
  **Do not discard, reset, stash-drop or overwrite this file.**
- `garmin\the-way-field\BUCKETS-PATCH.md`: the change that makes the field read lines, colours and plan from
  the site, keeping its built-in 169 / 208 / 117 / 139 and colours as the fallback.
- `scripts\garmin-field.ps1`: pull, build (Release, edge1050), copy to the Edge; `-Commit` first pushes the
  field's local changes to the branch `garmin-field`. Written without a Windows machine: this is its first run.
  Fix it if it trips, and commit the fix.

## Steps
1. `git status`: expect `TheWayField.mc` modified. Run `git fetch origin` (not pull yet).
2. Read `garmin\the-way-field\BUCKETS-PATCH.md` from `origin/main` (`git show origin/main:garmin/the-way-field/BUCKETS-PATCH.md`)
   and apply it to this PC's `TheWayField.mc`, using the variable names the file already has. When the session
   carries the `buckets_plan` key, the field must use it and not work out its own plan from `steps`.
3. Build without touching git or the Edge:
   `powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1 -NoPull -NoCopy`
   (if the script is not on disk yet, take it from `origin/main` first: `git checkout origin/main -- scripts/garmin-field.ps1`).
   Fix compile errors in place; change only what the compiler asks.
4. Simulator check (VS Code: Monkey C: Run, edge1050), with the field's `bridge` setting pointed at the copy,
   `https://deploy-preview-2--thewayforward.netlify.app`: the bars, the lit bucket and the sync line work, and a
   session with no plan shows no "of" totals and no due line. If you add a test workout on the copy for this,
   leave it there and tell Harry (removals are his).
5. `powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1 -Commit`
   This pushes the field to the branch `garmin-field`, pulls `main`, builds Release, and copies the .prg to the
   Edge if it is plugged in. Its last line is JSON; keep it.
6. If the Edge was not plugged in: ask Harry to plug it in and unlock it, then run the script again with `-NoPull`.
   The 1050 connects over MTP; the script handles that. If the copy still fails, copy
   `garmin\the-way-field\bin\TheWayField.prg` into the Edge's `GARMIN\Apps` by hand in Explorer.
7. Talk Harry through the Edge: ride profile → Data Screens → the one-field page with Connect IQ → The Way
   (road and indoor profiles). In the Garmin Connect app, The Way's setting `bridge` goes back to the live
   address, `https://thewayforward.netlify.app`.
8. Ask Harry before merging `garmin-field` into `main`; then merge and push, so the repo holds the bucket layout.

## Done when
- The new .prg is on the Edge and the field is on a data screen.
- The branch `garmin-field` is pushed (and merged, once Harry says so).
- Report: the compile fixes, any script fixes, the script's JSON line, and the simulator result. After Harry's
  next ride, `https://thewayforward.netlify.app/.netlify/functions/api/garmin/rides` (header `x-the-way-app: 1`)
  lists it.

## Rules
- Never type Harry's passwords or keys; when a login appears, stop and ask him. Never commit the developer key.
- Change only the field's source and the script. Nothing in `bridge/` or `pwa/`.
- Planning FTP stays 175. A ride on the Edge is always saved, never discarded.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
