"use strict";
/* THE WAY — PWA. Local-first; bridge sync when reachable. */


/* connection status: flips header title color when the bridge answers real data */
let __live = null;
function markLive(isLive){
  if (__live === isLive) return;
  __live = isLive;
  const h = document.querySelector("h1");
  if (h) h.title = isLive ? "bridge live" : "demo / offline";
  const dot = document.getElementById("__dot") || (()=>{ 
    const d = document.createElement("span"); d.id="__dot";
    d.style.cssText="display:inline-block;width:8px;height:8px;margin-left:8px;border:1px solid var(--ink);vertical-align:middle";
    const hh = document.querySelector("h1"); if(hh) hh.appendChild(d); return d; })();
  dot.style.background = isLive ? "var(--green)" : "transparent";
}

const S = JSON.parse(localStorage.getItem("way-settings") || "{}");
// Retired per-device config. Clear it so an old phone doesn't keep a stale
// bridge URL around in storage where it can confuse the next debugging session.
if (S.bridgeUrl !== undefined || S.token !== undefined || S.role !== undefined) {
  delete S.bridgeUrl; delete S.token; delete S.role;
  localStorage.setItem("way-settings", JSON.stringify(S));
}
function saveS(){ localStorage.setItem("way-settings", JSON.stringify(S)); }
const DAY_TYPES = ["Day 1 · fasted Z2","Day 2 · HIIT","Day 3 · grocery + batch","Day 4 · fasted Z2","Day 5 · strength (kettlebell)","Commute · 35 mi evening"];

/* API base auto-select:
   - explicit Bridge URL in Settings wins
   - PWA served by the local bridge (port 8420) -> same-origin ""
   - hosted (Netlify) -> /.netlify/functions/api                     */
const DEFAULT_API = (location.port === "8420") ? "" : "/.netlify/functions/api";
/* Demo data covers layout-only endpoints. Anything measured about Harry —
   WHOOP recovery, the scale, Hexis macros — is deliberately absent: a fake
   recovery score is indistinguishable from a real one on screen, and it hid a
   broken WHOOP connection behind plausible numbers. Those now read as "not
   connected" when the bridge can't answer. */
