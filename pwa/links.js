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
  const WEEKNUM = (ck, L) => L.week == null ? "—" : ck === "recovery" && L.week_kind === "score" ? `${L.week}` : ["work","water","lift","plan","fuel"].includes(ck) ? `${L.week}%`
    : ck === "recovery" ? `${L.week > 0 ? "+" : ""}${L.week}%` : ck === "weight" ? `${L.week > 0 ? "+" : ""}${L.week} lb/wk` : ck === "sleep" ? `${L.week} h` : `${L.week}`;

  // the head-unit pieces: a title line with the week's chip, two big fields (the week, today), a number split from its unit
  const HU = { good: "hu-go", warn: "hu-hold", bad: "hu-stop", none: "hu-dim" };
  const numU = s => { const m = /^([+−-]?[\d.,]+|—|✓)\s*(.*)$/.exec(String(s)); return m ? `${esc(m[1])}${m[2] ? `<span class="ln-uu">${esc(m[2])}</span>` : ""}` : esc(String(s)); };
  const ttlHTML = (title, chip) => `<div class="ln-ttl"><h2 class="ln-h">${esc(title)}</h2>${chip || ""}</div>`;
  // the week as a chip: "Week 67%" on the pages whose top is a picture; the pages with two fields say what the week means
  const weekChip = (ck, L) => !L ? "" : `<span class="hu-chip ${HU[L.state] || HU.none}">Week ${esc(WEEKNUM(ck, L))}</span>`;
  const stateChip = (ck, L, brk) => !L ? "" : brk === ck ? `<span class="hu-chip hu-stop">Breaks the chain</span>`
    : `<span class="hu-chip ${HU[L.state] || HU.none}">${{ good: "On track", warn: "Close", bad: "Behind" }[L.state] || "Not scored yet"}</span>`;
  // the top of the body pages (sleep, recovery, weight, micros): the week and today as two big fields
  function headHTML(ck, title, L, o){
    o = o || {};
    if (!L) return ttlHTML(title) + `<div class="card"><div class="small">loading…</div></div>`;
    const t = typeof todayCell === "function" ? todayCell(ck, L) : { num: "—", word: "", tone: "none" };
    return ttlHTML(title, stateChip(ck, L, o.brk)) + `<div class="hu-fields two ln-top">
        <div class="hu-field big"><span class="k">${esc(o.weekK || "This week")}</span><span class="n ${HU[L.state] || HU.none}">${numU(WEEKNUM(ck, L))}</span><span class="u">${esc(o.weekU || "")}</span></div>
        <div class="hu-field big"><span class="k">${esc(o.todayK || "Today")}</span><span class="n ${HU[t.tone] || HU.none}">${numU(t.num)}</span><span class="u">${esc(o.todayU || t.word || "")}</span></div>
      </div>`;
  }
  const whyHTML = L => L && L.basis ? `<details class="why"><summary>how it's scored</summary><div class="small">${esc(L.basis)}.</div></details>` : "";
  // a bar for each day of the week against a line: sleep hours, recovery scores
  function barsSVG(items, opt){
    const W = 320, H = 110, n = items.length; if (!n) return "";
    // the line's label sits in its own margin at the right, so it never lands on the last bar's number
    const max = opt.max, bw = (W - (opt.line != null ? 26 : 0)) / n;
    const y = v => H - 18 - Math.max(0, Math.min(1, v / max)) * (H - 30);
    const bars = items.map((it, i) => { const v = it.v == null ? 0 : it.v; const x = i * bw + bw * 0.14, w = bw * 0.72;
      return `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(H - 18 - y(v)).toFixed(1)}" fill="${opt.col(it)}"><title>${esc(it.label)}: ${it.v == null ? "no data" : it.v}</title></rect>
        <text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="barlab">${esc(it.short)}</text>
        <text x="${(i * bw + bw / 2).toFixed(1)}" y="${(y(v) - 4).toFixed(1)}" text-anchor="middle" class="barval">${it.v == null ? "" : esc(String(it.v))}</text>`; }).join("");
    const line = opt.line != null ? `<line x1="0" x2="${(n * bw + 2).toFixed(1)}" y1="${y(opt.line).toFixed(1)}" y2="${y(opt.line).toFixed(1)}" class="barline"/><text x="${W - 1}" y="${(y(opt.line) + 3).toFixed(1)}" text-anchor="end" class="barlab">${esc(opt.lineLabel || "")}</text>` : "";
    return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria || "")}">${line}${bars}</svg>`;
  }
  const dayShort = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }).slice(0, 2);
  const dayLong = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const page = (title) => { view.innerHTML = `<div id="linkPage" class="ln-page">${ttlHTML(title)}<div class="card"><div class="small">loading…</div></div></div>`; return document.getElementById("linkPage"); };
  const alive = h => location.hash.split("?")[0] === "#" + h;
  // These pages used to sit on "loading…" for three seconds or more, waiting on /chain (the slowest answer)
  // even where the page's own numbers come from elsewhere. Now: the page as it last stood is shown at once
  // from a small store in this browser, dimmed and not tappable, and each page draws as soon as the answers
  // it cannot do without have landed (Hydration, Fuel and Micros need only the day's food report; the week's
  // numbers from /chain fill in when they come). The last draw is kept as the next visit's first paint.
  const SNAP = "way-snap:";
  const snapShow = (el, key) => { try{ const h = localStorage.getItem(SNAP + key); if (h && el.isConnected){ el.innerHTML = h; el.classList.add("ln-stale"); } }catch{} };
  const snapSave = (el, key) => { try{ localStorage.setItem(SNAP + key, el.innerHTML); }catch{} };
  // paths: what to fetch; need: the indexes the page cannot draw without; render(...values, pending) may run more than once
  function load(el, key, paths, need, render, first){
    const gen = el.__gen = (el.__gen || 0) + 1;
    if (first) snapShow(el, key);
    const vals = paths.map(() => undefined);
    let left = paths.length, drawn = false;
    const live = () => alive(key) && el.isConnected && el.__gen === gen;
    const draw = () => {
      if (!live() || !need.every(i => vals[i] !== undefined)) return;
      // never pull a box out from under the fingers: a draw waits until the field is left
      const a = document.activeElement;
      if (drawn && a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)){ a.addEventListener("blur", () => setTimeout(draw, 0), { once: true }); return; }
      el.classList.remove("ln-stale"); drawn = true;
      render(...vals.map(v => v === undefined ? null : v), left > 0);
    };
    return Promise.all(paths.map((path, i) => get(path).then(v => { vals[i] = v; left--; draw(); })))
      .then(() => { if (!drawn) draw(); if (live() && !el.classList.contains("ln-stale")) snapSave(el, key); });
  }

  // dictation into a box: the phone's own speech recognition; where there is none, the keyboard's microphone key
  const SRec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  // On a phone the recognizer can go quiet without ever ending (iOS in a home-screen app does this), so the
  // listening never relies on it: a second tap always resets, silence for eight seconds stops it, and an
  // error or nothing heard puts the cursor in the box for the keyboard's own microphone.
  window.dictateInto = (input, btn, onFinal) => {
    const hint = msg => { input.focus(); if (msg) input.placeholder = msg; };
    // iPhone and iPad: the browser's recognizer hangs in a home-screen app, so Say goes straight to the box and the
    // keyboard, whose microphone key is Apple's own dictation and always works
    const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!SRec || iOS){ hint("Tap the microphone key on your keyboard and talk, then Log it"); return; }
    if (btn.dataset.on === "1"){ if (btn.__done) btn.__done(true); return; }
    let rec; try{ rec = new SRec(); }catch{ hint("Tap the microphone key on the keyboard and speak"); return; }
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    // the button may be a tile (a picture and two lines): keep its markup and put it back when the listening ends
    const label = btn.innerHTML; btn.dataset.on = "1"; btn.textContent = "Listening… tap to stop"; btn.classList.add("live");
    let heard = "", ended = false, timer = null;
    const arm = ms => { clearTimeout(timer); timer = setTimeout(() => done(false), ms); };
    const done = (byTap) => {
      if (ended) return; ended = true; clearTimeout(timer);
      try{ rec.abort ? rec.abort() : rec.stop(); }catch{}
      btn.dataset.on = ""; btn.innerHTML = label; btn.classList.remove("live"); btn.__done = null;
      if (heard && onFinal) onFinal(heard);
      else if (!heard) hint(byTap ? "Type it here, or tap the keyboard's microphone" : "Didn't catch that. Type it, or tap the keyboard's microphone");
    };
    btn.__done = done;
    rec.onresult = ev => { heard = [...ev.results].map(r => r[0].transcript).join(" ").trim(); input.value = heard; arm(2500); if ([...ev.results].some(r => r.isFinal)) setTimeout(() => done(false), 600); };
    rec.onerror = () => done(false);
    rec.onend = () => done(false);
    if (window.primeSound) primeSound();
    try{ rec.start(); arm(8000); }catch{ done(false); }
  };
  // write it or say it: the same reader as the Food page's written meal, so a drink or a bite is read and counted the same way
  // two tiles, Write and Say; the box opens under them (Say opens it and listens)
  const IC = (window.foodBits && foodBits.ICON) || {};
  const sayWriteHTML = (p, placeholder, hint) => `<div class="ln-sw"><div class="hu-tiles">
      <button class="hu-tile" id="${p}Write" aria-expanded="false">${IC.pen || ""}<b>Write</b></button>
      <button class="hu-tile talkbtn" id="${p}Talk">${IC.mic || ""}<b>Say</b></button></div>
    <div class="ln-swform" id="${p}Form" hidden><label for="${p}Text">Write it or say it</label>
    <textarea id="${p}Text" rows="2" placeholder="${esc(placeholder)}"></textarea>
    <button class="primary" id="${p}Log">Log it</button></div>
    <span class="small" id="${p}Msg"></span></div>`;
  const wireSayWrite = (el, p, after) => {
    const box = el.querySelector("#" + p + "Text"), msg = el.querySelector("#" + p + "Msg"), go = el.querySelector("#" + p + "Log"), talk = el.querySelector("#" + p + "Talk");
    const form = el.querySelector("#" + p + "Form"), write = el.querySelector("#" + p + "Write");
    if (!box || !go) return;
    const open = on => { if (!form) return; form.hidden = !on; if (write) write.setAttribute("aria-expanded", on ? "true" : "false"); };
    if (write) write.onclick = ()=>{ open(form.hidden); if (!form.hidden) box.focus(); };
    const log = async ()=>{ const text = box.value.trim(); if (!text){ msg.textContent = "Write what you had, or tap Say it."; return; }
      go.disabled = true; msg.textContent = "Reading it…"; if (window.primeSound) primeSound();
      const send = async force => { const r = await bridge("/food/text", { method: "POST", headers: J, body: JSON.stringify(force ? { text, force: true } : { text }) }); box.value = ""; msg.textContent = r && r.entry ? `Logged: ${r.entry.name}${r.entry.fluid_ml ? `, ${r.entry.fluid_ml} ml` : ""}${r.entry.kcal ? `, ${r.entry.kcal} kcal` : ""}.` : "Logged."; if (typeof cheerIf === "function") cheerIf(r); await after(); };
      try{ await send(false); }
      catch(e){
        // the same entry again (409, double): ask, and keep both only when told to
        const b = e && e.body;
        if (e && e.status === 409 && b && b.double){ const tw = b.twin || {};
          msg.innerHTML = `${esc(tw.name ? `Looks like the same as ${tw.time ? hm12(tw.time) : "earlier"}: ${tw.name}.` : (b.error || "Looks like the same entry again."))} Keep both? <button class="linkish" type="button">Keep both</button>`;
          const kb = msg.querySelector("button"); kb.onclick = async ()=>{ kb.disabled = true; msg.textContent = "Reading it…"; try{ await send(true); }catch(e2){ msg.textContent = String(e2.message).replace(/^bridge \d+ — /, ""); } };
        } else msg.textContent = String(e.message).replace(/^bridge \d+ — /, ""); }
      finally{ go.disabled = false; } };
    go.onclick = log;
    if (talk) talk.onclick = ()=>{ open(true); window.dictateInto(box, talk, ()=> log()); };
  };

  // ---------------- Hydration ----------------
  V.hydration = async function(){
    const el = page("Hydration");
    const draw = (first)=> load(el, "hydration", ["/chain", "/food/today"], [1], (chain, food) => {
      const L = chain && chain.links && chain.links.water, h = food && food.hydration, B = window.foodBits || {};
      // the drinks list and its count: the server's own (day.drinks, day.drink_count) when the day report carries
      // them, so Food and Hydration count alike; else every drink-like entry of the journal
      const ents = (food && food.entries) || [];
      const drinks0 = ents.filter(e => !e.supplement && (e.is_drink || e.drink_only || e.fluid_ml > 0));
      // day.drinks: the ids (or the entries) the server counts as drinks
      const ids = food && Array.isArray(food.drinks) ? food.drinks.map(d => d && typeof d === "object" ? d.id : d).filter(Boolean) : null;
      const drinks = ids ? ids.map(id => ents.find(e => e.id === id)).filter(Boolean) : drinks0;
      const drinkCount = food && Number.isFinite(food.drink_count) ? food.drink_count : drinks.length;
      // the bedtime note about alcohol, and the line that says why a glass moved the balance less than its size
      const alcNote = h && (h.bedtime_note || h.alcohol_note) || (food && (food.bedtime_note || food.alcohol_note)) || "";
      const glassNote = h && (h.landing_note || h.glass_note) || (h && h.now && h.now.landing_ml > 0 ? `${h.now.landing_ml} ml of what you drank is still on its way in: the balance counts water as it lands, over the next hour or so.` : "");
      const dc = h && h.drank_counts, countsLine = !dc ? "" : typeof dc === "string" ? dc : typeof dc === "object" && (dc.word || dc.text) ? (dc.word || dc.text) : "";
      // "0.0 L down on the morning" says nothing: dropped when it is zero
      const note = h && h.note && !/^\s*0\.0 L (down|up) on the morning\.?\s*$/i.test(h.note) ? h.note : "";
      // The glass: the balance drawn on the same scale as the curve below it (2.5% of body weight down at the
      // bottom, 1% up at the brim), with a green line at 0, the morning level, where you should be.
      const kg = (h && h.kg) || 98, lo = -kg * 25, hi = kg * 10, hasNow = !!(h && h.now && h.now.ml != null);
      const lvl = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
      const fill = hasNow ? Math.max(2, lvl(h.now.ml)) : 0, zero = lvl(0);
      const vc = hasNow && h.now.band && B.verdictCol ? B.verdictCol(h.now.band.key) : "var(--muted)";
      const bal = hasNow ? `${h.now.ml > 0 ? "+" : h.now.ml < 0 ? "−" : ""}${Math.abs(h.now.ml).toLocaleString("en-US")}` : "—";
      const word = hasNow && h.now.band ? String(h.now.band.word || "") : "";
      const tank = `<div class="hy-tank">
          <div class="hy-glass" role="img" aria-label="Balance ${esc(bal)} ml against the morning"><i style="height:${fill.toFixed(0)}%"></i><em style="bottom:${zero.toFixed(0)}%"></em></div>
          <div class="hy-read"><span class="hu-n hy-bal" style="color:${vc}">${esc(bal)}${hasNow ? `<span class="ln-uu">ml</span>` : ""}</span>
            <span class="hy-say">${h ? `${(((h.drunk_ml != null ? h.drunk_ml : food.drinks_ml) || 0)/1000).toFixed(1)} of ${((h.target_ml || 0)/1000).toFixed(1)} L` : "No drinks yet today."}</span>
            ${note ? `<span class="small">${esc(note)}</span>` : ""}
            ${alcNote ? `<span class="small hu-hold">${esc(alcNote)}</span>` : ""}</div></div>
        ${glassNote ? `<details class="why"><summary>why the balance moved less than the glass</summary><div class="small">${esc(glassNote)}</div></details>` : ""}`;
      // the four drinks as what they are, each drawn with water in it
      const GL = {
        glass: `<svg viewBox="0 0 20 26" aria-hidden="true"><path d="M3 2h14l-2 22H5z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.2 12h11.6l-1 11H5.2z" fill="var(--water)"/></svg>`,
        bottle: `<svg viewBox="0 0 20 26" aria-hidden="true"><path d="M7 1h6v3l2 3v18H5V7l2-3z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.8 11h8.4v13.2H5.8z" fill="var(--water)"/></svg>`,
        bike: `<svg viewBox="0 0 20 26" aria-hidden="true"><path d="M8 1h4v3h2v3c2 1 2 3 1 5 1 2 1 4 0 6v7H5v-7c-1-2-1-4 0-6-1-2-1-4 1-5V4h2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.8 13h8.4v11.2H5.8z" fill="var(--water)"/></svg>`,
        litre: `<svg viewBox="0 0 20 26" aria-hidden="true"><path d="M6 1h8v3l2 2v19H4V6l2-2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4.8 8h10.4v16.2H4.8z" fill="var(--water)"/></svg>`
      };
      const tile = (ml, pic, n, k) => `<button class="hu-tile" data-ml="${ml}" aria-label="${esc(k)}, ${ml} ml">${GL[pic]}<b>${n}</b><span>${esc(k)}</span></button>`;
      // what each drink did: water in blue; alcohol in amber, as the water it left after the alcohol
      const hd = (h && h.drinks) || [];
      const valOf = e => {
        // the server's volume per row (drink_ml), so the list adds up to "Drank"; its net water (drink_net_ml, below zero for alcohol) small beside it
        if (e.drink_ml != null){ const net = e.drink_net_ml;
          return `<span class="${e.alcohol ? "hu-hold" : "hu-water"}">${e.drink_ml}<span class="ln-uu">ml</span></span>${net != null && net !== e.drink_ml ? `<span class="small hy-net" title="water left after the alcohol">${net < 0 ? "−" : "+"}${Math.abs(net)}</span>` : ""}`; }
        if (e.alcohol){ const d = hd.find(x => x.alcohol && x.time === e.time && String(x.name).toLowerCase() === String(e.name).toLowerCase());
          if (d && d.net_ml != null) return `<span class="hu-hold" title="${d.ml} ml, ${d.net_ml} ml left after the alcohol">${d.net_ml < 0 ? "−" : ""}${Math.abs(d.net_ml)}<span class="ln-uu">ml</span></span>`;
          return `<span class="hu-hold">${e.fluid_ml ? `${e.fluid_ml}<span class="ln-uu">ml</span>` : `${e.kcal || 0}<span class="ln-uu">kcal</span>`}</span>`; }
        return e.fluid_ml ? `<span class="hu-water">${e.fluid_ml}<span class="ln-uu">ml</span></span>` : e.kcal ? `<span class="hu-dim">${e.kcal}<span class="ln-uu">kcal</span></span>` : `<span class="hu-water">0<span class="ln-uu">ml</span></span>`;
      };
      el.innerHTML = ttlHTML("Hydration", weekChip("water", L)) + tank + `
        <div class="hu-tiles four hy-tiles">${tile(250, "glass", "250", "Glass")}${tile(500, "bottle", "500", "Bottle")}${tile(620, "bike", "620", "Bike")}${tile(1000, "litre", "1 L", "Litre")}</div>
        <span class="small" id="hyMsg"></span>
        <details class="ln-fold"><summary>Other amount</summary>
          <div class="row2"><span><label>Other amount (ml)</label><input id="hyMl" type="number" inputmode="numeric" placeholder="330"></span>
            <span><label>With salt or electrolytes</label><select id="hySalt"><option value="">plain water</option><option value="1">with electrolytes</option></select></span></div>
          <button class="primary" id="hyGo">Log it</button>
          <div class="small">The electrolytes choice counts for the four drinks above too.</div></details>
        ${sayWriteHTML("hySw", "a large iced coffee with milk, or two glasses of water", "“iced coffee with milk”")}
        <div class="ln-sec"><span class="hu-lab">Today's drinks · ${drinkCount}</span></div>
        ${drinks.length ? `<div class="hy-list">${drinks.slice().reverse().map(e => `<div class="hy-row${e.alcohol ? " alc" : ""}"><span class="t">${esc(hm12(e.time))}</span><span class="nm">${esc(e.name)}${e.maybe_double_of ? ` <span class="hu-chip hu-hold">double?</span>` : ""}</span><span class="v hu-n">${valOf(e)}</span><button class="tdel" data-del="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">${window.TRASH || "×"}</button></div>`).join("")}</div>` : `<div class="small">None logged yet.</div>`}
        <div class="card"><h4>The day's water</h4>${h && B.hydrationHTML ? B.hydrationHTML(h, { noHead: true }) : `<div class="small">No drinks yet today.</div>`}</div>
        ${whyHTML(L)}`;
      if (h && B.wireHydration) B.wireHydration(el, h);
      const log = async (ml, salt)=>{
        const msg = document.getElementById("hyMsg"); msg.textContent = "logging…";
        try{ await bridge("/food/item", { method: "POST", headers: J, body: JSON.stringify({ name: salt ? `Water with electrolytes, ${ml} ml` : `Water, ${ml} ml`, kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0, tags: ["drink"], fluid_ml: ml, fits: "yes", why: "Water." }) }); await draw(); }
        catch(e){ msg.textContent = String(e.message).replace(/^bridge \d+ — /, ""); }
      };
      el.querySelectorAll("[data-ml]").forEach(b => b.onclick = ()=> log(+b.dataset.ml, document.getElementById("hySalt").value === "1"));
      document.getElementById("hyGo").onclick = ()=>{ const ml = +document.getElementById("hyMl").value; if (!(ml > 0 && ml <= 3000)) { document.getElementById("hyMsg").textContent = "An amount in ml, up to 3000."; return; } log(ml, document.getElementById("hySalt").value === "1"); };
      wireSayWrite(el, "hySw", draw);
      el.querySelectorAll("[data-del]").forEach(b => b.onclick = async ()=>{ if (!confirm("Remove this drink?")) return; b.disabled = true; try{ await bridge("/food/" + encodeURIComponent(b.dataset.del), { method: "DELETE" }); }catch(e){} await draw(); });
    }, first);
    await draw(true);
  };

  // ---------------- Fuel ----------------

  // Live energy, the Hexis view: calories in minus out since midnight. The day's base burn slides the line down,
  // a session steepens it (shaded blue), food steps it up (filled dot eaten, ring planned). Solid until now, dashed
  // after. The dotted green line is where the plan means the day to end.
  function balanceHTML(b, baseBurn){
    if (!b || !b.points || !b.points.length) return "";
    const W = 360, H = 210, L = 40, R = 8, T = 10, Bm = 22;
    const vals = b.points.map(p => p.kcal).concat(b.target_end != null ? [b.target_end] : []);
    const lo = Math.floor(Math.min(-300, ...vals) / 300) * 300, hi = Math.ceil(Math.max(300, ...vals) / 300) * 300;
    const x = m => L + (m / 1440) * (W - L - R), y = v => T + (hi - v) / (hi - lo) * (H - T - Bm);
    const past = b.points.filter(p => !p.projected), ahead = b.points.filter(p => p.projected);
    if (past.length && ahead.length) ahead.unshift(past[past.length - 1]);
    const path = ps => ps.map((p, i) => `${i ? "L" : "M"}${x(p.m).toFixed(1)} ${y(p.kcal).toFixed(1)}`).join(" ");
    const step = Math.max(300, Math.ceil((hi - lo) / 6 / 300) * 300), grid = [];
    for (let v = lo; v <= hi; v += step) grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="eb-grid"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" class="eb-lab">${v > 0 ? "+" + v : v}</text>`);
    grid.push(`<line x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="eb-zero"/>`);
    const hrs = [0, 240, 480, 720, 960, 1200, 1440].map((m, i) => `<text x="${x(m).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? "start" : i === 6 ? "end" : "middle"}" class="eb-lab">${["12a","4a","8a","12p","4p","8p","12a"][i]}</text>`).join("");
    const bands = (b.sessions || []).map(s => `<rect x="${x(s.start).toFixed(1)}" y="${T}" width="${Math.max(2, x(Math.min(1440, s.end)) - x(s.start)).toFixed(1)}" height="${H - T - Bm}" class="eb-ses"><title>${esc(s.name || "session")}: about ${s.kcal} kcal</title></rect>`).join("");
    const dots = (b.meals || []).filter(m => m.min >= 0 && m.min <= 1440).map(m => `<circle cx="${x(m.min).toFixed(1)}" cy="${y(m.at).toFixed(1)}" r="4.5" class="${m.logged ? "eb-eat" : "eb-plan"}"><title>${esc(m.label || "")}: ${m.kcal} kcal${m.logged ? "" : " (planned)"}</title></circle>`).join("");
    const tgt = b.target_end != null ? `<line x1="${L}" x2="${W - R}" y1="${y(b.target_end).toFixed(1)}" y2="${y(b.target_end).toFixed(1)}" class="eb-tgt"/>` : "";
    const nowDot = b.now_min < 1440 ? `<circle cx="${x(b.now_min).toFixed(1)}" cy="${y(b.now).toFixed(1)}" r="5.5" class="eb-now"/>` : "";
    const sign = v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("en-US");
    const off = b.target_end != null ? b.end - b.target_end : null;
    const tone = off == null ? "" : Math.abs(off) <= 150 ? "hu-go" : Math.abs(off) <= 400 ? "hu-hold" : "hu-stop";
    return `<div class="eb-card">
      <div class="eb-head"><div><span class="hu-lab">Live energy · now</span><div><span class="hu-n eb-big">${sign(b.now)}</span><span class="small"> kcal</span></div></div>
        <div class="eb-end"><span class="hu-lab">End of day</span><div><span class="hu-n eb-big ${tone}">${sign(b.end)}</span><span class="small"> predicted</span></div>${b.target_end != null ? `<span class="small">the plan: ${sign(b.target_end)}</span>` : ""}</div></div>
      <svg class="eb-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories in minus out since midnight: ${sign(b.now)} now, ${sign(b.end)} predicted at midnight">
        ${bands}${grid.join("")}${tgt}<path d="${path(past)}" class="eb-past"/>${ahead.length > 1 ? `<path d="${path(ahead)}" class="eb-ahead"/>` : ""}${dots}${nowDot}${hrs}</svg>

      <details class="why"><summary>what it counts</summary><div class="small">Calories eaten minus calories burned since midnight. Your base burn${baseBurn ? `, about ${Math.round(baseBurn).toLocaleString("en-US")} kcal a day,` : ""} runs evenly through the day; each workout adds its burn over its minutes (Strava's number once done, the plan's estimate before); each meal lands when it was eaten. After now the line follows the open meals and workouts on the plan. It is the same energy your calorie target is built from, so a day that ends on the dotted line is the planned deficit.</div></details>
    </div>`;
  }

  V.fuel = async function(){
    const el = page("Fuel");
    const draw = (first)=> load(el, "fuel", ["/chain", "/food/today"], [1], (chain, food, pending) => {
      const L = chain && chain.links && chain.links.fuel, e = food && food.energy, B = window.foodBits || {};
      const due = (food && food.supps && (food.supps.due || food.supps)) || [];
      const rx = (Array.isArray(due) ? due : []).filter(x => x.link === "fuel");
      // two big fields: what is in the tank now, and the legs (the 1 to 5 rating lives in the Legs field)
      const now = e && e.now, fc = p => B.fuelColL ? B.fuelColL(p) : "var(--ink)", lt = e && e.legs_tap;
      const legsRate = !lt ? "" : lt.rated ? `<span class="u">rated ${lt.rated} of 5${lt.tuned ? " · model tuned" : ""}</span>`
        : `<span class="u">how did ${esc(String(lt.name || "the ride").replace(/,.*$/, ""))} feel?</span><div class="fu-rate">${[1,2,3,4,5].map(n => `<button class="suppbtn" data-legs="${n}" data-ride="${esc(lt.key)}" aria-label="Legs ${n} of 5">${n}</button>`).join("")}</div>`;
      const top = `<div class="hu-fields two ln-top">
          <div class="hu-field big"><span class="k">Fuel now</span><span class="n" style="color:${now ? fc(now.pct) : "var(--muted)"}">${now ? `${now.pct}<span class="ln-uu">%</span>` : "—"}</span><span class="u">${!now ? "starts with the first meal" : now.arriving_g >= 10 ? `${now.arriving_g} g still landing` : e.peak ? `peak ${esc(hm12(e.peak.time))} · ${e.peak.pct}%` : esc((now.band && now.band.word) || "")}</span></div>
          <div class="hu-field big fu-legs"><span class="k">Legs</span><span class="n" style="color:${now && now.legs_pct != null ? fc(now.legs_pct) : "var(--muted)"}">${now && now.legs_pct != null ? `${now.legs_pct}<span class="ln-uu">%</span>` : "—"}</span>${legsRate}</div>
        </div>`;
      // the pre-ride supplements as fields: taken with its time, or when it is due
      const ents = (food && food.entries) || [];
      const takenAt = k => ents.filter(x => x.supplement && x.key === k).map(x => x.time || "").sort().pop();
      const SUPP = [["beetroot", "Beetroot", ""], ["sodium_bicarb", "Bicarbonate", ""]]
        .concat(rx.filter(x => x.key !== "beetroot" && x.key !== "sodium_bicarb").map(x => [x.key, x.name, ""]));
      const suppField = ([k, name, dflt]) => { const r = rx.find(x => x.key === k), t = takenAt(k), taken = t != null || (r && r.taken);
        return `<div class="hu-field fu-supp"><span class="k">${esc(String(name).replace(/\s*\(.*\)$/, ""))}</span>
          <span class="n ${taken ? "hu-go" : r && !r.too_late ? "hu-hold" : "hu-dim"}">${taken ? `✓${t ? " " + esc(hm12(t)) : ""}` : r && r.too_late ? "Too late" : r ? `Due${r.time ? " " + esc(hm12(r.time)) : ""}` : "Not due"}</span>
          <span class="u">${esc(dflt || "")}</span>${r && r.too_late && !taken ? `<span class="small hu-dim">${esc(r.word || "too late today")}</span>` : `<button class="fu-log" data-supp="${esc(k)}">${taken ? "log again" : "log it"}</button>`}</div>`; };
      // the week: one thin bar per ride, the target a white tick
      const wk = (L && L.list) || [];
      // each ride: what went in against the plan, 100% the plan; under reads short, over reads long. The parts underneath.
      const PART = { pre: "before", bottle: "on the bike", supp: "supplements" };
      const wrow = c => { if (c.kind !== "ride") return ""; const col = TC[c.ok ? "good" : c.near ? "warn" : "bad"], scale = Math.max(125, c.pct || 0) * 1.05;
        const parts = (c.parts || []).map(p => p.kind === "supp" ? `${p.got}/${p.due}` : `${p.got_g}/${p.plan_g} g`).join(" · ");
        return `<div class="fu-wr"><span class="fu-wl"><span class="t">${c.time ? esc(hm12(c.time)) : ""}</span> ${esc(String(c.name || "").replace(/^Zwift - Intervals icu: /i, ""))}<span class="small hu-dim"> ${esc(parts)}</span></span>
          <span class="hu-track fu-tr"><i class="f" style="width:${Math.max(1.5, Math.min(c.pct || 0, 100) / scale * 100).toFixed(1)}%;background:${col}"></i>${(c.pct || 0) > 100 ? `<i class="over" style="left:${(100 / scale * 100).toFixed(1)}%;width:${(((c.pct || 0) - 100) / scale * 100).toFixed(1)}%"></i>` : ""}<i class="tick" style="left:${(100 / scale * 100).toFixed(1)}%"></i></span>
          <span class="fu-v"><b style="color:${col}">${c.pct}%</b></span></div>`; };
      // one headline: fuel now. The week's share of checks met heads the week's own section below.
      // the headline: how much of what the plan asked for went in, this week and today (100% is the plan)
      const fp = v => v == null ? "—" : `${v}<span class="ln-uu">%</span>`;
      const fed = `<div class="hu-fields two ln-top fu-fed">
          <div class="hu-field big"><span class="k">Fuelled this week</span><span class="n ${HU[L && L.state] || HU.none}">${fp(L && L.week)}</span><span class="u">${L && L.rides ? `${L.rides} ride${L.rides === 1 ? "" : "s"}` : "no rides yet"}</span></div>
          <div class="hu-field big"><span class="k">Today</span><span class="n ${HU[L && L.today_tone] || HU.none}">${fp(L && L.today)}</span><span class="u">${esc((L && L.today_word) || "")}</span></div>
        </div>`;
      el.innerHTML = ttlHTML("Fuel") + fed + balanceHTML(food && food.balance, food && food.target && food.target.base_burn) + top + `
        <div class="hu-tiles four fu-carbs">
          <button class="hu-tile" data-item="tailwind"><b>50 g</b><span>Tailwind</span></button><button class="hu-tile" data-item="gel"><b>22 g</b><span>Gel</span></button><button class="hu-tile" data-item="figbar"><b>38 g</b><span>Fig bar</span></button><button class="hu-tile" data-item="banana"><b>27 g</b><span>Banana</span></button>
        </div>
        ${sayWriteHTML("fuSw", "a bottle of Tailwind and half a banana", "“half a banana”")}
        <div class="ln-sec"><span class="hu-lab">Pre-ride supplements</span></div>
        <div class="hu-fields two fu-supps">${SUPP.map(suppField).join("")}</div>
        ${rx.length ? `<details class="why"><summary>why</summary><div class="small">${rx.map(x => `<b>${esc(x.name)}</b>${x.time ? ` at ${esc(hm12(x.time))}` : ""}: ${esc(x.why || "")}.`).join(" ")}</div></details>` : `<div class="small">None due today.</div>`}
        <span class="small" id="fuMsg"></span>
        <div class="card"><h4>The tank today</h4>${e && B.energyHTML ? B.energyHTML(e, { noHead: true, noLegs: true }) : `<div class="small">Starts with the first meal.</div>`}</div>
        <div class="ln-sec"><span class="hu-lab">Fuelled this week${L && L.week != null ? ` · <span class="${HU[L.state] || HU.none}">${L.week}% of the plan</span>` : ""}</span></div>
        ${wk.length ? `<div class="fu-wk">${wk.slice().reverse().map(wrow).join("")}</div>
            <div class="small">${L.ok}/${L.checks}${L.rx && L.rx.beetroot ? ` · beetroot ${L.rx.beetroot.taken}/${L.rx.beetroot.due}` : ""}</div>` : `<div class="small">${!L && pending ? "reading the week…" : "No rides this week to check yet."}</div>`}
        ${whyHTML(L)}`;
      if (e && B.wireEnergy) B.wireEnergy(el, e, ()=> draw());
      const ITEMS = { tailwind: { name: "Tailwind, 2 scoops, 620 ml bottle", kcal: 200, carbs_g: 50, tags: ["drink"], fluid_ml: 620 }, gel: { name: "Energy gel", kcal: 90, carbs_g: 22, tags: [] },
        figbar: { name: "Fig bar", kcal: 200, carbs_g: 38, protein_g: 3, fat_g: 4, tags: [] }, banana: { name: "Banana", kcal: 105, carbs_g: 27, protein_g: 1, tags: ["veg"] } };
      wireSayWrite(el, "fuSw", draw);
      const msg = t => { const m = document.getElementById("fuMsg"); if (m) m.textContent = t; };
      el.querySelectorAll("[data-item]").forEach(b => b.onclick = async ()=>{ const it = ITEMS[b.dataset.item]; b.disabled = true; msg("logging…");
        try{ await bridge("/food/item", { method: "POST", headers: J, body: JSON.stringify(Object.assign({ protein_g: 0, fat_g: 0, fits: "yes", why: "Fuel for the ride." }, it)) }); await draw(); }catch(err){ b.disabled = false; msg(String(err.message).replace(/^bridge \d+ — /, "")); } });
      el.querySelectorAll("[data-supp]").forEach(b => b.onclick = async ()=>{ b.disabled = true; msg("logging…");
        try{ await bridge("/food/supplement", { method: "POST", headers: J, body: JSON.stringify({ key: b.dataset.supp }) }); await draw(); }catch(err){ b.disabled = false; msg(String(err.message).replace(/^bridge \d+ — /, "")); } });
    }, first);
    await draw(true);
  };

  // ---------------- Sleep ----------------
  V.sleep = async function(){
    const el = page("Sleep");
    const draw = (first)=> load(el, "sleep", ["/chain", "/food/today"], [0], (chain, food) => {
      const L = chain && chain.links && chain.links.sleep;
      const nights = (L && L.nights) || [];
      const mgE = (food && food.entries || []).filter(e => e.supplement && e.key === "magnesium"), mg = mgE.length > 0;
      const mgAt = mgE.map(e => e.time || "").sort().pop();
      const last = nights.length ? nights[nights.length - 1] : null;
      el.innerHTML = headHTML("sleep", "Sleep", L, { brk: chain && chain.break_at, weekK: "Week average", weekU: "need 7.0", todayK: "Last night",
          todayU: last ? `${last.score != null ? `score ${last.score}` : ""}${last.manual ? `${last.score != null ? " · " : ""}${last.manual}` : ""}` : "" }) + `
        <div class="ln-chart">
          ${nights.length ? barsSVG(nights.map(n => ({ v: n.hours, label: dayLong(n.date), short: dayShort(n.date) })), { max: 10, line: 7, lineLabel: "7 h", aria: "hours asleep each night", col: it => it.v >= 7 ? "var(--green)" : it.v >= 6.25 ? "var(--amber)" : "var(--red)" }) : `<div class="small">No nights from the watch yet.</div>`}
          ${nights.length ? `<details class="why"><summary>each night</summary><ul class="agenda totals">${nights.slice().reverse().map(n => `<li><span class="n">${esc(dayLong(n.date))}${n.manual ? ` <span class="small">· ${esc(n.manual)}</span>` : ""}</span><span class="tag"><b style="color:${TC[n.hours >= 7 ? "good" : n.hours >= 6.25 ? "warn" : "bad"]}">${n.hours} h</b>${n.score != null ? ` · score ${n.score}` : ""}</span></li>`).join("")}</ul></details>` : ""}</div>
        <div class="ln-sec"><span class="hu-lab">Tonight</span></div>
        <div class="hu-fields two">
          <div class="hu-field"><span class="k">Bed tonight</span><span class="n">9:45p</span></div>
          ${mg ? `<div class="hu-field"><span class="k">Magnesium</span><span class="n hu-go">✓${mgAt ? " " + esc(hm12(mgAt)) : ""}</span><span class="u">taken · 200 mg</span></div>`
            : (() => { const d = new Date(), nowM = d.getHours() * 60 + d.getMinutes(), dueM = 20 * 60 + 45;   // an hour before the 9:45p bedtime
                const due = nowM >= dueM - 30;
                return `<button class="hu-field ln-fbtn" data-supp="magnesium"><span class="k">Magnesium</span><span class="n ${due ? "hu-hold" : ""}">${due ? "Due" : "8:45p"}</span><span class="u">200 mg</span></button>`; })()}
        </div>
        ${food && food.hydration && food.hydration.bedtime_note ? `<div class="small hu-hold">${esc(food.hydration.bedtime_note)}</div>` : ""}
        <details class="ln-fold"><summary>Add a night</summary>
          <div class="row2"><span><label>Hours asleep</label><input id="slH" type="number" step="0.05" inputmode="decimal" placeholder="7.5"></span><span><label>Sleep score</label><input id="slS" type="number" inputmode="numeric" placeholder="80"></span></div>
          <div class="row2"><span><label>From</label><select id="slSrc"><option>Garmin</option><option>WHOOP</option><option>by hand</option></select></span><span><label>&nbsp;</label><button class="primary" id="slGo">Save the night</button></span></div>
          <span class="small" id="slMsg"></span></details>
        ${whyHTML(L)}`;
      document.getElementById("slGo").onclick = async ()=>{ const h = +document.getElementById("slH").value, sc = +document.getElementById("slS").value; const m = document.getElementById("slMsg");
        if (!(h > 0 && h <= 16)) { m.textContent = "Hours asleep, like 7.5."; return; }
        m.textContent = "saving…"; try{ await bridge("/wellness", { method: "POST", headers: J, body: JSON.stringify({ sleep_h: h, sleep_score: sc || undefined, source: document.getElementById("slSrc").value }) }); await draw(); }catch(e){ m.textContent = String(e.message).replace(/^bridge \d+ — /, ""); } };
      el.querySelectorAll("[data-supp]").forEach(b => b.onclick = async ()=>{ b.disabled = true; try{ await bridge("/food/supplement", { method: "POST", headers: J, body: JSON.stringify({ key: b.dataset.supp }) }); }catch(e){} await draw(); });
    }, first);
    await draw(true);
  };

  // ---------------- Recovery ----------------
  V.recovery = async function(){
    const el = page("Recovery");
    const draw = (first)=> load(el, "recovery", ["/chain", "/scores"], [0], (chain, scores) => {
      const L = chain && chain.links && chain.links.recovery;
      const days = (L && L.days) || [], r = scores && scores.recovery;
      el.innerHTML = headHTML("recovery", "Recovery", L, { brk: chain && chain.break_at, weekU: "", todayK: "This morning", todayU: "" }) + `
        <div class="ln-chart">
          ${days.length ? barsSVG(days.map(d => ({ v: d.score, label: `${dayLong(d.date)}${d.hrv ? `, HRV ${Math.round(d.hrv)} ms` : ""}`, short: dayShort(d.date) })), { max: 100, line: 67, lineLabel: "67", aria: "recovery score each morning", col: it => it.v >= 67 ? "var(--green)" : it.v >= 34 ? "var(--amber)" : "var(--red)" }) : `<div class="small">No mornings yet.</div>`}</div>
        ${L && L.why ? `<details class="why"><summary>why the week reads this way</summary><div class="small">${esc(L.why.charAt(0).toUpperCase() + L.why.slice(1))}${L.hrv_week_ms ? `. HRV ${L.hrv_week_ms} ms this week against ${L.hrv_base_ms} ms over 60 days` : ""}${L.rhr_week ? `; resting HR ${L.rhr_week}` : ""}.</div></details>` : ""}
        ${r ? `<div class="ln-sec"><span class="hu-lab">This morning</span></div>
        <div class="hu-fields">
          <div class="hu-field"><span class="k">HRV</span><span class="n">${r.hrv ? Math.round(r.hrv) : "—"}</span><span class="u">ms${r.hrv_baseline ? ` · base ${Math.round(r.hrv_baseline)}` : ""}</span></div>
          <div class="hu-field"><span class="k">Resting HR</span><span class="n">${r.rhr || "—"}</span><span class="u">bpm${r.rhr_baseline ? ` · base ${Math.round(r.rhr_baseline)}` : ""}</span></div>
          <div class="hu-field"><span class="k">Slept</span><span class="n">${r.sleep_h || "—"}</span><span class="u">h</span></div>
        </div>` : ""}
        <details class="ln-fold"><summary>Log this morning</summary>
          <div class="row2"><span><label>Recovery or readiness</label><input id="rcR" type="number" inputmode="numeric" placeholder="85"></span><span><label>HRV (ms)</label><input id="rcH" type="number" inputmode="numeric" placeholder="25"></span></div>
          <div class="row2"><span><label>Resting HR</label><input id="rcB" type="number" inputmode="numeric" placeholder="56"></span><span><label>From</label><select id="rcSrc"><option>Garmin</option><option>WHOOP</option><option>by hand</option></select></span></div>
          <button class="primary" id="rcGo">Save the morning</button> <span class="small" id="rcMsg"></span></details>
        ${whyHTML(L)}`;
      document.getElementById("rcGo").onclick = async ()=>{ const body = { recovery: +document.getElementById("rcR").value || undefined, hrv: +document.getElementById("rcH").value || undefined, rhr: +document.getElementById("rcB").value || undefined, source: document.getElementById("rcSrc").value }; const m = document.getElementById("rcMsg");
        if (!body.recovery && !body.hrv && !body.rhr) { m.textContent = "Enter at least one number."; return; }
        m.textContent = "saving…"; try{ await bridge("/wellness", { method: "POST", headers: J, body: JSON.stringify(body) }); await draw(); }catch(e){ m.textContent = String(e.message).replace(/^bridge \d+ — /, ""); } };
    }, first);
    await draw(true);
  };

  // ---------------- Weight ----------------
  V.weight = async function(){
    const el = page("Weight");
    const draw = (first)=> load(el, "weight", ["/chain", "/weigh-in"], [1], (chain, w) => {
      const L = chain && chain.links && chain.links.weight;
      // an old last reading is said up top ("Last weigh-in Aug 17"), and the explanation stays folded until there is data
      const lat0 = w && w.latest, ageD = lat0 && lat0.at ? Math.floor((Date.now() - new Date(lat0.at).getTime()) / 864e5) : null;
      const stale = !lat0 || (ageD != null && ageD > 7), hasTrend = !!(w && (w.trend_lb_wk != null || w.week_change_lb != null));
      const trend = w && w.trend_lb_wk != null ? `${w.trend_lb_wk > 0 ? "+" : ""}${w.trend_lb_wk} lb a week over ${w.trend_days} days` : w && w.week_change_lb != null ? `${w.week_change_lb > 0 ? "+" : ""}${w.week_change_lb} lb on the week` : "not enough readings for a trend yet";
      const lat = w && w.latest, latWhen = lat ? (lat.logged_today ? "today" : new Date(lat.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })) : "";
      const tNum = w && w.trend_lb_wk != null ? `${w.trend_lb_wk > 0 ? "+" : ""}${w.trend_lb_wk}` : w && w.week_change_lb != null ? `${w.week_change_lb > 0 ? "+" : ""}${w.week_change_lb}` : "—";
      const tTone = tNum === "—" ? "hu-dim" : +tNum <= -0.8 ? "hu-go" : +tNum <= 0 ? "hu-hold" : "hu-stop";
      const staleHead = ttlHTML("Weight", L && chain && chain.break_at === "weight" ? `<span class="hu-chip hu-stop">Breaks the chain</span>` : "") + `<div class="hu-fields ln-top ln-one">
          <div class="hu-field big"><span class="k">Last weigh-in${lat ? ` · ${esc(new Date(lat.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }))}` : ""}</span><span class="n hu-dim">${lat ? `${esc(String(Math.round(lat.lb)))}<span class="ln-uu">lb</span>` : "—"}</span><span class="u">${lat ? `${ageD != null ? `${ageD} days ago` : ""}` : "no reading yet"}</span></div></div>`;
      el.innerHTML = (stale ? staleHead : headHTML("weight", "Weight", L, { brk: chain && chain.break_at, weekU: "target −1 lb a week", todayK: "Latest",
          todayU: lat ? `lb · ${latWhen}` : "no reading yet" })) + `
        ${stale ? "" : w && lat ? `<div class="hu-fields">
          <div class="hu-field"><span class="k">Trend</span><span class="n ${tTone}">${esc(tNum)}</span><span class="u">${tNum === "—" ? "not enough readings" : w.trend_lb_wk != null ? `lb a week · ${w.trend_days} days` : "lb on the week"}</span></div>
          <div class="hu-field"><span class="k">Since start</span><span class="n">${w.change_since_start_lb > 0 ? "+" : ""}${w.change_since_start_lb}</span><span class="u">lb from ${w.start_lb}</span></div>
          <div class="hu-field"><span class="k">Readings</span><span class="n">${w.readings_7d || 0}</span><span class="u">this week</span></div>
        </div>` : `<div class="small">No reading yet.</div>`}
        ${stale || !hasTrend ? "" : `<div class="small ln-trend" title="${esc(trend)}">Green at a pound a week down. The trend line needs about ten days of mornings; one heavy morning barely moves it.</div>`}
        <details class="ln-fold"${stale ? " open" : ""}><summary>Log a weigh-in</summary>
          <div class="row2"><span><label>Weight (lb)</label><input id="wtLb" type="number" step="0.1" inputmode="decimal" placeholder="216.4"></span><span><label>&nbsp;</label><button class="primary" id="wtGo">Save</button></span></div>
          <span class="small" id="wtMsg"></span></details>
        ${w && !w.withings_connected ? `<div class="small"><a href="${typeof DEFAULT_API !== "undefined" ? DEFAULT_API : ""}/withings/auth">Connect the Withings scale</a></div>` : ""}
        ${stale || !hasTrend ? (L && L.basis ? `<details class="why"><summary>how it's read</summary><div class="small">Green at a pound a week down. The trend line needs about ten days of mornings; one heavy morning barely moves it. ${esc(L.basis)}.</div></details>` : "") : whyHTML(L)}`;
      document.getElementById("wtGo").onclick = async ()=>{ const lb = +document.getElementById("wtLb").value; const m = document.getElementById("wtMsg");
        if (!(lb > 50 && lb < 500)) { m.textContent = "A weight in pounds, like 216.4."; return; }
        m.textContent = "saving…"; try{ await bridge("/weigh-in", { method: "POST", headers: J, body: JSON.stringify({ lb }) }); await draw(); }catch(e){ m.textContent = String(e.message).replace(/^bridge \d+ — /, ""); } };
    }, first);
    await draw(true);
  };

  // ---------------- Micros ----------------
  V.micros = async function(){
    const el = page("Micronutrients");
    const draw = (first)=> load(el, "micros", ["/chain", "/food/today"], [1], (chain, food) => {
      // the link's numbers are the day report's own micros score; until /chain lands they are read from it
      const m = food && food.micros, stOf = v => v == null ? "none" : v >= 80 ? "good" : v >= 60 ? "warn" : "bad";
      const L = (chain && chain.links && chain.links.micros) || (m ? { week: m.score, state: stOf(m.score), today: m.score, today_word: m.band && m.band.word, gaps: (m.gaps || []).map(g => g.label), basis: "" } : null), B = window.foodBits || {};
      // shortfalls first: the nutrients furthest from their targets at the top, the covered ones after
      const mSorted = m && Array.isArray(m.per) ? Object.assign({}, m, { per: m.per.slice().sort((a, b) => (a.pct || 0) - (b.pct || 0)) }) : m;
      el.innerHTML = headHTML("micros", "Micros", L, { brk: chain && chain.break_at, weekU: "" }) + `
        <div class="card ln-micros">${B.microHTML && food ? B.microHTML(mSorted, food) : `<div class="small">loading…</div>`}</div>
        <div class="ln-sec"><span class="hu-lab">Log food</span></div>
        ${sayWriteHTML("miSw", "spinach salad with salmon and a handful of almonds", "“spinach salad, salmon”")}
        ${whyHTML(L)}`;
      if (B.wireMicro) B.wireMicro(el, ()=> draw());
      wireSayWrite(el, "miSw", draw);
    }, first);
    await draw(true);
  };

  // opened straight onto one of these pages: app.js ran nav() before this file loaded
  const here = location.hash.replace(/^#/, "").split("?")[0];
  if (["hydration","fuel","sleep","recovery","weight","micros"].includes(here)) nav();
})();
