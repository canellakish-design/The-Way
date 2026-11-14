// coach3d — the coach as a real 3D figure (Harry, 14 Nov 2026: asked how to "make the coach more realistic", chose
// "a real 3D figure in the app"). A rigged human (pwa/avatar/coach.glb) drawn by three.js and animated by the
// TalkingHead library: it breathes, shifts its weight, blinks, looks at him, and while the coach speaks it gestures
// with its hands and its mouth forms the words.
// The voice is not played here. The Way plays it itself as media (an iPhone on silent mutes Web Audio; app.js
// CoachVoice), so this module only follows it: face.js hands over the words and, every frame, where the voice is
// (`state()`), and the mouth shapes are set straight on the face in step with that clock.
//   Coach3D.mount(el, { url, state })   → Promise; state() → { playing, t, dur, frac, level, env }
//                                         (env: the sound's loudness, 50 readings a second, when it is known)
//   Coach3D.say(text)                   the words about to be spoken
//   Coach3D.view('full' | 'upper')  Coach3D.thinking(on)  Coach3D.pause(on)  Coach3D.dispose()
import { TalkingHead } from '@met4citizen/talkinghead/modules/talkinghead.mjs';
import { LipsyncEn } from '@met4citizen/talkinghead/modules/lipsync-en.mjs';

const VIS = ['sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR', 'aa', 'E', 'I', 'O', 'U'];
const OPEN = { aa: 1, E: 0.8, I: 0.7, O: 0.9, U: 0.7 };          // the vowels: these open with the loudness
let head = null, getState = null, lip = null, line = null, lineKey = '', words = '', level = null, was = false, nextHands = 0, raf = 0;
const cur = Object.fromEntries(VIS.map(v => [v, 0]));

