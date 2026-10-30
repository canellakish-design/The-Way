"use strict";
/* THE WAY — the microphone. One button on every page: tap, say it, done.
   The phone turns speech into text (Web Speech, built into Safari and
   Chrome); the bridge (bridge/voice.js) works out what was meant, logs it
   through the same functions the buttons use, and answers in one sentence,
   spoken back. No speech support, or a tablet that will not listen: the
   same sheet takes typing, and the keyboard's own microphone key dictates
   into it. Loads after app.js and uses its globals: bridge, esc, speak, nav. */
(function(){

const J = {"Content-Type":"application/json"};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let rec = null, listening = false, finalText = "";

function sheet(){
  let s = document.getElementById("voiceSheet");
  if (s) return s;
  s = document.createElement("div"); s.id = "voiceSheet"; s.hidden = true;
  s.innerHTML = `<div class="vbox">
    <div class="vhead"><span class="eyebrow">Say it</span><button class="linkish" id="vClose">close</button></div>
    <div class="vheard" id="vHeard"></div>
    <textarea id="vText" rows="3" placeholder="${SR ? "Listening… or type here" : "Type here, or use the keyboard's microphone key"}"></textarea>
    <div class="vrow"><button class="primary" id="vSend">Do it</button> ${SR ? `<button id="vDone">Done, send</button> <button id="vAgain">Listen again</button>` : ""}</div>
    <div class="small" id="vStatus"></div>
    <div id="vResult"></div>
    <div class="small vhint">"two eggs and toast" · "took fish oil" · "weighed 215" · "zone one ride Saturday at 7"</div>
  </div>`;
  document.body.appendChild(s);
  document.getElementById("vClose").onclick = close;
  document.getElementById("vSend").onclick = send;
  const again = document.getElementById("vAgain"); if (again) again.onclick = ()=>{ restarts = 0; listen(); };
  const done = document.getElementById("vDone"); if (done) done.onclick = ()=>{ if (listening) stop(); else send(); };
  s.addEventListener("click", e => { if (e.target === s) close(); });
  return s;
}

function status(t){ const el = document.getElementById("vStatus"); if (el) el.textContent = t || ""; }

function open(){
  const s = sheet(); s.hidden = false;
  document.getElementById("vResult").innerHTML = "";
  document.getElementById("vHeard").textContent = "";
  document.getElementById("vText").value = "";
  restarts = 0;
  if (SR) listen(); else document.getElementById("vText").focus();
}
function close(){ stop(); const s = document.getElementById("voiceSheet"); if (s) s.hidden = true; }

function stop(){ manualStop = true; if (rec && listening){ try{ rec.stop(); }catch{} } listening = false; setMic(false); }
function setMic(on){ const b = document.getElementById("micBtn"); if (b) b.classList.toggle("live", on); }

// Safari on the iPhone ends a session on its own after a short silence,
// sometimes before a word is said, and refuses to start while the last
// session still holds the microphone. So: a fresh recogniser each time, a
// retry when it ends with nothing heard, a retry when it says it is busy,
// and a button that ends the session by hand, which is the reliable way.
let restarts = 0, manualStop = false;
function listen(){
  if (!SR) return;
  try{ if (rec) { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.abort(); } }catch{}
  rec = new SR();
  rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
  finalText = ""; manualStop = false;
  const heard = document.getElementById("vHeard"), text = document.getElementById("vText");
  heard.textContent = "";
  rec.onstart = ()=>{ listening = true; setMic(true); status("Listening… tap the red button, or Done, when you have said it."); try{ speechSynthesis.cancel(); }catch{} };
  rec.onresult = (e)=>{
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++){
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript;
    }
    heard.textContent = (finalText + interim).trim();
  };
  rec.onerror = (e)=>{
    listening = false; setMic(false);
    const k = e.error;
    if (k === "no-speech" && restarts < 2 && !manualStop){ restarts++; status("Heard nothing yet… listening again."); setTimeout(listen, 250); return; }
    status(k === "not-allowed" || k === "service-not-allowed" ? "Microphone blocked. Settings → Safari → Microphone → Allow for this site, or type below."
         : k === "audio-capture" ? "No microphone found. Type below."
         : k === "no-speech" ? "Heard nothing. Tap Listen again, or type." : k === "aborted" ? "" : "Speech failed (" + k + "). Type it below.");
    if (k !== "aborted") text.focus();
  };
  rec.onend = ()=>{
    listening = false; setMic(false);
    const t = (finalText || heard.textContent || "").trim();
    if (t){ text.value = t; status(""); send(); return; }
    if (!manualStop && restarts < 2){ restarts++; setTimeout(listen, 250); return; }
    status("Heard nothing. Tap Listen again, or type.");
  };
  try{ rec.start(); }
  catch(err){
    // "already started": the last session has not let go yet; try once more shortly
    if (/InvalidState|already/i.test(String(err && err.message)) && restarts < 3){ restarts++; setTimeout(listen, 400); return; }
    status("Could not start the microphone: " + err.message + ". Type it below.");
  }
}

async function send(){
  const text = document.getElementById("vText").value.trim();
  if (!text) { status("Nothing to send."); return; }
  const btn = document.getElementById("vSend"); btn.disabled = true; status("Working on it…");
  try{
    const r = await bridge("/voice", { method:"POST", headers:J, body: JSON.stringify({ text }) });
    const out = document.getElementById("vResult");
    out.innerHTML = `<ul class="agenda totals vacts">${(r.actions||[]).map(a => `<li><span class="n">${a.ok ? "✓" : "✗"} ${esc(a.summary)}</span></li>`).join("")}</ul>
      <div class="vreply">${esc(r.reply || "")}</div>`;
    status("");
    if (r.reply && typeof speak === "function") speak(r.reply);
    // whatever was logged, the page under the sheet shows it now
    if ((r.actions||[]).some(a => a.ok && a.type !== "question")) { try{ nav(); }catch{} }
  }catch(e){ status(e.message); }
  btn.disabled = false;
}

// the button, on every page
const b = document.createElement("button");
b.id = "micBtn"; b.type = "button"; b.setAttribute("aria-label", "Say something");
b.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4zm6-4a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.93V22h2v-3.07A8 8 0 0 0 20 11h-2z"/></svg>`;
b.onclick = ()=>{
  const s = document.getElementById("voiceSheet");
  if (listening) { stop(); return; }                       // red: end the session, it sends what it heard
  if (s && !s.hidden) close(); else open();
};
document.body.appendChild(b);

window.voiceBits = { open, close, listen, supported: !!SR };
})();
