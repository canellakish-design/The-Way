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
function saveS(){ localStorage.setItem("way-settings", JSON.stringify(S)); }
const BAND = [-600,-300], TARGET = -450, BASE_BURN = 2050, PROTEIN_GOAL = 190;
// Four zones across the balance spectrum. Left = more calories eaten (less
// deficit or a surplus), right = fewer calories eaten (bigger deficit).
// Weight Loss (-600 to -300) is the original target band, unchanged.
function bandZone(b){
  if (b >= 0) return { name: "Race Fueling", color: "#3b82f6" };
  if (b > BAND[1]) return { name: "Maintenance", color: "var(--amber)" };
  if (b >= BAND[0]) return { name: "Weight Loss", color: "var(--green)" };
  return { name: "Below the Floor", color: "var(--red)" };
}
// Needle position: left = more calories eaten (surplus/small deficit),
// right = fewer calories eaten (bigger deficit). Anchored so b=+150 -> x=3
// (left edge) and b=-1050 -> x=97 (right edge), b=-450 (target) -> x=50 (center).
function bandX(b){
  return Math.max(3, Math.min(97, 3 + (150 - b) / 1200 * 94));
}
// The visual background must use the exact same bandX() boundaries as the
// needle, or the colored zones and the needle position can silently drift
// apart (this happened before: a hardcoded 30/70 split didn't match the
// true -300/-600 boundaries, so "Below the Floor" readings could still
// render inside the green band).
function gaugeBackground(){
  const raceX = bandX(0), maintX = bandX(BAND[1]), lossX = bandX(BAND[0]);
  return `linear-gradient(90deg,`
    + `var(--blue-soft) 0% ${raceX}%,`
    + `var(--amber-soft) ${raceX}% ${maintX}%,`
    + `var(--green-soft) ${maintX}% ${lossX}%,`
    + `var(--red-soft) ${lossX}% 100%)`;
}
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
  "/fuel-state": { carbs_g:62, fasted:false, meals_today:2, workout_kcal:480, balance_kcal:-410, ball_carbs_g:19.4, fresh:true },
  "/meals/today": { meals:[ {meal:"breakfast",name:"Blueberry oatmeal smoothie",kcal:520}, {meal:"lunch",name:"Post-ride bowl",kcal:750} ] },
  "/race": { race:{name:"Gran Fondo Maryland — Medio"}, weeks_out:10.1, phase:"build",
    need:{aerobic_h:6.2,hi_min:88,strength:2}, done:{aerobic_h:0,hi_min:0,strength:0}, remaining:{aerobic_h:6.2,hi_min:88,strength:2} },
  "/prescription/lunch": { kcal:850, note:"carb-weighted recovery", units:{protein:2,carb:5,fat:1,greens:2} },
  "/prescription/dinner": { kcal:1140, note:"settles the day in the band", units:{protein:4,carb:4,fat:2,greens:2} },
  "/podcasts/list": { episodes:[] },
  "/plan": { ride:null, for_today:false, intensity:"moderate", planned_hours:null, effective_hours:null, route:null },
  "/schedule": demoSchedule(),
  "/agent": { reply:"Demo mode — connect the bridge (Settings) or deploy the Netlify function for real answers." },
  "/agent/closeout": { ok:true }, "/meals": { ok:true },
  "/fitness": { ftp:271, threshold_hr:168, source:"eFTP — best 20 min effort", confidence:"medium",
    threshold_hr_source:"average HR during the best qualifying effort (not a measured VT2)",
    notes:["Demo data — connect the bridge and scan a ride for the real Signature."],
    power_zones:[{zone:"Z1",name:"Active Recovery",pct:"0–55%",from:0,to:149},{zone:"Z2",name:"Endurance",pct:"55–75%",from:149,to:203},
      {zone:"Z3",name:"Tempo",pct:"75–90%",from:203,to:244},{zone:"Z4",name:"Threshold",pct:"90–105%",from:244,to:285},
      {zone:"Z5",name:"VO2max",pct:"105–120%",from:285,to:325},{zone:"Z6",name:"Anaerobic Capacity",pct:"120–150%",from:325,to:407},
      {zone:"Z7",name:"Neuromuscular",pct:"150%+",from:407,to:null}],
    hr_zones:[{zone:"Z1",name:"Recovery",pct:"0–80%",from:0,to:134},{zone:"Z2",name:"Aerobic",pct:"80–89%",from:134,to:150},
      {zone:"Z3",name:"Tempo",pct:"89–95%",from:150,to:160},{zone:"Z4",name:"SubThreshold",pct:"95–100%",from:160,to:168},
      {zone:"Z5",name:"SuperThreshold",pct:"100–103%",from:168,to:173},{zone:"Z6",name:"Aerobic Capacity",pct:"103–106%",from:173,to:178},
      {zone:"Z7",name:"Anaerobic",pct:"106%+",from:178,to:null}],
    signals:{ test:null, eftp:{ftp:271, from:{minutes:20}, decay:1}, ventilatory:null, override:null },
    counts:{ efforts:3, segments:0, wellness_days:0, rides_scanned:1 } },
  "/fitness/log": { log:[] },
  "/workout-debt": { kcal: 480, count: 1, rides: [{name:"Morning Z2", kcal:480, source:"strava", at:new Date().toISOString()}] },
  "/batches": { batches:[ {slot:1,status:"building",ingredients:[],total_g:0,totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},scoop_g:null,remaining_g:0,scoops_remaining:null},
    {slot:2,status:"building",ingredients:[],total_g:0,totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},scoop_g:null,remaining_g:0,scoops_remaining:null},
    {slot:3,status:"building",ingredients:[],total_g:0,totals:{kcal:0,protein_g:0,carbs_g:0,fat_g:0},scoop_g:null,remaining_g:0,scoops_remaining:null} ] }
};
async function bridge(pathname, opts){
  const base = S.bridgeUrl || DEFAULT_API;
  try{
    const sep = pathname.includes("?") ? "&" : "?";
    const r = await fetch(base + pathname + sep + "token=" + (S.token||""), opts);
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
let __ttsSpeaking = false, __lastSpoken = "";
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
// bandColor removed — replaced by bandZone() above, which returns both name and color.

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
/* Legacy hashes (old tabs, saved links, kiosk bookmarks) land on their new homes. */
const REDIRECTS = { morning:"routine-am", day:"today", night:"routine-pm", agent:"plan" };
function nav(){
  let h = location.hash.replace("#","") || defaultView();
  if (REDIRECTS[h]){ location.hash = "#"+REDIRECTS[h]; return; }
  // No tab bar: the day is the app. Everything else still exists at its hash
  // (the alarm lands on the morning routine, the routines link to their
  // groups), so those views get one way back rather than being dead ends.
  const navEl = document.querySelector("nav");
  if (navEl) navEl.innerHTML = (h === "today" || h === "bedroom") ? "" : `<a href="#today" class="on">← The day</a>`;
  (V[h] || V.settings)();
}
/* The front page is the day, on every device. The bedside clock is still a
   tap away (button on the day, or the Sleep tab) and the alarm still lands
   on the Morning Routine, so the bedroom kiosk keeps working. */
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
  fuel:     "Fuel coach — the ledger, meals, prescriptions.",
  recover:  "Recovery coach — settling the day, winding down.",
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
  // Same flow serves both routines: before 3pm it checks off the Morning
  // Routine's mobility step, after 3pm the Nighttime Routine's.
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

/* ---------------- FUEL (the ledger + all logging) ---------------- */
V.fuel = async function(){

  view.innerHTML = `<span class="eyebrow">The Ledger</span>
    <div class="card" id="band"><h4>Balance</h4><div class="small">reaching the bridge…</div></div>

    <div class="card"><h4>Smoothie</h4>
      <button class="primary" id="favSmoothie">Log Smoothie</button>
      <div class="small" id="smoothieMsg"></div></div>

    <div class="card" id="workoutDebt"><h4>Workout Debt</h4><div class="small">reaching the bridge…</div></div>

    <div class="card"><h4>Log a meal</h4>
      <div class="row2"><span><label>Name</label><input id="mName" placeholder="Post-ride bowl"></span>
      <span><label>Meal</label><select id="mMeal"><option>breakfast</option><option>lunch</option><option>dinner</option><option>snack</option></select></span></div>
      <div class="row2"><span><label>kcal</label><input id="mK" type="number"></span>
      <span><label>protein g</label><input id="mP" type="number"></span></div>
      <div class="row2"><span><label>carbs g</label><input id="mC" type="number"></span>
      <span><label>fat g</label><input id="mF" type="number"></span></div>
      <button class="primary" id="mLog">Log</button>
      <button id="favBowl">Post-ride bowl (750)</button>
      <div class="small" id="mMsg"></div></div>

    <span class="eyebrow">Batches</span>
    <div id="batchWrap"></div>

    <span class="eyebrow">More</span>
    <div class="card"><h4>Prescriptions</h4>
      <button id="rxL">Lunch</button> <button id="rxD">Dinner</button>
      <div id="rxOut"></div></div>

    <div class="card"><h4>Food Log · photo</h4>
      <div class="small">One-off meal — not from a batch. Snap it, review, log it.</div>
      <input id="foodPhoto" type="file" accept="image/*" multiple>
      <label>Ingredients / notes (optional — helps when the photo alone is ambiguous)</label>
      <textarea id="foodNotes" rows="2" placeholder="e.g. grilled chicken thigh, jasmine rice, olive oil, no visible scale"></textarea>
      <button id="foodAnalyze" disabled>Analyze</button>
      <div class="small" id="foodMsg"></div>
      <div class="small" id="foodMicros"></div></div>

    <div class="card"><h4>Today</h4><ul class="plain" id="meals"></ul></div>`;

  const refresh = async ()=>{
    try{
      const st = await bridge("/fuel-state");
      const b = st.balance_kcal;
      const x = bandX(b);
      const zone = bandZone(b);
      document.getElementById("band").innerHTML = `<h4>Balance
        <span class="bandpill" style="background:${zone.color}">${zone.name} · ${b}</span></h4>
        <div class="gauge" style="background:${gaugeBackground()}"><div class="needle" style="left:${x}%"></div></div>
        <div class="small">on board ${st.carbs_g}g carbs · ${st.fasted?"fasted":"fed"} · meals today ${st.meals_today}${st.workout_kcal ? " · workout burn " + st.workout_kcal + " kcal" : ""}</div>`;
      const m = await bridge("/meals/today");
      document.getElementById("meals").innerHTML = m.meals.length
        ? m.meals.map(x=>`<li><span>${esc(x.meal)} · ${esc(x.name)}</span><b>${x.kcal}</b></li>`).join("")
        : "<li><span>Nothing yet</span></li>";
    }catch(e){
      document.getElementById("band").innerHTML = `<h4>Balance</h4><div class="small">bridge unreachable — logging queues locally</div>`;
    }
  };
  refresh();

  const refreshWorkoutDebt = async ()=>{
    try{
      const w = await bridge("/workout-debt");
      const el = document.getElementById("workoutDebt");
      const rows = w.count ? w.rides.map(r=>`<li><span>${esc(r.name)}</span><b>${r.kcal} kcal</b></li>`).join("")
        : "<li><span>No workouts synced today yet</span></li>";
      el.innerHTML = `<h4>Workout Debt${w.count ? ` · <b>${w.kcal} kcal</b>` : ""}</h4>
        <ul class="plain">${rows}</ul>
        <div class="small">Estimated from Strava (kJ ≈ kcal) · already netted into the Balance above, not added again</div>
        <button id="wdSync">Sync now</button>
        <div class="small" id="wdSyncMsg"></div>`;
      document.getElementById("wdSync").onclick = async ()=>{
        const btn = document.getElementById("wdSync");
        btn.disabled = true; btn.textContent = "Syncing…";
        try{ await bridge("/strava/sync"); document.getElementById("wdSyncMsg").textContent = "Synced."; refreshWorkoutDebt(); }
        catch(e){ document.getElementById("wdSyncMsg").textContent = "Sync failed: " + e.message; btn.disabled = false; btn.textContent = "Sync now"; }
      };
    }catch(e){
      document.getElementById("workoutDebt").innerHTML = `<h4>Workout Debt</h4><div class="small">bridge unreachable</div>`;
    }
  };
  refreshWorkoutDebt();

  const logMeal = async (m, msgEl)=>{
    msgEl = msgEl || "mMsg";
    try{ await bridge("/meals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(m)});
      document.getElementById(msgEl).textContent = "Logged.";
      refresh();
    }catch(e){
      const q = JSON.parse(localStorage.getItem("way-queue")||"[]"); q.push(m);
      localStorage.setItem("way-queue", JSON.stringify(q));
      document.getElementById(msgEl).textContent = "Bridge offline — queued locally (" + q.length + ").";
    }
  };
  document.getElementById("mLog").onclick = ()=> logMeal({
    name: document.getElementById("mName").value || "meal",
    meal: document.getElementById("mMeal").value,
    kcal: +document.getElementById("mK").value || 0,
    protein_g: +document.getElementById("mP").value || 0,
    carbs_g: +document.getElementById("mC").value || 0,
    fat_g: +document.getElementById("mF").value || 0 });
  document.getElementById("favSmoothie").onclick = ()=> logMeal({name:"Blueberry oatmeal smoothie",meal:"breakfast",kcal:520,protein_g:40,carbs_g:85,fat_g:8}, "smoothieMsg");
  document.getElementById("favBowl").onclick = ()=> logMeal({name:"Post-ride bowl",meal:"lunch",kcal:750,protein_g:52,carbs_g:98,fat_g:16});

  const rx = async (meal)=>{
    try{
      const p = await bridge("/prescription/"+meal);
      document.getElementById("rxOut").innerHTML = `<div class="small" style="margin-top:8px">${p.kcal} kcal · ${esc(p.note)}</div>
        <div class="unitrow"><span class="unit p">${p.units.protein} Protein</span><span class="unit c">${p.units.carb} Carb</span><span class="unit f">${p.units.fat} Fat</span><span class="unit g">${p.units.greens} Greens</span></div>`;
    }catch(e){ document.getElementById("rxOut").innerHTML = `<div class="small">bridge unreachable</div>`; }
  };
  document.getElementById("rxL").onclick = ()=>rx("lunch");
  document.getElementById("rxD").onclick = ()=>rx("dinner");

  /* ---- Food Log: single ad-hoc photo -> proposal -> pre-fills the meal form ---- */
  const foodInput = document.getElementById("foodPhoto");
  const foodBtn = document.getElementById("foodAnalyze");
  foodInput.onchange = ()=>{ foodBtn.disabled = !foodInput.files.length; };
  foodBtn.onclick = async ()=>{
    const files = foodInput.files;
    if (!files.length) return;
    foodBtn.disabled = true; foodBtn.textContent = "Analyzing…";
    document.getElementById("foodMsg").textContent = "";
    document.getElementById("foodMicros").innerHTML = "";
    try{
      const r = await multiPhotoBridge("/kitchen/log", files, { user_notes: document.getElementById("foodNotes").value || undefined });
      const p = r.proposal;
      document.getElementById("mName").value = p.food_name || "meal";
      if (p.meal_guess) document.getElementById("mMeal").value = p.meal_guess;
      document.getElementById("mK").value = p.kcal ?? "";
      document.getElementById("mP").value = p.protein_g ?? "";
      document.getElementById("mC").value = p.carbs_g ?? "";
      document.getElementById("mF").value = p.fat_g ?? "";
      document.getElementById("foodMsg").textContent =
        `Filled in below — check it, then hit Log. (confidence: ${p.confidence}${p.weight_g ? ", " + p.weight_g + "g" : ""})`;
      if (p.micronutrients){
        const mn = p.micronutrients;
        document.getElementById("foodMicros").textContent =
          `fiber ${mn.fiber_g ?? "—"}g · sodium ${mn.sodium_mg ?? "—"}mg · iron ${mn.iron_mg ?? "—"}mg · vit C ${mn.vitamin_c_mg ?? "—"}mg`;
      }
      if (p.notes) document.getElementById("foodMsg").textContent += " — " + p.notes;
    }catch(e){
      document.getElementById("foodMsg").textContent = "Vision call failed: " + e.message;
    }
    foodBtn.disabled = false; foodBtn.textContent = "Analyze";
  };



  /* ---- Batches: 3 fixed slots, cumulative ingredient photos + scoop calibration ---- */
  const batchCard = (b)=>{
    const ingredRows = b.ingredients.length
      ? b.ingredients.map(i=>`<li><span>${esc(i.name)} · ${i.added_g}g</span><b>${i.kcal} kcal</b></li>`).join("")
      : "<li><span>No ingredients yet</span></li>";
    const scoopLine = b.scoop_g
      ? `<div class="small"><b>Scoop ${b.scoop_g}g</b> · ${b.remaining_g}g left · ~${b.scoops_remaining ?? "—"} scoops remaining</div>`
      : `<div class="small">Not calibrated yet — weigh one scoop once ingredients are in</div>`;
    return `<div class="card" data-slot="${b.slot}">
      <h4>Batch ${b.slot} · ${esc(b.status)} · ${b.total_g}g total</h4>
      <ul class="plain">${ingredRows}</ul>
      ${scoopLine}
      <div class="small" style="margin-top:8px">Add ingredient — take 2 photos: one clear shot of the scale display, one of the food (cumulative weight after adding it)</div>
      <input class="ingredPhoto" type="file" accept="image/*" multiple>
      <label>Ingredient notes (optional)</label>
      <textarea class="ingredNotes" rows="1" placeholder="e.g. 90/10 ground beef, raw"></textarea>
      <button class="ingredBtn" disabled>Add to Batch ${b.slot}</button>
      ${!b.scoop_g ? `
      <div class="small" style="margin-top:8px">Calibrate scoop — take 2 photos: scale display + the scoop itself</div>
      <input class="scoopPhoto" type="file" accept="image/*" multiple>
      <label>Scoop notes (optional)</label>
      <textarea class="scoopNotes" rows="1" placeholder="e.g. level scoop, packed"></textarea>
      <button class="scoopCalBtn" disabled>Calibrate + log first scoop</button>` : `
      <button class="scoopBtn" style="margin-top:8px">Log one scoop</button>`}
      <button class="resetBtn" style="margin-top:8px">Reset batch</button>
      <div class="small batchMsg"></div>
    </div>`;
  };

  const refreshBatches = async ()=>{
    try{
      const r = await bridge("/batches");
      document.getElementById("batchWrap").innerHTML = r.batches.map(batchCard).join("");
      wireBatchCards();
    }catch(e){
      document.getElementById("batchWrap").innerHTML = `<div class="card"><div class="small">bridge unreachable</div></div>`;
    }
  };

  const wireBatchCards = ()=>{
    document.querySelectorAll("#batchWrap [data-slot]").forEach(card=>{
      const slot = card.dataset.slot;
      const msg = card.querySelector(".batchMsg");

      const ingredInput = card.querySelector(".ingredPhoto");
      const ingredBtn = card.querySelector(".ingredBtn");
      const ingredNotes = card.querySelector(".ingredNotes");
      ingredInput.onchange = ()=>{ ingredBtn.disabled = !ingredInput.files.length; };
      ingredBtn.onclick = async ()=>{
        const files = ingredInput.files; if (!files.length) return;
        ingredBtn.disabled = true; ingredBtn.textContent = "Reading scale…";
        try{
          const r = await multiPhotoBridge(`/batch/${slot}/ingredient`, files, { user_notes: ingredNotes.value || undefined });
          msg.textContent = `Added ${r.added.name} · ${r.added.added_g}g (confidence: ${r.added.confidence})`;
          refreshBatches();
        }catch(e){ msg.textContent = "Failed: " + e.message; ingredBtn.disabled = false; ingredBtn.textContent = `Add to Batch ${slot}`; }
      };

      const scoopCalInput = card.querySelector(".scoopPhoto");
      const scoopCalBtn = card.querySelector(".scoopCalBtn");
      const scoopNotes = card.querySelector(".scoopNotes");
      if (scoopCalInput && scoopCalBtn){
        scoopCalInput.onchange = ()=>{ scoopCalBtn.disabled = !scoopCalInput.files.length; };
        scoopCalBtn.onclick = async ()=>{
          const files = scoopCalInput.files; if (!files.length) return;
          scoopCalBtn.disabled = true; scoopCalBtn.textContent = "Reading scale…";
          try{
            const r = await multiPhotoBridge(`/batch/${slot}/scoop-calibrate`, files, { meal: "lunch", user_notes: scoopNotes.value || undefined });
            msg.textContent = `Scoop calibrated at ${r.batch.scoop_g}g — first scoop logged.`;
            refreshBatches(); refresh();
          }catch(e){ msg.textContent = "Failed: " + e.message; scoopCalBtn.disabled = false; scoopCalBtn.textContent = "Calibrate + log first scoop"; }
        };
      }

      const scoopBtn = card.querySelector(".scoopBtn");
      if (scoopBtn){
        scoopBtn.onclick = async ()=>{
          scoopBtn.disabled = true; scoopBtn.textContent = "Logging…";
          try{
            const r = await bridge(`/batch/${slot}/scoop`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({meal:"lunch"})});
            msg.textContent = `Logged one scoop · ${r.batch.remaining_g}g left.`;
            refreshBatches(); refresh();
          }catch(e){ msg.textContent = "Failed: " + e.message; scoopBtn.disabled = false; scoopBtn.textContent = "Log one scoop"; }
        };
      }

      card.querySelector(".resetBtn").onclick = async ()=>{
        if (!confirm(`Reset Batch ${slot}? This clears all ingredients and scoop calibration.`)) return;
        try{ await bridge(`/batch/${slot}/reset`, {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}); refreshBatches(); }
        catch(e){ msg.textContent = "Failed: " + e.message; }
      };
    });
  };
  refreshBatches();

  const coachWrap = document.createElement("div");
  coachWrap.innerHTML = coachCard("fuel");
  view.appendChild(coachWrap);
  wireCoach("fuel");
};

/* ---------------- RECOVER (wind-down, settle) ---------------- */
V.recover = async function(){
  view.innerHTML = `<span class="eyebrow">Recover</span>
    <div class="card"><h4>Podcast</h4><div id="pods" class="small">reaching the bridge…</div>
      <audio id="player" controls style="width:100%;margin-top:8px" hidden></audio></div>
    <div class="card"><h4>Shower</h4><div class="small">~90 min before bed helps sleep onset</div></div>
    <div class="card"><h4>Close out</h4><div id="settle" class="small">computing…</div>
      <button class="primary" id="close">Settle the day</button></div>
    ${coachCard("recover")}`;

  bridge("/podcasts/list").then(p=>{
    const el = document.getElementById("pods");
    if (!p.episodes.length){ el.textContent = "No cached episodes — add feeds to bridge/podcast-feeds.json"; return; }
    el.innerHTML = p.episodes.map(e=>`<button data-e="${esc(e)}">${esc(e.replace(/-/g," ").replace(".mp3",""))}</button>`).join(" ");
    el.querySelectorAll("button").forEach(b=>b.onclick=()=>{
      const a = document.getElementById("player"); a.hidden=false;
      a.src = S.bridgeUrl + "/podcasts/file/" + b.dataset.e; a.play();
    });
  }).catch(()=>{ document.getElementById("pods").textContent = "bridge unreachable"; });

  bridge("/fuel-state").then(st=>{
    const b = st.balance_kcal;
    document.getElementById("settle").innerHTML =
      `Day at <span class="bandpill" style="background:${bandZone(b).color}">${bandZone(b).name} · ${b}</span> · meals ${st.meals_today} · mobility ${localStorage.getItem("mob-am-"+new Date().toDateString())?"✓":"—"}`;
  }).catch(()=>{ document.getElementById("settle").textContent = "bridge unreachable"; });

  document.getElementById("close").onclick = async ()=>{
    try{
      const st = await bridge("/fuel-state");
      await bridge("/agent/closeout",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({summary:`Settled ${st.balance_kcal} kcal, ${st.meals_today} meals. Tomorrow: ${S.tomorrow||DAY_TYPES[0]}.`})});
      document.getElementById("settle").innerHTML += " · <b>settled ✓</b>";
    }catch(e){}
  };
  wireCoach("recover");
};

/* ---------------- SLEEP (WHOOP, alarm, bedside) ---------------- */
V.sleep = async function(){
  view.innerHTML = `<span class="eyebrow">Sleep</span>
    <div class="card" id="sleepCard"><h4>Sleep</h4><div class="small">waiting for WHOOP…</div></div>
    <div class="card"><h4>Alarm</h4>
      <input id="alarmT" type="time" value="${S.alarm||"05:30"}">
      <button id="alarmSet">Set</button>
      <div class="small" id="alarmMsg">${S.alarm?("Armed for "+S.alarm+" (keep this tablet open — kiosk mode)"):""}</div></div>
    <div class="card"><h4>Bedside clock</h4>
      <div class="small">Full-screen clock that watches for the morning WHOOP sync, then rolls into the Morning Routine.</div>
      <button id="toBedroom">Open bedside clock</button></div>
    ${coachCard("sleep")}`;
  bridge("/sleep/latest").then(s=>{
    const el = document.getElementById("sleepCard");
    if (s.sleep) el.innerHTML = `<h4>Slept ${s.sleep.performance ?? "—"} · ${s.sleep.hours ?? "—"} h</h4>
      <div class="small">recovery ${s.recovery?.score ?? "—"} · HRV ${s.recovery?.hrv ?? "—"} · RHR ${s.recovery?.rhr ?? "—"}</div>`;
    else el.innerHTML = `<h4>Sleep</h4><div class="small">no WHOOP data yet — connect at /whoop/auth on the bridge</div>`;
  }).catch(()=>{});
  document.getElementById("alarmSet").onclick = ()=>{
    S.alarm = document.getElementById("alarmT").value; saveS();
    document.getElementById("alarmMsg").textContent = "Armed for " + S.alarm + " (keep this tablet open — kiosk mode)";
  };
  document.getElementById("toBedroom").onclick = ()=>{ location.hash = "#bedroom"; };
  wireCoach("sleep");
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
        if (t.latest.logged_today && !announced && S.role==="cockpit"){
          speak(`${wkg} watts per kilo. FTP ${__ftp}.` + (t.week_change_lb<0 ? " The weight is doing the work this week." : ""));
          sessionStorage.setItem("wkg-announced","1"); announced="1";
        }
      }
    }catch(e){ document.getElementById("weigh").innerHTML =
      `<h4>Weigh-in</h4><div class="small">bridge unreachable — <a href="#fuel">log manually</a></div>`; }
  };
  pollWeight(); const wp = setInterval(()=>{ if(location.hash!=="#analyze") clearInterval(wp); else pollWeight(); }, 10000);
  wireCoach("analyze");
};

