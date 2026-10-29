"use strict";
/* THE WAY — the plan: the week calendar (#calendar) and the workout builder
   (#workout). Loads after app.js and uses its globals: V, view, bridge, esc.
   The Way owns the plan; "Send to Garmin" writes the workout to intervals.icu,
   whose Garmin Connect sync carries it to the Edge. */
(function(){

const J = {"Content-Type":"application/json"};
const pad = n => String(n).padStart(2,"0");
function keyAdd(k,n){ const [y,m,d]=k.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)+n*864e5).toISOString().slice(0,10); }
function mondayOf(k){ const [y,m,d]=k.split("-").map(Number); const wd=new Date(Date.UTC(y,m-1,d)).getUTCDay(); return keyAdd(k, -((wd+6)%7)); }
function localToday(){ const d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function params(){ return Object.fromEntries(new URLSearchParams(location.hash.split("?")[1]||"")); }
function hm(min){ min=Math.round(min||0); return Math.floor(min/60)+":"+pad(min%60); }
function clock(s){ s=Math.round(s||0); const h=Math.floor(s/3600), m=Math.floor(s%3600/60), x=s%60; return h ? h+":"+pad(m)+":"+pad(x) : m+":"+pad(x); }
function dayLabel(k, opts){ const [y,m,d]=k.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d)).toLocaleDateString(undefined, Object.assign({weekday:"short",day:"numeric",month:"short",timeZone:"UTC"}, opts||{})); }
function syncBadge(w){
  const s=(w.sync&&w.sync.state)||"off";
  if (s==="synced") return `<span class="pbadge ok" title="Sent ${esc((w.sync.at||"").slice(0,16).replace("T"," "))}">On Garmin</span>`;
  if (s==="error") return `<span class="pbadge bad" title="${esc(w.sync.error||"")}">Not sent: error</span>`;
  return `<span class="pbadge">Not sent</span>`;
}
const SPORT = { Ride:"Road", VirtualRide:"Zwift", WeightTraining:"Lift" };

