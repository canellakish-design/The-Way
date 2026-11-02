"use strict";
/* THE WAY — the Ride tab: should I ride, when, and where.
   A big conditions letter for right now (or the day's best hours), every ride
   of the day as a row, the day as a ribbon of graded hours with the best time
   to ride under it (free on the calendar, green outside, fuel ready, recovery
   not red), fitness in three fields, and the courses ranked for that start: into the wind
   out, wind at your back home. Picking a course puts it on the planned ride
   (or makes one), and from there the Day card, the fuel curve and the food
   plan read it. Zones and the planning numbers live at the bottom.
   Loads after app.js and uses its globals: bridge, esc, attr, hm12,
   windSVG, WX, freeHours, H0, H1, localDateKey, nav. */
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
  const planned = (calDay.planned||[]).filter(x => !isLift(x.name) && !/weight|^run$|virtualrun|walk|hike/i.test(x.sport||"") && !/\brun\b|treadmill/i.test(x.name||""))
    .map(x => ({ id: x.id, name: x.name, time: x.time || null, minutes: x.metrics ? Math.round(x.metrics.duration_s/60) : 60, course: x.course || null, hard: HARD.test(x.name||""), source: "plan", sport: x.sport || null, compliance: x.compliance || null, done: !!x.logged || !!(x.compliance && x.compliance.band !== "red") }))
    .concat((calDay.intervals||[]).filter(x => !/weight/i.test(x.type||"")).map(x => ({ id: null, name: x.name, time: x.time || null, minutes: x.minutes || 60, course: null, hard: HARD.test(x.name||""), source: "intervals.icu", done: false })));
  for (const x of planned) x.ridden = !!x.compliance;
  // the ride the page is about: the next one not yet ridden, else the last one of the day
  const ride = planned.find(x => !x.ridden && !x.done) || planned[planned.length - 1] || null;
  const rec = scores && scores.recovery && scores.recovery.band ? scores.recovery.band : null;
  const energy = food && food.energy || null;

  // ---- the windows: free and green outside, with the fuel at the start
  const cal2 = freeHours(d);
  const gradeAt = h => { const x = w && w.hours.find(q => q.hour === h); return x ? x.grade : "none"; };
  const wins = []; let run = null;
  cal2.forEach(c => { const kind = c.free ? (gradeAt(c.hour) === "good" ? "out" : gradeAt(c.hour) === "ok" ? "ok" : "in") : null;
    if (kind && run && run.kind === kind) run.h1 = c.hour + 1; else { if (run) wins.push(run); run = kind ? { h0: c.hour, h1: c.hour + 1, kind } : null; } });
  if (run) wins.push(run);
  // today: a window already gone is not offered, and one under way starts now
  if (date === today){ const nowH = new Date().getHours(); for (let i = wins.length - 1; i >= 0; i--){ if (wins[i].h1 <= nowH) wins.splice(i, 1); else if (wins[i].h0 < nowH) wins[i].h0 = nowH; } }
  const pctAt = hm => { if (!energy || !energy.series) return null; const m = hm2mm(hm); const pt = energy.series.find(q => q.m >= m) || energy.series[energy.series.length-1]; return pt ? pt.pct : null; };
  const need = ride && ride.hard ? 60 : (ride && ride.minutes >= 120 ? 40 : 25);
  const wxAt = h => w && w.hours.find(q => q.hour === h);
  const winRow = r => { const len = r.h1 - r.h0, x = wxAt(r.h0), pct = pctAt(mm2hm(r.h0*60));
    const fuel = pct == null ? "" : ` · fuel ${pct}%${pct >= need ? "" : ` (needs ${need})`}`;
    const cg = w ? condGrade(w.hours.filter(h => h.hour >= r.h0 && h.hour < r.h1)) : null;
    return `<li class="win ${r.kind}"><span class="t">${esc(hlbl(r.h0))}–${esc(hlbl(r.h1))}</span><span class="n">${gradeBadge(cg)}${len} h ${r.kind === "out" ? "outside" : r.kind === "ok" ? "outside, marginal" : "indoors"}${x ? `<span class="small"> · ${x.temp_f}°, wind ${x.wind_mph} ${esc(x.wind_from)}, ${x.rain_pct}% rain${fuel}</span>` : ""}</span>
      <span class="tag"><button class="rwin" data-h="${r.h0}" data-kind="${r.kind}">${ride && !ride.done ? "move the ride here" : "plan a ride here"}</button></span></li>`; };
  const best = wins.filter(x => x.kind === "out").sort((a, b) => (b.h1 - b.h0) - (a.h1 - a.h0))[0] || wins.filter(x => x.kind === "ok").sort((a, b) => (b.h1 - b.h0) - (a.h1 - a.h0))[0] || null;
  const startHM = ride && ride.time ? ride.time : best ? mm2hm(best.h0 * 60) : "09:00";
  const minutes = ride ? ride.minutes : 90;

  // ---- the courses for that start
  let courses = null;
  try{ courses = await bridge(`/courses?date=${date}&start=${startHM}&minutes=${minutes}`); }catch(e){ courses = { error: e.message, courses: [], zwift: [] }; }
  if (!location.hash.startsWith("#ride")) return;
  const kindWord = k => k === "headwind" ? "into the wind" : k === "tailwind" ? "wind at your back" : k === "crosswind" ? "crosswind" : "";
  // A course's shape, 64 by 64. The /courses answer carries no coordinates today (only the start, the mean
  // heading of each half and a shape word), so the drawing is a neutral schematic: the out leg drawn along
  // bearing_out, the leg home along bearing_back, joined as the shape word says. If the answer ever carries
  // real points (points / coords / latlng, each {lat, lng} or [lat, lng]) they are drawn as a polyline.
  // With neither, a plain neutral route icon.
  const fit = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = 48 / Math.max(x1 - x0, y1 - y0, 1e-9), ox = 32 - (x0 + x1) / 2 * s, oy = 32 - (y0 + y1) / 2 * s;
    return pts.map(p => [+(p[0] * s + ox).toFixed(1), +(p[1] * s + oy).toFixed(1)]); };
  const shapeSVG = c => {
    const raw = c.points || c.coords || c.latlng || null;
    let pts = null, closed = false, dim = true;
    if (Array.isArray(raw) && raw.length > 2){
      const ll = raw.map(p => Array.isArray(p) ? [p[1], p[0]] : [p.lng != null ? p.lng : p.lon, p.lat]).filter(p => p[0] != null && p[1] != null);
      const k = Math.cos((ll[0][1] || 0) * Math.PI / 180), step = Math.max(1, Math.floor(ll.length / 120));
      pts = ll.filter((p, i) => i % step === 0 || i === ll.length - 1).map(p => [p[0] * k, -p[1]]); dim = false;
    } else if (c.bearing_out != null && c.bearing_back != null){
      const v = (b, r) => [Math.sin(b * Math.PI / 180) * r, -Math.cos(b * Math.PI / 180) * r];
      const o = v(c.bearing_out, 1), side = v(c.bearing_out + 90, 0.5);
      if (c.shape === "out and back") pts = [[0, 0], o];
      else if (c.shape === "loop"){ const h = v(c.bearing_back, 1); pts = [[0, 0], [o[0] * .55 + side[0], o[1] * .55 + side[1]], o, [o[0] - h[0] * .45 - side[0], o[1] - h[1] * .45 - side[1]], [0, 0]]; closed = true; }
      else { const h = v(c.bearing_back, .8); pts = [[0, 0], o, [o[0] + h[0], o[1] + h[1]]]; }
    }
    if (!pts) return `<svg class="rd-shape" viewBox="0 0 64 64" aria-hidden="true"><path d="M20 46 C12 34 20 18 34 18 S52 30 46 42 S28 54 20 46Z" fill="none" stroke="var(--line)" stroke-width="2.5"/><circle cx="20" cy="46" r="3.5" fill="var(--muted)"/></svg>`;
    const f = fit(pts), d = closed ? `M${f[0].join(" ")} C${f[1].join(" ")} ${f[2].join(" ")} ${f[2].join(" ")} S${f[3].join(" ")} ${f[4].join(" ")}` : `M${f.map(p => p.join(" ")).join(" L")}`;
    return `<svg class="rd-shape" viewBox="0 0 64 64" aria-hidden="true"><path d="${d}" fill="none" stroke="${dim ? "var(--muted)" : "var(--green)"}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${f[0][0]}" cy="${f[0][1]}" r="3.5" fill="var(--ink)"/></svg>`;
  };
  const isPicked = c => !!(ride && ride.course && ride.course.id === c.id);
  const courseRow = (c, i) => `<li class="rd-course${isPicked(c) ? " picked" : ""}">${shapeSVG(c)}
      <div class="rd-cbody"><div class="rd-chead"><b class="rd-cname"><span class="rd-rank">${i+1}</span>${esc(c.name)}</b>${isPicked(c) ? `<span class="hu-chip hu-go">picked</span>` : `<button class="rpick" data-i="${i}">${ride && !ride.done && ride.id ? "ride this" : "plan this"}</button>`}</div>
        <div class="rd-csum">${[c.km ? `${(c.km*0.621).toFixed(1)} mi` : "", c.gain_m ? `${Math.round(c.gain_m*3.28)} ft` : "", c.est_min ? `about ${c.est_min} min` : "", c.shape ? esc(c.shape) : ""].filter(Boolean).join(" · ")}<br>
        ${c.out ? `<b>Out</b> ${kindWord(c.out)}${c.wind_out ? ` (${c.wind_out.mph} mph from the ${esc(c.wind_out.from)})` : ""}` : ""}${c.back ? `${c.out ? " · " : ""}<b>home</b> ${kindWord(c.back)}` : ""}${!c.out && !c.back ? "no heading for this route yet" : ""}</div>
        ${c.why ? `<div class="rd-cwhy">${esc(c.why)}</div>` : ""}</div></li>`;
  const zRow = c => `<li class="course"><span class="t">Z</span><span class="n">${esc(c.name.replace(/^Watopia · Zwift - /, "").replace(/ in Watopia$/, ""))}<span class="small"> ${c.km ? `${(c.km*0.621).toFixed(1)} mi` : ""}${c.gain_m ? ` · ${Math.round(c.gain_m*3.28)} ft` : ""}</span></span><span class="tag">Zwift</span></li>`;
  const kit = courses && courses.kit;
  const grade = courses && courses.grade;

  // the first thing on the page: a large grade for the conditions right now (or the day's best hours when
  // the day is not today), with the three facts that made it and what to wear
  const SKYW = { sun: "sunny", moon: "clear", partly: "partly cloudy", "partly-night": "partly cloudy", cloud: "overcast", fog: "fog", drizzle: "drizzle", rain: "rain", snow: "snow", thunder: "thunder" };
  const nowH = new Date().getHours();
  const hNow = w && date === today ? w.hours.find(h => h.hour === nowH) : null;
  let top = null; if (w && !hNow){ for (let a = H0; a + 2 <= H1 + 1; a++){ const g = condGrade(w.hours.filter(h => h.hour >= a && h.hour < a + 2)); if (g && (!top || g.score > top.g.score)) top = { a, g }; } }
  const gNow = hNow ? condGrade([hNow]) : top ? top.g : null;
  const riseMin = w && w.sunrise ? hm2mm(w.sunrise) : null, setMin = w && w.sunset ? hm2mm(w.sunset) : null;
  // an hour is dark when its middle is outside sunrise to sunset (else the forecast's own day flag)
  const isDark = h => riseMin != null && setMin != null ? (h.hour * 60 + 30 < riseMin || h.hour * 60 + 30 > setMin) : h.is_day === false;
  const hFacts = h => { const dark = isDark(h);
    return { big: `${h.temp_f}° · ${h.wind_mph} mph ${esc(h.wind_from)}`,
      line: [`feels ${h.feels_f}°`, h.gust_mph > h.wind_mph + 8 ? `gusts ${h.gust_mph}` : "", dark ? "dark" : setMin != null ? `light till ${esc(hm12(w.sunset))}` : "", h.rain_pct >= 20 ? `${h.rain_pct}% rain` : "dry", h.sky && SKYW[h.sky] ? SKYW[h.sky] : ""].filter(Boolean).join(" · ") }; };
  const rideH0 = ride && ride.time ? (hm2mm(ride.time)/60|0) : null;
  const rideH1 = ride && ride.time ? Math.max(rideH0 + 1, Math.ceil((hm2mm(ride.time) + (ride.minutes || 60))/60)) : null;
  const rideG = ride && ride.time && w ? condGrade(w.hours.filter(h => h.hour >= rideH0 && h.hour < rideH1)) : null;
  const heroH = hNow || (top && w.hours.find(h => h.hour === top.a));
  const wear = kit && kit.items ? `<div class="rd-wear"><span class="hu-lab">Wear at ${esc(hm12(startHM))} · feels ${kit.feels_low_f}°</span>${kit.items.map(esc).join(", ")}.</div>` : "";
  const hero = gNow && heroH ? (() => { const f = hFacts(heroH); return `<section class="rd-hero">
      <span class="rd-letter g-${gNow.tier}" title="${attr(`conditions ${gNow.letter}${gNow.why.length ? ": " + gNow.why.join(", ") : ""}`)}">${gNow.letter}</span>
      <div class="rd-facts"><span class="hu-lab">${hNow ? `Right now · ${esc(hlbl(nowH))}` : `Best of ${esc(dayName.toLowerCase())} · ${esc(hlbl(top.a))}–${esc(hlbl(top.a + 2))}`}</span>
        <span class="hu-n rd-big">${f.big}</span>
        <span class="rd-line">${f.line}</span>
        <span class="rd-why">${gNow.why.length ? esc(gNow.why.join(" · ")) : "nothing against it"}</span></div>
      ${wear}</section>`; })() : `<section class="rd-hero none"><div class="small">${w ? "No grade for these hours." : "No forecast for this day yet."}</div>${wear}</section>`;

  // the ride the page is about, planned or ridden, with how its hours read
  const rideDetail = ride && ride.time && !ride.done ? (() => { const pct = pctAt(ride.time); const endMin = hm2mm(ride.time) + (ride.minutes || 60), pastDark = setMin != null && endMin > setMin;
    const es = energy && (energy.sessions||[]).find(s => s.time === ride.time);
    return `${rideG ? `over the ride${rideG.why.length ? ": " + esc(rideG.why.join(", ")) : ", nothing against it"}${pastDark ? ` · dark after ${esc(hm12(w.sunset))}` : ""}` : "No forecast for those hours"}${pct != null ? ` · fuel ${pct}% at the start${pct >= need ? ", enough" : `, short of the ${need}% it wants`}` : ""}${es && es.ready_at && !es.ready_now ? ` · ready at ${esc(hm12(es.ready_at))}` : ""}`; })() : "";
  // every ride session of the day, one row each (rides only: `planned` already drops lifts, runs and walks);
  // `ride` stays the one the grade and the ribbon are about, and its row carries the grade over its hours
  const toneOf = x => x.compliance ? (x.compliance.band === "green" ? "good" : x.compliance.band === "yellow" ? "warn" : "bad") : x.done ? "good" : "";
  const chipOf = x => x.compliance ? `<span class="hu-chip ${x.compliance.band === "green" ? "hu-go" : x.compliance.band === "yellow" ? "hu-hold" : "hu-stop"}">${x.compliance.pct != null ? `${x.compliance.pct}%` : "ridden"}</span>` : x.done ? `<span class="hu-chip hu-go">ridden</span>` : `<span class="hu-chip hu-dim">to ride</span>`;
  const rideRow = x => { const graded = x === ride, g = graded ? rideG : null;
    return `<li class="rd-ride hu-stripe ${toneOf(x) || (g ? (g.tier === "a" || g.tier === "b" ? "good" : g.tier === "c" ? "warn" : "bad") : "")}${graded ? " graded" : ""}">
      <span class="rd-rt">${x.time ? esc(hm12(x.time)) : "no time"}</span>
      <span class="rd-rb"><span class="rd-rname">${kindIcon(x.name, x.sport)}${esc(x.name)}${new RegExp(`\\b${x.minutes}\\s*min\\b`).test(x.name || "") ? "" : ` · ${x.minutes} min`}${x.course ? ` · ${esc(x.course.name)}` : ""}</span>
        ${x.compliance && x.compliance.basis ? `<span class="rd-rsub">${esc(String(x.compliance.basis).split(";")[0])}</span>` : ""}
        ${graded && x.time ? `<span class="rd-rsub">${g ? `<span class="rd-rg g-${g.tier}">${g.letter}</span>` : ""}${rideDetail || (g ? `over the ride${g.why.length ? ": " + esc(g.why.join(", ")) : ", nothing against it"}` : "")}</span>` : ""}
        ${x.source === "intervals.icu" ? `<span class="rd-rsub">planned in intervals.icu</span>` : ""}</span>
      <span class="rd-rc">${chipOf(x)}</span></li>`; };
  const rideLine = planned.length ? `<section class="rd-rides"><span class="hu-lab">${planned.length > 1 ? `${planned.length} rides` : planned[0].ridden || planned[0].done ? "Ridden" : "Planned"} · ${esc(dayName.toLowerCase())}</span><ul>${planned.map(rideRow).join("")}</ul></section>`
    : `<section class="rd-rides"><span class="hu-lab">Nothing planned for this day</span></section>`;

  // the day as a ribbon: one cell an hour, coloured by the hour's grade, dark hours hatched, the ride's hours
  // outlined, the wind above and the hour under; a grey bar under an hour the calendar has busy.
  // A free hour is a link to the workout builder at that hour, as the old strip's windows were.
  const n = H1 - H0 + 1, hrs = []; for (let h = H0; h <= H1; h++) hrs.push(h);
  const calBy = Object.fromEntries(cal2.map(c => [c.hour, c]));
  const GW = { good: "good outside", ok: "marginal outside", bad: "indoors" };
  const cell = h => { const x = wxAt(h), c = calBy[h] || { free: true, names: [] }, g = x ? x.grade : "none", dark = x ? isDark(x) : false, past = date === today && h < nowH;
    const tip = `${hlbl(h)}: ${x ? `${condGrade([x]) ? condGrade([x]).letter + ", " : ""}${GW[g] || ""}${x.why && x.why.length ? " (" + x.why.join(", ") + ")" : ""} · ${x.temp_f}°, wind ${x.wind_mph} ${x.wind_from}` : "no forecast"}${dark ? " · dark" : ""}${c.free ? " · free" : " · busy: " + c.names.join(", ")}`;
    const cls = `rd-h g-${g}${dark ? " dark" : ""}${past ? " past" : ""}${c.free ? "" : " busy"}`;
    return c.free ? `<a class="${cls}" href="#workout?date=${esc(date)}&time=${String(h).padStart(2,"0")}:00&where=${g === "good" ? "out" : "in"}" title="${attr(tip)}" aria-label="${attr(tip)}"></a>` : `<span class="${cls}" title="${attr(tip)}"></span>`; };
  const boxOf = x => { if (!x.time) return ""; const h0 = hm2mm(x.time)/60|0, h1 = Math.max(h0 + 1, Math.ceil((hm2mm(x.time) + (x.minutes || 60))/60));
    if (h1 <= H0 || h0 > H1) return ""; const a = Math.max(H0, h0) - H0, b = Math.min(H1 + 1, h1) - H0;
    return `<span class="rd-rbox" style="left:calc(${a}/${n}*100% - 2px);width:calc(${b - a}/${n}*100% + 2px)" aria-hidden="true"></span>`; };
  const rideBox = planned.filter(x => x === ride || (!x.ridden && !x.done)).map(boxOf).join("");
  const ribbon = `<div class="rd-ribbon" style="--n:${n}">
      ${w ? `<div class="rd-wind" aria-hidden="true">${hrs.map(h => { const x = wxAt(h); return `<span>${x ? `${windSVG(x.wind_deg, x.wind_mph)}<i>${x.wind_mph}</i>` : ""}</span>`; }).join("")}</div>` : ""}
      <div class="rd-cells">${hrs.map(cell).join("")}${rideBox}</div>
      <div class="rd-hl" aria-hidden="true">${hrs.map((h, i) => `<span>${i % 2 ? "" : hlbl(h)}</span>`).join("")}</div></div>`;
  const len = r => r.h1 - r.h0;
  const pick = best || wins[0] || null;
  const winWord = r => r.kind === "out" ? "outside" : r.kind === "ok" ? "outside, marginal" : "indoors only";
  const bestLine = `<div class="rd-best"><span>${pick ? `<b>${best ? "Best" : "Free"}: ${esc(hlbl(pick.h0))}–${esc(hlbl(pick.h1))}</b>, ${len(pick)} h ${winWord(pick)}` : `No free window between ${hlbl(H0)} and ${hlbl(H1)}`}${rec ? ` · recovery ${esc(rec.word || "")}${rec.tone === "bad" ? ": keep it easy or move the hard day" : ""}` : ""}.</span>
      ${pick ? `<button class="rwin" data-h="${pick.h0}" data-kind="${pick.kind}">${ride && !ride.done ? "move the ride here" : "plan a ride here"}</button>` : ""}</div>`;
  const hourRow = h => { const x = wxAt(h), c = calBy[h]; if (!x && (!c || c.free)) return "";
    return `<li><span class="t">${esc(hlbl(h))}</span><span class="n">${x ? `${gradeBadge(condGrade([x]))}${x.temp_f}°, feels ${x.feels_f} · wind ${x.wind_mph} ${esc(x.wind_from)}${x.gust_mph > x.wind_mph + 8 ? ` g${x.gust_mph}` : ""} · ${x.rain_pct}% rain${x.sky && SKYW[x.sky] ? ` · ${SKYW[x.sky]}` : ""}${isDark(x) ? " · dark" : ""}` : "no forecast"}${c && !c.free ? `<span class="small"> · busy: ${esc(c.names.join(", "))}</span>` : ""}</span></li>`; };

  // fitness (the 42-day load) and the four-week progress: three fields, the list and the line in a fold
  const tr = scores && scores.training, ser = (scores && scores.series || []).slice(-42);
  const sparkCtl = (()=>{ if (ser.length < 2) return ""; const vs = ser.map(p => p.ctl), lo = Math.min(...vs), hi = Math.max(...vs), sp = hi - lo || 1;
    const pts = vs.map((v, i) => `${(i / (vs.length - 1) * 156 + 2).toFixed(1)},${(52 - (v - lo) / sp * 46).toFixed(1)}`).join(" ");
    return `<svg class="ctlspark" viewBox="0 0 160 56" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`; })();
  const fitness = `<section class="rd-sec"><span class="hu-lab">Fitness and progress</span>
      <div class="hu-fields rd-fields">
        <div class="hu-field"><span class="k">Fitness</span><span class="n">${tr ? Math.round(tr.ctl) : "—"}</span><span class="u">${tr ? `${tr.ramp_7d >= 0 ? "+" : ""}${tr.ramp_7d}/wk${tr.ramp && tr.ramp.word ? ` · ${esc(tr.ramp.word)}` : ""}` : "no load yet"}</span></div>
        <div class="hu-field" id="rdP5"><span class="k">5-min</span><span class="n">—</span><span class="u">W</span></div>
        <div class="hu-field" id="rdTp"><span class="k">Threshold</span><span class="n">—</span><span class="u">W</span></div>
      </div>
      <details class="why"><summary>progress, four weeks</summary>
        ${tr ? `<div class="rd-fit">${sparkCtl}<div class="small">Fitness, ${Math.round(tr.ctl)} base: the 42-day average of the riding load, against the planning FTP. Lifting never counts toward it.</div></div>` : ""}
        <div class="progress" id="progress" hidden></div>
      </details></section>`;

  document.getElementById("ridePage").innerHTML = `
    ${hero}
    ${rideLine}
    <section class="rd-sec"><span class="hu-lab">The day · ${esc(d.label || dayName)}${w && w.sunrise ? ` · light ${esc(hm12(w.sunrise))}–${esc(hm12(w.sunset))}` : ""}</span>
      ${ribbon}
      ${w ? "" : `<div class="small">No forecast for this day yet.</div>`}
      ${bestLine}
      <div class="small" id="rMsg"></div>
      <details class="why"><summary>every window, hour by hour</summary>
        ${wins.length ? `<ul class="agenda wins">${wins.map(winRow).join("")}</ul>` : `<div class="small">No free window between ${hlbl(H0)} and ${hlbl(H1)}.</div>`}
        <div class="small rd-key">Cells: green good outside, amber marginal, red indoors; hatched dark; outlined your ride; a grey bar under a busy hour. Tap a free hour to build a workout there.</div>
        ${w ? `<ul class="rd-hours">${hrs.map(hourRow).join("")}</ul>` : ""}
      </details>
      <details class="why"><summary>how the grade works</summary><div class="small glegend">Conditions grade, A+ a perfect day to F unridable: feels-like temperature (a point a degree under 55°, three a degree under 40°), wind on your bands (under 12 green, 12 to 15 amber, over 15 red), gusts, rain and daylight over the hours of the ride, leaning on the worst hour.</div></details>
    </section>
    ${fitness}
    <section class="rd-sec"><span class="hu-lab">Courses for ${esc(hm12(startHM))}${grade ? ` · <span class="${grade === "good" ? "hu-go" : grade === "ok" ? "hu-hold" : "hu-stop"}">${grade === "good" ? "green outside" : grade === "ok" ? "marginal" : "indoors"}</span>` : ""}</span>
      ${courses && courses.wind ? `<div class="small rd-cwind">Wind over the ride: ${courses.wind.mph} mph from the ${esc(courses.wind.from)}${courses.wind.gust_mph > courses.wind.mph + 8 ? `, gusts ${courses.wind.gust_mph}` : ""}. Ranked for the wind at your back on the way home.</div>` : ""}
      ${courses && courses.courses && courses.courses.length ? `<ul class="rd-courses">${courses.courses.map(courseRow).join("")}</ul>` : `<div class="small">${esc((courses && (courses.note || courses.error)) || "No outdoor routes yet.")}</div>`}
      ${courses && courses.zwift && courses.zwift.length ? `<details class="why"${grade === "bad" ? " open" : ""}><summary>indoors: Zwift routes</summary><ul class="agenda courses">${courses.zwift.map(zRow).join("")}</ul></details>` : ""}
      <details class="why"><summary>how the courses are ranked</summary><div class="small">Each route is read as two halves, the heading of each the distance-weighted mean of its segments. The forecast wind over each half, from the start chosen above, reads as headwind, crosswind or tailwind against that heading. A tailwind home scores three, a crosswind home one and a half, a headwind out one more (the legs are fresh for it); a route far from the time planned loses points. Routes come from RideWithGPS when it is connected, otherwise from the roads Strava has seen you ride, grouped by name. The little drawing is a sketch from each half's heading, not the map.</div></details>
    </section>
    <a class="rd-link hu-stripe" href="#zones"><span><b>Zones and the signature</b><span class="small">Power and heart-rate zones, the three numbers of the signature, the best efforts and the breakthroughs.</span></span><span class="rd-go" aria-hidden="true">›</span></a>
    <details class="why rd-plan"><summary>Planning numbers</summary><div class="small">The FTP every zone and target follows. Yours to set; the signature on the Zones page is the evidence, never the hand that writes it.</div><div id="pSettings" class="small">loading…</div></details>`;
  bridge("/workouts/settings").then(st => { if (location.hash.startsWith("#ride") && window.drawPlanningNumbers) window.drawPlanningNumbers(st); }).catch(()=>{ const el = document.getElementById("pSettings"); if (el) el.textContent = "bridge unreachable"; });

  // the progress list fills the fold; its five-minute and threshold numbers fill the two fields
  const field = (id, m) => { const el = document.getElementById(id); if (!el || !m) return;
    const n = el.querySelector(".n"), u = el.querySelector(".u");
    n.textContent = m.now == null ? "—" : String(Math.round(m.now));
    n.className = "n " + (m.state === "good" ? "hu-go" : m.state === "warn" ? "hu-hold" : m.state === "bad" ? "hu-stop" : "");
    u.textContent = `${m.unit || "W"}${m.delta == null ? "" : m.delta === 0 ? " · flat" : ` · ${m.delta > 0 ? "+" : "−"}${Math.abs(Math.round(m.delta))}`}`; };
  bridge("/progress").then(v => { if (!location.hash.startsWith("#ride")) return; if (typeof drawProgress === "function") drawProgress(v);
    const ms = v && v.metrics || []; field("rdP5", ms.find(m => m.key === "p5")); field("rdTp", ms.find(m => m.key === "tp")); }).catch(()=>{});
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
      else {
        // the ride is sized to the window: a light day on the calendar is a long Zone 1 day (an hour at least, two and a half at most, half an hour left to shower)
        const win = wins.find(x => x.h0 === h), lenMin = win ? (win.h1 - win.h0) * 60 : 90;
        const mins = Math.max(60, Math.min(150, Math.floor((lenMin - 30) / 15) * 15));
        await bridge("/workouts", { method: "POST", headers: J, body: JSON.stringify({ name: `Zone 1, ${mins} min`, sport: b.dataset.kind === "in" ? "VirtualRide" : "Ride", date, time: at, notes: `Planned from the Ride tab, sized to a ${Math.round(lenMin / 60 * 10) / 10} h window.`, steps: [{ kind: "step", label: "Zone 1", dur_s: mins * 60, target: { type: "free" } }] }) }); msg(`Planned: Zone 1, ${mins} min at ${hm12(at)}, sized to the window. Pick a course below.`); }
      setTimeout(()=> V.ride(), 900);
    }catch(e){ msg(e.message); b.disabled = false; }
  });
};

if (location.hash.replace(/^#/, "").split("?")[0] === "ride") nav();
})();