const DEMO = {
  "/route-weather": { now:{t:74,w:8,ride:"crosswind 8 mph"}, evening:{t:81,w:12,ride:"headwind 12 mph"}, stormAfterHour:16 },
  "/race": { race:{name:"Gran Fondo Maryland — Medio"}, weeks_out:10.1, phase:"build",
    need:{aerobic_h:6.2,hi_min:88,strength:2}, done:{aerobic_h:0,hi_min:0,strength:0}, remaining:{aerobic_h:6.2,hi_min:88,strength:2} },
  "/podcasts/list": { episodes:[] },
  "/plan": { ride:null, for_today:false, intensity:"moderate", planned_hours:null, effective_hours:null, route:null },
  "/schedule": demoSchedule(),
  "/agent": { reply:"Demo mode — connect the bridge (Settings) or deploy the Netlify function for real answers." },
  "/agent/closeout": { ok:true },
  "/fitness/log": { log:[] },
  "/workout-debt": { kcal: 480, count: 1, rides: [{name:"Morning Z2", kcal:480, source:"strava", at:new Date().toISOString()}] },
  "/batches": { batches:[ {slot:1,status:"building",ingredients:[],total_g:0,totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},scoop_g:null,remaining_g:0,scoops_remaining:null},
    {slot:2,status:"building",ingredients:[],total_g:0,totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},scoop_g:null,remaining_g:0,scoops_remaining:null},
    {slot:3,status:"building",ingredients:[],total_g:0,totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},scoop_g:null,remaining_g:0,scoops_remaining:null} ] }
};
async function bridge(pathname, opts){
  try{
    // Always same-origin. This used to take a per-device Bridge URL and token
    // out of localStorage, which meant a phone with a stale or empty value
    // failed while the desktop worked — the same page, "bridge unreachable" on
    // one device only. There is nothing to get wrong now.
    // The header is how the bridge recognises its own page now that no token
    // is stored per device.
    const o = Object.assign({}, opts);
    o.headers = Object.assign({ "x-the-way-app": "1" }, (opts && opts.headers) || {});
    const r = await fetch(DEFAULT_API + pathname, o);
    if (!r.ok) {
      let detail = "";
      try{ const j = await r.clone().json(); detail = j.error ? " — " + j.error : ""; }
      catch{ try{ detail = " — " + (await r.text()).slice(0,200); }catch{} }
      throw new Error("bridge " + r.status + detail);
    }
    const data = await r.json();
    markLive(true);
    return data;
  }catch(e){
    const k = Object.keys(DEMO).find(k => pathname.startsWith(k));
    if (k && (!opts || !opts.method || opts.method === "GET")){ markLive(false); return JSON.parse(JSON.stringify(DEMO[k])); }
    throw e;
  }
}
function esc(t){ const d=document.createElement("div"); d.textContent=t==null?"":String(t); return d.innerHTML; }
function attr(t){ return esc(t).replace(/"/g,"&quot;"); }
let __ttsSpeaking = false, __lastSpoken = "";
/* A meal that lands on the plan: a chime, a green check that pops open in
   the middle of the screen with bits flung out of it, then flies down to
   the meal's own card and sits there. The sound is made here (sine notes,
   no file); iOS only lets sound start inside a tap, so the log buttons
   call primeSound() as they are pressed and the chime plays when the
   answer comes back. */
let __audio = null;
function primeSound(){ try{ const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; if (!__audio) __audio = new AC(); if (__audio.state === "suspended") __audio.resume(); }catch{} }
function playCheer(){
  try{
    primeSound(); const a = __audio; if (!a) return;
    const t0 = a.currentTime + 0.02;
    [[523.25, 0], [659.25, .10], [783.99, .20], [1046.5, .32]].forEach(([f, dt]) => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(0.16, t0 + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
      o.connect(g).connect(a.destination); o.start(t0 + dt); o.stop(t0 + dt + 0.55);
    });
  }catch{}
}
const CHECK_SVG = '<svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"><circle cx="60" cy="60" r="54" fill="#1f7a3a" stroke="#6fe09a" stroke-width="4"/><path d="M34 62l16 16 36-40" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function celebrate(opts){
  const o = opts || {};
  try{
    playCheer();
    const old = document.getElementById("cheer"); if (old) old.remove();
    const wrap = document.createElement("div"); wrap.id = "cheer"; wrap.setAttribute("aria-hidden", "true");
    const N = 30;
    for (let i = 0; i < N; i++){
      const b = document.createElement("span"); b.className = "bit";
      const ang = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.35, dist = 120 + Math.random() * 190;
      b.style.setProperty("--dx", Math.cos(ang) * dist + "px"); b.style.setProperty("--dy", Math.sin(ang) * dist + "px");
      b.style.setProperty("--d", (700 + Math.random() * 500) + "ms"); b.style.setProperty("--s", (0.5 + Math.random() * 0.9).toFixed(2));
      b.textContent = i % 4 ? "✓" : "✦";
      wrap.appendChild(b);
    }
    const chk = document.createElement("div"); chk.className = "chk"; chk.innerHTML = CHECK_SVG; wrap.appendChild(chk);
    document.body.appendChild(wrap);
    // the meal's card: bring it into view while the check is still popping
    const li = o.slot ? document.querySelector(`.mealplan li[data-slot="${(window.CSS && CSS.escape) ? CSS.escape(o.slot) : o.slot}"]`) : null;
    const target = li ? li.querySelector(".mk") : null;
    if (target) target.style.visibility = "hidden";                 // the card's own check waits for the flying one
    if (li){ try{ li.scrollIntoView({ block: "center", behavior: "smooth" }); }catch{} }
    const land = ()=>{ if (!target) return; target.textContent = "✓"; target.className = "mk ok onplan"; target.title = "on the plan"; target.style.visibility = ""; li.classList.add("cheered"); };
    setTimeout(()=>{
      const from = chk.getBoundingClientRect();
      if (target && from.width){
        const to = target.getBoundingClientRect();
        const dx = (to.left + to.width / 2) - (from.left + from.width / 2), dy = (to.top + to.height / 2) - (from.top + from.height / 2);
        const scale = Math.max(0.14, Math.min(0.3, (to.width || 18) / from.width));
        const anim = chk.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${scale})`, opacity: 1 }], { duration: 650, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
        anim.onfinish = ()=>{ land(); try{ wrap.remove(); }catch{} };
      } else {
        chk.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.6)", opacity: 0 }], { duration: 500, fill: "forwards" }).onfinish = ()=>{ try{ wrap.remove(); }catch{} };
      }
    }, 1000);
    setTimeout(()=>{ land(); try{ wrap.remove(); }catch{} }, 4000);
  }catch{}
}
window.celebrate = celebrate; window.primeSound = primeSound;
function speak(t){
  try{
    const u = new SpeechSynthesisUtterance(t); u.rate = 1.03;
    __lastSpoken = t;
    u.onstart = ()=>{ __ttsSpeaking = true; };
    u.onend = ()=>{ __ttsSpeaking = false; };
    u.onerror = ()=>{ __ttsSpeaking = false; };
    speechSynthesis.speak(u);
  }catch(e){}
}

/* photo helpers — used by Food Log and Batches, both send {image_base64, media_type} */
function fileToBase64(file, maxDim, quality){
  maxDim = maxDim || 1280; quality = quality || 0.75;
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      let { width, height } = img;
      if (width > maxDim || height > maxDim){
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob=>{
        if (!blob){ reject(new Error("photo compression failed")); return; }
        const r = new FileReader();
        r.onload = ()=> resolve(String(r.result).split(",")[1]);
        r.onerror = ()=> reject(new Error("photo read failed"));
        r.readAsDataURL(blob);
      }, "image/jpeg", quality);
    };
    img.onerror = ()=> { URL.revokeObjectURL(url); reject(new Error("photo load failed")); };
    img.src = url;
  });
}
async function multiPhotoBridge(pathname, files, extra){
  const images = await Promise.all(Array.from(files).map(async f=> ({
    image_base64: await fileToBase64(f), media_type: "image/jpeg" })));
  return bridge(pathname, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ images, ...(extra||{}) }) });
}

/* ---------------- views ---------------- */
const V = {};
const view = document.getElementById("view");
view.dataset.booted = "1";   // the placeholder/error banner stands down
/* Legacy hashes (old tabs, saved links, kiosk bookmarks) land on their new homes. */
const REDIRECTS = { day:"today", agent:"ride", plan:"ride", activate:"settings", train:"calendar", sleep:"today", analyze:"ride", hexis:"food", fuel:"food", recover:"today", morning:"today", night:"today", bedroom:"today", "routine-am":"today", "routine-pm":"today" };
function nav(){
  // Views may carry parameters after a "?" (#workout?id=…, #calendar?week=…).
  let h = location.hash.replace("#","").split("?")[0] || defaultView();
  if (REDIRECTS[h]){ location.hash = "#"+REDIRECTS[h]; return; }
  // No tab bar: the day is the app. Everything else still exists at its hash,
  // so those views get one way back rather than being dead ends.
  const navEl = document.querySelector("nav");
  // Three places the day is run from: the day itself, the calendar where the
  // workouts are planned ahead, and the food journal. Everything else is a
  // tap away from one of them.
  const NAV = [["today","Day"],["ride","Ride"],["calendar","Calendar"],["food","Food"],["live","Live"],["lift","Lift"]];
  const cur = h === "workout" ? "calendar" : h === "zones" ? "ride" : h;   // zones lives under Ride
  if (navEl) navEl.innerHTML = NAV.map(([k,l])=>`<a href="#${k}" class="${k===cur?"on":""}">${l}</a>`).join("");
  (V[h] || V.settings)();
}
/* The front page is the day, on every device. */
function defaultView(){
  return "today";
}

/* ---------------- COACH (shared conversation component) ----------------
   Every group has its coach: same hands-free loop, different persona.
   The persona rides in the POST body; the bridge keeps a separate thread
   and voice for each. */
const PERSONA_HINTS = {
  plan:     "Planning coach — the week, the windows, tomorrow's ride.",
  activate: "Activation coach — mobility, warm-ups, getting the body ready.",
  train:    "Training coach — sessions, buckets, what the week owes.",
  sleep:    "Sleep coach — sleep, HRV, the morning readiness picture.",
  analyze:  "Analyst — weight, W/kg, trends. Ride analysis coming soon."
};
function coachCard(persona){
  return `<span class="eyebrow" style="margin-top:16px;display:block">Coach</span>
    <div class="card"><div class="small">${PERSONA_HINTS[persona]||""}</div>
      <div class="coachLog" id="coachLog"></div>
      <button class="ptt" id="convBtn">Start conversation</button>
      <input id="coachTyped" placeholder="…or type here and press Enter"></div>`;
}
function wireCoach(persona){
  const log = document.getElementById("coachLog");
  const add = (who, t)=>{ const d=document.createElement("div"); d.className="turn "+who;
    d.textContent = (who==="you"?"You: ":"Coach: ")+t; log.appendChild(d); log.scrollTop=1e6; };
  const ask = async (text)=>{
    add("you", text);
    try{
      const r = await bridge("/agent",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text, persona})});
      add("coach", r.reply); speak(r.reply);
    }catch(e){ add("coach","(bridge unreachable — " + e.message + ")"); }
  };
  document.getElementById("coachTyped").addEventListener("keydown",e=>{
    if(e.key==="Enter"&&e.target.value.trim()){ ask(e.target.value.trim()); e.target.value=""; }});

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById("convBtn");
  if (!SR){ btn.textContent = "Voice unavailable here — type below"; btn.disabled = true; return; }
  let rec = null, convOn = false;
  // No browser API gives real acoustic echo cancellation between
  // SpeechSynthesis output and SpeechRecognition input, so the mic can
  // hear the coach's own voice through a tablet/phone speaker and
  // mistake it for a barge-in. A Bluetooth earpiece (e.g. Shokz) mostly
  // sidesteps this. This word-overlap check is a rough fallback filter.
  const wordOverlap = (a,b)=>{
    const wa = a.toLowerCase().split(/\s+/).filter(Boolean);
    const wb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (!wa.length) return 0;
    return wa.filter(w=>wb.has(w)).length / wa.length;
  };
  const handleUtterance = (text)=>{
    text = text.trim(); if (!text) return;
    if (__ttsSpeaking){
      if (wordOverlap(text, __lastSpoken) > 0.5) return; // mic hearing the coach — ignore
      speechSynthesis.cancel(); __ttsSpeaking = false;   // real barge-in
    }
    ask(text);
  };
  const startRec = ()=>{
    rec = new SR(); rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e=>{
      for (let i = e.resultIndex; i < e.results.length; i++){
        if (e.results[i].isFinal) handleUtterance(e.results[i][0].transcript);
      }
    };
    rec.onerror = ()=>{};
    rec.onend = ()=>{ if (convOn){ try{ rec.start(); }catch(e){} } };
    try{ rec.start(); }catch(e){}
  };
  btn.onclick = ()=>{
    convOn = !convOn;
    if (convOn){
      btn.textContent = "End conversation"; btn.classList.add("listening");
      startRec();
    } else {
      btn.textContent = "Start conversation"; btn.classList.remove("listening");
      if (rec){ rec.onend = null; try{ rec.stop(); }catch(e){} rec = null; }
      speechSynthesis.cancel(); __ttsSpeaking = false;
    }
  };
}

function gearList(dayType, storm){
  if (/fasted/.test(dayType)) return ["Kit laid out","Bottles filled (water only)","Edge charged","Lights charged","Tires checked","No rice balls — fasted by design"];
  if (/Commute/.test(dayType)) return ["Car bag: work clothes + charger","Rice balls wrapped, at the door","Edge charged","Lights charged", storm?"Rain shell in the bag (storms tomorrow)":"Check sky at rollout","Tires checked"];
  if (/HIIT/.test(dayType)) return ["Fan on desk","Towel","HR strap charged","Bottles on desk"];
  if (/strength/.test(dayType)) return ["Nothing to pack — the bell is where it lives"];
  return ["Bottles","Edge charged"];
}

/* ---------------- PLAN (race, weather, windows, pre-ride, tomorrow, gear) ---------------- */
V.plan = async function(){
  const hr = new Date().getHours();
  const greet = hr<12 ? "Good morning, Harry" : hr<18 ? "Good afternoon, Harry" : "Good evening, Harry";
  const tomorrow = S.tomorrow || DAY_TYPES[0];
  view.innerHTML = `<span class="eyebrow">Plan · ${esc(S.dayType||DAY_TYPES[0])}</span>
    <div class="greet">${greet}</div>
    <div class="card" id="race"><h4>The race</h4><div class="small">reaching the bridge…</div></div>
    <div class="card" id="wx"><h4>Weather</h4><div class="small">reaching the bridge…</div></div>
    <div class="card" id="preRideCard"><h4>Pre-Ride Fueling</h4>
      <div class="row2">
        <span><label>Intensity</label>
          <select id="prIntensity">
            <option value="easy">Easy</option>
            <option value="moderate">Moderate</option>
            <option value="hard">Hard</option>
          </select></span>
        <span><label>Duration (hrs)</label>
          <input id="prHours" type="number" step="0.25" min="0" placeholder="e.g. 2.5"></span></div>
      <div class="small" id="prSource"></div>
      <div id="prResult" style="margin-top:8px"></div></div>
    <div class="card"><h4>Tomorrow's ride</h4>
      <div class="row2"><span><label>Ride</label><input id="planRide" placeholder="Woodlawn leg home"></span>
      <span><label>Start time</label><input id="planTime" type="time" value="06:00"></span></div>
      <label>Ride with GPS link (optional — pulls route, distance, wind bearings)</label>
      <input id="planRwgps" placeholder="https://ridewithgps.com/routes/12345678">
      <button class="primary" id="planSave">Save plan</button>
      <div class="small" id="planMsg"></div></div>
    <div class="card"><h4>Gear check — tomorrow:
      <select id="tmw">${DAY_TYPES.map(d=>`<option ${d===tomorrow?"selected":""}>${d}</option>`).join("")}</select></h4>
      <ul class="plain" id="gear"></ul></div>
    ${coachCard("plan")}`;

  (async ()=>{
    try{
      const plan = await bridge("/plan").catch(()=>({for_today:false}));
      if (plan.for_today && plan.start){
        const hr = parseInt(plan.start.split(":")[0],10);
        const w = await bridge("/route-weather?hour="+hr);
        const a = w.at || w.now;
        const rain = a.p>=50 ? "likely rain ("+a.p+"%)" : a.p>=25 ? "rain possible ("+a.p+"%)" : "dry";
        const verdict = a.p>=50 ? "pack the shell" : /headwind/.test(a.ride) ? "budget extra time into the wind" : /tailwind/.test(a.ride) ? "fast one — enjoy the push" : "steady conditions";
        const facts = plan.route ? ` · ${plan.route.miles} mi · ${plan.route.climb_ft} ft` : "";
        document.getElementById("wx").innerHTML =
          `<h4>Today's ride · ${esc(plan.ride)} · ${esc(plan.start)}${facts}</h4>
           <div class="small">At rollout: ${a.t}° · ${esc(a.ride)} · ${rain}. ${verdict}.</div>
           <div class="small">Now: ${w.now.t}° · ${esc(w.now.ride)}${w.stormAfterHour>0 ? " · storms possible after "+w.stormAfterHour+":00" : ""}</div>`;
      } else {
        const w = await bridge("/route-weather");
        document.getElementById("wx").innerHTML = `<h4>${w.now.t}° · wind ${Math.round(w.now.w)} mph</h4>
          <div class="small">${esc(w.now.ride)} now · evening: ${esc(w.evening.ride)}${w.stormAfterHour>0 ? " · storms possible after "+w.stormAfterHour+":00" : ""} · no ride planned — set one below</div>`;
      }
    }catch(e){ document.getElementById("wx").innerHTML = `<h4>Weather</h4><div class="small">bridge unreachable — check settings</div>`; }
  })();

  bridge("/race").then(r=>{
    const rem = r.remaining || {}, done = r.done || {};
    const n = (v)=> (v==null ? 0 : v);
    document.getElementById("race").innerHTML =
      `<h4>${(r.race&&r.race.name)||"Race"} · ${n(r.weeks_out)} weeks out · ${r.phase||""}</h4>
       <div class="small">This week still owes: <b>${n(rem.aerobic_h)}h</b> aerobic · <b>${n(rem.hi_min)}min</b> hard · <b>${n(rem.strength)}</b> strength
       <br>(done: ${n(done.aerobic_h)}h / ${n(done.hi_min)}min / ${n(done.strength)})</div>`;
  }).catch(()=>{ document.getElementById("race").innerHTML = `<h4>The race</h4><div class="small">bridge unreachable</div>`; });
  bridge("/availability/today").then(a=>{
    if (a && a.connected){
      const wins = (a.windows||[]).map(w=>`${w.from}–${w.to} (${w.minutes}m)`).join(" · ") || "no windows";
      const card = document.createElement("div"); card.className="card";
      card.innerHTML = `<h4>Today's windows${a.recovery ? " · recovery "+a.recovery : ""}</h4>
        <div class="small">${wins}</div>
        <div class="small"><b>${a.recommendation||""}</b></div>`;
      const raceEl = document.getElementById("race");
      raceEl.parentNode.insertBefore(card, raceEl.nextSibling);
    }
  }).catch(()=>{});

  /* ---- Pre-Ride Fueling: rice balls needed from batches, by planned duration + intensity ----
     Carb rates are on-bike fueling targets (g of carb per hour), not kcal —
     carbs are what the body can actually absorb and use mid-ride. Ranges are
     deliberately wide since "fuel the work" doctrine cares about matching
     effort, not hitting one exact number. */
  const CARB_RATE_G_PER_HR = { easy: [30, 40], moderate: [55, 70], hard: [75, 90] };
  let __preRideBatches = [];

  const preRideCompute = (hours, tier)=>{
    const [lo, hi] = CARB_RATE_G_PER_HR[tier] || CARB_RATE_G_PER_HR.moderate;
    const carbsLo = Math.round(hours * lo), carbsHi = Math.round(hours * hi);
    const rows = __preRideBatches
      .filter(b => b.scoop_g && b.total_g)
      .map(b=>{
        const frac = b.scoop_g / b.total_g;
        const carbsPerBall = b.totals.carbs_g * frac;
        const needLo = carbsPerBall > 0 ? Math.ceil(carbsLo / carbsPerBall) : null;
        const needHi = carbsPerBall > 0 ? Math.ceil(carbsHi / carbsPerBall) : null;
        return { slot: b.slot, needLo, needHi, carbsPerBall, available: b.scoops_remaining };
      });
    return { carbsLo, carbsHi, rows };
  };

  const renderPreRide = ()=>{
    const hours = +document.getElementById("prHours").value || 0;
    const tier = document.getElementById("prIntensity").value;
    const out = document.getElementById("prResult");
    if (!hours){ out.innerHTML = `<div class="small">Enter a duration to see rice balls needed.</div>`; return; }
    const { carbsLo, carbsHi, rows } = preRideCompute(hours, tier);
    if (!rows.length){
      out.innerHTML = `<div class="small">Target: ${carbsLo}\u2013${carbsHi}g carbs for the ride. No calibrated batch yet \u2014 calibrate a scoop to convert this to a rice ball count.</div>`;
      return;
    }
    out.innerHTML = `<div class="small">Target: ${carbsLo}\u2013${carbsHi}g carbs over ${hours}h at ${tier} intensity.</div>
      <ul class="plain">${rows.map(r=>{
        const short = r.available != null && r.needLo != null && r.available < r.needLo;
        return `<li><span>Batch ${r.slot} \u00b7 ${r.carbsPerBall.toFixed(1)}g carbs/ball</span>
          <b>${r.needLo}\u2013${r.needHi} balls${short ? " \u26a0 only " + r.available + " ready" : ""}</b></li>`;
      }).join("")}</ul>`;
  };

  const saveFueling = async ()=>{
    try{
      await bridge("/plan/fueling", {method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          intensity: document.getElementById("prIntensity").value,
          planned_hours: +document.getElementById("prHours").value || null
        })});
    }catch(e){ /* best effort \u2014 local calc still works if the bridge is unreachable */ }
  };

  const refreshPreRide = async ()=>{
    const src = document.getElementById("prSource");
    try{
      const plan = await bridge("/plan");
      const b = await bridge("/batches");
      __preRideBatches = b.batches || [];
      const intensitySel = document.getElementById("prIntensity");
      const hoursInput = document.getElementById("prHours");
      if (plan.intensity) intensitySel.value = plan.intensity;
      if (!hoursInput.value && plan.effective_hours) hoursInput.value = plan.effective_hours;
      if (plan.planned_hours) src.textContent = `Duration set manually: ${plan.planned_hours}h.`;
      else if (plan.route && plan.route.estimated_hours) src.textContent = `Estimated from planned route "${plan.ride}" \u2014 ${plan.route.miles}mi, ${plan.route.climb_ft}ft climb (~${plan.route.estimated_hours}h, rough estimate \u2014 adjust freely).`;
      else src.textContent = `No planned ride on file \u2014 enter hours manually.`;
      renderPreRide();
    }catch(e){ src.textContent = "bridge unreachable"; }
  };
  document.getElementById("prIntensity").onchange = ()=>{ renderPreRide(); saveFueling(); };
  document.getElementById("prHours").oninput = renderPreRide;
  document.getElementById("prHours").onchange = saveFueling;
  refreshPreRide();

  let storm = false;
  bridge("/route-weather").then(w=>{ storm = w.stormAfterHour>0; drawGear(); }).catch(()=>{});
  const drawGear = ()=>{
    const done = JSON.parse(localStorage.getItem("gear-"+new Date().toDateString())||"[]");
    const items = gearList(document.getElementById("tmw").value, storm);
    document.getElementById("gear").innerHTML = items.map((g,i)=>
      `<li class="${done.includes(i)?"done":""}" data-i="${i}"><span>${g}</span><span>${done.includes(i)?"✓":"tap"}</span></li>`).join("");
    document.querySelectorAll("#gear li").forEach(li=>li.onclick=()=>{
      const i=+li.dataset.i; const d=JSON.parse(localStorage.getItem("gear-"+new Date().toDateString())||"[]");
      if(!d.includes(i)) d.push(i); localStorage.setItem("gear-"+new Date().toDateString(),JSON.stringify(d)); drawGear(); });
  };
  document.getElementById("tmw").onchange = e=>{ S.tomorrow=e.target.value; saveS(); drawGear(); };
  drawGear();
  bridge("/plan").then(p=>{ if(p.ride){ document.getElementById("planRide").value=p.ride;
    document.getElementById("planTime").value=p.start; } }).catch(()=>{});
  document.getElementById("planSave").onclick = async ()=>{
    try{
      const p = await bridge("/plan",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ride:document.getElementById("planRide").value||"Ride",
                             start:document.getElementById("planTime").value,
                             rwgps:document.getElementById("planRwgps").value||null})});
      let msg = "Planned: "+p.ride+" at "+p.start;
      if (p.route) msg += " · "+p.route.miles+" mi, "+p.route.climb_ft+" ft — wind will be read against the real route.";
      else if (p.route_error) msg += " · route not pulled ("+p.route_error+") — plan saved anyway.";
      else msg += " — Plan will brief it in the morning.";
      document.getElementById("planMsg").textContent = msg;
    }catch(e){ document.getElementById("planMsg").textContent = "bridge unreachable"; }
  };
  wireCoach("plan");
};

/* ---------------- ACTIVATE (guided mobility) ---------------- */
V.activate = async function(){
  view.innerHTML = `<span class="eyebrow">Activate</span>
    <div class="card"><h4>Mobility — 10 min</h4>
      <div class="small">Guided flow, coach-paced. Morning: normal pace. Evening: same flow, easy pace.</div>
      <ul class="plain" id="mob"></ul>
      <div class="small" id="mobTimer"></div>
      <button id="mobNext">Next</button> <button id="mobRepeat" disabled>Repeat that</button></div>
    ${coachCard("activate")}`;

  const moves = [
    {n:"Cat Cow", d:"On all fours. Arch your back up like an angry cat, then drop the belly and lift the chest. Move with your breath, about 15 slow reps.", s:30},
    {n:"Cobra", d:"Lie face down, hands under shoulders. Press the chest up, hips stay heavy on the floor. Hold and breathe, about 30 seconds — this is the extension your spine wants after the bike.", s:30},
    {n:"Deep lunge", d:"Big step forward, back knee down, sink the hips low and forward. 30 seconds, then switch legs. This is your hip flexors paying rent.", s:60},
    {n:"World's greatest stretch", d:"From a lunge, drop the inside hand, rotate the other arm to the sky and follow it with your eyes. About 15 slow reps, alternating sides.", s:30},
    {n:"Open books", d:"Lie on your side, knees bent, arms stacked in front. Open the top arm across your body like a book cover, eyes following the hand. 10 each side — this is the thoracic rotation cyclists lose first.", s:40},
    {n:"Quad stretch", d:"Standing or side-lying, pull the heel to your glute, knee pointing down. 30 seconds each side, hips pressed forward.", s:60},
    {n:"Downward dog", d:"Hands and feet on the floor, hips to the sky. Pedal the heels one at a time. 30 seconds, long spine.", s:30},
    {n:"Pigeon", d:"One shin folded in front, back leg long behind. Square the hips and fold forward over the front leg. 30 seconds each side, breathe into it.", s:60},
    {n:"90 90s", d:"Seated, both knees bent at right angles, one in front, one to the side. Rotate the knees over to the other side with control. 15 slow transitions.", s:30},
    {n:"Deep squat hold", d:"Feet shoulder width, sink all the way down. Heels stay on the floor, chest tall, elbows can pry the knees out. 30 seconds — this is your bottom-bracket position insurance.", s:30}
  ];
  const TRANSITION_S = 30;
  let mi = -1, mobRec = null, mobTimerId = null, mobRemaining = 0, mobPhase = "idle"; // idle | move | rest | done
  // Morning or evening mobility, remembered for the day.
  const mobDone = ()=> localStorage.setItem((new Date().getHours()<15?"mob-am-":"mob-pm-")+new Date().toDateString(),"1");
  const clearMobTimer = ()=>{ if (mobTimerId){ clearInterval(mobTimerId); mobTimerId = null; }
    const el = document.getElementById("mobTimer"); if (el) el.textContent = ""; };
  const startMobTimer = (seconds, onDone)=>{
    clearMobTimer();
    mobRemaining = seconds;
    const el = document.getElementById("mobTimer");
    const label = mobPhase === "rest" ? "Rest — up next: " + (moves[mi] ? moves[mi].n : "") + " · " : "⏱ ";
    const paint = ()=>{ if (el) el.textContent = mobRemaining > 0 ? `${label}${mobRemaining}s` : ""; };
    paint();
    mobTimerId = setInterval(()=>{
      mobRemaining--; paint();
      if (mobRemaining <= 0){ clearMobTimer(); onDone(); }
    }, 1000);
  };
  const drawMob = ()=>{
    document.getElementById("mob").innerHTML =
      moves.map((m,i)=>{
        const isCurrent = i === mi && mobPhase === "move";
        const isUpNext = i === mi && mobPhase === "rest";
        const isDone = i < mi;
        const label = isCurrent ? "now" : isUpNext ? "up next" : (isDone ? "✓" : "");
        return `<li class="${isDone?"done":""}"><span>${isCurrent?"<b>":""}${m.n}${isCurrent?"</b>":""}</span><span>${label}</span></li>`;
      }).join("");
    const btn = document.getElementById("mobNext");
    if (mobPhase === "done"){ btn.textContent = "Done ✓"; btn.disabled = true; }
    else btn.textContent = mi < 0 ? "Start guided flow" : "Ready — next";
  };
  const listenForReady = ()=>{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return; // button still works everywhere
    try{
      mobRec = new SR(); mobRec.lang = "en-US"; mobRec.continuous = true; mobRec.interimResults = false;
      mobRec.onresult = e=>{
        const t = e.results[e.results.length-1][0].transcript.toLowerCase();
        if (/\b(ready|next|done|go|continue)\b/.test(t)) advance();
        else if (/\b(repeat|again)\b/.test(t) && mobPhase === "move") { speak(moves[mi].d); if (moves[mi].s) startMobTimer(moves[mi].s, ()=>startTransition()); }
      };
      mobRec.onend = ()=>{ if (mobPhase === "move" || mobPhase === "rest") { try{ mobRec.start(); }catch(e){} } };
      mobRec.start();
    }catch(e){}
  };
  const stopListening = ()=>{ if (mobRec){ mobRec.onend = null; try{ mobRec.stop(); }catch(e){} mobRec = null; } };
  const presentMove = ()=>{
    mobPhase = "move";
    const m = moves[mi];
    speak(m.n + ". " + m.d + " ... Let me know when you're ready to move on.");
    drawMob();
    if (m.s) startMobTimer(m.s, ()=> startTransition());
  };
  const startTransition = ()=>{
    mi++;
    if (mi >= moves.length){
      mobPhase = "done";
      stopListening(); mobDone(); drawMob();
      speak("That's the flow. Ten minutes well spent. Onto the bike.");
      return;
    }
    mobPhase = "rest";
    drawMob();
    speak("Thirty second rest. Get set for " + moves[mi].n + ".");
    startMobTimer(TRANSITION_S, presentMove);
  };
  // Manual/voice advance: skips whatever's currently running (a move's
  // hold or a rest) and moves straight to the next stage.
  const advance = ()=>{
    clearMobTimer();
    if (mi < 0){ mi = 0; presentMove(); return; }
    if (mobPhase === "rest"){ presentMove(); return; } // rest already advanced mi — go straight to the move
    startTransition();
  };
  drawMob();
  document.getElementById("mobNext").onclick = ()=>{
    if (mi < 0) listenForReady();
    advance();
    document.getElementById("mobRepeat").disabled = (mobPhase !== "move");
  };
  document.getElementById("mobRepeat").onclick = ()=>{
    if (mobPhase === "move"){
      const m = moves[mi];
      speak(m.n + ". " + m.d);
      if (m.s) startMobTimer(m.s, ()=> startTransition());
    }
  };

  wireCoach("activate");
};

/* ---------------- TRAIN (strength · ride · trainer ride) ---------------- */
V.train = async function(){
  view.innerHTML = `<span class="eyebrow">Train · ${esc(S.dayType||DAY_TYPES[0])}</span>
    <div class="card" id="trainRace"><h4>This week</h4><div class="small">reaching the bridge…</div></div>
    <div class="card"><h4>Strength</h4>
      <div class="small">70 lb kettlebell · Bowflex 5–52.5. S&C programming lands here — for now, tell the coach below when a session is done and it drains the week's strength bucket.</div></div>
    <div class="card"><h4>Ride — outdoor</h4>
      <div class="small">The Garmin Edge 1050 owns the in-ride experience. Pre-flight lives in Plan; post-ride sync lands in Fuel (workout debt) and, soon, Analyze.</div></div>
    <div class="card"><h4>Trainer ride — indoor</h4>
      <div class="small">Zwift owns execution; this becomes the cockpit companion — live power/cadence/HR decoupling via ANT+ (COOSPO + Kickr + H10), time-based fuel prompts. Coming with the analysis build.</div></div>
    ${coachCard("train")}`;
  bridge("/race").then(r=>{
    const rem = r.remaining || {}, done = r.done || {};
    const n = (v)=> (v==null ? 0 : v);
    document.getElementById("trainRace").innerHTML =
      `<h4>${(r.race&&r.race.name)||"Race"} · ${n(r.weeks_out)} weeks out · ${r.phase||""}</h4>
       <div class="small">Still owes: <b>${n(rem.aerobic_h)}h</b> aerobic · <b>${n(rem.hi_min)}min</b> hard · <b>${n(rem.strength)}</b> strength
       <br>(done: ${n(done.aerobic_h)}h / ${n(done.hi_min)}min / ${n(done.strength)})</div>`;
  }).catch(()=>{ document.getElementById("trainRace").innerHTML = `<h4>This week</h4><div class="small">bridge unreachable</div>`; });
  wireCoach("train");
};

/* ---------------- SLEEP (WHOOP) ---------------- */
V.sleep = async function(){
  view.innerHTML = `<span class="eyebrow">Sleep</span>
    <div class="card" id="sleepCard"><h4>Sleep</h4><div class="small">waiting for WHOOP…</div></div>
    ${coachCard("sleep")}`;
  bridge("/sleep/latest").then(s=>{
    const el = document.getElementById("sleepCard");
    if (s.sleep) el.innerHTML = `<h4>Slept ${s.sleep.performance ?? "—"} · ${s.sleep.hours ?? "—"} h</h4>
      <div class="small">recovery ${s.recovery?.score ?? "—"} · HRV ${s.recovery?.hrv ?? "—"} · RHR ${s.recovery?.rhr ?? "—"}</div>`;
    else el.innerHTML = `<h4>Sleep</h4><div class="small">no WHOOP data yet — connect at /whoop/auth on the bridge</div>`;
  }).catch(()=>{});
  wireCoach("sleep");
};

/* ---------------- ZONES ----------------
   The signature (TP, HIE, PP) fitted Xert's way to his own power, the
   power-duration curve with his bests on it, the three zones on the
   heart-rate and power scales (heart rate from the Tymewear ramp test), how
   the thresholds were found, and how the recent riding split across the
   zones. The seven-zone tables fold away underneath. */
V.zones = async function(){
  view.innerHTML = `<span class="eyebrow"><a href="#ride" style="color:inherit;text-decoration:none">Ride</a> · Zones</span><div id="zonesPage"><div class="card"><div class="small">reaching the bridge…</div></div></div>`;
  let z = null;
  try{ z = await bridge("/zones"); }catch(e){ document.getElementById("zonesPage").innerHTML = `<div class="card"><div class="small">bridge unreachable — ${esc(e.message)}</div></div>`; return; }
  const a = z.anchors, sg = z.signature || {}, sig = sg.signature, ZC = { z1:"var(--green)", z2:"var(--amber)", z3:"var(--red)" };
  const confC = c => c === "high" ? "var(--green)" : c === "medium" ? "var(--amber)" : "var(--red)";
  /* the power-duration curve: log time across, watts up; dots are his bests, the line the fitted curve */
  const pdHTML = ()=>{
    const pts = sg.points || [], curve = sg.curve || [];
    if (!pts.length) return `<div class="small">No power read yet. Tap "Read rides" to pull the last 90 days from Strava.</div>`;
    const W = 340, H = 170, L = 34, R = 8, T = 10, B = 24;
    const lx = t => Math.log(t), x0 = lx(1), x1 = lx(5400);
    const X = t => L + (lx(t) - x0) / (x1 - x0) * (W - L - R);
    const wmax = Math.max(...pts.map(p => p.watts), ...curve.map(c => c.watts)) * 1.05, wmin = 0;
    const Y = w => T + (1 - (w - wmin) / (wmax - wmin)) * (H - T - B);
    const line = curve.length ? `<path d="${curve.map((c, i) => (i ? "L" : "M") + X(c.dur_s).toFixed(1) + "," + Y(c.watts).toFixed(1)).join(" ")}" fill="none" stroke="#F2F1EC" stroke-width="2"></path>` : "";
    const dots = pts.map(p => `<circle cx="${X(p.dur_s).toFixed(1)}" cy="${Y(p.watts).toFixed(1)}" r="4" fill="${sig && p.watts > (curve.find(c => c.dur_s === p.dur_s) || {}).watts * 1.03 ? "var(--green)" : "#0F100E"}" stroke="#F2F1EC" stroke-width="2"><title>${p.dur_s < 60 ? p.dur_s + " s" : Math.round(p.dur_s / 60) + " min"} · ${p.watts} W · ${esc(p.name || "")} ${esc(p.date || "")}</title></circle>`).join("");
    const ticks = [[1,"1s"],[5,"5s"],[30,"30s"],[60,"1m"],[300,"5m"],[1200,"20m"],[3600,"1h"]].map(([t,l]) => `<text x="${X(t).toFixed(1)}" y="${H-6}" class="egt" text-anchor="middle">${l}</text>`).join("");
    const yt = [100,200,300,400,500,600,700,800,900,1000].filter(v => v < wmax).map(v => `<text x="${L-4}" y="${(Y(v)+3).toFixed(1)}" class="egt" text-anchor="end">${v}</text><line x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#F2F1EC" opacity=".12" stroke-dasharray="2 4"></line>`).join("");
    const tpLine = sig ? `<line x1="${L}" x2="${W-R}" y1="${Y(sig.tp).toFixed(1)}" y2="${Y(sig.tp).toFixed(1)}" stroke="var(--amber)" opacity=".8" stroke-dasharray="4 3"></line><text x="${W-R-2}" y="${(Y(sig.tp)-4).toFixed(1)}" class="egl" text-anchor="end">TP ${sig.tp}</text>` : "";
    const ftpLine = a.planning_ftp && (!sig || a.planning_ftp !== sig.tp) ? `<line x1="${L}" x2="${W-R}" y1="${Y(a.planning_ftp).toFixed(1)}" y2="${Y(a.planning_ftp).toFixed(1)}" stroke="#F2F1EC" opacity=".4" stroke-dasharray="2 3"></line><text x="${L+2}" y="${(Y(a.planning_ftp)-4).toFixed(1)}" class="egl">FTP ${a.planning_ftp}</text>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="egsvg pdsvg" preserveAspectRatio="none">${yt}${tpLine}${ftpLine}${line}${dots}${ticks}</svg>
      <div class="small">Dots are the best average power he has held for each length of time in the last ${sg.lookback_days || 90} days; the line is the curve the three numbers draw. A green dot sits above the curve: a breakthrough.</div>`;
  };
  const bests = sg.bests || {};
  const bestsHTML = [20,30,40,50,60].map(m => { const b = bests[m]; return `<li><span class="n"><b>${m} min</b>${b ? `<span class="small"> ${esc(b.name||"")} · ${esc(b.date||"")}</span>` : `<span class="small"> no ride that long with power yet</span>`}</span><span class="tag">${b ? `<b>${b.watts} W</b>${b.curve ? `<span class="small"> curve ${b.curve}</span>` : ""}` : "—"}</span></li>`; }).join("");
  const sigHTML = `
    <div class="sigrow">
      <div class="sigbox"><span class="slabel">Threshold</span><span class="signum">${sig ? sig.tp : "—"}</span><span class="small">W · TP${sig && sig.tp_floor != null && sig.tp_floor !== sig.tp ? ` · floor ${sig.tp_floor}` : ""}</span></div>
      <div class="sigbox"><span class="slabel">Tank above it</span><span class="signum">${sig ? sig.hie_kj : "—"}</span><span class="small">kJ · HIE</span></div>
      <div class="sigbox"><span class="slabel">Peak</span><span class="signum">${sig ? sig.pp : "—"}</span><span class="small">W · 5 s · PP</span></div>
    </div>
    <div class="small"><b style="color:${confC(sg.confidence)}">${esc(sg.confidence || "none")} confidence</b> · ${esc(sg.why || "")}${sg.newest_long_effort ? ` Newest long effort: ${esc(sg.newest_long_effort.name||"")}, ${sg.newest_long_effort.age_days} day${sg.newest_long_effort.age_days===1?"":"s"} ago.` : ""}</div>
    ${sig ? `<div class="small">Planning FTP is <b>${a.planning_ftp} W</b>${sig.tp !== a.planning_ftp ? `; the signature says <b>${sig.tp} W</b> (${sig.tp > a.planning_ftp ? "+" : ""}${sig.tp - a.planning_ftp}).` : ", the same as the signature."}</div>` : ""}
    ${sg.ramp ? `<div class="small"><b>Ramp test</b> ${esc(sg.ramp.date)}: best minute ${sg.ramp.one_min_w} W, which the ramp protocol reads as an FTP of about <b>${sg.ramp.ftp_est} W</b> (75% of the best minute). A ramp test is maximal by design, so this is a measurement; the signature's TP is a curve through everything since.</div>` : ""}
    ${pdHTML()}
    <ul class="agenda totals">${bestsHTML}</ul>
    ${(sg.breakthroughs||[]).length ? `<div class="small"><b>Breakthroughs</b> (a ride that beat the signature of the day before; the gold medal on the calendar):</div><ul class="agenda totals">${sg.breakthroughs.slice(-5).reverse().map(b => `<li><span class="t">${esc(b.date.slice(5).replace("-","/"))}</span><span class="n">${MEDAL}${esc(b.name)}<span class="small"> ${esc(b.text||"")}</span></span></li>`).join("")}</ul>` : `<div class="small">No breakthrough yet in the last ${sg.lookback_days||90} days: no ride has beaten the curve the rides before it drew. One all-out 5-minute effort and one 20-second effort would do it, and set TP.</div>`}
    <div class="rowbtns">
      <button id="sigScan" class="btn">${sg.left == null ? "Read rides" : sg.left > 0 ? `Read rides (${sg.left} unread of ${sg.total})` : `All ${sg.total||0} rides read · read again`}</button>
      ${sig && sig.tp !== a.planning_ftp && (sg.confidence === "high" || sg.confidence === "medium") ? `<button id="sigUse" class="btn">Set planning FTP to ${sig.tp} W</button>` : ""}
    </div>
    <div class="small" id="sigMsg"></div>
    <details class="why"><summary>the math</summary><div class="small">Three numbers, Xert's signature: threshold power TP, high-intensity energy HIE (the tank of work above TP, in kilojoules), and peak power PP. They draw one curve, Morton's three-parameter critical-power model: P(t) = TP + (HIE ÷ t) × (1 − e<sup>−t·(PP−TP)/HIE</sup>), which runs to PP at zero seconds and settles on TP as time grows. The curve is fitted to your mean-maximal power over the last 90 days, weighted toward the long durations since TP is what the plan runs on. Maximal Power Available follows second by second: above TP the tank drains at the surplus watts, below TP it refills in proportion to what is missing (Skiba's differential model); power above it is a breakthrough and the signature moves. Xert's exact recovery curve is proprietary; this uses the published physiology it rests on. Nothing here changes the planning FTP on its own.</div></details>`;
  // the scale: heart rate on top, power beneath, the same three bands on each
  const hrLo = 90, hrHi = a.max_hr, pLo = Math.round(a.ftp*0.45), pHi = Math.round(a.ftp*1.25);
  const hx = v => Math.max(0, Math.min(100, (v-hrLo)/(hrHi-hrLo)*100)), px = v => Math.max(0, Math.min(100, (v-pLo)/(pHi-pLo)*100));
  const band = (x0, x1, c) => `<i style="left:${x0.toFixed(1)}%;width:${(x1-x0).toFixed(1)}%;background:${c}"></i>`;
  const mark = (x, label, below, left) => `<b style="left:${x.toFixed(1)}%" class="${below?"below":""}${left?" left":""}"><span>${label}</span></b>`;
  const scaleHTML = `<div class="zscale">
      <div class="zlab">Heart rate</div>
      <div class="ztrack">${band(0, hx(a.vt1), ZC.z1)}${band(hx(a.vt1), hx(a.vt2), ZC.z2)}${band(hx(a.vt2), 100, ZC.z3)}
        ${mark(hx(a.vt1), a.vt1)}${mark(hx(a.vt2), a.vt2, false, true)}${mark(hx(a.vo2_line), a.vo2_line + " VO2")}${mark(100, a.max_hr + " max", true, true)}</div>
      <div class="zlab">Power</div>
      <div class="ztrack">${band(px(Math.round(a.ftp*0.5)), px(a.vt1_power), ZC.z1)}${band(px(a.vt1_power), px(Math.round(a.ftp*0.95)), ZC.z2)}${band(px(Math.round(a.ftp*0.95)), 100, ZC.z3)}
        ${mark(px(a.vt1_power), a.vt1_power + " W")}${mark(px(Math.round(a.ftp*0.95)), Math.round(a.ftp*0.95) + " W")}${mark(px(a.ftp), (a.tp ? "TP " : "FTP ") + a.ftp, true)}</div>
    </div>`;
  const threeHTML = z.three.map(t => `<li class="zrow" style="border-left-color:${ZC[t.key]}">
      <span class="n"><b>${esc(t.name)}</b> <span class="small">${esc(t.what)}</span>
        <span class="small">HR ${esc(t.hr.cue)} · ${t.power.lo}${t.power.hi?"–"+t.power.hi:"+"} W (${esc(t.power.pct)})${t.sessions.length?` · ${esc(t.sessions.length === 1 ? t.sessions[0] : t.sessions[0].replace(/,.*$/, "") + " rides")}`:""}</span>
        <span class="small zwhy">${esc(t.why)}</span></span>
      <span class="tag"><b>${t.target_pct}%</b><span class="small">target</span></span></li>`).join("");
  /* heart rate from breathing: the Tymewear test and the ventilation points */
  const tst = z.test, vp = (z.ventilation && z.ventilation.points) || [], bp = z.ventilation && z.ventilation.breakpoints;
  const ventChart = ()=>{
    if (vp.length < 6) return "";
    const W = 340, H = 150, L = 30, R = 8, T = 10, B = 24;
    const pmin = Math.min(...vp.map(p=>p.power)), pmax = Math.max(...vp.map(p=>p.power)), vmax = Math.max(...vp.map(p=>p.ve)) * 1.05;
    const X = p => L + (p - pmin) / Math.max(1, pmax - pmin) * (W - L - R), Y = v => T + (1 - v / vmax) * (H - T - B);
    const dots = vp.map(p => `<circle cx="${X(p.power).toFixed(1)}" cy="${Y(p.ve).toFixed(1)}" r="3" fill="${p.confounded?"#0F100E":"#F2F1EC"}" stroke="#F2F1EC" stroke-width="1.5"></circle>`).join("");
    const vl = (w, lab, c) => w ? `<line x1="${X(w).toFixed(1)}" x2="${X(w).toFixed(1)}" y1="${T}" y2="${H-B}" stroke="${c}" stroke-dasharray="4 3"></line><text x="${(X(w)+3).toFixed(1)}" y="${T+10}" class="egl">${lab} ${w} W</text>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="egsvg" preserveAspectRatio="none">${dots}${vl(bp && bp.vt1_power, "VT1", ZC.z2)}${vl(bp && bp.vt2_power, "VT2", ZC.z3)}<text x="${L}" y="${H-6}" class="egt">${pmin} W</text><text x="${W-R}" y="${H-6}" class="egt" text-anchor="end">${pmax} W</text><text x="${L-4}" y="${T+8}" class="egt" text-anchor="end">VE</text></svg>
      <div class="small">Ventilation (litres a minute) against power from your steady rides, each dot a steady stretch of three minutes or more. ${bp && bp.vt1_power ? `The slope breaks at ${bp.vt1_power} W (VT1)${bp.vt2_power ? ` and ${bp.vt2_power} W (VT2)` : ""}${bp.stability ? ", " + esc(bp.stability) : ""}.` : (bp && bp.reason ? esc(bp.reason) : "")}</div>`;
  };
  const testHTML = `
    <div class="small">${esc(a.hr_source)}${tst ? `: VT1 ${tst.vt1_power ? tst.vt1_power + " W · " : ""}${tst.vt1_hr || "—"} bpm, VT2 ${tst.vt2_power ? tst.vt2_power + " W · " : ""}${tst.vt2_hr || "—"} bpm.` : "."}</div>
    ${ventChart()}
    <details class="why"><summary>enter a Tymewear ramp test</summary>
      <div class="row2"><span><label>VT1 power (W)</label><input id="zVt1P" type="number" value="${tst && tst.vt1_power ? tst.vt1_power : ""}"></span><span><label>VT1 heart rate</label><input id="zVt1H" type="number" value="${tst && tst.vt1_hr ? tst.vt1_hr : a.vt1}"></span></div>
      <div class="row2"><span><label>VT2 power (W)</label><input id="zVt2P" type="number" value="${tst && tst.vt2_power ? tst.vt2_power : ""}"></span><span><label>VT2 heart rate</label><input id="zVt2H" type="number" value="${tst && tst.vt2_hr ? tst.vt2_hr : a.vt2}"></span></div>
      <div class="row2"><span><label>Test date</label><input id="zDate" type="date" value="${tst && tst.date ? String(tst.date).slice(0,10) : ""}"></span><span><label>&nbsp;</label><button class="primary" id="zSave">Save the test</button></span></div>
      <div class="small" id="zMsg">The heart rates set the three zones; VT2 power, discounted 7.5% for a ramp's short stages, is one more signal for FTP.</div>
    </details>
    <details class="why"><summary>how the thresholds are found</summary><div class="small">Tymewear's sensor reads breathing (ventilation and breathing rate) from the chest strap; its own algorithm is proprietary, but the science it implements is published and validated against gas exchange: the first ventilatory threshold is where ventilation first rises faster than work rate (Wasserman and Beaver's V-slope and ventilatory-equivalent methods, 1986), the second where it rises steeply again as breathing compensates for acid (the respiratory compensation point). From ventilation alone, both appear as breaks in the slope of VE against power, found by two-segment regression (Orr 1982) or the Dmax method (Cheng 1992). This app does the same with your steady rides: ventilation is binned by power and the slope jumps are the thresholds, cross-checked by fitting each half of the data separately. The ramp test you type in is the anchor; the ride data tells you when it has moved. Heart-rate zones are set from these thresholds, never from a percentage of a guessed maximum.</div></details>`;
  const stack = (s) => s && s.z1_pct != null ? `<div class="zstack">${["z1","z2","z3"].map(k => s[k+"_pct"] ? `<i style="width:${s[k+"_pct"]}%;background:${ZC[k]}" title="${k} ${s[k+"_min"]} min">${s[k+"_pct"] >= 12 ? s[k+"_pct"] + "%" : ""}</i>` : "").join("")}</div>` : "";
  const splitHTML = (title, s) => `<div class="zsplit"><div class="small"><b>${title}</b> · ${s.rides} ride${s.rides===1?"":"s"}, ${durLabel(s.minutes)}${s.with_data < s.rides ? ` · ${s.rides - s.with_data} without ${s.by === "power" ? "power" : "heart rate"}` : ""}</div>
      ${stack(s)}
      <div class="small">${s.verdict.word ? `<b style="color:${s.verdict.key==="green"?"var(--green)":s.verdict.key==="red"?"var(--red)":"var(--amber)"}">${esc(s.verdict.word)}</b> · ` : ""}${esc(s.verdict.text)}${s.hard_min ? ` · ${s.hard_min} min above ${a.vo2_line}` : ""}</div></div>`;
  const rideRow = r => `<li><span class="t">${esc(r.date.slice(5).replace("-", "/"))}</span><span class="n">${esc(r.name)}<span class="small"> ${r.minutes} min${r.np?` · NP ${r.np} W`:""}${r.avg_hr?` · ${r.avg_hr} bpm`:""}${r.hard_min?` · ${r.hard_min} min above ${a.vo2_line}`:""}</span>
      ${r.p1_min != null ? `<span class="small">power ${r.p1_min} / ${r.p2_min} / ${r.p3_min} min</span>` : r.z1_min != null ? `<span class="small">HR ${r.z1_min} / ${r.z2_min} / ${r.z3_min} min${r.estimated?" (estimated)":""}</span>` : `<span class="small">no stream read yet</span>`}</span>
      <span class="tag">${r.p1_min != null ? stack({ z1_pct: Math.round(r.p1_min/(r.p1_min+r.p2_min+r.p3_min||1)*100), z2_pct: Math.round(r.p2_min/(r.p1_min+r.p2_min+r.p3_min||1)*100), z3_pct: Math.round(r.p3_min/(r.p1_min+r.p2_min+r.p3_min||1)*100), z1_min:r.p1_min, z2_min:r.p2_min, z3_min:r.p3_min }) : ""}</span></li>`;
  const zoneTable = (rows, unit)=> `<ul class="agenda totals">${rows.map(zz=>`<li><span class="n"><b>${zz.zone}</b> ${esc(zz.name)} <span class="small">${esc(zz.pct)}</span></span><span class="tag">${zz.from}${zz.to?"–"+zz.to:"+"} ${unit}</span></li>`).join("")}</ul>`;
  document.getElementById("zonesPage").innerHTML = `
    <div class="card"><h4>The signature</h4>${sigHTML}</div>
    <div class="card"><h4>The three zones</h4>
      ${scaleHTML}
      <ul class="agenda zthree">${threeHTML}</ul>
      <div class="small">${esc(a.note)}</div>
    </div>
    <div class="card"><h4>Heart rate from breathing</h4>${testHTML}</div>
    <div class="card"><h4>Time in zone</h4>
      ${z.connected ? `${splitHTML("This week, by power", z.time.power_week)}${splitHTML("Four weeks, by power", z.time.power_month)}
        <details class="why"><summary>by heart rate</summary>${splitHTML("This week", z.time.week)}${splitHTML("Four weeks", z.time.month)}</details>` : `<div class="small">Strava is not answering, so there are no rides to split.</div>`}
      <details class="why"><summary>the target</summary><div class="small">Polarised: about ${z.target.z1}% of the minutes in Zone 1, ${z.target.z3}% in Zone 3, and as little as possible between the thresholds. Power is the cleaner read of Zone 1 discipline (heart rate drifts with heat, coffee and a poor night); the VO2 line is on heart rate.</div></details>
    </div>
    ${z.rides && z.rides.length ? `<div class="card"><h4>Recent rides</h4><ul class="agenda zrides">${z.rides.map(rideRow).join("")}</ul><div class="small">Zone 1 / 2 / 3 minutes. Rides read for the first time land here on the next look.</div></div>` : ""}
    <div class="card"><details class="why"><summary>Seven power zones · ${a.tp ? "TP" : "FTP"} ${a.ftp} W</summary>${zoneTable(z.power_zones, "W")}</details>
      <details class="why"><summary>Seven heart-rate zones · threshold ${a.vt2} bpm</summary>${zoneTable(z.hr_zones, "bpm")}<div class="small">Anchored to threshold heart rate, never to a max-HR guess.</div></details></div>`;
  // read rides a few at a time until none are left
  const scanBtn = document.getElementById("sigScan");
  if (scanBtn) scanBtn.onclick = async ()=>{
    scanBtn.disabled = true; const msg = document.getElementById("sigMsg");
    try{
      let rounds = 0, left = null;
      do { const r = await bridge("/signature/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ n: 3 })}); left = r.left; msg.textContent = `Read ${r.read.filter(x=>x.ok).length} ride${r.read.length===1?"":"s"}${left ? `, ${left} to go…` : ", done."}`; rounds++; } while (left > 0 && rounds < 8);
      if (location.hash.split("?")[0] === "#zones") V.zones();
    }catch(e){ msg.textContent = e.message; scanBtn.disabled = false; }
  };
  const useBtn = document.getElementById("sigUse");
  if (useBtn) useBtn.onclick = async ()=>{
    if (!confirm(`Set the planning FTP to ${sig.tp} W? Every power target and zone follows it.`)) return;
    useBtn.disabled = true;
    try{ await bridge("/workouts/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({ ftp: sig.tp, lthr: a.vt2, hr_rest: a.hr_rest })}); V.zones(); }
    catch(e){ document.getElementById("sigMsg").textContent = e.message; useBtn.disabled = false; }
  };
  const saveBtn = document.getElementById("zSave");
  if (saveBtn) saveBtn.onclick = async ()=>{
    const v = id => { const x = +document.getElementById(id).value; return x > 0 ? x : null; };
    const msg = document.getElementById("zMsg"); saveBtn.disabled = true;
    try{
      await bridge("/fitness/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ vt1_power: v("zVt1P"), vt1_hr: v("zVt1H"), vt2_power: v("zVt2P"), vt2_hr: v("zVt2H"), date: document.getElementById("zDate").value || undefined })});
      msg.textContent = "Saved. The zones now hang on it."; V.zones();
    }catch(e){ msg.textContent = e.message; saveBtn.disabled = false; }
  };
};

/* ---------------- LIFT ----------------
   The weight training: two sessions that alternate, each exercise with the
   target the last time worked out (double progression), logged set by set;
   strength over time as an estimated one-rep max; the history. */
V.lift = async function(){
  view.innerHTML = `<span class="eyebrow">Lift</span><div id="liftPage"><div class="card"><div class="small">reaching the bridge…</div></div></div>`;
  let L = null;
  try{ L = await bridge("/lifts"); }catch(e){ document.getElementById("liftPage").innerHTML = `<div class="card"><div class="small">bridge unreachable — ${esc(e.message)}</div></div>`; return; }
  const p = Object.fromEntries(new URLSearchParams(location.hash.split("?")[1]||"")); const key = L.templates.some(t => t.key === p.t) ? p.t : L.next;
  const T = L.templates.find(t => t.key === key);
  const others = L.templates.filter(t => t.key !== key);
  const today = localDateKey();
  const unit = e => e.kind === "time" ? "s" : e.kind === "reps" ? "reps" : "lb";
  const exHTML = (e, i) => `<li class="lex" data-i="${i}">
      <div class="lexhead"><span class="n"><b>${esc(e.name)}</b> <span class="small">${e.sets} × ${e.reps_lo}–${e.reps_hi}${e.kind==="time"?" s":""} · rest ${e.rest_min} min</span>${e.note?`<span class="small lnote">${esc(e.note)}</span>`:""}</span>
        <span class="tag"><b style="color:${e.target.progress?"var(--green)":e.target.back?"var(--amber)":"var(--ink)"}">${e.kind==="time"||e.kind==="reps" ? e.target.reps + (e.kind==="time"?" s":" reps") : e.target.lb + " lb × " + e.target.reps}</b></span></div>
      <div class="small">${esc(e.target.why)}${e.last ? ` · last: ${esc(e.last.date)}, ${e.last.sets.map(s => (s.lb ? s.lb + "×" : "") + s.reps).join(", ")}` : ""}</div>
      <div class="lsets">${Array.from({ length: e.sets }, (_, k) => `<span class="lset"><label>set ${k+1}</label>${e.kind==="time"||e.kind==="reps" ? "" : `<input type="number" class="llb" inputmode="numeric" value="${e.target.lb}" aria-label="pounds"><span class="small">lb ×</span>`}<input type="number" class="lreps" inputmode="numeric" value="${e.target.reps}" aria-label="${unit(e)}"><span class="small">${e.kind==="time"?"s":"reps"}</span></span>`).join("")}</div>
    </li>`;
  const spark = (rows)=>{
    if (!rows || rows.length < 2) return "";
    const W = 120, H = 28, xs = rows.map((_, i) => i / (rows.length - 1) * (W - 6) + 3), lo = Math.min(...rows.map(r => r.e1rm)), hi = Math.max(...rows.map(r => r.e1rm)), span = Math.max(5, hi - lo);
    const Y = v => 4 + (1 - (v - lo) / span) * (H - 8);
    return `<svg viewBox="0 0 ${W} ${H}" class="lspark" preserveAspectRatio="none"><path d="${rows.map((r, i) => (i ? "L" : "M") + xs[i].toFixed(1) + "," + Y(r.e1rm).toFixed(1)).join(" ")}" fill="none" stroke="currentColor" stroke-width="2"></path></svg>`;
  };
  const hist = Object.entries(L.history || {});
  const shortOf = k => (L.templates.find(t => t.key === k) || {}).short || "";
  const dayLine = x => x.ride ? esc(x.ride.name.replace(/^Zwift - Intervals icu: /i, "").replace(/^VO2 max: Zwift /i, "VO2 ").slice(0, 18)) : x.long_coaching ? `coaching ${Math.round(x.coaching_min/60)} h` : "off the bike";
  const legsDay = (L.week||[]).find(x => x.lift === "legs");
  const weekHTML = (L.week||[]).length ? `<div class="card"><h4>This week · ${esc(L.plan||"")}</h4>
      <div class="lweek">${L.week.map(x => `<a class="lday${x.lift?"":" off"}${x.done?" done":""}${x.date===today?" today":""}" href="#lift?t=${esc(x.lift||L.next)}" title="${esc(x.why||"")}">
        <span class="ld">${esc(String(x.label||x.date).split(" ").slice(0,1).join(""))} ${esc(x.date.slice(8).replace(/^0/,""))}</span>
        <b>${x.lift ? esc(shortOf(x.lift)) : "—"}</b>
        <span class="small">${dayLine(x)}</span></a>`).join("")}</div>
      <div class="small">${legsDay ? `Legs ${esc(legsDay.label||legsDay.date)}: ${esc(legsDay.why)}.` : ""} The two days with no lift are the two biggest riding days.</div>
      <div class="small">${L.this_week} of ${L.target_per_week} this week · week ${L.week_no}${L.deload ? ` · <b style="color:var(--amber)">deload</b>` : ""}${L.last ? ` · last: ${esc(L.last.name||"")}, ${esc(L.last.date)}` : ""}</div>
      ${L.deload_note ? `<div class="cue">${esc(L.deload_note)}</div>` : ""}
      <div class="rowbtns"><button id="lWeek">Put the week on the calendar</button></div><div class="small" id="lWeekMsg"></div>
    </div>` : "";
  document.getElementById("liftPage").innerHTML = `
    ${weekHTML}
    <div class="card"><h4>${esc(T.name)}${T.short && /Upper/.test(T.name) ? ` <span class="small">(${esc(T.short)})</span>` : ""}${key === L.next ? ` · next up${L.next_date && L.next_date !== today ? ", " + esc(L.next_date.slice(5).replace("-","/")) : ""}` : ""}</h4>
      <div class="small">${esc(T.why)}</div>
      <div class="small">${T.hard_sets} hard sets · about ${T.minutes} min · switch to ${others.map(o => `<a href="#lift?t=${esc(o.key)}">${esc(o.short)}</a>`).join(" · ")}</div>
      <ul class="agenda lexlist">${T.exercises.map(exHTML).join("")}</ul>
      <label for="lNotes">Notes</label><input id="lNotes" placeholder="how it felt, anything that hurt">
      <div class="rowbtns"><button class="primary" id="lSave">Save the session</button><button id="lPlan">Put this one on the calendar</button></div>
      <div class="small" id="lMsg"></div>
      <details class="why"><summary>how the targets move</summary><div class="small">Mike Matthews' double progression (Bigger Leaner Stronger). The big lifts work in 4 to 6 reps, about 80 to 85% of a one-rep max, three minutes between hard sets; the small lifts in 6 to 8 or 8 to 10. When a hard set reaches the top of its range the weight goes up next time (ten pounds on the Bowflex, the next bell for a kettlebell, five on a small lift) and the reps drop back to the bottom; a set that cannot reach the bottom of the range takes the weight back a step. Nine to twelve hard sets a session, each of the five once every seven days, eight weeks on and then a deload. Legs is the cycling day of the five, so it goes the day before a day off the bike or a long coaching day, where the soreness costs no ride. The lifts are the book's, on the kettlebells and the Bowflex; the barbell original is in each note for a gym.</div></details>
    </div>
    ${hist.length ? `<div class="card"><h4>Strength</h4><ul class="agenda totals">${hist.map(([name, rows]) => `<li><span class="n">${esc(name)}<span class="small"> ${rows.length} session${rows.length===1?"":"s"} · top set ${rows[rows.length-1].top_lb} lb</span></span><span class="tag"><b>${rows[rows.length-1].e1rm}</b> <span class="small">1RM</span> ${spark(rows)}</span></li>`).join("")}</ul><div class="small">Estimated one-rep max (Epley), the best set of each session. This is where lifting shows up: not in the ride CTL.</div></div>` : ""}
    ${L.sessions && L.sessions.length ? `<div class="card"><h4>Sessions</h4><ul class="agenda">${L.sessions.map(s => `<li><span class="t">${esc(s.date.slice(5).replace("-","/"))}</span><span class="n">${esc(s.name)}<span class="small"> ${s.exercises.map(e => `${e.name.replace(/^(Kettlebell|Bowflex) /, "")} ${e.sets.map(x => (x.lb ? x.lb + "×" : "") + x.reps).join(",")}`).join(" · ")}${s.notes ? " · " + esc(s.notes) : ""}</span></span><span class="tag">${(s.volume_lb/1000).toFixed(1)}k lb <button class="tdel" data-dell="${esc(s.id)}" aria-label="Remove">${TRASH}</button></span></li>`).join("")}</ul></div>` : ""}`;
  document.getElementById("lSave").onclick = async ()=>{
    const btn = document.getElementById("lSave"), msg = document.getElementById("lMsg"); btn.disabled = true;
    const exercises = [...document.querySelectorAll("#liftPage .lex")].map(li => { const e = T.exercises[+li.dataset.i]; return { name: e.name, sets: [...li.querySelectorAll(".lset")].map(sp => ({ reps: +(sp.querySelector(".lreps")||{}).value || 0, lb: +((sp.querySelector(".llb")||{}).value) || 0 })) }; });
    try{ await bridge("/lifts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ template: key, exercises, notes: document.getElementById("lNotes").value })}); msg.textContent = "Saved."; location.hash = "#lift"; V.lift(); }
    catch(e){ msg.textContent = e.message; btn.disabled = false; }
  };
  document.getElementById("lPlan").onclick = async ()=>{
    const msg = document.getElementById("lMsg");
    const when = prompt("Which day? (YYYY-MM-DD, blank for today) and time, like 2026-11-02 07:00", localDateKey() + " 07:00");
    if (when == null) return;
    const m = /^(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2})?/.exec(when.trim()); if (!m){ msg.textContent = "Did not understand the day."; return; }
    try{ await bridge("/workouts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ name: T.name, sport: "WeightTraining", date: m[1], time: m[2] || null, notes: "Log it on the Lift tab.", steps: [{ kind: "step", label: "Lift", dur_s: T.minutes * 60, target: { type: "free" } }] })}); msg.textContent = `On the calendar: ${T.name}, ${m[1]}${m[2] ? " at " + hm12(m[2]) : ""}.`; }
    catch(e){ msg.textContent = e.message; }
  };
  const wk = document.getElementById("lWeek");
  if (wk) wk.onclick = async ()=>{
    const msg = document.getElementById("lWeekMsg");
    const t = prompt("What time, most days? (like 07:00 or 17:30)", "07:00"); if (t == null) return;
    if (!/^\d{2}:\d{2}$/.test(t.trim())) { msg.textContent = "Did not understand the time."; return; }
    wk.disabled = true; msg.textContent = "Placing…";
    try{ const r = await bridge("/lifts/schedule",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ time: t.trim() })}); msg.textContent = `${r.added.length} put on the calendar at ${hm12(r.time)}${r.kept.length ? `; ${r.kept.length} day${r.kept.length===1?" already had":"s already had"} a lift` : ""}.`; }
    catch(e){ msg.textContent = e.message; wk.disabled = false; }
  };
  document.querySelectorAll("[data-dell]").forEach(b => b.onclick = async ()=>{ if (!confirm("Remove this session?")) return; try{ await bridge("/lifts/" + encodeURIComponent(b.dataset.dell), { method: "DELETE" }); V.lift(); }catch(e){ document.getElementById("lMsg").textContent = e.message; } });
};

/* ---------------- ANALYZE (weigh-in, W/kg — ride analysis coming) ---------------- */
V.analyze = async function(){
  view.innerHTML = `<span class="eyebrow">Analyze</span>
    <div class="card" id="weigh"><h4>Step on the scale</h4><div class="small">waiting for the weigh-in…</div></div>
    <div class="card" id="sig"><h4>The Signature</h4><div class="small">reaching the bridge…</div></div>
    <div class="card" id="zonesCard"><h4>Zones</h4><div class="small">waiting for an FTP…</div></div>
    <div class="card" id="signals"><h4>Signals</h4><div class="small">reaching the bridge…</div></div>
    <div class="card"><h4>Log a Tymewear ramp test</h4>
      <div class="small">Tymewear has no API, so the test goes in by hand. FTP is taken as VT2 × 0.925 — the ramp's 3-minute stages overstate sustainable power by 5–10%. A test sets FTP for 60 days.</div>
      <div class="row2"><span><label>VT2 power (W)</label><input id="tVt2P" type="number"></span>
        <span><label>VT2 HR (bpm)</label><input id="tVt2H" type="number"></span></div>
      <div class="row2"><span><label>VT1 power (W)</label><input id="tVt1P" type="number"></span>
        <span><label>VT1 HR (bpm)</label><input id="tVt1H" type="number"></span></div>
      <button class="primary" id="tSave">Save test</button>
      <div class="small" id="tMsg"></div></div>
    <div class="card"><h4>Pin FTP by hand</h4>
      <div class="small">For a real-world effort the app didn't see. A pin outranks every signal until you clear it.</div>
      <div class="row2"><span><label>FTP (W)</label><input id="ovFtp" type="number"></span>
        <span><label>Threshold HR</label><input id="ovHr" type="number"></span></div>
      <button id="ovSave">Pin</button> <button id="ovClear">Clear pin</button>
      <div class="small" id="ovMsg"></div></div>
    <div class="card" id="ftpLog"><h4>Why FTP changed</h4><div class="small">reaching the bridge…</div></div>
    <div class="card"><h4>Ride analysis</h4>
      <div class="small">Still to come: post-ride session verdicts (NP · IF · TSS · decoupling · interval grading), power duration curve with "closest signature to a breakthrough," and W&#8242; balance.</div></div>
    ${coachCard("analyze")}`;

  const zoneTable = (rows, unit)=> `<ul class="agenda totals">${rows.map(z=>
    `<li><span class="n"><b>${z.zone}</b> ${esc(z.name)} <span class="small">${esc(z.pct)}</span></span>
      <span class="tag">${z.from}${z.to?"–"+z.to:"+"} ${unit}</span></li>`).join("")}</ul>`;

  const refreshSig = async ()=>{
    try{
      const f = await bridge("/fitness");
      document.getElementById("sig").innerHTML = f.ftp
        ? `<h4>The Signature</h4>
           <div class="bignum">${f.ftp} W</div>
           <div class="small">${esc(f.source||"")} · confidence ${esc(f.confidence||"")}${
             f.threshold_hr?` · threshold HR <b>${f.threshold_hr}</b>`:""}</div>
           ${f.threshold_hr_source?`<div class="small">HR basis: ${esc(f.threshold_hr_source)}</div>`:""}
           ${(f.notes||[]).map(n=>`<div class="small">• ${esc(n)}</div>`).join("")}
           <button id="sigScan">Re-read recent rides</button>
           <div class="small" id="sigMsg">${f.counts?`${f.counts.efforts} efforts · ${f.counts.rides_scanned} rides scanned · ${f.counts.segments} breathing segments`:""}</div>`
        : `<h4>The Signature</h4><div class="small">No FTP yet. ${(f.notes||[]).map(esc).join(" ")}</div>
           <button id="sigScan">Scan recent rides</button><div class="small" id="sigMsg"></div>`;
      document.getElementById("zonesCard").innerHTML = f.power_zones
        ? `<h4>Power zones · FTP ${f.ftp} W</h4>${zoneTable(f.power_zones,"W")}
           ${f.hr_zones ? `<h4 style="margin-top:14px">HR zones · threshold ${f.threshold_hr} bpm</h4>${zoneTable(f.hr_zones,"bpm")}
             <div class="small">Anchored to threshold HR, never to a max-HR guess.</div>`
             : `<div class="small">No threshold HR yet — HR zones need a test or a qualifying effort with HR.</div>`}`
        : `<h4>Zones</h4><div class="small">Zones appear once there's an FTP.</div>`;
      const s = f.signals || {};
      const vent = s.ventilatory;
      document.getElementById("signals").innerHTML = `<h4>Signals</h4>
        <ul class="agenda totals">
          <li><span class="n">Dedicated test <span class="small">VT2 × 0.925</span></span><span class="tag">${
            s.test ? s.test.ftp+" W" : "none"}</span></li>
          <li><span class="n">eFTP <span class="small">${s.eftp?`best ${s.eftp.from.minutes} min, decay ${s.eftp.decay}`:"no qualifying effort"}</span></span>
            <span class="tag">${s.eftp ? s.eftp.ftp+" W" : "—"}</span></li>
          <li><span class="n">Ventilatory <span class="small">${
            vent ? (vent.ok ? esc(vent.stability||"") : esc(vent.reason||"")) : "no breathing data"}</span></span>
            <span class="tag">${vent && vent.ok ? vent.ftp+" W" : "—"}</span></li>
        </ul>
        <div class="small">Breathing data posts to /fitness/breathing — no automatic feed until FIT ingestion exists.</div>`;
      const scan = document.getElementById("sigScan");
      if (scan) scan.onclick = async ()=>{
        scan.disabled = true; scan.textContent = "Reading streams…";
        try{
          const r = await bridge("/fitness/backfill?n=20");
          document.getElementById("sigMsg").textContent = `Scanned ${r.scanned} rides.`;
          refreshSig();
        }catch(e){ document.getElementById("sigMsg").textContent = "Failed: " + e.message;
          scan.disabled = false; scan.textContent = "Re-read recent rides"; }
      };
      const lg = await bridge("/fitness/log").catch(()=>({log:[]}));
      document.getElementById("ftpLog").innerHTML = `<h4>Why FTP changed</h4>` + ((lg.log||[]).length
        ? `<ul class="agenda totals">${lg.log.slice(0,8).map(l=>
            `<li><span class="n">${new Date(l.at).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
              <span class="small">${esc(l.reason)} · ${esc(l.source||"")}</span></span>
             <span class="tag">${l.ftp} W${l.delta!=null?` <b>${l.delta>0?"+":""}${l.delta}</b>`:""}</span></li>`).join("")}</ul>`
        : `<div class="small">Nothing yet — every change lands here with what caused it.</div>`);
    }catch(e){
      document.getElementById("sig").innerHTML = `<h4>The Signature</h4><div class="small">bridge unreachable — ${esc(e.message)}</div>`;
    }
  };
  refreshSig();

  document.getElementById("tSave").onclick = async ()=>{
    const vt2 = +document.getElementById("tVt2P").value;
    if (!vt2){ document.getElementById("tMsg").textContent = "VT2 power is required."; return; }
    try{
      const r = await bridge("/fitness/test",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ vt2_power:vt2, vt2_hr:+document.getElementById("tVt2H").value||null,
          vt1_power:+document.getElementById("tVt1P").value||null, vt1_hr:+document.getElementById("tVt1H").value||null })});
      document.getElementById("tMsg").textContent = `Saved — FTP ${r.ftp} W from VT2 ${vt2} W.`;
      refreshSig();
    }catch(e){ document.getElementById("tMsg").textContent = "Failed: " + e.message; }
  };
  const override = async (body, msg)=>{
    try{
      const r = await bridge("/fitness/override",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      document.getElementById("ovMsg").textContent = msg + " — now " + r.ftp + " W (" + r.source + ").";
      refreshSig();
    }catch(e){ document.getElementById("ovMsg").textContent = "Failed: " + e.message; }
  };
  document.getElementById("ovSave").onclick = ()=> override(
    { ftp:+document.getElementById("ovFtp").value, threshold_hr:+document.getElementById("ovHr").value||null }, "Pinned");
  document.getElementById("ovClear").onclick = ()=> override({clear:true}, "Pin cleared");

  let announced = sessionStorage.getItem("wkg-announced");
  // W/kg must quote the same FTP the Signature above is showing — the
  // Signature is the source of truth, /profile only the fallback.
  let __ftp = 195;
  bridge("/fitness").then(f=>{ if (f && f.ftp) __ftp = f.ftp; })
    .catch(()=> bridge("/profile").then(p=>{ if(p&&p.ftp) __ftp=p.ftp; }).catch(()=>{}));
  const pollWeight = async ()=>{
    try{
      const t = await bridge("/weigh-in");
      if (t.latest){
        const wkg = (__ftp/(t.latest.lb/2.20462)).toFixed(2);
        document.getElementById("weigh").innerHTML =
          `<h4>${t.latest.lb} lb ${t.latest.logged_today?"· today ✓":"· yesterday"}</h4>
           <div class="small">7-day trend ${t.ma7_lb ?? "—"} · ${t.week_change_lb ?? "—"} this week</div>
           <div class="small"><b>FTP ${__ftp}W · ${wkg} W/kg</b></div>`;
        // (this used to speak the number aloud on the cockpit device; device
        // roles are gone, and unprompted speech on a phone is not wanted)
      }
    }catch(e){ document.getElementById("weigh").innerHTML =
      `<h4>Weigh-in</h4><div class="small">bridge unreachable — <a href="#today">log it on the day</a></div>`; }
  };
  pollWeight(); const wp = setInterval(()=>{ if(location.hash!=="#analyze") clearInterval(wp); else pollWeight(); }, 10000);
  wireCoach("analyze");
};

/* ---------------- TODAY — the front page ----------------
   One timeline per day, every day starting with today. Four lanes feed it:
   the Google calendars (life + 16 ECNL coaching), the teaching timetable,
   the planned intervals and lifting from intervals.icu, and the free windows
   the availability engine finds between them. */
const LANE = {
  class:     { tag:"class",   cls:"lane-class" },
  coaching:  { tag:"coach",   cls:"lane-coach" },
  intervals: { tag:"icu",     cls:"lane-icu"   },
  plan:      { tag:"plan",    cls:"lane-icu"   },
  calendar:  { tag:"cal",     cls:"lane-cal"   },
  ride:      { tag:"ride",    cls:"lane-icu"   },
  food:      { tag:"food",    cls:"lane-food"  },
  open:      { tag:"open",    cls:"lane-open"  }
};
function durLabel(min){
  if (min == null) return "";
  const h = Math.floor(min/60), m = Math.round(min%60);
  return h ? (m ? h+"h "+m+"m" : h+"h") : m+"m";
}
function hhmmToMin(s){
  const m = /^(\d{1,2}):(\d{2})/.exec(String(s||""));
  return m ? (+m[1])*60 + (+m[2]) : null;
}
function localDateKey(){
  const n = new Date();
  return n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0")+"-"+String(n.getDate()).padStart(2,"0");
}
function fmtMinLocal(m){
  let h = Math.floor(m/60), mm = m%60, ap = h<12?"a":"p";
  h = h%12; if(h===0) h=12;
  return h+":"+String(mm).padStart(2,"0")+ap;
}


/* The eight numbers as rings, one each, in the grid the squares had: the
   outline of the circle fills clockwise from the top by how the number is
   doing, in the number's own colour, the number itself in the middle (the
   WHOOP gauge). The tile is still the button it was: tap it and the card
   beneath explains the number. */
const RING_KEYS = ["recovery", "fatigue", "weight", "bodyfat", "workouts", "food", "hydration", "micros"];
const RING_LABELS = { recovery: "Recovery", fatigue: "Fatigue", weight: "Weight", bodyfat: "Body fat", workouts: "Workouts", food: "Food", hydration: "Hydration", micros: "Micros" };
const RING_R = 42, RING_W = 8, RING_C = (2 * Math.PI * 42).toFixed(2);
/* The chain: Sleep → Food → Micros → Water → Work → Recovery → Weight, each
   box its seven-day value (bridge/chain.js) with today small under it, the
   arrows coloured by the link before them. The first link that is not on
   target is where the chain breaks; the line under the row says so. The
   boxes keep the old keys (hydration, workouts) so the tap-to-explain cards
   still open. */
const CHAIN = [["sleep","sleep","Sleep"],["water","hydration","Hydration"],["food","food","Macros"],["micros","micros","Micros"],["lift","lift","Lift"],["work","workouts","Ride"],["recovery","recovery","Recovery"],["weight","weight","Weight"]];
const ARROW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5l6 5.5-6 5.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
function chainHTML(){
  return CHAIN.map(([ck, k, label], i) => `${i ? `<span class="carrow" data-k="${CHAIN[i-1][0]}" aria-hidden="true"><i>${ARROW}</i></span>` : ""}<button class="score cbox" data-k="${k}" data-ck="${ck}"><span class="slabel">${label}</span><span class="cnum">—</span><span class="cweek">7 days</span><span class="ctoday"><span class="snum">—</span><span class="sword"></span><span class="ssub"></span></span></button>`).join("");
}
function paintChain(c){
  if (!c || !c.links) return;
  const UNIT = { sleep: "h/night", food: "avg", micros: "avg", water: "target", work: "plan", lift: "plan", recovery: "avg", weight: "lb/wk" };
  for (const [ck, k] of CHAIN){
    const L = c.links[ck], el = document.querySelector(`.cbox[data-ck="${ck}"]`); if (!L || !el) continue;
    const num = L.week == null ? "—" : ck === "work" || ck === "water" || ck === "lift" ? `${L.week}%` : ck === "weight" ? (L.week > 0 ? `+${L.week}` : `${L.week}`) : `${L.week}`;
    const TC = { good: "var(--green)", warn: "var(--amber)", bad: "var(--red)" };   // toneC lives inside the day view; this runs outside it
    const n = el.querySelector(".cnum"); n.textContent = num; n.style.color = TC[L.state] || "var(--muted)";
    el.querySelector(".cweek").textContent = UNIT[ck];
    el.dataset.week = L.state || "none";
    if (ck === "sleep"){ const sn = el.querySelector(".snum"), sw = el.querySelector(".sword"); sn.textContent = L.today == null ? "—" : `${L.today} h`; sn.style.color = ""; sw.textContent = L.today_word || ""; }
    if (ck === "lift"){ const sn = el.querySelector(".snum"), sw = el.querySelector(".sword"); sn.textContent = L.today ? "✓" : L.started ? `${L.sessions}/${L.target}` : "—"; sn.style.color = L.today ? "var(--green)" : ""; sw.textContent = L.today ? (L.today_word || "done") : (L.today_word || "this week"); }
    if (ck === "micros"){ const sn = el.querySelector(".snum"), sw = el.querySelector(".sword"); sn.textContent = L.today == null ? "—" : L.today; sw.textContent = L.gaps && L.gaps.length ? `low: ${L.gaps.slice(0,2).join(", ")}` : (L.today_word || ""); }
    const ar = document.querySelector(`.carrow[data-k="${ck}"]`); if (ar){ ar.className = `carrow ${L.state || "none"}${c.break_at === ck ? " broken" : ""}`; ar.innerHTML = `<i>${c.break_at === ck ? CROSS : ARROW}</i>`; }
  }
  const w = document.getElementById("chainWord"); if (w) w.textContent = c.verdict || "";
}
function ringsHTML(){
  return RING_KEYS.map(k => `<button class="score ringtile" data-k="${k}">
    <span class="slabel">${RING_LABELS[k]}</span>
    <span class="ringwrap"><svg class="rings" viewBox="0 0 100 100" aria-hidden="true"><circle class="rtrack" cx="50" cy="50" r="${RING_R}" stroke-width="${RING_W}"/><circle class="rfill" data-k="${k}" cx="50" cy="50" r="${RING_R}" stroke-width="${RING_W}" stroke-dasharray="0 ${RING_C}" transform="rotate(-90 50 50)"/></svg><span class="snum">—</span></span>
    <span class="sword">&nbsp;</span><span class="ssub">&nbsp;</span>
  </button>`).join("");
}
const TRASH = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm3 2v8h2v-8H9zm4 0v8h2v-8h-2z"/></svg>';
window.TRASH = TRASH;
// the gold medal: a breakthrough ride (signature.js), tap the row for the story
const MEDAL = '<svg class="medal" viewBox="0 0 24 24" width="18" height="18" aria-label="Breakthrough" role="img"><path d="M8 2h3l1.5 4L14 2h3l-3.5 7h-3z" fill="#c8102e"/><path d="M13 2h3l-3.5 7" fill="#8b0a1f"/><circle cx="12" cy="15.5" r="6.5" fill="#f0c040" stroke="#b8860b" stroke-width="1.2"/><circle cx="12" cy="15.5" r="4.2" fill="none" stroke="#fff3b0" stroke-width=".8" opacity=".8"/><path d="M12 11.9l1.1 2.2 2.4.35-1.75 1.7.4 2.4L12 17.4l-2.15 1.15.4-2.4-1.75-1.7 2.4-.35z" fill="#b8860b"/></svg>';
window.MEDAL = MEDAL;
function dayRows(d, plan, isToday){
  const rows = (d.events||[]).map(e=>({
    start: e.start_min, end: e.end_min, from: e.from, to: e.to,
    title: e.summary, detail: e.detail || e.location || "",
    lane: LANE[e.source] || LANE.calendar, wid: e.workout_id || null, lid: e.local_id || null, edit: e.edit || null,
    desc: e.description || null, location: e.location || null, calendar: e.calendar || null, source: e.source || "calendar"
  }));
  // The hub: today's card carries what the other tabs decided. From Food
  // and Live, the feeding window before each session and the meals that
  // touch the training (before, on the bike, after) plus the next one due;
  // the full plan stays on the Food tab.
  if (isToday && HUB.food){
    const f = HUB.food, hm = t => hhmmToMin(t);
    for (const sx of (f.energy && f.energy.sessions || [])){
      if (!sx.feed || hm(sx.feed.from) == null) continue;
      const a = hm(sx.feed.from), b = Math.max(a + 30, hm(sx.feed.to) || a + 30);
      rows.push({ start: a, end: b, from: fmtMinLocal(a), to: fmtMinLocal(b), title: `Fuel for ${sx.name.replace(/,.*$/, "")}: ${sx.feed.g} g carbs`, detail: `bottle from ${hm12(sx.feed.bottle_from)}`, lane: LANE.food, source: "food", href: "#live", feed: true,
        desc: `${sx.feed.g} g of carbs between ${hm12(sx.feed.from)} and ${hm12(sx.feed.to)} puts the quick store at ${sx.need}% for the start${sx.ready_at && !sx.ready_now ? `; as things stand it is ready at ${hm12(sx.ready_at)}` : ""}.` });
    }
    const nextSlot = f.suggestion && !f.suggestion.none ? f.suggestion.slot : null;
    const seen = new Set();
    for (const m of (f.meals || [])){
      const touches = m.slot === "before" || m.slot === "after" || (m.slot === "on the bike" && (m.carbs_g || 0) >= 10);
      if (!(touches || m.slot === nextSlot) || !m.time || seen.has(m.slot)) continue;
      if (!m.kcal && m.slot !== "on the bike") continue;
      seen.add(m.slot);
      const a = hm(m.time); if (a == null) continue;
      const logged = (m.logged || []).length > 0, mt = logged && m.match ? m.match : null;
      const what = String(m.what || "").split(/(?<=\.)\s/)[0].slice(0, 70);
      rows.push({ start: a, end: a + 30, from: fmtMinLocal(a), to: fmtMinLocal(a + 30), title: m.slot === nextSlot && !logged ? `${m.slot} · next` : m.slot, detail: `${what}${m.kcal ? ` · ${m.kcal} kcal · ${m.carbs_g}C${m.protein_g ? ` · ${m.protein_g}P` : ""}` : ""}`,
        lane: LANE.food, source: "food", href: "#food", meal: { logged, match: mt, slot: m.slot }, desc: m.what || null });
    }
  }
  // a breakthrough ride nobody planned still gets its medal: its own row, at the ride's time
  for (const b of (BTS[d.date] || [])) {
    if (rows.some(r => (r.source === "plan" || r.source === "intervals") && !/lift|push$|pull|upper|legs|weight|strength/i.test(r.title))) break;
    const sm = b.time ? (+b.time.slice(0,2))*60 + (+b.time.slice(3,5)) : 9*60, mins = b.minutes || 60;
    rows.push({ start: sm, end: sm + mins, from: fmtMinLocal(sm), to: fmtMinLocal(sm + mins), title: b.name, detail: `${mins} min · ridden`, lane: LANE.plan || LANE.calendar, source: "strava", bt: b, desc: null });
  }
  (d.windows||[]).forEach(w=> rows.push({
    start: w.start_min, end: w.end_min, from: w.from, to: w.to,
    title: "Open — " + durLabel(w.minutes), detail: w.slot || "",
    lane: LANE.open, open: true
  }));
  if (isToday && plan && plan.for_today && plan.start){
    const s = hhmmToMin(plan.start);
    if (s != null){
      const mins = Math.round((plan.effective_hours || 1) * 60);
      rows.push({ start:s, end:s+mins, from:fmtMinLocal(s), to:fmtMinLocal(s+mins),
        title: plan.ride || "Planned ride",
        detail: plan.route ? plan.route.miles+" mi · "+plan.route.climb_ft+" ft" : durLabel(mins),
        lane: LANE.ride });
    }
  }
  return rows.sort((a,b)=> (a.start-b.start) || (a.end-b.end));
}

/* ---- a row, opened: an event's details, or the whole of a workout ---- */
const mm2hm = m => m == null ? "" : String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
// The story behind the medal: Xert's breakthrough. The signature of the day
// before said this much power was the most available at that length; the
// ride held more, so the three numbers moved.
function breakthroughHTML(b, rideName){
  if (!b) return "";
  const hits = (b.hits || []).slice().sort((a, c) => c.over_pct - a.over_pct).slice(0, 4);
  const say = s => s < 60 ? `${s} s` : s % 60 === 0 ? `${s/60} min` : `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  return `<div class="xbt">${MEDAL}<b>Breakthrough</b>${rideName ? ` · ${esc(rideName)}` : ""}
    <div class="small">${esc(b.text || "")}</div>
    <ul class="agenda totals xbthits">${hits.map(h => `<li><span class="n">${say(h.dur_s)}</span><span class="tag"><b>${h.watts} W</b> <span class="small">vs ${h.curve_watts} W · +${h.over_pct}%</span></span></li>`).join("")}</ul>
    ${b.before && b.after ? `<div class="small">Signature before: TP ${b.before.tp} W · HIE ${b.before.hie_kj} kJ · PP ${b.before.pp} W. After: TP ${b.after.tp} W · HIE ${b.after.hie_kj} kJ · PP ${b.after.pp} W.</div>` : ""}
    <div class="small">A breakthrough, Xert's sense: power above what the signature said was available at that moment. The curve was wrong, low, and moved up to meet the ride.</div></div>`;
}
function eventDetailHTML(x){
  const editable = !!x.edit && !x.wid;
  return `<div class="xd"><div class="xdh">${esc(x.from)} to ${esc(x.to)}${x.calendar?` · ${esc(x.calendar)}`:""}</div>
    ${x.bt ? breakthroughHTML(x.bt, x.ride) : ""}
    ${x.location?`<div><b>Where:</b> ${esc(x.location)}</div>`:""}
    ${x.desc?`<div class="xdesc">${esc(x.desc)}</div>`:""}
    ${x.href?`<div class="rowbtns"><a class="btn" href="${attr(x.href)}">${x.href === "#live" ? "Live fuel" : x.href === "#food" ? "Food" : "Open"}</a></div>`:""}
    ${!x.location&&!x.desc&&!x.wid&&!editable&&!x.href?`<div class="small">Nothing more on this one.</div>`:""}
    ${x.wid?`<div class="small">loading the session…</div>`:""}
    ${editable?`<details class="addev evedit" data-key="${attr(x.edit)}"><summary>edit</summary>
      <div class="row2"><span><label>What</label><input class="evTitle" value="${attr(x.title)}"></span><span><label>Date</label><input class="evDate" type="date" value="${attr(x.date||"")}"></span></div>
      <div class="row2"><span><label>Start (blank = all day)</label><input class="evStart" type="time" value="${attr(x.start!=null&&x.from!=="all day"?mm2hm(x.start):"")}"></span><span><label>End</label><input class="evEnd" type="time" value="${attr(x.end!=null&&x.from!=="all day"?mm2hm(x.end):"")}"></span></div>
      <label>Where</label><input class="evLoc" value="${attr(x.location||"")}">
      <label>Notes</label><input class="evNotes" value="${attr(x.desc||"")}">
      <button class="primary evUpdate">Save</button> <span class="small evMsg">${x.edit.startsWith("g:")?"changes go to Google":x.edit.startsWith("l:")?"added here; goes to Google when connected":"from the calendar copy: the change stays in the app until Google is connected"}</span></details>`:""}</div>`;
}
const fmtTarget = (t, st)=>{
  if (!t) return "";
  if (t.type === "free") return "no target";
  if (t.type === "hr") return `${t.lo}–${t.hi} bpm`;
  if (t.type === "power") return `${Math.round(t.lo/100*st.ftp)}${t.hi!==t.lo?`–${Math.round(t.hi/100*st.ftp)}`:""} W (${t.lo}${t.hi!==t.lo?`–${t.hi}`:""}%)`;
  if (t.type === "watts") return `${t.lo}${t.hi!==t.lo?`–${t.hi}`:""} W`;
  if (t.type === "ramp") return `${Math.round(t.from/100*st.ftp)}→${Math.round(t.to/100*st.ftp)} W`;
  return "";
};
const clockS = s=>{ s=Math.round(s||0); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return h ? `${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}` : `${m}:${String(x).padStart(2,"0")}`; };
function briefHTML(b, x){
  const w = b.workout, m = w.metrics, st = b.settings || {};
  const c = b.compliance;
  const bandC = c ? (c.band === "green" ? "var(--green)" : c.band === "yellow" ? "var(--amber)" : "var(--red)") : "";
  const steps = (b.steps||[]).map(s => `<li><span class="n">${esc(s.label)}${s.cadence?`<span class="small"> ${s.cadence.lo}${s.cadence.hi!==s.cadence.lo?`–${s.cadence.hi}`:""} rpm</span>`:""}</span><span class="tag">${clockS(s.dur_s)} · ${fmtTarget(s.target, st)}</span></li>`).join("");
  const n = b.nutrition;
  const meals = n && n.meals ? n.meals.map(mm => `<li><span class="n"><b>${esc(hm12(mm.time))}</b> ${esc(mm.slot)}<span class="small"> ${esc(mm.what)}</span></span><span class="tag">${mm.kcal?`${mm.kcal} kcal · ${mm.carbs_g}C${mm.protein_g?` · ${mm.protein_g}P`:""}`:""}</span></li>`).join("") : "";
  const wx = b.weather;
  const hours = wx && wx.hours ? wx.hours.map(h => `<li><span class="n"><b>${esc(hm12(String(h.hour).padStart(2,"0")+":00"))}</b> ${h.temp_f}°F, feels ${h.feels_f}°<span class="small"> · ${h.rain_pct}% rain${h.rain_in?` (${h.rain_in} in)`:""} · ${h.humidity}% humidity</span></span><span class="tag">wind ${h.wind_mph} mph ${h.wind_from}${h.gust_mph > h.wind_mph + 8 ? `, gusts ${h.gust_mph}` : ""}<br><span class="small">${esc(h.ride)}</span></span></li>`).join("") : "";
  const rides = (b.rides||[]).map(r => { const h = r.analysis && r.analysis.hr, br = r.analysis && r.analysis.resp;
    return `<li><span class="n">${r.time?esc(hm12(r.time))+" · ":""}${esc(r.name)}<span class="small"> ${r.minutes} min${r.miles?` · ${r.miles} mi`:""}${r.np_w?` · NP ${r.np_w} W`:r.avg_w?` · ${r.avg_w} W`:""}${h?` · HR ${h.avg} avg, ${h.max} max`:""}${br?` · breathing ${br.avg}/min`:""}</span></span><span class="tag">${r.tss!=null?`~${r.tss} TSS`:""}</span></li>`; }).join("");
  return `<div class="xd">
    <div class="xdh">${esc(w.sport === "VirtualRide" ? "Zwift" : w.sport === "WeightTraining" ? "Lifting" : "Road")} · ${w.time ? `${esc(x.from)} to ${esc(x.to)}` : "no start time set"} · ${clockS(m.duration_s)} · ${m.tss} TSS · IF ${m.if.toFixed(2)}${c?` · <b style="color:${bandC}">${c.pct}% ${c.band==="green"?"done":c.band==="yellow"?"partly":b.rides&&b.rides.length?"short":"missed"}</b>`:""}</div>
    ${b.notes && b.notes.session ? `<div class="xdesc">${esc(b.notes.session)}</div>` : ""}
    <h5>The session</h5><ul class="agenda totals xsteps">${steps}</ul>
    ${rides ? `<h5>Ridden</h5><ul class="agenda totals">${rides}</ul>${c&&c.basis?`<div class="small">${esc(c.basis)}</div>`:""}` : ""}
    ${n ? `<h5>Eating around it</h5><div class="small">${esc(n.fuel_day)} · ${n.target.kcal} kcal · ${n.target.carbs_g} C / ${n.target.protein_g} P / ${n.target.fat_g} F for the day</div>
      ${meals?`<ul class="agenda totals">${meals}</ul>`:""}${b.notes && b.notes.eating ? `<div class="xdesc small">${esc(b.notes.eating)}</div>` : ""}` : ""}
    ${w.sport === "Ride" && b.kit ? `<h5>What to wear</h5><div class="kit">${b.kit.items.map(k => `<span class="kitem">${esc(k)}</span>`).join("")}</div><div class="small">for ${b.kit.feels_low_f}° feels-like at the coldest, wind ${b.kit.wind_mph} mph, ${b.kit.rain_pct}% rain</div>` : ""}
    ${w.sport === "Ride" ? `<h5>Weather on the ride</h5>${wx ? `<div class="small">${esc(wx.summary)} · wind read against a ${wx.bearing}° heading out</div><ul class="agenda totals">${hours}</ul>` : `<div class="small">${esc(b.weather_error || "No forecast for that day yet (seven days ahead at most).")}</div>`}` : ""}
    <div class="rowbtns"><a class="btn" href="#workout?id=${encodeURIComponent(w.id)}">Edit the session</a>${w.sport!=="WeightTraining"?`<a class="btn" href="${DEFAULT_API}/workouts/${encodeURIComponent(w.id)}/zwo">Zwift file</a>`:""}</div>
  </div>`;
}

/* ---- the hours: two strips, weather over calendar, one box an hour.
   Row one: green ride outside, amber marginal, red indoors. Row two: green
   free, red busy. White boxes span both rows over every free stretch: the
   windows a workout can go in. Tap one and the builder opens at that time. ---- */
let WX = {}, WGRADE = {}, FUELV = {}, BTS = {};   // BTS: breakthrough rides by date (signature.js), for the medal on the day
let HUB = { food: null };                         // today's food answer, for the meal and feeding rows on the day card
const H0 = 7, H1 = 21;   // no workouts before 7
const hlbl = h => { const x = h % 12 || 12; return x + (h < 12 ? "a" : "p"); };
function freeHours(d){
  const ev = (d.events||[]).filter(e => e.source !== "plan" && e.source !== "ride" && e.start_min != null && e.end_min != null);
  const out = [];
  for (let h = H0; h <= H1; h++){
    const a = h*60, b = a+60; let busy = 0; const names = [];
    for (const e of ev){ const o = Math.min(b, e.end_min) - Math.max(a, e.start_min); if (o > 0){ busy += o; names.push(e.summary); } }
    out.push({ hour: h, free: busy < 15, names });
  }
  return out;
}
/* the sky and the wind, hour by hour, above the two strips: a small picture
   of the sky (sun, cloud, rain) and an arrow the way the wind is blowing,
   with its speed under it */
const SKY_SVG = {
  sun: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="4" fill="#F0C040"/><g stroke="#F0C040" stroke-width="1.6" stroke-linecap="round"><path d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2L16 16M4 16l1.8-1.8M14.2 5.8L16 4"/></g></svg>',
  moon: '<svg viewBox="0 0 20 20"><path d="M13.5 2.5a7.5 7.5 0 1 0 4 13.3A6.5 6.5 0 0 1 13.5 2.5z" fill="#D8D6CC"/></svg>',
  partly: '<svg viewBox="0 0 20 20"><circle cx="7" cy="7" r="3.5" fill="#F0C040"/><path d="M6 17h9a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 6.8 9.6 3.7 3.7 0 0 0 6 17z" fill="#C9C7BE"/></svg>',
  "partly-night": '<svg viewBox="0 0 20 20"><path d="M9 2a5 5 0 1 0 3 9 4.3 4.3 0 0 1-3-9z" fill="#D8D6CC" opacity=".8"/><path d="M6 17h9a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 6.8 9.6 3.7 3.7 0 0 0 6 17z" fill="#C9C7BE"/></svg>',
  cloud: '<svg viewBox="0 0 20 20"><path d="M5 16h10a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 5.8 7.6 4.2 4.2 0 0 0 5 16z" fill="#A9A7A0"/></svg>',
  fog: '<svg viewBox="0 0 20 20"><g stroke="#A9A7A0" stroke-width="1.8" stroke-linecap="round"><path d="M3 7h14M4 11h12M6 15h9"/></g></svg>',
  drizzle: '<svg viewBox="0 0 20 20"><path d="M5 12h10a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 5.8 3.6 4.2 4.2 0 0 0 5 12z" fill="#A9A7A0"/><g stroke="#7FB3E6" stroke-width="1.6" stroke-linecap="round"><path d="M7 14.5v1.5M10.5 14.5v1.5M14 14.5v1.5"/></g></svg>',
  rain: '<svg viewBox="0 0 20 20"><path d="M5 11h10a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 5.8 2.6 4.2 4.2 0 0 0 5 11z" fill="#A9A7A0"/><g stroke="#7FB3E6" stroke-width="1.8" stroke-linecap="round"><path d="M7 13l-1 4M11 13l-1 4M15 13l-1 4"/></g></svg>',
  snow: '<svg viewBox="0 0 20 20"><path d="M5 11h10a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 5.8 2.6 4.2 4.2 0 0 0 5 11z" fill="#A9A7A0"/><g fill="#EEF4FF"><circle cx="7" cy="14.5" r="1.2"/><circle cx="11" cy="16.5" r="1.2"/><circle cx="14.5" cy="14" r="1.2"/></g></svg>',
  thunder: '<svg viewBox="0 0 20 20"><path d="M5 10h10a3.5 3.5 0 0 0 .5-7A5 5 0 0 0 5.8 1.6 4.2 4.2 0 0 0 5 10z" fill="#A9A7A0"/><path d="M11 10l-3.5 5h3l-1 4 4-6h-3z" fill="#F0C040"/></svg>'
};
const SKY_WORD = { sun: "sunny", moon: "clear", partly: "partly cloudy", "partly-night": "partly cloudy", cloud: "cloudy", fog: "fog", drizzle: "drizzle", rain: "rain", snow: "snow", thunder: "thunderstorms" };
// the arrow points the way the wind blows (the forecast gives where it comes from)
// the arrow's colour is the wind's verdict: under 12 mph green, 12 to 15 amber, over 15 red
const windTone = mph => mph > 15 ? "var(--red)" : mph >= 12 ? "var(--amber)" : "var(--green)";
const windSVG = (deg, mph) => `<svg viewBox="0 0 20 20" class="warrow" style="color:${windTone(mph)}"><g transform="rotate(${((deg || 0) + 180) % 360} 10 10)" stroke="currentColor" stroke-width="${mph > 15 ? 2.6 : mph >= 12 ? 2.2 : 1.9}" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M10 17V3M10 3L6 7M10 3l4 4"/></g></svg>`;
function skyStrips(w, n){
  if (!w) return "";
  const hs = w.hours.filter(h => h.hour >= H0 && h.hour <= H1);
  if (!hs.some(h => h.sky)) return "";
  const sky = hs.map(h => `<span class="wxh wxico" title="${attr(`${hlbl(h.hour)}: ${SKY_WORD[h.sky] || ""}, ${h.temp_f}°, ${h.rain_pct}% rain`)}">${SKY_SVG[h.sky] || ""}</span>`).join("");
  const wind = hs.map(h => `<span class="wxh wxico wxwind" style="color:${windTone(h.wind_mph)}" title="${attr(`${hlbl(h.hour)}: wind ${h.wind_mph} mph from the ${h.wind_from}${h.gust_mph > h.wind_mph + 8 ? `, gusts ${h.gust_mph}` : ""}`)}">${windSVG(h.wind_deg, h.wind_mph)}<i>${h.wind_mph}</i></span>`).join("");
  return `<div class="wxstack wxsky"><span class="wxlab">wind</span><div class="wxrow" style="grid-template-columns:repeat(${n},1fr)">${wind}</div>
    <span class="wxlab">sky</span><div class="wxrow" style="grid-template-columns:repeat(${n},1fr)">${sky}</div></div>`;
}
function hourStrips(d){
  const w = WX[d.date];
  const cal = freeHours(d);
  const n = H1 - H0 + 1;
  const wxBoxes = w ? w.hours.filter(h => h.hour >= H0 && h.hour <= H1).map(h => `<span class="wxh ${h.grade}" data-why="${attr((h.why.length ? h.why.join(", ") : "good outside") + ` · ${h.temp_f}°, wind ${h.wind_mph} ${h.wind_from}`)}" title="${attr(hlbl(h.hour))}"></span>`).join("")
                   : cal.map(() => `<span class="wxh none"></span>`).join("");
  const calBoxes = cal.map(c => `<span class="wxh ${c.free ? "good" : "bad"}" data-why="${attr(c.names.length ? c.names.join(", ") : "free")}" title="${attr(hlbl(c.hour))}"><i>${hlbl(c.hour)}</i></span>`).join("");
  // the windows: runs of free hours, split by the conditions above them.
  // Free and green outside is an outdoor window (solid box); free under
  // amber or red, or with no forecast, is an indoor window (dashed box).
  const grade = i => { const h = w && w.hours.find(x => x.hour === H0 + i); return h ? h.grade : "none"; };
  const wins = []; let run = null;
  cal.forEach((c, i) => {
    const kind = c.free ? (grade(i) === "good" ? "out" : "in") : null;
    if (kind && run && run.kind === kind) run.i1 = i;
    else { if (run) wins.push(run); run = kind ? { i0: i, i1: i, kind } : null; }
  });
  if (run) wins.push(run);
  const overlay = wins.map(r => { const h0 = H0 + r.i0, h1 = H0 + r.i1 + 1; const len = r.i1 - r.i0 + 1;
    return `<a class="wxwin ${r.kind}" href="#workout?date=${esc(d.date)}&time=${String(h0).padStart(2,"0")}:00&where=${r.kind}" style="left:calc(${r.i0}/${n}*100% + 1px);width:calc(${len}/${n}*100% - 2px)" title="${attr(`${hlbl(h0)}–${hlbl(h1)}: ${len} h free, ${r.kind === "out" ? "outdoors" : "indoors"}`)}"></a>`; }).join("");
  return `<div class="wxstrip">
    ${skyStrips(w, n)}
    <div class="wxstack"><span class="wxlab">conditions</span><div class="wxrow" style="grid-template-columns:repeat(${n},1fr)">${wxBoxes}</div>
      <span class="wxlab">schedule</span><div class="wxrow" style="grid-template-columns:repeat(${n},1fr)">${calBoxes}</div><div class="wxover">${overlay}</div></div>
    <div class="small wxnote"><span class="wxwhy">${w ? `light ${esc(hm12(w.sunrise))}–${esc(hm12(w.sunset))}` : ""}</span></div></div>`;
}
/* ---- the now dot: a small circle on the agenda's left line that slides
   down the day as the time passes; between rows it sits on the boundary ---- */
function placeNowDot(){
  const ul = document.querySelector(".card.day.is-today ul.agenda"); if (!ul) return;
  let dot = ul.querySelector(".nowdot");
  if (!dot){ dot = document.createElement("span"); dot.className = "nowdot"; ul.appendChild(dot); }
  const n = new Date(); const now = n.getHours()*60 + n.getMinutes();
  const rows = [...ul.querySelectorAll("li[data-s]")];
  if (!rows.length){ dot.hidden = true; return; }
  let top = null;
  for (const li of rows){
    const s = +li.dataset.s, e = +li.dataset.e;
    if (now >= s && now < e){ top = li.offsetTop + (now - s) / Math.max(1, e - s) * li.offsetHeight; break; }
  }
  if (top == null){
    const first = rows[0], last = rows[rows.length - 1];
    if (now < +first.dataset.s) top = first.offsetTop;
    else if (now >= +last.dataset.e) top = last.offsetTop + last.offsetHeight;
    else { const nxt = rows.find(li => +li.dataset.s > now); top = nxt ? nxt.offsetTop : last.offsetTop + last.offsetHeight; }
  }
  dot.hidden = false; dot.style.top = Math.round(top) + "px";
}
// One line of conditions on the day card; the strips themselves live on the Ride tab.
function conditionsLine(d){
  const w = WX[d.date]; if (!w) return "";
  const hs = w.hours.filter(h => h.hour >= H0 && h.hour <= H1);
  let best = null, run = null;
  for (const h of hs){ if (h.grade === "good"){ if (!run) run = { a: h.hour, b: h.hour + 1 }; else run.b = h.hour + 1; if (!best || run.b - run.a > best.b - best.a) best = run; } else run = null; }
  const winds = hs.map(h => h.wind_mph), wmin = Math.min(...winds), wmax = Math.max(...winds);
  const words = best ? `green outside ${hlbl(best.a)}–${hlbl(best.b)}` : hs.some(h => h.grade === "ok") ? "marginal outside" : "indoors today";
  return `<div class="small condline"><span class="wxdot ${best ? "good" : hs.some(h => h.grade === "ok") ? "ok" : "bad"}"></span>${esc(words)} · wind ${wmin === wmax ? wmin : `${wmin}–${wmax}`} mph · light ${esc(hm12(w.sunrise))}–${esc(hm12(w.sunset))} · <a href="#ride">Ride</a></div>`;
}
function dayCard(d, plan, nowMin, rec, solo){
  const isToday = !!d.today;
  const rows = dayRows(d, plan, isToday);
  const chips = (d.all_day||[]).map(e=>
    `<span class="chip ${(LANE[e.source]||LANE.calendar).cls} xchip" data-x="${attr(JSON.stringify({ title:e.summary, from:"all day", to:"", desc:e.description||null, location:e.location||null, calendar:e.calendar||null, wid:e.workout_id||null, source:e.source||null }))}">${esc(e.summary)}${e.detail?" · "+esc(e.detail):""}</span>`).join("");
  let markedNext = false;
  const items = rows.map(r=>{
    let state = "";
    if (isToday){
      if (r.end <= nowMin) state = "past";
      else if (r.start <= nowMin && nowMin < r.end) state = "now";
      else if (!markedNext && !r.open){ state = "next"; markedNext = true; }
    }
    // A free window is the space between things. Rendered as a full row it
    // read as an appointment, and an empty day looked packed.
    if (r.open) return `<li class="gap ${state}" data-s="${r.start}" data-e="${r.end}"><span class="n">${esc(r.from)}–${esc(r.to)} · ${esc(r.title.replace(/^Open — /, ""))} free</span></li>`;
    const g = r.wid && WGRADE[r.wid];
    const gradeWord = g ? (g.band === "green" ? (g.logged ? "logged" : "done") : g.over ? "over" : g.band === "yellow" ? "partly" : g.rides ? "short" : "missed") + (g.pct != null && !g.logged ? ` ${g.pct}%` : "") : null;
    // the gold medal: this day's ride beat the signature (a breakthrough); it sits on the ride's row
    const isRide = (r.source === "plan" || r.source === "intervals" || r.bt) && !/lift|push$|pull|upper|legs|weight|strength/i.test(r.title);
    const bt = isRide && BTS[d.date] ? (r.bt || BTS[d.date][0]) : null;
    const wxh = isRide && WX[d.date] ? WX[d.date].hours.find(h => h.hour === Math.floor(r.start / 60)) : null;
    const mealTag = r.meal ? (r.meal.logged ? (r.meal.match ? `<span class="mword ${r.meal.match.key}">${r.meal.match.key === "green" ? "✓ on plan" : esc(r.meal.match.word)}</span>` : "logged") : (/next$/.test(r.title) ? "next" : "plan")) : null;
    return `<li class="${r.lane.cls} ${state} xrow${g ? ` graded ${g.band}` : ""}${bt ? " medalled" : ""}${r.meal && r.meal.match ? ` match ${r.meal.match.key}` : ""}" data-s="${r.start}" data-e="${r.end}" data-x="${attr(JSON.stringify({ title:r.title, from:r.from, to:r.to, desc:r.desc||null, location:r.location||null, calendar:r.calendar||null, wid:r.wid||null, source:r.source||null, edit:r.edit||null, date:d.date, start:r.start, end:r.end, bt: bt ? bt.bt : null, ride: bt ? bt.name : null, href: r.href||null }))}">
      <span class="t">${esc(r.from)}<br>${esc(r.to)}</span>
      <span class="n">${(fv=>fv&&!(g&&g.logged)?`<span class="fdot ${fv.band}" title="fuel ${fv.pct}%, legs ${fv.legs_pct}%"></span>`:"")(r.wid&&FUELV[d.date+"|"+r.title])}${wxh ? `<span class="wxdot ${wxh.grade}" title="${attr(`${wxh.temp_f}°, wind ${wxh.wind_mph} ${wxh.wind_from}, ${wxh.rain_pct}% rain`)}"></span>` : ""}${bt ? MEDAL : ""}${esc(r.title)}${r.detail?`<span class="small"> ${esc(r.detail)}</span>`:""}</span>
      <span class="tag">${mealTag ? mealTag : gradeWord ? esc(gradeWord) : state==="now"?"now":state==="next"?"next":r.lane.tag}${r.wid?`<button class="tdel" data-delw="${esc(r.wid)}" aria-label="Remove">${TRASH}</button>`:r.edit?`<button class="tdel" data-delx="${attr(r.edit)}" aria-label="Remove">${TRASH}</button>`:""}</span></li>`;
  }).join("");
  const open = d.available_min ? durLabel(d.available_min)+" open" : "no window";
  const foot = open;
  const m = d.macros;
  const macroRow = m
    ? `<div class="macros"><div class="fuelrow"><span class="mfuel">${esc(m.fuel_day||"")}</span><span class="fkcal"><b>${m.kcal ?? "—"}</b> kcal</span></div>
        <div class="mgrid"><div class="mc c"><b>${m.carbs_g ?? "—"}</b><span>carbs g</span></div><div class="mc p"><b>${m.protein_g ?? "—"}</b><span>protein g</span></div><div class="mc f"><b>${m.fat_g ?? "—"}</b><span>fat g</span></div></div></div>`
    : "";
  return `<div class="card day${isToday?" is-today":""}${solo?" day-solo":""}">
    <div class="dayhead"><h4>${isToday?"Today · ":""}${esc(d.label)}</h4><a class="btn" href="#food">Food log</a></div>
    ${macroRow}${conditionsLine(d)}
    ${chips?`<div class="chips">${chips}</div>`:""}
    <ul class="agenda${solo?" agenda-big":""}">${items || `<li class="lane-open"><span class="t"></span><span class="n">Nothing scheduled</span><span class="tag">clear</span></li>`}</ul>
    <div class="small">${foot}</div>
    <details class="addev"><summary>+ add to the calendar</summary>
      <div class="row2"><span><label>What</label><input class="evTitle" placeholder="Dentist"></span><span><label>Date</label><input class="evDate" type="date" value="${esc(d.date)}"></span></div>
      <div class="row2"><span><label>Start (blank = all day)</label><input class="evStart" type="time"></span><span><label>Minutes</label><input class="evMin" type="number" value="60"></span></div>
      <label>Notes</label><input class="evNotes" placeholder="optional">
      <button class="primary evSave">Add</button> <span class="small evMsg"></span></details></div>`;
}

/* The day runs unattended — a tablet on the counter, a phone left open on the
   kitchen bench — so it keeps itself current instead of waiting for a reload.
   Three cadences: the clock every second, the now/next markers every 30s off
   cached data, and a real fetch every 5 minutes. Coming back to a backgrounded
   tab syncs immediately, and crossing midnight reloads the page outright so
   "today" is actually today (and any new deploy lands with it). */
let __dayTimers = [];
function clearDayTimers(){
  __dayTimers.forEach(clearInterval); __dayTimers = [];
  if (__dayKeys){ document.removeEventListener("keydown", __dayKeys); __dayKeys = null; }
}
let __dayWake = false, __dayKeys = null;
const DAY_SYNC_MS = 5*60*1000, DAY_PAINT_MS = 30*1000, DAY_STALE_MS = 60*1000;

V.today = async function(){
  clearDayTimers();                       // re-entering must not stack timers
  view.innerHTML = `
    <button class="score hero" data-k="training"><span class="herotext"><span class="slabel">Fitness</span><span class="snum">—</span><span class="sword">&nbsp;</span><span class="ssub">reaching the bridge…</span></span><svg class="spark" viewBox="0 0 160 56" preserveAspectRatio="none" aria-hidden="true"></svg></button>
    <div class="chain" id="scores">${chainHTML()}</div>
    <div class="chainword small" id="chainWord">&nbsp;</div>
    <div class="scoreverdict small" id="scoreVerdict"></div>
    <div class="card scoredetail" id="scoreDetail" hidden></div>
    <div class="daystep">
      <button id="dayPrev" aria-label="Previous day">‹</button>
      <div class="daystep-label" id="dayLabel"></div>
      <button id="dayNext" aria-label="Next day">›</button>
    </div>
    <div id="dayList"><div class="card"><div class="small">building the day…</div></div></div>
    <div class="small" id="daySources" style="margin-top:12px"></div>
    <button id="toPlan" class="primary">The plan</button>
    <button id="toSettings">Settings</button>`;

  // Last payload, so the now/next markers can be repainted without refetching.
  let cached = { days: [], plan: null, recommendation: null, macros: null,
    timezone: null, dateKey: localDateKey() };

  // The schedule is built in the athlete's timezone, so the clock has to read
  // in the same one. Left on the device's zone they disagree the moment a
  // phone is in another timezone — the header saying Monday over a day card
  // headed Sunday.
  const zoned = (opts)=> new Intl.DateTimeFormat("en-US",
    Object.assign({ timeZone: cached.timezone || undefined }, opts));
  const tick = ()=>{
    const n = new Date();
    const el = document.getElementById("nowTime");
    if (el) el.textContent = zoned({ hour:"numeric", minute:"2-digit" }).format(n);
    const de = document.getElementById("nowDate");
    if (de) de.textContent = zoned({ weekday:"long", month:"long", day:"numeric" }).format(n);
  };
  tick();
  __dayTimers.push(setInterval(()=>{ if(location.hash!=="#today") clearDayTimers(); else { tick(); placeNowDot(); } }, 15000));
  // The day is the whole app now, but a device still has to be told its bridge
  // URL and token once — without a way back to Settings a fresh tablet is
  // stranded on demo data with no way to fix it.
  document.getElementById("toSettings").onclick = ()=>{ location.hash = "#settings"; };
  document.getElementById("toPlan").onclick = ()=>{ location.hash = "#calendar"; };

  const nowMin = ()=>{
    const p = new Intl.DateTimeFormat("en-US", { timeZone: cached.timezone || undefined,
      hour12:false, hour:"2-digit", minute:"2-digit" }).formatToParts(new Date());
    const h = +p.find(x=>x.type==="hour").value % 24, m = +p.find(x=>x.type==="minute").value;
    return h*60 + m;
  };

  /* ---- the top strip: the three scores ----
     Fitness, Recovery, Fatigue — drawn by refreshScores below. The scale
     reads into its own card further down the page. */

  /* ---- the scale, below the day ----
     One arrow per number Withings reports, coloured by one rule: down green,
     up red, unchanged neither. The tones come from the bridge, which owns the
     flat band each metric gets — a scale that reads 0.1 lb of bone loss has
     not told you anything. */
  const trendTone = t => t === "good" ? "var(--green)" : t === "bad" ? "var(--red)" : "var(--ink)";
  let bodyData = null;
  const bodyHTML = (w)=>{
    if (!w) return `<h4>The scale</h4><div class="small">bridge unreachable</div>`;
    const rows = (w.trends || []).map(t=>{
      const c = trendTone(t.tone);
      const move = t.delta == null ? ""
        : t.delta === 0 ? "no change"
        : `${t.delta > 0 ? "+" : ""}${t.delta}${t.unit}`;
      return `<li><span class="n">${esc(t.label)}</span>
        <span class="tag"><span class="mono">${t.value}${esc(t.unit)}</span>
          <span class="arrow" style="color:${c}">${t.arrow}</span>
          <span class="small" style="color:${c}">${esc(move)}</span></span></li>`;
    }).join("");
    const since = w.change_since_start_lb;
    const demo = w.demo || (w.latest && /demo/.test(w.latest.source || ""));
    const basis = (w.trends || []).length ? (w.trends[0].basis || "") : "";
    const last = w.latest && w.latest.at ? new Date(w.latest.at) : null;
    const lastWhen = !last ? "" : w.latest.logged_today ? "today" : last.toLocaleDateString(undefined,{month:"short",day:"numeric"});
    return `<h4>The scale</h4>
      ${demo ? `<div class="macros"><span class="mfuel" style="background:var(--red)">Demo data — not your readings</span></div>` : ""}
      ${rows ? `<ul class="agenda totals">${rows}</ul>
        <div class="small">arrows compare ${esc(basis)}${
          since != null ? ` · <b>${since > 0 ? "+" : ""}${since} lb</b> since ${w.start_lb}` : ""}${
          w.readings_7d ? ` · ${w.readings_7d} readings this week` : ""}${
          lastWhen ? ` · last reading ${esc(lastWhen)}${w.latest.source ? " (" + esc(w.latest.source) + ")" : ""}` : ""}</div>`
        : `<div class="small">${w.withings_connected
            ? "Connected — the numbers land here with your next reading."
            : "Withings isn't connected. Starting weight " + (w.start_lb || 210) + " lb."}</div>`}
      ${w.withings_connected ? "" : `<div class="small"><a href="${DEFAULT_API}/withings/auth"><b>Connect the Withings scale</b></a></div>`}
      ${(w.latest && w.latest.logged_today) ? "" : `
        <div class="weighin">
          <div class="small">This morning's number:</div>
          <div class="row2"><span><input class="wiLb" type="number" step="0.1" placeholder="${w.start_lb || 210}"></span>
            <span><button class="primary wiSave">Log weigh-in</button></span></div>
          <div class="small wiMsg"></div></div>`}`;
  };
  const wireBody = (root)=>{
    const btn = root && root.querySelector(".wiSave");
    if (!btn) return;
    btn.onclick = async ()=>{
      const lb = +root.querySelector(".wiLb").value;
      if (!lb) return;
      try{
        await bridge("/weigh-in",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lb})});
        refreshBody();
      }catch(e){ const m=root.querySelector(".wiMsg"); if(m) m.textContent = "Failed: " + e.message; }
    };
  };
  const drawBody = (w)=>{
    bodyData = w;
    const el = document.getElementById("body");
    if (el){ el.innerHTML = bodyHTML(w); wireBody(el); }
    drawWeightTile(); drawBodyFatTile();
    if (typeof drawScoreDetail === "function" && (openScore === "weight" || openScore === "bodyfat")) drawScoreDetail();
  };
  const refreshBody = async ()=> drawBody(await bridge("/weigh-in").catch(()=>null));

  // WHOOP's authorization lives on the bridge, not in the page, so this has to
  // be a real navigation rather than a fetch — the consent screen redirects
  // back to /whoop/callback and stores the tokens server-side.
  const reconnectLink = ()=>
    `<a href="${DEFAULT_API}/whoop/auth"><b>reconnect WHOOP</b></a>`;

  /* ---- the three scores: Fitness, Recovery, Fatigue ----
     Fitness and Fatigue are CTL and ATL from the
     Banister model TrainingPeaks, intervals.icu and Strava all run — 42-day
     and 7-day weighted averages of daily TSS. Recovery is WHOOP's score, with
     HRV and resting HR against the 30-day median. The bridge does the
     arithmetic (bridge/scores-math.js); this draws it and explains it. */
  const toneC = t => t === "good" ? "var(--green)" : t === "warn" ? "var(--amber)" : t === "bad" ? "var(--red)" : "var(--ink)";
  const sgn = n => n == null ? "—" : (n > 0 ? "+" : "") + n;
  // The six-week line of fitness inside the hero box: one path, the last
  // point marked. The box's own tone colours it, so the line is ink.
  const drawSpark = (series)=>{
    const svg = view.querySelector(".score.hero .spark"); if (!svg) return;
    const pts = (series||[]).map(r => r.ctl).filter(v => v != null);
    if (pts.length < 2){ svg.innerHTML = ""; return; }
    const W = 160, H = 56, lo = Math.min(...pts), hi = Math.max(...pts), span = Math.max(4, hi - lo);
    const X = i => (i / (pts.length - 1)) * (W - 6) + 3, Y = v => 6 + (1 - (v - lo) / span) * (H - 12);
    const d = pts.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" ");
    svg.innerHTML = `<path d="${d} L${X(pts.length-1).toFixed(1)},${H} L3,${H} Z" fill="currentColor" opacity=".12"></path>
      <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path>
      <circle cx="${X(pts.length-1).toFixed(1)}" cy="${Y(pts[pts.length-1]).toFixed(1)}" r="3.5" fill="currentColor"></circle>`;
  };
  // What the fitness number means for a masters amateur: CTL in TSS a day.
  const fitLevel = c => c == null ? "" : c < 25 ? "base" : c < 45 ? "recreational" : c < 65 ? "solid" : c < 85 ? "strong" : "racer";
  let scoresData = null, complianceData = null, foodData = null, workoutsData = null, openScore = null, chainData = null;
  const drawMicroTile = ()=>{
    const m = foodData && foodData.micros;
    if (!m){ paintTile("micros", null, "", "", foodData ? "snap a meal" : scoresLoading ? "reaching the bridge…" : "bridge unreachable"); return; }
    const gaps = (m.gaps||[]).map(g=>g.label).join(", ");
    paintTile("micros", m.score, m.band.word, m.band.tone, gaps ? `low: ${gaps}` : "all covered");
  };
  // Today's sessions: done over planned. A double day (a ride and the gym)
  // reads 0/2, then 1/2, then 2/2. A ride nobody planned still counts as done.
  const workoutsToday = ()=>{
    const d = workoutsData && (workoutsData.today_day || (workoutsData.days && workoutsData.days[0]));
    if (!d) return null;
    const planned = (d.planned||[]).map(w => ({ name: w.name, time: w.time || null, minutes: w.metrics ? Math.round(w.metrics.duration_s/60) : null, sport: w.sport,
      done: !!(w.logged || (w.compliance && w.compliance.band !== "red")),   // a red ride is short, not done
      band: w.compliance ? w.compliance.band : null, pct: w.compliance ? w.compliance.pct : null }))
      .concat((d.intervals||[]).map(e => ({ name: e.name, time: e.time || null, minutes: e.minutes, sport: e.type, done: false, band: null, pct: null, source: "intervals.icu" })));
    const rides = d.done || [];
    // Done: planned sessions Strava graded or that were logged by hand; an
    // intervals.icu session is done when a ride is left over to cover it; a
    // ride nobody planned counts as done too (so 3/2 can happen).
    const stravaDone = planned.filter(p => p.done && p.source !== "intervals.icu").length;
    let spare = Math.max(0, rides.length - planned.filter(p => p.done && p.band != null).length);
    for (const p of planned) if (p.source === "intervals.icu" && !p.done && spare > 0) { p.done = true; p.band = "green"; spare--; }
    const done = planned.filter(p => p.done).length + spare;
    return { planned, rides, count: planned.length, done, compliance: d.compliance || null };
  };
  const drawWorkoutsTile = ()=>{
    if (!workoutsData){ paintTile("workouts", null, "", "", scoresLoading ? "reaching the bridge…" : "bridge unreachable"); return; }
    const t = workoutsToday();
    if (!t){ paintTile("workouts", null, "", "", "no day"); return; }
    const now = new Date(); const nowMin = now.getHours()*60 + now.getMinutes();
    const next = t.planned.find(p => !p.done);
    const lastEnd = Math.max(0, ...t.planned.map(p => p.time ? (+p.time.slice(0,2))*60 + (+p.time.slice(3,5)) + (p.minutes||60) : 0));
    const word = `${t.done}/${t.count}`;
    let tone = "neutral";
    if (t.count === 0) tone = t.done ? "good" : "neutral";
    else if (t.done >= t.count) tone = "good";
    else if (t.done > 0) tone = "warn";
    else tone = (lastEnd && nowMin > lastEnd + 30) || (t.compliance && t.compliance.band === "red") ? "bad" : "neutral";
    const sub = t.count === 0 ? (t.done ? `${t.done} unplanned ride${t.done===1?"":"s"}` : "rest day")
      : next ? `${next.time ? hm12(next.time) + " · " : ""}${next.name}` : (t.compliance && t.compliance.word ? t.compliance.word : "all done");
    paintTile("workouts", t.done, word, tone, sub, t.count ? Math.min(1, t.done / t.count) : 1);
  };
  const drawHydrationTile = ()=>{
    const h = foodData && foodData.hydration;
    if (!h){ paintTile("hydration", null, "", "", foodData ? "snap a drink" : scoresLoading ? "reaching the bridge…" : "bridge unreachable"); return; }
    const b = h.now ? h.now.band : h.band, ml = h.now ? h.now.ml : null;
    if (ml == null){ paintTile("hydration", h.score, b.word, b.tone, "snap a drink", (h.score || 0) / 100); return; }
    const num = ml > 300 ? `+${(ml/1000).toFixed(1)}` : `−${(Math.abs(ml)/1000).toFixed(1)}`;
    paintTile("hydration", num, b.word, b.tone === "info" ? "neutral" : b.tone, `L on the morning · ${(h.drunk_ml/1000).toFixed(1)} of ${(h.target_ml/1000).toFixed(1)} L drunk`, (h.score || 0) / 100);
  };
  const drawWeightTile = ()=>{
    const w = bodyData;
    if (!w || !w.latest){ paintTile("weight", null, "", "", w ? (w.withings_connected ? "no reading yet" : "scale not connected") : "bridge unreachable"); return; }
    // Down is the direction this program wants: the band is −600 to −300 a day.
    const wk = w.week_change_lb, since = w.change_since_start_lb;
    let word = "", tone = "neutral", sub = "";
    if (wk != null){ word = wk < -0.2 ? "down" : wk > 0.2 ? "up" : "flat"; tone = wk < -0.2 ? "good" : wk > 0.2 ? "bad" : "neutral"; sub = `${sgn(wk)} lb/wk`; }
    else if (since != null){ word = since < 0 ? "down" : since > 0 ? "up" : "at start"; tone = since < 0 ? "good" : since > 0 ? "warn" : "neutral"; sub = `${sgn(since)} lb since ${w.start_lb}`; }
    if (w.latest && !w.latest.logged_today) sub = sub || "not today";
    // the ring fills as the week goes the way the program wants: a pound down in the week is full
    const wfill = wk != null ? -wk / 1 : since != null ? -since / 5 : 0.5;
    paintTile("weight", Math.round(w.latest.lb), word, tone, sub || `${w.latest.lb} lb`, wfill);
  };
  // Body fat from the scale's composition; the word is the week-over-week
  // move of the 7-day mean (bridge/weighin.js trends). Down is the direction.
  const drawBodyFatTile = ()=>{
    const w = bodyData;
    const c = w && w.composition, t = w && (w.trends||[]).find(x => x.key === "fat_pct");
    if (!c || c.fat_pct == null){ paintTile("bodyfat", null, "", "", w ? (w.withings_connected ? "scale has no body fat yet" : "needs the Withings scale") : "bridge unreachable"); return; }
    const d = t && t.delta != null ? t.delta : null;
    const word = d == null ? "" : d < -0.2 ? "down" : d > 0.2 ? "up" : "flat";
    const tone = d == null ? "neutral" : d < -0.2 ? "good" : d > 0.2 ? "bad" : "neutral";
    const sub = d != null ? `${sgn(d)} pts/wk${c.fat_mass_lb != null ? ` · ${c.fat_mass_lb} lb fat` : ""}` : (c.fat_mass_lb != null ? `${c.fat_mass_lb} lb fat` : "first reading");
    paintTile("bodyfat", c.fat_pct, word, tone, sub, d != null ? 0.5 - d : 0.5);   // half a point down a week fills it
  };
  const foodBand = o => o == null ? null : o >= 80 ? { word: "on target", tone: "good" } : o >= 60 ? { word: "close", tone: "warn" } : { word: "off", tone: "bad" };
  const drawFood = ()=>{
    const c = complianceData;
    if (!c){ paintTile("food", null, "", "", scoresData ? "no answer" : "bridge unreachable"); return; }
    const o = c.compliance ? c.compliance.overall : null;
    if (o == null){
      paintTile("food", null, "", "", !c.target ? "no target" : "snap the first meal");
      return;
    }
    const b = foodBand(o);
    const k = c.compliance.per_macro && c.compliance.per_macro.kcal;
    paintTile("food", o, b.word, b.tone, `${c.meals||0} photo${c.meals===1?"":"s"}${k && k.target ? ` · ${Math.round(k.actual / k.target * 100)}% kcal` : ""}`);
  };
  // fill: how full the ring is, 0 to 1. Left out, a number from 0 to 100 is its own fill.
  const paintTile = (k, num, word, tone, sub, fill)=>{
    const el = view.querySelector(`.score[data-k="${k}"]`);
    if (!el) return;
    el.querySelector(".snum").textContent = num == null ? "—" : num;
    el.querySelector(".snum").style.color = num == null ? "var(--muted)" : toneC(tone);
    // The hero box carries the colour as a background; a legend row carries it on its dot.
    el.dataset.tone = num == null ? "none" : (tone || "neutral");
    const w = el.querySelector(".sword"); w.textContent = word || "\u00a0"; w.style.color = toneC(tone);
    el.querySelector(".ssub").innerHTML = sub || "&nbsp;";
    const ring = el.querySelector(`.rfill[data-k="${k}"]`);
    if (ring){
      const C = 2 * Math.PI * (+ring.getAttribute("r"));
      let f = fill != null ? fill : num == null ? 0 : (typeof num === "number" && num >= 0 && num <= 100 ? num / 100 : 1);
      f = Math.max(0, Math.min(1, f));
      ring.setAttribute("stroke-dasharray", `${(C * f).toFixed(2)} ${C.toFixed(2)}`);
      ring.style.stroke = num == null ? "var(--muted)" : (tone === "good" || tone === "warn" || tone === "bad") ? toneC(tone) : "rgba(255,255,255,.6)";
      ring.style.opacity = num == null ? ".35" : "1";
    }
  };
  const verdictOf = (d)=>{
    const r = d.recovery, f = d.fatigue, t = d.training;
    const strava = d.sources && d.sources.strava && d.sources.strava.connected;
    if (!r.band && !strava) return "";
    const g = r.guide || {};
    // The HRV-guided rule the trials used, once it has its 14 nights: below
    // the band two days running is rest; below it once is easy, same volume.
    if (g.state === "low2") return "Rest day. HRV has sat below your band two days running; that is the signal the trials rested on.";
    if (g.state === "low") return "Easy day: Zone 1 at 116 or under, full volume. HRV is below your band; swap the hard session, keep the hours.";
    if ((r.band && r.band.key === "red") || (strava && f.form && f.form.key === "overreached"))
      return "Easy day: Zone 1 at 116 or under, or off. The body is asking, not the plan.";
    if (strava && f.monotony && f.monotony.band === "high" && f.tsb < -10)
      return "Vary the week: seven same-sized days carry more strain than the load says. Make one of them long and one of them nothing.";
    if (r.band && r.band.key === "yellow" && strava && f.tsb < -10 && g.state !== "ok" && g.state !== "high")
      return "Zone 1 today. Save the 40/20s for a green morning.";
    if ((g.state === "high" || g.state === "ok" || (r.band && r.band.key === "green")) && (!strava || f.tsb >= -10))
      return "Green light. If the plan says VO2, today is the day.";
    if (strava && t.ramp && t.ramp.key === "too-fast")
      return "Fitness is climbing faster than +6 a week. Hold the volume this week.";
    return "Train as planned.";
  };
  const drawScores = ()=>{
    const d = scoresData;
    const vd = document.getElementById("scoreVerdict");
    if (!d){
      paintTile("training", null, "", "", scoresLoading ? "reaching the bridge…" : "bridge unreachable");
      paintTile("recovery", null, "", "", "");
      paintTile("fatigue", null, "", "", "");
      if (vd) vd.textContent = "";
      drawFood(); drawMicroTile(); drawHydrationTile(); drawWorkoutsTile();
      return;
    }
    const strava = d.sources && d.sources.strava && d.sources.strava.connected;
    const t = d.training, f = d.fatigue, r = d.recovery;
    if (strava && t){
      paintTile("training", t.ctl, fitLevel(t.ctl), t.ramp ? t.ramp.tone : "",
        t.ramp ? `${sgn(t.ramp_7d)}/wk · ${t.ramp.word}` : `${t.tss_7d} TSS/wk`);
      drawSpark(d.series);
      paintTile("fatigue", f.atl, f.form ? f.form.word : "", f.form ? f.form.tone : "",
        `form ${sgn(f.tsb)}`, t.ctl ? f.atl / (2 * t.ctl) : 0.5);   // fatigue against fitness: twice the fitness is a full ring
    } else {
      paintTile("training", null, "", "", "Strava not connected");
      paintTile("fatigue", null, "", "", "");
    }
    const src = (d.sources && d.sources.recovery) || { source: "whoop" };
    if (r.score != null){
      const hrv = r.hrv_delta_pct != null ? `HRV ${sgn(Math.round(r.hrv_delta_pct))}%` : r.hrv != null ? `HRV ${Math.round(r.hrv)}` : "";
      if (src.source === "garmin"){
        // the Garmin's morning, through intervals.icu: a day old at most by construction
        paintTile("recovery", r.score, r.band.word, r.band.tone, `${hrv ? hrv + " · " : ""}Garmin${/estimated/.test(src.basis||"") ? ", estimated" : ""}`);
      } else {
        // Yesterday's score with a dead token is not today's recovery: say so on the box.
        const w = d.sources && d.sources.whoop || {};
        const ageH = w.synced_at ? (Date.now() - new Date(w.synced_at).getTime()) / 3.6e6 : null;
        const stale = !!w.auth_error || (ageH != null && ageH > 20);
        paintTile("recovery", r.score, stale ? "stale" : r.band.word, stale ? "bad" : r.band.tone, stale ? (w.auth_error ? "WHOOP needs reconnecting" : `synced ${Math.round(ageH)}h ago`) : hrv);
      }
    } else {
      const w = d.sources && d.sources.whoop;
      paintTile("recovery", null, "", "", src.garmin_configured ? "no morning from the Garmin yet" : w && w.auth_error ? "WHOOP needs reconnecting" : w && w.connected ? "no reading yet" : "no watch connected");
    }
    if (vd) vd.textContent = verdictOf(d);
    drawFood();
    drawWeightTile();
    drawMicroTile();
    drawHydrationTile();
    drawWorkoutsTile();
    drawScoreDetail();
  };

  const row = (n, v)=> `<li><span class="n">${n}</span><span class="tag">${v}</span></li>`;
  const drawScoreDetail = ()=>{
    const box = document.getElementById("scoreDetail");
    if (!box) return;
    view.querySelectorAll(".score").forEach(b => b.classList.toggle("on", b.dataset.k === openScore));
    if (!openScore || (!scoresData && openScore !== "food" && openScore !== "weight" && openScore !== "bodyfat" && openScore !== "micros" && openScore !== "hydration" && openScore !== "workouts" && openScore !== "sleep" && openScore !== "lift")){ box.hidden = true; box.innerHTML = ""; return; }
    const d = scoresData, strava = d && d.sources && d.sources.strava && d.sources.strava.connected;
    let html = "";
    if (openScore === "sleep"){
      const L = chainData && chainData.links && chainData.links.sleep;
      html = `<h4>Sleep · the week</h4>
        ${L && L.nights && L.nights.length ? `<ul class="agenda totals">${L.nights.slice().reverse().map(x => row(esc(new Date(x.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })), `<b style="color:${toneC(x.hours >= 7 ? "good" : x.hours >= 6.25 ? "warn" : "bad")}">${x.hours} h</b>${x.score != null ? ` <span class="small">· score ${x.score}</span>` : ""}`)).join("")}</ul>
          <div class="small">${L.week} h a night on average. ${esc(L.basis)}.</div>` : `<div class="small">No nights from the Garmin yet. Sleep comes through intervals.icu once the watch is syncing there.</div>`}
        <details class="why"><summary>why it is first</summary><div class="small">Sleep sits at the head of the chain because it moves what follows: short nights raise appetite and lower restraint the next day, blunt HRV and recovery, and make the planned work feel harder than it is. Seven hours is the line; under six and a quarter the week is being spent.</div></details>`;
      box.innerHTML = html; box.hidden = false; return;
    }
    if (openScore === "lift"){
      const L = chainData && chainData.links && chainData.links.lift;
      html = `<h4>Lifting · the week</h4>
        ${L ? `<ul class="agenda totals">${(L.week_list || []).slice().reverse().map(x => row(`${esc(x.date.slice(5).replace("-", "/"))} · ${esc(x.name)}`, `${(x.volume_lb / 1000).toFixed(1)}k lb`)).join("") || `<li><span class="n">Nothing logged this week</span><span class="tag">0 of ${L.target}</span></li>`}</ul>
          <div class="small">${L.sessions} of ${L.target} sessions. ${esc(L.basis)}.</div>` : `<div class="small">loading…</div>`}
        <div class="rowbtns"><a class="btn primary" href="#lift">The Lift tab</a></div>
        <details class="why"><summary>how it is coloured</summary><div class="small">Sessions logged in the last seven days against the plan's five. Green at four or five, amber at three, red at two or fewer. Grey before the first session is saved and through a deload week (every ninth). In the first week the count is judged against the sessions due so far, so two by Wednesday is green, not red. It does not add to fitness (CTL), which is a riding number; it shows up as strength on the Lift tab and, over months, as power on the bike.</div></details>`;
      box.innerHTML = html; box.hidden = false; return;
    }
    if (openScore === "micros"){
      const B = window.foodBits || {};
      html = `<h4>Micronutrients · this week</h4>${B.microHTML ? B.microHTML(foodData && foodData.micros, foodData) : `<div class="small">loading…</div>`}
        <details class="why"><summary>how it's scored</summary><div class="small">Thirteen nutrients against their daily targets, averaged; today owes only the share of the day reached so far. Iron and zinc are suggested only after a week low.</div></details>`;
      box.innerHTML = html; box.hidden = false;
      if (B.wireMicro) B.wireMicro(box, async ()=>{ await refreshScores(); refreshFood(); });
      return;
    }
    if (openScore === "workouts"){
      const t = workoutsToday();
      const bandTone = b => b === "green" ? "good" : b === "yellow" ? "warn" : b === "red" ? "bad" : "neutral";
      // the same words the calendar uses: done, over, partly, short (a ride, but not enough), missed
      const gradeWordOf = (p, rides) => p.band === "green" ? (p.pct > 120 ? "over" : "done") : p.band === "yellow" ? "partly" : p.band === "red" ? (rides ? "short" : "missed") : "done";
      html = `<h4>Workouts · today</h4>
        ${!t ? `<div class="small">bridge unreachable</div>` : `<ul class="agenda totals">
          ${t.planned.map(p => row(`${p.time ? hm12(p.time) + " · " : ""}${esc(p.name)}${p.minutes ? ` <span class="small">${p.minutes} min</span>` : ""}`,
              p.done ? `<b style="color:${toneC(bandTone(p.band || "green"))}">${gradeWordOf(p, t.rides.length)}</b>${p.pct != null ? ` · ${p.pct}%` : ""}` : `<span class="small">to do</span>`)).join("")}
          ${t.rides.filter(r => !t.planned.some(p => p.done)).map(r => row(`${r.time ? hm12(r.time) + " · " : ""}${esc(r.name)} <span class="small">${r.minutes} min</span>`, `<b style="color:${toneC("good")}">ridden</b>${r.tss ? ` · ${r.tss} TSS` : ""}`)).join("")}
          ${!t.planned.length && !t.rides.length ? `<li><span class="n">Nothing planned</span><span class="tag">rest day</span></li>` : ""}
        </ul>`}
        <a class="btn primary" href="#calendar">The calendar</a> <a class="btn" href="#zones">Training zones</a>
        <details class="why"><summary>how it's scored</summary><div class="small">Done over planned. A session is done when Strava has the ride or it was logged by hand. Green all done, amber part-way, red once the last session's time has passed.</div></details>`;
      box.innerHTML = html; box.hidden = false; return;
    }
    if (openScore === "hydration"){
      const h = foodData && foodData.hydration;
      html = `<h4>Hydration · today</h4>
        ${h && h.series && window.foodBits ? foodBits.hydrationHTML(h) : h ? `<ul class="agenda totals">${(h.drinks||[]).map(d => row(d.time ? hm12(d.time) : "drink", `${esc(d.name)} · ${d.ml} ml`)).join("")}</ul><div class="small">${esc(h.note || "")}</div>` : `<div class="small">bridge unreachable</div>`}
        <div class="rowbtns"><a class="btn primary" href="#live">Live fuel and hydration</a> <a class="btn" href="#food">Snap a drink</a></div>`;
      box.innerHTML = html; box.hidden = false; if (h && h.series && window.foodBits) foodBits.wireHydration(box, h); return;
    }
    if (openScore === "bodyfat"){
      const w = bodyData, c = w && w.composition;
      const rows = c ? (w.trends||[]).filter(t => t.key !== "lb" && t.value != null).map(t => row(t.label, `<b>${t.value}${esc(t.unit)}</b>${t.delta != null ? ` · ${sgn(t.delta)}${esc(t.unit.trim())} ${esc(t.basis || "")}` : ""}`)).join("") : "";
      html = `<h4>Body fat</h4>
        ${c ? `<ul class="agenda totals">${rows}</ul><div class="small">From the Withings scale, ${esc(new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}. Moves are the 7-day mean against the week before.</div>` : `<div class="small">${w && w.withings_connected ? "The scale has not reported body fat yet." : "Body fat needs the Withings scale."}</div>`}
        <details class="why"><summary>how it's read</summary><div class="small">A bioimpedance reading swings a point or two with water alone, so the tile's word comes from the weekly mean, not the day. Losing fat while the lean rows hold is the program working.</div></details>`;
      box.innerHTML = html; box.hidden = false; return;
    }
    if (openScore === "weight"){
      html = bodyHTML(bodyData) + `<div class="small">Latest reading; the word is the week-over-week move of the 7-day average.</div>`;
      box.innerHTML = html; box.hidden = false; wireBody(box); return;
    }
    if (openScore === "food"){
      const c = complianceData;
      html = `<h4>Food · compliance</h4>
        ${c ? complianceHTML(c) : `<div class="small">bridge unreachable</div>`}
        <a class="btn primary" href="#food">Snap a meal</a>
        <details class="why"><summary>how it's scored</summary><div class="small">Half is the macros against what the plan says should be in by now, half is the journal against today's rules. 80 on target, 60 close.</div></details>`;
    } else if (openScore === "training"){
      const t = d.training;
      html = `<h4>Fitness</h4>
        ${strava ? `<ul class="agenda totals">
          ${row("fitness (CTL)", `<b>${t.ctl}</b> TSS/day · ${fitLevel(t.ctl)}`)}
          ${row("change this week", `<b style="color:${toneC(t.ramp.tone)}">${sgn(t.ramp_7d)}</b> · ${esc(t.ramp.word)}`)}
          ${row("last 7 days", `${t.tss_7d} TSS`)}
          ${row("today so far", `${t.tss_today} TSS`)}
        </ul>` : `<div class="small">Strava isn't answering (${esc((d.sources.strava||{}).reason || "not connected")}), so there is no ride history to score.</div>`}
        <a class="btn" href="#zones">Training zones</a>
        <details class="why"><summary>how it's scored</summary><div class="small">Fitness is a 42-day average of daily training stress (CTL), the same number TrainingPeaks and intervals.icu call Fitness. Under 25 is base, 25 to 45 recreational, 45 to 65 solid, 65 to 85 strong, over 85 racer. +2 to +6 a week is a sustainable build.</div></details>`;
    } else if (openScore === "fatigue"){
      const f = d.fatigue;
      html = `<h4>Fatigue · form</h4>
        ${strava ? `<ul class="agenda totals">
          ${row("fatigue (ATL)", `<b>${f.atl}</b> TSS/day`)}
          ${row("form (TSB)", `<b style="color:${toneC(f.form.tone)}">${sgn(f.tsb)}</b> · ${esc(f.form.word)}`)}
          ${f.monotony ? row("monotony, this week", `<b style="color:${toneC(f.monotony.band === "high" ? "warn" : "good")}">${f.monotony.value}</b> · ${f.monotony.band === "high" ? "same-sized days" : "varied"} · strain ${f.monotony.strain}`) : ""}
          ${row("yesterday", `${f.tss_yesterday} TSS`)}
        </ul>
        <div class="small"><b>${esc(f.form.word)}</b> — ${esc(f.form.note)}</div>` : `<div class="small">Strava isn't answering, so there is no ride history to score.</div>`}
        <details class="why"><summary>how it's scored</summary><div class="small">Fatigue is the 10-day average. Form is fitness minus fatigue: +5 to +25 fresh, −10 to −30 productive, below −30 overreached.</div></details>`;
    } else {
      const r = d.recovery, w = d.sources.whoop || {};
      const age = w.synced_at ? (Date.now() - new Date(w.synced_at).getTime())/3.6e6 : null;
      const when = age == null ? "" : age < 1 ? "just synced" : age < 24 ? `synced ${Math.round(age)}h ago` : `synced ${Math.round(age/24)}d ago`;
      const base = r.baseline_days >= 7 ? `30-day median` : `baseline after ${7 - r.baseline_days} more morning${7 - r.baseline_days === 1 ? "" : "s"}`;
      const rs = (d.sources && d.sources.recovery) || { source: "whoop" }, garmin = rs.source === "garmin";
      html = `<h4>Recovery · last night${garmin ? " · Garmin" : ""}</h4>
        ${r.score != null ? `<ul class="agenda totals">
          ${row(garmin ? (/estimated/.test(rs.basis||"") ? "readiness, estimated" : "Garmin readiness") : "WHOOP recovery", `<b style="color:${toneC(r.band.tone)}">${r.score}</b> · ${r.band.word}`)}
          ${garmin && rs.body_battery != null ? row("Body Battery, high", `${rs.body_battery}`) : ""}
          ${r.guide ? row("HRV guide", r.guide.state === "warming" ? `<span class="small">${esc(r.guide.note)}</span>` : `<b style="color:${toneC(r.guide.state === "low2" ? "bad" : r.guide.state === "low" ? "warn" : "good")}">${esc(r.guide.state === "ok" ? "in band" : r.guide.state === "high" ? "above band" : r.guide.state === "low" ? "below band" : "below, 2 days")}</b> · 7-day ${r.guide.week_mean} vs ${r.guide.band_lo}–${r.guide.band_hi}${r.guide.trusted ? "" : " (settling)"}`) : ""}
          ${row("HRV", `${r.hrv != null ? Math.round(r.hrv) : "—"} ms${r.hrv_delta_pct != null ? ` · <b style="color:${toneC(r.hrv_delta_pct >= 0 ? "good" : r.hrv_delta_pct <= -10 ? "bad" : "warn")}">${sgn(Math.round(r.hrv_delta_pct))}%</b> vs ${r.hrv_baseline}` : ` · ${base}`}`)}
          ${row("resting HR", `${r.rhr ?? "—"} bpm${r.rhr_delta != null ? ` · <b style="color:${toneC(r.rhr_delta <= 0 ? "good" : r.rhr_delta >= 5 ? "bad" : "warn")}">${sgn(r.rhr_delta)}</b> vs ${r.rhr_baseline}` : ""}`)}
          ${r.resp != null ? row("breathing, overnight", `${r.resp} /min${r.resp_delta != null ? ` · <b style="color:${toneC(Math.abs(r.resp_delta) < 1 ? "good" : Math.abs(r.resp_delta) >= 2 ? "bad" : "warn")}">${sgn(r.resp_delta)}</b> vs ${r.resp_baseline}` : ""}`) : ""}
          ${r.spo2 != null ? row("blood oxygen", `${r.spo2}%`) : ""}
          ${row("slept", `${r.sleep_h ?? "—"} h${r.sleep_performance != null ? ` · ${r.sleep_performance}% of need` : ""}`)}
        </ul>
        <div class="small">${garmin ? `From the Garmin through intervals.icu, ${esc(rs.date||"")}: ${esc(rs.basis||"")}.` : `${esc(when)}${age != null && age >= 2 ? ` · <button class="linkish" id="whoopSync">sync now</button>` : ""}`}</div>`
        : `<div class="small">${rs.garmin_configured ? "intervals.icu is connected but has no morning from the Garmin yet. Wear the watch overnight and let Garmin Connect sync to intervals.icu." : !w.connected ? `WHOOP not connected — ${reconnectLink()}`
            : w.auth_error ? `WHOOP needs reconnecting — ${reconnectLink()} (${esc(w.auth_error.detail || "")})`
            : `connected, but no sleep record yet — <button class="linkish" id="whoopSync">sync now</button>`}</div>`}
        ${w.auth_error && r.score != null && !garmin ? `<div class="small"><b>WHOOP needs reconnecting</b> — ${reconnectLink()}</div>` : ""}
        <details class="why"><summary>how it's scored</summary><div class="small">${garmin ? "The Garmin's training readiness for the morning when it reports one; otherwise an estimate from HRV against your own 30-day baseline and last night's sleep, said so on the box." : "WHOOP's score for the night."} The verdict above the boxes follows your 7-day HRV against your own 28-day band: below it, easy; below it two days running, rest.</div></details>`;
    }
    box.innerHTML = html; box.hidden = false;
    // A forced pull, for when the webhook didn't arrive. The passive read is
    // cached for ten minutes, so without this the only cure was waiting.
    const sync = document.getElementById("whoopSync");
    if (sync) sync.onclick = async ()=>{
      sync.textContent = "syncing…"; sync.disabled = true;
      try{ await bridge("/whoop/sync"); await refreshScores(); }
      catch(e){ sync.disabled = false; sync.textContent = "sync failed — " + e.message; }
    };
  };
  view.querySelectorAll(".score").forEach(b => b.onclick = ()=>{
    openScore = openScore === b.dataset.k ? null : b.dataset.k;
    drawScoreDetail();
  });
  // Each answer paints as it lands, so a slow or cold bridge shows the boxes
  // one by one instead of a wall of "reaching the bridge…"; anything still
  // missing after twelve seconds is asked for again once.
  let scoresLoading = true;
  const refreshScores = async ()=>{
    scoresLoading = true;
    const get = (path, set) => { const once = () => bridge(path).then(v => { set(v); drawScores(); return v; }).catch(()=>null); return once().then(v => v == null ? new Promise(r => setTimeout(r, 12000)).then(once) : v); };
    await Promise.all([
      get("/scores", v => { scoresData = v; }),
      get("/compliance", v => { complianceData = v; }),
      get("/food/today", v => { foodData = v; HUB.food = v; if (window.__repaintDay) { try{ window.__repaintDay(); }catch{} } }),
      get("/chain", v => { chainData = v; paintChain(v); }),
      (()=>{ const d=new Date(), k=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); const a=new Date(d.getTime()-7*864e5), b=new Date(d.getTime()+7*864e5); const kk=x=>x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); return bridge(`/calendar?from=${kk(a)}&to=${kk(b)}`).then(r=>{ WGRADE={}; BTS={}; for(const day of (r.days||[])){ for(const w of (day.planned||[])) if(w.compliance) WGRADE[w.id]={band:w.compliance.band, pct:w.compliance.pct, over:!!w.compliance.over, logged:!!w.logged, rides:(day.done||[]).length}; for(const x of (day.done||[])) if(x.breakthrough) (BTS[day.date]=BTS[day.date]||[]).push({ name:x.name, time:x.time||null, minutes:x.minutes, bt:x.breakthrough }); } if (Object.keys(BTS).length && window.__repaintDay) { try{ window.__repaintDay(); }catch{} } r.today_day=(r.days||[]).find(x=>x.date===k)||null; workoutsData = r; drawScores(); return r; }); })().catch(()=>null)
    ]);
    scoresLoading = false;
    drawScores();
    fuelDots();
  };
  // The fuel verdict on each planned session, as a dot before its name, for
  // today and the next two days (the bridge runs the fuel model for each).
  // Fetched after the page is up, so it never slows the page; the dots land
  // when it answers.
  const fuelDots = ()=> bridge("/fuel/ahead?days=3").then(f => {
    FUELV = {}; for (const s of (f.sessions||[])) FUELV[s.date + "|" + s.name] = s;
    repaint();
  }).catch(()=>{});


  // Redraw from cache: moves the "now" band and the next-up line as time
  // passes. Cheap, so it can run often; no network, no flicker of live data.
  // Which day is on screen, as an offset from today. 0 = today.
  let offset = 0;
  const dayAt = (off)=>{
    const i = (cached.todayIndex || 0) + off;
    return (i >= 0 && i < cached.days.length) ? cached.days[i] : null;
  };

  window.__repaintDay = ()=>{ try{ repaint(); }catch{} };
  const repaint = ()=>{
    if (!cached.days.length) return;
    // Crossing midnight makes every card wrong. Reload rather than patch —
    // it rebuilds the week from today and picks up any deploy at the same time.
    // Compare against the day the bridge called today, in its zone.
    const todayThere = cached.days.length && cached.days[cached.todayIndex || 0]
      ? cached.days[cached.todayIndex || 0].date : null;
    if (todayThere && cached.dateKey && todayThere !== cached.dateKey){ location.reload(); return; }
    const day = dayAt(offset);
    const list = document.getElementById("dayList");
    // Only today gets the live now-marker; on any other day a "now" band would
    // be pointing at a time that already passed or hasn't arrived.
    if (list) list.innerHTML = day
      ? dayCard(day, cached.plan, nowMin(), cached.recommendation, true)
      : `<div class="card"><div class="small">No data for that day — the schedule reaches
          ${cached.days.length} days from ${esc(cached.days[0].date)}.</div></div>`;

    placeNowDot();
    const lab = document.getElementById("dayLabel");
    if (lab) lab.textContent = offset === 0 ? "Today"
      : offset === -1 ? "Yesterday" : offset === 1 ? "Tomorrow"
      : (day ? day.label : "—");
    const prev = document.getElementById("dayPrev"), next2 = document.getElementById("dayNext");
    if (prev) prev.disabled = !dayAt(offset-1);
    if (next2) next2.disabled = !dayAt(offset+1);

    // The strips below the schedule are about today: last night's recovery,
    // today's eating. Hide them rather than show
    // today's numbers under yesterday's date.
    const isToday = offset === 0;
    const fl = document.getElementById("foodLog");
    const bd = document.getElementById("body");
    for (const id of ["scores", "scoreVerdict", "scoreDetail"]){
      const el = document.getElementById(id);
      if (el) el.style.display = isToday ? "" : "none";
    }
    if (fl) fl.style.display = isToday ? "" : "none";
    if (bd) bd.style.display = isToday ? "" : "none";

    const today = dayAt(0), nm = nowMin();
    const rows = today ? dayRows(today, cached.plan, true).filter(r => !r.open) : [];
    const onNow = rows.find(r => r.start <= nm && nm < r.end);
    const nx = rows.find(r => r.start > nm);
    const hero = document.getElementById("upnext");
    if (hero){
      if (onNow){
        hero.className = "upnext is-now";
        hero.innerHTML = `<div class="label">Now</div><div class="what">${esc(onNow.title)}</div>
          <div class="when">until ${esc(onNow.to)}${nx ? ` · then ${esc(nx.title)} at ${esc(nx.from)}` : ""}</div>`;
      } else if (nx){
        const mins = nx.start - nm;
        const away = mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins/60)}h ${mins%60 ? (mins%60)+"m" : ""}`.trim();
        hero.className = "upnext";
        hero.innerHTML = `<div class="label">Next</div><div class="what">${esc(nx.title)}</div>
          <div class="when">${esc(nx.from)} · ${esc(away)}</div>`;
      } else {
        hero.className = "upnext clear";
        hero.innerHTML = `<div class="label">${rows.length ? "Done for the day" : "Today"}</div>
          <div class="what">${rows.length ? "Nothing left on the calendar" : "Nothing scheduled"}</div>`;
      }
    }
    const el = document.getElementById("nowNext");
    if (el) el.textContent = "";
  };

  const step = (n)=>{ if (dayAt(offset+n)){ offset += n; repaint(); } };
  document.getElementById("dayPrev").onclick = ()=> step(-1);
  document.getElementById("dayNext").onclick = ()=> step(1);
  // Arrow keys on the tablet's keyboard, and a swipe on the phone.
  __dayKeys = (e)=>{
    if (location.hash !== "#today") return;
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
    if (e.key === "Home") { offset = 0; repaint(); }
  };
  document.addEventListener("keydown", __dayKeys);
  // A swipe changes the day only when it is deliberate: most of the screen's
  // width, nearly flat, and not a scroll. A brush of the thumb does nothing.
  let touchX = null, touchY = null, touchT = 0;
  view.addEventListener("touchstart", e=>{ const t = e.changedTouches[0]; touchX = t.clientX; touchY = t.clientY; touchT = Date.now(); }, {passive:true});
  view.addEventListener("touchend", e=>{
    if (touchX == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX, dy = t.clientY - touchY, dt = Date.now() - touchT; touchX = touchY = null;
    const need = Math.max(200, view.clientWidth * 0.55);
    if (Math.abs(dx) >= need && Math.abs(dy) < 40 && dt < 900) step(dx < 0 ? 1 : -1);
  }, {passive:true});

  const stamp = ()=>{
    const el = document.getElementById("nowFresh");
    if (!el) return;
    const n = new Date();
    let h=n.getHours(); const mm=String(n.getMinutes()).padStart(2,"0"); const ap=h<12?"a":"p";
    h=h%12; if(h===0)h=12;
    el.textContent = "updated " + h + ":" + mm + ap;
  };

  const loadDay = async ()=>{
    try{
      // A week either side, so stepping back to yesterday (or forward) is
      // instant and needs no second round trip.
      const [s, plan, wx] = await Promise.all([
        bridge("/schedule?days=15&back=7"),
        bridge("/plan").catch(()=>({for_today:false})),
        bridge("/weather/outlook").catch(()=>null)
      ]);
      if (wx && wx.days) WX = wx.days;
      const days = s.days || [];
      const ti = Number.isInteger(s.today_index) ? s.today_index
        : Math.max(0, days.findIndex(d=>d.today));
      cached = { days, plan, recommendation: s.recommendation, todayIndex: ti,
        macros: days[ti] ? days[ti].macros : null,
        timezone: (s.sources && s.sources.timezone) || cached.timezone,
        dateKey: (days[ti] && days[ti].date) || localDateKey() };
      repaint();
      stamp();

      // Say plainly which lanes are actually feeding this page.
      const src = s.sources || {};
      const missing = [];
      if (!src.calendar_connected) missing.push("Google Calendar not connected (visit /gcal/auth on the bridge)");
      // Name the account that failed — "calendar not working" is useless when
      // more than one account feeds the day.
      (src.account_errors || []).forEach(e => missing.push("Google account " + e + " — reconnect at /gcal/auth"));
      if (!src.classes_configured) missing.push("no class schedule yet (bridge/schedule-classes.json)");
      if (!src.intervals_configured) missing.push("intervals.icu not configured (INTERVALS_ICU_API_KEY + INTERVALS_ICU_ATHLETE_ID)");
      if (src.intervals_error) missing.push("intervals.icu: " + src.intervals_error);
      const accounts = (src.accounts||[]).length ? " (" + (src.accounts||[]).join(", ") + ")" : "";
      // A copied calendar must never read as a live one. Say where it came
      // from, when it was taken, and how far it still reaches.
      const snap = src.snapshot;
      const feeding = (src.calendars||[]).slice();
      if (snap) feeding.push(...snap.calendars.map(c => c + " (snapshot)"));
      const snapNote = snap
        ? `<br>${snap.used} ${snap.used === 1 ? "entry" : "entries"} on this page come from a calendar snapshot taken
           ${esc(snap.captured_at)}, good through ${esc(snap.covers.to)} — connect a
           calendar in Settings to replace it with the live one.`
        : "";
      document.getElementById("daySources").innerHTML = `<details class="why"><summary>sources</summary><div class="small">` + (missing.length
        ? "Feeding this page: " + (feeding.join(" · ") || "nothing yet") + esc(accounts)
          + "<br>Missing — " + missing.map(esc).join("; ")
        : "Feeding this page: " + feeding.join(" · ") + esc(accounts) + " · classes · intervals.icu")
        + snapNote + `</div></details>`;
    }catch(e){
      const list = document.getElementById("dayList");
      // Keep the last good day on screen if there is one — a passing network
      // blip shouldn't wipe the schedule off a wall-mounted tablet.
      if (list && !cached.days.length)
        list.innerHTML = `<div class="card"><h4>The day</h4><div class="small">bridge unreachable — ${esc(e.message)}</div></div>`;
      const fresh = document.getElementById("nowFresh");
      if (fresh) fresh.textContent = "offline — showing the last good copy";
    }
  };

  {
    // The food card is the journal in brief: where the day stands, what to
    // eat next and when, the photos so far. The camera lives on #food.
    const refreshFood = async ()=>{
      const el = document.getElementById("foodLog");
      if (!el) return;
      let day = null;
      try{ day = await bridge("/food/today"); }
      catch(e){ el.innerHTML = `<h4>Food · today</h4><div class="small">bridge unreachable</div>`; return; }
      el.innerHTML = foodCardHTML(day);
    };

    /* ---- keeping it current ---- */
    let syncing = false, lastSync = 0;
    const syncAll = async (why)=>{
      if (syncing) return;                       // never stack fetches
      syncing = true;
      try{
        await Promise.all([loadDay(), refreshScores(), refreshFood(), refreshBody()]);
        lastSync = Date.now();
      } finally { syncing = false; }
    };

    // tap a row: it opens underneath with everything about it
    view.addEventListener("click", async (e)=>{
      if (e.target.closest("button, a, input, select, textarea, label, .evedit")) return;
      const box = e.target.closest(".wxh");
      if (box){ const el = box.closest(".wxstrip").querySelector(".wxwhy"); if (el) el.textContent = box.title + ": " + box.dataset.why; return; }
      // an all-day chip (a session with no time yet) opens the same way, under the chips
      const chip = e.target.closest(".xchip");
      if (chip){
        const wrap = chip.closest(".chips");
        const open = wrap.nextElementSibling && wrap.nextElementSibling.classList.contains("xchipdetail");
        view.querySelectorAll(".xchipdetail").forEach(x => x.remove());
        view.querySelectorAll(".xchip.on").forEach(x => x.classList.remove("on"));
        if (open && wrap.dataset.openFor === chip.dataset.x) { wrap.dataset.openFor = ""; return; }
        let x = {}; try{ x = JSON.parse(chip.dataset.x); }catch{}
        chip.classList.add("on"); wrap.dataset.openFor = chip.dataset.x;
        const d = document.createElement("ul"); d.className = "agenda xchipdetail"; d.innerHTML = `<li class="xdetail">${eventDetailHTML(x)}</li>`;
        wrap.after(d);
        if (x.wid){
          try{ const b = await bridge("/workouts/"+encodeURIComponent(x.wid)+"/brief"); d.firstElementChild.innerHTML = briefHTML(b, x); }
          catch(err){ d.firstElementChild.innerHTML += `<div class="small">${esc(err.message)}</div>`; }
        }
        return;
      }
      const li = e.target.closest("li.xrow"); if (!li) return;
      const open = li.nextElementSibling && li.nextElementSibling.classList.contains("xdetail");
      view.querySelectorAll("li.xdetail").forEach(x => x.remove());
      view.querySelectorAll("li.xrow.on").forEach(x => x.classList.remove("on"));
      if (open) return;
      let x = {}; try{ x = JSON.parse(li.dataset.x); }catch{}
      li.classList.add("on");
      const d = document.createElement("li"); d.className = "xdetail";
      d.innerHTML = eventDetailHTML(x);
      li.after(d);
      if (x.wid){
        try{ const b = await bridge("/workouts/"+encodeURIComponent(x.wid)+"/brief"); d.innerHTML = briefHTML(b, x); }
        catch(err){ d.innerHTML += `<div class="small">${esc(err.message)}</div>`; }
      }
    });
    // add to the calendar: here at once, on Google when the site is connected to it
    view.addEventListener("click", async (e)=>{
      const b = e.target.closest(".evSave"); if (!b) return;
      const box = b.closest(".addev"), msg = box.querySelector(".evMsg");
      const body = { title: box.querySelector(".evTitle").value.trim(), date: box.querySelector(".evDate").value, start: box.querySelector(".evStart").value, minutes: +box.querySelector(".evMin").value || 60, notes: box.querySelector(".evNotes").value.trim() };
      if (!body.title){ msg.textContent = "Give it a name."; return; }
      b.disabled = true; msg.textContent = "adding…";
      try{ const r = await bridge("/gcal/events", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) });
        msg.textContent = r.pushed_to_google ? "Added, and on Google." : r.google_connected ? "Added here; Google push failed, it will retry." : "Added here. It goes to Google once the site is connected to it.";
        box.querySelector(".evTitle").value = ""; syncAll("event added"); }
      catch(err){ msg.textContent = err.message; }
      b.disabled = false;
    });
    view.addEventListener("click", async (e)=>{
      const b = e.target.closest("[data-delx]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      if (!confirm("Remove this from the calendar?")) return;
      try{ await bridge("/gcal/event?key="+encodeURIComponent(b.dataset.delx),{method:"DELETE"}); syncAll("deleted"); }
      catch(err){ alert(err.message); }
    });
    view.addEventListener("click", async (e)=>{
      const b = e.target.closest(".evUpdate"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const box = b.closest(".evedit"), msg = box.querySelector(".evMsg");
      const body = { key: box.dataset.key, title: box.querySelector(".evTitle").value.trim(), date: box.querySelector(".evDate").value, start: box.querySelector(".evStart").value, end: box.querySelector(".evEnd").value, location: box.querySelector(".evLoc").value.trim(), notes: box.querySelector(".evNotes").value.trim() };
      b.disabled = true; msg.textContent = "saving…";
      try{ const r = await bridge("/gcal/event", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(body) }); msg.textContent = r.where === "google" ? "Saved, on Google." : (r.note || "Saved here."); syncAll("edited"); }
      catch(err){ msg.textContent = err.message; }
      b.disabled = false;
    });
    // the trash can beside a planned session on the day
    view.addEventListener("click", async (e)=>{
      const b = e.target.closest("[data-delw]"); if (!b) return;
      e.preventDefault();
      if (!confirm("Take this session off the calendar?")) return;
      try{ await bridge("/workouts/"+encodeURIComponent(b.dataset.delw),{method:"DELETE"}); syncAll("deleted"); }
      catch(err){ alert(err.message); }
    });
    syncAll("first load");
    __dayTimers.push(setInterval(()=>{
      if (location.hash !== "#today") return clearDayTimers();
      // Don't fetch into a screen nobody is looking at; the visibility handler
      // catches up the moment it comes back.
      if (document.visibilityState === "visible") syncAll("interval");
    }, DAY_SYNC_MS));
    __dayTimers.push(setInterval(()=>{
      if (location.hash !== "#today") return clearDayTimers();
      repaint();
    }, DAY_PAINT_MS));

    // Phones suspend timers in a backgrounded tab, so waking up is the moment
    // that matters most — the day could be hours stale.
    if (!__dayWake){
      __dayWake = true;
      const wake = ()=>{
        if (location.hash !== "#today" || document.visibilityState !== "visible") return;
        repaint();
        if (Date.now() - lastSync > DAY_STALE_MS) syncAll("woke up");
      };
      document.addEventListener("visibilitychange", wake);
      window.addEventListener("focus", wake);
      window.addEventListener("online", wake);
    }
  }
};

/* ---------------- FOOD (front page) ----------------
   The journal in brief. Hexis and Alma are gone: the target comes from the
   day's training (bridge/food-math.js), the intake from the photos. */
function hm12(t){ const m=/^(\d{2}):(\d{2})$/.exec(t||""); if(!m) return t||""; let h=+m[1]; const ap=h<12?"a":"p"; h=h%12; if(h===0)h=12; return h+":"+m[2]+ap; }
function nowHM(){ const d=new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
function foodCardHTML(day){
  const B = window.foodBits || {};
  const c = day.compliance, b = c.band;
  const tone = t => t==="good"?"var(--green)":t==="warn"?"var(--amber)":t==="bad"?"var(--red)":"var(--ink)";
  const now = nowHM();
  const next = (day.meals||[]).find(m => m.time >= now && !(m.logged||[]).length) || null;
  const CAM = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
  const plan = (day.meals||[]).map(m => { const logged = (m.logged||[]).length;
    const mealOf = ["breakfast","lunch","dinner","snack","on the bike"].includes(m.slot) ? m.slot : "snack";
    const mark = logged ? `<span class="mk ok">✓</span>` : m.time < now ? `<span class="mk no">✗</span>` : `<span class="mk"></span>`;
    return `<li class="${logged?"done":m===next?"next":(m.time<now?"past":"")}">
      <span class="t">${esc(hm12(m.time))}</span>
      <span class="n">${esc(m.slot)}<span class="small"> ${esc(m.what)}</span></span>
      <span class="tag mealtag">${mark}<a class="cam" href="#food?snap=${encodeURIComponent(mealOf)}" aria-label="Snap this meal">${CAM}</a></span></li>`; }).join("");
  return `<h4>Food · today${day.entries.length?` · ${day.entries.length} ${day.entries.length===1?"photo":"photos"}`:""}</h4>
    ${B.targetsRow ? B.targetsRow(day.target) : ""}
    ${day.target && day.target.deficit_note ? `<div class="small"><b>Deficit:</b> ${esc(day.target.deficit_note)}</div>` : ""}
    ${day.work && !day.work.compliant ? `<div class="cue" style="border-color:var(--amber);background:var(--amber-soft)"><b>From the ride:</b> ${esc(day.work.note)}</div>` : ""}
    ${day.cue ? `<div class="cue"><b>Now:</b> ${esc(day.cue.text)}</div>` : ""}
    <div class="macros"><span class="mfuel" style="${b?`background:${tone(b.tone)};border-color:${tone(b.tone)}`:""}">${c.overall==null?"No score yet":"Compliance "+c.overall+" · "+esc(b.word)}</span>
      <span class="small">${c.guidelines.meals||0} on the journal</span></div>
    ${B.thumbStrip ? B.thumbStrip(day.entries) : ""}
    <ul class="agenda mealplan">${plan}</ul>
    <a class="btn primary" href="#food">Snap a meal</a>`;
}

/* ---- compliance, for the Food tile's detail ---- */
function complianceHTML(c){
  if (!c || !c.target) return `<div class="small">No target for today — the bridge couldn't build one.</div>`;
  const p = c.compliance && c.compliance.per_macro;
  if (!p) return "";
  const band = s => s >= 90 ? "var(--green)" : s >= 70 ? "var(--amber)" : "var(--red)";
  const row = (label, key)=>{
    const m = p[key];
    if (!m) return "";
    return `<li><span class="n">${label}
        <span class="small">${m.actual} of ${m.target} · ${esc(m.direction)}${
          m.direction!=="on target"?` ${Math.abs(m.deviation_pct)}%`:""}</span></span>
      <span class="tag"><b style="color:${band(m.score)}">${m.score}</b></span></li>`;
  };
  const s = c.suggestion;
  const snack = !s ? ""
    : s.none ? `<div class="small">Every planned meal is logged.</div>`
    : `<div class="snack"><b>Next on the plan</b> — ${esc(s.name)}
        <div class="small">${esc(s.what||"")}</div>
        <div class="small">~${s.kcal} kcal · ${s.low_carb?"under ":""}${s.carbs_g}C · ${s.protein_g}P${s.score_after!=null?` — compliance ${s.score_before??"—"} → <b>${s.score_after}</b>`:""}</div>
        <a class="btn" href="#food?snap=${encodeURIComponent(s.snap||"snack")}">Snap it</a></div>`;
  const B = window.foodBits || {};
  return `<div class="macros"><span class="mfuel">Compliance ${c.compliance.overall ?? "—"}</span>
      <span class="small">${c.target.fuel_day ? esc(c.target.fuel_day) + " · " : ""}${c.meals||0} photo${c.meals===1?"":"s"}${
        c.compliance.guideline_overall!=null?` · guidelines ${c.compliance.guideline_overall}`:""}${
        c.compliance.macro_overall!=null?` · macros ${c.compliance.macro_overall}`:""}</span></div>
    ${B.checksList ? B.checksList(c.compliance.checks) : ""}
    <ul class="agenda totals">
      ${row("carbs","carbs_g")}${row("protein","protein_g")}${row("fat","fat_g")}${row("kcal","kcal")}
    </ul>
    ${snack}`;
}

/* Demo payload: same shape as /schedule, generated from today so the front
   page still reads as a real week when the bridge is unreachable. */
function demoSchedule(){
  const f = m=>{ let h=Math.floor(m/60), mm=m%60, ap=h<12?"a":"p"; h=h%12; if(h===0)h=12;
    return h+":"+String(mm).padStart(2,"0")+ap; };
  const ev = (s,e,summary,category,source,detail)=>({ summary, category, source, detail:detail||null,
    allDay:false, blocking:category!=="training", from:f(s), to:f(e), start_min:s, end_min:e, minutes:e-s });
  const DAY_START=5*60, DAY_END=21.5*60;
  const days=[];
  const BACK = 7, FWD = 7;          // same window the real /schedule returns
  for (let i=-BACK;i<=FWD;i++){
    const d=new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()+i);
    const key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    const dow=d.getDay(), events=[];
    if (dow>=1 && dow<=5){
      events.push(ev(8*60,8*60+45,"AP World History · Rm 114","work","class"));
      events.push(ev(10*60,10*60+45,"World History 9 · Rm 114","work","class"));
      events.push(ev(13*60,13*60+45,"Section meeting · Rm 114","work","class"));
    }
    if (dow===1||dow===3||dow===5) events.push(ev(6*60,7*60+15,"Z2 endurance","training","intervals","75 min · 62 TSS · Ride"));
    if (dow===2||dow===4) events.push(ev(6*60,6*60+50,"Lifting — kettlebell + Bowflex","training","intervals","50 min · WeightTraining"));
    if (dow===2||dow===4) events.push(ev(18*60,19*60+30,"U16 ECNL training · Seminary Park","coaching","coaching"));
    if (dow===6) events.push(ev(9*60,11*60,"U16 ECNL match day","coaching","coaching"));
    events.sort((a,b)=>a.start_min-b.start_min);
    const busy=events.filter(e=>e.blocking).map(e=>[e.start_min,e.end_min]);
    const windows=[]; let cursor=DAY_START;
    for (const [s,e] of busy){ if (s-cursor>=30) windows.push([cursor,Math.min(s,DAY_END)]); cursor=Math.max(cursor,e); if(cursor>=DAY_END) break; }
    if (DAY_END-cursor>=30) windows.push([cursor,DAY_END]);
    days.push({ date:key, today:i===0,
      dow:d.toLocaleDateString("en-US",{weekday:"short"}),
      label:d.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}),
      events, all_day:[],
      windows: windows.map(([s,e])=>({from:f(s),to:f(e),start_min:s,end_min:e,minutes:e-s,
        slot: s<12*60?"morning":(s>=15*60?"evening":"midday")})),
      available_min: windows.reduce((a,[s,e])=>a+(e-s),0), travel:false,
      macros: null });   // never fake a macro target — Hexis numbers are only ever real
  }
  return { connected:false, days, today_index:BACK,
    recommendation:"demo — connect the bridge for the real day",
    sources:{ calendars:["demo"], calendar_connected:false, classes_configured:false, intervals_configured:false } };
}

