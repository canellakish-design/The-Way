"use strict";
/* THE WAY — the Ride tab: should I ride, when, and where.
   Conditions for today and tomorrow (the strips the Day page used to carry),
   the best time to ride (free on the calendar, green outside, fuel ready,
   recovery not red), and the courses ranked for that start: into the wind
   out, wind at your back home. Picking a course puts it on the planned ride
   (or makes one), and from there the Day card, the fuel curve and the food
   plan read it. Zones and the signature live at the bottom.
   Loads after app.js and uses its globals: bridge, esc, attr, hm12,
   hourStrips, WX, freeHours, H0, H1, localDateKey, nav. */
(function(){
const J = {"Content-Type":"application/json"};
const keyAdd = (k, n) => { const d = new Date(k + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); };
const mm2hm = m => String(Math.floor(m/60)).padStart(2,"0") + ":" + String(m%60).padStart(2,"0");
const hm2mm = t => { const m = /^(\d{2}):(\d{2})$/.exec(t||""); return m ? (+m[1])*60 + (+m[2]) : null; };
const isLift = n => /lift|push$|pull|upper|legs|weight|strength/i.test(n || "");
const HARD = /vo2|40\s*\/\s*20|threshold|race/i;

V.ride = async function(){
  const p = Object.fromEntries(new URLSearchParams(location.hash.split("?")[1]||""));
  const today = localDateKey();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(p.date||"") ? p.date : today;
  const dayName = date === today ? "Today" : date === keyAdd(today, 1) ? "Tomorrow" : date;
  view.innerHTML = `<span class="eyebrow">Ride</span>
    <div class="daystep"><button id="rPrev" aria-label="Previous day">‹</button><div class="daystep-label">${esc(dayName)}</div><button id="rNext" aria-label="Next day">›</button></div>
    <div id="ridePage"><div class="card"><div class="small">reading the sky and the calendar…</div></div></div>`;
  document.getElementById("rPrev").onclick = ()=>{ location.hash = "#ride?date=" + keyAdd(date, -1); };
  document.getElementById("rNext").onclick = ()=>{ location.hash = "#ride?date=" + keyAdd(date, 1); };

  const back = Math.max(0, Math.round((new Date(today) - new Date(date)) / 864e5));
  const [sched, wx, cal, food, scores] = await Promise.all([
    bridge(`/schedule?days=${Math.max(2, 2 + Math.round((new Date(date) - new Date(today)) / 864e5))}&back=${back}`).catch(()=>null),
    bridge("/weather/outlook").catch(()=>null),
    bridge(`/calendar?from=${date}&to=${date}`).catch(()=>null),
    date === today ? bridge("/food/today").catch(()=>null) : bridge(`/food/day?date=${date}`).catch(()=>null),
    bridge("/scores").catch(()=>null)
  ]);
  if (!location.hash.startsWith("#ride")) return;
  if (wx && wx.days) WX = wx.days;
  const d = sched && (sched.days||[]).find(x => x.date === date) || { date, events: [], windows: [], available_min: 0 };
  const w = WX[date];
  const calDay = cal && cal.days && cal.days[0] || { planned: [], intervals: [], done: [] };
  // the planned ride for the day: the plan's own copy first (it can hold a course), else intervals.icu's
  const planned = (calDay.planned||[]).filter(x => !isLift(x.name) && !/weight/i.test(x.sport||""))
    .map(x => ({ id: x.id, name: x.name, time: x.time || null, minutes: x.metrics ? Math.round(x.metrics.duration_s/60) : 60, course: x.course || null, hard: HARD.test(x.name||""), source: "plan", done: !!x.logged || !!(x.compliance && x.compliance.band !== "red") }))
    .concat((calDay.intervals||[]).filter(x => !/weight/i.test(x.type||"")).map(x => ({ id: null, name: x.name, time: x.time || null, minutes: x.minutes || 60, course: null, hard: HARD.test(x.name||""), source: "intervals.icu", done: false })));
  const ride = planned[0] || null;
  const rec = scores && scores.recovery && scores.recovery.band ? scores.recovery.band : null;
  const energy = food && food.energy || null;

  // ---- the windows: free and green outside, with the fuel at the start
  const cal2 = freeHours(d);
  const gradeAt = h => { const x = w && w.hours.find(q => q.hour === h); return x ? x.grade : "none"; };
  const wins = []; let run = null;
  cal2.forEach(c => { const kind = c.free ? (gradeAt(c.hour) === "good" ? "out" : gradeAt(c.hour) === "ok" ? "ok" : "in") : null;
    if (kind && run && run.kind === kind) run.h1 = c.hour + 1; else { if (run) wins.push(run); run = kind ? { h0: c.hour, h1: c.hour + 1, kind } : null; } });
  if (run) wins.push(run);
  const pctAt = hm => { if (!energy || !energy.series) return null; const m = hm2mm(hm); const pt = energy.series.find(q => q.m >= m) || energy.series[energy.series.length-1]; return pt ? pt.pct : null; };
  const need = ride && ride.hard ? 60 : (ride && ride.minutes >= 120 ? 40 : 25);
  const wxAt = h => w && w.hours.find(q => q.hour === h);
  const winRow = r => { const len = r.h1 - r.h0, x = wxAt(r.h0), pct = pctAt(mm2hm(r.h0*60));
    const fuel = pct == null ? "" : ` · fuel ${pct}%${pct >= need ? "" : ` (needs ${need})`}`;
    return `<li class="win ${r.kind}"><span class="t">${esc(hlbl(r.h0))}–${esc(hlbl(r.h1))}</span><span class="n">${len} h ${r.kind === "out" ? "outside" : r.kind === "ok" ? "outside, marginal" : "indoors"}${x ? `<span class="small"> · ${x.temp_f}°, wind ${x.wind_mph} ${esc(x.wind_from)}, ${x.rain_pct}% rain${fuel}</span>` : ""}</span>
      <span class="tag"><button class="rwin" data-h="${r.h0}" data-kind="${r.kind}">${ride && !ride.done ? "move the ride here" : "plan a ride here"}</button></span></li>`; };
  const best = wins.filter(x => x.kind === "out").sort((a, b) => (b.h1 - b.h0) - (a.h1 - a.h0))[0] || wins.filter(x => x.kind === "ok").sort((a, b) => (b.h1 - b.h0) - (a.h1 - a.h0))[0] || null;
  const startHM = ride && ride.time ? ride.time : best ? mm2hm(best.h0 * 60) : "09:00";
  const minutes = ride ? ride.minutes : 90;

  // ---- the courses for that start
  let courses = null;
  try{ courses = await bridge(`/courses?date=${date}&start=${startHM}&minutes=${minutes}`); }catch(e){ courses = { error: e.message, courses: [], zwift: [] }; }
  if (!location.hash.startsWith("#ride")) return;
  const kindWord = k => k === "headwind" ? "into the wind" : k === "tailwind" ? "wind at your back" : k === "crosswind" ? "crosswind" : "";
  const courseRow = (c, i) => `<li class="course${ride && ride.course && ride.course.id === c.id ? " picked" : ""}"><span class="t">${i+1}</span>
      <span class="n">${esc(c.name)}<span class="small"> ${c.km ? `${(c.km*0.621).toFixed(1)} mi` : ""}${c.gain_m ? ` · ${Math.round(c.gain_m*3.28)} ft` : ""}${c.est_min ? ` · about ${c.est_min} min` : ""}${c.shape ? ` · ${esc(c.shape)}` : ""}</span>
        <span class="small cwind">${c.out ? `out: ${kindWord(c.out)}${c.wind_out ? ` (${c.wind_out.mph} mph from the ${esc(c.wind_out.from)})` : ""}` : ""}${c.back ? ` · home: ${kindWord(c.back)}` : ""}</span>
        ${c.why ? `<span class="small">${esc(c.why)}</span>` : ""}</span>
      <span class="tag">${ride && ride.course && ride.course.id === c.id ? "picked" : `<button class="rpick" data-i="${i}">${ride && !ride.done && ride.id ? "ride this" : "plan this"}</button>`}</span></li>`;
  const zRow = c => `<li class="course"><span class="t">Z</span><span class="n">${esc(c.name.replace(/^Watopia · Zwift - /, "").replace(/ in Watopia$/, ""))}<span class="small"> ${c.km ? `${(c.km*0.621).toFixed(1)} mi` : ""}${c.gain_m ? ` · ${Math.round(c.gain_m*3.28)} ft` : ""}</span></span><span class="tag">Zwift</span></li>`;
  const kit = courses && courses.kit;
  const grade = courses && courses.grade;

  document.getElementById("ridePage").innerHTML = `
    <div class="card"><h4>Conditions · ${esc(d.label || dayName)}</h4>
      ${hourStrips(d)}
      ${w ? "" : `<div class="small">No forecast for this day yet.</div>`}
    </div>
    <div class="card"><h4>Best time to ride</h4>
      ${ride ? `<div class="cue"><b>Planned:</b> ${esc(ride.name)}${ride.time ? ` at ${esc(hm12(ride.time))}` : ", no time yet"} · ${ride.minutes} min${ride.course ? ` · ${esc(ride.course.name)}` : ""}${ride.done ? " · ridden" : ""}${ride.time && !ride.done ? (() => { const g = gradeAt(hm2mm(ride.time)/60|0); const pct = pctAt(ride.time); return `<div class="small">${g === "good" ? "Green outside at that hour" : g === "ok" ? "Marginal outside at that hour" : g === "bad" ? "Red outside at that hour: indoors, or move it" : "No forecast for that hour"}${pct != null ? ` · fuel ${pct}% at the start${pct >= need ? ", enough" : `, short of the ${need}% it wants`}` : ""}${(() => { const es = energy && (energy.sessions||[]).find(s => s.time === ride.time); return es && es.ready_at && !es.ready_now ? ` · ready at ${esc(hm12(es.ready_at))}` : ""; })()}</div>`; })() : ""}</div>` : `<div class="small">Nothing planned for this day.</div>`}
      ${rec ? `<div class="small">Recovery ${esc(rec.word || "")}${rec.tone === "bad" ? ": keep it easy or move the hard day" : ""}.</div>` : ""}
      ${wins.length ? `<ul class="agenda wins">${wins.map(winRow).join("")}</ul>` : `<div class="small">No free window between ${hlbl(H0)} and ${hlbl(H1)}.</div>`}
      ${kit && kit.items ? `<div class="small"><b>Wear</b> (${esc(hm12(startHM))}, feels ${kit.feels_low_f}°): ${kit.items.map(esc).join(", ")}.</div>` : ""}
      <div class="small" id="rMsg"></div>
    </div>
    <div class="card"><h4>Courses for a ${esc(hm12(startHM))} start${grade ? ` · <span style="color:${grade === "good" ? "var(--green)" : grade === "ok" ? "var(--amber)" : "var(--red)"}">${grade === "good" ? "green outside" : grade === "ok" ? "marginal" : "indoors"}</span>` : ""}</h4>
      ${courses && courses.wind ? `<div class="small">Wind over the ride: ${courses.wind.mph} mph from the ${esc(courses.wind.from)}${courses.wind.gust_mph > courses.wind.mph + 8 ? `, gusts ${courses.wind.gust_mph}` : ""}. Ranked for the wind at your back on the way home.</div>` : ""}
      ${courses && courses.courses && courses.courses.length ? `<ul class="agenda courses">${courses.courses.map(courseRow).join("")}</ul>` : `<div class="small">${esc((courses && (courses.note || courses.error)) || "No outdoor routes yet.")}</div>`}
      ${courses && courses.zwift && courses.zwift.length ? `<details class="why"${grade === "bad" ? " open" : ""}><summary>indoors: Zwift routes</summary><ul class="agenda courses">${courses.zwift.map(zRow).join("")}</ul></details>` : ""}
      <details class="why"><summary>how the courses are ranked</summary><div class="small">Each route is read as two halves, the heading of each the distance-weighted mean of its segments. The forecast wind over each half, from the start chosen above, reads as headwind, crosswind or tailwind against that heading. A tailwind home scores three, a crosswind home one and a half, a headwind out one more (the legs are fresh for it); a route far from the time planned loses points. Routes come from RideWithGPS when it is connected, otherwise from the roads Strava has seen you ride, grouped by name.</div></details>
    </div>
    <div class="card"><h4>Zones and the signature</h4><div class="small">Power and heart-rate zones, the three numbers of the signature, the best efforts and the breakthroughs.</div><div class="rowbtns"><a class="btn" href="#zones">Open</a></div></div>`;

  const msg = t => { const el = document.getElementById("rMsg"); if (el) el.textContent = t || ""; };
  // a course onto the ride: the plan's own ride takes it in place; otherwise a new ride is made at the start
  const putCourse = async (c, startAt) => {
    const course = { id: c.id, name: c.name, km: c.km, gain_m: c.gain_m, bearing_out: c.bearing_out, bearing_back: c.bearing_back, virtual: !!c.virtual };
    if (ride && ride.id && !ride.done) {
      await bridge("/workouts/" + encodeURIComponent(ride.id), { method: "PUT", headers: J, body: JSON.stringify({ course, time: startAt || ride.time || null }) });
      msg(`${c.name} is on ${ride.name}${startAt ? ` at ${hm12(startAt)}` : ""}.`);
    } else {
      const mins = ride ? ride.minutes : (c.est_min || 90);
      await bridge("/workouts", { method: "POST", headers: J, body: JSON.stringify({ name: `Zone 1, ${mins} min · ${c.name}`, sport: "Ride", date, time: startAt || startHM, course,
        notes: `Course: ${c.name}. ${c.why || ""}`.trim(), steps: [{ kind: "step", label: "Zone 1", dur_s: mins * 60, target: { type: "free" } }] }) });
      msg(`Planned: Zone 1, ${mins} min on ${c.name} at ${hm12(startAt || startHM)}. It is on the calendar and the Day card.`);
    }
    setTimeout(()=> V.ride(), 900);
  };
  document.querySelectorAll(".rpick").forEach(b => b.onclick = async ()=>{ b.disabled = true; try{ await putCourse(courses.courses[+b.dataset.i]); }catch(e){ msg(e.message); b.disabled = false; } });
  document.querySelectorAll(".rwin").forEach(b => b.onclick = async ()=>{
    const h = +b.dataset.h, at = mm2hm(h * 60); b.disabled = true;
    try{
      if (ride && ride.id && !ride.done) { await bridge("/workouts/" + encodeURIComponent(ride.id), { method: "PUT", headers: J, body: JSON.stringify({ time: at })}); msg(`${ride.name} moved to ${hm12(at)}.`); }
      else if (ride && !ride.id) { msg(`${ride.name} is planned in intervals.icu; move it there, or plan a ride here and it takes the window.`); b.disabled = false; return; }
      else { const mins = 90; await bridge("/workouts", { method: "POST", headers: J, body: JSON.stringify({ name: `Zone 1, ${mins} min`, sport: b.dataset.kind === "in" ? "VirtualRide" : "Ride", date, time: at, notes: "Planned from the Ride tab.", steps: [{ kind: "step", label: "Zone 1", dur_s: mins * 60, target: { type: "free" } }] }) }); msg(`Planned: Zone 1, ${mins} min at ${hm12(at)}. Pick a course below.`); }
      setTimeout(()=> V.ride(), 900);
    }catch(e){ msg(e.message); b.disabled = false; }
  });
};

if (location.hash.replace(/^#/, "").split("?")[0] === "ride") nav();
})();