/* ---------------- ROUTINES (guided sequences across the groups) ----------------
   Groups are the library; routines are the playlists. Progress is per-day.
   Steps auto-check where a real signal exists (weigh-in, mobility);
   the rest are tap-to-check. */
function routineState(key){
  return JSON.parse(localStorage.getItem(key+"-"+new Date().toDateString())||"{}");
}
function saveRoutine(key, st){
  localStorage.setItem(key+"-"+new Date().toDateString(), JSON.stringify(st));
}
function drawRoutine(listEl, steps, st, onTap){
  listEl.innerHTML = steps.map((s,i)=>{
    const done = s.auto ? s.done : !!st[i];
    const lock = s.locked ? ` <span class="lock">🔒 ${s.lockNote}</span>` : "";
    const right = done ? "✓" : (s.auto ? "auto" : "tap");
    return `<li class="${done?"done":""}" data-i="${i}">
      <span>${s.label}${s.link?` — <a href="${s.link}">open</a>`:""}${lock}</span><span>${right}</span></li>`;
  }).join("");
  listEl.querySelectorAll("li").forEach(li=>li.onclick=(e)=>{
    if (e.target.tagName === "A") return; // let links navigate
    const i=+li.dataset.i;
    if (steps[i].auto || steps[i].locked) return;
    onTap(i);
  });
}

