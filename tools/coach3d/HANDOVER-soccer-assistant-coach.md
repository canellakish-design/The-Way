# Handover: build a 3D assistant coach for the soccer app

Written 15 Nov 2026 for the Claude Code session building Harry's soccer assistant coach. Harry wants the same kind of
figure The Way has for his cycling coach: a real 3D person on a stage who talks, moves his mouth with the words,
gestures, and can hold a spoken conversation. The difference is the look: **dressed like a soccer assistant coach**,
not in a suit.

Everything described here exists and works in the repository `canellakish-design/The-Way` (branch `main`, live at
thewayforward.netlify.app). Add that repository to your session and read the files named below; copy from them rather
than rebuilding from this description.

## What you are building

1. **The figure**: a rigged human as one `.glb` file (about 1.7 MB), built with Blender from public-domain MakeHuman
   parts.
2. **The engine**: one bundled JavaScript file that draws him with three.js and animates him with the TalkingHead
   library (idle breathing, weight shifts, blinks, eye contact, hand gestures while speaking, mouth shapes).
3. **The page wiring**: a stage element, subtitles, the voice, and the conversation loop.
4. **The brain**: the model call that answers. This part is specific to the soccer app; The Way's is only a pattern.

## Files to read in The-Way

| File | What it is |
|---|---|
| `tools/coach3d/README.md` | The build steps for the engine and the figure, and where every asset came from |
| `tools/coach3d/build.py` | Blender script: body, skin, hair, clothes, rig, face shapes, export to GLB |
| `tools/coach3d/finish.mjs` | Fixes each material's transparency after export; sets skin tone and colours |
| `tools/coach3d/entry.mjs` | The engine source: mount, mouth timeline from the words and the sound, views |
| `tools/coach3d/package.json` | The exact esbuild and gltf-transform commands and pinned versions |
| `pwa/coach3d.js`, `pwa/avatar/coach.glb` | The built outputs the site serves |
| `pwa/face.js` | The stage: loads the engine and the figure, subtitles, the drawn fallback, tap to zoom |
| `pwa/app.js` (search `CoachVoice`) | The voice player: audio element, loudness curve for the mouth, two-part speech |
| `pwa/voice.js` | Hold to talk, the open conversation loop (`talkStart`, `talkListen`, `talkFlush`), photos |
| `pwa/coach.js` | The Coach page layout |
| `pwa/service-worker.js` (search `COACH`) | Cache-first store for the two big coach files |
| `bridge/tts.js` | Text to speech through OpenAI `gpt-4o-mini-tts`, with a style and accent instruction |
| `bridge/voice.js` | The quick coach: one model call with structured output, a look-back tool, actions |

## The figure: how to make the soccer version

The pipeline is three commands (see the README): `build.py` in Blender, `finish.mjs`, then `npm run avatar`.

- Blender is run headless from Python: `pip install bpy==5.3.0`, with the MPFB 2.0.18 extension installed.
- All parts are MakeHuman assets under CC0. The asset packs are listed at
  https://static.makehumancommunity.org/assets/assetpacks.html and are unzipped into MPFB's user data folder.
- The skeleton is the TalkingHead rig (`talkinghead.mpfbskel` and its weights, CC0) from
  https://github.com/met4citizen/TalkingHead/tree/main/blender/MPFB. The README says exactly where each file goes.
  Do not use a different rig: the engine's animations expect this one.
- `build.py` takes its choices from the top of the file and an optional JSON argument: `age`, `muscle`, `weight`,
  `skin`, `hair`, `brows`, and `clothes` (a list of asset folder names).

