"use strict";
/* THE WAY — the workout player (#player, #player?id=<workout id>), v1 of docs/workout-player-spec.md.
   Chrome on the Windows PC talks to the KICKR CORE over Web Bluetooth FTMS (power, cadence, speed; ERG through
   the control point 0x2AD9) and to the Tymewear strap (heart rate from the standard service; every other value
   it sends is kept raw, in hex, for decoding the breathing later). The workout plays at the planning FTP.
   A ride is always saved, never just exited: every second goes into IndexedDB ('the-way-player' / 'rides'),
   written every 5 s and at each interval change, so a crash or a closed tab loses seconds, and the next visit
   offers to finish and save it. On End the page builds a FIT file (pwa/fit.js) and posts it with the samples
   to the bridge, which keeps the ride (it counts on Day and Calendar at once) and sends the FIT to intervals.icu.
   Dev switch, not shown anywhere: #player?id=…&sim=1[&speed=30] feeds made-up power, heart rate and cadence.
   Loads after app.js and fit.js and uses their globals: V, view, bridge, esc, hm12, FIT. */
(function(){
  const J = { "Content-Type": "application/json" };
  const alive = () => location.hash.split("?")[0] === "#player";
  const params = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const FTMS = 0x1826, BIKE_DATA = 0x2ad2, CONTROL = 0x2ad9, CPS = 0x1818;
  const LS = { trainer: "way-player-trainer", strap: "way-player-strap", breath: "way-player-breath" };
  const HR_Z1 = 116, HR_Z2 = 138, HR_Z1_LO = 100;        // Zone 1 is 100 to 116 (a floor as well as a ceiling); VT2 139
  const RAW_CAP_EACH = 4000, RAW_CAP_ALL = 12000;        // raw strap values kept per ride, for decoding breathing later
  const lsGet = k => { try{ return localStorage.getItem(k); }catch{ return null; } };
  const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch{} };
  const pad2 = n => String(n).padStart(2, "0");
  const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`; };
  const keyOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time12 = ms => { const d = new Date(ms); let h = d.getHours(); const ap = h < 12 ? "a" : "p"; h = h % 12 || 12; return `${h}:${pad2(d.getMinutes())}${ap}`; };
  const day12 = ms => new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const dateKeyLabel = k => /^\d{4}-\d{2}-\d{2}$/.test(k || "") ? new Date(k + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const hex = dv => Array.from(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)).map(b => b.toString(16).padStart(2, "0")).join("");

  // ---------- the clock: real time, or faster in the simulator ----------
  const CLK = { speed: 1, realBase: Date.now(), base: Date.now() };
  const now = () => CLK.speed === 1 ? Date.now() : CLK.base + (Date.now() - CLK.realBase) * CLK.speed;
  function setSpeed(x){ CLK.base = now(); CLK.realBase = Date.now(); CLK.speed = Math.max(1, Math.min(120, +x || 1)); }

  // ---------- IndexedDB: the ride as it happens ----------
  let dbP = null;
  function db(){
    if (!dbP) dbP = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("this browser has no IndexedDB"));
      const rq = indexedDB.open("the-way-player", 1);
      rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains("rides")) rq.result.createObjectStore("rides", { keyPath: "id" }); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    return dbP;
  }
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => { const t = d.transaction("rides", mode); const s = t.objectStore("rides"); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }));
  const DB = { put: rec => tx("readwrite", s => s.put(rec)), all: () => tx("readonly", s => s.getAll()), del: id => tx("readwrite", s => s.delete(id)) };

  // ---------- the session: the workout as intervals in watts ----------
  // The bridge lays it out (GET /player/session/…); a bridge without that route still gets a ride: the page lays it out itself.
  function expand(steps, ftp){
    const out = []; let t = 0;
    const pw = p => Math.round(p / 100 * ftp);
    const push = (s, rep) => {
      const g = s.target || { type: "free" };
      let kind = g.type, tw = null, te = null, th = null;
      if (g.type === "power") tw = pw((g.lo + g.hi) / 2);
      else if (g.type === "watts"){ tw = Math.round((g.lo + g.hi) / 2); kind = "power"; }
      else if (g.type === "ramp"){ tw = pw(g.from); te = pw(g.to); }
      else if (g.type === "hr") th = { lo: g.lo, hi: g.hi };
      else kind = "free";
      out.push({ label: s.label || (rep && rep.label) || (kind === "hr" ? "Hold HR" : kind === "free" ? "Ride by feel" : "Interval"), start_s: t, dur_s: s.dur_s, target_w: tw, target_w_end: te, target_hr: th, kind, rep: rep ? `${rep.n} of ${rep.of}` : null });
      t += s.dur_s;
    };
    for (const it of steps || []) if (it.kind === "repeat") for (let n = 1; n <= (it.count || 1); n++) for (const s of it.steps || []) push(s, { n, of: it.count, label: it.label }); else push(it, null);
    return out;
  }
  const toMin = t => /^\d{2}:\d{2}$/.test(t || "") ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null;
  function fuelSlots(meals, time){
    const sm = toMin(time);
    return (meals || []).filter(m => m && (m.slot === "before" || m.slot === "on the bike")).filter(m => { if (sm == null) return true; const mm = toMin(m.time); if (mm == null) return true; return m.slot === "before" ? mm >= sm - 300 && mm <= sm : Math.abs(mm - sm) <= 30; })
      .map(m => ({ slot: m.slot, time: m.time || null, what: m.what || "", carbs_g: m.carbs_g || null }));
  }
  async function loadSession(id){
    try { return await bridge("/player/session/" + encodeURIComponent(id || "today")); }
    catch (e){
      if (e.body && e.body.error === "no such workout") throw e;
      const st = await bridge("/workouts/settings").catch(() => ({ ftp: 175 }));
      const ftp = st && st.ftp || 175, today = keyOf(new Date());
      let w = null, choices = [];
      if (id && id !== "today") w = await bridge("/workouts/" + encodeURIComponent(id));
      else {
        const l = ((await bridge(`/workouts?from=${today}&to=${today}`)) || {}).workouts || [];
        const rides = l.filter(x => !/weight|lift|strength|^run$|walk|hike/i.test(x.sport || "")).sort((a, b) => (a.time || "99") < (b.time || "99") ? -1 : 1);
        const nm = new Date().getHours() * 60 + new Date().getMinutes();
        w = rides.find(x => toMin(x.time) == null || toMin(x.time) + Math.round((x.metrics && x.metrics.duration_s || 0) / 60) > nm) || rides[rides.length - 1] || null;
        choices = rides.map(x => ({ id: x.id, name: x.name, time: x.time || null }));
      }
      if (!w) return { workout: null, settings: { ftp }, choices, date: today };
      let fuel = [];
      if (w.date === today){ try{ const f = await bridge("/food/today"); fuel = fuelSlots(f && f.meals, w.time); }catch{} }
      const m = w.metrics || {};
      return { date: w.date, settings: { ftp }, fuel, choices,
        workout: { id: w.id, name: w.name, date: w.date, time: w.time || null, sport: w.sport, duration_s: m.duration_s, tss: m.tss, np_w: m.np_w, intervals_event_id: w.sync && w.sync.intervals_event_id || null },
        intervals: expand(w.steps, ftp) };
    }
  }
  const FREE_RIDE = ftp => ({ workout: { id: null, name: "Free ride", date: keyOf(new Date()), time: null, duration_s: 4 * 3600 }, settings: { ftp }, fuel: [], choices: [],
    intervals: [{ label: "Free ride", start_s: 0, dur_s: 4 * 3600, target_w: null, target_w_end: null, target_hr: null, kind: "free", rep: null }] });

  // ---------- the profile: a block per interval, its height the target watts ----------
  const ZC = f => f < 0.56 ? "var(--water)" : f < 0.76 ? "var(--green)" : f < 0.91 ? "#B9D27A" : f < 1.06 ? "var(--amber)" : "var(--red)";
  function profileSVG(ivs, ftp, o){
    o = o || {};
    const W = 1000, H = o.h || 120, total = ivs.reduce((s, x) => Math.max(s, x.start_s + x.dur_s), 0) || 1;
    const top = Math.max(ftp * 1.3, ...ivs.map(x => Math.max(x.target_w || 0, x.target_w_end || 0)));
    const y = w => H - Math.max(0.04, Math.min(1, w / top)) * (H - 4);
    const blocks = ivs.map(x => {
      const x0 = x.start_s / total * W, x1 = (x.start_s + x.dur_s) / total * W;
      if (x.target_w == null){
        const yy = y(ftp * 0.5);
        return `<rect x="${x0.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.max(0.6, x1 - x0 - 0.6).toFixed(1)}" height="${(H - yy).toFixed(1)}" fill="url(#plHatch)"><title>${esc(x.label)} · ${x.kind === "hr" ? `hold HR ≤ ${x.target_hr ? x.target_hr.hi : HR_Z1}` : "ride by feel"} · ${clock(x.dur_s)}</title></rect>`;
      }
      const a = x.target_w, b = x.target_w_end != null ? x.target_w_end : a;
      return `<polygon points="${x0.toFixed(1)},${H} ${x0.toFixed(1)},${y(a).toFixed(1)} ${Math.max(x0 + 0.6, x1 - 0.6).toFixed(1)},${y(b).toFixed(1)} ${Math.max(x0 + 0.6, x1 - 0.6).toFixed(1)},${H}" fill="${ZC(Math.max(a, b) / ftp)}"><title>${esc(x.label)} · ${a}${b !== a ? "→" + b : ""} W · ${clock(x.dur_s)}</title></polygon>`;
    }).join("");
    const ftpLine = `<line x1="0" x2="${W}" y1="${y(ftp).toFixed(1)}" y2="${y(ftp).toFixed(1)}" class="pl-ftp"/>`;
    const cursor = o.cursor != null ? `<rect x="0" y="0" width="${(Math.min(1, o.cursor / total) * W).toFixed(1)}" height="${H}" class="pl-done"/><line class="pl-cur" x1="${(Math.min(1, o.cursor / total) * W).toFixed(1)}" x2="${(Math.min(1, o.cursor / total) * W).toFixed(1)}" y1="0" y2="${H}"/>` : "";
    return `<svg class="pl-prof${o.cls ? " " + o.cls : ""}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Workout profile"><defs><pattern id="plHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#1b1d1a"/><rect width="3" height="8" fill="#3a3d36"/></pattern></defs>${blocks}${ftpLine}${cursor}</svg>`;
  }
  // The five heart-rate zones on the ride screen, from LTHR 139 (the site's %LT bands): a stack of five bands, the
  // one the interval trains outlined, and a pointer that rides up and down with the heart rate.
  // Five zones from the two thresholds, the way a ventilatory model lays them out: Z1 and Z2 below VT1 (the cut
  // at 90% of it), Z3 and Z4 between VT1 and VT2 (cut halfway), Z5 above VT2. The thresholds come with the session
  // (the ramp test's, else 117 and 139), so when the breathing data moves them the zones move with them.
  let HR_ZONES = [];
  function setZones(t){
    const vt1 = t && t.vt1_hr || 117, vt2 = t && t.vt2_hr || 139, max = t && t.max_hr || 162, mid = Math.round((vt1 + vt2) / 2), low = Math.round(vt1 * 0.9);
    HR_ZONES = [{ z: 1, name: "Recovery", lo: 0, hi: low }, { z: 2, name: "Aerobic", lo: low, hi: vt1 }, { z: 3, name: "Tempo", lo: vt1, hi: mid }, { z: 4, name: "Threshold", lo: mid, hi: vt2 }, { z: 5, name: "VO2", lo: vt2, hi: max }];
  }
  setZones(null);
  const hrZoneOf = hr => hr == null ? null : HR_ZONES.find(z => hr < z.hi) || HR_ZONES[4];
  // the zone an interval trains: a heart-rate target by its ceiling, a power target by % of FTP (Coggan's bands)
  const wantZone = (iv, ftp) => { if (!iv) return null;
    if (iv.kind === "hr") return hrZoneOf(iv.target_hr ? iv.target_hr.hi : HR_Z1);
    if (iv.target_w == null) return null;
    const f = Math.max(iv.target_w, iv.target_w_end || 0) / ftp;
    return HR_ZONES[f < 0.55 ? 0 : f < 0.76 ? 1 : f < 0.91 ? 2 : f < 1.06 ? 3 : 4]; };
  const zonesHTML = () => `<div class="pl-zones" id="plZones" aria-hidden="true">${HR_ZONES.slice().reverse().map(z => `<div class="pz pz${z.z}" data-z="${z.z}" title="${z.lo}–${z.hi}"><b>Z${z.z}</b><span>${z.name}</span><i>${z.z === 5 ? `${z.lo}+` : `${z.lo}–${z.hi}`}</i></div>`).join("")}<div class="pz-ptr" id="pzPtr" hidden>▶</div></div>`;
  function paintZones(hr, iv, ftp){
    const box = document.getElementById("plZones"); if (!box) return;
    const want = wantZone(iv, ftp), zin = hrZoneOf(hr);
    box.querySelectorAll(".pz").forEach(el => { const z = +el.dataset.z; el.classList.toggle("want", !!want && want.z === z); el.classList.toggle("in", !!zin && zin.z === z); });
    const p = document.getElementById("pzPtr");
    if (!p) return;
    if (hr == null || !zin){ p.hidden = true; return; }
    // the pointer's height: the zone's band, then where inside it the heart rate sits (clamped to the band)
    const idx = 5 - zin.z, frac = Math.max(0, Math.min(1, (hr - zin.lo) / (zin.hi - zin.lo)));
    p.hidden = false; p.style.top = `calc(${((idx + 1 - frac) / 5 * 100).toFixed(1)}% - 0.5em)`;
    p.className = `pz-ptr${want && zin.z === want.z ? " on" : want && zin.z < want.z ? " under" : want ? " over" : ""}`;
  }
  const targetWords = (x, bias) => !x ? "" : x.target_w != null ? `${Math.round(x.target_w * (1 + bias / 100))}${x.target_w_end != null ? "→" + Math.round(x.target_w_end * (1 + bias / 100)) : ""} W` : x.kind === "hr" ? (x.target_hr && x.target_hr.lo >= 100 ? `HR ${x.target_hr.lo}–${x.target_hr.hi}, the trainer finds the watts` : `hold HR ≤ ${x.target_hr ? x.target_hr.hi : HR_Z1}`) : "ride by feel";

  // ---------- the power to follow: target watts over time, what you're riding drawn over it ----------
  // One axis, watts. Each interval is a block at its target (ramps slope), coloured by zone; the number on a block is
  // the watts to hold. On the ride the window moves: the last minutes behind the now line with your power (3 s
  // average) drawn in white over the target, the next minutes ahead with their watts and when they start.
  // The SVG is drawn at the box's own pixel width, so the numbers keep their shape.
  const nice = v => v <= 300 ? Math.ceil(v / 50) * 50 : Math.ceil(v / 100) * 100;
  const span = s => s >= 3600 && s % 3600 === 0 ? `${s / 3600} h` : s % 60 === 0 ? `${s / 60} min` : clock(s);
  function followSVG(ivs, ftp, o){
    o = o || {};
    const W = Math.max(280, Math.round(o.w || 800)), H = Math.max(140, Math.round(o.h || 240));
    const L0 = 40, R0 = o.hr ? 36 : 10, T0 = 30, B0 = 22, pw = W - L0 - R0, ph = H - T0 - B0;
    const bias = 1 + (o.bias || 0) / 100;
    const total = ivs.reduce((s, x) => Math.max(s, x.start_s + x.dur_s), 0) || 1;
    const from = o.from != null ? o.from : 0, to = o.to != null ? o.to : total, len = Math.max(1, to - from);
    const X = t => L0 + (t - from) / len * pw;
    const trace = o.trace || [];
    const top = nice(Math.max(ftp * 1.15, ...ivs.map(x => Math.max(x.target_w || 0, x.target_w_end || 0) * bias * 1.08), ...trace.map(p => p[1] * 1.05)));
    const Y = w => T0 + ph - Math.max(0, Math.min(1, w / top)) * ph;
    const step = top <= 300 ? 50 : 100;
    let g = "";
    for (let w = 0; w <= top; w += step) g += `<line class="pf-grid" x1="${L0}" x2="${W - R0}" y1="${Y(w).toFixed(1)}" y2="${Y(w).toFixed(1)}"/><text class="pf-ax" x="${L0 - 6}" y="${(Y(w) + 4).toFixed(1)}" text-anchor="end">${w}</text>`;
    g += `<text class="pf-ax" x="${L0 - 6}" y="${T0 - 14}" text-anchor="end">W</text>`;
    // the time ticks: minutes from now on the ride, the workout clock on the start screen
    const tickEvery = [30, 60, 120, 300, 600, 900, 1800, 3600].find(s => len / s <= (W < 600 ? 5 : 8)) || 3600;
    const t0 = o.now != null ? o.now - Math.floor((o.now - from) / tickEvery) * tickEvery : Math.ceil(from / tickEvery) * tickEvery;
    for (let t = t0; t <= to; t += tickEvery){
      if (t < 0) continue;
      const lab = o.now != null ? (t === o.now ? "now" : (t > o.now ? "+" : "−") + span(Math.abs(t - o.now))) : clock(t);
      const xt = X(t), anchor = xt > W - R0 - 22 ? "end" : xt < L0 + 16 ? "start" : "middle";
      g += `<line class="pf-tick" x1="${xt.toFixed(1)}" x2="${xt.toFixed(1)}" y1="${T0 + ph}" y2="${T0 + ph + 4}"/><text class="pf-ax" x="${xt.toFixed(1)}" y="${H - 5}" text-anchor="${anchor}">${lab}</text>`;
    }
    const hatchY = Y(ftp * 0.5);
    let blocks = "", labels = "";
    let lastLabelEnd = -1e9, lastLabel = { text: "", x: -1e9 };
    ivs.forEach((x, k) => {
      const s = x.start_s, e = x.start_s + x.dur_s;
      if (e <= from || s >= to) return;
      const a = Math.max(s, from), b = Math.min(e, to), xa = X(a), xb = X(b);
      const curr = o.now != null && o.now >= s && o.now < e, past = o.now != null && e <= o.now;
      const cls = `pf-blk${curr ? " now" : past ? " past" : ""}`;
      const tip = `<title>${esc(x.label)}${x.rep ? " " + esc(x.rep) : ""} · ${esc(targetWords(x, o.bias || 0))} · ${clock(x.dur_s)}</title>`;
      if (x.target_w == null){
        blocks += `<rect class="${cls}" x="${xa.toFixed(1)}" y="${hatchY.toFixed(1)}" width="${Math.max(0.5, xb - xa - 1).toFixed(1)}" height="${(T0 + ph - hatchY).toFixed(1)}" fill="url(#pfHatch)">${tip}</rect>`;
        if (xb - xa >= 46 && xa >= lastLabelEnd && !past){ labels += `<text class="pf-free" x="${(Math.max(xa, X(o.now != null ? Math.max(s, o.now) : s)) + 5).toFixed(1)}" y="${(hatchY - 7).toFixed(1)}">${x.kind === "hr" ? (x.target_hr && x.target_hr.lo >= 100 ? `HR ${x.target_hr.lo}–${x.target_hr.hi}` : `HR ≤ ${x.target_hr ? x.target_hr.hi : HR_Z1}`) : "feel"}</text>`; lastLabelEnd = xa + 60; }
        return;
      }
      const w0 = x.target_w * bias, w1 = (x.target_w_end != null ? x.target_w_end : x.target_w) * bias;
      const at = t => w0 + (w1 - w0) * (t - s) / Math.max(1, x.dur_s);
      const ya = Y(at(a)), yb = Y(at(b)), xe = Math.max(xa + 0.5, xb - 1);
      const col = ZC(Math.max(w0, w1) / bias / ftp);
      blocks += `<g class="${cls}">${tip}<polygon points="${xa.toFixed(1)},${T0 + ph} ${xa.toFixed(1)},${ya.toFixed(1)} ${xe.toFixed(1)},${yb.toFixed(1)} ${xe.toFixed(1)},${T0 + ph}" fill="${col}" class="pf-fill"/><line x1="${xa.toFixed(1)}" y1="${ya.toFixed(1)}" x2="${xe.toFixed(1)}" y2="${yb.toFixed(1)}" stroke="${col}" class="pf-edge"/></g>`;
      // the watts to hold, on the block, where there is room; the next interval also says when it starts
      if (past) return;
      const watts = `${Math.round(w0)}${x.target_w_end != null ? "→" + Math.round(w1) : ""}`;
      const tw = watts.length * (curr ? 15 : 10) + 4;
      // a block too narrow for its number still gets it when it is a peak (a 40 s effort), once per run of equal ones
      const hiOf = v => v ? Math.max(v.target_w || 0, v.target_w_end || 0) : 0, mine = hiOf(x);
      const peak = mine > hiOf(ivs[k - 1]) && mine > hiOf(ivs[k + 1]);
      let lx = curr ? X(o.now) + 6 : xa + 4;
      if (xb - lx < tw){ if (!peak) return; lx = xa; }
      if (lx < lastLabelEnd || (watts === lastLabel.text && lx - lastLabel.x < 160)) return;
      lastLabel = { text: watts, x: lx };
      const isNext = o.now != null && !curr && k > 0 && ivs[k - 1].start_s <= o.now && ivs[k - 1].start_s + ivs[k - 1].dur_s > o.now;
      const ly = Math.min(ya, yb) - 7;
      labels += `<text class="pf-w${curr ? " now" : ""}" x="${lx.toFixed(1)}" y="${Math.max(T0 - 12, ly).toFixed(1)}">${watts}</text>`;
      if (isNext && xb - xa >= 52) labels += `<text class="pf-in" x="${(xa + 4).toFixed(1)}" y="${(T0 + ph - 6).toFixed(1)}">in ${clock(s - o.now)}</text>`;
      lastLabelEnd = lx + tw + 4;
    });
    // heart rate: a red 3 s average on a right-hand axis from 80 to 170 bpm, with the VO2 line at 147
    const HR_LO = 80, HR_HI = 170, YH = v => T0 + ph - Math.max(0, Math.min(1, (v - HR_LO) / (HR_HI - HR_LO))) * ph;
    let hrLayer = "";
    if (o.hr){
      for (let v = HR_LO; v <= HR_HI; v += 20) hrLayer += `<text class="pf-ax pf-hrax" x="${W - R0 + 6}" y="${(YH(v) + 4).toFixed(1)}" text-anchor="start">${v}</text>`;
      hrLayer += `<line class="pf-vo2" x1="${L0}" x2="${W - R0}" y1="${YH(147).toFixed(1)}" y2="${YH(147).toFixed(1)}"/><text class="pf-ax pf-vo2l" x="${L0 + 4}" y="${(YH(147) - 4).toFixed(1)}">VO2 147</text>`;
      const avg3 = (tr, i) => { const lo = Math.max(0, i - 2); let s = 0, n = 0; for (let j = lo; j <= i; j++) if (tr[j][1] != null && tr[j][0] - tr[i][0] > -4){ s += tr[j][1]; n++; } return n ? s / n : null; };
      const pts = [];
      for (let i = 0; i < o.hr.length; i++){ const v = avg3(o.hr, i); if (v == null || o.hr[i][0] < from) continue; pts.push(`${i && o.hr[i][0] - o.hr[i - 1][0] > 2 ? "M" : pts.length ? "L" : "M"}${X(o.hr[i][0]).toFixed(1)},${YH(v).toFixed(1)}`); }
      if (pts.length > 1) hrLayer += `<path class="pf-hr" d="${pts.join("")}"/>`;
      if (o.hrNow != null) hrLayer += `<circle class="pf-hrdot" cx="${X(o.now).toFixed(1)}" cy="${YH(o.hrNow).toFixed(1)}" r="4"/>`;
    }
    // breathing: a blue line on its own scale, 10 to 60 breaths a minute, only once the values decode
    let brLayer = "";
    if (o.breath && o.breath.length > 1){
      const YB = v => T0 + ph - Math.max(0, Math.min(1, (v - 10) / 50)) * ph;
      const pts = o.breath.filter(p => p[0] >= from).map((p, i, arr) => `${i && p[0] - arr[i - 1][0] > 10 ? "M" : i ? "L" : "M"}${X(p[0]).toFixed(1)},${YB(p[1]).toFixed(1)}`);
      brLayer = `<path class="pf-br" d="${pts.join("")}"/><text class="pf-ax pf-brl" x="${W - R0 - 4}" y="${T0 - 14}" text-anchor="end">breaths/min 10–60</text>`;
    }
    const ftpY = Y(ftp).toFixed(1);
    const ftpLine = `<line class="pf-ftp" x1="${L0}" x2="${W - R0}" y1="${ftpY}" y2="${ftpY}"/><text class="pf-ax pf-ftpl" x="${W - R0 - 2}" y="${(+ftpY - 4).toFixed(1)}" text-anchor="end">FTP ${ftp}</text>`;
    // what you rode: 3 s average, white over the target
    let line = "";
    if (trace.length > 1){
      const pts = [];
      for (let i = 0; i < trace.length; i++){
        const lo = Math.max(0, i - 2); let s = 0, n = 0;
        for (let j = lo; j <= i; j++) if (trace[j][1] != null && trace[j][0] - trace[i][0] > -4){ s += trace[j][1]; n++; }
        if (n && trace[i][0] >= from) pts.push(`${(i && trace[i][0] - trace[i - 1][0] > 2 ? "M" : pts.length ? "L" : "M")}${X(trace[i][0]).toFixed(1)},${Y(s / n).toFixed(1)}`);
      }
      line = `<path class="pf-ride" d="${pts.join("")}"/>`;
    }
    let now = "";
    if (o.now != null){
      const nx = X(o.now).toFixed(1);
      now = `<rect class="pf-past" x="${L0}" y="${T0}" width="${Math.max(0, +nx - L0).toFixed(1)}" height="${ph}"/><line class="pf-now" x1="${nx}" x2="${nx}" y1="${T0 - 6}" y2="${T0 + ph}"/>`;
      if (o.power != null) now += `<circle class="pf-dot" cx="${nx}" cy="${Y(o.power).toFixed(1)}" r="5"/>`;
      if (o.paused) now += `<text class="pf-paused" x="${(L0 + pw / 2).toFixed(1)}" y="${(T0 + ph / 2).toFixed(1)}" text-anchor="middle">PAUSED</text>`;
    }
    return `<svg class="pf" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "The power to follow")}"><defs><pattern id="pfHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#1b1d1a"/><rect width="3" height="8" fill="#3a3d36"/></pattern></defs>${g}${blocks}${ftpLine}${now}${line}${hrLayer}${brLayer}${labels}</svg>`;
  }
  // the ride's window: two minutes behind, ten ahead on the PC; one behind, five ahead on a phone
  function drawFollow(){
    const box = document.getElementById("plFollow"); if (!box || !ride) return;
    const w = box.clientWidth, h = box.clientHeight || 240, small = w < 600;
    const back = small ? 60 : 120, ahead = small ? 300 : 600, wt = ride.wt;
    const trace = [], hr = [];
    for (let i = ride.samples.length - 1; i >= 0; i--){ const a = ride.samples[i]; if (a[8] == null || a[8] < wt - back - 4) break; trace.push([a[8], a[1]]); if (a[3] != null) hr.push([a[8], a[3]]); }
    trace.reverse(); hr.reverse();
    const breath = (ride.breath || []).filter(p => p[0] >= wt - back - 4);
    const fresh = now() - L.bikeAt <= 3000, hrFresh = now() - L.hrAt <= 3000;
    box.innerHTML = followSVG(ride.intervals, ride.ftp, { w, h, from: wt - back, to: wt + ahead, now: wt, bias: ride.bias, trace, power: fresh ? L.power : null, hr, hrNow: hrFresh ? L.hr : null, breath: breath.length > 1 ? breath : null, paused: ride.state === "paused", label: "The power to follow: target watts ahead, your power behind" });
  }
  function drawWhole(S){
    const box = document.getElementById("plWhole"); if (!box) return;
    box.innerHTML = followSVG(S.intervals || [], S.settings && S.settings.ftp || 175, { w: box.clientWidth, h: box.clientHeight || 220, label: "The power to follow, the whole workout" });
  }
  let resizeT = null;
  window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (!alive()) return; if (document.getElementById("plFollow")) drawFollow(); else if (S0) drawWhole(S0); }, 120); });

  // ---------- the goal circle: it fills as the session's one goal is met ----------
  // The plan has two rides, and each has one goal, the same one the Calendar grades it on (bridge/workouts.js):
  //   Zone 1: the planned minutes at heart rate 100 to 116 (117 is VT1); up to 10% of the ride at 117 or above still passes,
  //           and up to 25% under 100 (the floor: a Zone 1 ride is work, not a stroll).
  //   VO2 40/20s: 8 to 12 minutes above 139 (VT2, Harry's VO2 line); the circle is full at 8, and past 12 is more than the session asks.
  //   Anything else: the planned time, ridden.
  const VT1 = 117, VT2 = 139, HR_HARD = 147;   // the player's VO2 score counts minutes above 147, Tymewear's VO2max heart rate
  function goalOf(w, ivs){
    const name = String(w && w.name || ""), plannedS = (ivs || []).reduce((s, x) => Math.max(s, x.start_s + x.dur_s), 0);
    if (/vo2|40\s*\/\s*20/i.test(name)) return { kind: "vo2", target_min: 8, hi_min: 12, words: `8 to 12 min above ${HR_HARD}` };
    if (/zone\s*1|\bz1\b/i.test(name)) return { kind: "z1", target_min: Math.round(plannedS / 60), words: `${Math.round(plannedS / 60)} min at ${HR_Z1_LO} to ${HR_Z1}` };
    if (!w || !w.id) return null;                         // a free ride has no goal
    return { kind: "time", target_min: Math.round(plannedS / 60), words: `${Math.round(plannedS / 60)} min ridden` };
  }
  function goalNow(g, samples){
    let n = 0, under = 0, low = 0, hard = 0, z3 = 0, hrN = 0;
    for (const a of samples || []){ n++; const h = a[3]; if (h == null || h < 30) continue; hrN++; if (h < VT1 && h >= HR_Z1_LO) under++; if (h < HR_Z1_LO) low++; if (h > HR_HARD) hard++; if (h >= VT2) z3++; }
    const m = s => Math.floor(s / 60);
    if (g.kind === "vo2"){
      const v = hard / 60, met = v >= g.target_min, past = v > g.hi_min;
      return { frac: Math.min(1, v / g.target_min), big: m(hard), of: `of ${g.target_min} min`, lab: `above ${HR_HARD}`, band: past ? "hold" : met ? "go" : "run",
        sub: past ? `past ${g.hi_min}: more than the session asks` : met ? `up to ${g.hi_min} min` : hrN ? "" : "waiting for heart rate", met };
    }
    if (g.kind === "z1"){
      // the minutes in the band count; the share over the ceiling and the share under the floor each have a limit
      const over = hrN ? Math.round((hrN - under - low) / hrN * 100) : 0, lowPct = hrN ? Math.round(low / hrN * 100) : 0, met = under / 60 >= g.target_min;
      const band = over > 20 || lowPct > 40 ? "stop" : over > 10 || lowPct > 25 ? "hold" : met ? "go" : "run";
      return { frac: g.target_min ? Math.min(1, under / 60 / g.target_min) : 0, big: m(under), of: `of ${g.target_min} min`, lab: `at ${HR_Z1_LO} to ${HR_Z1}`, band,
        sub: !hrN ? "waiting for heart rate" : `${over}% at ${VT1} or above${over > 10 ? " (limit 10%)" : ""} · ${lowPct}% under ${HR_Z1_LO}${lowPct > 25 ? " (limit 25%)" : ""}`, met };
    }
    const met = n / 60 >= g.target_min;
    return { frac: g.target_min ? Math.min(1, n / 60 / g.target_min) : 0, big: m(n), of: `of ${g.target_min} min`, lab: "ridden", band: met ? "go" : "run", sub: met ? "goal met" : "", met };
  }
  // a disc that grows from the centre out to the border as the goal is met; its area is the share done, so half the goal is half the circle
  function ringSVG(st, size){
    const S = size || 200, c = S / 2, R = S / 2 - 3, f = Math.max(0, Math.min(1, st.frac || 0)), r = R * Math.sqrt(f);
    return `<svg class="gr-svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(`${st.big} ${st.of} ${st.lab}`)}">
      <circle class="gr-bg" cx="${c}" cy="${c}" r="${R.toFixed(1)}"/>
      <circle class="gr-half" cx="${c}" cy="${c}" r="${(R * Math.SQRT1_2).toFixed(1)}"/>
      ${r > 0.5 ? `<circle class="gr-fill gr-${st.band}" cx="${c}" cy="${c}" r="${r.toFixed(1)}"/>` : ""}
      <circle class="gr-rim${f >= 1 ? " gr-" + st.band : ""}" cx="${c}" cy="${c}" r="${R.toFixed(1)}"/>
      <text class="gr-big" x="${c}" y="${(c + S * 0.08).toFixed(1)}" text-anchor="middle" font-size="${Math.round(S * 0.3)}">${st.big}</text>
      <text class="gr-of" x="${c}" y="${(c + S * 0.22).toFixed(1)}" text-anchor="middle" font-size="${Math.max(10, Math.round(S * 0.065))}">${esc(st.of)}</text></svg>`;
  }
  function goalHTML(g, samples, size){
    if (!g) return "";
    const st = goalNow(g, samples);
    return `<div class="gr${st.met ? " met" : ""}">${ringSVG(st, size)}<div class="gr-txt">${st.met ? `<span class="hu-lab">Met</span>` : ""}<span class="gr-lab">${esc(st.lab)}</span><span class="gr-sub small">${esc(st.sub)}</span></div></div>`;
  }

  // ---------- the devices ----------
  const L = { power: null, cadence: null, speed: null, hr: null, bikeAt: 0, hrAt: 0 };
  const DEV = { trainer: null, control: null, strap: null, breath: null, trainerName: null, strapName: null, breathName: null, sent: undefined, chooseNext: { trainer: false, strap: false, breath: false } };
  const ctlLog = window.__playerCtl = [];
  let ctlQ = Promise.resolve();
  function ctl(bytes, what){
    ctlLog.push({ at: now(), what, bytes: Array.from(bytes) });
    if (ctlLog.length > 500) ctlLog.shift();
    if (!DEV.control) return ctlQ;
    ctlQ = ctlQ.then(() => DEV.control.writeValueWithResponse(new Uint8Array(bytes))).catch(e => note(`trainer: ${what} not taken (${e.message})`));
    return ctlQ;
  }
  const ergWatts = w => { const b = new Uint8Array(3); b[0] = 0x05; new DataView(b.buffer).setInt16(1, w, true); return b; };
  // "resistance mode": flat road simulation (0x11: wind 0, grade 0 %, Crr 0.004, Cw 0.51), the gears do the work
  const FLAT = [0x11, 0x00, 0x00, 0x00, 0x00, 40, 51];
  function parseBikeData(dv){
    const f = dv.getUint16(0, true); let i = 2; const out = {};
    if (!(f & 1)){ out.speed = dv.getUint16(i, true) / 100; i += 2; }
    if (f & 2) i += 2;
    if (f & 4){ out.cadence = dv.getUint16(i, true) / 2; i += 2; }
    if (f & 8) i += 2;
    if (f & 16) i += 3;
    if (f & 32) i += 2;
    if (f & 64){ out.power = dv.getInt16(i, true); i += 2; }
    return out;
  }
  async function pickDevice(kind, opts){
    const saved = lsGet(LS[kind]);
    if (saved && !DEV.chooseNext[kind] && navigator.bluetooth.getDevices){
      try{ const d = (await navigator.bluetooth.getDevices()).find(x => x.name === saved); if (d) return d; }catch{}
    }
    DEV.chooseNext[kind] = false;
    return navigator.bluetooth.requestDevice(opts);
  }
  async function connectTrainer(auto){
    if (SIM.on){ DEV.trainerName = "Simulated trainer"; DEV.control = null; DEV.trainer = { sim: true }; drawDevices(); return; }
    if (!navigator.bluetooth) return;
    setDevState("trainer", "connecting…");
    try{
      const dev = await pickDevice("trainer", { filters: [{ services: [FTMS] }, { namePrefix: "KICKR" }], optionalServices: [FTMS, CPS, "device_information"] });
      await attachTrainer(dev);
      lsSet(LS.trainer, dev.name || "");
      if (!dev.__wayWatch){ dev.__wayWatch = true; dev.addEventListener("gattserverdisconnected", () => { DEV.control = null; DEV.trainer = null; drawDevices(); note("trainer disconnected"); if (ride && ride.state === "riding") reconnect(dev, attachTrainer, "trainer"); }); }
    }catch(e){ if (!auto) DEV.chooseNext.trainer = true; setDevState("trainer", auto ? "not in range yet" : /cancel/i.test(e.message) ? "not connected" : `not connected: ${e.message}`); throw e; }
  }
  async function attachTrainer(dev){
    const gatt = await dev.gatt.connect();
    const ftms = await gatt.getPrimaryService(FTMS);
    const data = await ftms.getCharacteristic(BIKE_DATA);
    await data.startNotifications();
    if (!data.__way){ data.__way = true; data.addEventListener("characteristicvaluechanged", e => { const d = parseBikeData(e.target.value); if (d.power != null) L.power = d.power; if (d.cadence != null) L.cadence = Math.round(d.cadence); if (d.speed != null) L.speed = d.speed; L.bikeAt = now(); pump(); }); }
    const control = await ftms.getCharacteristic(CONTROL);
    await control.startNotifications().catch(() => {});
    DEV.control = control; DEV.trainer = dev; DEV.trainerName = dev.name || "Trainer"; DEV.sent = undefined;
    await ctl([0x00], "request control");
    drawDevices();
    if (ride && ride.state === "riding"){ await ctl([0x07], "start"); syncErg(true); }
  }
  async function connectStrap(auto){
    if (SIM.on){ DEV.strapName = "Simulated strap"; DEV.strap = { sim: true }; drawDevices(); return; }
    if (!navigator.bluetooth) return;
    setDevState("strap", "connecting…");
    try{
      const dev = await pickDevice("strap", { filters: [{ services: ["heart_rate"] }, { namePrefix: "Tyme" }], optionalServices: ["heart_rate", "battery_service", "device_information",
        "6e400001-b5a3-f393-e0a9-e50e24dcca9e", "0000fff0-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb", 0x1814, 0x181c, 0x183e, 0x1810, 0x1816] });
      await attachStrap(dev);
      lsSet(LS.strap, dev.name || "");
      if (!dev.__wayWatch){ dev.__wayWatch = true; dev.addEventListener("gattserverdisconnected", () => { DEV.strap = null; drawDevices(); note("heart-rate strap disconnected"); if (ride && ride.state === "riding") reconnect(dev, attachStrap, "strap"); }); }
    }catch(e){ if (!auto) DEV.chooseNext.strap = true; setDevState("strap", auto ? "not in range yet" : /cancel/i.test(e.message) ? "not connected" : `not connected: ${e.message}`); throw e; }
  }
  async function attachStrap(dev){
    const gatt = await dev.gatt.connect();
    const svcs = await gatt.getPrimaryServices();
    inventory(dev, svcs, "strap");
    for (const s of svcs){
      const chars = await s.getCharacteristics().catch(() => []);
      for (const c of chars){
        if (!(c.properties.notify || c.properties.indicate)) continue;
        await c.startNotifications().catch(() => {});
        if (c.__way) continue; c.__way = true;
        const isHr = c.uuid.startsWith("00002a37"), skip = c.uuid.startsWith("00002a19");
        c.addEventListener("characteristicvaluechanged", e => {
          const v = e.target.value;
          if (isHr){ const f = v.getUint8(0); L.hr = f & 1 ? v.getUint16(1, true) : v.getUint8(1); L.hrAt = now(); return; }
          if (!skip) keepRaw(c.uuid, hex(v));
        });
      }
    }
    DEV.strap = dev; DEV.strapName = dev.name || "Strap";
    drawDevices();
  }
  // The Tymewear may show as two Bluetooth devices: the heart-rate one (the standard service) and a second one
  // for breathing. This slot takes any device at all and keeps everything it sends, raw, for decoding.
  async function connectBreath(auto){
    if (SIM.on){ DEV.breathName = "Simulated breathing"; DEV.breath = { sim: true }; drawDevices(); return; }
    if (!navigator.bluetooth) return;
    setDevState("breath", "connecting…");
    try{
      const dev = await pickDevice("breath", { acceptAllDevices: true, optionalServices: ["heart_rate", "battery_service", "device_information",
        "6e400001-b5a3-f393-e0a9-e50e24dcca9e", "0000fff0-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb", "0000fff1-0000-1000-8000-00805f9b34fb", "0000ffb0-0000-1000-8000-00805f9b34fb", 0x1814, 0x181c, 0x183e, 0x1810, 0x1816, 0x1822] });
      await attachBreath(dev);
      lsSet(LS.breath, dev.name || "");
      if (!dev.__wayWatch){ dev.__wayWatch = true; dev.addEventListener("gattserverdisconnected", () => { DEV.breath = null; drawDevices(); note("breathing sensor disconnected"); if (ride && ride.state === "riding") reconnect(dev, attachBreath, "breath"); }); }
    }catch(e){ if (!auto) DEV.chooseNext.breath = true; setDevState("breath", auto ? "not in range yet" : /cancel/i.test(e.message) ? "not connected" : `not connected: ${e.message}`); throw e; }
  }
  async function inventory(dev, svcs, tag){
    try{
      const inv = [];
      for (const s of svcs){
        const chars = await s.getCharacteristics().catch(() => []);
        const list = [];
        for (const c of chars){
          const props = ["read", "write", "writeWithoutResponse", "notify", "indicate"].filter(k => c.properties[k]);
          let val = null; if (c.properties.read){ try{ val = hex(await c.readValue()); }catch{} }
          list.push({ uuid: c.uuid, props, value: val });
        }
        inv.push({ uuid: s.uuid, chars: list });
      }
      INV[tag] = { name: dev.name || "", services: inv };
    }catch{}
  }
  const INV = {};
  async function attachBreath(dev){
    const gatt = await dev.gatt.connect();
    const svcs = await gatt.getPrimaryServices();
    inventory(dev, svcs, "breath");
    for (const s of svcs){
      const chars = await s.getCharacteristics().catch(() => []);
      for (const c of chars){
        if (!(c.properties.notify || c.properties.indicate)) continue;
        await c.startNotifications().catch(() => {});
        if (c.__way) continue; c.__way = true;
        c.addEventListener("characteristicvaluechanged", e => keepRaw("breath:" + c.uuid, hex(e.target.value)));
      }
    }
    DEV.breath = dev; DEV.breathName = dev.name || "Breathing";
    drawDevices();
  }
  // A value from the strap's own (non-standard) channels, kept as sent while riding: the breathing lives in one of them.
  // Breaths per minute from the strap's raw packets. The layout is not known, so every byte position is tried
  // as a value (one byte, or two bytes little-endian divided by 10 or 100) and a position is accepted only once
  // sixty of its readings in a row sit between 8 and 70 and move (not a constant, not a counter). Until a layout
  // passes, no breathing is drawn or kept: a wrong decoding would be worse than none.
  const BR = { cand: {}, layout: null };
  function breathDecode(uuid, h){
    const b = []; for (let i = 0; i < h.length; i += 2) b.push(parseInt(h.slice(i, i + 2), 16));
    const reads = [];
    for (let k = 0; k < b.length; k++){ reads.push([`${uuid}:u8@${k}`, b[k]]); if (k + 1 < b.length){ const v = b[k] | (b[k + 1] << 8); reads.push([`${uuid}:u16@${k}/10`, v / 10], [`${uuid}:u16@${k}/100`, v / 100]); } }
    if (BR.layout){ const r = reads.find(x => x[0] === BR.layout); if (r && r[1] >= 8 && r[1] <= 70){ (ride.breath = ride.breath || []).push([ride.wt, Math.round(r[1] * 10) / 10]); } return; }
    // single bytes first, then two-byte layouts; a layout passes when sixty readings sit in 8 to 70, take at least four
    // values, do not climb like a counter, and move smoothly (breathing changes a few a minute, not twenty)
    const order = reads.slice().sort((a, b) => (a[0].includes("u16") ? 1 : 0) - (b[0].includes("u16") ? 1 : 0));
    for (const [key, v] of order){
      const c = BR.cand[key] = BR.cand[key] || { vals: [] };
      c.vals.push(v); if (c.vals.length > 60) c.vals.shift();
      if (c.vals.length < 60) continue;
      const ok = c.vals.every(x => x >= 8 && x <= 70), distinct = new Set(c.vals.map(x => Math.round(x))).size;
      let mono = 0, jumps = 0; for (let i = 1; i < c.vals.length; i++){ if (c.vals[i] > c.vals[i - 1]) mono++; if (Math.abs(c.vals[i] - c.vals[i - 1]) > 6) jumps++; }
      if (ok && distinct >= 4 && mono < 50 && jumps <= 3){ BR.layout = key; note(`breathing decoded from the strap (${key.split(":").pop()})`); break; }
    }
  }
  function keepRaw(uuid, h){
    if (!ride || ride.state !== "riding") return;
    if (/breath:|sim-breathing/.test(uuid) || !uuid.startsWith("0000")) breathDecode(uuid, h);
    const raw = ride.raw || (ride.raw = {});
    const all = ride.rawCount || 0;
    if (all >= RAW_CAP_ALL || (raw[uuid] && raw[uuid].length >= RAW_CAP_EACH)) return;
    (raw[uuid] = raw[uuid] || []).push([Math.round(now() - ride.id), h]); ride.rawCount = all + 1;
  }
  // Chrome remembers a device once it has been chosen (getDevices); from then on the start screen connects to
  // it by itself whenever it is in range, trying every few seconds for two minutes, no picker. A device never
  // chosen on this computer still needs its button once.
  let autoTimer = null;
  function autoConnect(){
    clearInterval(autoTimer);
    if (SIM.on || !navigator.bluetooth || !navigator.bluetooth.getDevices) return;
    let tries = 0;
    const go = async () => {
      if (!alive() || !document.getElementById("plStart") || ++tries > 30){ clearInterval(autoTimer); return; }
      if (!DEV.trainer && lsGet(LS.trainer) && !DEV.chooseNext.trainer) connectTrainer(true).catch(() => {});
      if (!DEV.strap && lsGet(LS.strap) && !DEV.chooseNext.strap) connectStrap(true).catch(() => {});
      if (!DEV.breath && lsGet(LS.breath) && !DEV.chooseNext.breath) connectBreath(true).catch(() => {});
      if (DEV.trainer && DEV.strap) clearInterval(autoTimer);
    };
    go(); autoTimer = setInterval(go, 4000);
  }
  function reconnect(dev, attach, kind){
    let tries = 0;
    const go = async () => {
      if (!ride || ride.state === "ended" || (kind === "trainer" ? DEV.trainer : kind === "breath" ? DEV.breath : DEV.strap)) return;
      tries++;
      try{ await attach(dev); note(`${kind === "trainer" ? "trainer" : "strap"} back`); }
      catch(e){ if (tries < 20) setTimeout(go, 3000); }
    };
    setTimeout(go, 1500);
  }

  // ---------- the simulator (dev only) ----------
  const SIM = { on: false, hr: 92, t: 0 };
  function simFeed(ts){
    const iv = cur();
    const tgt = targetNow();
    let p = tgt != null && ergActive(iv) ? tgt + Math.round((Math.random() - 0.5) * 8) : 125 + Math.round(Math.sin(ts / 9000) * 12);
    if (iv && iv.kind === "hr") SIM.hr += ((72 + p * 0.3) - SIM.hr) * 0.04;   // a slower heart, so the seeking has to wait for it
    L.power = Math.max(0, p); L.cadence = 86 + Math.round(Math.random() * 6); L.speed = Math.round(3.6 * Math.cbrt(Math.max(1, p) / 0.24) * 100) / 100; L.bikeAt = ts;
    SIM.hr += ((72 + p * 0.3) - SIM.hr) * 0.06; L.hr = Math.round(SIM.hr); L.hrAt = ts;
    // a made-up breathing packet: a counter byte (never breathing), then breaths a minute that follow the power
    if (++SIM.t % 3 === 0) keepRaw("sim-breathing", (SIM.t & 0xff).toString(16).padStart(2, "0") + Math.max(8, Math.min(70, Math.round(14 + p / 12 + (Math.random() - 0.5) * 3))).toString(16).padStart(2, "0") + "1b");
  }

  // ---------- the ride ----------
  let ride = null, timer = null, nextAt = 0, wake = null, audio = null;
  const totalOf = r => r.intervals.reduce((s, x) => Math.max(s, x.start_s + x.dur_s), 0);
  function idxAt(r, wt){ for (let k = 0; k < r.intervals.length; k++){ const x = r.intervals[k]; if (wt >= x.start_s && wt < x.start_s + x.dur_s) return k; } return r.intervals.length; }
  const cur = () => ride ? ride.intervals[idxAt(ride, ride.wt)] || null : null;
  const ergActive = iv => !!(ride && ride.erg && iv && (iv.target_w != null || iv.kind === "hr"));
  // A heart-rate interval (target_hr, no watts) is ridden in ERG at watts the heart rate chooses: the first one
  // starts from a seed (threshold power for a VO2 band, 60% of FTP for Zone 1) and every 20 s the watts move
  // 8 W toward the band, 12 W in the first minute of the first such interval; the watts found carry into the next
  // heart-rate interval, so the first effort calibrates and the rest ride what it learned. Bounded to half and
  // 1.3 times the seed, so a dropped strap can never run the trainer away.
  const seekSeed = (iv, ftp) => iv.target_hr && iv.target_hr.lo >= 130 ? Math.round(ftp * 1.17) : iv.target_hr && iv.target_hr.hi <= HR_Z1 ? Math.round(ftp * 0.6) : Math.round(ftp * 0.85);
  function seekWatts(iv){
    if (!ride.seek || ride.seek.k !== idxAt(ride, ride.wt)){ const seed = seekSeed(iv, ride.ftp); const w = ride.seekW != null ? ride.seekW : seed; ride.seek = { k: idxAt(ride, ride.wt), seed, w, first: ride.seekW == null, steps: 0 }; }
    return ride.seek.w;
  }
  function seekStep(iv){
    const s = ride.seek; if (!s || !iv || iv.kind !== "hr") return;
    const into = ride.wt - iv.start_s;
    // the first effort searches from 20 s in; a later one rides what was learned and waits 75 s for the heart to catch up from the rest before it moves
    if (into < (s.first ? 20 : 75) || into % 20 !== 0) return;
    const hr = now() - L.hrAt <= 3000 ? L.hr : null; if (hr == null) return;
    const lo = iv.target_hr.lo, hi = iv.target_hr.hi, big = s.first && into <= 60 ? 12 : 8;
    let w = s.w;
    if (hr < lo) w += big; else if (hr > hi) w -= 8;
    w = Math.max(Math.round(s.seed * 0.5), Math.min(Math.round(s.seed * 1.3), w));
    if (w !== s.w){ s.w = w; s.steps++; ride.seekW = w; syncErg(); }
    else if (hr >= lo && hr <= hi) ride.seekW = w;
  }
  function targetNow(){
    const iv = cur(); if (!iv) return null;
    if (iv.kind === "hr") return Math.max(0, Math.round(seekWatts(iv) * (1 + ride.bias / 100)));
    if (iv.target_w == null) return null;
    const f = iv.target_w_end != null ? (ride.wt - iv.start_s) / iv.dur_s : 0;
    const w = iv.target_w + ((iv.target_w_end != null ? iv.target_w_end : iv.target_w) - iv.target_w) * f;
    return Math.max(0, Math.round(w * (1 + ride.bias / 100)));
  }
  function syncErg(force){
    if (!ride || ride.state !== "riding") return;
    const want = ergActive(cur()) ? targetNow() : "free";
    if (!force && want === DEV.sent) return;
    DEV.sent = want;
    if (want === "free") ctl(FLAT, "resistance (flat road)"); else ctl(ergWatts(want), `ERG ${want} W`);
  }
  function beep(freq, dur){
    try{
      if (!audio) return; const t0 = audio.currentTime + 0.01, o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }catch{}
  }
  async function lockScreen(){ try{ if (navigator.wakeLock && document.visibilityState === "visible") wake = await navigator.wakeLock.request("screen"); }catch{} }
  document.addEventListener("visibilitychange", () => { if (ride && (ride.state === "riding" || ride.state === "paused") && document.visibilityState === "visible") lockScreen(); });
  window.addEventListener("beforeunload", e => { if (ride && (ride.state === "riding" || ride.state === "paused")){ flush(); e.preventDefault(); e.returnValue = ""; } });

  let flushing = null, flushAgain = false;
  function flush(){
    if (!ride) return Promise.resolve();
    if (flushing){ flushAgain = true; return flushing; }
    ride.updated = Date.now();
    flushing = DB.put(recordOf(ride)).catch(e => note(`could not write to this computer: ${e.message}`)).then(() => { flushing = null; if (flushAgain){ flushAgain = false; return flush(); } });
    return flushing;
  }
  // what goes into IndexedDB: everything needed to finish and save the ride later
  const recordOf = r => ({ id: r.id, status: r.status, state: r.state, workout: r.workout, intervals: r.intervals, ftp: r.ftp, date: r.date, samples: r.samples, pauses: r.pauses,
    wt: r.wt, bias: r.bias, erg: r.erg, raw: r.raw || {}, rawCount: r.rawCount || 0, breath: r.breath || [], breath_layout: BR.layout || null, sim: !!r.sim, updated: r.updated, error: r.error || null, result: r.result || null, devices: { trainer: DEV.trainerName, strap: DEV.strapName, breath: DEV.breathName } });

  // one recorded second: the moment's numbers, then the workout clock moves on
  function stepSecond(ts){
    const r = ride;
    if (SIM.on) simFeed(ts);
    const k = idxAt(r, r.wt), iv = r.intervals[k] || null, tgt = targetNow();
    const fresh = at => ts - at <= 3000;
    r.samples.push([ts, fresh(L.bikeAt) ? L.power : null, fresh(L.bikeAt) ? L.cadence : null, fresh(L.hrAt) ? L.hr : null, fresh(L.bikeAt) ? L.speed : null, tgt, ergActive(iv) ? 1 : 0, iv ? k : null, r.wt]);
    r.wt += 1;
    if (iv && iv.kind === "hr") seekStep(iv);
    const k2 = idxAt(r, r.wt);
    const left = iv ? iv.start_s + iv.dur_s - r.wt : null;
    if (iv && left === 3 && r.intervals[k + 1]) beep(880, 0.15);
    if (k2 !== k){ beep(k2 < r.intervals.length ? 1320 : 660, 0.25); flush(); if (k2 >= r.intervals.length) note("workout done: ride on, or End to save"); }
    else if (r.samples.length % 5 === 0) flush();
    syncErg();
  }
  // called each tick and on each trainer value: every whole second due gets its sample (a throttled tab catches up)
  function pump(){
    if (!ride || ride.state !== "riding") return;
    const t = now(); let n = 0;
    while (nextAt <= t && n < 600){ stepSecond(nextAt); nextAt += 1000; n++; }
    if (n) paint();
  }
  function startTimer(){ clearInterval(timer); timer = setInterval(pump, Math.max(40, Math.round(250 / CLK.speed))); }

  async function begin(S){
    try{ const AC = window.AudioContext || window.webkitAudioContext; if (AC && !audio) audio = new AC(); if (audio && audio.state === "suspended") audio.resume(); }catch{}
    const t0 = now();
    setZones(S.thresholds);
    ride = { id: Math.round(t0), status: "riding", state: "countin", workout: S.workout, intervals: S.intervals, ftp: S.settings && S.settings.ftp || 175, thresholds: S.thresholds || null, date: keyOf(new Date(t0)),
      samples: [], pauses: [], wt: 0, bias: 0, erg: true, raw: {}, rawCount: 0, sim: SIM.on };
    drawRide();
    // the count-in: 3, 2, 1
    const ov = document.getElementById("plCount");
    for (const n of [3, 2, 1]){ if (ov){ ov.hidden = false; ov.textContent = n; } beep(n === 1 ? 990 : 660, 0.12); await new Promise(r => setTimeout(r, 1000 / Math.min(CLK.speed, 3))); }
    if (ov) ov.hidden = true;
    if (!ride || ride.state !== "countin") return;      // ended during the count-in
    ride.id = Math.round(now()); ride.state = "riding"; nextAt = ride.id;
    lockScreen();
    await ctl([0x00], "request control"); await ctl([0x07], "start");
    DEV.sent = undefined; syncErg(true);
    await flush();
    startTimer(); paint();
  }
  function pause(){
    if (!ride || ride.state !== "riding") return;
    ride.state = "paused"; ride.pauses.push([Math.round(now()), null]);
    ctl([0x08, 0x02], "pause"); flush(); paint();
  }
  function resume(){
    if (!ride || ride.state !== "paused") return;
    const t = Math.round(now()), p = ride.pauses[ride.pauses.length - 1];
    if (p && p[1] == null) p[1] = t; else ride.pauses.push([ride.samples.length ? ride.samples[ride.samples.length - 1][0] + 1000 : t, t]);
    ride.state = "riding"; nextAt = t; lockScreen();
    ctl([0x00], "request control"); ctl([0x07], "resume"); DEV.sent = undefined; syncErg(true);
    startTimer(); flush(); paint();
  }
  function skip(){
    if (!ride || (ride.state !== "riding" && ride.state !== "paused")) return;
    const k = idxAt(ride, ride.wt); const nx = ride.intervals[k + 1];
    ride.wt = nx ? nx.start_s : totalOf(ride);
    beep(1320, 0.2); flush(); syncErg(); paint();
  }
  async function endRide(){
    if (!ride) return;
    clearInterval(timer); timer = null;
    if (ride.state === "riding") pump();
    ride.state = "ended"; ride.status = "ended";
    ctl([0x08, 0x01], "stop");
    try{ if (wake) await wake.release(); }catch{} wake = null;
    await flush();
    await saveRide(ride);
  }

  // ---------- saving: the FIT, then the bridge (and through it intervals.icu) ----------
  let lastFit = null;
  function fitOf(rec){
    const samples = (rec.samples || []).map(a => ({ t: a[0], power: a[1], cadence: a[2], hr: a[3], speed: a[4], i: a[7] }));
    return FIT.buildActivity({ startMs: rec.id, samples, pauses: (rec.pauses || []).filter(p => p && p[1] != null), ftp: rec.ftp });
  }
  function bodyOf(rec, fit){
    const S = { t: [], p: [], c: [], h: [], s: [], tg: [], e: [], i: [] };
    for (const a of rec.samples){ S.t.push(Math.round((a[0] - rec.id) / 1000)); S.p.push(a[1]); S.c.push(a[2]); S.h.push(a[3]); S.s.push(a[4]); S.tg.push(a[5]); S.e.push(a[6]); S.i.push(a[7]); }
    const w = rec.workout || {};
    return { summary: { start_ms: rec.id, name: w.name || "Indoor ride", workout_id: w.id || null, ftp: rec.ftp, intervals_event_id: w.intervals_event_id || null, pauses: rec.pauses,
        intervals: rec.intervals.map(x => ({ label: x.label, start_s: x.start_s, dur_s: x.dur_s, target_w: x.target_w })), sim: !!rec.sim },
      samples: S, fit_base64: FIT.toBase64(fit.bytes), raw: Object.assign({}, rec.raw || {}, { inventory: [[0, JSON.stringify(INV)]] }) };
  }
  async function saveRide(rec){
    ride = rec;
    drawSaving(rec);
    if (!rec.samples || !rec.samples.length){ rec.status = "saved"; rec.result = { ok: true, empty: true }; await DB.put(recordOf(rec)).catch(() => {}); drawResult(rec, null); return; }
    let fit;
    try{ fit = fitOf(rec); lastFit = { id: rec.id, bytes: fit.bytes, summary: fit.summary }; window.__playerFit = { bytes: fit.bytes.length, summary: fit.summary, counts: fit.counts }; }
    catch(e){ rec.status = "failed"; rec.error = "the FIT file could not be built: " + e.message; await DB.put(recordOf(rec)).catch(() => {}); drawResult(rec, null); return; }
    try{
      const r = await bridge("/player/ride", { method: "POST", headers: J, body: JSON.stringify(bodyOf(rec, fit)) });
      rec.result = r; rec.status = r.ok ? "saved" : "failed"; rec.error = r.ok ? null : (r.error || "intervals.icu did not take it");
    }catch(e){ rec.status = "failed"; rec.error = String(e.message || e).replace(/^bridge \d+ — /, ""); rec.result = rec.result && rec.result.stored ? rec.result : null; }
    rec.updated = Date.now();
    await DB.put(recordOf(rec)).catch(() => {});
    drawResult(rec, fit.summary);
  }

  // ---------- drawing ----------
  let S0 = null;            // the session on the start screen
  const page = () => document.getElementById("plPage");
  function note(msg){ const el = document.getElementById("plNote"); if (el){ el.textContent = msg; el.hidden = false; clearTimeout(note.t); note.t = setTimeout(() => { el.hidden = true; }, 8000); } }
  function setDevState(kind, text){ const el = document.querySelector(`[data-dev="${kind}"] .pl-devst`); if (el) el.textContent = text; }
  function devHTML(kind){
    const on = kind === "trainer" ? !!DEV.trainer : kind === "breath" ? !!DEV.breath : !!DEV.strap, name = kind === "trainer" ? DEV.trainerName : kind === "breath" ? DEV.breathName : DEV.strapName, saved = lsGet(LS[kind]);
    const label = kind === "trainer" ? "trainer" : kind === "breath" ? "breathing sensor" : "heart-rate strap";
    return `<button class="pl-dev${on ? " on" : ""}" data-dev="${kind}"${!navigator.bluetooth && !SIM.on ? " disabled" : ""}><span class="pl-devk">${on ? "✓ " : ""}${kind === "trainer" ? "Trainer" : kind === "breath" ? "Breathing" : "Heart rate"}</span><span class="pl-devst">${on ? esc(name) : saved ? `connect ${esc(saved)}` : `connect ${label}`}</span></button>`;
  }
  function drawDevices(){ document.querySelectorAll(".pl-devs").forEach(el => { el.innerHTML = devHTML("trainer") + devHTML("strap") + devHTML("breath"); }); const st = document.getElementById("plStart"); if (st) st.textContent = DEV.trainer ? "Start" : "Start without the trainer"; }
  function bindDevices(root){
    root.addEventListener("click", e => {
      const b = e.target.closest("[data-dev]"); if (!b) return;
      if (b.dataset.dev === "trainer") connectTrainer().catch(() => {}); else if (b.dataset.dev === "breath") connectBreath().catch(() => {}); else connectStrap().catch(() => {});
    });
  }
  const support = () => SIM.on ? `<div class="pl-warn hu-hold">Simulator: made-up power, heart rate and cadence${CLK.speed > 1 ? `, ${CLK.speed}× time` : ""}. Nothing here is a real ride.</div>`
    : !navigator.bluetooth ? `<div class="pl-warn hu-stop">This browser has no Web Bluetooth, so it can't reach the trainer or the strap. Open The Way in Chrome or Edge on the Windows PC next to the KICKR CORE.</div>` : "";

  function startHTML(S, pending){
    const w = S.workout, ftp = S.settings && S.settings.ftp || 175;
    const ivs = S.intervals || [];
    const total = ivs.reduce((s, x) => Math.max(s, x.start_s + x.dur_s), 0);
    const watts = ivs.filter(x => x.target_w != null);
    const hi = watts.length ? Math.max(...watts.map(x => Math.max(x.target_w, x.target_w_end || 0))) : null;
    const when = [w.date ? dateKeyLabel(w.date) : "", w.time ? hm12(w.time) : ""].filter(Boolean).join(" · ");
    const fuel = (S.fuel || []).length ? `<div class="pl-sec"><span class="hu-lab">Fuel for this ride</span><ul class="pl-fuel">${S.fuel.map(m => `<li><span class="pl-ft">${m.slot === "before" ? "Before" : "On the bike"}${m.time ? " · " + esc(hm12(m.time)) : ""}</span><span>${esc(m.what)}${m.carbs_g ? ` <b>${m.carbs_g} g carbs</b>` : ""}</span></li>`).join("")}</ul></div>` : "";
    const others = (S.choices || []).filter(c => c.id !== w.id);
    const rows = ivs.map(x => `<li><span class="pl-it">${clock(x.start_s)}</span><span class="pl-il">${esc(x.label)}${x.rep ? ` <span class="small">${esc(x.rep)}</span>` : ""}</span><span class="pl-iw">${esc(targetWords(x, 0))}</span><span class="pl-id">${clock(x.dur_s)}</span></li>`).join("");
    return `${pending}${support()}
      <div class="pl-ttl"><h2 class="pl-h">${esc(w.name)}</h2>${when ? `<span class="hu-chip hu-dim">${esc(when)}</span>` : ""}</div>
      <div class="pl-sec pl-fsec"><span class="hu-lab">The power to follow · watts at FTP ${ftp}</span><div class="pf-box pf-whole" id="plWhole"></div>${goalOf(w, ivs) ? `<div class="pl-goal pl-goal-start">${goalHTML(goalOf(w, ivs), [], 88)}</div>` : ""}</div>
      <div class="hu-fields pl-sum">
        <div class="hu-field"><span class="k">Duration</span><span class="n">${clock(total)}</span><span class="u">${ivs.length} interval${ivs.length === 1 ? "" : "s"}</span></div>
        <div class="hu-field"><span class="k">Targets at FTP ${ftp}</span><span class="n">${hi != null ? hi : "—"}<small> W</small></span><span class="u">${w.np_w ? `NP ${w.np_w} W` : ""}</span></div>
        <div class="hu-field"><span class="k">Load</span><span class="n">${w.tss != null ? w.tss : "—"}</span><span class="u">TSS</span></div>
      </div>
      ${fuel}
      <div class="pl-sec">
        <div class="pl-devs">${devHTML("trainer")}${devHTML("strap")}${devHTML("breath")}</div>
        <button class="primary pl-go" id="plStart"${!navigator.bluetooth && !SIM.on ? " disabled" : ""}>${DEV.trainer ? "Start" : "Start without the trainer"}</button>
        <div class="small pl-hint">End always saves the ride.</div>
      </div>
      <details class="why"><summary>the steps · ${ivs.length}</summary><ul class="pl-steps">${rows}</ul></details>
      ${others.length ? `<div class="small pl-also">Also today: ${others.map(c => `<a href="#player?id=${encodeURIComponent(c.id)}${SIM.on ? "&sim=1" : ""}">${esc(c.name)}${c.time ? " · " + esc(hm12(c.time)) : ""}</a>`).join(" · ")}</div>` : ""}
      <div class="pl-note small" id="plNote" hidden></div>`;
  }

  function drawRide(){
    const el = page(); if (!el || !ride) return;
    const ftp = ride.ftp;
    try{ window.scrollTo(0, 0); }catch{}
    el.innerHTML = `<div class="pl-ride">
      <div class="pl-top"><div class="pl-now"><span class="hu-lab" id="plPos"></span><span class="pl-lbl" id="plLbl"></span></div><div class="pl-devs pl-devs-sm">${devHTML("trainer")}${devHTML("strap")}${devHTML("breath")}</div></div>
      <div class="pl-viz"><div class="pf-box pf-ride-box" id="plFollow"></div><div class="pl-goal" id="plGoal"></div></div>
      <div class="hu-fields pl-fields">
        <div class="hu-field big pl-pw"><span class="k">Power</span><span class="n" id="fP">—</span><span class="u" id="fPt"></span></div>
        <div class="hu-field big pl-hr"><span class="k">Heart rate</span><div class="pl-hrrow"><span class="n" id="fH">—</span>${zonesHTML()}</div><span class="u" id="fHz"></span></div>
        <div class="hu-field big pl-il"><span class="k">Interval left</span><span class="n" id="fI">—</span><span class="u" id="fIl"></span></div>
        <div class="hu-field pl-cad"><span class="k">Cadence</span><span class="n" id="fC">—</span><span class="u">rpm</span></div>
        <div class="hu-field pl-tl"><span class="k">Total left</span><span class="n" id="fT">—</span><span class="u" id="fTr"></span></div>
        <div class="hu-field pl-mode"><span class="k">Trainer</span><span class="n" id="fE">ERG</span><span class="u" id="fB"></span></div>
      </div>
      <div class="pl-strip" id="plStrip">${profileSVG(ride.intervals, ftp, { h: 90, cursor: ride.wt, cls: "pl-small" })}</div>
      <div class="pl-next" id="plNext"></div>
      <div class="pl-ctl">
        <button id="cPause">Pause</button><button id="cSkip">Skip interval</button>
        <button id="cBm" aria-label="Bias minus 5 percent">−5%</button><button id="cBp" aria-label="Bias plus 5 percent">+5%</button>
        <button id="cErg">ERG off</button><button id="cEnd" class="pl-end">End</button>
      </div>
      <div class="pl-confirm" id="plConfirm" hidden><div><b>End the ride and save it?</b><div class="small">It goes to The Way and to intervals.icu. Nothing is thrown away.</div></div><button class="primary" id="cSave">Save the ride</button><button id="cBack">Keep riding</button></div>
      <div class="pl-note small" id="plNote" hidden></div>
      <div class="pl-count" id="plCount" hidden></div>
    </div>`;
    // the device buttons are bound once, on the page (V.player)
    const $ = id => document.getElementById(id);
    $("cPause").onclick = () => ride.state === "paused" ? resume() : pause();
    $("cSkip").onclick = skip;
    $("cBm").onclick = () => { ride.bias = Math.max(-30, ride.bias - 5); syncErg(); paint(); };
    $("cBp").onclick = () => { ride.bias = Math.min(30, ride.bias + 5); syncErg(); paint(); };
    $("cErg").onclick = () => { ride.erg = !ride.erg; syncErg(); paint(); };
    $("cEnd").onclick = () => { $("plConfirm").hidden = false; try{ $("plConfirm").scrollIntoView({ block: "nearest", behavior: "smooth" }); }catch{} };
    $("cBack").onclick = () => { $("plConfirm").hidden = true; };
    $("cSave").onclick = () => { $("cSave").disabled = true; endRide(); };
    paint();
  }
  let stripAt = -1;
  function paint(){
    if (!ride || !alive()) return;
    const $ = id => document.getElementById(id);
    if (!$("fP")) return;
    const r = ride, k = idxAt(r, r.wt), iv = r.intervals[k] || null, nx = r.intervals[k + 1] || null, total = totalOf(r);
    const fresh = at => now() - at <= 3000;
    const tgt = targetNow();
    $("plPos").textContent = r.state === "paused" ? "Paused" : r.state === "countin" ? "Get ready" : iv ? `Interval ${k + 1} of ${r.intervals.length}` : "Workout done";
    $("plLbl").textContent = iv ? iv.label + (iv.rep ? " · " + iv.rep : "") : "Ride on, or End to save";
    $("fP").textContent = fresh(L.bikeAt) && L.power != null ? L.power : "—";
    $("fPt").textContent = !iv ? "" : iv.target_w != null ? `${tgt} W${ergActive(iv) ? "" : " · ERG off"}` : iv.kind === "hr" ? `${tgt} W · for HR ${iv.target_hr.lo}–${iv.target_hr.hi}${ride.seek && ride.seek.first ? " · finding it" : ""}` : "";
    const hr = fresh(L.hrAt) ? L.hr : null;
    $("fH").textContent = hr != null ? hr : "—";
    $("fH").className = "n " + (hr == null ? "hu-dim" : hr <= HR_Z1 ? "hu-go" : hr <= HR_Z2 ? "hu-hold" : "hu-stop");
    { const want = wantZone(iv, r.ftp), zin = hrZoneOf(hr);
      $("fHz").textContent = (zin ? `Z${zin.z} ${zin.name}` : "") + (want ? `${zin ? " · " : ""}training Z${want.z} ${want.name}` : "");
      paintZones(hr, iv, r.ftp); }
    $("fC").textContent = fresh(L.bikeAt) && L.cadence != null ? L.cadence : "—";
    $("fI").textContent = iv ? clock(iv.start_s + iv.dur_s - r.wt) : "—";
    $("fIl").textContent = iv ? `of ${clock(iv.dur_s)}` : "";
    $("fT").textContent = clock(Math.max(0, total - r.wt));
    $("fTr").textContent = `${clock(r.samples.length)} ridden`;
    $("fE").textContent = !iv || (iv.target_w == null && iv.kind !== "hr") ? "Free" : r.erg ? "ERG" : "Off";
    $("fB").textContent = r.bias ? `bias ${r.bias > 0 ? "+" : "−"}${Math.abs(r.bias)}%` : "";
    $("cPause").textContent = r.state === "paused" ? "Resume" : "Pause";
    $("cPause").classList.toggle("primary", r.state === "paused");
    $("cErg").textContent = r.erg ? "ERG off" : "ERG on";
    $("cSkip").disabled = !nx && !iv;
    const left = iv ? iv.start_s + iv.dur_s - r.wt : 0;
    $("plNext").innerHTML = !iv ? "" : nx ? `Next: <b>${esc(nx.label)}${nx.rep ? " " + esc(nx.rep) : ""}</b> · ${esc(targetWords(nx, r.bias))} in <b>${clock(left)}</b>` : `Last interval · ends in <b>${clock(left)}</b>`;
    $("plNext").classList.toggle("soon", left <= 5 && !!nx);
    drawFollow();
    const gb = $("plGoal"), goal = goalOf(r.workout, r.intervals);
    if (gb){ gb.hidden = !goal; if (goal) gb.innerHTML = goalHTML(goal, r.samples, innerWidth >= 900 ? 190 : 104); }
    if (r.wt !== stripAt){ stripAt = r.wt; $("plStrip").innerHTML = profileSVG(r.intervals, r.ftp, { h: 90, cursor: r.wt, cls: "pl-small" }); }
  }
  function drawSaving(rec){
    const el = page(); if (!el) return;
    el.innerHTML = `<div class="pl-ttl"><h2 class="pl-h">Saving the ride</h2></div><div class="small">Building the file and sending it to The Way and intervals.icu…</div>`;
  }
  function drawResult(rec, sum){
    const el = page(); if (!el) return;
    const r = rec.result || {}, ok = rec.status === "saved";
    const s = sum || (r.summary) || {};
    const icu = r.intervals_id ? `<a href="https://intervals.icu/activities/${encodeURIComponent(r.intervals_id)}" target="_blank" rel="noopener">Open it on intervals.icu</a>` : "";
    const head = r.empty ? "Nothing was recorded" : ok ? "Ride saved" : r.stored ? "Saved in The Way" : "Not saved yet";
    const line = r.empty ? "The ride ended before its first second." : ok ? (r.held_back ? "In The Way, on Day and Calendar now. This is the copy, so the intervals.icu upload was held back." : `In The Way, on Day and Calendar now, and uploaded to intervals.icu. ${icu}`)
      : r.stored ? `It counts on Day and Calendar now. intervals.icu didn't take it: ${esc(rec.error || "")}`
      : `It's kept on this computer. The upload failed: ${esc(rec.error || "")}`;
    const fields = s.seconds ? `<div class="hu-fields pl-sum">
        <div class="hu-field"><span class="k">Ridden</span><span class="n">${clock(s.seconds)}</span><span class="u">${esc(day12(rec.id))} · ${esc(time12(rec.id))}</span></div>
        <div class="hu-field"><span class="k">Power</span><span class="n">${s.avg_w != null ? s.avg_w : "—"}<small> W</small></span><span class="u">${s.np_w ? `NP ${s.np_w} W · ` : ""}${s.tss != null ? `${s.tss} TSS` : ""}</span></div>
        <div class="hu-field"><span class="k">Heart rate</span><span class="n">${s.avg_hr != null ? s.avg_hr : "—"}</span><span class="u">${s.max_hr ? `max ${s.max_hr}` : "no strap"}</span></div>
      </div>` : "";
    el.innerHTML = `<div class="pl-ttl"><h2 class="pl-h">${head}</h2><span class="hu-chip ${ok ? "hu-go" : r.stored ? "hu-hold" : "hu-stop"}">${ok ? "saved" : r.stored ? "upload pending" : "kept here"}</span></div>
      <div class="pl-result ${ok ? "ok" : "bad"}">${line}</div>
      ${fields}
      ${!r.empty && goalOf(rec.workout, rec.intervals) ? `<div class="pl-goal pl-goal-start">${goalHTML(goalOf(rec.workout, rec.intervals), rec.samples, 120)}</div>` : ""}
      <div class="pl-ctl">${ok ? "" : `<button class="primary" id="cRetry">Retry</button>`}${lastFit && lastFit.id === rec.id ? `<button id="cFit">Download the FIT file</button>` : ""}<a class="btn" href="#today">‹ Day</a><a class="btn" href="#calendar">Calendar</a></div>
      <div class="pl-note small" id="plNote" hidden></div>`;
    const rt = document.getElementById("cRetry"); if (rt) rt.onclick = () => { rt.disabled = true; saveRide(rec); };
    const fb = document.getElementById("cFit"); if (fb) fb.onclick = () => { const u = URL.createObjectURL(new Blob([lastFit.bytes], { type: "application/octet-stream" })); const a = document.createElement("a"); a.href = u; a.download = `the-way-${keyOf(new Date(rec.id))}-${pad2(new Date(rec.id).getHours())}${pad2(new Date(rec.id).getMinutes())}.fit`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); };
  }

  // A ride left behind: a crash or a closed tab mid-ride, or one whose upload did not go through.
  async function pendingHTML(S){
    let all = [];
    try{ all = await DB.all(); }catch{ return ""; }
    // saved rides are kept a week, then let go
    for (const x of all) if (x.status === "saved" && Date.now() - (x.updated || x.id) > 7 * 864e5) DB.del(x.id).catch(() => {});
    const open = all.filter(x => x.status !== "saved" && (!ride || x.id !== ride.id)).sort((a, b) => b.id - a.id);
    if (!open.length) return "";
    return open.slice(0, 3).map(x => {
      const mins = Math.round((x.samples || []).length / 60);
      const same = S && S.workout && x.workout && x.workout.id && x.workout.id === S.workout.id && x.date === keyOf(new Date()) && x.status === "riding";
      const what = x.status === "riding" ? `An unfinished ride: ${esc((x.workout && x.workout.name) || "Indoor ride")}, ${mins} min recorded.` : `${esc((x.workout && x.workout.name) || "A ride")} (${mins} min) is not uploaded yet${x.error ? `: ${esc(x.error)}` : ""}.`;
      return `<div class="pl-pend" data-pend="${x.id}"><div>${what}</div><div class="pl-ctl">
        <button class="primary" data-finish="${x.id}">${x.status === "riding" ? `Finish and save the ride from ${esc(time12(x.id))}` : "Retry upload"}</button>${same ? `<button data-keep="${x.id}">Keep riding</button>` : ""}
        <span class="small">${esc(day12(x.id))}</span></div></div>`;
    }).join("");
  }
  async function bindPending(el){
    el.addEventListener("click", async e => {
      const f = e.target.closest("[data-finish]"), k = e.target.closest("[data-keep]");
      if (!f && !k) return;
      const id = +(f || k).dataset[f ? "finish" : "keep"];
      const rec = (await DB.all()).find(x => x.id === id); if (!rec) return;
      if (f){ rec.state = "ended"; if (rec.status === "riding") rec.status = "ended"; lastFit = null; saveRide(Object.assign(rec, { state: "ended" })); return; }
      // keep riding: the same ride, paused where it stopped; connect, then Resume
      ride = Object.assign(rec, { state: "paused", status: "riding" });
      const lastT = rec.samples.length ? rec.samples[rec.samples.length - 1][0] + 1000 : rec.id;
      if (!ride.pauses.length || ride.pauses[ride.pauses.length - 1][1] != null) ride.pauses.push([lastT, null]);
      drawRide();
    });
  }

  V.player = async function(){
    const q = params();
    SIM.on = q.get("sim") === "1";
    if (SIM.on && q.get("speed")) setSpeed(q.get("speed"));
    view.innerHTML = `<div id="plPage" class="pl-page"><div class="pl-ttl"><h2 class="pl-h">Workout player</h2></div><div class="small">loading the workout…</div></div>`;
    const el = page();
    bindPending(el); bindDevices(el);
    // a ride under way (the page was left and come back to) carries on where it is
    if (ride && (ride.state === "riding" || ride.state === "paused" || ride.state === "countin")){ drawRide(); return; }
    if (ride && ride.state === "ended") ride = null;    // a ride already ended shows in the list below until it is saved
    if (SIM.on){ DEV.trainer = DEV.trainer || { sim: true }; DEV.trainerName = "Simulated trainer"; DEV.strap = DEV.strap || { sim: true }; DEV.strapName = "Simulated strap"; }
    const id = q.get("id");
    let S = null, err = null;
    try{ S = await loadSession(id || "today"); }catch(e){ err = e; }
    if (!alive()) return;
    if (S && !S.workout && !id){ S = Object.assign(FREE_RIDE(S.settings && S.settings.ftp || 175), { none: true, choices: S.choices }); }
    if (!S){ const pend = await pendingHTML(null); el.innerHTML = `${pend}<div class="pl-ttl"><h2 class="pl-h">Workout player</h2></div><div class="small">Couldn't load the workout: ${esc(String(err && err.message || "").replace(/^bridge \d+ — /, "").slice(0, 200))}. <a href="#calendar">Pick one on the Calendar</a>.</div>`; return; }
    S0 = S;
    const pend = await pendingHTML(S);
    if (!alive()) return;
    el.innerHTML = (S.none ? `<div class="small pl-none">Nothing to ride is planned for today, so this is a free ride (no targets, the trainer on a flat road). <a href="#calendar">Plan one on the Calendar</a>.</div>` : "") + startHTML(S, pend);
    const go = document.getElementById("plStart");
    drawWhole(S);
    if (go) go.onclick = () => { go.disabled = true; clearInterval(autoTimer); begin(S0); };
    autoConnect();
  };

  window.__player = { get ride(){ return ride; }, get fit(){ return lastFit; }, DB };
  if (location.hash.replace(/^#/, "").split("?")[0] === "player") nav();
})();
