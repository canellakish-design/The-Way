/* ptr.js — pull down to reload (Harry, 14 Nov 2026: "when I pull the app down … I would like to see the reload
   spinning circle at the top").
   At the top of any page, a pull down brings a circle out from under the header; it turns with the pull, and past
   the line it is let go to spin while the page's data is read again (the Day page's own refresh, any other page
   drawn afresh). Nothing reloads the app itself, so the opening words do not play again. A pull that starts on a
   button held to talk, in a box being typed in, or inside a list scrolled part-way is left alone. */
(function(){
  if (!("ontouchstart" in window)) return;
  const LINE = 72, MAX = 96, REST = 58;
  const el = document.createElement("div");
  el.id = "ptr"; el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:50%;top:0;z-index:9000;width:38px;height:38px;margin-left:-19px;border-radius:50%;background:#121212;border:1px solid #2a2a2a;box-shadow:0 2px 10px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;transform:translateY(-48px);opacity:0;pointer-events:none;will-change:transform";
  el.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" style="display:block"><circle cx="12" cy="12" r="8.5" fill="none" stroke="#2f2f2f" stroke-width="2.6"/><path class="arc" d="M12 3.5 A8.5 8.5 0 1 1 3.5 12" fill="none" stroke="#7BC48E" stroke-width="2.6" stroke-linecap="round"/></svg>';
  const css = document.createElement("style");
  css.textContent = "@keyframes ptrspin{to{transform:rotate(360deg)}} #ptr.spin svg{animation:ptrspin .7s linear infinite} #ptr.settle{transition:transform .25s ease, opacity .25s ease}";
  const put = () => { document.head.appendChild(css); document.body.appendChild(el); };
  if (document.body) put(); else document.addEventListener("DOMContentLoaded", put);
  const svg = () => el.querySelector("svg");
  let y0 = null, pull = 0, busy = false;
  const set = (px, turn) => { el.style.transform = `translateY(${px - 48}px)`; el.style.opacity = String(Math.min(1, px / 30)); if (turn != null) svg().style.transform = `rotate(${turn}deg)`; };
  const scrolled = t => { for (let n = t; n && n !== document.body && n.nodeType === 1; n = n.parentNode) if (n.scrollTop > 0 && n.scrollHeight > n.clientHeight + 1) return true; return false; };
  const skip = t => !!(t && t.closest && t.closest(".vhold, #micBtn, input, textarea, select, #waySplash, canvas, .lstep"));
  document.addEventListener("touchstart", e => {
    y0 = null; pull = 0;
    if (busy || e.touches.length !== 1 || (window.scrollY || document.documentElement.scrollTop) > 0 || skip(e.target) || scrolled(e.target)) return;
    y0 = e.touches[0].clientY; el.classList.remove("settle");
  }, { passive: true });
  document.addEventListener("touchmove", e => {
    if (y0 == null || busy) return;
    const dy = e.touches[0].clientY - y0;
    if (dy <= 0 || (window.scrollY || document.documentElement.scrollTop) > 0) { if (pull) { pull = 0; set(0); } if (dy < -4) y0 = null; return; }
    pull = Math.min(MAX, dy * 0.5);
    if (pull > 6 && e.cancelable) e.preventDefault();     // the page stays put while the circle comes down
    set(pull, pull * 3.2); svg().style.opacity = pull >= LINE ? "1" : "0.6";
  }, { passive: false });
  const refresh = async () => {
    const view = document.getElementById("view"), t0 = Date.now();
    try {
      const onDay = (location.hash.replace("#", "").split("?")[0] || "today") === "today";
      if (onDay && view && typeof view.__syncAll === "function") await view.__syncAll("pulled down");
      else if (typeof nav === "function") nav();
    } catch (e) { /* the page shows its own error */ }
    await new Promise(r => setTimeout(r, Math.max(0, 700 - (Date.now() - t0))));   // long enough to be seen
  };
  const end = async () => {
    if (y0 == null || busy) { y0 = null; return; }
    y0 = null; el.classList.add("settle");
    if (pull < LINE) { pull = 0; set(0); return; }
    busy = true; pull = 0; svg().style.transform = ""; svg().style.opacity = "1"; el.classList.add("spin"); set(REST);
    await refresh();
    el.classList.remove("spin"); set(0); busy = false;
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", end, { passive: true });
})();
