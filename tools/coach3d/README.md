# The 3D coach

`pwa/coach3d.js` and `pwa/avatar/coach.glb` are built here; the site itself has no build step.

## The engine (`pwa/coach3d.js`)

three.js 0.186 (MIT) and TalkingHead 1.8.2 by Mika Suominen (MIT), bundled by esbuild from `entry.mjs`:

    npm install
    npm run build

## The figure (`pwa/avatar/coach.glb`)

A man in a suit, tanned, thick black glasses, a beard (Harry, 14 Nov 2026). Built by `build.py` in Blender 5.3
(`pip install bpy==5.3.0`) with the MPFB 2.0.18 extension, from MakeHuman assets that are all CC0 (public domain):

- body, skin (middleage_caucasian_male), eyes, eyebrows, eyelashes, teeth, tongue, hair (short04), suit
  (male_elegantsuit01) and shoes (shoes03): the "MakeHuman system assets" pack
- beard (wdg_scruffy_beard, by WDG): the "bodyparts05" pack
- glasses (spamrakuen_tbm_glasses_frames_01): the "glasses01" pack
- mouth shapes and face units: the "visemes02" and "faceunits01" functional packs
- skeleton and weights: the TalkingHead rig (`talkinghead.mpfbskel`, `talkinghead.mhw`; CC0) from
  https://github.com/met4citizen/TalkingHead/tree/main/blender/MPFB

Packs: https://static.makehumancommunity.org/assets/assetpacks.html (unzip each into MPFB's user data folder; the rig
goes in `<user data>/rigs/talkinghead.json` with `"identifying_bones": ["LeftToe_End"]` added, its weights beside it as
`weights.talkinghead.json`; `talkinghead-addon.py` from the same TalkingHead folder goes in `avatar-src/`).

    python build.py -- avatar-src/raw.glb          # Blender: body, clothes, rig, face shapes, export
    node finish.mjs avatar-src/raw.glb avatar-src/coach.glb   # materials, the tan, the black frames
    npm run avatar                                  # compress → ../../pwa/avatar/coach.glb

To change how he looks, edit the choices near the top of `build.py` (age, build, hair, clothes) or the colours in
`finish.mjs`, and run the three steps again.
