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
   Loads after app.js and uses its globals: bridge, esc, speak, nav. */
(function(){

const J = {"Content-Type":"application/json"};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const HOLD_MS = 280;                 // shorter than this is a tap, not a hold
let rec = null, listening = false, finalText = "", sending = false;
// the thread: what he said and what was answered, kept for the session
let history = [];
try{ history = JSON.parse(sessionStorage.getItem("way-voice-thread") || "[]"); }catch{ history = []; }
const keep = ()=>{ try{ sessionStorage.setItem("way-voice-thread", JSON.stringify(history.slice(-20))); }catch{} };

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

function status(t){ const el = document.getElementById("vStatus"); if (el) el.textContent = t || ""; }
function drawThread(){
  const el = document.getElementById("vThread"); if (!el) return;
  el.innerHTML = history.slice(-12).map(h => `<div class="vmsg ${h.role}">${h.role === "assistant" && h.actions ? `<ul class="vacts">${h.actions.map(a => `<li>${a.ok ? "✓" : "✗"} ${esc(a.summary)}</li>`).join("")}</ul>` : ""}<div>${esc(h.text)}</div></div>`).join("")
    || `<div class="small">Hold to talk. Or turn on Hey Coach and start with "Coach".</div>`;
  el.scrollTop = el.scrollHeight;
}
function open(){ const s = sheet(); s.hidden = false; drawThread(); }
function close(){ abortListening(); const s = document.getElementById("voiceSheet"); if (s) s.hidden = true; }
function setMic(on){ const b = document.getElementById("micBtn"); if (b) b.classList.toggle("live", on); const h = document.getElementById("vHold"); if (h){ h.classList.toggle("live", on); h.textContent = on ? "Listening… let go to send" : "Hold to talk"; } }

/* ---- push to talk ----
   One recogniser for the page, reused. Safari refuses a second start()
   while the first session is still closing ("already started"), and that is
   exactly when a second hold arrives: a hold that lands while the last
   session is still ending waits for it and starts the moment it is free. */
let state = "idle";            // idle | starting | listening | stopping
let wantListen = false, discard = false, holding = false;
function ensureRec(){
  if (rec) return rec;
  rec = new SR();
  rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
  rec.onstart = ()=>{ state = "listening"; listening = true; setMic(true); status(""); };
  rec.onresult = (e)=>{
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++){ const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript; }
    const heard = document.getElementById("vHeard"); if (heard) heard.textContent = (finalText + interim).trim();
  };
  rec.onerror = (e)=>{
    const k = e.error;
    if (k === "aborted") return;                       // ours, on purpose
    status(k === "not-allowed" || k === "service-not-allowed" ? "Microphone blocked. Settings → Safari → Microphone → Allow for this site, or type."
         : k === "audio-capture" ? "No microphone found. Type instead."
         : k === "no-speech" ? "Heard nothing. Hold the button and speak." : "Speech failed (" + k + "). Type it instead.");
  };
  rec.onend = ()=>{
    state = "idle"; listening = false; setMic(false);
    const heard = document.getElementById("vHeard");
    const t = (finalText || (heard && heard.textContent) || "").trim();
    const toss = discard; discard = false; finalText = "";
    if (!toss && t) send(t);
    else if (!toss && !holding) status("Heard nothing. Hold the button and speak.");
    // a hold began while this session was ending: start it now
    if (wantListen && holding) startListening();
    else heyResume();
  };
  return rec;
}
function startListening(){
  if (!SR) return;
  heyPause();
  wantListen = true;
  if (state !== "idle") return;                        // starting or still ending: onend picks it up
  try{ speechSynthesis.cancel(); }catch{}
  finalText = ""; discard = false;
  const heard = document.getElementById("vHeard"); if (heard) heard.textContent = "";
  state = "starting";
  try{ ensureRec().start(); }
  catch(err){
    state = "idle";
    if (/InvalidState|already/i.test(String(err && err.message))){ try{ rec.stop(); }catch{} return; }   // its onend will start us
    status("Could not start the microphone: " + err.message);
  }
}
function stopListening(){
  wantListen = false;
  if (state === "listening" || state === "starting"){ state = "stopping"; try{ rec.stop(); }catch{ state = "idle"; } }
}
function abortListening(){
  wantListen = false; discard = true;
  if (state !== "idle"){ state = "stopping"; try{ rec.abort(); }catch{ state = "idle"; } }
}

// hold = talk; a quick tap toggles the sheet
function wireHold(el, onTap){
  let downAt = 0, mine = false;
  const down = (e)=>{ if (sending) return; e.preventDefault(); downAt = Date.now(); mine = true; holding = true; try{ el.setPointerCapture(e.pointerId); }catch{} if (window.primeSound) primeSound(); startListening(); };
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
async function whereAmI(){
  try{
    if (!navigator.geolocation) return null;
    if (navigator.permissions && navigator.permissions.query){ const st = await navigator.permissions.query({ name: "geolocation" }); if (st.state !== "granted") return null; }
    return await new Promise(res => { const t = setTimeout(() => res(null), 3000); navigator.geolocation.getCurrentPosition(p => { clearTimeout(t); res({ lat: p.coords.latitude, lon: p.coords.longitude }); }, () => { clearTimeout(t); res(null); }, { maximumAge: 300000, timeout: 2800 }); });
  }catch{ return null; }
}
window.whereAmI = whereAmI;
async function send(text){
  if (!text) { status("Nothing to send."); return; }
  if (sending) return;
  sending = true;
  open();
  const heard = document.getElementById("vHeard"); if (heard) heard.textContent = "";
  const typed = document.getElementById("vText"); if (typed) typed.value = "";
  history.push({ role: "user", text }); keep(); drawThread();
  status("Thinking…");
  try{
    const coords = await whereAmI();
    const r = await bridge("/voice", { method:"POST", headers:J, body: JSON.stringify({ text, coords, history: history.slice(0, -1).slice(-10).map(h => ({ role: h.role, text: h.text })) }) });
    history.push({ role: "assistant", text: r.reply || "", actions: (r.actions||[]).filter(a => a.type !== "question") }); keep(); drawThread();
    status("");
    if (r.reply && typeof speak === "function") speak(r.reply);
    const cheer = (r.actions||[]).find(a => a.celebrate);
    if (cheer && typeof celebrate === "function") celebrate({ slot: cheer.slot || null });
    if ((r.actions||[]).some(a => a.ok && a.type !== "question")) { try{ nav(); }catch{} }
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
  const hb = document.getElementById("vHey"); if (hb) hb.textContent = "Hey Coach: " + (heyOn ? "on" : "off");
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
    const r = await bridge("/voice", { method:"POST", headers:J, body: JSON.stringify({ text, history: history.slice(0, -1).slice(-10).map(h => ({ role: h.role, text: h.text })) }) });
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
function heyStart(){
  if (!SR || !heyOn || heyPaused || heyRec || document.hidden) return;
  try{
    heyRec = new SR(); heyRec.lang = "en-US"; heyRec.continuous = true; heyRec.interimResults = false; heyRec.maxAlternatives = 1;
    heyRec.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) heyHeard(e.results[i][0].transcript); };
    heyRec.onerror = e => { if (e.error === "not-allowed" || e.error === "service-not-allowed"){ setHey(false); toast("Microphone blocked: allow it for The Way, then turn Hey Coach on again."); } };
    heyRec.onend = () => { heyRec = null; if (heyOn && !heyPaused) setTimeout(heyStart, 300); };
    heyRec.start();
  }catch{ heyRec = null; setTimeout(heyStart, 1500); }
}
function heyStop(){ const r = heyRec; heyRec = null; if (r){ r.onend = null; try{ r.abort(); }catch{} } }
function heyPause(){ heyPaused = true; heyStop(); }
function heyResume(){ heyPaused = false; if (heyOn && !ttsBusy()) heyStart(); else if (heyOn) setTimeout(heyResume, 700); }
function setHey(on){
  heyOn = !!on; try{ localStorage.setItem("way-hey", heyOn ? "1" : "0"); }catch{}
  drawHey();
  if (heyOn){ heyPaused = false; heyStart(); toast("Hey Coach is listening. Start with \"Coach\"."); } else { heyStop(); toast("Hey Coach off."); }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) heyStop(); else if (heyOn && !heyPaused) heyStart(); });

// the round button, on every page: hold to talk, tap to open the thread
const b = document.createElement("button");
b.id = "micBtn"; b.type = "button"; b.setAttribute("aria-label", "Hold to talk to the training and nutrition advisor");
b.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4zm6-4a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-3.07A8 8 0 0 0 20 11h-2z"/></svg>`;
if (SR) wireHold(b, ()=>{ const s = document.getElementById("voiceSheet"); if (s && !s.hidden) close(); else open(); });
else b.onclick = ()=>{ const s = document.getElementById("voiceSheet"); if (s && !s.hidden) close(); else { open(); const t = document.getElementById("vTypeBox"); if (t) t.hidden = false; } };
document.body.appendChild(b);
drawHey(); if (heyOn) heyStart();

window.voiceBits = { open, close, send, supported: !!SR, setHey };
})();