V["routine-am"] = async function(){
  view.innerHTML = `<span class="eyebrow">☀ Morning Routine</span>
    <div class="greet">Good morning, Harry</div>
    <div class="card"><h4>The sequence</h4><ul class="plain steps" id="amSteps"></ul></div>
    <div class="card"><h4>Wake report</h4>
      <div class="small">The all-agent daily briefing: sleep, the day's plan, what the week owes.</div>
      <button class="primary" id="wakeBtn">Play wake report</button>
      <div class="small" id="wakeOut"></div></div>`;

  let weighDone = false;
  const steps = [
    { label:"Wake report", auto:false },
    { label:"Weigh-in", auto:true, done:false, link:"#analyze" },
    { label:"Mobility", auto:true, done: !!localStorage.getItem("mob-am-"+new Date().toDateString()), link:"#activate" },
    { label:"30-min warm-up spin", auto:false, link:"#train" },
    { label:"Breakfast", auto:false, link:"#fuel", locked:true, lockNote:"unlocks after weigh-in" }
  ];
  const st = routineState("routine-am");
  const listEl = document.getElementById("amSteps");
  const redraw = ()=>{
    steps[4].locked = !weighDone;
    drawRoutine(listEl, steps, st, (i)=>{ st[i] = !st[i]; saveRoutine("routine-am", st); redraw(); });
  };
  redraw();
  bridge("/weight/latest").then(t=>{
    weighDone = !!(t.latest && t.latest.logged_today);
    steps[1].done = weighDone; redraw();
  }).catch(()=>{});

  document.getElementById("wakeBtn").onclick = async ()=>{
    const btn = document.getElementById("wakeBtn");
    btn.disabled = true; btn.textContent = "Thinking…";
    try{
      const r = await bridge("/agent",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text:"Give me the morning wake report: sleep and recovery, today's plan and weather, what the week still owes, and the one thing to focus on. Keep it tight.", persona:"plan"})});
      document.getElementById("wakeOut").textContent = r.reply; speak(r.reply);
      st[0] = true; saveRoutine("routine-am", st); redraw();
    }catch(e){ document.getElementById("wakeOut").textContent = "bridge unreachable — " + e.message; }
    btn.disabled = false; btn.textContent = "Play wake report";
  };
};

