# Handover: Claude on the Zwift Lab PC · make the Garmin field build itself onto the Edge

You are running on Harry's Zwift Lab PC (Windows), in `Documents\The-Way`, the clone of
`canellakish-design/The-Way`. Harry is nearby for the USB cable and for anything that asks for a login.

**The goal:** a tool on this PC that builds The Way's Garmin data field and puts it on the Edge 1050 with no one
at the keyboard. When Claude changes the field from anywhere and pushes it to `main`, the PC builds it, copies it
onto the Edge the next time the Edge is plugged in, and reports what it did to the site, where Claude can read it.

## What is already true
- The site is live with the magic buckets. `GET /garmin/session/today` on
  `https://thewayforward.netlify.app/.netlify/functions/api` (header `x-the-way-app: 1`) hands the field its
  `lines`, `colours` and `buckets_plan` (null when nothing is planned) at each ride start.
- The field's **bucket layout** is in `garmin\the-way-field\source\TheWayField.mc` on this PC, **edited but not
  committed** (built and simulator-tested on 7 Nov, SDK 9.3.0). GitHub still has the older layout.
  **Do not discard, reset, stash-drop or overwrite this file.**
- `garmin\the-way-field\BUCKETS-PATCH.md`: the change that makes the field read lines, colours and plan from
  the site, keeping its built-in 169 / 208 / 117 / 139 and colours as the fallback.
- `scripts\garmin-field.ps1`, the tool: pull, build (Release, edge1050), copy to the Edge (drive letter or MTP),
  report to the site (`POST /garmin/build`). `-Commit` first pushes local field changes to the branch
  `garmin-field`; `-Auto` is the unattended run (builds only when main's field changed, copies only when the Edge
  is plugged in and lacks the newest build, quiet otherwise, never touches uncommitted work); `-Install`
  registers the scheduled task. It was written without a Windows machine: **this is its first run, and making
  it work is part of the job.** Fix what trips and commit the fixes.
- `GET /garmin/build` on the site lists the PC's last 30 reported runs and `on_edge`, the build last copied.

## Steps
1. `git status`: expect `TheWayField.mc` modified. `git fetch origin`, then take the newest tool and patch
   without touching the field's source:
   `git checkout origin/main -- scripts/garmin-field.ps1 garmin/the-way-field/BUCKETS-PATCH.md`
2. Apply `BUCKETS-PATCH.md` to this PC's `TheWayField.mc`, using the names the file already has. When the session
   carries the `buckets_plan` key, the field uses it and does not work out its own plan from `steps`.
3. Build only: `powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1 -NoPull -NoCopy -NoReport`.
   Fix compile errors in the field (only what the compiler asks) and any error in the script.
4. Simulator check (VS Code: Monkey C: Run, edge1050), the field's `bridge` setting on the copy,
   `https://deploy-preview-2--thewayforward.netlify.app`: bars, lit bucket and sync line work; a session with no plan
   shows no "of" totals and no due line. A test workout added on the copy stays there; tell Harry (removals are his).
5. Keep the work: `powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1 -Commit -NoCopy`.
   Then ask Harry, and on his yes merge the branch `garmin-field` into `main` and push. From here the repo holds the
   bucket layout, and the unattended run has a clean tree to work from.
6. The copy, by hand once: Harry plugs in and unlocks the Edge; run the script with no options. Check its JSON says
   `copied`. If the MTP copy fails, fix the script (Shell.Application paths differ by Windows version: the Edge's
   top folder may be `Internal Storage` or `Primary`), and only as a last resort copy
   `garmin\the-way-field\bin\TheWayField.prg` into `GARMIN\Apps` in Explorer.
7. The unattended run, tested: with the Edge unplugged, `-Auto` prints `nothing to do` and exits 0; make a trivial
   commit to the field on a scratch branch, point the test at it, or simply run `-Auto` after deleting
   `garmin\the-way-field\bin\last.json` and check it rebuilds and reports. Undo any scratch change.
8. Install: `powershell -ExecutionPolicy Bypass -File scripts\garmin-field.ps1 -Install`. Confirm the task
   "The Way - Garmin field" in Task Scheduler, run it once from there, and check `GET /garmin/build` on the site
   shows the run.
9. So Claude can also run it on demand from the cloud: Harry opens the Claude desktop app → Settings → Claude Code →
   Remote Control and adds `Documents\The-Way` (his clicks; tell him exactly where). Keep the app running.
10. Talk Harry through the Edge once: ride profile → Data Screens → the one-field page with Connect IQ → The Way
    (road and indoor). In Garmin Connect, The Way's setting `bridge` is the live address,
    `https://thewayforward.netlify.app`.

## Done when
- The new field is on the Edge, on a data screen, and `GET /garmin/build` shows a run with `copied` and `on_edge`.
- The scheduled task is installed and has reported at least once.
- The bucket layout is on `main` (after Harry's yes), and every fix to the field or the script is pushed.
- Report: compile fixes, script fixes, the JSON lines of the runs, the simulator result, and whether Remote
  Control lists the folder.

## Rules
- Never type Harry's passwords or keys; when a login appears, stop and ask him. Never commit the developer key.
- Change only the field's source and `scripts/garmin-field.ps1`. Nothing in `bridge/` or `pwa/`.
- Ask Harry before anything lands on `main`.
- Planning FTP stays 175. A ride on the Edge is always saved, never discarded.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
