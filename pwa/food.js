"use strict";
/* THE WAY — Food (#food): the photo journal.
   Point the camera at the plate, the bridge reads it (bridge/food.js), and the
   day is scored against the day's guidelines. Loads after app.js and uses its
   globals: V, view, bridge, esc, fileToBase64. */
(function(){

const J = {"Content-Type":"application/json"};
const pad = n => String(n).padStart(2,"0");
function keyAdd(k,n){ const [y,m,d]=k.split("-").map(Number); return new Date(Date.UTC(y,m-1,d)+n*864e5).toISOString().slice(0,10); }
function localToday(){ const d=new Date(); return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function params(){ return Object.fromEntries(new URLSearchParams(location.hash.split("?")[1]||"")); }
function dayLabel(k){ const [y,m,d]=k.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d)).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",timeZone:"UTC"}); }
function hm12(t){ const m=/^(\d{2}):(\d{2})$/.exec(t||""); if(!m) return t||""; let h=+m[1]; const ap=h<12?"a":"p"; h=h%12; if(h===0)h=12; return h+":"+m[2]+ap; }
function nowHM(){ const d=new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
function clock(iso){ const d=new Date(iso); if (isNaN(d)) return ""; let h=d.getHours(); const mm=pad(d.getMinutes()), ap=h<12?"a":"p"; h=h%12; if(h===0)h=12; return h+":"+mm+ap; }
const toneC = t => t==="good"?"var(--green)":t==="warn"?"var(--amber)":t==="bad"?"var(--red)":"var(--ink)";
const FIT = { yes:{word:"fits", tone:"good"}, partly:{word:"partly", tone:"warn"}, no:{word:"miss", tone:"bad"} };
const MEALS = ["breakfast","lunch","dinner","snack","on the bike"];

/* ---- pieces shared with the front page ---- */
function fitBadge(a){ const f = FIT[a && a.fits] || FIT.partly; return `<span class="fit" style="color:${toneC(f.tone)};border-color:${toneC(f.tone)}">${f.word}</span>`; }
function targetsRow(t){
  if (!t) return "";
  return `<div class="macros"><div class="fuelrow"><span class="mfuel">${esc(t.fuel_day||"")}</span><span class="fkcal"><b>${t.kcal}</b> kcal</span></div>
      <div class="mgrid"><div class="mc c"><b>${t.carbs_g}</b><span>carbs g</span></div><div class="mc p"><b>${t.protein_g}</b><span>protein g</span></div><div class="mc f"><b>${t.fat_g}</b><span>fat g</span></div></div></div>`;
}
function checksList(checks){
  if (!checks || !checks.length) return "";
  return `<ul class="checks">${checks.map(c=>`<li class="${c.ok?"ok":"miss"}"><span class="mark">${c.ok?"✓":"✗"}</span>
    <span class="n">${esc(c.label)}</span><span class="small">${esc(c.detail||"")}</span></li>`).join("")}</ul>`;
}
function thumbStrip(entries){
  if (!entries || !entries.length) return `<div class="small">No photos yet today.</div>`;
  return `<div class="thumbstrip">${entries.map(e=>{
    const f = FIT[e.assessment && e.assessment.fits] || FIT.partly;
    const img = e.thumb ? `<img src="data:image/jpeg;base64,${e.thumb}" alt="">` : `<span class="nothumb">${e.written ? "✎" : esc((e.name||"?").slice(0,2))}</span>`;
    return `<a class="thumb" href="#food" title="${esc(e.name)}" style="border-color:${toneC(f.tone)}">${img}<span class="small">${esc(clock(e.at))}</span></a>`;
  }).join("")}</div>`;
}
function microHTML(m, day){
  if (!m) return `<div class="small">Starts with the first meal.</div>`;
  const bar = p => `<li><span class="n">${esc(p.label)}<span class="small"> ${p.value} of ${p.target} ${esc(p.unit)}</span></span>
    <span class="tag"><span class="mbar"><i style="width:${p.pct}%;background:${p.pct>=80?"var(--green)":p.pct>=50?"var(--amber)":"var(--red)"}"></i></span><b>${p.pct}</b></span></li>`;
  const sg = m.suggest || {};
  const foods = (sg.foods||[]).map(f=>`<li><span class="n">${esc(f.name)}<span class="small"> ${f.serving_g} g · ${f.kcal} kcal · ${esc((f.closes||[]).join(", "))}</span></span><span class="tag">${m.score} → <b>${f.score_after}</b></span></li>`).join("");
  const supps = (sg.supplements||[]).map(x=>`<li><span class="n">${esc(x.name)}<span class="small"> ${esc(x.note||"")}</span></span>
    <span class="tag">${m.score} → <b>${x.score_after}</b> <button class="linkish" data-supp="${esc(x.key)}">log</button></span></li>`).join("");
  return `<div class="recovery"><span class="recscore" style="color:${toneC(m.band.tone)}">${m.score}</span>
      <span class="recmeta"><span class="recword" style="color:${toneC(m.band.tone)}">${esc(m.band.word)}</span>
        <div class="small">${m.days_used} day${m.days_used===1?"":"s"} of photos${m.gaps&&m.gaps.length?` · low: ${esc(m.gaps.map(g=>g.label).join(", "))}`:""}</div></span></div>
    <ul class="agenda totals micros">${m.per.map(bar).join("")}</ul>
    ${foods?`<div class="small" style="margin-top:10px"><b>Eat</b></div><ul class="agenda totals">${foods}</ul>`:""}
    ${supps?`<div class="small" style="margin-top:10px"><b>Supplements</b></div><ul class="agenda totals">${supps}</ul>`:""}
    ${(m.supplements_available||[]).length?`<details class="ridenotes"><summary>log any supplement</summary><div class="supprow">${m.supplements_available.map(x=>`<button class="suppbtn" data-supp="${esc(x.key)}" title="${esc(x.note||"")}">${esc(x.name)}</button>`).join("")}</div>
      <div class="small">Iron: only with a ferritin result.</div></details>`:""}
    ${(sg.performance||[]).length?`<details class="ridenotes"><summary>Performance aids with real evidence (IOC)</summary><ul class="rules">${sg.performance.map(x=>`<li><b>${esc(x.name)}</b> — ${esc(x.note)}</li>`).join("")}</ul></details>`:""}`;
}
function wireMicro(root, onChange){
  root.querySelectorAll("[data-supp]").forEach(b => b.onclick = async ()=>{
    b.disabled = true; b.textContent = "logging…";
    try{ await bridge("/food/supplement",{method:"POST",headers:J,body:JSON.stringify({key:b.dataset.supp})}); if (onChange) await onChange(); }
    catch(e){ b.textContent = "failed — " + e.message; }
  });
}
window.foodBits = { fitBadge, targetsRow, checksList, thumbStrip, toneC, FIT, microHTML, wireMicro };

/* ---- the page ---- */
V.food = async function(){
  const p = params(), today = localToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date||"") ? p.date : today;
  const isToday = date === today;
  const go = k => { location.hash = k === today ? "#food" : "#food?date="+k; };
  view.innerHTML = `<span class="eyebrow">Food</span>
    <div class="pweekhead"><h2 class="ptitle">${isToday?"Today":esc(dayLabel(date))}</h2>
      <div class="pweeknav"><button id="fPrev" aria-label="Previous day">‹</button><button id="fToday">Today</button><button id="fNext" aria-label="Next day" ${isToday?"disabled":""}>›</button></div></div>
    ${isToday ? `<div class="card day snapcard" id="snap">
      <div class="snaprow"><button class="primary big snapbtn" id="snapBtn">Snap a meal</button><button class="big snapbtn" id="rollBtn">From camera roll</button></div>
      <input id="snapFile" type="file" accept="image/*" capture="environment" hidden>
      <input id="rollFile" type="file" accept="image/*" hidden>
      <div id="snapForm" hidden>
        <img id="snapPreview" class="snappreview" alt="">
        <div class="row2"><span><label>Meal</label><select id="snapMeal"><option value="">let the coach guess</option>${MEALS.map(m=>`<option>${m}</option>`).join("")}</select></span>
          <span><label>Note (optional)</label><input id="snapNote" placeholder="2 eggs, no toast"></span></div>
        <button class="primary" id="snapLog">Log it</button> <button id="snapCancel">Cancel</button>
        <div class="small" id="snapMsg"></div></div>
      <button id="writeBtn" class="writebtn">Write it instead</button>
      <div id="writeForm" hidden>
        <label for="writeText">What is on the plate, in your words</label>
        <textarea id="writeText" rows="3" placeholder="Rice bowl: jasmine rice 200 g, grilled salmon 150 g, edamame 80 g, kimchi, a soft egg, a splash of soy"></textarea>
        <div class="small">Add weights when you have them: "rice 200 g, salmon 150 g".</div>
        <div class="row2"><span><label>Meal</label><select id="writeMeal"><option value="">let the coach guess</option>${MEALS.map(m=>`<option>${m}</option>`).join("")}</select></span>
          <span><label>&nbsp;</label><button class="primary" id="writeLog">Log it</button> <button id="writeCancel">Cancel</button></span></div>
        <div class="small" id="writeMsg"></div></div>
      <div id="snapResult"></div>
    </div>` : ""}
    <div id="fDay"><div class="card"><div class="small">Loading the day…</div></div></div>`;
  document.getElementById("fPrev").onclick = ()=>go(keyAdd(date,-1));
  document.getElementById("fNext").onclick = ()=>{ if (!isToday) go(keyAdd(date,1)); };
  document.getElementById("fToday").onclick = ()=>go(today);

  let day = null;
  const draw = ()=>{
    const el = document.getElementById("fDay");
    if (!el) return;
    if (!day){ el.innerHTML = `<div class="card"><h4>Food</h4><div class="small">bridge unreachable</div></div>`; return; }
    const c = day.compliance, b = c.band;
    const m = c.macros && c.macros.per_macro;
    const macroRow = (label,key)=>{ const x = m && m[key]; if (!x) return "";
      return `<li><span class="n">${label}<span class="small"> ${x.actual} of ${x.target}${x.direction!=="on target"?` · ${esc(x.direction)} ${Math.abs(x.deviation_pct)}%`:""}</span></span>
        <span class="tag"><b style="color:${x.score>=90?"var(--green)":x.score>=70?"var(--amber)":"var(--red)"}">${x.score}</b></span></li>`; };
    const sessions = (day.sessions||[]).map(s=>`${esc(s.name)}${s.minutes?" · "+s.minutes+" min":""}${s.done?" · done":" · planned"}`).join("<br>");
    el.innerHTML = `
      <div class="card"><h4>${isToday?"Today's":"The day's"} guidelines</h4>
        ${targetsRow(day.target)}
        ${day.target.base_burn?`<details class="why"><summary>how the target is set</summary><div class="small">${day.target.base_burn} kcal before riding at ${day.target.kg} kg + ${day.target.ride_kcal} riding − ${Math.abs(day.target.deficit)} deficit · carbs ${day.target.per_kg.carbs} g/kg, protein ${day.target.per_kg.protein} g/kg${day.target.deficit_note?` · <b>${esc(day.target.deficit_note)}</b>`:""}</div></details>`:""}
        <div class="small">${sessions || "No training on the calendar, so a rest day."}</div>
        ${day.work ? `<div class="cue" style="border-color:${day.work.compliant?"var(--green)":"var(--amber)"};background:${day.work.compliant?"var(--green-soft)":"var(--amber-soft)"}"><b>From the ride:</b> ${esc(day.work.note)}</div>` : ""}
        <ul class="rules">${day.guidelines.map(g=>`<li>${esc(g.text)}</li>`).join("")}</ul>
        ${(day.ride_notes||[]).map(n=>`<details class="ridenotes"><summary>${esc(n.name)} · eating guidelines</summary><div class="ptext">${esc(n.notes)}</div></details>`).join("")}
      </div>
      <div class="card"><h4>${isToday?"Today's":"The day's"} meals · timed to the training</h4>
        ${day.cue ? `<div class="cue"><b>Now:</b> ${esc(day.cue.text)}</div>` : ""}
        <ul class="agenda mealplan">${(day.meals||[]).map(m=>{
          const logged = (m.logged||[]).length, now = nowHM();
          const mealOf = m.slot === "before" || m.slot === "after" ? "snack" : (MEALS.includes(m.slot) ? m.slot : "snack");
          const mark = logged ? `<span class="mk ok" title="logged">✓</span>` : (isToday && m.time < now) ? `<span class="mk no" title="nothing logged">✗</span>` : `<span class="mk"></span>`;
          return `<li class="${logged?"done":(isToday&&m.time<now?"past":"")}"><span class="t">${esc(hm12(m.time))}</span>
            <span class="n">${esc(m.slot)}<span class="small"> ${esc(m.what)}</span>${m.kcal?`<span class="small"> ~${m.kcal} kcal · ${m.carbs_g}C${m.protein_g?` · ${m.protein_g}P`:""}</span>`:""}</span>
            <span class="tag mealtag">${mark}${isToday?`<button class="cam" data-cam="${esc(mealOf)}" aria-label="Snap this meal"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg></button>`:""}</span></li>`; }).join("")}</ul>
      </div>
      <div class="card"><h4>Compliance</h4>
        <div class="recovery"><span class="recscore" style="color:${c.overall==null?"var(--muted)":toneC(b.tone)}">${c.overall==null?"—":c.overall}</span>
          <span class="recmeta"><span class="recword" style="color:${b?toneC(b.tone):"var(--muted)"}">${b?esc(b.word):"nothing logged"}</span>
            <div class="small">${c.guidelines.meals||0} photo${c.guidelines.meals===1?"":"s"}${c.guidelines.score!=null?` · guidelines ${c.guidelines.score}`:""}${c.macros&&c.macros.overall!=null&&c.guidelines.meals?` · macros ${c.macros.overall}`:""}</div></span></div>
        ${checksList(c.guidelines.checks)}
        ${m ? `<ul class="agenda totals">${macroRow("carbs","carbs_g")}${macroRow("protein","protein_g")}${macroRow("fat","fat_g")}${macroRow("kcal","kcal")}</ul>` : ""}
        ${day.suggestion && !day.suggestion.none ? `<div class="snack"><b>Suggested next</b> — ${esc(day.suggestion.name)}${day.suggestion.servings>1?` ×${day.suggestion.servings}`:""}
          <div class="small">${day.suggestion.kcal} kcal · ${day.suggestion.carbs_g}C · ${day.suggestion.protein_g}P · ${day.suggestion.fat_g}F — ${esc(day.suggestion.why)}, score ${day.suggestion.score_before} → <b>${day.suggestion.score_after}</b></div></div>` : ""}
      </div>
      <div class="card" id="fMicro"><h4>Micronutrients · three days</h4>${microHTML(day.micros, day)}</div>
      <span class="eyebrow">The journal · ${(n=>`${n} ${n===1?"meal":"meals"}`)(day.entries.filter(e=>!e.supplement&&!e.drink_only).length)}${day.entries.some(e=>e.drink_only)?` · ${day.entries.filter(e=>e.drink_only).length} drink${day.entries.filter(e=>e.drink_only).length===1?"":"s"}`:""}</span>
      <div class="journal">${day.entries.length ? day.entries.slice().reverse().map(entryHTML).join("") : `<div class="card"><div class="small">${isToday?"Nothing yet. Snap the first meal.":"No photos that day."}</div></div>`}</div>`;
    wireMicro(el, async ()=>{ await load(); });
    el.querySelectorAll(".jentry").forEach(n => n.onclick = (ev)=>{ if (ev.target.closest("button,input,select,form")) return; n.classList.toggle("open"); });
    el.querySelectorAll("[data-merge]").forEach(btn => btn.onclick = async ()=>{
      // the entry logged just before this one, by time
      const meals = day.entries.filter(x => !x.supplement).slice().sort((a,b)=>String(a.time).localeCompare(String(b.time)));
      const i = meals.findIndex(x => x.id === btn.dataset.merge);
      if (i < 1) { alert("Nothing logged before this one."); return; }
      const prev = meals[i-1], cur = meals[i];
      const text = prompt(`Combine "${prev.name}" and "${cur.name}" into one meal.\nDescribe the whole plate to have it read again (add anything the photos missed), or leave blank to just add them up:`, "");
      if (text == null) return;
      btn.disabled = true;
      try{ await bridge("/food/merge",{method:"POST",headers:J,body:JSON.stringify({ ids:[prev.id, cur.id], date, text: text.trim() || undefined, meal: prev.meal })}); day = await bridge(`/food/day?date=${date}`); draw(); }
      catch(err){ alert(err.message); btn.disabled = false; }
    });
    el.querySelectorAll("[data-del]").forEach(btn => btn.onclick = async ()=>{
      if (!confirm("Remove this from the journal?")) return;
      try{ const r = await bridge(`/food/${encodeURIComponent(btn.dataset.del)}?date=${date}`,{method:"DELETE"}); day = r.day; draw(); }
      catch(e){ btn.textContent = "failed — " + e.message; }
    });
    el.querySelectorAll("[data-fix]").forEach(btn => btn.onclick = async ()=>{
      const id = btn.dataset.fix, box = btn.closest(".jfix");
      const body = { date, name: box.querySelector(".fxName").value, meal: box.querySelector(".fxMeal").value,
        kcal: +box.querySelector(".fxK").value, carbs_g: +box.querySelector(".fxC").value, protein_g: +box.querySelector(".fxP").value, fat_g: +box.querySelector(".fxF").value,
        fits: box.querySelector(".fxFit").value };
      try{ const r = await bridge(`/food/${encodeURIComponent(id)}`,{method:"PUT",headers:J,body:JSON.stringify(body)}); day = r.day; draw(); }
      catch(e){ btn.textContent = "failed — " + e.message; }
    });
  };
  const entryHTML = (e)=>{
    if (e.supplement) return `<div class="card jentry supp"><div class="jrow"><span class="jthumb nothumb">Rx</span>
      <div class="jbody"><div class="small">${esc(e.time?hm12(e.time):clock(e.at))} · supplement</div><div class="jname">${esc(e.name)}</div><div class="small">${esc(e.notes||"")}</div></div>
      <div class="jfit"><button class="jdel" data-del="${esc(e.id)}" aria-label="Remove">${window.TRASH||"×"}</button></div></div></div>`;
    const a = e.assessment || {};
    const img = e.thumb ? `<img class="jthumb" src="data:image/jpeg;base64,${e.thumb}" alt="">` : `<span class="jthumb nothumb">${e.written ? "✎" : esc((e.name||"?").slice(0,2))}</span>`;
    return `<div class="card jentry">
      <div class="jrow">${img}
        <div class="jbody"><div class="small">${esc(e.time?hm12(e.time):clock(e.at))} · ${e.drink_only?"drink":esc(e.meal)}${!e.drink_only&&e.slot&&e.slot!==e.meal?` · ${esc(e.slot)} slot`:""}${e.corrected?" · corrected":""}</div>
          <div class="jname">${esc(e.name)}</div>
          <div class="small">${e.kcal} kcal · ${e.carbs_g}C · ${e.protein_g}P · ${e.fat_g}F${e.fluid_ml?` · ${e.fluid_ml} ml ${esc(e.drink||"fluid")}`:""}${e.drink_only?"":`${e.confidence&&e.confidence!=="high"?` · ${esc(e.confidence)} confidence`:""}${e.written?" · written":e.notes?"":" · photo only, ±35%"}`}</div></div>
        <div class="jfit">${fitBadge(a)}<button class="jdel" data-del="${esc(e.id)}" aria-label="Remove">${window.TRASH||"×"}</button></div></div>
      <div class="small jwhy">${esc(a.why||"")}</div>
      <div class="jmore">
        ${e.written?`<div class="small">You wrote: “${esc(e.written)}”</div>`:""}
        ${e.portion?`<div class="small">Portion: ${esc(e.portion)}</div>`:""}
        <div class="small">${a.protein_source?"protein ✓":"no real protein"} · carbs ${esc(a.carbs||"?")} · ${a.vegetables?"vegetables or fruit ✓":"no vegetables"}${a.processed?" · ultra-processed":""}</div>
        ${isToday?`<div class="jfix">
          <div class="row2"><span><label>Name</label><input class="fxName" value="${esc(e.name)}"></span>
            <span><label>Meal</label><select class="fxMeal">${MEALS.map(m=>`<option ${m===e.meal?"selected":""}>${m}</option>`).join("")}</select></span></div>
          <div class="row2"><span><label>kcal</label><input class="fxK" type="number" value="${e.kcal}"></span><span><label>carbs g</label><input class="fxC" type="number" value="${e.carbs_g}"></span></div>
          <div class="row2"><span><label>protein g</label><input class="fxP" type="number" value="${e.protein_g}"></span><span><label>fat g</label><input class="fxF" type="number" value="${e.fat_g}"></span></div>
          <label>Fit</label><select class="fxFit">${["yes","partly","no"].map(f=>`<option ${f===a.fits?"selected":""}>${f}</option>`).join("")}</select>
          <button data-fix="${esc(e.id)}">Save correction</button> <button data-merge="${esc(e.id)}">Combine with previous</button> <button class="pdanger" data-del="${esc(e.id)}">Remove</button></div>`:""}
      </div></div>`;
  };

  const load = async ()=>{
    try{ day = await bridge(isToday ? "/food/today" : "/food/day?date="+date); }
    catch(e){ day = null; }
    if (location.hash.split("?")[0] !== "#food") return;
    draw();
  };
  load();

  /* ---- the camera ---- */
  if (!isToday) return;
  // Two ways in: the camera (capture forces it on a phone) and the camera
  // roll (no capture, so the phone offers the library). Same form after.
  const fileEl = document.getElementById("snapFile"), rollEl = document.getElementById("rollFile"), form = document.getElementById("snapForm");
  let file = null;
  document.getElementById("snapBtn").onclick = ()=> fileEl.click();
  document.querySelectorAll("[data-cam]").forEach(b => b.onclick = ()=>{
    const sel = document.getElementById("snapMeal"); if (sel) sel.value = b.dataset.cam;
    const w = document.getElementById("writeMeal"); if (w) w.value = b.dataset.cam;
    fileEl.click();
  });
  // opened from the day page with a meal in hand: preselect it and bring the camera up
  const want = params().snap;
  if (want && MEALS.includes(want)){
    const sel = document.getElementById("snapMeal"); if (sel) sel.value = want;
    const w = document.getElementById("writeMeal"); if (w) w.value = want;
    document.getElementById("snap").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("snapBtn").classList.add("pulse");
  }
  document.getElementById("rollBtn").onclick = ()=> rollEl.click();
  const picked = (el)=>{
    file = el.files && el.files[0];
    if (!file) return;
    document.getElementById("snapPreview").src = URL.createObjectURL(file);
    document.getElementById("snapResult").innerHTML = "";
    form.hidden = false;
  };
  fileEl.onchange = ()=> picked(fileEl);
  rollEl.onchange = ()=> picked(rollEl);
  document.getElementById("snapCancel").onclick = ()=>{ form.hidden = true; file = null; fileEl.value = ""; rollEl.value = ""; };
  const showVerdict = (e)=>{
    const a = e.assessment;
    document.getElementById("snapResult").innerHTML = `<div class="verdict" style="border-color:${toneC((FIT[a.fits]||FIT.partly).tone)}">
      <div class="jname">${esc(e.name)} ${fitBadge(a)}</div>
      <div class="small">${esc(e.meal)} · ${e.kcal} kcal · ${e.carbs_g}C · ${e.protein_g}P · ${e.fat_g}F${e.portion?` · ${esc(e.portion)}`:""}</div>
      <div>${esc(a.why)}</div></div>`;
  };
  const wform = document.getElementById("writeForm");
  document.getElementById("writeBtn").onclick = ()=>{ wform.hidden = !wform.hidden; if (!wform.hidden){ form.hidden = true; document.getElementById("writeText").focus(); } };
  document.getElementById("writeCancel").onclick = ()=>{ wform.hidden = true; };
  document.getElementById("writeLog").onclick = async ()=>{
    const text = document.getElementById("writeText").value.trim();
    if (!text) return;
    const msg = document.getElementById("writeMsg"), btn = document.getElementById("writeLog");
    btn.disabled = true; msg.textContent = "Reading it…";
    try{
      const r = await bridge("/food/text",{method:"POST",headers:J,body:JSON.stringify({ text, meal: document.getElementById("writeMeal").value || undefined })});
      showVerdict(r.entry);
      wform.hidden = true; msg.textContent = ""; document.getElementById("writeText").value = ""; document.getElementById("writeMeal").value = "";
      day = r.day; draw();
    }catch(e){ msg.textContent = "Couldn't log it — " + e.message; }
    finally{ btn.disabled = false; }
  };
  document.getElementById("snapLog").onclick = async ()=>{
    if (!file) return;
    const msg = document.getElementById("snapMsg"), btn = document.getElementById("snapLog");
    btn.disabled = true; msg.textContent = "Reading the plate…";
    try{
      const [image_base64, thumb_base64] = await Promise.all([fileToBase64(file, 1280, 0.75), fileToBase64(file, 240, 0.6)]);
      const r = await bridge("/food/photo",{method:"POST",headers:J,body:JSON.stringify({
        images:[{image_base64, media_type:"image/jpeg"}], thumb_base64,
        meal: document.getElementById("snapMeal").value || undefined,
        notes: document.getElementById("snapNote").value || undefined })});
      showVerdict(r.entry);
      form.hidden = true; file = null; fileEl.value = ""; rollEl.value = ""; msg.textContent = "";
      document.getElementById("snapNote").value = ""; document.getElementById("snapMeal").value = "";
      day = r.day; draw();
    }catch(e){ msg.textContent = "Couldn't log it — " + e.message; }
    finally{ btn.disabled = false; }
  };
};

// app.js ran nav() before this file loaded; if the page opened on #food, draw it now.
if (location.hash.replace(/^#/, "").split("?")[0] === "food") nav();
})();
