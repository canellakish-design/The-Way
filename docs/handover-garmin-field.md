# Handover: get The Way data field onto Harry's Edge 1050

For a Claude session running on Harry's Mac (Claude Code in the repo, or Claude with the desktop app's
computer use), with Harry at the keyboard for the two moments that need him: the Garmin login and the
USB cable. Read this whole file first. Do not type any of Harry's passwords, ever: when a login is
needed, say so and wait.

## What exists
- `garmin/the-way-field/` in this repo: a Connect IQ **data field** for the Edge 1050 (also 1040, 840, 540).
  One full-screen page: watts, heart rate coloured by the 116 and VT2 lines, cadence, the plan's current
  step and its target, minutes above the line, and whether the site has the ride. It records the ride
  into the site: one sample a second, sent every 30 s over the phone to `POST /garmin/ride` on the bridge,
  which files it in the player's store so the Day, the chain, the calendar and the debrief count it. No
  Strava needed for outdoor rides once it runs.
- The bridge side is live: `bridge/garmin.js`, tested end to end with a fake ride on the copy.
- Its README (`garmin/the-way-field/README.md`) has the short form of the steps below.
- The source has never been compiled: the cloud session had no Garmin device files (they come only through
  a Garmin login). Expect a handful of compile errors on the first build and fix them in place; the logic
  is right, the Monkey C typing may need small corrections.

## The job, in order
1. **The repo on the Mac.** `git clone` of `canellakish-design/The-Way` (or `git pull` if it is there),
   branch `main`. Work in `garmin/the-way-field`.
2. **Visual Studio Code and Garmin's Monkey C extension.** Install VS Code if missing; in Extensions,
   install **Monkey C** (publisher Garmin).
3. **The SDK and the device files.** Command palette → **Monkey C: Verify Installation**. It opens Garmin's
   SDK Manager: Harry signs in with his Garmin account (his hands). Download the **latest SDK** and, under
   Devices, **Edge 1050** (add Edge 1040, 840, 540 if offered; not required). Set the SDK as current.
4. **A developer key.** Command palette → **Monkey C: Generate a Developer Key**. Any folder outside the
   repo (e.g. `~/Garmin/keys`). It is a private key: do not commit it, do not paste it anywhere.
5. **Build.** Open the folder `garmin/the-way-field` in VS Code (File → Open Folder, that folder, not the
   repo root). Command palette → **Monkey C: Build for Device** → `edge1050`. Output: `bin/TheWayField.prg`.
   The command-line form, if preferred: `monkeyc -d edge1050 -f monkey.jungle -o bin/TheWayField.prg -y <key> -r -w`.
   - On a compile error: read the line it names, fix the source, build again. Likely spots: a type
     annotation the checker rejects (`as Array<Number or Null>` and friends can be loosened to `as Array`),
     a `Dictionary.put` on a typed literal, `getBackgroundColor()` on a device that lacks it (guard with
     `DataField has :getBackgroundColor`). Keep the behaviour; change only what the compiler asks.
   - **Try it in the simulator first:** Command palette → **Monkey C: Run** (or `connectiq` then
     `monkeydo bin/TheWayField.prg edge1050`). In the simulator, Simulation → Activity Data → play a
     FIT file or the built-in generator, then press start. The field should show numbers and, with the
     simulator's network on, the "The Way: … kept" line within a minute. Settings → Connect IQ Settings
     lets you point `bridge` at the copy for the test: `https://deploy-preview-2--thewayforward.netlify.app`.
   - Commit the compile fixes to `main` (message says what the compiler asked for) and push. Do not
     commit `bin/` (it is ignored) or the key.
6. **Onto the Edge.** Harry plugs the Edge 1050 in by USB (it mounts as a drive). Copy
   `bin/TheWayField.prg` into the Edge's `GARMIN/Apps` folder. Eject. Alternative when the Edge does
   not mount: Garmin Express, or the Connect IQ store's sideload is not available, so USB it is.
7. **On the Edge** (Harry's hands, you guide): the ride profile (the road one and the trainer one)
   → Data Screens → Add New → **Connect IQ** → The Way. Make it a one-field page. In the Garmin
   Connect app on the phone → the Edge → Connect IQ Apps → Data Fields → The Way → Settings: the
   bridge address, the live site by default; set the copy's address for a test ride, back to the live one
   after.
8. **First ride.** Phone with Garmin Connect open and connected. Start the timer; within a minute the
   bottom line reads "The Way: 0:30 kept, just now". Negative codes in that line mean no phone link
   (-104 is the usual one): check Bluetooth and that Garmin Connect is running. After the ride, the site:
   `GET /garmin/rides` on the bridge lists it; the Day's Ride box and the Calendar count it. If it went to
   the copy, it is at the copy's address instead.

## If you are Claude in Chrome
Chrome cannot install software, run the compiler or copy a file to the Edge: those three are Harry's
hands, and you walk him through them one step at a time, checking each before the next.
- You can: open the download pages (VS Code, the Monkey C extension in the VS Code Marketplace, Garmin's
  Connect IQ SDK page), keep this list open, read the site's pages to verify the result
  (`https://thewayforward.netlify.app/.netlify/functions/api/garmin/rides` after a ride), and open Garmin
  Connect on the web for the device's Connect IQ settings.
- Harry does, with you reading the step aloud: install VS Code and the Monkey C extension; run **Monkey C:
  Verify Installation** and sign in to Garmin (you never see or type the password); download the SDK and
  the Edge 1050 device; **Generate a Developer Key**; open the folder `garmin/the-way-field` from his clone
  of the repo; **Build for Device** → edge1050; copy `bin/TheWayField.prg` to the Edge's `GARMIN/Apps`
  over USB; add the field to the ride profile's data screens.
- On a compile error: have Harry paste the error line to you; tell him the exact edit (file, line, before
  and after) or ask him to open the file in VS Code and dictate the change. Keep the behaviour; change
  only what the compiler asks. Ask him to commit and push the fix from VS Code (Source Control → commit →
  Sync) so the repo carries it.
- If the build keeps failing past two or three fixes, stop and say so: a Claude Code session on the Mac
  (terminal) can do the whole build itself, and that is the better tool for the rest.

## What to report back
- Which compile fixes were needed (and that they are pushed).
- Whether the simulator showed samples reaching the bridge.
- Whether the real ride appeared on the site, with its id.

## Rules that stand
- Never type Harry's passwords or API keys; no credential goes into the repo or a chat.
- Do not change the bridge or the site's pages in this job; the field's source only, and only what the
  compiler needs. Anything else is a note in the report.
- The ride is always saved on the Edge, never discarded, test or not.
- Planning FTP stays 175 on the site; the field does not touch it.