/* ---------------- SETTINGS + CONNECTIONS ----------------
   Every integration fails in three different places — no credentials, no
   authorization, no data yet — and each needs a different move. The list says
   which, per source, with the link that fixes it. */
V.settings = function(){
  view.innerHTML = `<span class="eyebrow">Setup</span>
    <div class="card" id="conn"><h4>Connections</h4><div class="small">checking…</div></div>`;

  const drawConnections = async ()=>{
    const el = document.getElementById("conn");
    if (!el) return;
    let st;
    try{ st = await bridge("/status"); }
    catch(e){
      // Error bodies can be a whole HTML page; show the gist, not the markup.
      const why = String(e.message||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,90);
      el.innerHTML = `<h4>Connections</h4><div class="small">Can't reach the bridge — ${esc(why)}.
        On the hosted site leave Bridge URL blank; the token below must match FUEL_TOKEN.</div>`;
      return;
    }
    const mark = s => s.error ? "!" : (s.connected && s.has_data) ? "✓" : s.connected ? "◐" : s.configured ? "○" : "×";
    const rows = (st.integrations||[]).map(s=>`
      <li class="${(s.connected&&s.has_data)?"done":""}">
        <span class="n"><b>${mark(s)} ${esc(s.name)}</b>
          <span class="small">${esc(s.role||"")}</span>
          <span class="small">${esc(s.error||s.detail||"")}</span>
          ${s.fix?`<span class="small"><b>→ ${esc(s.fix)}</b></span>`:""}</span>
        <span class="tag">${(s.auth_url && s.configured && s.fix)
          ? `<a href="${esc(s.auth_url)}">connect</a>` : ""}</span></li>`).join("");
    el.innerHTML = `<h4>Connections · ${st.ready} of ${st.total} live</h4>
      ${st.base_url_note?`<div class="small"><b>${esc(st.base_url_note)}</b></div>`:""}
      <ul class="agenda totals">${rows}</ul>
      <div class="small">✓ live and receiving · ◐ authorized, no data yet · ○ credentials set, not authorized · × not configured</div>
      <button id="recheck">Re-check</button>
      <div class="card" id="gcfg" style="margin-top:12px"><h4>Google Calendar · the connection</h4>
        <div class="small">The site reads your calendars and writes events you add here once it has a Google OAuth client. Make one in Google Cloud Console (APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Web application), add this redirect address, enable the Google Calendar API, and paste the client id and secret here. Then tap Connect and approve.</div>
        <div class="small">Redirect address: <code id="gRedirect">${esc(DEFAULT_API)}/gcal/callback</code></div>
        <div class="row2"><span><label>Client id</label><input id="gId" placeholder="…apps.googleusercontent.com" autocomplete="off"></span><span><label>Client secret</label><input id="gSecret" type="password" autocomplete="off"></span></div>
        <button class="primary" id="gSave">Save</button> <a class="btn" id="gConnect" href="${esc(DEFAULT_API)}/gcal/auth">Connect Google</a> <span class="small" id="gMsg"></span></div>`;
    try{
      const g = await bridge("/gcal/config");
      const r = document.getElementById("gRedirect"); if (r && g.redirect_uri) r.textContent = g.redirect_uri;
      const c = document.getElementById("gConnect"); if (c && g.auth_url) c.href = g.auth_url;
      const m = document.getElementById("gMsg"); if (m) m.textContent = g.configured ? `client set (${g.from}) · ${g.client_id}` : "no client yet";
      if (g.configured){ const id = document.getElementById("gId"); if (id) id.value = g.client_id; }
    }catch{}
    const gs = document.getElementById("gSave");
    if (gs) gs.onclick = async ()=>{
      const m = document.getElementById("gMsg"); m.textContent = "saving…";
      try{ const r = await bridge("/gcal/config", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ client_id: document.getElementById("gId").value.trim(), client_secret: document.getElementById("gSecret").value.trim() }) });
        m.textContent = "Saved. Now tap Connect Google and approve."; const c = document.getElementById("gConnect"); if (c && r.next) c.href = r.next; }
      catch(e){ m.textContent = e.message; }
    };
    const rc = document.getElementById("recheck");
    if (rc) rc.onclick = ()=>{ el.innerHTML = `<h4>Connections</h4><div class="small">checking…</div>`; drawConnections(); };
  };
  drawConnections();
};


/* ---------------- boot ---------------- */

if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
window.addEventListener("hashchange", nav);
// Setting the hash fires hashchange, which calls nav() — calling it here too
// booted the view twice, racing two copies of the day against each other.
// The views in food.js and plan.js are defined after this script runs, so
// the first route waits for the document to finish parsing.
if (!location.hash) location.hash = "#" + defaultView();
else if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", nav);
else nav();
