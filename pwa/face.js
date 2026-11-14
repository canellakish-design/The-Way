/* face.js — the coach's face (Harry, 14 Nov 2026: "a virtual coach that literally speaks to me. A face appears …
   This face should speak. Where I am? What should I adjust? What should I do to reach my goal is being a high
   level master cyclist.").
   An original face, drawn here: a monochrome, sharp-jawed head in light and shadow, glowing blue circuit lines at
   the collar, a ring of light behind it. It blinks, and while the coach speaks its mouth moves with the words
   (the speech's word boundaries, or a steady chatter where the phone gives none) and the lines glow brighter.
   Window.Face: open(), close(), briefing() (asks /voice/briefing and speaks it), speaking(utterance) (app.js speak
   hands every utterance here, so any spoken reply moves the face when it is open).
   14 Nov 2026 ("combine all of these coach features", the face always at the top): the face lives at the top of the
   Coach page (coach.js calls Face.mount), not in a sheet of its own. Opening it anywhere else goes to the Coach page;
   caption(text) puts any answer under it as it is spoken. */
(function(){
  const NS = "http://www.w3.org/2000/svg";
  let host = null, pending = false, talking = false, own = false, open = 0, target = 0, raf = 0, lastWord = 0;

  function svg(){
    return `<svg viewBox="0 0 300 380" class="facesvg" role="img" aria-label="Your coach">
      <defs>
        <radialGradient id="fHalo" cx="50%" cy="42%" r="50%"><stop offset="0" stop-color="#2a6ea8" stop-opacity=".55"/><stop offset="1" stop-color="#0a1420" stop-opacity="0"/></radialGradient>
        <linearGradient id="fSkinL" x1="0" x2="1"><stop offset="0" stop-color="#e9ecef"/><stop offset="1" stop-color="#c9ced3"/></linearGradient>
        <linearGradient id="fSkinR" x1="0" x2="1"><stop offset="0" stop-color="#8c939a"/><stop offset="1" stop-color="#5d646b"/></linearGradient>
        <filter id="fGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <pattern id="fGrid" width="15" height="15" patternUnits="userSpaceOnUse"><path d="M15 0 L0 0 0 15" fill="none" stroke="#5fd3ff" stroke-opacity=".08" stroke-width="1"/></pattern>
        <pattern id="fScan" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="1" fill="#000" fill-opacity=".28"/></pattern>
        <clipPath id="fHead"><path d="M150 52 L104 66 L90 116 L94 186 L112 236 L136 266 L150 272 L164 266 L188 236 L206 186 L210 116 L196 66 Z"/></clipPath>
      </defs>
      <rect width="300" height="380" fill="#070b10"/>
      <rect width="300" height="380" fill="url(#fGrid)"/>
      <circle cx="150" cy="150" r="140" fill="url(#fHalo)"/>
      <circle class="fring" cx="150" cy="150" r="118" fill="none" stroke="#5fd3ff" stroke-width="2.2" stroke-dasharray="6 10 40 10" filter="url(#fGlow)" opacity=".55"/>
      <!-- shoulders and collar -->
      <path d="M40 380 L60 318 Q150 284 240 318 L260 380 Z" fill="#dfe3e7"/>
      <path d="M118 300 L150 336 L182 300 L176 292 L150 318 L124 292 Z" fill="#1b2128"/>
      <g class="fcirc" stroke="#5fd3ff" stroke-width="2" fill="none" filter="url(#fGlow)">
        <path d="M70 340 L104 326 L112 338 L134 338"/><path d="M230 340 L196 326 L188 338 L166 338"/>
        <path d="M84 366 L120 352 L150 352 L180 352 L216 366"/>
        <circle cx="134" cy="338" r="2.6" fill="#5fd3ff"/><circle cx="166" cy="338" r="2.6" fill="#5fd3ff"/><circle cx="150" cy="352" r="2.6" fill="#5fd3ff"/>
      </g>
      <!-- neck -->
      <path d="M128 268 L128 300 L150 318 L172 300 L172 268 Z" fill="#9aa1a8"/>
      <!-- head: lit side and shadow side -->
      <path d="M150 52 L104 66 L90 116 L94 186 L112 236 L136 266 L150 272 Z" fill="url(#fSkinL)"/>
      <path d="M150 52 L196 66 L210 116 L206 186 L188 236 L164 266 L150 272 Z" fill="url(#fSkinR)"/>
      <!-- hair -->
      <path d="M92 118 L96 72 L122 48 L160 42 L196 54 L210 82 L208 120 L198 92 L170 76 L150 88 L128 76 L104 94 Z" fill="#14181d"/>
      <path d="M150 88 L170 76 L182 64 L160 70 Z" fill="#2a3037"/>
      <!-- brows -->
      <path d="M108 132 L140 126 L142 132 L112 138 Z" fill="#14181d"/>
      <path d="M192 132 L160 126 L158 132 L188 138 Z" fill="#14181d"/>
      <!-- eyes (they blink) -->
      <g class="feyes">
        <path d="M114 148 Q126 141 138 148 Q126 152 114 148 Z" fill="#14181d"/>
        <path d="M162 148 Q174 141 186 148 Q174 152 162 148 Z" fill="#14181d"/>
        <circle cx="127" cy="147.5" r="1.6" fill="#5fd3ff" filter="url(#fGlow)"/><circle cx="173" cy="147.5" r="1.6" fill="#5fd3ff" filter="url(#fGlow)"/>
      </g>
      <!-- nose: a line of shadow -->
      <path d="M150 142 L146 196 L140 204 L152 206" fill="none" stroke="#5d646b" stroke-width="2.4" stroke-linejoin="round"/>
      <!-- cheek and jaw lines -->
      <path d="M104 196 L118 228" stroke="#a9b0b6" stroke-width="1.6"/><path d="M196 196 L182 228" stroke="#4b5258" stroke-width="1.6"/>
      <!-- mouth: its opening follows the speech -->
      <path class="fmouth" d="M130 230 Q150 233 170 230 Q150 236 130 230 Z" fill="#14181d"/>
      <path class="flip" d="M132 229 Q150 226 168 229" fill="none" stroke="#3a4148" stroke-width="1.4"/>
      <!-- the wireframe: a contour mesh over the head, and a scan line that sweeps it -->
      <g clip-path="url(#fHead)" stroke="#5fd3ff" stroke-width=".6" fill="none" opacity=".28">
        <path d="M90 100 Q150 92 210 100"/><path d="M90 124 Q150 116 210 124"/><path d="M92 160 Q150 168 208 160"/><path d="M96 190 Q150 200 204 190"/><path d="M106 220 Q150 230 194 220"/><path d="M118 246 Q150 256 182 246"/>
        <path d="M120 60 Q112 160 128 262"/><path d="M150 50 L150 272"/><path d="M180 60 Q188 160 172 262"/>
        <rect class="fscan" x="80" y="40" width="140" height="3" fill="#5fd3ff" fill-opacity=".45" stroke="none"/>
      </g>
      <!-- HUD: corner brackets, a label, a clock -->
      <g stroke="#5fd3ff" stroke-width="2" fill="none" opacity=".8">
        <path d="M14 34 L14 14 L34 14"/><path d="M266 14 L286 14 L286 34"/><path d="M14 346 L14 366 L34 366"/><path d="M286 346 L286 366 L266 366"/>
      </g>
      <text x="22" y="30" class="fhud">COACH // <tspan class="fstate">STANDBY</tspan></text>
      <text x="278" y="30" class="fhud fclock" text-anchor="end">--:--</text>
      <text x="22" y="44" class="fhud" opacity=".6">GOAL · MASTERS ELITE</text>
      <!-- the voice: a waveform that moves with the words -->
      <g class="fwave" transform="translate(150 290)">${Array.from({ length: 21 }, (_, i) => `<rect x="${(i - 10) * 6 - 1.5}" y="-1" width="3" height="2" rx="1" fill="#5fd3ff" filter="url(#fGlow)"/>`).join("")}</g>
      <rect width="300" height="380" fill="url(#fScan)" pointer-events="none"/>
    </svg>`;
  }
  function mouthPath(o){   // o: 0 closed … 1 open
    const d = 2 + o * 16, w = 20 - o * 3;
    return `M${150 - w} 230 Q150 ${229 - o * 2} ${150 + w} 230 Q150 ${230 + d} ${150 - w} 230 Z`;
  }
  function frame(t){
    const sheet = live() ? host : null;
    if (!sheet) { raf = 0; talking = false; return; }
    // a word opens the mouth; between words it settles; with no word events, a steady chatter while speaking
    // the coach's own voice (app.js CoachVoice): the mouth follows the loudness of the sound itself
    const lvl = window.CoachVoice ? CoachVoice.level() : null;
    if (lvl != null) { talking = true; own = true; target = Math.min(1, lvl * 1.6); }
    else {
      if (own) { own = false; talking = false; }
      if (talking && t - lastWord > 260) target = 0.25 + 0.6 * Math.abs(Math.sin(t / 95)) * (0.6 + 0.4 * Math.sin(t / 37));
      if (!talking) target = 0;
    }
    open += (target - open) * 0.35;
    const m = sheet.querySelector(".fmouth"); if (m) m.setAttribute("d", mouthPath(Math.max(0, Math.min(1, open))));
    const ring = sheet.querySelector(".fring"); if (ring) { ring.setAttribute("opacity", talking ? (0.6 + 0.3 * Math.sin(t / 180)).toFixed(2) : "0.4"); ring.setAttribute("transform", `rotate(${(t / 60) % 360} 150 150)`); }
    const circ = sheet.querySelector(".fcirc"); if (circ) circ.setAttribute("opacity", talking ? (0.75 + 0.25 * Math.sin(t / 120)).toFixed(2) : "0.55");
    // the waveform: each bar follows the mouth with its own phase, flat when silent
    const bars = sheet.querySelectorAll(".fwave rect");
    bars.forEach((b, i) => { const amp = talking ? (2 + 22 * open * (0.4 + 0.6 * Math.abs(Math.sin(t / 70 + i * 0.9))) * (1 - Math.abs(i - 10) / 13)) : 2;
      b.setAttribute("y", (-amp / 2).toFixed(1)); b.setAttribute("height", amp.toFixed(1)); });
    const scan = sheet.querySelector(".fscan"); if (scan) scan.setAttribute("y", (40 + ((t / 12) % 240)).toFixed(0));
    const st = sheet.querySelector(".fstate"); if (st) st.textContent = talking ? "SPEAKING" : "ONLINE";
    raf = requestAnimationFrame(frame);
  }
  // the face is on screen: mounted on the Coach page, and that page is the one showing
  const alive = () => location.hash.replace(/^#/, "").split("?")[0] === "coach";
  const live = () => !!(host && host.isConnected && alive());
  function blink(){
    if (!live()) return;
    const e = host.querySelector(".feyes");
    if (e) { e.setAttribute("transform", "translate(0 148) scale(1 0.1) translate(0 -148)"); setTimeout(() => e.removeAttribute("transform"), 120); }
    setTimeout(blink, 2500 + Math.random() * 3500);
  }
  function tickClock(){ if (!live()) return; const c = host.querySelector(".fclock"); if (c) { const d = new Date(); c.textContent = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } setTimeout(tickClock, 10000); }
  // the caption types out like a terminal, about as fast as it is spoken
  // It writes to whichever caption is on screen at each step (the page can redraw mid-sentence after a log), and the
  // last thing said is kept, so a redrawn page shows it again rather than the opening line.
  let typing = 0, said = "";
  function typeOut(_el, text){
    said = text;
    const my = ++typing; let i = 0;
    const step = () => { if (my !== typing) return; i = Math.min(text.length, i + 2); const el = capEl(); if (el) el.textContent = text.slice(0, i) + (i < text.length ? "▌" : ""); if (i < text.length) setTimeout(step, 28); };
    step();
  }
  const capEl = () => live() ? host.querySelector("[data-cap]") : null;
  function stop(){ try { speechSynthesis.cancel(); if (window.CoachVoice) CoachVoice.stop(); } catch (e) {} talking = false; }
  // the face at the top of the Coach page: the face on the left, what it says and its two buttons beside it
  function mount(el){
    if (!el) return;
    el.classList.add("faceinline");
    el.innerHTML = `<div class="facewrap" title="Where am I?">${svg()}</div>
      <div class="facecol"><div class="facecap" data-cap>${esc(said || 'Tap "Where am I?" for your briefing, or ask below.')}</div>
        <div class="vrow"><button class="primary" data-brief>Where am I?</button><button data-stop>Stop</button></div></div>`;
    host = el;
    el.querySelector(".facewrap").onclick = () => briefing();
    el.querySelector("[data-brief]").onclick = () => briefing();
    el.querySelector("[data-stop]").onclick = stop;
    if (!raf) raf = requestAnimationFrame(frame);
    setTimeout(blink, 1200); tickClock();
    if (pending) { pending = false; setTimeout(briefing, 250); }
  }
  // anywhere else, the face is on the Coach page
  function openFace(){ if (!alive()) location.hash = "#coach"; else if (!raf && live()) raf = requestAnimationFrame(frame); }
  function close(){ stop(); }
  // every utterance app.js speaks comes here: the face moves with it while it is on screen
  function speaking(u){
    if (!u) return;
    const was = { start: u.onstart, end: u.onend, err: u.onerror, b: u.onboundary };
    u.onstart = e => { talking = true; if (was.start) was.start(e); };
    u.onend = e => { talking = false; if (was.end) was.end(e); };
    u.onerror = e => { talking = false; if (was.err) was.err(e); };
    u.onboundary = e => { if (e.name === "word" || e.name === undefined) { lastWord = performance.now(); target = 0.55 + Math.random() * 0.45; setTimeout(() => { target = 0.15; }, 140); } if (was.b) was.b(e); };
  }
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  async function briefing(){
    if (window.primeSound) try { primeSound(); } catch (e) {}   // the tap that asked unlocks the sound
    if (!live()) { pending = true; location.hash = "#coach"; return; }
    const cap = capEl(), b = host.querySelector("[data-brief]");
    typeOut(cap, "> reading your numbers…"); if (b) b.disabled = true;
    try {
      const r = await bridge("/voice/briefing");
      typeOut(capEl(), r.reply || "Nothing to say yet.");
      if (r.reply && typeof speak === "function") speak(r.reply);
    } catch (e) { const c = capEl(); if (c) c.textContent = e.message; }
    if (b) b.disabled = false;
  }
  // an answer from the conversation, under the face as it is spoken
  function caption(text){ if (text) typeOut(capEl(), String(text)); }
  window.Face = { open: openFace, close, briefing, speaking, mount, caption, stop };
  // the Coach page drew before this file loaded: put the face in it now
  if (alive()) mount(document.getElementById("chFace"));
})();