V["routine-pm"] = async function(){
  view.innerHTML = `<span class="eyebrow">☾ Nighttime Routine</span>
    <div class="card"><h4>The sequence</h4><ul class="plain steps" id="pmSteps"></ul></div>
    <div class="card"><h4>Tonight's settle</h4><div id="pmSettle" class="small">computing…</div></div>`;
  const steps = [
    { label:"Evening mobility — easy pace", auto:true, done: !!localStorage.getItem("mob-pm-"+new Date().toDateString()), link:"#activate" },
    { label:"Podcast + shower wind-down", auto:false, link:"#recover" },
    { label:"Settle the day", auto:false, link:"#recover" },
    { label:"Tomorrow's ride + gear check", auto:false, link:"#plan" },
    { label:"Set the alarm", auto:false, link:"#sleep" },
    { label:"Bedside clock on", auto:false, link:"#bedroom" }
  ];
  const st = routineState("routine-pm");
  const listEl = document.getElementById("pmSteps");
  const redraw = ()=> drawRoutine(listEl, steps, st, (i)=>{ st[i] = !st[i]; saveRoutine("routine-pm", st); redraw(); });
  redraw();
  bridge("/fuel-state").then(s=>{
    const b = s.balance_kcal;
    document.getElementById("pmSettle").innerHTML =
      `Day at <span class="bandpill" style="background:${bandZone(b).color}">${bandZone(b).name} · ${b}</span> · meals ${s.meals_today}`;
  }).catch(()=>{ document.getElementById("pmSettle").textContent = "bridge unreachable"; });
};

