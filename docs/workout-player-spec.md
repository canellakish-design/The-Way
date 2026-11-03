# The Way · workout player (spec v0, 3 Nov 2026)

## What it is
A workout player built into The Way that replaces Zwift for indoor training. It plays the workouts built in The Way, controls the smart trainer (ERG), records the ride, and saves it to intervals.icu and Strava.

It never needs Zwift running. It is not a virtual world; it is a head unit for structured training.

## Standing rules it must keep
- **A ride is always saved, never just exited.** Samples are written to the device every second. A crash, a closed tab or a dead battery loses nothing, and the next launch offers to finish and save the ride.
- **Planning FTP 175, LTHR 139, max HR 162.** Never 196. Only Harry changes them, on the Ride page.
- **No workouts before 7 a.m.**
- **12-hour times, and dates like "Mon, Nov 3".**
- **Zone 1 is heart rate 116 and under.**

## How it connects (the main technical choice)
A web page can talk to a trainer and a heart-rate strap over Bluetooth with **Web Bluetooth**. Most trainers since about 2020 speak the standard protocol for this, **FTMS** (Fitness Machine Service):
- **Indoor Bike Data:** power, cadence and speed, once a second.
- **Control Point:** set ERG target watts, or resistance or grade.
- **Heart rate:** the standard Heart Rate Service. This covers a chest strap, the Tymewear strap's HR, or the vívoactive 6 broadcasting heart rate.

**The catch:** Web Bluetooth works in Chrome and Edge on Windows, Mac, Android and ChromeOS. It does **not** work in Safari or any browser on iPhone or iPad. Three options:

| Option | Where it runs | Cost |
|---|---|---|
| A. Chrome on the computer that runs Zwift today | That PC or Mac, next to the trainer | None. **Recommended to start.** |
| B. The Bluefy browser on iPhone or iPad | iOS (Bluefy supports Web Bluetooth) | A free app; the player runs as is |
| C. A small native wrapper (Capacitor) around the player | iPhone or iPad as a real app | More work: App Store or TestFlight, BLE plugin |

**Plan:** build A first. B comes almost free with it. C is only needed if iOS becomes the main screen.

## What the player does

### Before the ride
- Opens today's planned session from Day or Calendar, or any workout from the library.
- Shows the profile, the duration, the target power at FTP 175, and what to eat first (from the Fuel plan: carbs before, bottles on the bike).
- Connects to the trainer and the HR strap, remembering both for next time. Pressing Start counts in 3 seconds, and recording begins.

### During the ride (one screen, head-unit look)
- **Big fields:** power, with its target; heart rate, with its zone colour; cadence; the time left in the interval; and the time left overall.
- **Profile strip:** the whole workout, a cursor at now, and the next interval named in advance ("Next: 40/20 × 8 at 230 W in 0:30").
- **ERG:** the trainer holds the target watts. Controls:
  - **Bias:** ±5% intensity, for a hard day or a fresh day.
  - **ERG off:** for one interval, then resistance by hand.
  - **Skip interval,** **Pause,** **End.** End always saves; there is no "discard" on the ride screen.
- **HR-held Zone 1 (new; Zwift can't do this):** on a Zone 1 session, ERG watts are trimmed so heart rate stays at 116 or under. The trim is ±3 W every 30 s, bounded at −25% of the plan. The ride then grades green on the Zone 1 rule by design.
- **Fuel cues:** a chime and a banner at the times the Fuel plan sets ("Bottle: 25 g now"). A tap logs it to the journal as on-the-bike fuel, so Fuel and Live update.
- **Sounds:** an interval change three seconds early, and a beep on each 40/20 change.
- **Screen:** stays awake (wake lock) and works in landscape on a laptop or in portrait on a tablet.

### After the ride
- **Saving:**
  - A FIT activity file is built in the browser.
  - It's uploaded to intervals.icu (key already on the server) and to Strava. Strava needs its upload permission added: one reconnect.
  - If a device (e.g. the Garmin) also recorded the same ride, the site's existing duplicate rule keeps the copy with power.
- **The ride card:**
  - The ride is graded against its plan, with the same grade as the Calendar.
  - Zone 1 time and decoupling.
  - New bests or breakthroughs on the power curve.
  - The legs 1 to 5 question.
- **Coach:** the coach can read the ride, and you can ask it about the ride from the card.

## Data
- **Workouts:** the existing plan store (steps with power targets, HR targets and free blocks). No new format. Any step that is "% of FTP" turns into watts at 175.
- **Recording:**
  - 1 Hz samples: time, power, cadence, HR, speed, target and ERG state. They are kept in the browser's IndexedDB until the upload succeeds, and are then kept for 7 days.
  - The bridge gets a copy of each finished ride as JSON, so analysis doesn't wait on Strava.
- **New bridge routes:**
  - `GET /player/session/:id`: the workout, with its watts and fuel cues.
  - `POST /player/ride`: the samples and the FIT.
  - `POST /player/upload`: to intervals.icu and Strava.
- **The copy:** the player works on the copy (deploy preview). Uploads are held back there by the existing sandbox guard, so testing never puts a fake ride on Strava.

## Building it, in order
1. **Spike (one evening):**
   - A test page connects to the trainer by Web Bluetooth.
   - It reads power and cadence, and sets ERG to 100 W, then 150 W.
   - It reads HR.
   - This proves the trainer speaks FTMS before anything else is built.
2. **Player v1:**
   - Today's workout, ERG, the ride screen, 1 Hz recording, crash-safe storage.
   - A FIT file built and uploaded to intervals.icu.
   - The ride shows on Day and Calendar.
3. **v2:** Strava upload, fuel cues with logging, sounds, bias, skip, and HR-held Zone 1.
4. **v3:** a tablet layout and, only if wanted, the iOS wrapper. The Tymewear breathing channel, if its strap broadcasts it, could also come here.

Each step is tested on the copy, then by Harry on a short ride, before it replaces Zwift.

## What Zwift does that this does not (decide if any matter)
- **Not planned:** the virtual world and routes, group rides and races, and in-game route gradients.
- **Possible later:** a simple "grade mode" from a course's elevation profile, replaying a road course from the Ride page on the trainer.
- **Bonus:** Zwift's workout export to Garmin and TrainingPeaks isn't needed, because The Way already sends workouts to intervals.icu and Garmin.

## Open questions for Harry
1. **Which trainer** (make and model)? It needs FTMS. Wahoo KICKR, Tacx Neo and Flux, Elite Direto, Saris H3 and newer Wahoo models all support it. An older Wahoo may need its firmware updated.
2. **What runs Zwift today:** a Windows PC, a Mac, an iPad, or Apple TV? Option A needs a PC or Mac with Bluetooth.
3. **Heart rate:** chest strap (which), the Tymewear strap, or the vívoactive 6 broadcasting? The watch can broadcast HR but uses more battery while it does.
4. **Garmin during indoor rides:** will you keep recording on the watch too? If so, the duplicate rule handles it, but one recording is cleaner.
5. **Anything from Zwift you'd miss:** the sounds, the ride-on social side, a particular workout feature?