// The words as mouth shapes along a 0-to-1 line. Each word's shapes come from the library's English module; a
// pause stands at each comma and full stop. With the sound's loudness curve the spoken stretches are found, and the
// phrases are laid on them when they match one for one, so the mouth rests where the voice does.
function timeline(text, env, dur) {
  const clean = lip.preProcessText(String(text || ''));
  const phrases = clean.split(/(?<=[.!?,;:])\s+/).map(p => p.trim()).filter(Boolean);
  const built = phrases.map(p => {
    const items = []; let u = 0;
    for (const w of p.split(/\s+/)) {
      const word = w.replace(/[^A-Za-z']/g, ''); if (!word) continue;
      const o = lip.wordsToVisemes(word);
      for (let i = 0; i < o.visemes.length; i++) items.push({ v: o.visemes[i], a: u + o.times[i], b: u + o.times[i] + o.durations[i] });
      u += (o.times.length ? o.times[o.times.length - 1] + o.durations[o.durations.length - 1] : 1) + 0.6;
    }
    return { items, units: Math.max(u, 0.5), stop: /[.!?]$/.test(p) };
  }).filter(p => p.items.length);
  if (!built.length) return null;
  // spoken stretches of the sound: loudness above a floor, split at silences of 180 ms or more
  let segs = null;
  if (env && env.length > 10 && dur > 0) {
    const peak = Math.max(...env), floor = peak * 0.06, n = env.length, raw = []; let s = -1, gap = 0;
    for (let i = 0; i < n; i++) {
      if (env[i] > floor) { if (s < 0) s = i; gap = 0; }
      else if (s >= 0 && ++gap >= 9) { raw.push([s, i - gap + 1]); s = -1; gap = 0; }
    }
    if (s >= 0) raw.push([s, n]);
    const sec = raw.map(([a, b]) => [a / n * dur, b / n * dur]).filter(([a, b]) => b - a > 0.12);
    if (sec.length === built.length) segs = sec;
  }
  const total = built.reduce((a, p) => a + p.units + (p.stop ? 3 : 1.5), 0);
  const out = []; let u0 = 0;
  built.forEach((p, i) => {
    // this phrase's span, in seconds when the stretches matched, else as a share of the whole
    const a = segs ? segs[i][0] : u0 / total, b = segs ? segs[i][1] : (u0 + p.units) / total;
    for (const it of p.items) out.push({ v: it.v, a: a + (b - a) * it.a / p.units, b: a + (b - a) * it.b / p.units });
    u0 += p.units + (p.stop ? 3 : 1.5);
  });
  return { items: out, seconds: !!segs, i: 0 };
}
function shapeAt(st) {
  if (!line) return null;
  let x;
  if (line.seconds) { if (st.t == null) return null; x = st.t + 0.04; }                 // the mouth leads the sound a little
  else x = st.frac != null ? st.frac : st.dur > 0 && st.t != null ? st.t / st.dur : null;
  if (x == null) return null;
  const it = line.items; let i = line.i;
  if (i >= it.length || it[i].a > x) i = 0;
  while (i < it.length - 1 && it[i].b <= x) i++;
  line.i = i;
  return it[i].a <= x && x < it[i].b ? it[i].v : 'sil';
}
const setMT = (name, val) => { const m = head.mtAvatar[name]; if (m) Object.assign(m, { realtime: val, needsUpdate: true }); };

function update() {
  if (!head || !head.armature) return;
  const st = (getState && getState()) || {}, now = performance.now();
  level = st.playing ? Math.max(0, Math.min(1, st.level == null ? 0.5 : st.level)) : null;
  if (st.playing) {
    if (!was) { head.isSpeaking = true; head.stateName = 'speaking'; head.lookAtCamera(600); nextHands = now + 300; }
    if (now > nextHands) {                       // talks with its hands: mostly loose movement, now and then a clear gesture
      if (Math.random() < 0.22) head.playGesture(['side', 'index', 'handup', 'shrug'][Math.floor(Math.random() * 4)], 1.6 + Math.random(), Math.random() < 0.5, 700);
      else head.speakWithHands(0, 0.85);
      nextHands = now + 1700 + Math.random() * 2200;
    }
    // the words laid along the sound: built once the sound (its length and loudness) is known, again if it changes
    const key = words + '|' + (st.env ? st.env.length : 0) + '|' + Math.round((st.dur || 0) * 10);
    if (key !== lineKey) { lineKey = key; try { line = words && lip ? timeline(words, st.env || null, st.dur || 0) : null; } catch (e) { line = null; } }
    const v = shapeAt(st), quiet = level < 0.05;
    for (const k of VIS) {
      let to = 0;
      if (v && !quiet && k === v && k !== 'sil') to = OPEN[k] ? 0.25 + 0.6 * OPEN[k] * Math.min(1, 0.35 + level * 1.3) : (k === 'PP' || k === 'FF' ? 0.9 : 0.6);
      cur[k] += (to - cur[k]) * 0.45;
      setMT('viseme_' + k, cur[k] < 0.004 ? 0 : cur[k]);
    }
    // no words to go by (the phone's own voice with no word events): the jaw follows the loudness
    if (!v) setMT('viseme_aa', Math.min(0.7, level * 0.9));
  } else if (was) {
    head.isSpeaking = false; head.stateName = 'idle';
    for (const k of VIS) { cur[k] = 0; setMT('viseme_' + k, null); }
    head.resetLips(); line = null; lineKey = ''; words = '';
  }
  was = !!st.playing;
}

async function mount(el, o) {
  o = o || {};
  if (head) dispose();
  getState = o.state || null;
  head = new TalkingHead(el, {
    ttsEndpoint: 'none', lipsyncModules: [], lipsyncLang: 'en',
    cameraView: 'full', cameraRotateEnable: false, cameraPanEnable: false, cameraZoomEnable: false,
    cameraDistance: 1.0, cameraY: 0.38,
    modelPixelRatio: Math.min(2, window.devicePixelRatio || 1), modelFPS: 30,
    avatarMood: 'neutral', avatarIdleEyeContact: 0.45, avatarIdleHeadMove: 0.5, avatarSpeakingEyeContact: 0.75, avatarSpeakingHeadMove: 0.7,
    lightAmbientColor: 0xffffff, lightAmbientIntensity: 2, lightDirectColor: 0xaabbdd, lightDirectIntensity: 26,
    lightSpotColor: 0x5fd3ff, lightSpotIntensity: 28, lightSpotPhi: 0.9, lightSpotTheta: 4.3, lightSpotDispersion: 1.2
  });
  lip = new LipsyncEn(); head.lipsync.en = lip;
  // how hard the head moves while speaking follows the voice's loudness, which this page knows and the library's
  // own (silent) audio graph does not
  const an = head.audioAnalyzerNode;
  if (an && an.getByteFrequencyData) { const orig = an.getByteFrequencyData.bind(an); an.getByteFrequencyData = arr => { if (level != null) arr.fill(Math.round(level * 255)); else orig(arr); }; }
  await head.showAvatar(Object.assign({
    url: o.url || 'avatar/coach.glb', body: 'M', avatarMood: 'neutral', lipsyncLang: 'en',
    baseline: { headRotateX: -0.01, eyeBlinkLeft: 0.05, eyeBlinkRight: 0.05 }
  }, o.avatar || {}), o.onprogress || null);
  let warned = false;
  const loop = () => { raf = requestAnimationFrame(loop); try { update(); } catch (e) { if (!warned) { warned = true; console.error('coach3d update:', e && e.stack || e); } } };
  raf = requestAnimationFrame(loop);
  return head;
}
function say(text) { words = String(text || ''); lineKey = ''; }
// the whole figure stands above the subtitles; closer, his head and shoulders fill the stage
const VIEWS = { full: { cameraDistance: 1.0, cameraY: 0.38 }, upper: { cameraDistance: 0.25, cameraY: 0.22 } };
function view(name) { if (head && head.armature && VIEWS[name]) try { head.setView(name, VIEWS[name]); } catch (e) {} }
function thinking(on) { if (!head || !head.armature) return; try { if (on) head.lookAhead(1500); else head.lookAtCamera(600); } catch (e) {} }
function pause(on) { if (!head || !head.armature) return; try { if (on) { if (head.isRunning) head.stop(); } else if (!head.isRunning) head.start(); } catch (e) {} }
function dispose() { cancelAnimationFrame(raf); raf = 0; try { head && head.dispose && head.dispose(); } catch (e) {} head = null; line = null; was = false; }
window.Coach3D = { mount, say, view, thinking, pause, dispose, get head() { return head; } };
window.dispatchEvent(new Event('coach3d-ready'));