/* ---------------- the week ---------------- */
V.calendar = async function(){
  const p = params(), today = localToday();
  const mon = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(p.week||"") ? p.week : today);
  const sun = keyAdd(mon, 6);
  const go = k => { location.hash = "#calendar?week="+k; };
  view.innerHTML = `<span class="eyebrow">The plan</span>
    <div class="pweekhead"><h2 class="ptitle">Week of ${esc(dayLabel(mon,{weekday:undefined}))}</h2>
      <div class="pweeknav"><button id="pPrev" aria-label="Previous week">‹</button><button id="pToday">This week</button><button id="pNext" aria-label="Next week">›</button></div></div>
    <div id="pWeek"><div class="card"><div class="small">Loading the week…</div></div></div>`;
  document.getElementById("pPrev").onclick = ()=>go(keyAdd(mon,-7));
  document.getElementById("pNext").onclick = ()=>go(keyAdd(mon,7));
  document.getElementById("pToday").onclick = ()=>go(mondayOf(today));

  let cal;
  try{ cal = await bridge(`/calendar?from=${mon}&to=${sun}`); }
  catch(e){ document.getElementById("pWeek").innerHTML = `<div class="card"><h4>Couldn't load the week</h4><div class="small">${esc(e.message)}</div></div>`; return; }
  if (!location.hash.startsWith("#calendar")) return;

  const T = cal.days.reduce((a,d)=>({pm:a.pm+d.totals.planned_min, dm:a.dm+d.totals.done_min, pt:a.pt+d.totals.planned_tss, dt:a.dt+d.totals.done_tss}), {pm:0,dm:0,pt:0,dt:0});
  const pct = T.pm ? Math.min(100, Math.round(T.dm/T.pm*100)) : 0;
  const warn = [];
  if (!cal.sources.intervals.configured) warn.push("intervals.icu is not connected, so workouts can be planned here but not sent to the Garmin. It needs INTERVALS_ICU_API_KEY and INTERVALS_ICU_ATHLETE_ID in Netlify.");
  else if (cal.sources.intervals.error) warn.push("intervals.icu: "+cal.sources.intervals.error);
  if (!cal.sources.strava.connected) warn.push("Strava isn't answering ("+(cal.sources.strava.reason||"not connected")+"), so completed rides won't show.");

  let html = `<div class="card day pweeksum">
      <div class="pcols">
        <div><label>Planned</label><div class="pbig">${hm(T.pm)}</div><div class="small">${T.pt} TSS</div></div>
        <div><label>Done</label><div class="pbig">${hm(T.dm)}</div><div class="small">${T.dt} TSS</div></div>
        <div><label>Done of planned</label><div class="pbig">${T.pm?pct+"%":"—"}</div><div class="small">by time</div></div>
      </div>
      <div class="pbar" role="img" aria-label="${pct}% of planned time done"><i style="width:${pct}%"></i></div>
    </div>`;
  if (warn.length) html += `<div class="card pwarn">${warn.map(w=>`<div class="small">${esc(w)}</div>`).join("")}</div>`;

  for (const d of cal.days){
    const isToday = d.date === today, past = d.date < today;
    const rows = [];
    for (const w of d.planned){
      const c = w.compliance;
      rows.push(`<a class="pitem planned${c?" graded "+c.band:""}" href="#workout?id=${encodeURIComponent(w.id)}">
        <span class="pk">${esc(SPORT[w.sport]||w.sport)}${w.time?" · "+esc(w.time):""}${c?` · <b>${c.pct}%</b> ${esc(c.basis)}`:""}</span>
        <span class="pn">${esc(w.name)}</span>
        <span class="pm">${clock(w.metrics.duration_s)} · ${w.metrics.tss} TSS ${w.logged?`<span class="pbadge ok" title="Saved on a day already gone, with no Strava ride that day: counted as done">Logged</span>`:c?`<span class="pbadge ${c.band==="green"?"ok":c.band==="yellow"?"warn":"bad"}">${c.band==="green"?"Done":c.over?"Over":c.band==="yellow"?"Partly":"Missed"}</span>`:syncBadge(w)}</span></a>`);
    }
    for (const e of d.intervals) rows.push(`<div class="pitem icu">
        <span class="pk">intervals.icu${e.time?" · "+esc(e.time):""}</span>
        <span class="pn">${esc(e.name)}</span>
        <span class="pm">${e.minutes?hm(e.minutes):"—"}${e.tss?" · "+e.tss+" TSS":""} <span class="pbadge">Planned outside The Way</span></span></div>`);
    for (const r of d.done){
      const a = r.analysis, h = a && a.hr, b = a && a.resp, v = a && a.ve;
      rows.push(`<div class="pitem done">
        <span class="pk">Done${r.time?" · "+esc(r.time):""}</span>
        <span class="pn">${esc(r.name)}</span>
        <span class="pm">${hm(r.minutes)}${r.miles?" · "+r.miles+" mi":""}${r.np_w?" · NP "+r.np_w+" W":r.avg_w?" · "+r.avg_w+" W":""}${h?` · HR ${h.avg} avg, ${h.max} max`:r.avg_hr?" · "+r.avg_hr+" bpm":""}${r.tss!=null?" · ~"+r.tss+" TSS":""}</span>
        ${h?`<span class="pm small">${h.zones?`${h.minutes_above_hard} min above ${h.hard_bpm} · zones ${h.zones.z1_min}/${h.zones.z2_min}/${h.zones.z3_min} min (${h.zone_pct.z1}% under VT1)`:"averages only"}${h.estimated?` · ${esc(h.estimated)}`:""}${b?` · breathing ${b.avg}/min avg${b.max?`, ${b.max} max`:""}`:""}${v?` · VE ${v.avg} L/min${v.minutes_above_vt2!=null?`, ${v.minutes_above_vt2} min above VT2`:""}${v.pct_under_vt1!=null?`, ${v.pct_under_vt1}% under VT1`:""}`:""}${!b&&!v&&a&&a.sources&&a.sources.resp?` · ${esc(a.sources.resp)}`:""}</span>`:a&&a.sources?`<span class="pm small">${esc(a.sources.hr||"")}${a.sources.whoop?` · ${esc(a.sources.whoop)}`:""}</span>`:""}</div>`);
    }
    let verdict = "";
    const dc = d.compliance;
    if (dc && dc.band === "extra") verdict = `<span class="pbadge">Unplanned ride</span>`;
    else if (dc) verdict = `<span class="pbadge ${dc.band==="green"?"ok":dc.band==="yellow"?"warn":"bad"}">${dc.pct}% · ${dc.band==="green"?"done":dc.over?"over the plan":dc.band==="yellow"?"partly":"missed"}</span>`;
    html += `<div class="card pday${isToday?" today":""}${past?" past":""}${dc&&dc.band!=="extra"?" graded "+dc.band:""}">
      <div class="pdayhead"><h4>${esc(dayLabel(d.date))}${isToday?" · today":""}</h4>
        <span class="small">${d.totals.planned_min?hm(d.totals.planned_min)+" planned":""}${d.totals.done_min?" · "+hm(d.totals.done_min)+" done":""} ${verdict}</span></div>
      ${rows.join("") || `<div class="small pempty">Rest${past?"":", or nothing planned yet"}.</div>`}
      ${past ? `<div class="small">What was ridden comes in from the Garmin through Strava.</div>` : `<a class="padd" href="#workout?date=${d.date}">+ Plan a workout</a>`}
    </div>`;
  }
  html += `<div class="card"><h4>Planning numbers</h4><div id="pSettings" class="small">loading…</div></div>`;
  document.getElementById("pWeek").innerHTML = html;
  drawSettings(cal.settings);
};

