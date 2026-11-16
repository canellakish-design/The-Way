"use strict";
/* THE WAY — the microphone: the training and nutrition advisor, as a conversation.
   Hold the button and talk; let go and it answers, out loud and in the
   thread. Hold again to answer back: "yes, do that", "the second one",
   "make it an hour instead". The bridge (bridge/voice.js) carries the last
   turns with each new one, logs or changes what was asked through the same
   functions the buttons use, and answers in a sentence.
   The phone turns speech into text (Web Speech, built into Safari and
   Chrome). No speech support, or a tablet that will not listen: the same
   sheet takes typing, and the keyboard's own microphone key dictates into
   it. A short tap on the round button opens or closes the thread.
   Loads after app.js and uses its globals: bridge, esc, speak, nav.
   14 Nov 2026 ("combine all of these coach features"): the conversation lives on the Coach page, under the
   coach's face (coach.js mounts it there: voiceBits.mount). A tap on the round button goes to that page; a hold
   talks from anywhere, and the answer is there. The page's own copies of the thread, the heard words, the status
   and Hey Coach (ids p_vThread, p_vHeard, p_vStatus, p_vHold, p_vHey) stand in for the old sheet's. */
(function(){

const J = {"Content-Type":"application/json"};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const HOLD_MS = 280;                 // shorter than this is a tap, not a hold
let rec = null, listening = false, finalText = "", sending = false;
// the thread: what he said and what was answered, kept for the session
let history = [];
try{ history = JSON.parse(sessionStorage.getItem("way-voice-thread") || "[]"); }catch{ history = []; }
const keep = ()=>{ try{ const h = history.slice(-20), has = x => x.img || (x.imgs && x.imgs.length), withImg = h.filter(has).slice(-4); sessionStorage.setItem("way-voice-thread", JSON.stringify(h.map(x => has(x) && !withImg.includes(x) ? Object.assign({}, x, { img: null, imgs: null }) : x))); }catch{} };

const onCoach = () => location.hash.replace(/^#/, "").split("?")[0] === "coach";
const $ = id => (onCoach() && document.getElementById("p_" + id)) || document.getElementById(id);
function sheet(){
  let s = document.getElementById("voiceSheet");
  if (s) return s;
  s = document.createElement("div"); s.id = "voiceSheet"; s.hidden = true;
  s.innerHTML = `<div class="vbox">
    <div class="vhead"><span class="eyebrow">Coach</span><span class="vlinks">${SR ? `<button class="linkish" id="vHey">Hey Coach: off</button>` : ""}<button class="linkish" id="vFace">face</button><button class="linkish" id="vNew">new conversation</button><button class="vx" id="vClose" aria-label="Close">×</button></span></div>
    <div class="vthread" id="vThread"></div>
    <div class="vheard" id="vHeard"></div>
    <div class="vrow">${SR ? `<button class="primary big vhold" id="vHold">Hold to talk</button>` : ""}<button class="big" id="vType">Type</button></div>
    <div id="vTypeBox" hidden><textarea id="vText" rows="2" placeholder="${SR ? "Or type it here" : "Type here, or use the keyboard's microphone key"}"></textarea>
      <div class="vrow"><button class="primary" id="vSend">Send</button></div></div>
    <div class="small" id="vStatus"></div>
  </div>`;
  document.body.appendChild(s);
  document.getElementById("vClose").onclick = close;
  const hb = document.getElementById("vHey"); if (hb) hb.onclick = ()=> setHey(!heyOn);
  drawHey();
  // the coach's face (face.js): opens and gives the briefing, where you are, what to adjust, what comes next
  document.getElementById("vFace").onclick = ()=>{ close(); if (window.Face) Face.briefing(); };
  document.getElementById("vNew").onclick = ()=>{ history = []; keep(); drawThread(); status("New conversation."); };
  document.getElementById("vSend").onclick = ()=>{ if (window.primeSound) primeSound(); send(document.getElementById("vText").value.trim()); };
  document.getElementById("vType").onclick = ()=>{ const b = document.getElementById("vTypeBox"); b.hidden = !b.hidden; if (!b.hidden) document.getElementById("vText").focus(); };
  const hold = document.getElementById("vHold");
  if (hold) wireHold(hold);
  s.addEventListener("click", e => { if (e.target === s) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !s.hidden) close(); });
  drawThread();
  return s;
}

// a way out of the page that came with an action: directions to where a route starts, the route's own page
// the lines an action carries: a week laid out, day by day (the coach's planner)
const actLines = a => Array.isArray(a.lines) && a.lines.length ? `<ul class="vlines">${a.lines.slice(0, 20).map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
const actLinks = a => [a.link, a.link2].filter(l => l && /^https:\/\//.test(l.href || "")).map(l => ` <a class="vlink" href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label || "Open")}</a>`).join("");
function status(t){ const el = $("vStatus"); if (el) el.textContent = t || ""; }
const msgHTML = h => `<div class="vmsg ${h.role}">${(h.imgs || (h.img ? [h.img] : [])).length ? `<div class="vphotos">${(h.imgs || [h.img]).map(s => `<img class="vphoto" src="${s}" alt="a photo you sent">`).join("")}</div>` : ""}${h.role === "assistant" && h.actions && h.actions.length ? `<ul class="vacts">${h.actions.map(a => `<li>${a.ok ? "✓" : "✗"} ${esc(a.summary)}${actLinks(a)}${actLines(a)}</li>`).join("")}</ul>` : ""}<div>${esc(h.text)}</div>${h.offer && h === history[history.length - 1] ? `<div class="voffer"><button class="primary" data-offer-yes>${esc(h.offer.label || "Yes, change it")}</button><button data-offer-no>No</button></div>` : ""}</div>`;
// the coach offered a change: Yes sends back exactly what he proposed, and he makes it; No leaves it
function wireOffer(el){
  const last = history[history.length - 1]; if (!el || !last || !last.offer) return;
  const y = el.querySelector("[data-offer-yes]"), n = el.querySelector("[data-offer-no]"), plan = last.offer.plan;
  if (y) y.onclick = () => { if (window.primeSound) try{ primeSound(); }catch{} last.offer = null; keep(); send("Yes. Do it: " + plan); };
  if (n) n.onclick = () => { last.offer = null; keep(); drawThread(); status("Left as it is."); setTimeout(() => status(""), 2500); };
}
function drawThread(){
  const el = $("vThread"); if (!el) return;
  // the Coach page (14 Nov 2026: "Is there a way to clean this page up?"): the latest exchange under the box, what
  // came before folded away
  if (onCoach()) {
    const all = history.slice(-20); let cut = all.length - 1; while (cut > 0 && all[cut].role !== "user") cut--;
    const last = all.slice(Math.max(0, cut)), before = all.slice(0, Math.max(0, cut));
    el.innerHTML = (last.length ? last.map(msgHTML).join("") : `<div class="small ch-hint">Hold the button and talk, or type. The coach answers out loud and can log or change things for you.</div>`)
      + (before.length ? `<details class="why ch-fold vearlier"><summary>earlier · ${before.filter(h => h.role === "user").length}</summary><div class="vthread">${before.map(msgHTML).join("")}</div></details>` : "");
    wireOffer(el);
    return;
  }
  el.innerHTML = history.slice(-12).map(h => `<div class="vmsg ${h.role}">${h.role === "assistant" && h.actions ? `<ul class="vacts">${h.actions.map(a => `<li>${a.ok ? "✓" : "✗"} ${esc(a.summary)}${actLinks(a)}${actLines(a)}</li>`).join("")}</ul>` : ""}<div>${esc(h.text)}</div></div>`).join("")
    || `<div class="small">${onCoach() ? "Ask below, type or hold to talk. The coach answers out loud and can log or change things for you." : `Hold to talk. Or turn on Hey Coach and start with "Coach".`}</div>`;
  el.scrollTop = el.scrollHeight;
}
// the conversation is on the Coach page: going there is opening it
function open(){ if (!onCoach()) location.hash = "#coach"; else drawThread(); }
function close(){ abortListening(); const s = document.getElementById("voiceSheet"); if (s) s.hidden = true; }
function setMic(on){ const b = document.getElementById("micBtn"); if (b) b.classList.toggle("live", on); for (const h of [document.getElementById("vHold"), document.getElementById("p_vHold")]) if (h){ h.classList.toggle("live", on); h.textContent = on ? "Listening… let go to send" : "Hold to talk"; } }

/* ---- push to talk ----
   One recogniser for the page, reused. Safari refuses a second start()
   while the first session is still closing ("already started"), and that is
   exactly when a second hold arrives: a hold that lands while the last
   session is still ending waits for it and starts the moment it is free. */
let state = "idle";            // idle | starting | listening | stopping
let wantListen = false, discard = false, holding = false;
// The phone's recogniser does not always answer (Harry, 15 Nov 2026: "the listen button is kind of glitchy … it
// sometimes freezes the page"). Three ways it went wrong, each now caught:
//   it never starts, or never ends after a stop: the button waited on it for ever. A watch gives it a few seconds,
//     then drops that recogniser, makes a fresh one next time, and sends what was heard;
//   it ends the instant it starts, again and again: it was started again every 60 ms, forty times. A session that
//     dies at once is waited on longer each time, and after five it stops and says so;
//   it is started in the same breath the coach's voice is cut off: the phone is still changing from playing to
//     listening. A quarter second is left between the two.
let recAt = 0, recQuick = 0, recWatch = 0;
const dropRec = () => { const r = rec; rec = null; clearTimeout(recWatch); if (r){ r.onstart = r.onresult = r.onerror = r.onend = null; try{ r.abort(); }catch{} } };
const watchRec = (ms, fn) => { clearTimeout(recWatch); recWatch = setTimeout(fn, ms); };
const VOICE_GAP = 250;   // between stopping his voice and opening the microphone
function ensureRec(){
  if (rec) return rec;
  rec = new SR();
  rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
  rec.onstart = ()=>{ state = "listening"; listening = true; recAt = Date.now(); clearTimeout(recWatch); setMic(true); status(""); };
  rec.onresult = (e)=>{
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++){ const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript; }
    lastInterim = interim;
    const heard = $("vHeard"); if (heard) heard.textContent = (carry + " " + finalText + interim).trim();
  };
  rec.onerror = (e)=>{
    const k = e.error;
    if (k === "aborted") return;                       // ours, on purpose
    if (k === "not-allowed" || k === "service-not-allowed" || k === "audio-capture") fatal = true;
    if (k === "no-speech" && holding) return;          // a pause while he holds: it keeps listening
    status(k === "not-allowed" || k === "service-not-allowed" ? "Microphone blocked. Settings → Safari → Microphone → Allow for this site, or type."
         : k === "audio-capture" ? "No microphone found. Type instead."
         : k === "no-speech" ? "Heard nothing. Hold the button and speak." : "Speech failed (" + k + "). Type it instead.");
  };
  // The phone ends a listening session by itself at a pause, or after a while. While he is still holding the button
  // that is not the end of what he is saying (Harry, 14 Nov 2026: "my sentences keep getting cut off … on the Hold
  // to talk"): what was heard is kept and listening starts again at once. Only letting go sends it, all of it.
  rec.onend = ()=>{
    state = "idle"; listening = false; clearTimeout(recWatch);
    const got = (finalText + lastInterim).trim(); finalText = ""; lastInterim = "";
    recQuick = !got && Date.now() - recAt < 700 ? recQuick + 1 : 0;   // a session that died at once, with nothing heard
    const toss = discard; discard = false;
    if (toss) { carry = ""; setMic(false); if (wantListen && holding) startListening(); else heyResume(); return; }
    carry = (carry + " " + got).trim();
    if (holding && wantListen && !fatal && restarts < 40 && recQuick < 5) { restarts++; setTimeout(resume, recQuick ? Math.min(1200, 120 * 2 ** recQuick) : 60); return; }
    if (recQuick >= 5 && holding) { recQuick = 0; dropRec(); if (!carry.trim()) { setMic(false); status("The microphone keeps closing by itself. Let go, wait a second and hold again, or type."); heyResume(); return; } }
    finish();
  };
  return rec;
}
let carry = "", lastInterim = "", restarts = 0, fatal = false;
// still holding: the next session, keeping what was heard so far
function resume(){
  if (!holding || !wantListen) { if (state === "idle" && carry) finish(); return; }
  if (state !== "idle") return;
  state = "starting"; recAt = Date.now();
  try{ ensureRec().start(); watchRec(4000, startTimedOut); }
  catch(err){ state = "idle"; if (/InvalidState|already/i.test(String(err && err.message))) { try{ rec.stop(); }catch{} watchRec(1500, () => { if (state === "idle" && holding && wantListen) { dropRec(); resume(); } }); return; } finish(); }
}
// the microphone was asked for and nothing came back: that recogniser is dropped, what was heard so far is sent
function startTimedOut(){
  if (state !== "starting") return;
  dropRec(); state = "idle"; listening = false;
  if (carry.trim()) { finish(); return; }
  setMic(false); status("The microphone did not start. Hold the button again, or type."); heyResume();
}
// he let go: send everything heard during the hold
function finish(){
  setMic(false);
  const heard = $("vHeard"), t = carry.trim(); carry = "";
  // let go after a word or two that ends mid-thought ("I am"): nothing to answer, so it is not sent
  const words = t.split(/\s+/).filter(Boolean), cutOff = words.length && words.length <= 3 && /^(i|i'm|im|am|is|are|was|the|a|an|to|for|and|my|of|in|at|on|with|have|had|will|can|do|so|but|what|how|that|it|it's)$/i.test(words[words.length - 1].replace(/[.,!?]+$/, ""));
  if (t && cutOff) { if (heard) heard.textContent = ""; status(`Only caught "${t}". Keep holding until you finish, then let go.`); }
  else if (t) send(t);
  else if (!fatal) status("Heard nothing. Hold the button and speak.");
  heyResume();
}
function startListening(){
  if (!SR) return;
  warm();
  heyPause();
  wantListen = true;
  if (state !== "idle") return;                        // starting or still ending: onend picks it up
  const speaking = !!(window.coachSpeaking && coachSpeaking()) || (window.speechSynthesis && speechSynthesis.speaking);
  try{ speechSynthesis.cancel(); if (window.CoachVoice) CoachVoice.stop(); }catch{}
  finalText = ""; lastInterim = ""; carry = ""; restarts = 0; fatal = false; discard = false; recQuick = 0;
  const heard = $("vHeard"); if (heard) heard.textContent = "";
  state = "starting"; recAt = Date.now();
  const go = ()=>{
    if (state !== "starting") return;                  // let go, or dropped, in the gap
    try{ ensureRec().start(); watchRec(4000, startTimedOut); }
    catch(err){
      state = "idle";
      if (/InvalidState|already/i.test(String(err && err.message))){ try{ rec.stop(); }catch{}   // its onend will start us; if it never comes, a fresh one does
        watchRec(1500, () => { if (state === "idle" && holding && wantListen) { dropRec(); startListening(); } }); return; }
      dropRec(); status("Could not start the microphone: " + err.message);
    }
  };
  if (speaking) setTimeout(go, VOICE_GAP); else go();
}
// Letting go: the microphone stays open a moment longer, so the last word, still being worked out, is not lost.
function stopListening(){
  wantListen = false;
  if (state === "listening" || state === "starting"){
    state = "stopping";
    setTimeout(()=>{ if (state !== "stopping") return; try{ rec.stop(); }catch{ state = "idle"; finish(); return; }
      // the end that should follow a stop did not come: take what was heard and let the button go
      watchRec(2500, () => { if (state !== "stopping") return; const got = (finalText + lastInterim).trim(); finalText = ""; lastInterim = ""; carry = (carry + " " + got).trim(); dropRec(); state = "idle"; listening = false; finish(); });
    }, 400);
  }
  else if (state === "idle") finish();                 // between two sessions: nothing is running, send what is kept
}
function abortListening(){
  wantListen = false; discard = true; carry = "";
  if (state !== "idle"){ state = "stopping"; try{ rec.abort(); }catch{ state = "idle"; }
    if (state === "stopping") watchRec(1500, () => { if (state !== "stopping") return; dropRec(); state = "idle"; listening = false; discard = false; carry = ""; setMic(false); heyResume(); }); }
}

// hold = talk; a quick tap toggles the sheet
function wireHold(el, onTap){
  let downAt = 0, mine = false;
  const down = (e)=>{ if (talk.on) return; if (sending) { status("Still working on the last one…"); return; } e.preventDefault(); downAt = Date.now(); mine = true; holding = true; try{ el.setPointerCapture(e.pointerId); }catch{} if (window.primeSound) primeSound(); startListening(); };
  const up = (e)=>{
    if (!mine) return; mine = false; holding = false; e.preventDefault();
    const quick = Date.now() - downAt < HOLD_MS;
    if (quick){ abortListening(); if (onTap) onTap(); return; }
    stopListening();
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up); el.addEventListener("pointerleave", (e)=>{ if (holding) up(e); });
  // a plain mouse click, when no pointer event handled it (a desktop browser without pointer events, or one that swallowed them)
  let lastPointer = 0; const stamp = ()=>{ lastPointer = Date.now(); }; el.addEventListener("pointerup", stamp); el.addEventListener("pointerdown", stamp);
  el.addEventListener("click", ()=>{ if (Date.now() - lastPointer > 400 && onTap) onTap(); });
  el.addEventListener("contextmenu", e => e.preventDefault());
}

// where he is, when the site already has permission: no prompt, three seconds at most, else nothing
// The coach reads the whole day before he answers, about five seconds of every wait. Asked for ahead of the question
// (as the Coach page opens, as the talk button goes down, as a conversation starts, while he is speaking his answer),
// it is ready by the time the words arrive. At most once every 25 seconds.
let warmAt = 0;
function warm(){ if (Date.now() - warmAt < 25000) return; warmAt = Date.now(); try{ bridge("/voice/warm").catch(()=>{}); }catch{} }
// kept for five minutes: a follow-up question does not wait on the phone's location again
let whereKept = null;
async function whereAmI(){
  if (whereKept && Date.now() - whereKept.at < 300000) return whereKept.coords;
  const c = await whereNow(); whereKept = { at: Date.now(), coords: c }; return c;
}
async function whereNow(){
  try{
    if (!navigator.geolocation) return null;
    if (navigator.permissions && navigator.permissions.query){ const st = await navigator.permissions.query({ name: "geolocation" }); if (st.state !== "granted") return null; }
    return await new Promise(res => { const t = setTimeout(() => res(null), 1500); navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); res({ lat: p.coords.latitude, lon: p.coords.longitude }); }, () => { clearTimeout(t); res(null); }, { maximumAge: 300000, timeout: 2800 }); });
  }catch{ return null; }
}
window.whereAmI = whereAmI;
// photo: { image_base64, media_type, thumb }, or up to four of them, from the Coach page's Photo button (coach.js);
// the coach looks at them together
async function send(text, photo, opts){
  const photos = (Array.isArray(photo) ? photo : photo ? [photo] : []).slice(0, 4); photo = photos[0] || null;
  if (!text && !photo) { status("Nothing to send."); return; }
  if (sending) return;
  sending = true;
  open();
  const heard = $("vHeard"); if (heard) heard.textContent = "";
  const typed = $("vText"); if (typed) typed.value = "";
  history.push({ role: "user", text: text || (photos.length > 1 ? photos.length + " photos" : photo ? "Photo" : ""), imgs: photos.map(p => p.thumb).filter(Boolean) }); keep(); drawThread();
  status(photos.length > 1 ? "Looking at the photos…" : photo ? "Looking at the photo…" : "Thinking…");
  try{
    const coords = await whereAmI();
    const r = await bridge("/voice", { method:"POST", headers:J, body: JSON.stringify({ text: text || "", images: photos.length ? photos.map(p => ({ image_base64: p.image_base64, media_type: p.media_type })) : undefined, talk: opts && opts.talk ? true : undefined, coords, ride: (window.__player && window.__player.live && window.__player.live()) || undefined, history: history.slice(0, -1).slice(-10).map(h => ({ role: h.role, text: h.text })) }) });
    history.push({ role: "assistant", text: r.reply || "", actions: (r.actions||[]).filter(a => a.type !== "question"), offer: r.offer && r.offer.plan ? r.offer : null }); keep(); drawThread();
    status("");
    if (r.reply && typeof speak === "function") speak(r.reply);
    if (r.reply && window.Face && Face.caption) Face.caption(r.reply);   // under the face, as it is said
    const cheer = (r.actions||[]).find(a => a.celebrate);
    if (cheer && typeof celebrate === "function") celebrate({ slot: cheer.slot || null });
    if ((r.actions||[]).some(a => a.ok && a.type !== "question")) { try{ nav(); }catch{} }
    // "open the player": the coach names the ride and the page goes to it (voice.js bridge: the player action)
    { const go = (r.actions||[]).find(a => a.ok && typeof a.open === "string" && /^#[a-z]+/.test(a.open)); if (go) setTimeout(() => { location.hash = go.open; }, 1400); }
  }catch(e){ status(e.message); history.pop(); keep(); drawThread(); }
  sending = false;
}

/* ---- Hey Coach ----
   Hands-free while The Way is open (on the Zwift screen, propped up in the gym): it listens all the time
   and acts only on a sentence that starts with "Coach" ("Coach, log a gel", "coach how long is left").
   "Coach" alone answers "Yes?" and takes the next sentence. The answer is spoken (into the Shokz) and
   shown for a few seconds at the bottom; nothing opens over the page. Its own recogniser, paused while
   the round button is held and while it is speaking, restarted when Safari ends a session. A web page
   cannot listen with the screen locked or the app closed: Siri's "Ask my coach" covers that. */
let heyOn = false, heyRec = null, heyPaused = false, heyArmedUntil = 0;
try{ heyOn = localStorage.getItem("way-hey") === "1"; }catch{}
const WAKE = /^\s*(?:hey|ok|okay)?\s*coach\b[\s,.:!?-]*(.*)$/i;
function drawHey(){
  for (const hb of [document.getElementById("vHey"), document.getElementById("p_vHey")]) if (hb) hb.textContent = "Hey Coach: " + (heyOn ? "on" : "off");
  const m = document.getElementById("micBtn"); if (m) m.classList.toggle("hey", heyOn);
}
function toast(t){
  let el = document.getElementById("heyToast");
  if (!el){ el = document.createElement("div"); el.id = "heyToast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = t; el.hidden = !t; clearTimeout(el.__t); if (t) el.__t = setTimeout(() => { el.hidden = true; }, 9000);
}
const ttsBusy = () => { try{ return typeof __ttsSpeaking !== "undefined" && __ttsSpeaking; }catch{ return false; } };
async function heyAsk(text){
  if (sending) return;
  sending = true; heyPause(); toast("…");
  history.push({ role: "user", text }); keep(); drawThread();
  try{
    const r = await bridge("/voice", { method:"POST", headers:J, body: JSON.stringify({ text, ride: (window.__player && window.__player.live && window.__player.live()) || undefined, history: history.slice(0, -1).slice(-10).map(h => ({ role: h.role, text: h.text })) }) });
    history.push({ role: "assistant", text: r.reply || "", actions: (r.actions||[]).filter(a => a.type !== "question") }); keep(); drawThread();
    toast(r.reply || "Done.");
    if (r.reply && typeof speak === "function") speak(r.reply);
    if ((r.actions||[]).some(a => a.ok && a.type !== "question")) { try{ nav(); }catch{} }
  }catch(e){ toast(String(e.message).replace(/^bridge \d+ — /, "")); history.pop(); keep(); }
  sending = false;
  setTimeout(heyResume, 400);
}
function heyHeard(t){
  if (ttsBusy()) return;                                   // the coach's own voice, not him
  const m = WAKE.exec(t);
  if (m && m[1].trim()) { heyArmedUntil = 0; heyAsk(m[1].trim()); return; }
  if (m) { heyArmedUntil = Date.now() + 8000; toast("Yes?"); if (typeof speak === "function") speak("Yes?"); return; }
  if (Date.now() < heyArmedUntil && t.trim()) { heyArmedUntil = 0; heyAsk(t.trim()); }
}
let heyQuick = 0;
function heyStart(){
  if (!SR || !heyOn || heyPaused || heyRec || document.hidden) return;
  try{
    heyRec = new SR(); heyRec.lang = "en-US"; heyRec.continuous = true; heyRec.interimResults = false; heyRec.maxAlternatives = 1;
    heyRec.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heyHeard(e.results[i][0].transcript); };
    heyRec.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed"){ setHey(false); toast("Microphone blocked: allow it for The Way, then turn Hey Coach on again."); } };
    // a session that ends the moment it starts (the microphone is taken, the phone says no) is tried again more and
    // more slowly, up to half a minute apart: it used to be tried again every 300 ms for as long as the page was open
    const at = Date.now();
    heyRec.onend = () => { heyRec = null; heyQuick = Date.now() - at < 1000 ? Math.min(heyQuick + 1, 7) : 0; if (heyOn && !heyPaused) setTimeout(heyStart, heyQuick ? Math.min(30000, 300 * 2 ** heyQuick) : 300); };
    heyRec.start();
  }catch{ heyRec = null; heyQuick = Math.min(heyQuick + 1, 7); setTimeout(heyStart, Math.min(30000, 1500 * heyQuick)); }
}
function heyStop(){ const r = heyRec; heyRec = null; if (r){ r.onend = null; try{ r.abort(); }catch{} } }
function heyPause(){ heyPaused = true; heyStop(); }
function heyResume(){ if (talk.on) return; heyPaused = false; if (heyOn && !ttsBusy()) heyStart(); else if (heyOn) setTimeout(heyResume, 700); }
function setHey(on){
  heyOn = !!on; try{ localStorage.setItem("way-hey", heyOn ? "1" : "0"); }catch{}
  drawHey();
  if (heyOn){ heyPaused = false; heyStart(); toast("Hey Coach is listening. Start with \"Coach\"."); } else { heyStop(); toast("Hey Coach off."); }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) heyStop(); else if (heyOn && !heyPaused) heyStart(); });

/* ---- the open conversation ----
   (Harry, 14 Nov 2026: "the kind of open back and forth conversation isn't working".) One tap starts it. He talks; when
   he stops for a little over a second it is sent; the coach answers out loud; the moment the voice has finished it is
   listening again. No button between turns and no "Coach" at the start of each sentence. It ends when he taps End,
   says "that's all", leaves the page, or after ninety quiet seconds.
   The microphone is closed while the coach thinks and speaks, so he never answers his own voice; a tap on the button
   while he is speaking cuts him off and listens. Its own recogniser (the hold button and Hey Coach are paused). */
const TALK_GAP = 1200, TALK_GAP_OPEN = 2400, TALK_QUIET = 90000;
const TALK_END = /^\s*(?:ok(?:ay)?[, ]*)?(?:that'?s (?:all|it)|we'?re done|i'?m done|end (?:the )?conversation|stop listening|good ?bye|bye(?: coach)?|thanks?(?: you)?[, ]*(?:coach|that'?s all|bye)?)[\s.!]*$/i;
const talk = { on: false, phase: "off", rec: null, buf: "", interim: "", gapT: 0, quietT: 0, waitT: 0, fails: 0, at: 0, quick: 0, watchT: 0, againT: 0 };
const talkBtns = () => [document.getElementById("p_vTalk")].filter(Boolean);
function drawTalk(){
  const label = !talk.on ? "Start conversation" : talk.phase === "speaking" ? "Tap to interrupt" : talk.phase === "thinking" ? "Thinking…" : "Listening… just talk";
  for (const b of talkBtns()) { b.textContent = label; b.classList.toggle("on", talk.on); b.classList.toggle("live", talk.on && talk.phase === "listening"); }
  const end = document.getElementById("p_vTalkEnd"); if (end) end.hidden = !talk.on;
  const hold = document.getElementById("p_vHold"); if (hold) hold.hidden = talk.on;
  const m = document.getElementById("micBtn"); if (m) m.classList.toggle("talk", talk.on);
}
function talkHeard(){ const el = $("vHeard"); if (el) el.textContent = (talk.buf + " " + talk.interim).trim(); }
function talkQuiet(){ clearTimeout(talk.quietT); if (talk.on) talk.quietT = setTimeout(() => { if (talk.on && talk.phase === "listening" && !(talk.buf + talk.interim).trim()) talkStop("Conversation ended after a quiet minute and a half. Tap to start again."); }, TALK_QUIET); }
function talkCloseRec(){ const r = talk.rec; talk.rec = null; clearTimeout(talk.watchT); clearTimeout(talk.againT); if (r){ r.onend = null; r.onresult = null; r.onerror = null; try{ r.abort(); }catch{} } }
function talkListen(){
  if (!talk.on || talk.rec) return;
  if (sending || (window.coachSpeaking && coachSpeaking())) { clearTimeout(talk.waitT); talk.waitT = setTimeout(talkListen, 300); return; }
  talk.phase = "listening"; drawTalk();
  try{
    const r = talk.rec = new SR(); r.lang = "en-US"; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => { talk.fails = 0; talk.at = Date.now(); clearTimeout(talk.watchT); status(""); };
    r.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++){ const x = e.results[i]; if (x.isFinal) talk.buf += x[0].transcript + " "; else interim += x[0].transcript; }
      talk.interim = interim; talkHeard(); talkQuiet();
      // he has stopped: a second and a half after the last word, longer when the sentence plainly is not finished
      const t = (talk.buf + " " + talk.interim).trim(); clearTimeout(talk.gapT);
      if (t) { const open = /\b(and|but|or|so|because|the|a|an|to|for|with|my|i|i'm|is|are|was|of|in|on|at|if|that|what|how)$/i.test(t.replace(/[.,!?]+$/, "")); talk.gapT = setTimeout(talkFlush, open ? TALK_GAP_OPEN : TALK_GAP); }
    };
    r.onerror = e => { const k = e.error;
      if (k === "not-allowed" || k === "service-not-allowed") talkStop("Microphone blocked. Settings → Safari → Microphone → Allow for this site.");
      else if (k === "audio-capture") talkStop("No microphone found."); };
    // the phone ends a session by itself at a pause or after a while: what was heard is kept, and it listens on
    r.onend = () => { if (talk.rec !== r) return; talk.rec = null; clearTimeout(talk.watchT); if (!talk.on || talk.phase !== "listening") return;
      const heard = (talk.buf + talk.interim).trim();
      if (heard) { clearTimeout(talk.gapT); talk.gapT = setTimeout(talkFlush, 500); }
      // a session that died at once with nothing heard: wait longer each time, and after six stop and say so (it used
      // to be opened again every quarter second, for ever)
      talk.quick = !heard && Date.now() - talk.at < 900 ? talk.quick + 1 : 0;
      if (talk.quick >= 6) { talkStop("The microphone keeps closing by itself. Tap Start conversation to try again."); return; }
      clearTimeout(talk.againT); talk.againT = setTimeout(talkListen, talk.quick ? Math.min(3000, 250 * 2 ** talk.quick) : 250); };
    talk.at = Date.now();
    r.start();
    // asked for and never started: that one is dropped and a fresh one tried
    clearTimeout(talk.watchT); talk.watchT = setTimeout(() => { if (talk.rec !== r || !talk.on) return; talkCloseRec(); if (++talk.fails > 3) { talkStop("The microphone would not start. Tap Start conversation again."); return; } talk.againT = setTimeout(talkListen, 600); }, 4500);
  }catch(err){
    talk.rec = null;
    if (++talk.fails > 4) { talkStop("The microphone would not start. Tap Start conversation again."); return; }
    clearTimeout(talk.againT); talk.againT = setTimeout(talkListen, 600);
  }
}
async function talkFlush(){
  clearTimeout(talk.gapT);
  if (!talk.on || talk.phase !== "listening") return;
  const t = (talk.buf + " " + talk.interim).replace(/\s+/g, " ").trim(); talk.buf = ""; talk.interim = "";
  if (!t) return;
  if (TALK_END.test(t) && t.split(" ").length <= 6) { talkStop("Conversation ended."); if (typeof speak === "function") speak("Talk soon."); return; }
  talk.phase = "thinking"; talkCloseRec(); drawTalk(); clearTimeout(talk.quietT);
  await send(t, undefined, { talk: true });
  if (!talk.on) return;
  // his answer is being spoken (or fetched to be spoken): listen again the moment it is out
  talk.phase = "speaking"; drawTalk(); warm();
  const t0 = Date.now(); let clear = 0;
  const wait = () => { if (!talk.on || talk.phase !== "speaking") return;
    const busy = window.coachSpeaking ? coachSpeaking() : false; clear = busy ? 0 : clear + 1;
    if ((clear >= 2 && Date.now() - t0 > 500) || Date.now() - t0 > 90000) { talk.phase = "listening"; const el = $("vHeard"); if (el) el.textContent = ""; talkQuiet(); talkListen(); return; }
    talk.waitT = setTimeout(wait, 250); };
  wait();
}
// a tap on the button while he is talking: cut him off and listen
function talkInterrupt(){
  try{ speechSynthesis.cancel(); if (window.CoachVoice) CoachVoice.stop(); }catch{}
  // his voice is cut off first, and the microphone opened a moment later (not in the same breath)
  clearTimeout(talk.waitT); talk.phase = "listening"; talkQuiet(); drawTalk(); talk.waitT = setTimeout(talkListen, VOICE_GAP + 50);
}
function talkStart(){
  if (!SR) { status("This browser cannot listen. Type instead."); return; }
  if (talk.on) return;
  if (!onCoach()) { talk.pending = true; location.hash = "#coach"; return; }
  talk.on = true; talk.buf = ""; talk.interim = ""; talk.fails = 0; talk.quick = 0; talk.pending = false;
  heyPause(); abortListening();
  const speaking = !!(window.coachSpeaking && coachSpeaking()) || (window.speechSynthesis && speechSynthesis.speaking) || state !== "idle";
  try{ speechSynthesis.cancel(); if (window.CoachVoice) CoachVoice.stop(); }catch{}
  warm(); whereAmI();
  status("Listening. Just talk; I answer when you pause."); talkQuiet(); drawTalk();
  if (speaking) { talk.phase = "listening"; drawTalk(); talk.waitT = setTimeout(talkListen, VOICE_GAP + 50); } else talkListen();
}
function talkStop(why){
  const was = talk.on; talk.on = false; talk.phase = "off"; talk.pending = false;
  clearTimeout(talk.gapT); clearTimeout(talk.quietT); clearTimeout(talk.waitT); clearTimeout(talk.againT); talkCloseRec(); talk.buf = ""; talk.interim = "";
  const el = $("vHeard"); if (el) el.textContent = "";
  drawTalk(); if (was) { status(why || "Conversation ended."); heyResume(); }
}
// on: true starts it (from any page: it opens the Coach page first), false ends it, nothing toggles
function talkToggle(on){ if (on === true) return talkStart(); if (on === false) return talkStop(); if (!talk.on) talkStart(); else if (talk.phase === "speaking") talkInterrupt(); else talkStop(); }
document.addEventListener("visibilitychange", () => { if (document.hidden && talk.on) talkStop("Conversation ended: The Way went to the background."); });
window.addEventListener("hashchange", () => { if (talk.on && !onCoach()) talkStop("Conversation ended."); });

// the round button, on every page: hold to talk, tap to open the thread
const b = document.createElement("button");
b.id = "micBtn"; b.type = "button"; b.setAttribute("aria-label", "Hold to talk to the training and nutrition advisor");
b.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4zm6-4a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-3.07A8 8 0 0 0 20 11h-2z"/></svg>`;
// a tap: the Coach page (the face, the conversation, the box to type in); a hold: talk from wherever you are
const toCoach = ()=>{ if (!onCoach()) location.hash = "#coach"; else { const t = document.getElementById("chText"); if (t) t.focus(); } };
if (SR) wireHold(b, toCoach);
else b.onclick = toCoach;
document.body.appendChild(b);
drawHey(); if (heyOn) heyStart();

