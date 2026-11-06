# The Way on the Edge (Connect IQ data field)

A one-page data field for the Edge 1050 (and the 1040, 840, 540). On a ride it shows the numbers now
against the day's session, and it records the ride straight into the site: one sample a second (power,
heart rate, cadence, speed), sent every 30 seconds over the phone to `POST /garmin/ride`. The ride lands
in the player's store, so the Day, the chain, the calendar, the signature and the coach's debrief read it
like any ride, with no Strava in between. The Edge still writes its own file and sends it to Garmin
Connect and intervals.icu as before.

## What the screen shows
- the session's name (from the plan), or "The Way"
- watts · heart rate (green under 116, orange to the VT2 line, red at and above it) · cadence
- the plan's current step and its target (watts, or a heart-rate band), and the time left in it
- minutes above the VT2 line (139, or the fitness test's number) and the timer
- the site: "0:30 kept, just now" once a batch has landed; "sending"; "no phone (-104)" when the phone is away

## Build it once, on the Mac (about ten minutes)
Garmin fields are compiled with Garmin's free SDK, which needs a Garmin login to fetch the device
files; that is why it cannot be built from the cloud.
1. Install **Visual Studio Code** and its **Monkey C** extension (by Garmin).
2. In VS Code run the command **Monkey C: Verify Installation**: it installs the Connect IQ SDK, asks
   for the Garmin login once, and downloads the devices. Pick the latest SDK and add **Edge 1050**.
3. Run **Monkey C: Generate a Developer Key** (any folder; keep the key).
4. Open this folder (`garmin/the-way-field`) in VS Code, then **Monkey C: Build for Device**, device
   `edge1050`. The build writes `bin/TheWayField.prg`.
5. Plug the Edge in by USB and copy `bin/TheWayField.prg` to the Edge's `GARMIN/Apps` folder. Eject.

The command-line form of step 4, for the record:
```
monkeyc -d edge1050 -f monkey.jungle -o bin/TheWayField.prg -y developer_key -r -w
```

## On the Edge
1. The ride profile → Data Screens → add a screen → **Connect IQ** → The Way. Make it a one-field
   page: the full screen is the layout above. (In a two- or four-field layout it shows one line:
   watts, heart rate, cadence and whether the site has the ride.)
2. Garmin Connect on the phone must be running and connected: the field sends through it.
3. Optional: in Garmin Connect → the Edge → Connect IQ → The Way → Settings, the site's address can be
   pointed at the copy (`https://deploy-preview-2--thewayforward.netlify.app`) for a test ride.

## How it records
- Samples start when the timer starts and stop while it is paused; a batch goes every 30 seconds and
  again when the timer stops. A batch the site did not take (phone away) is kept and sent with the next;
  up to 30 minutes are kept, after which the oldest go (the Edge's own file still has them).
- On save (or discard) the last seconds go marked done. The site counts a ride from two minutes.
- The site's id for the ride is the start time; a batch sent twice adds nothing.
- The bridge side is `bridge/garmin.js`; the ride can be read back at `GET /player/ride/<id>`.