async function drawSettings(st){
  const el = document.getElementById("pSettings"); if (!el) return;
  el.innerHTML = `<div class="small">Power targets go to the Garmin as a percentage of FTP and heart rate as a percentage of threshold heart rate, so these must match what intervals.icu holds.</div>
    <div class="row3"><div><label for="sFtp">FTP (W)</label><input id="sFtp" type="number" inputmode="numeric" value="${st.ftp}"></div>
    <div><label for="sLthr">Threshold HR</label><input id="sLthr" type="number" inputmode="numeric" value="${st.lthr}"></div>
    <div><label for="sRest">Resting HR</label><input id="sRest" type="number" inputmode="numeric" value="${st.hr_rest}"></div></div>
    <button id="sSave">Save</button> <span class="small" id="sMsg"></span>
    <div id="sPre" class="small" style="margin-top:10px">Checking intervals.icu…</div>`;
  document.getElementById("sSave").onclick = async ()=>{
    const msg = document.getElementById("sMsg"); msg.textContent = "saving…";
    try{ const s = await bridge("/workouts/settings",{method:"PUT",headers:J,body:JSON.stringify({ftp:+document.getElementById("sFtp").value, lthr:+document.getElementById("sLthr").value, hr_rest:+document.getElementById("sRest").value})});
      msg.textContent = `Saved: FTP ${s.ftp} W, threshold ${s.lthr} bpm.`; preflight(); }
    catch(e){ msg.textContent = e.message; }
  };
  preflight();
}
async function preflight(){
  const el = document.getElementById("sPre"); if (!el) return;
  try{
    const r = await bridge("/workouts/preflight");
    if (!r.configured) { el.textContent = "intervals.icu isn't connected, so there is nothing to compare against yet."; return; }
    if (r.reason) { el.textContent = "Couldn't read intervals.icu: "+r.reason; return; }
    el.innerHTML = r.ok ? `<span class="pbadge ok">Matches intervals.icu</span>`
      : `<span class="pbadge bad">Doesn't match intervals.icu</span><ul class="pissues">${r.issues.map(i=>`<li>${esc(i)}</li>`).join("")}</ul><div class="small">Change it in intervals.icu → Settings → Cycling, or change the number here. Until they match, the Garmin shows different targets from the ones planned.</div>`;
  }catch(e){ el.textContent = "Couldn't check: "+e.message; }
}

