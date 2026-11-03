"use strict";
/* THE WAY — Food (#food): the photo journal.
   Point the camera at the plate, the bridge reads it (bridge/food.js), and the
   day is scored against the day's guidelines. Loads after app.js and uses its
   globals: V, view, bridge, esc, fileToBase64. */
(function(){

const J = {"Content-Type":"application/json"};

// A logged meal that lands green against its slot (on the plan) gets the stars.
function cheerIf(r){
  try{
    const e = r && r.entry, meals = r && r.day && r.day.meals || [];
    if (!e || (e.kcal || 0) < 100) return;
    const m = meals.find(x => (x.logged || []).includes(e.id));
    if (m && m.match && m.match.key === "green" && typeof celebrate === "function") celebrate({ slot: m.slot });
  }catch{}
}
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
// the slot an entry was given when it was logged, in words: one name on the verdict, the card and the Day row
const slotWord = s => s === "after" ? "post-ride" : s === "before" ? "pre-ride" : (s || "");

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
   colour (green, amber, red, blue for too much) and the words sit in text ink.
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
function energyHTML(e, opt){
  opt = opt || {};   // opt.noHead: the page shows the number itself; opt.noLegs: the page draws the legs rating itself
  if (!e || !e.series || !e.series.length) return `<div class="small">Starts with the first meal.</div>`;
  const nowMin = e.now ? (e.series.find(p=>p.t===e.now.time)||{}).m : null;
  const c = curveSVG({ series: e.series, val: p=>p.pct, lo: 0, hi: 100, col: p=>fuelCol(p.pct),
    band: e.series[0].lo != null ? (p=>[p.lo, p.hi]) : null, extra: e.series[0].legs_pct != null ? (p=>p.legs_pct) : null,
    sessions: (e.sessions||[]).map(s => ({ min: s.min, end_min: s.end_min, name: s.name, col: s.band ? fuelCol(s.band.key==="green"?100:s.band.key==="yellow"?50:0) : null })),
    dots: (e.meals||[]).map(m => { const p = e.series.find(x => x.m >= m.min) || e.series[e.series.length-1]; return { min: m.min, val: p.pct, filled: m.logged && (m.carbs_g > 0 || !m.protein_only), title: `${hm12(m.time)} ${m.name||""} ${m.carbs_g} g carbs${m.protein_g?`, ${m.protein_g} g protein`:""}` }; }).concat((e.supps||[]).filter(x => x.min != null).map(x => { const p = e.series.find(q => q.m >= x.min) || e.series[e.series.length-1]; return { min: x.min, val: p.pct, filled: false, title: `${hm12(x.time)} ${x.name}` }; })),
    nowMin, guides: [35,60] });
  const ses = (e.sessions||[]).map(s => `<span class="egs"><b style="color:${fuelColL(s.pct)}">${s.pct}%</b> at ${esc(hm12(s.time))} ${esc(s.name)}${s.legs_pct!=null?` <span class="small">· legs ${s.legs_pct}%</span>`:""}${s.slid_from?` <span class="small">· planned ${esc(hm12(s.slid_from))}, not started, so moved to now</span>`:""}</span>`).join(" · ");
  return `<div class="energy" data-m0="${c.m0}" data-m1="${c.m1}">
    ${opt.noHead ? "" : `<div class="egline"><span class="egnow"><b style="color:${fuelColL(e.now.pct)}">${e.now.pct}%</b> fuel now${e.now.arriving_g >= 10 ? ` <span class="small">· ${e.now.arriving_g} g landing</span>` : ""}${e.now.legs_pct!=null?` <span class="small">· legs ${e.now.legs_pct}%</span>`:""}</span>${e.peak?`<span class="small">peak ${esc(hm12(e.peak.time))} · ${e.peak.pct}%</span>`:""}</div>`}
    ${e.now.arriving_g >= 10 ? `<details class="why"><summary>why it rises ahead</summary><div class="small">The ${e.now.pct}% is what is in the blood and liver this minute; ${e.now.arriving_g} g of carbs from what you just ate are still in the stomach and land over the next two to three hours, which is the rise ahead of the line.</div></details>` : ""}
    ${(e.awaiting||[]).map(a => `<div class="small">${esc(a.name)} planned at ${esc(hm12(a.time))}: taken as ridden on the strength of ${esc(a.evidence)}; Strava's copy of the ride has not landed yet.</div>`).join("")}
    ${c.svg}
    <div class="small egread"></div>
    ${ses?`<div class="small">${ses}</div>`:""}
    ${e.advice?`<div class="egadvice">${esc(e.advice)}</div>`:""}
    ${e.legs_tap && !opt.noLegs?legsTapHTML(e.legs_tap):""}
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
  // the legs rating may sit outside the curve's box (the Fuel page puts it in its Legs field)
  root.querySelectorAll("[data-legs]").forEach(b => b.onclick = async ()=>{
    b.disabled = true;
    try{ await bridge("/fuel/legs",{method:"POST",headers:J,body:JSON.stringify({ key: b.dataset.ride, legs: +b.dataset.legs })}); if (onChange) await onChange(); }
    catch(err){ b.textContent = "✗"; }
  });
}
function hydrationHTML(h, opt){
  opt = opt || {};   // opt.noHead: the page shows the balance itself
  if (!h || !h.series || !h.series.length) return `<div class="small">Starts with the first drink.</div>`;
  const kg = h.kg || 98, lo = -kg * 25, hi = kg * 10;   // 2.5% down to 1% up
  const nowMin = h.now ? (h.series.find(p=>p.t===h.now.time)||{}).m : null;
  const colOf = p => p.band === "green" ? "#2E7D4A" : p.band === "yellow" ? "#8A6A14" : p.band === "blue" ? "#2F4F8F" : "#7A2E26";
  const c = curveSVG({ series: h.series, val: p=>p.ml, lo, hi, baseline: 0, baselineStrong: true, col: colOf,
    sessions: (h.sessions||[]).map(s => ({ min: h.series.find(p=>p.t===s.time) ? h.series.find(p=>p.t===s.time).m : (+s.time.slice(0,2))*60+(+s.time.slice(3,5)), end_min: s.end_min, name: s.name })),
    dots: (h.drinks||[]).map(d => { const p = h.series.find(x => x.m >= d.min + 10) || h.series[h.series.length-1]; return { min: d.min, val: p.ml, filled: true, title: `${hm12(d.time)} ${d.name} ${d.ml} ml${d.alcohol ? ` (net ${d.net_ml > 0 ? "+" : ""}${d.net_ml} ml after the alcohol)` : ""}` }; }),
    nowMin, guides: [0, -kg*10, -kg*20] });
  const nb = h.now.band, nowTxt = h.now.ml > 300 ? `+${(h.now.ml/1000).toFixed(1)} L` : `${h.now.ml < 0 ? "−" : ""}${(Math.abs(h.now.ml)/1000).toFixed(1)} L`;
  const ses = (h.sessions||[]).map(s => `<span class="egs"><b>${(s.sweat_ml_h/1000).toFixed(1)} L/h</b> ${esc(s.name.replace(/,.*$/,""))}${s.indoor?"":s.temp_f?` · ${s.temp_f}°F`:""}</span>`).join(" · ");
  return `<div class="energy hyd" data-m0="${c.m0}" data-m1="${c.m1}">
    ${opt.noHead ? "" : `<div class="egline"><span class="egnow"><b style="color:${verdictCol(nb.key)}">${nowTxt}</b> <span class="small">${esc(nb.word)}</span></span><span class="small">${(h.drunk_ml/1000).toFixed(1)} of ${(h.target_ml/1000).toFixed(1)} L drunk</span></div>`}
    ${h.start_ml <= -300 ? `<div class="small">Woke ${(Math.abs(h.start_ml)/1000).toFixed(1)} L down${h.carried && h.carried.from === "scale" ? ", by the scale" : h.carried && h.carried.from === "both" ? ", by yesterday and the scale" : ", carried from yesterday"}${h.carried && h.carried.night ? `; ${h.carried.night.drinks} ${h.carried.night.word}${h.carried.night.drinks === 1 ? "" : "s"} after 8 p.m. cost about ${(h.carried.night.drain_ml/1000).toFixed(1)} L of it` : ""}.</div>` : ""}
    ${c.svg}
    <div class="small egread"></div>
    ${ses?`<div class="small">${ses}</div>`:""}
    ${h.advice?`<div class="egadvice" style="border-color:${verdictCol(nb.key)}">${esc(h.advice)}</div>`:""}
    ${h.weigh?`<div class="small">Scale: ${h.weigh.pre_lb.toFixed(1)} → ${h.weigh.post_lb.toFixed(1)} lb around the ride, ${(h.weigh.lost_ml/1000).toFixed(1)} L lost${h.weigh.modelled_ml?` (the model said ${(h.weigh.modelled_ml/1000).toFixed(1)})`:""}.</div>`:""}
    <details class="why"><summary>what it counts</summary><div class="small">Water against the start of the day, which is yesterday's end less the night (a deficit carried to bed is still there at breakfast; a surplus is not), averaged with the scale when it has a morning reading against the last three days. It drifts down about 100 ml an hour awake (breath, skin, urine), half that asleep; each drink arrives as the stomach empties, most of it within 45 minutes; food brings its own water. A ride takes sweat at the rate the power, the air and the weather give: the fan on the trainer, the wind and the temperature on the road. Water drunk after a ride is kept at 70%, 90% when it carries salt. Alcohol is a net loss: its own water is passed with it, and each 10 g of ethanol takes about 100 ml more, so a 12 oz beer leaves the balance about 140 ml lower; each drink after 8 p.m. costs the morning about 100 ml more again. "Drank" counts every drink on the list at the volume poured, beer included; the balance counts what the body keeps. Coffee and tea count in full: in a daily drinker caffeine is not a diuretic. Under 1% of body weight down is fine, 1 to 2% costs endurance, over 2% is dry. A little above the morning is topped up and still green: the kidneys clear up to a litre or so in a few hours. Blue, past 1.5 L over, is too much; drinking far beyond what was lost is the dangerous side after a long day.${h.calibration&&h.calibration.points?` Tuned by ${h.calibration.points} post-ride weigh-in${h.calibration.points===1?"":"s"} (×${h.calibration.k}).`:" Weigh in after a ride and it tunes itself to you."}</div></details>
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
        </span></div>
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
// the tile pictures, shared with the link pages (links.js)
const ICON = {
  cam: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/></svg>`,
  roll: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z"/></svg>`
};
window.foodBits = { ICON, fitBadge, targetsRow, checksList, thumbStrip, toneC, FIT, microHTML, wireMicro, energyHTML, wireEnergy, legsTapHTML, verdictCol, fuelColL, hydrationHTML, wireHydration, curveSVG, wireCurve };

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
  view.innerHTML = `<div class="fd-ttl"><h2 class="fd-h">Live</h2><span class="hu-lab">fuel · hydration</span></div>
    <div class="pweekhead fd-day"><h2 class="ptitle">${isToday?"Today":esc(dayLabel(date))}</h2>
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
      <div class="card" id="fEnergy"><h4>Live fuel${isToday?"":" · that day"}</h4>${energyHTML(day.energy, { noLegs: true })}</div>
      <div class="card" id="fHydration"><h4>Live hydration${isToday?"":" · that day"}</h4>${hydrationHTML(day.hydration)}</div>
      <div class="hu-tiles fd-livego"><a class="hu-tile" href="${isToday?"#food":"#food?date="+date}">${ICON.pen}<b>The food log</b><span>meals and grades</span></a>${isToday?`<a class="hu-tile primary" href="#food?snap=snack">${ICON.cam}<b>Snap</b><span>a meal or a drink</span></a>`:""}</div>`;
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
  // the title line carries the day's calories against the target; the day stepper sits under it
  view.innerHTML = `<div class="fd-ttl"><h2 class="fd-h">Food</h2><span class="fd-kcal" id="fKcal"></span></div>
    <div class="pweekhead fd-day"><h2 class="ptitle">${isToday?"Today":esc(dayLabel(date))}</h2>
      <div class="pweeknav"><button id="fPrev" aria-label="Previous day">‹</button><button id="fToday">Today</button><button id="fNext" aria-label="Next day" ${isToday?"disabled":""}>›</button></div></div>
    <div id="fMacros"></div>
    ${isToday ? `<div class="fd-log" id="snap">
      <div class="hu-tiles fd-tiles">
        <button class="hu-tile primary snapbtn" id="snapBtn">${ICON.cam}<b>Snap a meal</b></button>
        <button class="hu-tile snapbtn" id="rollBtn">${ICON.roll}<b>From camera roll</b></button>
        <button class="hu-tile" id="writeBtn">${ICON.pen}<b>Write</b></button>
        <button class="hu-tile talkbtn" id="talkBtn">${ICON.mic}<b>Say</b></button></div>
      <input id="snapFile" type="file" accept="image/*" capture="environment" hidden>
      <input id="rollFile" type="file" accept="image/*" multiple hidden>
      <div id="snapForm" hidden>
        <div class="snapstrip" id="snapStrip"></div>
        <div class="small snapmore"><button class="linkish" id="snapAdd">+ another photo</button> <button class="linkish" id="rollAdd">+ from camera roll</button> <span id="snapCount"></span></div>
        <label for="snapNote">Your words with the photo (optional)</label>
        <textarea id="snapNote" rows="3" placeholder="What the photo can't show: chicken thigh 180 g, rice 1 cup, cooked in olive oil, a glass of milk"></textarea>
        <div class="small">Weights from a scale are taken as exact; the coach reads your words and the photo together as one meal.</div>
        <label for="snapMeal">Meal</label><select id="snapMeal"><option value="">let the coach guess</option>${MEALS.map(m=>`<option>${m}</option>`).join("")}</select>
        <button class="primary" id="snapLog">Log it</button> <button id="snapCancel">Cancel</button>
        <div class="small" id="snapMsg"></div></div>
      <div id="writeForm" hidden>
        <label for="writeText">What is on the plate, in your words</label>
        <textarea id="writeText" rows="3" placeholder="Rice bowl: jasmine rice 200 g, grilled salmon 150 g, edamame 80 g, kimchi, a soft egg, a splash of soy"></textarea>
        <div class="small">Add weights when you have them: "rice 200 g, salmon 150 g". <button class="linkish" id="writePhoto">+ add a photo</button> <button class="linkish" id="writeRoll">+ from camera roll</button></div>
        <div class="row2"><span><label>Meal</label><select id="writeMeal"><option value="">let the coach guess</option>${MEALS.map(m=>`<option>${m}</option>`).join("")}</select></span>
          <span><label>&nbsp;</label><button class="primary" id="writeLog">Log it</button> <button id="writeCancel">Cancel</button></span></div>
        <div class="small" id="writeMsg"></div></div>
      <div id="snapResult"></div>
    </div>` : ""}
    <div id="fDay"><div class="card"><div class="small">Loading the day…</div></div></div>`;
  document.getElementById("fPrev").onclick = ()=>go(keyAdd(date,-1));
  document.getElementById("fNext").onclick = ()=>{ if (!isToday) go(keyAdd(date,1)); };
  document.getElementById("fToday").onclick = ()=>go(today);

  let day = null, saving = "";
  const draw = ()=>{
    const el = document.getElementById("fDay");
    if (!el) return;
    if (!day){ el.innerHTML = `<div class="card"><div class="small">bridge unreachable</div></div>`; return; }
    // three bars for the day: protein, carbs, fat. The track is the day's target, the fill what is logged
    const ents = (day.entries || []).filter(e => !e.supplement);
    const sum = k => Math.round(ents.reduce((x, e) => x + (e[k] || 0), 0));
    const t = day.target || {};
    const BARS = [["protein","protein_g","var(--red)"],["carbs","carbs_g","var(--carb)"],["fat","fat_g","var(--fat)"]];
    // head-unit bars: the number big on the label side, the target a white tick with its number above;
    // past the tick the bar runs on hatched (faint inside 10%, full past it); a ✓ only within 10% either side,
    // +N past that (over is over, carbs as much as protein), or what is left to go
    const bars = `<div class="fd-mac">${BARS.map(([l,k,col]) => { const a = sum(k), g = Math.round(t[k] || 0);
        const scale = Math.max(g / 0.78, a / 0.84, 1), tk = g / scale * 100, fp = Math.min(a, g) / scale * 100, op = a > g ? (a - g) / scale * 100 : 0;
        const over = g > 0 && a > g * 1.1, near = g > 0 && a >= g * 0.9 && !over, left = Math.max(0, g - a);
        const note = !g ? "" : over ? `<span class="fd-note hu-stop">+${a - g}</span>` : near ? `<span class="fd-note hu-go">✓</span>` : "";
        const togo = g && a < g * 0.9 ? `<span class="fd-togo">${left} to go</span>` : "";
        return `<div class="fd-mrow"><span class="fd-mk">${l}<span class="hu-n">${a}</span>${togo}</span>
          <div class="hu-track fd-track"><i class="f" style="width:${fp.toFixed(1)}%;background:${col}"></i>${op ? `<i class="over" style="left:${tk.toFixed(1)}%;width:${op.toFixed(1)}%;opacity:${over ? 1 : .5}"></i>` : ""}${g ? `<i class="tick" style="left:${tk.toFixed(1)}%"></i><span class="tl" style="left:${tk.toFixed(1)}%">${g}</span>` : ""}${note}</div></div>`; }).join("")}</div>`;
    const kEl = document.getElementById("fKcal"), kc = sum("kcal"), fmt = n => Number(n).toLocaleString("en-US");
    if (kEl) kEl.innerHTML = `<span class="hu-n">${fmt(kc)}</span> <span class="fd-kt">/ ${t.kcal ? fmt(t.kcal) : "—"} kcal</span>`;
    // food only here: drinks (water, coffee, beer, bottles) are listed and logged on the Hydration page; the bars above still count their calories
    // the drinks: the server's one list (day.drinks), the same the Hydration page lists; a shake with
    // fluid in it is on both pages, so the line says how many of them are here as food too
    const isDr = e => e.is_drink || e.drink_only, foods = day.entries.filter(e => !isDr(e)), nMeals = foods.filter(e => !e.supplement).length;
    const drIds = Array.isArray(day.drinks) ? day.drinks : ents.filter(e => isDr(e) || e.fluid_ml > 0).map(e => e.id);
    const drEnts = drIds.map(id => day.entries.find(e => e.id === id)).filter(Boolean);
    const nDrinks = drEnts.length, alsoFood = drEnts.filter(e => !isDr(e));
    const foodWord = alsoFood.length && alsoFood.every(e => /shake|smoothie/i.test(e.name || "")) ? (alsoFood.length === 1 ? " shake" : " shakes") : "";
    const drLine = `${nDrinks} drink${nDrinks===1?"":"s"} today${alsoFood.length ? ` (${alsoFood.length}${foodWord} also count${alsoFood.length===1?"s":""} as food)` : ""} · <a href="#hydration">Hydration</a>`;
    const mEl = document.getElementById("fMacros");
    if (mEl) mEl.innerHTML = bars;
    el.innerHTML = `
      <div class="fd-jhead"><span class="hu-lab">Logged ${isToday ? "today" : "that day"} · ${nMeals} ${nMeals===1?"meal":"meals"}${saving ? ` · <span class="fd-saving">${esc(saving)}</span>` : ""}</span>
      ${nDrinks && isToday ? `<span class="small drinksnote">${drLine}</span>` : ""}</div>
      <div class="journal fd-journal">${foods.length ? foods.slice().reverse().map(entryHTML).join("") : `<div class="small fd-none">${isToday?"Nothing yet.":"Nothing logged that day."}</div>`}</div>`;
    el.querySelectorAll(".jentry").forEach(n => {
      const top = n.querySelector(".fd-jrow");
      const flip = ()=>{ n.classList.toggle("open"); if (top) top.setAttribute("aria-expanded", n.classList.contains("open") ? "true" : "false"); };
      n.onclick = (ev)=>{ if (ev.target.closest("button,input,select,textarea,form,a,label")) return; flip(); };
      if (top) top.onkeydown = (ev)=>{ if (ev.key === "Enter" || ev.key === " "){ ev.preventDefault(); flip(); } };
    });
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
    // a removal or a correction shows at once, marked "saving…", and the server's day replaces it when it answers
    el.querySelectorAll("[data-del]").forEach(btn => btn.onclick = async ()=>{
      if (!confirm("Remove this from the journal?")) return;
      const id = btn.dataset.del, before = day;
      day = Object.assign({}, day, { entries: (day.entries || []).filter(x => x.id !== id), meals: (day.meals || []).map(m => Object.assign({}, m, { logged: (m.logged || []).filter(x => x !== id) })) });
      saving = "saving…"; draw();
      try{ const r = await bridge(`/food/${encodeURIComponent(id)}?date=${date}`,{method:"DELETE"}); saving = ""; day = r.day; draw(); recheck(true); }
      catch(e){ day = before; saving = "couldn't remove it — " + String(e.message).replace(/^bridge \d+ — /, ""); draw(); }
    });
    el.querySelectorAll("[data-fix]").forEach(btn => btn.onclick = async ()=>{
      const id = btn.dataset.fix, box = btn.closest(".jfix");
      const body = { date, name: box.querySelector(".fxName").value, meal: box.querySelector(".fxMeal").value,
        kcal: +box.querySelector(".fxK").value, carbs_g: +box.querySelector(".fxC").value, protein_g: +box.querySelector(".fxP").value, fat_g: +box.querySelector(".fxF").value,
        fits: box.querySelector(".fxFit").value };
      const before = day, old = (day.entries || []).find(x => x.id === id) || {};
      // the same arithmetic the bridge does: a new kcal alone scales the plate, it is not a different plate
      const onlyK = ["carbs_g","protein_g","fat_g"].every(k => +body[k] === +old[k]) && old.kcal > 0 && body.kcal !== old.kcal;
      const scaled = onlyK ? Object.fromEntries(["carbs_g","protein_g","fat_g"].map(k => [k, Math.max(0, Math.round((old[k] || 0) * body.kcal / old.kcal))])) : {};
      const fresh = Object.assign({}, old, { name: body.name, meal: body.meal, kcal: body.kcal, carbs_g: body.carbs_g, protein_g: body.protein_g, fat_g: body.fat_g }, scaled,
        { assessment: Object.assign({}, old.assessment || {}, { fits: body.fits }), corrected: true, _saving: true });
      day = Object.assign({}, day, { entries: (day.entries || []).map(x => x.id === id ? fresh : x) });
      saving = "saving…"; draw();
      try{ const r = await bridge(`/food/${encodeURIComponent(id)}`,{method:"PUT",headers:J,body:JSON.stringify(body)}); saving = ""; day = r.day; draw(); recheck(true); }
      catch(e){ day = before; saving = "couldn't save the correction — " + String(e.message).replace(/^bridge \d+ — /, ""); draw(); }
    });
  };
  // the grade chip in two words: what is wrong ("Protein low"), not the slot name and a percentage; the full grade sits in the opened row
  const cap = s => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
  // A slot's grade belongs to the slot: with one plate in it the chip is that grade; with several, the
  // chip is the plate's own reading and the slot's grade is said as the slot's ("the snack slot: kcal 845% over").
  const gradeOf = (e)=>{
    const a = e.assessment || {};
    const m = day && (day.meals||[]).find(x => (x.logged||[]).includes(e.id)), mt = m && m.match;
    const f = FIT[a.fits] || FIT.partly, own = { tone: f.tone === "good" ? "go" : f.tone === "warn" ? "hold" : "stop", word: cap(f.word) };
    if (mt){
      const tone = mt.key === "green" ? "go" : mt.key === "yellow" ? "hold" : "stop";
      const n = (m.logged || []).length, sw = slotWord(m.slot);
      const slotGrade = mt.key === "green" ? "on plan" : String(mt.word || "");
      if (n > 1) return { tone: own.tone, word: own.word, full: `the ${sw} slot (${n} plates together): ${slotGrade}`, slotTone: tone };
      let word = "On plan";
      if (mt.key !== "green"){
        const mm = /^(\w+)\s+\d+%\s+(over|under)/.exec(mt.macros && mt.macros.key !== "green" ? String(mt.macros.word || "") : "");
        const rw = String((mt.rules && mt.rules.key !== "green" && mt.rules.word) || "").trim();
        word = mm ? `${cap(mm[1])} ${mm[2] === "over" ? "high" : "low"}` : rw && rw.length <= 14 ? cap(rw) : mt.key === "yellow" ? "Partly" : "Off plan";
      }
      return { tone, word, full: `the ${sw} slot: ${slotGrade}`, slotTone: tone };
    }
    return { tone: own.tone, word: own.word, full: null };
  };
  const thumbOf = (e, txt)=> e.thumb ? `<img class="fd-th" src="data:image/jpeg;base64,${e.thumb}" alt="">` : `<span class="fd-th nothumb">${txt}</span>`;
  const entryHTML = (e)=>{
    const when = esc(e.time?hm12(e.time):clock(e.at)), del = `<button class="pdanger" data-del="${esc(e.id)}">Remove</button>`;
    if (e.supplement) return `<div class="jentry fd-jr supp">
      <div class="fd-jrow" role="button" tabindex="0" aria-expanded="false">${thumbOf({}, "Rx")}
        <div class="fd-jb"><div class="fd-top"><b class="jname">${esc(e.name)}</b><span class="hu-chip hu-dim">Rx</span></div><div class="fd-meta">${when} · supplement</div></div></div>
      <div class="fd-more"><div class="small">${esc(e.notes||"")}</div><div class="fd-acts">${del}</div></div></div>`;
    const a = e.assessment || {}, gr = gradeOf(e);
    const stack = [["carbs_g","var(--carb)"],["protein_g","var(--red)"],["fat_g","var(--fat)"]].filter(([k]) => (e[k] || 0) > 0)
      .map(([k, c]) => `<i style="flex:${e[k]};background:${c}"></i>`).join("");
    return `<div class="jentry fd-jr">
      <div class="fd-jrow" role="button" tabindex="0" aria-expanded="false">${thumbOf(e, e.written ? "✎" : esc((e.name||"?").slice(0,2)))}
        <div class="fd-jb"><div class="fd-top"><b class="jname">${esc(e.name)}</b><span class="hu-chip hu-${gr.tone}">${esc(gr.word)}</span></div>
          <div class="fd-meta">${when} · ${e.drink_only?"drink":esc(slotWord(e.slot) || e.meal)} · ${e.kcal} kcal · ${e.protein_g} P${e.maybe_double_of ? ` · <span class="hu-hold">double?</span>` : ""}${e._saving ? ` · <span class="fd-saving">saving…</span>` : ""}</div>
          ${e.written || (e.notes && e.thumb) ? `<div class="fd-words">“${esc(e.written || e.notes)}”</div>` : ""}
          ${stack ? `<div class="fd-stack" aria-label="${e.carbs_g} g carbs, ${e.protein_g} g protein, ${e.fat_g} g fat">${stack}</div>` : ""}</div></div>
      <div class="fd-more">
      <div class="small">${e.kcal} kcal · ${e.carbs_g}C · ${e.protein_g}P · ${e.fat_g}F${e.fluid_ml?` · ${e.fluid_ml} ml ${esc(e.drink||"fluid")}`:""}${e.drink_only?"":`${e.confidence&&e.confidence!=="high"?` · ${esc(e.confidence)} confidence`:""}${e.written && e.thumb ? ` · ${e.photos > 1 ? e.photos + " photos" : "photo"} + your words` : e.written?" · written":e.notes?"":(e.photos > 1 ? ` · ${e.photos} photos, ±35%` : " · photo only, ±35%")}`}${e.corrected?" · corrected":""}</div>
      ${gr.full ? `<div class="small fd-grade">Graded: <span class="hu-${gr.slotTone || gr.tone}">${esc(gr.full)}</span></div>` : ""}
      ${e.plan && e.plan.kcal != null ? `<div class="small jplan">Graded against the plan as it stood at ${esc(hm12(e.plan.at||e.time))}: ${e.plan.kcal} kcal · ${e.plan.carbs_g}C · ${e.plan.protein_g}P${e.plan.low_carb ? " · low carb" : ""}${e.plan.backfilled ? " (filled in later)" : ""}</div>` : ""}
      ${e.maybe_double_of ? `<div class="small jdouble">Looks like the entry just before it, logged again. If it was one bottle, remove this one.</div>` : ""}
      <div class="small jwhy">${esc(a.why||"")}${e.why_at ? ` <span class="reread" title="${esc(e.why_then||"")}">· re-read ${esc(hm12(e.why_at))}</span>` : ""}</div>
      <div class="jmore fd-jmore">
        ${e.written || e.notes ?`<div class="small">You wrote: “${esc(e.written || e.notes)}”</div>`:""}
        ${e.portion?`<div class="small">Portion: ${esc(e.portion)}</div>`:""}
        ${/^(before|on the bike)$/.test(e.slot || "") ? `<div class="small">Fuel for the ride: judged on its carbs, ${e.carbs_g} g${e.plan && e.plan.carbs_g != null ? ` against ${e.plan.carbs_g} g planned` : ""}.</div>`
          : `<div class="small">This plate: ${a.protein_source?"protein ✓":"no real protein"} · carbs ${esc(a.carbs||"?")} · ${a.vegetables?"vegetables or fruit ✓":"no vegetables"}${a.processed?" · ultra-processed":""}</div>`}
        ${isToday?`<div class="jfix">
          <div class="row2"><span><label>Name</label><input class="fxName" value="${esc(e.name)}"></span>
            <span><label>Meal</label><select class="fxMeal">${e.slot === "before" ? `<option value="snack" selected>pre-ride</option>` : ""}${MEALS.map(m=>`<option ${e.slot !== "before" && m===(MEALS.includes(e.slot) ? e.slot : e.meal)?"selected":""}>${m}</option>`).join("")}</select></span></div>
          <div class="row2"><span><label>kcal</label><input class="fxK" type="number" value="${e.kcal}"></span><span><label>carbs g</label><input class="fxC" type="number" value="${e.carbs_g}"></span></div>
          <div class="row2"><span><label>protein g</label><input class="fxP" type="number" value="${e.protein_g}"></span><span><label>fat g</label><input class="fxF" type="number" value="${e.fat_g}"></span></div>
          <label>Fit</label><select class="fxFit">${["yes","partly","no"].map(f=>`<option ${f===a.fits?"selected":""}>${f}</option>`).join("")}</select>
          <div class="fd-acts"><button data-fix="${esc(e.id)}">Save correction</button> <button data-merge="${esc(e.id)}">Combine with previous</button> ${del}</div></div>`:`<div class="fd-acts">${del}</div>`}
      </div></div></div>`;
  };

  const load = async ()=>{
    try{ day = await bridge(isToday ? "/food/today" : "/food/day?date="+date); }
    catch(e){ day = null; }
    if (location.hash.split("?")[0] !== "#food") return;
    draw();
    recheck();
  };
  // earlier sentences of the day are re-read whenever something newer has landed; once per newest entry
  const recheck = async (force)=>{
    if (!day || !day.stale_readings || !day.stale_key || (!force && window.__recheckTried === day.stale_key)) return;
    window.__recheckTried = day.stale_key;
    try{ const r = await bridge("/food/recheck",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ date })}); if (r && r.day && location.hash.split("?")[0] === "#food"){ day = r.day; draw(); } }catch{}
  };
  load();

  /* ---- the camera ---- */
  if (!isToday) return;
  // Two ways in: the camera (capture forces it on a phone) and the camera
  // roll (no capture, so the phone offers the library). Same form after.
  const fileEl = document.getElementById("snapFile"), rollEl = document.getElementById("rollFile"), form = document.getElementById("snapForm");
  let files = [];                         // up to four photos of one meal
  const MAXP = 4;
  const strip = ()=>{
    const el = document.getElementById("snapStrip"); if (!el) return;
    el.innerHTML = files.map((f, i) => `<span class="snapthumb"><img src="${URL.createObjectURL(f)}" alt=""><button class="snapx" data-i="${i}" aria-label="Remove photo">×</button></span>`).join("");
    const c = document.getElementById("snapCount"); if (c) c.textContent = files.length ? `${files.length} of ${MAXP}` : "";
    const add = document.getElementById("snapAdd"), roll = document.getElementById("rollAdd"); if (add) add.hidden = files.length >= MAXP; if (roll) roll.hidden = files.length >= MAXP;
  };
  document.getElementById("snapStrip").addEventListener("click", (e)=>{ const b = e.target.closest(".snapx"); if (!b) return; files.splice(+b.dataset.i, 1); strip(); if (!files.length){ form.hidden = true; } });
  document.getElementById("snapAdd").onclick = ()=> fileEl.click();
  document.getElementById("rollAdd").onclick = ()=> rollEl.click();
  document.getElementById("snapBtn").onclick = ()=> fileEl.click();
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
    const add = Array.from(el.files || []); el.value = "";
    if (!add.length) return;
    files = files.concat(add).slice(0, MAXP);
    // a photo added while writing: the words come along into the photo's box, one meal
    const wf = document.getElementById("writeForm"), wt = document.getElementById("writeText"), sn = document.getElementById("snapNote");
    if (wf && !wf.hidden){ if (wt && wt.value.trim() && sn && !sn.value.trim()) sn.value = wt.value.trim(); const wm = document.getElementById("writeMeal"), sm = document.getElementById("snapMeal"); if (wm && sm && wm.value) sm.value = wm.value; wf.hidden = true; if (wt) wt.value = ""; }
    document.getElementById("snapResult").innerHTML = "";
    strip(); form.hidden = false;
  };
  fileEl.onchange = ()=> picked(fileEl);
  { const wp = document.getElementById("writePhoto"), wr = document.getElementById("writeRoll"); if (wp) wp.onclick = ()=> fileEl.click(); if (wr) wr.onclick = ()=> rollEl.click(); }
  rollEl.onchange = ()=> picked(rollEl);
  document.getElementById("snapCancel").onclick = ()=>{ form.hidden = true; files = []; strip(); fileEl.value = ""; rollEl.value = ""; };
  // the verdict at logging time is the slot's grade, the same word the card shows, with the plate's reading under it
  // The plan it shows is the one saved on the entry (e.plan), the same object the journal card shows;
  // the slot is the one saved on the entry, the same the card and the Day row show.
  const showVerdict = (e, dayNow)=>{
    const a = e.assessment;
    const m = dayNow && (dayNow.meals||[]).find(x => (x.logged||[]).includes(e.id));
    const mt = m && m.match, p = e.plan && e.plan.kcal != null ? e.plan : null;
    const n = m ? (m.logged || []).length : 0, sw = slotWord(e.slot || (m && m.slot));
    const tone = mt ? (mt.key === "green" ? "good" : mt.key === "yellow" ? "warn" : "bad") : (FIT[a.fits]||FIT.partly).tone;
    document.getElementById("snapResult").innerHTML = `<div class="verdict" style="border-color:${toneC(tone)}">
      <div class="jname">${esc(e.name)} ${mt ? `<span class="fit" style="color:${toneC(tone)}">${esc(sw)}${n > 1 ? ` slot, ${n} plates` : ""} · ${mt.key === "green" ? "on plan" : esc(mt.word)}</span>` : fitBadge(a)}</div>
      <div class="small">${e.kcal} kcal · ${e.carbs_g}C · ${e.protein_g}P · ${e.fat_g}F${e.portion?` · ${esc(e.portion)}`:""}${p ? ` · the ${esc(sw)} slot wanted ${p.kcal} kcal · ${p.carbs_g}C · ${p.protein_g}P${p.low_carb ? " · low carb" : ""}` : ""}</div>
      ${mt && mt.macros && mt.rules ? `<div class="small">${n > 1 ? `the ${esc(sw)} slot together: ` : ""}macros: ${esc(mt.macros.word)} · rules: ${esc(mt.rules.word)}</div>` : ""}
      <div>${esc(a.why)}</div>${e.drink_only || e.is_drink ? `<div class="small">A drink: it is listed on the <a href="#hydration">Hydration page</a>.</div>` : ""}</div>`;
  };
  const wform = document.getElementById("writeForm");
  document.getElementById("writeBtn").onclick = ()=>{ wform.hidden = !wform.hidden; if (!wform.hidden){ form.hidden = true; document.getElementById("writeText").focus(); } };
  document.getElementById("writeCancel").onclick = ()=>{ wform.hidden = true; };
  // opened from the Day card's "log" beside a meal: that meal picked, the pen open, the camera a tap away
  const wantLog = params().log;
  if (wantLog && MEALS.includes(wantLog)){
    const sel = document.getElementById("snapMeal"); if (sel) sel.value = wantLog;
    const w = document.getElementById("writeMeal"); if (w) w.value = wantLog;
    wform.hidden = false; form.hidden = true;
    document.getElementById("snap").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(()=> document.getElementById("writeText").focus({ preventScroll: true }), 350);
  }
  // say it: the written box opens, the phone listens, and what it heard is logged the same way
  document.getElementById("talkBtn").onclick = ()=>{
    wform.hidden = false; form.hidden = true;
    try{ wform.scrollIntoView({ behavior: "smooth", block: "center" }); }catch{}
    const t = document.getElementById("talkBtn");
    if (window.dictateInto) window.dictateInto(document.getElementById("writeText"), t, ()=> document.getElementById("writeLog").click());
    else document.getElementById("writeText").focus();
  };
  // the same words again within twenty minutes come back as a question (409): keep both resends with force
  const writeSend = async (force)=>{
    const text = document.getElementById("writeText").value.trim();
    const msg = document.getElementById("writeMsg"), btn = document.getElementById("writeLog");
    if (!text){ msg.textContent = "Write what you ate first."; document.getElementById("writeText").focus(); return; }
    if (window.primeSound) primeSound();
    btn.disabled = true; msg.textContent = "Reading it…";
    try{
      const r = await bridge("/food/text",{method:"POST",headers:J,body:JSON.stringify({ text, meal: document.getElementById("writeMeal").value || undefined, force: force ? true : undefined })});
      showVerdict(r.entry, r.day);
      wform.hidden = true; msg.textContent = ""; document.getElementById("writeText").value = ""; document.getElementById("writeMeal").value = "";
      day = r.day; draw(); cheerIf(r);
    }catch(e){
      const m409 = /^bridge 409(?: — )?(.*)$/.exec(String(e.message || ""));
      if (m409){
        msg.innerHTML = `${esc(m409[1] || "Looks like the same entry again: keep both?")} <button class="linkish" id="writeKeep">Keep both</button> <button class="linkish" id="writeDrop">No, it was one</button>`;
        document.getElementById("writeKeep").onclick = ()=> writeSend(true);
        document.getElementById("writeDrop").onclick = ()=>{ msg.textContent = ""; wform.hidden = true; document.getElementById("writeText").value = ""; };
      } else msg.textContent = "Couldn't log it — " + String(e.message).replace(/^bridge \d+ — /, "");
    }
    finally{ btn.disabled = false; }
  };
  document.getElementById("writeLog").onclick = ()=> writeSend(false);
  document.getElementById("snapLog").onclick = async ()=>{
    if (!files.length){ document.getElementById("snapMsg").textContent = "Add a photo first."; return; }
    if (window.primeSound) primeSound();
    const msg = document.getElementById("snapMsg"), btn = document.getElementById("snapLog");
    btn.disabled = true; msg.textContent = files.length > 1 ? `Reading the ${files.length} photos as one meal…` : "Reading the plate…";
    try{
      const [imgs, thumb_base64] = await Promise.all([Promise.all(files.map(f => fileToBase64(f, 1280, 0.75))), fileToBase64(files[0], 240, 0.6)]);
      const r = await bridge("/food/photo",{method:"POST",headers:J,body:JSON.stringify({
        images: imgs.map(image_base64 => ({ image_base64, media_type:"image/jpeg" })), thumb_base64,
        meal: document.getElementById("snapMeal").value || undefined,
        text: document.getElementById("snapNote").value.trim() || undefined })});
      showVerdict(r.entry, r.day);
      form.hidden = true; files = []; strip(); fileEl.value = ""; rollEl.value = ""; msg.textContent = "";
      document.getElementById("snapNote").value = ""; document.getElementById("snapMeal").value = "";
      day = r.day; draw(); cheerIf(r);
    }catch(e){ msg.textContent = "Couldn't log it — " + e.message; }
    finally{ btn.disabled = false; }
  };
};

// app.js ran nav() before this file loaded; if the page opened on #food, draw it now.
if (location.hash.replace(/^#/, "").split("?")[0] === "food") nav();
})();
