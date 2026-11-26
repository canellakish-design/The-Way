"use strict";
/* THE WAY — the page around the workout player. Since 26 Nov 2026 the site is only the player (Harry plans, logs and
   is coached inside Claude), so this replaces app.js: it gives player.js the few things it uses (V, view, nav,
   bridge, esc, hm12, speak) and nothing else. Speech is the device's own voice (speechSynthesis), which is free. */
const DEFAULT_API = (location.port === "8420") ? "" : "/.netlify/functions/api";
const V = {};
const view = document.getElementById("view");
view.dataset.booted = "1";

async function bridge(pathname, opts){
  const o = Object.assign({}, opts);
  o.headers = Object.assign({ "x-the-way-app": "1" }, (opts && opts.headers) || {});
  const r = await fetch(DEFAULT_API + pathname, o);
  if (!r.ok){
    let detail = "", body = null;
    try{ const j = await r.clone().json(); body = j; detail = j.error ? " — " + j.error : ""; }
    catch{ try{ detail = " — " + (await r.text()).slice(0, 200); }catch{} }
    const err = new Error("bridge " + r.status + detail); err.status = r.status; err.body = body; throw err;
  }
  return r.json();
}
function esc(t){ const d = document.createElement("div"); d.textContent = t == null ? "" : String(t); return d.innerHTML; }
function hm12(t){ const m = /^(\d{2}):(\d{2})$/.exec(t || ""); if (!m) return t || ""; let h = (+m[1]) % 24; const ap = h < 12 ? "a" : "p"; h = h % 12; if (h === 0) h = 12; return h + ":" + m[2] + ap; }

// the player's coach lines, spoken by the device: one at a time, a new one replaces the last
function speak(t){
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(t || "")); u.rate = 1.03;
    speechSynthesis.speak(u);
  }catch(e){ /* no voice on this device: the line is still written on the page */ }
}

// One page: the player. Any other hash (an old bookmark to #today, #calendar, #food) lands on it.
function nav(){
  const h = location.hash.replace("#", "").split("?")[0];
  if (h !== "player"){ location.replace("#player" + (location.hash.includes("?") ? "?" + location.hash.split("?")[1] : "")); return; }
  const n = document.querySelector("nav");
  if (n) n.innerHTML = `<a class="navback" href="player-test.html">Trainer test</a>`;
  if (V.player) V.player();
}
window.addEventListener("hashchange", nav);
if (navigator.serviceWorker && location.protocol === "https:") navigator.serviceWorker.register("service-worker.js").catch(() => {});