/* ---------------- BEDSIDE CLOCK ---------------- */
V.bedroom = function(){

  // Phase 1: full-screen clock, polling WHOOP every 60s.
  // When recovery arrives (logged_today or fresh sync), transition to morning.
  let __bedPoll = null;
  let __transitioned = false;

  view.innerHTML = `
    <div id="bedClock" style="
      position:fixed;inset:0;background:var(--ink);color:var(--paper);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      gap:16px;font-family:var(--mono);">
      <div id="bedTime" style="font-size:96px;font-weight:700;letter-spacing:-2px;line-height:1"></div>
      <div id="bedDate" style="font-size:18px;letter-spacing:3px;text-transform:uppercase;color:#888"></div>
      <div id="bedStatus" style="font-size:13px;color:#666;letter-spacing:1px;margin-top:8px">waiting for whoop recovery...</div>
    </div>`;

  // tick the clock every second
  const tick = ()=>{
    const n = new Date();
    let h = n.getHours(), mm = String(n.getMinutes()).padStart(2,'0');
    const ap = h<12?'a':'p'; h=h%12; if(h===0)h=12;
    const el = document.getElementById("bedTime");
    if(el) el.textContent = h+':'+mm+ap;
    const de = document.getElementById("bedDate");
    if(de) de.textContent = n.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
  };
  tick(); const clockInt = setInterval(tick, 1000);

  const transition = (rec)=>{
    if(__transitioned) return;
    // only transition to morning during morning hours (5am-10am)
    const h = new Date().getHours();
    if(h < 5 || h >= 10) return;
    __transitioned = true;
    clearInterval(clockInt);
    clearInterval(__bedPoll);
    // fade clock out
    const c = document.getElementById("bedClock");
    if(c){ c.style.transition='opacity 1.5s'; c.style.opacity='0';
      setTimeout(()=>{ location.hash="#routine-am"; nav(); }, 1600); }
    // speak the greeting
    const score = rec && rec.score;
    const color = score>=67?'green':score>=34?'yellow':'red';
    if(score) speak(`Good morning. Recovery is ${color} — ${score}.`);
    else speak('Good morning.');
  };

  const checkWhoop = async ()=>{
    try{
      const s = await bridge("/sleep/latest");
      const status = document.getElementById("bedStatus");
      if(s && s.recovery && s.recovery.score){
        if(status) status.textContent = `recovery ${s.recovery.score} · transitioning...`;
        setTimeout(()=>transition(s.recovery), 800);
      } else {
        if(status) status.textContent = 'waiting for whoop recovery...';
      }
    }catch(e){}
  };

  checkWhoop();
  __bedPoll = setInterval(checkWhoop, 60000);
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
  calendar:  { tag:"cal",     cls:"lane-cal"   },
  ride:      { tag:"ride",    cls:"lane-icu"   },
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

function dayRows(d, plan, isToday){
  const rows = (d.events||[]).map(e=>({
    start: e.start_min, end: e.end_min, from: e.from, to: e.to,
    title: e.summary, detail: e.detail || e.location || "",
    lane: LANE[e.source] || LANE.calendar
  }));
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

function dayCard(d, plan, nowMin, rec, solo){
  const isToday = !!d.today;
  const rows = dayRows(d, plan, isToday);
  const chips = (d.all_day||[]).map(e=>
    `<span class="chip ${(LANE[e.source]||LANE.calendar).cls}">${esc(e.summary)}${e.detail?" · "+esc(e.detail):""}</span>`).join("");
  let markedNext = false;
  const items = rows.map(r=>{
    let state = "";
    if (isToday){
      if (r.end <= nowMin) state = "past";
      else if (r.start <= nowMin && nowMin < r.end) state = "now";
      else if (!markedNext && !r.open){ state = "next"; markedNext = true; }
    }
    return `<li class="${r.lane.cls} ${state}">
      <span class="t">${esc(r.from)}<br>${esc(r.to)}</span>
      <span class="n">${esc(r.title)}${r.detail?`<span class="small"> ${esc(r.detail)}</span>`:""}</span>
      <span class="tag">${state==="now"?"now":state==="next"?"next":r.lane.tag}</span></li>`;
  }).join("");
  const open = d.available_min ? durLabel(d.available_min)+" open" : "no window";
  const foot = isToday && rec ? `${open} · <b>${esc(rec)}</b>` : open;
  const m = d.macros;
  const macroRow = m
    ? `<div class="macros">${m.fuel_day?`<span class="mfuel">${esc(m.fuel_day)}</span>`:""}
        <span class="unit">${m.kcal ?? "—"} kcal</span><span class="unit c">${m.carbs_g ?? "—"}C</span>
        <span class="unit p">${m.protein_g ?? "—"}P</span><span class="unit f">${m.fat_g ?? "—"}F</span>
        <span class="small">Hexis</span></div>`
    : (isToday ? `<div class="macros"><span class="small">No Hexis macros yet — run the morning fetch</span></div>` : "");
  return `<div class="card day${isToday?" is-today":""}${solo?" day-solo":""}">
    <h4>${isToday?"Today · ":""}${esc(d.label)}</h4>
    ${macroRow}
    ${chips?`<div class="chips">${chips}</div>`:""}
    <ul class="agenda${solo?" agenda-big":""}">${items || `<li class="lane-open"><span class="t"></span><span class="n">Nothing scheduled</span><span class="tag">clear</span></li>`}</ul>
    <div class="small">${foot}</div></div>`;
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
    <div class="nowbar">
      <div class="nowtime" id="nowTime">--:--</div>
      <div class="nowmeta">
        <div class="nowdate" id="nowDate"></div>
        <div class="small" id="nowNext">reaching the bridge…</div>
        <div class="small" id="nowFresh"></div></div>
    </div>
    <div class="daystep">
      <button id="dayPrev" aria-label="Previous day">‹</button>
      <div class="daystep-label" id="dayLabel"></div>
      <button id="dayNext" aria-label="Next day">›</button>
    </div>
    <div class="card" id="readiness"><h4>Last night · this morning</h4>
      <div class="small">reaching the bridge…</div></div>
    <div id="dayList"><div class="card"><div class="small">building the day…</div></div></div>
    <div class="card" id="foodLog"><h4>Food log · today</h4><div class="small">reaching the bridge…</div></div>
    <div class="small" id="daySources" style="margin-top:12px"></div>
    <button id="toClock">Bedside clock</button>
    <button id="toSettings">Settings</button>`;

  const tick = ()=>{
    const n = new Date();
    let h = n.getHours(); const mm = String(n.getMinutes()).padStart(2,"0");
    const ap = h<12?"AM":"PM"; h = h%12; if(h===0) h=12;
    const el = document.getElementById("nowTime");
    if (el) el.textContent = h+":"+mm+" "+ap;
    const de = document.getElementById("nowDate");
    if (de) de.textContent = n.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  };
  tick();
  __dayTimers.push(setInterval(()=>{ if(location.hash!=="#today") clearDayTimers(); else tick(); }, 1000));
  document.getElementById("toClock").onclick = ()=>{ location.hash = "#bedroom"; };
  // The day is the whole app now, but a device still has to be told its bridge
  // URL and token once — without a way back to Settings a fresh tablet is
  // stranded on demo data with no way to fix it.
  document.getElementById("toSettings").onclick = ()=>{ location.hash = "#settings"; };

  const nowMin = ()=>{ const n=new Date(); return n.getHours()*60+n.getMinutes(); };

  /* ---- the top strip: how the night went, what the scale said ----
     WHOOP is connected and pushes on its own. Withings is not wired up yet,
     so the weigh-in is entered here by hand and says so. */
  const recBand = s=> s>=67 ? {name:"green",c:"var(--green)"} : s>=34 ? {name:"yellow",c:"var(--amber)"} : {name:"red",c:"var(--red)"};
  const refreshReadiness = async ()=>{
    const el = document.getElementById("readiness");
    if (!el) return;
    const [s, w] = await Promise.all([
      bridge("/sleep/latest").catch(()=>null),
      bridge("/weigh-in").catch(()=>null)
    ]);
    let sleepHTML;
    if (s && s.recovery && s.recovery.score != null){
      const b = recBand(s.recovery.score);
      // Say when it last synced. A stale reading looks identical to a fresh
      // one otherwise, and this is the number the day gets planned around.
      const age = s.synced_at ? (Date.now() - new Date(s.synced_at).getTime())/3.6e6 : null;
      const when = age == null ? "" : age < 1 ? " · just synced"
        : age < 24 ? ` · synced ${Math.round(age)}h ago` : ` · synced ${Math.round(age/24)}d ago`;
      sleepHTML = `<div class="rblock">
        <span class="bandpill" style="background:${b.c}">Recovery ${s.recovery.score} · ${b.name}</span>
        <div class="small">slept ${s.sleep?.hours ?? "—"} h · performance ${s.sleep?.performance ?? "—"}
          · HRV ${s.recovery.hrv ?? "—"} · RHR ${s.recovery.rhr ?? "—"}${when}</div>
        ${s.auth_error?`<div class="small"><b>WHOOP needs reconnecting</b> — visit /whoop/auth on the bridge (${esc(s.auth_error.detail||"")})</div>`:""}</div>`;
    } else {
      const why = !s ? "bridge unreachable" : s.auth_error ? "WHOOP needs reconnecting — visit /whoop/auth on the bridge"
        : s.connected ? "connected, but no sleep record yet" : "WHOOP not connected — visit /whoop/auth on the bridge";
      sleepHTML = `<div class="rblock"><span class="bandpill" style="background:var(--muted)">Recovery —</span>
        <div class="small">${esc(why)}</div></div>`;
    }
    const t = w && w.latest;
    const startLine = w && w.start_lb
      ? `start ${w.start_lb} lb${w.change_since_start_lb!=null?` · <b>${w.change_since_start_lb>0?"+":""}${w.change_since_start_lb} lb</b> since`:""}`
      : "";
    const weighHTML = !w
      ? `<div class="rblock"><div class="small">Weigh-in unavailable — bridge unreachable</div></div>`
      : (t && t.logged_today)
      ? `<div class="rblock"><div class="bignum" style="font-size:30px">${t.lb} lb</div>
          <div class="small">${startLine}</div>
          <div class="small">7-day ${w.ma7_lb ?? "—"}${w.week_change_lb!=null?` · ${w.week_change_lb>0?"+":""}${w.week_change_lb} this week`:""} · ${esc(t.source)}</div></div>`
      : `<div class="rblock"><div class="small">${t?`Last: ${t.lb} lb (${new Date(t.at).toLocaleDateString("en-US",{month:"short",day:"numeric"})})`:"No weigh-in yet"}${startLine?" · "+startLine:""}</div>
          <div class="small">${w.withings_connected?"Withings is connected — this fills in when you step on the scale. Or enter it:":"Withings isn't connected yet — enter this morning's number:"}</div>
          <div class="row2"><span><input id="wiLb" type="number" step="0.1" placeholder="${w.start_lb||210}"></span>
            <span><button class="primary" id="wiSave">Log weigh-in</button></span></div>
          <div class="small" id="wiMsg"></div></div>`;
    el.innerHTML = `<h4>Last night · this morning</h4>
      <div class="readyrow">${sleepHTML}${weighHTML}</div>`;
    const btn = document.getElementById("wiSave");
    if (btn) btn.onclick = async ()=>{
      const lb = +document.getElementById("wiLb").value;
      if (!lb) return;
      try{
        await bridge("/weigh-in",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lb})});
        refreshReadiness();
      }catch(e){ document.getElementById("wiMsg").textContent = "Failed: " + e.message; }
    };
  };

  // Last payload, so the now/next markers can be repainted without refetching.
  let cached = { days: [], plan: null, recommendation: null, macros: null, dateKey: localDateKey() };

  // Redraw from cache: moves the "now" band and the next-up line as time
  // passes. Cheap, so it can run often; no network, no flicker of live data.
  // Which day is on screen, as an offset from today. 0 = today.
  let offset = 0;
  const dayAt = (off)=>{
    const i = (cached.todayIndex || 0) + off;
    return (i >= 0 && i < cached.days.length) ? cached.days[i] : null;
  };

  const repaint = ()=>{
    if (!cached.days.length) return;
    // Crossing midnight makes every card wrong. Reload rather than patch —
    // it rebuilds the week from today and picks up any deploy at the same time.
    if (localDateKey() !== cached.dateKey){ location.reload(); return; }
    const day = dayAt(offset);
    const list = document.getElementById("dayList");
    // Only today gets the live now-marker; on any other day a "now" band would
    // be pointing at a time that already passed or hasn't arrived.
    if (list) list.innerHTML = day
      ? dayCard(day, cached.plan, nowMin(), cached.recommendation, true)
      : `<div class="card"><div class="small">No data for that day — the schedule reaches
          ${cached.days.length} days from ${esc(cached.days[0].date)}.</div></div>`;

    const lab = document.getElementById("dayLabel");
    if (lab) lab.textContent = offset === 0 ? "Today"
      : offset === -1 ? "Yesterday" : offset === 1 ? "Tomorrow"
      : (day ? day.label : "—");
    const prev = document.getElementById("dayPrev"), next2 = document.getElementById("dayNext");
    if (prev) prev.disabled = !dayAt(offset-1);
    if (next2) next2.disabled = !dayAt(offset+1);

    // The strips below the schedule are about today: last night's recovery,
    // this morning's weight, today's eating. Hide them rather than show
    // today's numbers under yesterday's date.
    const isToday = offset === 0;
    const rd = document.getElementById("readiness"), fl = document.getElementById("foodLog");
    if (rd) rd.style.display = isToday ? "" : "none";
    if (fl) fl.style.display = isToday ? "" : "none";

    const today = dayAt(0), nm = nowMin();
    const nx = today ? dayRows(today, cached.plan, true).find(r=> r.start > nm && !r.open) : null;
    const el = document.getElementById("nowNext");
    if (el) el.textContent = nx
      ? "Next: " + nx.title + " at " + nx.from
      : (today && today.events && today.events.length ? "Nothing left on the calendar today" : "Day is clear");
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
  let touchX = null;
  view.addEventListener("touchstart", e=>{ touchX = e.changedTouches[0].clientX; }, {passive:true});
  view.addEventListener("touchend", e=>{
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
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
      const [s, plan] = await Promise.all([
        bridge("/schedule?days=15&back=7"),
        bridge("/plan").catch(()=>({for_today:false}))
      ]);
      const days = s.days || [];
      const ti = Number.isInteger(s.today_index) ? s.today_index
        : Math.max(0, days.findIndex(d=>d.today));
      cached = { days, plan, recommendation: s.recommendation, todayIndex: ti,
        macros: days[ti] ? days[ti].macros : null, dateKey: localDateKey() };
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
      document.getElementById("daySources").innerHTML = missing.length
        ? "Feeding this page: " + ((src.calendars||[]).join(" · ") || "nothing yet") + esc(accounts)
          + "<br>Missing — " + missing.map(esc).join("; ")
        : "Feeding this page: " + (src.calendars||[]).join(" · ") + esc(accounts) + " · classes · intervals.icu";
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
    const refreshFood = async ()=>{
      const el = document.getElementById("foodLog");
      if (!el) return;
      let meals = [];
      try{ meals = (await bridge("/meals/today")).meals || []; }
      catch(e){ el.innerHTML = `<h4>Food log · today</h4><div class="small">bridge unreachable — entries queue locally</div>`; return; }
      el.innerHTML = foodLogHTML(meals, cached.macros);
      // Compliance is its own call: it reconciles the Hexis target with Alma's
      // tracking, which may have landed after the day payload was built.
      bridge("/compliance").then(c=>{
        const box = document.getElementById("complianceBlock");
        if (!box) return;
        box.innerHTML = complianceHTML(c);
        const sb = document.getElementById("snackLog");
        if (sb) sb.onclick = ()=> add({ name: sb.dataset.name, meal:"snack",
          kcal:+sb.dataset.k, carbs_g:+sb.dataset.c, protein_g:+sb.dataset.p, fat_g:+sb.dataset.f });
      }).catch(()=>{});
      const add = async (m)=>{
        const r = await logMealQueued(m);
        const msg = document.getElementById("flMsg");
        if (r.ok){ refreshFood(); }
        else if (msg) msg.textContent = "Bridge offline — queued locally (" + r.queued + ").";
      };
      const addBtn = document.getElementById("flAdd");
      if (!addBtn) return;                    // view swapped mid-render
      addBtn.onclick = ()=> add({
        name: document.getElementById("flName").value || "meal",
        meal: document.getElementById("flMeal").value,
        kcal: +document.getElementById("flK").value || 0,
        carbs_g: +document.getElementById("flC").value || 0,
        protein_g: +document.getElementById("flP").value || 0,
        fat_g: +document.getElementById("flF").value || 0 });
      document.getElementById("flSmoothie").onclick = ()=> add(
        {name:"Blueberry oatmeal smoothie",meal:"breakfast",kcal:520,protein_g:40,carbs_g:85,fat_g:8});
      document.getElementById("flBowl").onclick = ()=> add(
        {name:"Post-ride bowl",meal:"lunch",kcal:750,protein_g:52,carbs_g:98,fat_g:16});
    };

    /* ---- keeping it current ---- */
    let syncing = false, lastSync = 0;
    const syncAll = async (why)=>{
      if (syncing) return;                       // never stack fetches
      syncing = true;
      try{
        await Promise.all([loadDay(), refreshReadiness(), refreshFood()]);
        lastSync = Date.now();
      } finally { syncing = false; }
    };

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

/* ---------------- FOOD LOG (front page) ----------------
   Additive: every entry adds to a running total that is carried down the
   list, so the day reads as an accumulation, not a pile of separate meals.
   When Hexis macros are in, the same totals are shown as what's left. */
async function logMealQueued(m){
  try{
    await bridge("/meals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(m)});
    return { ok:true };
  }catch(e){
    const q = JSON.parse(localStorage.getItem("way-queue")||"[]"); q.push(m);
    localStorage.setItem("way-queue", JSON.stringify(q));
    return { ok:false, queued:q.length };
  }
}
function mealTime(m){
  if (!m.logged_at) return "";
  const d = new Date(m.logged_at);
  if (isNaN(d)) return "";
  let h=d.getHours(); const mm=String(d.getMinutes()).padStart(2,"0"); const ap=h<12?"a":"p";
  h=h%12; if(h===0)h=12; return h+":"+mm+ap;
}
function foodLogHTML(meals, macros){
  const run = { kcal:0, carbs_g:0, protein_g:0, fat_g:0 };
  const rows = meals.map(m=>{
    run.kcal += m.kcal||0; run.carbs_g += m.carbs_g||0;
    run.protein_g += m.protein_g||0; run.fat_g += m.fat_g||0;
    return `<li><span class="t">${esc(mealTime(m))}</span>
      <span class="n">${esc(m.name)}<span class="small"> ${esc(m.meal||"")}${m.carbs_g?` · ${Math.round(m.carbs_g)}C`:""}${m.protein_g?` · ${Math.round(m.protein_g)}P`:""}${m.fat_g?` · ${Math.round(m.fat_g)}F`:""}</span></span>
      <span class="tag">+${m.kcal||0}<br><b>${Math.round(run.kcal)}</b></span></li>`;
  }).join("");
  const line = (label, got, target)=>{
    const left = target != null ? Math.round(target - got) : null;
    return `<li><span class="n">${label}</span><span class="tag">${Math.round(got)}${target!=null?` / ${target}`:""}${
      left!=null?` <b>${left>=0?left+" left":Math.abs(left)+" over"}</b>`:""}</span></li>`;
  };
  const totals = `<ul class="agenda totals">
    ${line("kcal", run.kcal, macros?macros.kcal:null)}
    ${line("carbs g", run.carbs_g, macros?macros.carbs_g:null)}
    ${line("protein g", run.protein_g, macros?macros.protein_g:null)}
    ${line("fat g", run.fat_g, macros?macros.fat_g:null)}</ul>`;
  return `<h4>Food log · today${meals.length?` · ${meals.length} entries`:""}</h4>
    <div id="complianceBlock"></div>
    <ul class="agenda foodlog">${rows || `<li><span class="t"></span><span class="n">Nothing logged yet</span><span class="tag">0</span></li>`}</ul>
    ${totals}
    ${macros ? "" : `<div class="small">No Hexis targets today — totals only.</div>`}
    <div class="row2"><span><label>What</label><input id="flName" placeholder="Rice balls"></span>
      <span><label>Meal</label><select id="flMeal"><option>breakfast</option><option>lunch</option><option>dinner</option><option>snack</option></select></span></div>
    <div class="row2"><span><label>kcal</label><input id="flK" type="number"></span>
      <span><label>carbs g</label><input id="flC" type="number"></span></div>
    <div class="row2"><span><label>protein g</label><input id="flP" type="number"></span>
      <span><label>fat g</label><input id="flF" type="number"></span></div>
    <button class="primary" id="flAdd">Add to the day</button>
    <button id="flSmoothie">Smoothie (520)</button>
    <button id="flBowl">Post-ride bowl (750)</button>
    <div class="small" id="flMsg"></div>`;
}

/* ---- compliance: Hexis asked, Alma tracked, how close ----
   Scored per macro so a good calorie total can't paper over a protein miss,
   with the snack that would move the number most. */
function complianceHTML(c){
  if (!c || !c.target) return `<div class="small">No Hexis target today — nothing to score against.</div>`;
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
    : s.none ? `<div class="small">No snack improves the score without going over on calories.</div>`
    : `<div class="snack"><b>Suggested snack</b> — ${esc(s.name)}${s.servings>1?` ×${s.servings}`:""}
        <div class="small">${s.kcal} kcal · ${s.carbs_g}C · ${s.protein_g}P · ${s.fat_g}F —
          ${esc(s.why)}, compliance ${s.score_before} → <b>${s.score_after}</b></div>
        <button id="snackLog" data-name="${esc(s.name)}" data-k="${s.kcal}" data-c="${s.carbs_g}" data-p="${s.protein_g}" data-f="${s.fat_g}">Log this snack</button></div>`;
  return `<div class="macros"><span class="mfuel">Compliance ${c.compliance.overall}</span>
      <span class="small">${esc(c.source||"")} vs Hexis${c.target.fuel_day?` · ${esc(c.target.fuel_day)}`:""}</span></div>
    <ul class="agenda totals">
      ${row("carbs","carbs_g")}${row("protein","protein_g")}${row("fat","fat_g")}${row("kcal","kcal")}
    </ul>
    <div class="small">${esc(c.basis)}.</div>
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

/* ---------------- SETTINGS ---------------- */
V.settings = function(){
  view.innerHTML = `<span class="eyebrow">Setup</span>
    <div class="card"><h4>This device</h4>
      <label>Role</label><select id="role">
        ${["cockpit","kitchen","bedroom","phone"].map(r=>`<option ${S.role===r?"selected":""}>${r}</option>`).join("")}</select>
      <label>Bridge URL (https tunnel or http://LAN-IP:8420)</label><input id="burl" value="${esc(S.bridgeUrl||"")}">
      <label>Token (FUEL_TOKEN)</label><input id="btok" value="${esc(S.token||"")}">
      <button class="primary" id="save">Save</button><div class="small" id="sMsg"></div></div>`;
  document.getElementById("save").onclick=()=>{
    S.role=document.getElementById("role").value;
    S.bridgeUrl=document.getElementById("burl").value.replace(/\/$/,"");
    S.token=document.getElementById("btok").value.trim(); saveS();
    document.getElementById("sMsg").textContent="Saved. Default view: "+defaultView();
  };
};

/* ---------------- alarm loop (kiosk) ---------------- */
setInterval(()=>{
  if(!S.alarm) return;
  const n=new Date(); const hm=String(n.getHours()).padStart(2,"0")+":"+String(n.getMinutes()).padStart(2,"0");
  if(hm===S.alarm && !sessionStorage.getItem("alarm-fired-"+n.toDateString())){
    sessionStorage.setItem("alarm-fired-"+n.toDateString(),"1");
    const o=document.getElementById("alarmOverlay"); o.hidden=false;
    document.getElementById("alarmClock").textContent=hm;
    speak("Good morning."); // gentle; browsers require a prior interaction for audio — kiosk session has one
  }
}, 5000);
document.getElementById("alarmStop").onclick=()=>{
  document.getElementById("alarmOverlay").hidden=true;
  location.hash="#routine-am"; nav();
};

/* ---------------- queue flush + boot ---------------- */
setInterval(async ()=>{
  const q=JSON.parse(localStorage.getItem("way-queue")||"[]");
  if(!q.length||!S.bridgeUrl) return;
  try{ for(const m of q){ await bridge("/meals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(m)}); }
    localStorage.setItem("way-queue","[]"); }catch(e){}
}, 30000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js");
window.addEventListener("hashchange", nav);
// Setting the hash fires hashchange, which calls nav() — calling it here too
// booted the view twice, racing two copies of the day against each other.
if (!location.hash) location.hash = "#" + defaultView();
else nav();
