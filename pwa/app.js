"use strict";
/* THE WAY — PWA. Local-first; bridge sync when reachable. */

const S = JSON.parse(localStorage.getItem("way-settings") || "{}");
function saveS(){ localStorage.setItem("way-settings", JSON.stringify(S)); }
const BAND = [-600,-300], TARGET = -450, BASE_BURN = 2050, PROTEIN_GOAL = 190;
const DAY_TYPES = ["Day 1 · fasted Z2","Day 2 · HIIT","Day 3 · grocery + batch","Day 4 · fasted Z2","Day 5 · strength (kettlebell)","Commute · 35 mi evening"];

async function bridge(pathname, opts){
  if (!S.bridgeUrl) throw new Error("no bridge configured");
  const sep = pathname.includes("?") ? "&" : "?";
  const r = await fetch(S.bridgeUrl + pathname + sep + "token=" + (S.token||""), opts);
  if (!r.ok) throw new Error("bridge " + r.status);
  return r.json();
}
function esc(t){ const d=document.createElement("div"); d.textContent=t==null?"":String(t); return d.innerHTML; }
function speak(t){ try{ const u=new SpeechSynthesisUtterance(t); u.rate=1.03; speechSynthesis.speak(u);}catch(e){} }
function bandColor(b){ if(b>=BAND[0]&&b<=BAND[1])return "var(--green)"; if(b>BAND[1])return "var(--amber)"; return "var(--red)"; }

/* ---------------- views ---------------- */
const V = {};
const view = document.getElementById("view");
function nav(){ 
  const h = location.hash.replace("#","") || defaultView();
  document.querySelectorAll("nav a").forEach(a=>a.classList.toggle("on", a.hash === "#"+h));
  (V[h] || V.settings)();
}
function defaultView(){
  return { bedroom:"night", kitchen:"day", cockpit:"morning", phone:"day" }[S.role] || "settings";
}

