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
/* ---- the day curve: one drawing for live fuel and live hydration ----
   One series, so no legend; the fill under the line carries the status
   colour (green, amber, red, blue for over) and the words sit in text ink.
   The past is drawn solid from what was logged, the hours ahead dashed from
   the plan. Sessions are shaded bands; logged meals and drinks are filled
   dots, planned ones hollow. A faint band is the model's own uncertainty; a
   thinner second line is the legs (muscle store). Tap or drag to read a time. */
function curveSVG(o){
  const W = 340, H = 150, L = 8, R = 8, T = 10, B = 24;
  const S = o.series, m0 = S[0].m, m1 = S[S.length-1].m;
  const X = m => L + (m - m0) / (m1 - m0) * (W - L - R);
  const Y = v => T + (1 - (Math.max(o.lo, Math.min(o.hi, v)) - o.lo) / (o.hi - o.lo)) * (H - T - B);
  const val = o.val, y0 = Y(o.baseline || 0);
  let fills = "", lines = "", run = null;
  const flush = ()=>{ if (!run) return; const pts = run.pts; const d = `M${X(pts[0].m).toFixed(1)},${y0.toFixed(1)} ` + pts.map(p=>`L${X(p.m).toFixed(1)},${Y(val(p)).toFixed(1)}`).join(" ") + ` L${X(pts[pts.length-1].m).toFixed(1)},${y0.toFixed(1)} Z`; fills += `<path d="${d}" fill="${run.col}" opacity="${run.proj?0.45:0.85}"></path>`; run = null; };
  S.forEach((p, i) => {
    const c = o.col(p);
    if (!run || run.col !== c || run.proj !== p.projected){ const prev = S[i-1]; flush(); run = { col: c, proj: p.projected, pts: prev ? [prev] : [] }; }
    run.pts.push(p);
  });
  flush();
  const path = (pts, f) => pts.map((p,i)=>(i?"L":"M")+X(p.m).toFixed(1)+","+Y(f(p)).toFixed(1)).join(" ");
  let band = "";
  if (o.band){ const up = S.map(p=>`${X(p.m).toFixed(1)},${Y(o.band(p)[1]).toFixed(1)}`), dn = S.slice().reverse().map(p=>`${X(p.m).toFixed(1)},${Y(o.band(p)[0]).toFixed(1)}`); band = `<polygon points="${up.concat(dn).join(" ")}" fill="#F2F1EC" opacity=".10"></polygon>`; }
  const past = S.filter(p => !p.projected), fut = S.filter((p, i) => p.projected || (S[i+1] && S[i+1].projected));
  if (past.length) lines += `<path d="${path(past, val)}" fill="none" stroke="#F2F1EC" stroke-width="2"></path>`;
  if (fut.length) lines += `<path d="${path(fut, val)}" fill="none" stroke="#F2F1EC" stroke-width="2" stroke-dasharray="4 4" opacity=".8"></path>`;
  if (o.extra){ const pp = past.filter(p=>o.extra(p)!=null), ff = fut.filter(p=>o.extra(p)!=null); if (pp.length) lines += `<path d="${path(pp, o.extra)}" fill="none" stroke="#F2F1EC" stroke-width="1" opacity=".6"></path>`; if (ff.length) lines += `<path d="${path(ff, o.extra)}" fill="none" stroke="#F2F1EC" stroke-width="1" stroke-dasharray="3 3" opacity=".5"></path>`; }
  const bands = (o.sessions||[]).map(s => `<rect x="${X(s.min).toFixed(1)}" y="${T}" width="${Math.max(2, X(s.end_min)-X(s.min)).toFixed(1)}" height="${H-T-B}" fill="${s.col||"#F2F1EC"}" opacity="${s.col?".22":".12"}"></rect><text x="${(X(s.min)+2).toFixed(1)}" y="${T+10}" class="egl">${esc((s.name||"").replace(/,.*$/,"").slice(0,14))}</text>`).join("");
  const dots = (o.dots||[]).map(d => `<circle cx="${X(d.min).toFixed(1)}" cy="${Y(d.val).toFixed(1)}" r="4.5" fill="${d.filled?"#F2F1EC":"#0F100E"}" stroke="#F2F1EC" stroke-width="2"><title>${esc(d.title||"")}</title></circle>`).join("");
  const ticks = [6,9,12,15,18,21].map(h => `<text x="${X(h*60).toFixed(1)}" y="${H-6}" class="egt" text-anchor="middle">${h%12||12}${h<12?"a":"p"}</text>`).join("");
  const guides = (o.guides||[]).map(v => `<line x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#F2F1EC" opacity="${v===(o.baseline||0)&&o.baselineStrong?".4":".15"}" stroke-dasharray="${v===(o.baseline||0)&&o.baselineStrong?"":"2 4"}"></line>`).join("");
  const nowLine = o.nowMin != null ? `<line x1="${X(o.nowMin).toFixed(1)}" x2="${X(o.nowMin).toFixed(1)}" y1="${T}" y2="${H-B}" stroke="#F2F1EC" stroke-width="1.5"></line>` : "";
  return { svg: `<svg viewBox="0 0 ${W} ${H}" class="egsvg" preserveAspectRatio="none">${guides}${bands}${band}${fills}${lines}${nowLine}${dots}${ticks}</svg>`, m0, m1 };
}
function wireCurve(box, series, read){
  if (!box) return;
  const svg = box.querySelector(".egsvg"), out = box.querySelector(".egread");
  const m0 = +box.dataset.m0, m1 = +box.dataset.m1;
  const go = (ev)=>{
    const r = svg.getBoundingClientRect(); const x = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const m = m0 + Math.max(0, Math.min(1, (x - 8/340*r.width) / (r.width * (1 - 16/340)))) * (m1 - m0);
    const p = series.reduce((a, q) => Math.abs(q.m - m) < Math.abs(a.m - m) ? q : a);
    out.textContent = read(p);
  };
  svg.addEventListener("pointerdown", go); svg.addEventListener("pointermove", ev => { if (ev.buttons || ev.pointerType === "touch") go(ev); });
  svg.addEventListener("touchstart", go, { passive: true }); svg.addEventListener("touchmove", go, { passive: true });
}
const fuelCol = pct => pct >= 60 ? "#2E7D4A" : pct >= 35 ? "#8A6A14" : "#7A2E26";
const fuelColL = pct => pct >= 60 ? "var(--green)" : pct >= 35 ? "var(--amber)" : "var(--red)";
const verdictCol = key => key === "green" ? "var(--green)" : key === "yellow" ? "var(--amber)" : key === "blue" ? "#5B8DEF" : "var(--red)";
function energyHTML(e){
  if (!e || !e.series || !e.series.length) return `<div class="small">Starts with the first meal.</div>`;
  const nowMin = e.now ? (e.series.find(p=>p.t===e.now.time)||{}).m : null;
  const c = curveSVG({ series: e.series, val: p=>p.pct, lo: 0, hi: 100, col: p=>fuelCol(p.pct),
    band: e.series[0].lo != null ? (p=>[p.lo, p.hi]) : null, extra: e.series[0].legs_pct != null ? (p=>p.legs_pct) : null,
    sessions: (e.sessions||[]).map(s => ({ min: s.min, end_min: s.end_min, name: s.name, col: s.band ? fuelCol(s.band.key==="green"?100:s.band.key==="yellow"?50:0) : null })),
    dots: (e.meals||[]).map(m => { const p = e.series.find(x => x.m >= m.min) || e.series[e.series.length-1]; return { min: m.min, val: p.pct, filled: m.logged && (m.carbs_g > 0 || !m.protein_only), title: `${hm12(m.time)} ${m.name||""} ${m.carbs_g} g carbs${m.protein_g?`, ${m.protein_g} g protein`:""}` }; }),
    nowMin, guides: [35,60] });
  const ses = (e.sessions||[]).map(s => `<span class="egs"><b style="color:${fuelColL(s.pct)}">${s.pct}%</b> at ${esc(hm12(s.time))} ${esc(s.name)}${s.legs_pct!=null?` <span class="small">· legs ${s.legs_pct}%</span>`:""}${s.slid_from?` <span class="small">· planned ${esc(hm12(s.slid_from))}, not started, so moved to now</span>`:""}</span>`).join(" · ");
  return `<div class="energy" data-m0="${c.m0}" data-m1="${c.m1}">
    <div class="egline"><span class="egnow"><b style="color:${fuelColL(e.now.pct)}">${e.now.pct}%</b> fuel now${e.now.legs_pct!=null?` <span class="small">· legs ${e.now.legs_pct}%</span>`:""}</span>${e.peak?`<span class="small">peak ${esc(hm12(e.peak.time))} · ${e.peak.pct}%</span>`:""}</div>
    ${c.svg}
    <div class="small egread"></div>
    ${ses?`<div class="small">${ses}</div>`:""}
    ${e.advice?`<div class="egadvice">${esc(e.advice)}</div>`:""}
    ${e.legs_tap?legsTapHTML(e.legs_tap):""}
    <details class="why"><summary>what it counts</summary><div class="small">Two stores. The line is the quick store, liver and blood, what a hard effort runs on and what bonking empties: about 110 g full, half that after a night's sleep. The thin line is the legs, muscle glycogen, which only a ride drains and only a day refills; it carries over from yesterday. Each meal's carbs arrive as the stomach empties, slower with fat and protein; protein adds about a sixth of its weight as glucose over the afternoon, so a salmon dinner is a hollow dot and a small slow rise. On the bike a quarter of the carbohydrate burned comes from the quick store, the rest from the legs; carbs eaten on the bike count up to 60 g an hour, 90 with Tailwind. The faint band is the model's own uncertainty. Fat is not drawn: it is the fuel Zone 1 burns, which is why Zone 1 needs only a quarter of a tank.</div></details>
  </div>`;
}
function legsTapHTML(t){
  if (!t) return "";
  if (t.rated) return `<div class="small legstap">Legs on ${esc(t.name.replace(/,.*$/,""))}: <b>${t.rated} of 5</b>${t.tuned?" · fuel model tuned to your rides":""}</div>`;
  return `<div class="legstap"><span class="small">How did the legs feel on ${esc(t.name.replace(/,.*$/,""))}?</span> ${[1,2,3,4,5].map(n=>`<button class="suppbtn" data-legs="${n}" data-ride="${esc(t.key)}">${n}</button>`).join("")}</div>`;
}
function wireEnergy(root, e, onChange){
  const box = root.querySelector(".energy"); if (!box || !e) return;
  wireCurve(box, e.series, p => `${hm12(p.t)} · ${p.pct}% · about ${p.g} g on board${p.legs_pct!=null?` · legs ${p.legs_pct}%`:""}${p.projected ? " (projected)" : ""}`);
  box.querySelectorAll("[data-legs]").forEach(b => b.onclick = async ()=>{
    b.disabled = true;
    try{ await bridge("/fuel/legs",{method:"POST",headers:J,body:JSON.stringify({ key: b.dataset.ride, legs: +b.dataset.legs })}); if (onChange) await onChange(); }
    catch(err){ b.textContent = "✗"; }
  });
}
function hydrationHTML(h){
  if (!h || !h.series || !h.series.length) return `<div class="small">Starts with the first drink.</div>`;
  const kg = h.kg || 98, lo = -kg * 25, hi = kg * 10;   // 2.5% down to 1% up
  const nowMin = h.now ? (h.series.find(p=>p.t===h.now.time)||{}).m : null;
  const colOf = p => p.band === "green" ? "#2E7D4A" : p.band === "yellow" ? "#8A6A14" : p.band === "blue" ? "#2F4F8F" : "#7A2E26";
  const c = curveSVG({ series: h.series, val: p=>p.ml, lo, hi, baseline: 0, baselineStrong: true, col: colOf,
    sessions: (h.sessions||[]).map(s => ({ min: h.series.find(p=>p.t===s.time) ? h.series.find(p=>p.t===s.time).m : (+s.time.slice(0,2))*60+(+s.time.slice(3,5)), end_min: s.end_min, name: s.name })),
    dots: (h.drinks||[]).map(d => { const p = h.series.find(x => x.m >= d.min + 10) || h.series[h.series.length-1]; return { min: d.min, val: p.ml, filled: true, title: `${hm12(d.time)} ${d.name} ${d.ml} ml` }; }),
    nowMin, guides: [0, -kg*10, -kg*20] });
  const nb = h.now.band, nowTxt = h.now.ml > 300 ? `+${(h.now.ml/1000).toFixed(1)} L` : `${h.now.ml < 0 ? "−" : ""}${(Math.abs(h.now.ml)/1000).toFixed(1)} L`;
  const ses = (h.sessions||[]).map(s => `<span class="egs"><b>${(s.sweat_ml_h/1000).toFixed(1)} L/h</b> ${esc(s.name.replace(/,.*$/,""))}${s.indoor?"":s.temp_f?` · ${s.temp_f}°F`:""}</span>`).join(" · ");
  return `<div class="energy hyd" data-m0="${c.m0}" data-m1="${c.m1}">
    <div class="egline"><span class="egnow"><b style="color:${verdictCol(nb.key)}">${nowTxt}</b> <span class="small">${esc(nb.word)}</span></span><span class="small">${(h.drunk_ml/1000).toFixed(1)} of ${(h.target_ml/1000).toFixed(1)} L drunk</span></div>
    ${h.start_ml <= -300 ? `<div class="small">Woke ${(Math.abs(h.start_ml)/1000).toFixed(1)} L down${h.carried && h.carried.from === "scale" ? ", by the scale" : h.carried && h.carried.from === "both" ? ", by yesterday and the scale" : ", carried from yesterday"}.</div>` : ""}
    ${c.svg}
    <div class="small egread"></div>
    ${ses?`<div class="small">${ses}</div>`:""}
    ${h.advice?`<div class="egadvice" style="border-color:${verdictCol(nb.key)}">${esc(h.advice)}</div>`:""}
    ${h.weigh?`<div class="small">Scale: ${h.weigh.pre_lb.toFixed(1)} → ${h.weigh.post_lb.toFixed(1)} lb around the ride, ${(h.weigh.lost_ml/1000).toFixed(1)} L lost${h.weigh.modelled_ml?` (the model said ${(h.weigh.modelled_ml/1000).toFixed(1)})`:""}.</div>`:""}
    <details class="why"><summary>what it counts</summary><div class="small">Water against the start of the day, which is yesterday's end less the night (a deficit carried to bed is still there at breakfast; a surplus is not), averaged with the scale when it has a morning reading against the last three days. It drifts down about 100 ml an hour awake (breath, skin, urine), half that asleep; each drink arrives as the stomach empties, most of it within 45 minutes; food brings its own water. A ride takes sweat at the rate the power, the air and the weather give: the fan on the trainer, the wind and the temperature on the road. Water drunk after a ride is kept at 70%, 90% when it carries salt. Under 1% of body weight down is fine, 1 to 2% costs endurance, over 2% is dry; blue is more than the morning, which after a long ride is the dangerous side.${h.calibration&&h.calibration.points?` Tuned by ${h.calibration.points} post-ride weigh-in${h.calibration.points===1?"":"s"} (×${h.calibration.k}).`:" Weigh in after a ride and it tunes itself to you."}</div></details>
  </div>`;
}
function wireHydration(root, h){
  const box = root.querySelector(".energy.hyd"); if (!box || !h) return;
  wireCurve(box, h.series, p => `${hm12(p.t)} · ${p.ml > 0 ? "+" : "−"}${(Math.abs(p.ml)/1000).toFixed(2)} L (${p.pct}% of body weight)${p.projected ? " (projected)" : ""}`);
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
window.foodBits = { fitBadge, targetsRow, checksList, thumbStrip, toneC, FIT, microHTML, wireMicro, energyHTML, wireEnergy, hydrationHTML, wireHydration, curveSVG, wireCurve };

/* ---- the page ---- */
/* ---- Live: fuel and hydration, their own tab ----
   The two curves of the day, from the same report the Food page reads, with
   the day stepper so a past day can be looked at. The Food page keeps the
   plan, the compliance and the journal. */
V.live = async function(){
  const p = params(), today = localToday();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date||"") ? p.date : today;
  const isToday = date === today;
  const go = k => { location.hash = k === today ? "#live" : "#live?date="+k; };
  view.innerHTML = `<span class="eyebrow">Live</span>
    <div class="pweekhead"><h2 class="ptitle">${isToday?"Today":esc(dayLabel(date))}</h2>
      <div class="pweeknav"><button id="lPrev" aria-label="Previous day">‹</button><button id="lToday">Today</button><button id="lNext" aria-label="Next day" ${isToday?"disabled":""}>›</button></div></div>
    <div id="lDay"><div class="card"><div class="small">reaching the bridge…</div></div></div>`;
  document.getElementById("lPrev").onclick = ()=> go(keyAdd(date,-1));
  document.getElementById("lToday").onclick = ()=> go(today);
  document.getElementById("lNext").onclick = ()=>{ if (!isToday) go(keyAdd(date,1)); };
  const load = async ()=>{
    let day = null;
    try{ day = await bridge(isToday ? "/food/today" : "/food/day?date="+date); }catch(e){ day = null; }
    if (location.hash.split("?")[0] !== "#live") return;
    const el = document.getElementById("lDay"); if (!el) return;
    if (!day){ el.innerHTML = `<div class="card"><div class="small">bridge unreachable</div></div>`; return; }
    el.innerHTML = `
      <div class="card" id="fEnergy"><h4>Live fuel${isToday?"":" · that day"}</h4>${energyHTML(day.energy)}</div>
      <div class="card" id="fHydration"><h4>Live hydration${isToday?"":" · that day"}</h4>${hydrationHTML(day.hydration)}</div>
      <div class="rowbtns"><a class="btn" href="${isToday?"#food":"#food?date="+date}">The food log</a>${isToday?`<a class="btn" href="#food?snap=snack">Snap a meal or a drink</a>`:""}</div>`;
    wireEnergy(el, day.energy, async ()=>{ await load(); });
    wireHydration(el, day.hydration);
  };
  load();
};

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
      <div class="advisor">
        <div class="snaprow"><button class="big snapbtn" id="adviseBtn">What's in front of me</button><button class="big snapbtn" id="nearBtn">Find food near me</button></div>
        <input id="adviseFile" type="file" accept="image/*" capture="environment" hidden>
        <div class="small adhint">A shelf, a cooler, a menu or a counter: it says what to pick for what the plan wants next. Near me finds places within a short walk and names the order.</div>
        <div id="adviseOut"></div>
      </div>
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
  // (the live fuel card is drawn inside the day, first thing)
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
      <a class="btn" href="${isToday?"#live":"#live?date="+date}">Live fuel and hydration</a>
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
          const mt = logged && m.match ? m.match : null;
          return `<li class="${logged?"done":(isToday&&m.time<now?"past":"")}${mt?` match ${mt.key}`:""}"><span class="t">${esc(hm12(m.time))}</span>
            <span class="n">${esc(m.slot)}<span class="small"> ${esc(m.what)}</span>${m.kcal?`<span class="small"> ~${m.kcal} kcal · ${m.carbs_g}C${m.protein_g?` · ${m.protein_g}P`:""}</span>`:""}${mt?`<span class="small mword"> ${mt.kcal} kcal · ${mt.carbs_g}C${mt.protein_g?` · ${mt.protein_g}P`:""} · ${esc(mt.word)}</span>`:""}</span>
            <span class="tag mealtag">${mark}${isToday?`<button class="cam" data-cam="${esc(mealOf)}" aria-label="Snap this meal"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg></button>`:""}</span></li>`; }).join("")}</ul>
      </div>
      <div class="card"><h4>Compliance</h4>
        <div class="recovery"><span class="recscore" style="color:${c.overall==null?"var(--muted)":toneC(b.tone)}">${c.overall==null?"—":c.overall}</span>
          <span class="recmeta"><span class="recword" style="color:${b?toneC(b.tone):"var(--muted)"}">${b?esc(b.word):"nothing logged"}</span>
            <div class="small">${c.guidelines.meals||0} photo${c.guidelines.meals===1?"":"s"}${c.guidelines.score!=null?` · guidelines ${c.guidelines.score}`:""}${c.macros&&c.macros.overall!=null&&c.guidelines.meals?` · macros ${c.macros.overall}`:""}</div></span></div>
        ${checksList(c.guidelines.checks)}
        ${m ? `<ul class="agenda totals">${macroRow("carbs","carbs_g")}${macroRow("protein","protein_g")}${macroRow("fat","fat_g")}${macroRow("kcal","kcal")}</ul>` : ""}
        ${day.suggestion && !day.suggestion.none ? `<div class="snack"><b>Next on the plan</b> — ${esc(day.suggestion.name)}
          <div class="small">${esc(day.suggestion.what||"")}</div>
          <div class="small">~${day.suggestion.kcal} kcal · ${day.suggestion.low_carb?"under ":""}${day.suggestion.carbs_g}C · ${day.suggestion.protein_g}P${day.suggestion.score_after!=null?` — compliance ${day.suggestion.score_before??"—"} → <b>${day.suggestion.score_after}</b>`:""}</div>
          ${isToday?`<button class="cam snackcam" data-cam="${esc(day.suggestion.snap||"snack")}">Snap it</button>`:""}</div>` : ""}
      </div>
      <div class="card" id="fMicro"><h4>Micronutrients · this week</h4>${microHTML(day.micros, day)}</div>
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
  // the camera buttons beside each meal and on the suggestion are drawn after
  // the day loads, so the click is caught on the page, not wired per button
  view.addEventListener("click", (ev)=>{
    const b = ev.target.closest("[data-cam]"); if (!b || !view.contains(b)) return;
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
  /* ---- the advisor: what is in front of him, or what is near him ---- */
  const adviseFile = document.getElementById("adviseFile"), adviseOut = document.getElementById("adviseOut");
  const fitTone = f => f === "yes" ? "var(--green)" : f === "partly" ? "var(--amber)" : "var(--red)";
  const renderAdvice = (r, places)=>{
    const items = (r.items||[]).slice().sort((a,b)=>["yes","partly","no"].indexOf(a.fits)-["yes","partly","no"].indexOf(b.fits));
    const pickName = r.pick && r.pick.name;
    adviseOut.innerHTML = `
      ${r.reply ? `<div class="verdict" style="border-color:${pickName?"var(--green)":"var(--amber)"}"><div>${esc(r.reply)}</div></div>` : ""}
      ${r.place ? `<div class="small adplace"><b>${esc(r.place.name)}</b> · ${esc(r.place.kind)} · ${r.place.dist_m} m · <a href="${esc(r.place.directions)}" target="_blank" rel="noopener">Navigate</a> · <a href="${esc(r.place.apple)}" target="_blank" rel="noopener">Apple Maps</a></div>` : ""}
      ${items.length ? `<ul class="agenda totals aditems">${items.map(i => `<li class="${i.name===pickName?"pick":""}"><span class="n"><b style="color:${fitTone(i.fits)}">${esc(i.name)}</b>${i.how_much?` <span class="small">${esc(i.how_much)}</span>`:""}<span class="small"> ${i.kcal} kcal · ${i.carbs_g}C · ${i.protein_g}P · ${i.fat_g}F</span><span class="small adwhy">${esc(i.why||"")}</span></span>
          <span class="tag">${i.name===pickName?`<button class="linkish" data-adlog="${esc((i.how_much?i.how_much+" ":"")+i.name)}">log it</button>`:""}</span></li>`).join("")}</ul>` : `<div class="small">Nothing here that it could name.</div>`}
      ${places && places.length ? `<details class="why"><summary>everything near you</summary><ul class="agenda totals">${places.slice(0,15).map(p => `<li><span class="n">${esc(p.name)}<span class="small"> ${esc(p.kind)} · ${p.dist_m} m</span></span><span class="tag"><a href="${esc(p.directions)}" target="_blank" rel="noopener">go</a></span></li>`).join("")}</ul></details>` : ""}`;
    if (r.reply && typeof speak === "function") speak(r.reply);
    adviseOut.querySelectorAll("[data-adlog]").forEach(b => b.onclick = async ()=>{
      b.disabled = true; b.textContent = "logging…";
      try{ const rr = await bridge("/food/text",{method:"POST",headers:J,body:JSON.stringify({ text: b.dataset.adlog })}); b.textContent = "logged"; day = rr.day; draw(); }
      catch(e){ b.textContent = "failed"; }
    });
  };
  document.getElementById("adviseBtn").onclick = ()=> adviseFile.click();
  adviseFile.onchange = async ()=>{
    const f = adviseFile.files && adviseFile.files[0]; if (!f) return;
    adviseOut.innerHTML = `<div class="small">Looking at it…</div>`;
    try{
      const image_base64 = await fileToBase64(f, 1280, 0.75);
      const r = await bridge("/food/advise",{method:"POST",headers:J,body:JSON.stringify({ images:[{image_base64, media_type:"image/jpeg"}] })});
      renderAdvice(r, null);
    }catch(e){ adviseOut.innerHTML = `<div class="small">Couldn't read it — ${esc(e.message)}</div>`; }
    adviseFile.value = "";
  };
  document.getElementById("nearBtn").onclick = ()=>{
    if (!navigator.geolocation){ adviseOut.innerHTML = `<div class="small">This browser gives no location.</div>`; return; }
    adviseOut.innerHTML = `<div class="small">Finding where you are…</div>`;
    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      let near = null;
      try{ near = await bridge("/food/nearby",{method:"POST",headers:J,body:JSON.stringify({ lat, lon })}); }
      catch(e){ adviseOut.innerHTML = `<div class="small">The map service did not answer. <a href="https://www.google.com/maps/search/food/@${lat},${lon},15z" target="_blank" rel="noopener">Open the map</a> instead.</div>`; return; }
      if (!near.places || !near.places.length){ adviseOut.innerHTML = `<div class="small">Nothing with a name within 1.5 km on the map. <a href="${esc(near.search)}" target="_blank" rel="noopener">Open the map</a>.</div>`; return; }
      adviseOut.innerHTML = `<div class="small">${near.places.length} places near you. Choosing…</div>`;
      try{
        const r = await bridge("/food/advise",{method:"POST",headers:J,body:JSON.stringify({ places: near.places })});
        renderAdvice(r, near.places);
      }catch(e){ adviseOut.innerHTML = `<div class="small">Couldn't choose — ${esc(e.message)}</div><ul class="agenda totals">${near.places.slice(0,10).map(p => `<li><span class="n">${esc(p.name)}<span class="small"> ${esc(p.kind)} · ${p.dist_m} m</span></span><span class="tag"><a href="${esc(p.directions)}" target="_blank" rel="noopener">go</a></span></li>`).join("")}</ul>`; }
    }, err => { adviseOut.innerHTML = `<div class="small">Location was refused (${esc(err.message)}). Allow it for this site in Settings, or snap what is in front of you.</div>`; }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
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
