"use strict";
/* THE WAY — PWA. Local-first; bridge sync when reachable. */

const S = JSON.parse(localStorage.getItem("way-settings") || "{}");
function saveS(){ localStorage.setItem("way-settings", JSON.stringify(S)); }
const BAND = [-600,-300], TARGET = -450, BASE_BURN = 2050, PROTEIN_GOAL = 190;
const DAY_TYPES = ["Day 1 · fasted Z2","Day 2 · HIIT","Day 3 · grocery + batch","Day 4 · fasted Z2","Day 5 · strength (kettlebell)","Commute · 35 mi evening"];

/* API base auto-select:
   - explicit Bridge URL in Settings wins
   - PWA served by the local bridge (port 8420) -> same-origin ""
   - hosted (Netlify) -> /.netlify/functions/api                     */
const DEFAULT_API = (location.port === "8420") ? "" : "/.netlify/functions/api";
const DEMO = {
  "/route-weather": { now:{t:74,w:8,ride:"crosswind 8 mph"}, evening:{t:81,w:12,ride:"headwind 12 mph"}, stormAfterHour:16 },
  "/weight/latest": { latest:{ lb:176.4, logged_today:true }, ma7_lb:177.0, week_change_lb:-0.5 },
  "/sleep/latest": { sleep:{performance:87,hours:7.4}, recovery:{score:72,hrv:68,rhr:47} },
  "/fuel-state": { carbs_g:62, fasted:false, meals_today:2, balance_kcal:-410, ball_carbs_g:19.4, fresh:true },
  "/meals/today": { meals:[ {meal:"breakfast",name:"Blueberry oatmeal smoothie",kcal:520}, {meal:"lunch",name:"Post-ride bowl",kcal:750} ] },
  "/race": { race:{name:"Gran Fondo Maryland — Medio"}, weeks_out:10.1, phase:"build",
    need:{aerobic_h:6.2,hi_min:88,strength:2}, done:{aerobic_h:0,hi_min:0,strength:0}, remaining:{aerobic_h:6.2,hi_min:88,strength:2} },
  "/prescription/lunch": { kcal:850, note:"carb-weighted recovery", units:{protein:2,carb:5,fat:1,greens:2} },
  "/prescription/dinner": { kcal:1140, note:"settles the day in the band", units:{protein:4,carb:4,fat:2,greens:2} },
  "/podcasts/list": { episodes:[] },
  "/plan": { ride:null, for_today:false },
  "/agent": { reply:"Demo mode — connect the bridge (Settings) or deploy the Netlify function for real answers." },
  "/agent/closeout": { ok:true }, "/meals": { ok:true }
};
async function bridge(pathname, opts){
  const base = S.bridgeUrl || DEFAULT_API;
  try{
    const sep = pathname.includes("?") ? "&" : "?";
    const r = await fetch(base + pathname + sep + "token=" + (S.token||""), opts);
    if (!r.ok) throw new Error("bridge " + r.status);
    return await r.json();
  }catch(e){
    const k = Object.keys(DEMO).find(k => pathname.startsWith(k));
    if (k && (!opts || !opts.method || opts.method === "GET")) return JSON.parse(JSON.stringify(DEMO[k]));
    throw e;
  }
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
    <div class="card" id="race"><h4>The race</h4><div class="small">reaching the bridge…</div></div>
    <div class="card" id="wx"><h4>Weather</h4><div class="small">reaching the bridge…</div></div>
    <div class="card" id="weigh"><h4>Step on the scale</h4><div class="small">waiting for the weigh-in…</div></div>
    <div class="card" id="sleep"><h4>Sleep</h4><div class="small">waiting for WHOOP…</div></div>
    <div class="card"><h4>Mobility — 10 min</h4><ul class="plain" id="mob"></ul>
      <button id="mobNext">Next</button> <button id="mobRepeat" disabled>Repeat that</button></div>
    <div class="card"><h4>Then</h4><div class="small">30-min warm-up spin — the Agent is on the <a href="#agent">Agent tab</a>. Breakfast unlocks after weigh-in.</div></div>`;

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
          <div class="small">${esc(w.now.ride)} now · evening: ${esc(w.evening.ride)}${w.stormAfterHour>0 ? " · storms possible after "+w.stormAfterHour+":00" : ""} · no ride planned — set one in Night</div>`;
      }
    }catch(e){ document.getElementById("wx").innerHTML = `<h4>Weather</h4><div class="small">bridge unreachable — check settings</div>`; }
  })();

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

  bridge("/race").then(r=>{
    document.getElementById("race").innerHTML =
      `<h4>${r.race.name} · ${r.weeks_out} weeks out · ${r.phase}</h4>
       <div class="small">This week still owes: <b>${r.remaining.aerobic_h}h</b> aerobic · <b>${r.remaining.hi_min}min</b> hard · <b>${r.remaining.strength}</b> strength
       <br>(done: ${r.done.aerobic_h}h / ${r.done.hi_min}min / ${r.done.strength})</div>`;
  }).catch(()=>{ document.getElementById("race").innerHTML = `<h4>The race</h4><div class="small">bridge unreachable</div>`; });
  bridge("/sleep/latest").then(s=>{
    const el = document.getElementById("sleep");
    if (s.sleep) el.innerHTML = `<h4>Slept ${s.sleep.performance ?? "—"} · ${s.sleep.hours ?? "—"} h</h4>
      <div class="small">recovery ${s.recovery?.score ?? "—"} · HRV ${s.recovery?.hrv ?? "—"} · RHR ${s.recovery?.rhr ?? "—"}</div>`;
    else el.innerHTML = `<h4>Sleep</h4><div class="small">no WHOOP data yet — connect at /whoop/auth on the bridge</div>`;
  }).catch(()=>{});

  // Guided mobility, coach-paced: describe the move, then wait for you.
  // Advance by voice ("ready", "next", "done") or the button.
  const moves = [
    {n:"Cat Cow", d:"On all fours. Arch your back up like an angry cat, then drop the belly and lift the chest. Move with your breath, about 15 slow reps."},
    {n:"Cobra", d:"Lie face down, hands under shoulders. Press the chest up, hips stay heavy on the floor. Hold and breathe, about 30 seconds — this is the extension your spine wants after the bike."},
    {n:"Deep lunge", d:"Big step forward, back knee down, sink the hips low and forward. 30 seconds, then switch legs. This is your hip flexors paying rent."},
    {n:"World's greatest stretch", d:"From a lunge, drop the inside hand, rotate the other arm to the sky and follow it with your eyes. About 15 slow reps, alternating sides."},
    {n:"Open books", d:"Lie on your side, knees bent, arms stacked in front. Open the top arm across your body like a book cover, eyes following the hand. 10 each side — this is the thoracic rotation cyclists lose first."},
    {n:"Quad stretch", d:"Standing or side-lying, pull the heel to your glute, knee pointing down. 30 seconds each side, hips pressed forward."},
    {n:"Downward dog", d:"Hands and feet on the floor, hips to the sky. Pedal the heels one at a time. 30 seconds, long spine."},
    {n:"Pigeon", d:"One shin folded in front, back leg long behind. Square the hips and fold forward over the front leg. 30 seconds each side, breathe into it."},
    {n:"90 90s", d:"Seated, both knees bent at right angles, one in front, one to the side. Rotate the knees over to the other side with control. 15 slow transitions."},
    {n:"Deep squat hold", d:"Feet shoulder width, sink all the way down. Heels stay on the floor, chest tall, elbows can pry the knees out. 30 seconds — this is your bottom-bracket position insurance."}
  ];
  let mi = -1, mobRec = null;
  const mobDone = ()=> LS.setItem("mob-am-"+new Date().toDateString(),"1");
  const drawMob = ()=>{
    document.getElementById("mob").innerHTML =
      moves.map((m,i)=>`<li class="${i<mi?"done":""}"><span>${i===mi?"<b>":""}${m.n}${i===mi?"</b>":""}</span><span>${i<mi?"✓":(i===mi?"now":"")}</span></li>`).join("");
    const btn = document.getElementById("mobNext");
    if (mi >= moves.length){ btn.textContent = "Done ✓"; btn.disabled = true; }
    else btn.textContent = mi < 0 ? "Start guided flow" : "Ready — next";
  };
  const listenForReady = ()=>{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return; // button still works everywhere
    try{
      mobRec = new SR(); mobRec.lang = "en-US"; mobRec.continuous = true; mobRec.interimResults = false;
      mobRec.onresult = e=>{
        const t = e.results[e.results.length-1][0].transcript.toLowerCase();
        if (/\b(ready|next|done|go|continue)\b/.test(t)) nextMove();
        else if (/\b(repeat|again)\b/.test(t) && mi >= 0) speak(moves[mi].d);
      };
      mobRec.onend = ()=>{ if (mi >= 0 && mi < moves.length) { try{ mobRec.start(); }catch(e){} } };
      mobRec.start();
    }catch(e){}
  };
  const stopListening = ()=>{ if (mobRec){ mobRec.onend = null; try{ mobRec.stop(); }catch(e){} mobRec = null; } };
  const nextMove = ()=>{
    mi++;
    if (mi >= moves.length){
      stopListening(); mobDone(); drawMob();
      speak("That's the flow. Ten minutes well spent. Onto the bike.");
      return;
    }
    const m = moves[mi];
    speak(m.n + ". " + m.d + " ... Let me know when you're ready to move on.");
    drawMob();
  };
  drawMob();
  document.getElementById("mobNext").onclick = ()=>{
    if (mi < 0) listenForReady();
    nextMove();
    document.getElementById("mobRepeat").disabled = (mi < 0 || mi >= moves.length);
  };
  document.getElementById("mobRepeat").onclick = ()=>{
    if (mi >= 0 && mi < moves.length){
      const m = moves[mi];
      speak(m.n + ". " + m.d);
    }
  };
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
      else msg += " — Morning will brief it.";
      document.getElementById("planMsg").textContent = msg;
    }catch(e){ document.getElementById("planMsg").textContent = "bridge unreachable"; }
  };

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