/* ---------------- MORNING ---------------- */
V.morning = async function(){
  const hr = new Date().getHours();
  const greet = hr<12 ? "Good morning, Harry" : hr<18 ? "Good afternoon, Harry" : "Good evening, Harry";
  view.innerHTML = `<span class="eyebrow">Morning Mode · ${esc(S.dayType||DAY_TYPES[0])}</span>
    <div class="greet">${greet}</div>
    <div class="card" id="wx"><h4>Weather</h4><div class="small">reaching the bridge…</div></div>
    <div class="card" id="weigh"><h4>Step on the scale</h4><div class="small">waiting for the weigh-in…</div></div>
    <div class="card" id="sleep"><h4>Sleep</h4><div class="small">waiting for WHOOP…</div></div>
    <div class="card"><h4>Mobility — 10 min</h4><ul class="plain" id="mob"></ul>
      <button id="mobNext">Next</button></div>
    <div class="card"><h4>Then</h4><div class="small">30-min warm-up spin — the Agent is on the <a href="#agent">Agent tab</a>. Breakfast unlocks after weigh-in.</div></div>`;

  bridge("/route-weather").then(w=>{
    document.getElementById("wx").innerHTML = `<h4>${w.now.t}° · wind ${Math.round(w.now.w)} mph</h4>
      <div class="small">${esc(w.now.ride)} now · evening: ${esc(w.evening.ride)}${w.stormAfterHour>0 ? " · storms possible after "+w.stormAfterHour+":00" : ""}</div>`;
  }).catch(()=>{ document.getElementById("wx").innerHTML = `<h4>Weather</h4><div class="small">bridge unreachable — check settings</div>`; });

  let announced = sessionStorage.getItem("wkg-announced");
  const pollWeight = async ()=>{
    try{
      const t = await bridge("/weight/latest");
      if (t.latest){
        const wkg = (265/(t.latest.lb/2.20462)).toFixed(2); // v1: set FTP; Signature eFTP replaces later
        document.getElementById("weigh").innerHTML =
          `<h4>${t.latest.lb} lb ${t.latest.logged_today?"· today ✓":"· yesterday"}</h4>
           <div class="small">7-day trend ${t.ma7_lb ?? "—"} · ${t.week_change_lb ?? "—"} this week · <b>${wkg} W/kg</b></div>`;
        if (t.latest.logged_today && !announced && S.role==="cockpit"){
          speak(`${wkg} watts per kilo.` + (t.week_change_lb<0 ? " The weight is doing the work this week." : ""));
          sessionStorage.setItem("wkg-announced","1"); announced="1";
        }
      }
    }catch(e){ document.getElementById("weigh").innerHTML =
      `<h4>Weigh-in</h4><div class="small">bridge unreachable — <a href="#day">log manually</a></div>`; }
  };
  pollWeight(); const wp = setInterval(()=>{ if(location.hash!=="#morning") clearInterval(wp); else pollWeight(); }, 10000);

  bridge("/sleep/latest").then(s=>{
    const el = document.getElementById("sleep");
    if (s.sleep) el.innerHTML = `<h4>Slept ${s.sleep.performance ?? "—"} · ${s.sleep.hours ?? "—"} h</h4>
      <div class="small">recovery ${s.recovery?.score ?? "—"} · HRV ${s.recovery?.hrv ?? "—"} · RHR ${s.recovery?.rhr ?? "—"}</div>`;
    else el.innerHTML = `<h4>Sleep</h4><div class="small">no WHOOP data yet — connect at /whoop/auth on the bridge</div>`;
  }).catch(()=>{});

  const moves = ["Cat / Cow — 15x","Cobra — 30s","Deep lunge — 30s/side","World's greatest — 15x","Open books — 10x/side","Quad stretch — 30s/side","Downward dog — 30s","Pigeon — 30s/side","90/90s — 15x/side","Deep squat hold — 30s"];
  let mi = 0;
  const drawMob = ()=>{ document.getElementById("mob").innerHTML =
    moves.map((m,i)=>`<li class="${i<mi?"done":""}"><span>${m}</span><span>${i<mi?"✓":""}</span></li>`).join(""); };
  drawMob();
  document.getElementById("mobNext").onclick = ()=>{ mi=Math.min(moves.length,mi+1); drawMob();
    if(mi===moves.length){ localStorage.setItem("mob-am-"+new Date().toDateString(),"1"); } };
};