// the Coach page's conversation: its hold button, Hey Coach, new conversation, the thread drawn
function mount(){
  if (!onCoach()) return;
  const h = document.getElementById("p_vHold"); if (h && SR && !h.__wired){ h.__wired = true; wireHold(h); }
  const hb = document.getElementById("p_vHey"); if (hb){ if (!SR) hb.hidden = true; else hb.onclick = ()=> setHey(!heyOn); }
  const nw = document.getElementById("p_vNew"); if (nw) nw.onclick = ()=>{ history = []; keep(); drawThread(); status("New conversation."); };
  const tk = document.getElementById("p_vTalk"); if (tk){ if (!SR) tk.hidden = true; else tk.onclick = ()=>{ if (window.primeSound) try{ primeSound(); }catch{} talkToggle(); }; }
  const te = document.getElementById("p_vTalkEnd"); if (te) te.onclick = ()=> talkStop();
  drawHey(); drawThread(); drawTalk(); warm();
  const tb = document.getElementById("chText"); if (tb && !tb.__warm){ tb.__warm = true; tb.addEventListener("focus", warm); }
  if (talk.pending) { talk.pending = false; setTimeout(talkStart, 150); }
}
// something said outside the conversation (the briefing): kept in it, so the words are there to read
function note(asked, reply){ if (asked) history.push({ role: "user", text: asked }); history.push({ role: "assistant", text: reply || "" }); keep(); drawThread(); }
// micOpen: the microphone is open or being opened (a hold, or the conversation listening): heavy work elsewhere on
// the page waits for it to close (face.js builds the 3D figure only then)
window.voiceBits = { open, close, send, supported: !!SR, setHey, mount, note, talk: talkToggle, talking: () => talk.on, micOpen: () => listening || state !== "idle" || holding || (talk.on && talk.phase === "listening") };
mount();   // the Coach page drew before this file loaded
})();