/* ---------------- the builder ---------------- */
const TYPES = [["power","% FTP"],["watts","Watts"],["ramp","Ramp % FTP"],["hr","Heart rate"],["free","Free ride"]];
const blankStep = () => ({kind:"step", label:"", dur_s:600, target:{type:"power", lo:65, hi:75}, cadence:null});

V.workout = async function(){
  const p = params();
  let W = null, saved = null, lib = [], settings = null, timer = null;
  view.innerHTML = `<a class="pback" href="#calendar">← The week</a><div id="pB"><div class="card"><div class="small">Loading…</div></div></div>`;
  try{
    const L = await bridge("/workouts/library"); lib = L.library; settings = L.settings;
    if (p.id){ saved = await bridge("/workouts/"+encodeURIComponent(p.id)); W = clone(saved); }
  }catch(e){ document.getElementById("pB").innerHTML = `<div class="card"><h4>Couldn't load</h4><div class="small">${esc(e.message)}</div></div>`; return; }
  if (!location.hash.startsWith("#workout")) return;

  const box = document.getElementById("pB");
  // A new workout is planned ahead: without a day from the calendar it lands
  // on tomorrow, and never on a day already gone. The past is Strava's
  // record, filled in by the Garmin, not something typed in here.
  const today = localToday();
  const wanted = /^\d{4}-\d{2}-\d{2}$/.test(p.date||"") ? p.date : keyAdd(today, 1);
  const date0 = wanted < today ? keyAdd(today, 1) : wanted;

  if (!W){   // pick a starting point
    box.innerHTML = `<span class="eyebrow">New workout · ${esc(dayLabel(date0))}</span>
      <h2 class="ptitle">Start from</h2>
      <div class="plib">${lib.map((t,i)=>`<button class="plibitem" data-i="${i}">
        <span class="pn">${esc(t.name)}</span>
        <span class="pm">${clock(t.metrics.duration_s)} · ${t.metrics.tss} TSS · ${esc(SPORT[t.sport]||t.sport)}</span></button>`).join("")}
        <button class="plibitem" data-i="-1"><span class="pn">Blank workout</span><span class="pm">build it step by step</span></button></div>`;
    box.querySelectorAll(".plibitem").forEach(b=>b.onclick = ()=>{
      const t = lib[+b.dataset.i];
      // 6:00 is the house start; the meal plan hangs off this time.
      W = t ? {name:t.name, date:date0, time:"06:00", sport:t.sport, notes:t.notes||"", steps:clone(t.steps)}
            : {name:"Workout", date:date0, time:"06:00", sport:"Ride", notes:"", steps:[blankStep()]};
      editor();
    });
    return;
  }
  W.time = W.time || "";
  editor();

  function editor(){
    box.innerHTML = `<span class="eyebrow">${saved ? "Workout" : "New workout"}</span>
      <div class="card">
        <label for="wName">Name</label><input id="wName" value="${esc(W.name)}">
        <div class="row3">
          <div><label for="wDate">Date</label><input id="wDate" type="date" min="${saved ? "" : today}" value="${esc(W.date)}"></div>
          <div><label for="wTime">Start</label><input id="wTime" type="time" value="${esc(W.time||"")}"></div>
          <div><label for="wSport">Where</label><select id="wSport">
            ${["Ride","VirtualRide"].map(s=>`<option value="${s}"${W.sport===s?" selected":""}>${SPORT[s]}</option>`).join("")}</select></div>
        </div>
        <label for="wNotes">Notes (go to the Garmin with the workout)</label><textarea id="wNotes" rows="3">${esc(W.notes||"")}</textarea>
      </div>
      <div class="card day psum" id="wSum"></div>
      <div id="wSteps"></div>
      <div class="pbtns"><button id="addStep">+ Step</button><button id="addRep">+ Repeat block</button></div>
      <div class="card">
        <h4>Save</h4>
        <div class="small" id="wSync">${saved ? syncLine(saved) : "Not saved yet."}</div>
        <div class="pbtns">
          <button class="primary" id="wSend">${saved && saved.sync && saved.sync.state==="synced" ? "Save and update Garmin" : "Save and send to Garmin"}</button>
          <button id="wSave">Save only</button>
          ${saved ? `<a class="btn" href="${(typeof DEFAULT_API!=="undefined"?DEFAULT_API:"")}/workouts/${encodeURIComponent(saved.id)}/zwo" download>Zwift file</a>` : ""}
          ${saved ? `<button id="wDel" class="pdanger">Delete</button>` : ""}
        </div>
      </div>
      <details class="card"><summary>What intervals.icu receives</summary><pre id="wText" class="ptext"></pre></details>`;
    const bind = (id, k, f) => { const el = document.getElementById(id); el.oninput = el.onchange = ()=>{ W[k] = f ? f(el.value) : el.value; schedule(); }; };
    bind("wName","name"); bind("wDate","date"); bind("wTime","time"); bind("wSport","sport"); bind("wNotes","notes");
    document.getElementById("addStep").onclick = ()=>{ W.steps.push(blankStep()); drawSteps(); schedule(); };
    document.getElementById("addRep").onclick = ()=>{ W.steps.push({kind:"repeat", label:"Main set", count:3, steps:[
      {kind:"step",label:"On",dur_s:300,target:{type:"power",lo:95,hi:105},cadence:null},
      {kind:"step",label:"Off",dur_s:180,target:{type:"power",lo:50,hi:60},cadence:null}]}); drawSteps(); schedule(); };
    document.getElementById("wSave").onclick = ()=>store(false);
    document.getElementById("wSend").onclick = ()=>store(true);
    const del = document.getElementById("wDel");
    if (del) del.onclick = async ()=>{
      if (del.dataset.armed !== "1"){ del.dataset.armed = "1"; del.textContent = "Tap again to delete"; setTimeout(()=>{ if(del.isConnected){ del.dataset.armed=""; del.textContent="Delete"; } }, 4000); return; }
      try{ await bridge("/workouts/"+encodeURIComponent(saved.id),{method:"DELETE"}); location.hash = "#calendar?week="+mondayOf(W.date); }
      catch(e){ document.getElementById("wSync").textContent = e.message; }
    };
    drawSteps(); schedule(0);
  }

  function syncLine(w){
    const s = w.sync || {};
    if (s.state==="synced") return `On the Garmin calendar via intervals.icu since ${esc((s.at||"").slice(0,16).replace("T"," "))}, planned at FTP ${esc(s.planned_at_ftp)} W and threshold ${esc(s.planned_at_lthr)} bpm.`;
    if (s.state==="error") return `<span class="pbadge bad">Not sent</span> ${esc(s.error||"")}`;
    return "Saved here, not yet sent to the Garmin.";
  }

  async function store(send){
    const msg = document.getElementById("wSync"); msg.textContent = send ? "Saving and sending…" : "Saving…";
    const body = JSON.stringify(Object.assign({}, W, {time: W.time || null, send}));
    try{
      const r = saved ? await bridge("/workouts/"+encodeURIComponent(saved.id),{method:"PUT",headers:J,body})
                      : await bridge("/workouts",{method:"POST",headers:J,body});
      const first = !saved; saved = r; W = clone(r); W.time = W.time || "";
      if (first) history.replaceState(null, "", "#workout?id="+encodeURIComponent(r.id));
      editor();
    }catch(e){ msg.textContent = e.message; }
  }

  function drawSteps(){
    const host = document.getElementById("wSteps");
    host.innerHTML = W.steps.map((it,i)=> it.kind==="repeat" ? repHTML(it,i) : `<div class="card pstep">${stepHTML(it,[i])}</div>`).join("");
    host.querySelectorAll("[data-path]").forEach(el=>{
      const path = el.dataset.path.split(".").map(Number), f = el.dataset.f;
      const ev = el.tagName === "SELECT" ? "onchange" : "oninput";
      el[ev] = ()=>{
        const s = at(path);
        if (f === "label") s.label = el.value;
        else if (f === "min" || f === "sec"){ const row = el.closest(".pstepin"); const mm = +row.querySelector('[data-f="min"]').value||0, ss = +row.querySelector('[data-f="sec"]').value||0; s.dur_s = Math.max(1, mm*60+ss); }
        else if (f === "type"){ s.target = defaultTarget(el.value, s.target); drawSteps(); }
        else if (f === "lo" || f === "hi" || f === "from" || f === "to") s.target[f] = el.value === "" ? null : +el.value;
        else if (f === "clo" || f === "chi"){ const k = f==="clo"?"lo":"hi"; s.cadence = s.cadence || {}; s.cadence[k] = el.value===""?null:+el.value; if (s.cadence.lo==null && s.cadence.hi==null) s.cadence = null; }
        else if (f === "count") s.count = Math.max(1, +el.value||1);
        else if (f === "rlabel") s.label = el.value;
        schedule();
      };
    });
    host.querySelectorAll("[data-act]").forEach(b=>b.onclick = ()=>{
      const path = b.dataset.p.split(".").map(Number), act = b.dataset.act;
      const list = path.length === 1 ? W.steps : W.steps[path[0]].steps, i = path[path.length-1];
      if (act === "del"){ list.splice(i,1); if (path.length === 2 && !list.length) W.steps.splice(path[0],1); }
      if (act === "up" && i > 0) [list[i-1], list[i]] = [list[i], list[i-1]];
      if (act === "down" && i < list.length-1) [list[i+1], list[i]] = [list[i], list[i+1]];
      if (act === "dup") list.splice(i+1, 0, clone(list[i]));
      if (act === "addin") W.steps[path[0]].steps.push(blankStep());
      drawSteps(); schedule();
    });
  }
  function at(path){ return path.length === 1 ? W.steps[path[0]] : W.steps[path[0]].steps[path[1]]; }
  function tools(p){ return `<span class="ptools">
      <button data-act="up" data-p="${p}" aria-label="Move up">↑</button><button data-act="down" data-p="${p}" aria-label="Move down">↓</button>
      <button data-act="dup" data-p="${p}" aria-label="Duplicate">⧉</button><button data-act="del" data-p="${p}" aria-label="Remove">×</button></span>`; }
  function repHTML(r,i){
    return `<div class="card prep">
      <div class="prephead"><input class="pcount" type="number" min="1" inputmode="numeric" data-path="${i}" data-f="count" value="${r.count}" aria-label="Repeats">
        <span class="px">×</span><input data-path="${i}" data-f="rlabel" value="${esc(r.label||"")}" placeholder="Block name" aria-label="Block name">${tools(String(i))}</div>
      ${r.steps.map((s,j)=>`<div class="pstep inner">${stepHTML(s,[i,j])}</div>`).join("")}
      <button data-act="addin" data-p="${i}">+ Step in block</button></div>`;
  }
  function stepHTML(s, path){
    const p = path.join("."), t = s.target, d = s.dur_s;
    const unit = {power:"% FTP", watts:"W", ramp:"% FTP", hr:"bpm"}[t.type];
    const lohi = t.type==="free" ? `<div class="small pfree">No target. ERG off.</div>`
      : t.type==="ramp" ? `<div class="prange"><input type="number" inputmode="numeric" data-path="${p}" data-f="from" value="${t.from}" aria-label="From"><span>→</span><input type="number" inputmode="numeric" data-path="${p}" data-f="to" value="${t.to}" aria-label="To"><span class="pu">${unit}</span></div>`
      : `<div class="prange"><input type="number" inputmode="numeric" data-path="${p}" data-f="lo" value="${t.lo}" aria-label="Low"><span>–</span><input type="number" inputmode="numeric" data-path="${p}" data-f="hi" value="${t.hi}" aria-label="High"><span class="pu">${unit}</span></div>`;
    return `<div class="pstepin">
      <div class="pstephead"><input data-path="${p}" data-f="label" value="${esc(s.label||"")}" placeholder="Step name" aria-label="Step name">${tools(p)}</div>
      <div class="pgrid">
        <div class="pdur"><input type="number" min="0" inputmode="numeric" data-path="${p}" data-f="min" value="${Math.floor(d/60)}" aria-label="Minutes"><span>min</span>
          <input type="number" min="0" max="59" inputmode="numeric" data-path="${p}" data-f="sec" value="${d%60}" aria-label="Seconds"><span>s</span></div>
        <select data-path="${p}" data-f="type" aria-label="Target">${TYPES.map(([k,l])=>`<option value="${k}"${t.type===k?" selected":""}>${l}</option>`).join("")}</select>
        ${lohi}
        <div class="prange pcad"><input type="number" inputmode="numeric" data-path="${p}" data-f="clo" value="${s.cadence?s.cadence.lo??"":""}" placeholder="rpm" aria-label="Cadence low"><span>–</span><input type="number" inputmode="numeric" data-path="${p}" data-f="chi" value="${s.cadence?s.cadence.hi??"":""}" placeholder="rpm" aria-label="Cadence high"><span class="pu">rpm</span></div>
      </div></div>`;
  }
  function defaultTarget(type, prev){
    const st = settings || {ftp:175, lthr:139};
    if (type === "power") return {type, lo:65, hi:75};
    if (type === "watts") return {type, lo:Math.round(st.ftp*.65), hi:Math.round(st.ftp*.75)};
    if (type === "ramp")  return {type, from:50, to:75};
    if (type === "hr")    return {type, lo:100, hi:116};
    return {type:"free"};
  }

  function schedule(ms){ clearTimeout(timer); timer = setTimeout(preview, ms==null ? 250 : ms); }
  async function preview(){
    const el = document.getElementById("wSum"); if (!el) return;
    try{
      const r = await bridge("/workouts/preview",{method:"POST",headers:J,body:JSON.stringify({steps:W.steps})});
      const m = r.metrics;
      el.innerHTML = `<div class="pcols">
          <div><label>Time</label><div class="pbig">${clock(m.duration_s)}</div></div>
          <div><label>Load</label><div class="pbig">${m.tss}</div><div class="small">TSS</div></div>
          <div><label>Intensity</label><div class="pbig">${m.if.toFixed(2)}</div><div class="small">IF</div></div>
        </div>${profileSVG(r.profile)}
        <div class="small">Estimated from ${esc(m.estimated_from)}, at FTP ${settings?settings.ftp:"—"} W and threshold ${settings?settings.lthr:"—"} bpm.</div>`;
      const pre = document.getElementById("wText"); if (pre) pre.textContent = r.intervals_text;
    }catch(e){ el.innerHTML = `<div class="small">Couldn't preview: ${esc(e.message)}</div>`; }
  }
};