/* ---------------- DAY (ledger + logging + Energy Bank) ---------------- */
V.day = async function(){
  view.innerHTML = `<span class="eyebrow">The Ledger</span>
    <div class="card" id="band"><h4>Balance</h4><div class="small">reaching the bridge…</div></div>
    <div class="card"><h4>Prescriptions</h4>
      <button id="rxL">Lunch</button> <button id="rxD">Dinner</button>
      <div id="rxOut"></div></div>
    <div class="card"><h4>Log a meal</h4>
      <div class="row2"><span><label>Name</label><input id="mName" placeholder="Post-ride bowl"></span>
      <span><label>Meal</label><select id="mMeal"><option>breakfast</option><option>lunch</option><option>dinner</option><option>snack</option></select></span></div>
      <div class="row2"><span><label>kcal</label><input id="mK" type="number"></span>
      <span><label>protein g</label><input id="mP" type="number"></span></div>
      <div class="row2"><span><label>carbs g</label><input id="mC" type="number"></span>
      <span><label>fat g</label><input id="mF" type="number"></span></div>
      <button class="primary" id="mLog">Log</button>
      <button id="favSmoothie">Smoothie (520)</button>
      <button id="favBowl">Post-ride bowl (750)</button>
      <div class="small" id="mMsg"></div></div>
    <div class="card"><h4>Today</h4><ul class="plain" id="meals"></ul></div>`;

  const refresh = async ()=>{
    try{
      const st = await bridge("/fuel-state");
      const b = st.balance_kcal;
      const x = Math.max(3, Math.min(97, 50 + b / -18));
      document.getElementById("band").innerHTML = `<h4>Balance
        <span class="bandpill" style="background:${bandColor(b)}">${b>=BAND[0]&&b<=BAND[1]?"green":"off band"} · ${b}</span></h4>
        <div class="gauge"><div class="needle" style="left:${x}%"></div></div>
        <div class="small">on board ${st.carbs_g}g carbs · ${st.fasted?"fasted":"fed"} · meals today ${st.meals_today}</div>`;
      const m = await bridge("/meals/today");
      document.getElementById("meals").innerHTML = m.meals.length
        ? m.meals.map(x=>`<li><span>${esc(x.meal)} · ${esc(x.name)}</span><b>${x.kcal}</b></li>`).join("")
        : "<li><span>Nothing yet</span></li>";
    }catch(e){
      document.getElementById("band").innerHTML = `<h4>Balance</h4><div class="small">bridge unreachable — logging queues locally</div>`;
    }
  };
  refresh();

  const logMeal = async (m)=>{
    try{ await bridge("/meals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(m)});
      document.getElementById("mMsg").textContent = "Logged.";
      refresh();
    }catch(e){
      const q = JSON.parse(localStorage.getItem("way-queue")||"[]"); q.push(m);
      localStorage.setItem("way-queue", JSON.stringify(q));
      document.getElementById("mMsg").textContent = "Bridge offline — queued locally (" + q.length + ").";
    }
  };
  document.getElementById("mLog").onclick = ()=> logMeal({
    name: document.getElementById("mName").value || "meal",
    meal: document.getElementById("mMeal").value,
    kcal: +document.getElementById("mK").value || 0,
    protein_g: +document.getElementById("mP").value || 0,
    carbs_g: +document.getElementById("mC").value || 0,
    fat_g: +document.getElementById("mF").value || 0 });
  document.getElementById("favSmoothie").onclick = ()=> logMeal({name:"Blueberry oatmeal smoothie",meal:"breakfast",kcal:520,protein_g:40,carbs_g:85,fat_g:8});
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
};

/* ---------------- NIGHT (routine, podcast, gear, close-out, alarm) ---------------- */
function gearList(dayType, storm){
  if (/fasted/.test(dayType)) return ["Kit laid out","Bottles filled (water only)","Edge charged","Lights charged","Tires checked","No rice balls — fasted by design"];
  if (/Commute/.test(dayType)) return ["Car bag: work clothes + charger","Rice balls wrapped, at the door","Edge charged","Lights charged", storm?"Rain shell in the bag (storms tomorrow)":"Check sky at rollout","Tires checked"];
  if (/HIIT/.test(dayType)) return ["Fan on desk","Towel","HR strap charged","Bottles on desk"];
  if (/strength/.test(dayType)) return ["Nothing to pack — the bell is where it lives"];
  return ["Bottles","Edge charged"];
}
V.night = async function(){
  const tomorrow = S.tomorrow || DAY_TYPES[0];
  view.innerHTML = `<span class="eyebrow">Nighttime routine</span>
    <div class="card"><h4>Evening mobility — 10 min</h4><div class="small">same flow, easy pace</div>
      <h4 style="margin-top:10px">Podcast</h4><div id="pods" class="small">reaching the bridge…</div>
      <audio id="player" controls style="width:100%;margin-top:8px" hidden></audio></div>
    <div class="card"><h4>Shower</h4><div class="small">~90 min before bed helps sleep onset</div></div>
    <div class="card"><h4>Gear check — tomorrow: 
      <select id="tmw">${DAY_TYPES.map(d=>`<option ${d===tomorrow?"selected":""}>${d}</option>`).join("")}</select></h4>
      <ul class="plain" id="gear"></ul></div>
    <div class="card"><h4>Close out</h4><div id="settle" class="small">computing…</div>
      <button class="primary" id="close">Settle the day</button></div>
    <div class="card"><h4>Alarm</h4>
      <input id="alarmT" type="time" value="${S.alarm||"05:30"}">
      <button id="alarmSet">Set</button>
      <div class="small" id="alarmMsg">${S.alarm?("Armed for "+S.alarm+" (keep this tablet open — kiosk mode)"):""}</div></div>`;

  bridge("/podcasts/list").then(p=>{
    const el = document.getElementById("pods");
    if (!p.episodes.length){ el.textContent = "No cached episodes — add feeds to bridge/podcast-feeds.json"; return; }
    el.innerHTML = p.episodes.map(e=>`<button data-e="${esc(e)}">${esc(e.replace(/-/g," ").replace(".mp3",""))}</button>`).join(" ");
    el.querySelectorAll("button").forEach(b=>b.onclick=()=>{
      const a = document.getElementById("player"); a.hidden=false;
      a.src = S.bridgeUrl + "/podcasts/file/" + b.dataset.e; a.play();
    });
  }).catch(()=>{ document.getElementById("pods").textContent = "bridge unreachable"; });

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

  bridge("/fuel-state").then(st=>{
    const b = st.balance_kcal;
    document.getElementById("settle").innerHTML =
      `Day at <span class="bandpill" style="background:${bandColor(b)}">${b}</span> · meals ${st.meals_today} · mobility ${localStorage.getItem("mob-am-"+new Date().toDateString())?"✓":"—"}`;
  }).catch(()=>{ document.getElementById("settle").textContent = "bridge unreachable"; });

  document.getElementById("close").onclick = async ()=>{
    try{
      const st = await bridge("/fuel-state");
      await bridge("/agent/closeout",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({summary:`Settled ${st.balance_kcal} kcal, ${st.meals_today} meals. Tomorrow: ${document.getElementById("tmw").value}.`})});
      document.getElementById("settle").innerHTML += " · <b>settled ✓</b>";
    }catch(e){}
  };
  document.getElementById("alarmSet").onclick = ()=>{
    S.alarm = document.getElementById("alarmT").value; saveS();
    document.getElementById("alarmMsg").textContent = "Armed for " + S.alarm + " (keep this tablet open — kiosk mode)";
  };
};

