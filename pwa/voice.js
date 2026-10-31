"use strict";
/* THE WAY — the microphone: the advisor, as a conversation.
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
    <div class="vhead"><span class="eyebrow">The advisor</span><span><button class="linkish" id="vNew">new conversation</button> · <button class="linkish" id="vClose">close</button></span></div>
    <div class="vthread" id="vThread"></div>
    <div class="vheard" id="vHeard"></div>
    <div class="vrow">${SR ? `<button class="primary big vhold" id="vHold">Hold to talk</button>` : ""}<button class="big" id="vType">Type</button></div>
    <div id="vTypeBox" hidden><textarea id="vText" rows="2" placeholder="${SR ? "Or type it here" : "Type here, or use the keyboard's microphone key"}"></textarea>
      <div class="vrow"><button class="primary" id="vSend">Send</button></div></div>
    <div class="small" id="vStatus"></div>
    <div class="small vhint">"two eggs and toast" · "skim or whole milk?" · "add 30 minutes to today's ride" · "move the dentist to 3" · then answer back: "yes, do that" · "the second one"</div>
  </div>`;
  document.body.appendChild(s);
  document.getElementById("vClose").onclick = close;
  document.getElementById("vNew").onclick = ()=>{ history = []; keep(); drawThread(); status("New conversation."); };
  document.getElementById("vSend").onclick = ()=>{ if (window.primeSound) primeSound(); send(document.getElementById("vText").value.trim()); };
  document.getElementById("vType").onclick = ()=>{ const b = document.getElementById("vTypeBox"); b.hidden = !b.hidden; if (!b.hidden) document.getElementById("vText").focus(); };
  const hold = document.getElementById("vHold");
  if (hold) wireHold(hold);
  s.addEventListener("click", e => { if (e.target === s) close(); });
  drawThread();
  return s;
}

function status(t){ const el = document.getElementById("vStatus"); if (el) el.textContent = t || ""; }
function drawThread(){
  const el = document.getElementById("vThread"); if (!el) return;
  el.innerHTML = history.slice(-12).map(h => `<div class="vmsg ${h.role}">${h.role === "assistant" && h.actions ? `<ul class="vacts">${h.actions.map(a => `<li>${a.ok ? "✓" : "✗"} ${esc(a.summary)}</li>`).join("")}</ul>` : ""}<div>${esc(h.text)}</div></div>`).join("")
    || `<div class="small">Hold the button and say it, or ask it. It answers, and you can answer back.</div>`;
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
  };
  return rec;
}
function startListening(){
  if (!SR) return;
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
  el.addEventListener("contextmenu", e => e.preventDefault());
}

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
    const r = await bridge("/voice", { method:"POST", headers:J, body: JSON.stringify({ text, history: history.slice(0, -1).slice(-10).map(h => ({ role: h.role, text: h.text })) }) });
    history.push({ role: "assistant", text: r.reply || "", actions: (r.actions||[]).filter(a => a.type !== "question") }); keep(); drawThread();
    status("");
    if (r.reply && typeof speak === "function") speak(r.reply);
    const cheer = (r.actions||[]).find(a => a.celebrate);
    if (cheer && typeof celebrate === "function") celebrate({ slot: cheer.slot || null });
    if ((r.actions||[]).some(a => a.ok && a.type !== "question")) { try{ nav(); }catch{} }
  }catch(e){ status(e.message); history.pop(); keep(); drawThread(); }
  sending = false;
}

// the round button, on every page: hold to talk, tap to open the thread
const b = document.createElement("button");
b.id = "micBtn"; b.type = "button"; b.setAttribute("aria-label", "Hold to talk to the advisor");
b.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4zm6-4a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-3.07A8 8 0 0 0 20 11h-2z"/></svg>`;
if (SR) wireHold(b, ()=>{ const s = document.getElementById("voiceSheet"); if (s && !s.hidden) close(); else open(); });
else b.onclick = ()=>{ const s = document.getElementById("voiceSheet"); if (s && !s.hidden) close(); else { open(); const t = document.getElementById("vTypeBox"); if (t) t.hidden = false; } };
document.body.appendChild(b);

window.voiceBits = { open, close, send, supported: !!SR };
})();