function profileSVG(pr){
  if (!pr || !pr.length) return "";
  const T = pr[pr.length-1].t1, W = 640, H = 96, top = 1.5;
  const x = t => (t/T*W).toFixed(1), y = f => (H - Math.min(top, f)/top*H).toFixed(1);
  const col = f => f > 1.05 ? "var(--red)" : f > .8 ? "var(--amber)" : "var(--green)";
  const shapes = pr.map(s => `<polygon points="${x(s.t0)},${H} ${x(s.t0)},${y(s.from)} ${x(s.t1)},${y(s.to)} ${x(s.t1)},${H}" fill="${col(Math.max(s.from,s.to))}" opacity="${s.kind==="free"?.35:.85}"/>`).join("");
  const ftpY = y(1);
  return `<svg class="pprof" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Workout profile">
    ${shapes}<line x1="0" x2="${W}" y1="${ftpY}" y2="${ftpY}" stroke="var(--ink)" stroke-dasharray="4 4" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
    <div class="pleg small"><span>dashed line = FTP</span><span><i style="background:var(--green)"></i>easy</span><span><i style="background:var(--amber)"></i>tempo to threshold</span><span><i style="background:var(--red)"></i>above</span></div>`;
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }

// app.js ran nav() before this file loaded; if the page opened on one of these
// views it fell through, so draw it now.
const h = location.hash.replace("#","").split("?")[0];
if (h === "calendar" || h === "workout") nav();

})();