/* ---------------- AGENT (push-to-talk) ---------------- */
V.agent = function(){
  view.innerHTML = `<span class="eyebrow">The Way Agent</span>
    <div class="card" id="agentLog"><div class="small">Hold the button, talk, release. The spin is the meeting.</div></div>
    <button class="ptt" id="ptt">Hold to talk</button>
    <input id="typed" placeholder="…or type here and press Enter">`;
  const log = document.getElementById("agentLog");
  const add = (who, t)=>{ const d=document.createElement("div"); d.className="turn "+who;
    d.textContent = (who==="you"?"You: ":"Coach: ")+t; log.appendChild(d); log.scrollTop=1e6; };
  const ask = async (text)=>{
    add("you", text);
    try{
      const r = await bridge("/agent",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({text})});
      add("coach", r.reply); speak(r.reply);
    }catch(e){ add("coach","(bridge unreachable — " + e.message + ")"); }
  };
  document.getElementById("typed").addEventListener("keydown",e=>{
    if(e.key==="Enter"&&e.target.value.trim()){ ask(e.target.value.trim()); e.target.value=""; }});
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById("ptt");
  if (!SR){ btn.textContent = "Voice unavailable here — type below"; btn.disabled = true; return; }
  let rec=null;
  const start=()=>{ rec = new SR(); rec.lang="en-US"; rec.interimResults=false;
    rec.onresult=e=>{ const t=e.results[0][0].transcript; if(t.trim()) ask(t.trim()); };
    rec.onend=()=>btn.classList.remove("listening");
    btn.classList.add("listening"); btn.textContent="Listening…"; rec.start(); };
  const stop=()=>{ if(rec) rec.stop(); btn.textContent="Hold to talk"; };
  btn.addEventListener("pointerdown",start); btn.addEventListener("pointerup",stop);
};

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
  location.hash="#morning"; nav();
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
if(!location.hash) location.hash = "#" + defaultView();
nav();
