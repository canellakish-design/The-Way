"use strict";
/* THE WAY — Flags (#flags): the game. Iconic spots on his routes are flags;
   riding past one catches it. Rarity by how often he has been there, XP by
   rarity, levels, a daily hunt sized to the day's planned work. The bridge
   (bridge/flags.js) places and scores them; this page shows the collection,
   the hunt, the catches, and hands the routes to the Garmin as courses.
   Loads after app.js and uses its globals: V, view, bridge, esc. */
(function(){

const J = {"Content-Type":"application/json"};
const RARITY = { common:["Common","rc"], uncommon:["Uncommon","ru"], rare:["Rare","rr"], legendary:["Legendary","rl"] };
const KIND = { summit:"▲", view:"◉", dam:"≋", water:"≈", bridge:"⌒", park:"✿", town:"⌂", landmark:"★", historic:"†", cafe:"☕", church:"✝", turn:"↻" };
const rbadge = r => { const [w,c] = RARITY[r] || RARITY.common; return `<span class="rb ${c}">${w}</span>`; };
const icon = k => KIND[k] || "⚑";
function hm(min){ min=Math.round(min||0); return Math.floor(min/60)+":"+String(min%60).padStart(2,"0"); }
function unseen(){ try{ return JSON.parse(localStorage.getItem("flags-unseen")||"[]"); }catch{ return []; } }
function setUnseen(list){ try{ localStorage.setItem("flags-unseen", JSON.stringify(list.slice(-20))); }catch{} }

function levelHTML(l){
  return `<div class="lvl"><div class="lvlrow"><span class="lvlnum">Level ${l.level}</span><span class="small">${l.xp} XP · ${l.next - l.xp} to level ${l.level + 1}</span></div>
    <div class="lvlbar"><div class="lvlfill" style="width:${Math.max(2, l.pct)}%"></div></div></div>`;
}

function huntHTML(t){
  if (!t) return "";
  if (!t.hunt) return `<div class="card"><h4>Today's hunt</h4><div class="small">${t.tss ? `${t.tss} TSS planned, but no ${t.virtual ? "Zwift" : "road"} flags fit it yet.` : "Rest day. No hunt; the flags will keep."}</div></div>`;
  const h = t.hunt;
  return `<div class="card"><h4>Today's hunt · ${t.caught}/${h.size}</h4>
    <div class="small">${h.tss} TSS planned${t.virtual ? " on Zwift" : ""} fits <b>${esc(h.route)}</b>: ${h.size} flag${h.size===1?"":"s"} within reach.${t.bonus ? ` Hunt complete, +${t.bonus} XP.` : ""}</div>
    <ul class="agenda totals flaglist">${h.flags.map(f => `<li class="${f.caught_today?"got":""}"><span class="n"><span class="fk">${icon(f.kind)}</span> ${esc(f.name)} ${rbadge(f.rarity)}</span><span class="tag">${f.caught_today ? "caught ✓" : `${f.work_tss} TSS · ${hm(f.work_min)} · km ${f.km}`}</span></li>`).join("")}</ul></div>`;
}

function revealHTML(list){
  if (!list.length) return "";
  return `<div class="card catchcard" id="catchCard"><h4>Caught!</h4>
    ${list.map(c => `<div class="catchrow"><span class="fk big">${icon(c.kind||"")}</span><div><div class="jname">${esc(c.name)}</div><div class="small">${rbadge(c.rarity)} ${c.first ? "· first ever ×3 " : ""}· +${c.xp} XP · ${esc(c.date)}</div></div></div>`).join("")}
    <button id="catchOk">Nice</button></div>`;
}

function mapSVG(route, flags){
  const pts = route.points || [];
  if (pts.length < 2) return "";
  const lats = pts.map(p=>p.lat), lngs = pts.map(p=>p.lng);
  const la0 = Math.min(...lats), la1 = Math.max(...lats), lo0 = Math.min(...lngs), lo1 = Math.max(...lngs);
  const cos = Math.cos((la0+la1)/2*Math.PI/180);
  const W = 320, H = 180, pad = 12;
  const sx = (W-2*pad) / Math.max(1e-6, (lo1-lo0)*cos), sy = (H-2*pad) / Math.max(1e-6, la1-la0), s = Math.min(sx, sy);
  const X = lng => pad + (lng-lo0)*cos*s + ((W-2*pad) - (lo1-lo0)*cos*s)/2, Y = lat => H - pad - (lat-la0)*s - ((H-2*pad) - (la1-la0)*s)/2;
  const d = pts.map((p,i)=>(i?"L":"M")+X(p.lng).toFixed(1)+" "+Y(p.lat).toFixed(1)).join("");
  const col = { common:"#8FA68E", uncommon:"#5BA4D9", rare:"#C58BE0", legendary:"#F2B33D" };
  const fl = flags.map(f => `<g><circle cx="${X(f.lng).toFixed(1)}" cy="${Y(f.lat).toFixed(1)}" r="${f.caught?6:5}" fill="${f.caught ? col[f.rarity] : "none"}" stroke="${col[f.rarity]}" stroke-width="2"></circle></g>`).join("");
  return `<svg class="flagmap" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><path d="${d}" fill="none" stroke="#6E7368" stroke-width="2" stroke-linejoin="round"></path>
    <circle cx="${X(pts[0].lng).toFixed(1)}" cy="${Y(pts[0].lat).toFixed(1)}" r="3.5" fill="#F3F1E7"></circle>${fl}</svg>`;
}

function routeCard(r, flags, data){
  const fs = flags.filter(f => f.route_id === r.id);
  const got = fs.filter(f => f.caught).length;
  const src = r.source === "rwgps" ? "RideWithGPS" : r.virtual ? "Zwift" : `Strava · ${r.rides||0} rides`;
  return `<div class="card routecard" data-route="${esc(r.id)}">
    <div class="rhead"><div><h4>${esc(r.name)}</h4><div class="small">${src}${r.km ? ` · ${r.km} km` : ""}${r.gain_m ? ` · ${r.gain_m} m` : ""} · ${got}/${fs.length} caught</div></div>
      ${r.virtual ? "" : `<a class="btn" href="${DEFAULT_API}/flags/course/${encodeURIComponent(r.id)}.tcx" download>Garmin course</a>`}</div>
    <div class="mapbox" data-map="${esc(r.id)}"></div>
    <ul class="agenda totals flaglist">${fs.map(f => `<li class="${f.hidden?"hid":""} ${f.caught?"got":""}" data-flag="${esc(f.id)}">
      <span class="n"><span class="fk">${icon(f.kind)}</span> <span class="fname">${esc(f.name)}</span> ${rbadge(f.rarity)}${f.hidden?' <span class="small">(hidden)</span>':""}</span>
      <span class="tag">${f.caught ? `×${f.caught}` : "never"} · ${f.work_tss} TSS · km ${f.km}${f.ele_m!=null?` · ${f.ele_m} m`:""}</span></li>`).join("")}</ul>
    <div class="small">Tap a flag to rename or hide it.</div></div>`;
}

V.flags = async function(){
  view.innerHTML = `<div class="card"><h4>Flags</h4><div class="small">reaching the bridge…</div></div>`;
  let d = null;
  try{ d = await bridge("/flags"); }
  catch(e){ view.innerHTML = `<div class="card"><h4>Flags</h4><div class="small">bridge unreachable: ${esc(e.message)}</div></div>`; return; }
  const fresh = unseen().concat(d.new_catches || []);
  if (d.new_catches && d.new_catches.length) setUnseen(fresh);
  const rw = d.sources.rwgps;
  const built = !!d.built_at && d.flags.length;
  view.innerHTML = `
    <div class="card"><div class="phead"><h4>Flags · the game</h4><span class="small">${built ? `${d.flags.filter(f=>f.caught).length} of ${d.flags.length} caught` : "not built yet"}</span></div>
      ${levelHTML(d.level)}
      <div class="small">Every iconic spot on your routes is a flag: summits, dams, bridges, viewpoints, towns, the far turn. Ride past one and it is caught. Common flags are the ones you pass most weeks, legendary ones you have never reached. XP by rarity, tripled for a first catch, +50 for the day's hunt.</div></div>
    ${revealHTML(fresh)}
    ${huntHTML(d.today)}
    <div class="card" id="buildCard"><h4>Routes</h4>
      <div class="small">${rw.connected ? `RideWithGPS connected${rw.user && rw.user.name ? ` as ${esc(rw.user.name)}` : ""}: ${rw.routes} route${rw.routes===1?"":"s"} in the library.` : rw.configured ? "RideWithGPS not connected: sign in once below and the routes you push to the Edge become the flag routes." : "Routes come from Strava's ride history (rides with the same name are one route) until RideWithGPS is connected, which needs RWGPS_API_KEY in Netlify."}
        ${d.tracks ? ` ${d.tracks} Strava tracks read.` : ""}${d.speed_kmh ? ` Your pace on the road reads ${d.speed_kmh} km/h; work to a flag is priced from it.` : ""}</div>
      <div class="rowbtns"><button class="primary" id="buildBtn">${built ? "Refresh the flags" : "Build the flags"}</button> <button id="scanBtn" ${built?"":"disabled"}>Check recent rides</button></div>
      <div class="small" id="buildMsg"></div>
      ${rw.configured && !rw.connected ? `<div class="row2" id="rwForm"><span><label>RideWithGPS email</label><input id="rwEmail" type="email" autocomplete="username"></span><span><label>Password</label><input id="rwPass" type="password" autocomplete="current-password"></span></div>
        <div class="small">Sent once to ridewithgps.com for a token; the password is not kept.</div><button id="rwConnect">Connect RideWithGPS</button><div class="small" id="rwMsg"></div>` : ""}
      ${rw.connected ? `<button class="linkish" id="rwOff">disconnect RideWithGPS</button>` : ""}
      <div class="small"><b>On the Edge 1050:</b> each route's "Garmin course" button downloads a course with the flags as course points. Import it in Garmin Connect (Training &amp; Planning → Courses → Import), send it to the Edge, and ride it as a course: the Edge calls each flag out as you reach it. Catches themselves are read from the ride on Strava a few minutes after it uploads, on the road and on Zwift.</div></div>
    ${built ? d.routes.map(r => routeCard(r, d.flags, d)).join("") : ""}
    ${d.catches && d.catches.length ? `<div class="card"><h4>Recent catches</h4><ul class="agenda totals flaglist">${d.catches.map(c => `<li><span class="n"><span class="fk">⚑</span> ${esc(c.name)} ${rbadge(c.rarity)}${c.first?' <span class="small">first</span>':""}</span><span class="tag">+${c.xp} · ${esc(c.date)}</span></li>`).join("")}</ul></div>` : ""}`;

  // the maps, one fetch per route
  for (const box of view.querySelectorAll("[data-map]")){
    bridge("/flags/route/" + encodeURIComponent(box.dataset.map)).then(r => { box.innerHTML = mapSVG(r, d.flags.filter(f => f.route_id === r.id && !f.hidden)); }).catch(()=>{});
  }
  const ok = document.getElementById("catchOk"); if (ok) ok.onclick = ()=>{ setUnseen([]); document.getElementById("catchCard").remove(); };
  const msg = document.getElementById("buildMsg");
  document.getElementById("buildBtn").onclick = async ()=>{
    const b = document.getElementById("buildBtn"); b.disabled = true;
    try{
      for (let i = 0; i < 40; i++){
        const r = await bridge(built && i === 0 ? "/flags/rebuild" : "/flags/build", { method:"POST", headers:J, body:"{}" });
        if (r.done){ msg.textContent = `Done: ${r.flags} flags on ${r.routes} routes from ${r.tracks} rides.`; setTimeout(V.flags, 800); return; }
        msg.textContent = `Reading… ${r.tracks} rides in${r.tracks_pending ? `, ${r.tracks_pending} to go` : ""}; ${r.routes} routes${r.routes_pending ? `, ${r.routes_pending} to fetch` : ""}${r.names_pending ? `; naming ${r.names_pending}` : ""}.${r.log && r.log.length ? " " + r.log[r.log.length-1] : ""}`;
        if (r.log && r.log.some(l => /429/.test(l))){ msg.textContent += " Strava's rate limit: wait 15 minutes and tap again; it carries on from here."; break; }
      }
    } catch(e){ msg.textContent = e.message; }
    b.disabled = false;
  };
  const sc = document.getElementById("scanBtn"); if (sc) sc.onclick = async ()=>{
    sc.disabled = true; try{ const r = await bridge("/flags/scan", { method:"POST", headers:J, body:"{}" }); msg.textContent = r.new_catches.length ? `${r.new_catches.length} new catch${r.new_catches.length===1?"":"es"}.` : "Nothing new."; if (r.new_catches.length){ setUnseen(unseen().concat(r.new_catches)); V.flags(); } } catch(e){ msg.textContent = e.message; } sc.disabled = false; };
  const rc = document.getElementById("rwConnect"); if (rc) rc.onclick = async ()=>{
    const m = document.getElementById("rwMsg"); rc.disabled = true; m.textContent = "signing in…";
    try{ await bridge("/rwgps/connect", { method:"POST", headers:J, body: JSON.stringify({ email: document.getElementById("rwEmail").value.trim(), password: document.getElementById("rwPass").value }) }); m.textContent = "Connected. Building…"; V.flags(); }
    catch(e){ m.textContent = e.message; rc.disabled = false; } };
  const ro = document.getElementById("rwOff"); if (ro) ro.onclick = async ()=>{ await bridge("/rwgps/disconnect", { method:"POST", headers:J, body:"{}" }); V.flags(); };
  view.querySelectorAll("li[data-flag]").forEach(li => li.onclick = async ()=>{
    const f = d.flags.find(x => x.id === li.dataset.flag); if (!f) return;
    const name = prompt("Flag name (empty to hide it, or type 'show' to unhide):", f.name);
    if (name == null) return;
    try{
      if (name.trim() === "") await bridge("/flags/hide", { method:"POST", headers:J, body: JSON.stringify({ id: f.id, hidden: true }) });
      else if (name.trim().toLowerCase() === "show") await bridge("/flags/hide", { method:"POST", headers:J, body: JSON.stringify({ id: f.id, hidden: false }) });
      else await bridge("/flags/rename", { method:"POST", headers:J, body: JSON.stringify({ id: f.id, name: name.trim() }) });
      V.flags();
    } catch(e){ alert(e.message); }
  });
};

window.flagBits = { rbadge, icon, hm, unseen, setUnseen };
})();
