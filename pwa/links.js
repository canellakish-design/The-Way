"use strict";
/* THE WAY — one page for each link of the chain (#hydration, #fuel, #sleep,
   #recovery, #weight, #micros). Tapping a box on the Day page comes here: the
   graph or the numbers first, the way to log right under them, then the week
   and how the link is scored. Plan, Macros, Lift and Ride open their own full
   pages (#calendar, #food, #lift, #ride). Loads after app.js and food.js and
   uses their globals: V, view, bridge, esc, hm12, todayCell, foodBits. */
(function(){
  const J = { "Content-Type": "application/json" };
  const get = p => bridge(p).catch(() => null);
  const TC = { good: "var(--green)", warn: "var(--amber)", bad: "var(--red)", none: "var(--muted)" };
  const WEEKNUM = (ck, L) => L.week == null ? "—" : ["work","water","lift","plan","fuel"].includes(ck) ? `${L.week}%`
    : ck === "recovery" ? `${L.week > 0 ? "+" : ""}${L.week}%` : ck === "weight" ? `${L.week > 0 ? "+" : ""}${L.week} lb/wk` : ck === "sleep" ? `${L.week} h` : `${L.week}`;

  // the top of every link page: the week, today, and the one sentence that scores it
  function headHTML(ck, title, L){
    if (!L) return `<div class="card"><div class="small">loading…</div></div>`;
    const t = typeof todayCell === "function" ? todayCell(ck, L) : { num: "—", word: "", tone: "none" };
    return `<div class="card linkhead">
      <div class="lhrow">
        <div class="lh" style="border-color:${TC[L.state] || TC.none}"><span class="slabel">${esc(title)} · this week</span><span class="lhnum" style="color:${TC[L.state] || TC.none}">${esc(WEEKNUM(ck, L))}</span></div>
        <div class="lh" style="border-color:${TC[t.tone] || TC.none}"><span class="slabel">Today</span><span class="lhnum" style="color:${TC[t.tone] || TC.none}">${esc(t.num)}</span><span class="small">${esc(t.word || "")}</span></div>
      </div></div>`;
  }
  const whyHTML = L => L && L.basis ? `<details class="why"><summary>how it's scored</summary><div class="small">${esc(L.basis)}.</div></details>` : "";
  // a bar for each day of the week against a line: sleep hours, recovery scores
  function barsSVG(items, opt){
    const W = 320, H = 110, n = items.length; if (!n) return "";
    const max = opt.max, bw = W / n;
    const y = v => H - 18 - Math.max(0, Math.min(1, v / max)) * (H - 30);
    const bars = items.map((it, i) => { const v = it.v == null ? 0 : it.v; const x = i * bw + bw * 0.18, w = bw * 0.64;
      return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - 18 - y(v)).toFixed(1)}" rx="3" fill="${opt.col(it)}"><title>${esc(it.label)}: ${it.v == null ? "no data" : it.v}</title></rect>
        <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="barlab">${esc(it.short)}</text>
        <text x="${(i * bw + bw / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" text-anchor="middle" class="barval">${it.v == null ? "" : esc(String(it.v))}</text>`; }).join("");
    const line = opt.line != null ? `<line x1="0" x2="${W}" y1="${y(opt.line).toFixed(1)}" y2="${y(opt.line).toFixed(1)}" class="barline"/><text x="${W - 2}" y="${(y(opt.line) - 3).toFixed(1)}" text-anchor="end" class="barlab">${esc(opt.lineLabel || "")}</text>` : "";
    return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "")}">${line}${bars}</svg>`;
  }
  const dayShort = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);
  const dayLong = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const page = (title) => { view.innerHTML = `<span class="eyebrow">${esc(title)}</span><div id="linkPage"><div class="card"><div class="small">loading…</div></div></div>`; return document.getElementById("linkPage"); };
  const alive = h => location.hash.split("?")[0] === "#" + h;

  // ---------------- Hydration ----------------
  V.hydration = async function(){
    const el = page("Hydration");
    const draw = async ()=>{
      const [chain, food] = await Promise.all([get("/chain"), get("/food/today")]);
      if (!alive("hydration")) return;
      const L = chain && chain.links && chain.links.water, h = food && food.hydration, B = window.foodBits || {};
      const drinks = (food && food.entries || []).filter(e => !e.supplement && (e.fluid_ml > 0 || e.drink_only));
      el.innerHTML = headHTML("water", "Hydration", L) + `
        <div class="card">${h && B.hydrationHTML ? B.hydrationHTML(h) : `<div class="small">No drinks yet today.</div>`}</div>
        <div class="card"><h4>Log a drink</h4>
          <div class="quicklog">
            <button data-ml="250">Glass · 250 ml</button><button data-ml="500">Bottle · 500 ml</button><button data-ml="620">Bike bottle · 620 ml</button><button data-ml="1000">1 L</button>
          </div>
          <div class="row2"><span><label>Other amount (ml)</label><input id="hyMl" type="number" inputmode="numeric" placeholder="330"></span>
            <span><label>With salt or electrolytes</label><select id="hySalt"><option value="">plain water</option><option value="1">with electrolytes</option></select></span></div>
          <button class="primary" id="hyGo">Log it</button> <span class="small" id="hyMsg"></span>
          <div class="small">Coffee, a shake or anything with calories: log it on <a href="#food">Food</a>, where its calories count too.</div></div>
        <div class="card"><h4>Today's drinks</h4>${drinks.length ? `<ul class="agenda totals">${drinks.slice().reverse().map(e => `<li><span class="n">${esc(hm12(e.time))} · ${esc(e.name)}</span><span class="tag">${e.fluid_ml || 0} ml <button class="tdel" data-del="${esc(e.id)}" aria-label="Remove">${window.TRASH || "×"}</button></span></li>`).join("")}</ul>` : `<div class="small">None logged yet.</div>`}
          ${whyHTML(L)}</div>`;
      if (h && B.wireHydration) B.wireHydration(el, h);
      const log = async (ml, salt)=>{
        const msg = document.getElementById("hyMsg"); msg.textContent = "logging…";
        try{ await bridge("/food/item", { method: "POST", headers: J, body: JSON.stringify({ name: salt ? `Water with electrolytes, ${ml} ml` : `Water, ${ml} ml`, kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, tags: ["drink"], fluid_ml: ml, fits: "yes", why: "Water." }) }); await draw(); }
        catch(e){ msg.textContent = String(e.message).replace(/^bridge \d+ — /, ""); }
      };
      el.querySelectorAll("[data-ml]").forEach(b => b.onclick = ()=> log(+b.dataset.ml, document.getElementById("hySalt").value === "1"));
      document.getElementById("hyGo").onclick = ()=>{ const ml = +document.getElementById("hyMl").value; if (!(ml > 0 && ml <= 3000)) { document.getElementById("hyMsg").textContent = "An amount in ml, up to 3000."; return; } log(ml, document.getElementById("hySalt").value === "1"); };
      el.querySelectorAll("[data-del]").forEach(b => b.onclick = async ()=>{ if (!confirm("Remove this drink?")) return; b.disabled = true; try{ await bridge("/food/" + encodeURIComponent(b.dataset.del), { method: "DELETE" }); }catch(e){} await draw(); });
    };
    await draw();
  };

  // ---------------- Fuel ----------------
  V.fuel = async function(){
    const el = page("Fuel");
    const draw = async ()=>{
      const [chain, food] = await Promise.all([get("/chain"), get("/food/today")]);
      if (!alive("fuel")) return;
      const L = chain && chain.links && chain.links.fuel, e = food && food.energy, B = window.foodBits || {};
      const due = (food && food.supps && (food.supps.due || food.supps)) || [];
      const rx = (Array.isArray(due) ? due : []).filter(x => x.link === "fuel");
      el.innerHTML = headHTML("fuel", "Fuel", L) + `
        <div class="card">${e && B.energyHTML ? B.energyHTML(e) : `<div class="small">Starts with the first meal.</div>`}</div>
        <div class="card"><h4>Log fuel</h4>
          <div class="quicklog">
            <button data-item="tailwind">Tailwind bottle · 50 g</button><button data-item="gel">Gel · 22 g</button><button data-item="figbar">Fig bar · 38 g</button><button data-item="banana">Banana · 27 g</button>
          </div>
          <h4 style="margin-top:12px">Pre-ride supplements</h4>
          ${rx.length ? `<ul class="agenda totals">${rx.map(x => `<li><span class="n">${esc(x.name)}<span class="small"> ${x.time ? esc(hm12(x.time)) + " · " : ""}${esc(x.why || "")}</span></span><span class="tag">${x.taken ? `<span class="mword green">✓ taken</span>` : `<button class="rxlog" data-supp="${esc(x.key)}">log</button>`}</span></li>`).join("")}</ul>` : `<div class="small">None due today. Beetroot is due 2 to 3 hours before a ride, bicarbonate before a hard one.</div>`}
          <div class="quicklog"><button data-supp="beetroot">Beetroot</button><button data-supp="sodium_bicarb">Bicarbonate</button></div>
          <span class="small" id="fuMsg"></span></div>
        <div class="card"><h4>The week</h4>
          ${L && L.list && L.list.length ? `<ul class="agenda totals">${L.list.slice().reverse().map(c => `<li><span class="n">${c.time ? esc(hm12(c.time)) + " · " : ""}${esc(String(c.name || "").replace(/^Zwift - Intervals icu: /i, ""))}${c.kind === "bottle" ? " <span class='small'>· on the bike</span>" : ""}</span><span class="tag"><span class="fuelnum"><b style="color:${TC[c.ok ? "good" : c.near ? "warn" : "bad"]}">${c.kind === "bottle" ? `${c.got_g} g` : `${c.pct}%`}</b><span class="small"> / ${c.kind === "bottle" ? `${c.plan_g} g` : `${c.need}%`}</span></span></span></li>`).join("")}</ul>
            <div class="small">${L.ok} of ${L.checks} checks met${L.rx && L.rx.beetroot ? ` · beetroot ${L.rx.beetroot.taken} of ${L.rx.beetroot.due} rides` : ""}.</div>` : `<div class="small">No rides this week to check yet.</div>`}
          ${whyHTML(L)}</div>`;
      if (e && B.wireEnergy) B.wireEnergy(el, e, draw);
      const ITEMS = { tailwind: { name: "Tailwind, 2 scoops, 620 ml bottle", kcal: 200, carbs_g: 50, tags: ["drink"], fluid_ml: 620 }, gel: { name: "Energy gel", kcal: 90, carbs_g: 22, tags: [] },
        figbar: { name: "Fig bar", kcal: 200, carbs_g: 38, protein_g: 3, fat_g: 4, tags: [] }, banana: { name: "Banana", kcal: 105, carbs_g: 27, protein_g: 1, tags: ["veg"] } };
      const msg = t => { const m = document.getElementById("fuMsg"); if (m) m.textContent = t; };
      el.querySelectorAll("[data-item]").forEach(b => b.onclick = async ()=>{ const it = ITEMS[b.dataset.item]; b.disabled = true; msg("logging…");
        try{ await bridge("/food/item", { method: "POST", headers: J, body: JSON.stringify(Object.assign({ protein_g: 0, fat_g: 0, fits: "yes", why: "Fuel for the ride." }, it)) }); await draw(); }catch(err){ b.disabled = false; msg(String(err.message).replace(/^bridge \d+ — /, "")); } });
      el.querySelectorAll("[data-supp]").forEach(b => b.onclick = async ()=>{ b.disabled = true; msg("logging…");
        try{ await bridge("/food/supplement", { method: "POST", headers: J, body: JSON.stringify({ key: b.dataset.supp }) }); await draw(); }catch(err){ b.disabled = false; msg(String(err.message).replace(/^bridge \d+ — /, "")); } });
    };
    await draw();
  };

  // ---------------- Sleep ----------------
  V.sleep = async function(){
    const el = page("Sleep");
    const draw = async ()=>{
      const [chain, food] = await Promise.all([get("/chain"), get("/food/today")]);
      if (!alive("sleep")) return;
      const L = chain && chain.links && chain.links.sleep;
      const nights = (L && L.nights) || [];
      const mg = (food && food.entries || []).some(e => e.supplement && e.key === "magnesium");
      el.innerHTML = headHTML("sleep", "Sleep", L) + `
        <div class="card"><h4>The last seven nights</h4>
          ${nights.length ? barsSVG(nights.map(n => ({ v: n.hours, label: dayLong(n.date), short: dayShort(n.date) })), { max: 10, line: 7, lineLabel: "7 h", aria: "hours asleep each night", col: it => it.v >= 7 ? "var(--green)" : it.v >= 6.25 ? "var(--amber)" : "var(--red)" }) : `<div class="small">No nights from the watch yet.</div>`}
          ${nights.length ? `<ul class="agenda totals">${nights.slice().reverse().map(n => `<li><span class="n">${esc(dayLong(n.date))}${n.manual ? ` <span class="small">· ${esc(n.manual)}</span>` : ""}</span><span class="tag"><b style="color:${TC[n.hours >= 7 ? "good" : n.hours >= 6.25 ? "warn" : "bad"]}">${n.hours} h</b>${n.score != null ? ` · score ${n.score}` : ""}</span></li>`).join("")}</ul>` : ""}</div>
        <div class="card"><h4>Log last night</h4>
          <div class="small">When the watch did not sync, or another device has the night. A number entered here wins for its date.</div>
          <div class="row2"><span><label>Hours asleep</label><input id="slH" type="number" step="0.05" inputmode="decimal" placeholder="7.5"></span><span><label>Sleep score</label><input id="slS" type="number" inputmode="numeric" placeholder="80"></span></div>
          <div class="row2"><span><label>From</label><select id="slSrc"><option>Garmin</option><option>WHOOP</option><option>by hand</option></select></span><span><label>&nbsp;</label><button class="primary" id="slGo">Save the night</button></span></div>
          <span class="small" id="slMsg"></span></div>
        <div class="card"><h4>Tonight</h4>
          <div class="quicklog">${mg ? `<span class="mword green">✓ magnesium taken</span>` : `<button data-supp="magnesium">Magnesium · 200 mg</button>`}</div>
          <div class="small">An hour before bed. Bedtime that pays down the week: 9:45p.</div>
          ${whyHTML(L)}</div>`;
      document.getElementById("slGo").onclick = async ()=>{ const h = +document.getElementById("slH").value, sc = +document.getElementById("slS").value; const m = document.getElementById("slMsg");
        if (!(h > 0 && h <= 16)) { m.textContent = "Hours asleep, like 7.5."; return; }
        m.textContent = "saving…"; try{ await bridge("/wellness", { method: "POST", headers: J, body: JSON.stringify({ sleep_h: h, sleep_score: sc || undefined, source: document.getElementById("slSrc").value }) }); await draw(); }catch(e){ m.textContent = String(e.message).replace(/^bridge \d+ — /, ""); } };
      el.querySelectorAll("[data-supp]").forEach(b => b.onclick = async ()=>{ b.disabled = true; try{ await bridge("/food/supplement", { method: "POST", headers: J, body: JSON.stringify({ key: b.dataset.supp }) }); }catch(e){} await draw(); });
    };
    await draw();
  };

  // ---------------- Recovery ----------------
  V.recovery = async function(){
    const el = page("Recovery");
    const draw = async ()=>{
      const [chain, scores] = await Promise.all([get("/chain"), get("/scores")]);
      if (!alive("recovery")) return;
      const L = chain && chain.links && chain.links.recovery;
      const days = (L && L.days) || [], r = scores && scores.recovery;
      el.innerHTML = headHTML("recovery", "Recovery", L) + `
        <div class="card"><h4>The morning reading, each day</h4>
          ${days.length ? barsSVG(days.map(d => ({ v: d.score, label: `${dayLong(d.date)}${d.hrv ? `, HRV ${Math.round(d.hrv)} ms` : ""}`, short: dayShort(d.date) })), { max: 100, line: 67, lineLabel: "67", aria: "recovery score each morning", col: it => it.v >= 67 ? "var(--green)" : it.v >= 34 ? "var(--amber)" : "var(--red)" }) : `<div class="small">No mornings yet.</div>`}
          ${L && L.why ? `<div class="small"><b>The week:</b> ${esc(L.why)}${L.hrv_week_ms ? `. HRV ${L.hrv_week_ms} ms this week against ${L.hrv_base_ms} ms over 60 days` : ""}${L.rhr_week ? `; resting HR ${L.rhr_week}` : ""}.</div>` : ""}
          ${r ? `<ul class="agenda totals"><li><span class="n">This morning</span><span class="tag"><b>${r.score ?? "—"}</b>${r.band ? ` · ${esc(r.band.word)}` : ""}</span></li><li><span class="n">HRV</span><span class="tag">${r.hrv ? Math.round(r.hrv) + " ms" : "—"}</span></li><li><span class="n">Resting HR</span><span class="tag">${r.rhr ? r.rhr + " bpm" : "—"}</span></li><li><span class="n">Slept</span><span class="tag">${r.sleep_h ? r.sleep_h + " h" : "—"}</span></li></ul>` : ""}</div>
        <div class="card"><h4>Log this morning</h4>
          <div class="small">When the watch has not synced, or a strap has the number. A number entered here wins for today.</div>
          <div class="row2"><span><label>Recovery or readiness</label><input id="rcR" type="number" inputmode="numeric" placeholder="85"></span><span><label>HRV (ms)</label><input id="rcH" type="number" inputmode="numeric" placeholder="25"></span></div>
          <div class="row2"><span><label>Resting HR</label><input id="rcB" type="number" inputmode="numeric" placeholder="56"></span><span><label>From</label><select id="rcSrc"><option>Garmin</option><option>WHOOP</option><option>by hand</option></select></span></div>
          <button class="primary" id="rcGo">Save the morning</button> <span class="small" id="rcMsg"></span>
          ${whyHTML(L)}</div>`;
      document.getElementById("rcGo").onclick = async ()=>{ const body = { recovery: +document.getElementById("rcR").value || undefined, hrv: +document.getElementById("rcH").value || undefined, rhr: +document.getElementById("rcB").value || undefined, source: document.getElementById("rcSrc").value }; const m = document.getElementById("rcMsg");
        if (!body.recovery && !body.hrv && !body.rhr) { m.textContent = "Enter at least one number."; return; }
        m.textContent = "saving…"; try{ await bridge("/wellness", { method: "POST", headers: J, body: JSON.stringify(body) }); await draw(); }catch(e){ m.textContent = String(e.message).replace(/^bridge \d+ — /, ""); } };
    };
    await draw();
  };

  // ---------------- Weight ----------------
  V.weight = async function(){
    const el = page("Weight");
    const draw = async ()=>{
      const [chain, w] = await Promise.all([get("/chain"), get("/weigh-in")]);
      if (!alive("weight")) return;
      const L = chain && chain.links && chain.links.weight;
      const trend = w && w.trend_lb_wk != null ? `${w.trend_lb_wk > 0 ? "+" : ""}${w.trend_lb_wk} lb a week over ${w.trend_days} days` : w && w.week_change_lb != null ? `${w.week_change_lb > 0 ? "+" : ""}${w.week_change_lb} lb on the week` : "not enough readings for a trend yet";
      el.innerHTML = headHTML("weight", "Weight", L) + `
        <div class="card"><h4>The scale</h4>
          ${w && w.latest ? `<ul class="agenda totals"><li><span class="n">Latest</span><span class="tag"><b>${w.latest.lb} lb</b> · ${esc(w.latest.logged_today ? "today" : new Date(w.latest.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</span></li>
            <li><span class="n">Trend</span><span class="tag">${esc(trend)}</span></li>
            <li><span class="n">Since the start</span><span class="tag">${w.change_since_start_lb > 0 ? "+" : ""}${w.change_since_start_lb} lb from ${w.start_lb}</span></li>
            <li><span class="n">Readings this week</span><span class="tag">${w.readings_7d || 0}</span></li></ul>` : `<div class="small">No reading yet.</div>`}
          <div class="small">Green at a pound a week down. The trend line needs about ten days of mornings; one heavy morning barely moves it.</div></div>
        <div class="card"><h4>Log a weigh-in</h4>
          <div class="small">Same time each morning, after the bathroom, before coffee.</div>
          <div class="row2"><span><label>Weight (lb)</label><input id="wtLb" type="number" step="0.1" inputmode="decimal" placeholder="216.4"></span><span><label>&nbsp;</label><button class="primary" id="wtGo">Save</button></span></div>
          <span class="small" id="wtMsg"></span>
          ${w && !w.withings_connected ? `<div class="small"><a href="${typeof DEFAULT_API !== "undefined" ? DEFAULT_API : ""}/withings/auth">Connect the Withings scale</a> and the mornings land on their own.</div>` : ""}
          ${whyHTML(L)}</div>`;
      document.getElementById("wtGo").onclick = async ()=>{ const lb = +document.getElementById("wtLb").value; const m = document.getElementById("wtMsg");
        if (!(lb > 50 && lb < 500)) { m.textContent = "A weight in pounds, like 216.4."; return; }
        m.textContent = "saving…"; try{ await bridge("/weigh-in", { method: "POST", headers: J, body: JSON.stringify({ lb }) }); await draw(); }catch(e){ m.textContent = String(e.message).replace(/^bridge \d+ — /, ""); } };
    };
    await draw();
  };

  // ---------------- Micros ----------------
  V.micros = async function(){
    const el = page("Micronutrients");
    const draw = async ()=>{
      const [chain, food] = await Promise.all([get("/chain"), get("/food/today")]);
      if (!alive("micros")) return;
      const L = chain && chain.links && chain.links.micros, B = window.foodBits || {};
      el.innerHTML = headHTML("micros", "Micros", L) + `
        <div class="card">${B.microHTML && food ? B.microHTML(food.micros, food) : `<div class="small">loading…</div>`}</div>
        <div class="card"><h4>Log food</h4><div class="small">Micronutrients come from what is logged on <a href="#food">Food</a>: every photo or written meal adds its iron, calcium, fibre and the rest. Supplements are logged above.</div>${whyHTML(L)}</div>`;
      if (B.wireMicro) B.wireMicro(el, draw);
    };
    await draw();
  };

  // opened straight onto one of these pages: app.js ran nav() before this file loaded
  const here = location.hash.replace(/^#/, "").split("?")[0];
  if (["hydration","fuel","sleep","recovery","weight","micros"].includes(here)) nav();
})();