**To dress him as an assistant coach, change only the `clothes` list and the colours in `finish.mjs`.** The cycling
coach uses `male_elegantsuit01`, `shoes03`, a beard and glasses. For the soccer coach, look in the asset packs and the
community clothes library (http://www.makehumancommunity.org/clothes.html) for:

- a training top: a quarter-zip, a track jacket or a polo
- training trousers or shorts
- trainers or turf shoes (not dress shoes)
- optional: a cap or beanie, a whistle on a lanyard, a stopwatch

I have not checked which of these exist by name; that is your first task. For each one you pick, open its page and
confirm the licence is CC0 (some community assets are CC-BY, which needs attribution; avoid anything else). Then:

- add the folder names to the `clothes` list
- add a rule for each new material in `finish.mjs` (see the pitfall below) and set its base colour there to the
  club's colours
- ask Harry for the club colours, and whether he wants the Maryland United crest on the chest. Only add a crest if he
  supplies the artwork; do not recreate a real club's badge from memory.
- ask Harry what the coach should look like (age, build, hair, beard, glasses). The cycling coach's look came from
  him one request at a time: "in a suit", "tanner with thick black glasses", "and a beard".

## Pitfalls already paid for

- **The face disappears behind the hair after export.** Blender's glTF exporter marks every material as blended.
  `finish.mjs` sets each one to opaque or alpha-masked by name. Any new clothing material needs a rule there, or it
  falls to the default (opaque), which is usually right for cloth.
- **No sound on an iPhone with the silent switch on.** Web Audio is muted by the switch; an `<audio>` element is not.
  The voice is played as media, unlocked by the tap that asked the question, and the sound is decoded separately only
  to read its loudness curve for the mouth. Do not let TalkingHead play the audio itself.
- **The mouth must follow the real voice.** The engine does not speak. Each frame the page hands it the audio clock
  and the loudness curve, and it lays the words' mouth shapes over the spoken stretches (`timeline()` in `entry.mjs`).
- **The bundle.** esbuild aliases three's FBX loader, Draco loader and stats module to an empty stub
  (`stubs/none.mjs`); TalkingHead imports them but this build never needs them. Target is `safari16`.
- **Loading.** The engine and figure are fetched quietly a few seconds after the app opens and kept by the service
  worker in their own cache, cache-first, so the Coach page does not wait on 2 MB each visit. While he loads the stage
  shows a quiet "loading" mark; Harry did not want a stand-in figure flashing up first.
- **Sentences cut off.** Phone speech recognition ends a session at every pause. Hold to talk keeps what was heard
  and restarts until the button is released. The open conversation sends after 1.2 seconds of silence and closes the
  microphone while the coach thinks and speaks, so he never answers his own voice.
- **Waiting for the answer.** Three things cut the wait from about ten seconds to two or three: gathering the app's
  context before the question arrives (`GET /voice/warm`, called when the page opens or the talk button goes down),
  speaking a long answer as two clips fetched together so the first sentence starts sooner, and using a faster model
  for spoken turns.

## The page contract

`window.Coach3D = { mount(el, { url, state }), say(text), view('full' | 'upper'), thinking(on), pause(on), dispose() }`

- `mount` resolves when the figure is on the stage. `state()` is called every frame and returns
  `{ playing, t, dur, env, level }` from the audio element.
- `say(text)` is called with the words just before they are spoken.
- `face.js` shows subtitles under him in step with the audio and switches between the full figure and a closer view
  on tap.

## The brain (pattern only)

The Way's quick coach is one Anthropic API call with a JSON-schema structured output (`reply`, `actions`, `offer`),
a cached system prompt, and a block of current context in the user turn. Spoken turns use `claude-sonnet-5-5`; photo
analysis and long researched answers use `claude-opus-5-5`. The voice is OpenAI `gpt-4o-mini-tts`. Both keys are
environment variables on the host; never put a key in the repository or ask Harry to paste one into chat. What the
soccer coach knows and can do is for you and Harry to decide; do not copy the cycling prompts.

## Harry's working rules (they applied throughout The Way and he will expect them)

- Nothing goes to a live site without his explicit yes for that change; build on a preview first and show it working.
- Do not write test data to a live site.
- Ask before deleting anything of his.
- Times in 12-hour form in anything he reads.
- He works from his phone, often by dictation: read past transcription slips, keep answers short, and tell him plainly
  what was tested and what was not.

## First steps, in order

1. Add `canellakish-design/The-Way` to the session and read `tools/coach3d/README.md`, `build.py`, `finish.mjs`.
2. Ask Harry: club colours, crest or no crest, and the coach's look.
3. Find and licence-check the kit assets; run the three build steps; look at the result in a browser before showing
   him (a screenshot of the full figure and one of the face).
4. Copy the engine build (`entry.mjs`, `package.json`, `stubs/`) unchanged; it does not depend on the clothes.
5. Wire the stage, the voice and the conversation from `face.js`, `app.js` (`CoachVoice`) and `voice.js`.
