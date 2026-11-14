/* face.js — the coach (Harry, 14 Nov 2026: "a virtual coach that literally speaks to me. A face appears …
   This face should speak. Where I am? What should I adjust? What should I do to reach my goal is being a high
   level master cyclist.").
   14 Nov 2026 ("can you make the coach a full body? Head, everything. And I'd like them to move as they're talking a
   little bit more realistic and lifelike."): the coach is a whole figure, drawn here: the same monochrome,
   sharp-jawed head in light and shadow, on a body with arms, hands and legs, blue circuit lines glowing on the
   jacket, standing on a ring of light. It is never still: it breathes, shifts its weight, glances and blinks. While
   it speaks the mouth follows the loudness of the real voice, the head nods and turns, the brows lift on the
   stressed words, and the arms gesture (an open hand, both hands, a hand to the chest), with a small beat on each
   stressed syllable. What it is saying runs under it as subtitles, one sentence at a time, in step with the voice.
   Window.Face: mount(el) (the Coach page puts the stage at its top), open(), close(), briefing() (asks
   /voice/briefing and speaks it), speaking(utterance) (app.js hands the phone's own voice here), caption(text)
   (an answer from the conversation: its subtitles), stop(). */
(function(){
  let host = null, pending = false, talking = false, own = false, open = 0, target = 0, raf = 0, lastWord = 0;

  // ---- the figure ---------------------------------------------------------------------------------
  // viewBox 300 x 640, the ground at y 530 (the space under it is for the subtitles). The left of the picture is the lit side, the right the shadow side.
  // The head is the first face's drawing, kept whole in its own coordinates (300 x 380) and set on the neck.
  const HEAD = "translate(150 126) scale(.38) translate(-150 -272)";
  function svg(){
    return `<svg viewBox="0 0 300 640" class="facesvg bodysvg" role="img" aria-label="Your coach">
      <defs>
        <radialGradient id="fHalo" cx="50%" cy="34%" r="52%"><stop offset="0" stop-color="#2a6ea8" stop-opacity=".5"/><stop offset="1" stop-color="#0a1420" stop-opacity="0"/></radialGradient>
        <radialGradient id="fPad" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#5fd3ff" stop-opacity=".34"/><stop offset="1" stop-color="#5fd3ff" stop-opacity="0"/></radialGradient>
        <linearGradient id="fSkinL" x1="0" x2="1"><stop offset="0" stop-color="#e9ecef"/><stop offset="1" stop-color="#c9ced3"/></linearGradient>
        <linearGradient id="fSkinR" x1="0" x2="1"><stop offset="0" stop-color="#8c939a"/><stop offset="1" stop-color="#5d646b"/></linearGradient>
        <linearGradient id="fTopL" x1="0" x2="1"><stop offset="0" stop-color="#e3e7ea"/><stop offset="1" stop-color="#c3c9ce"/></linearGradient>
        <linearGradient id="fTopR" x1="0" x2="1"><stop offset="0" stop-color="#8b9299"/><stop offset="1" stop-color="#666d74"/></linearGradient>
        <linearGradient id="fLegL" x1="0" x2="1"><stop offset="0" stop-color="#5b646d"/><stop offset="1" stop-color="#444c54"/></linearGradient>
        <linearGradient id="fLegR" x1="0" x2="1"><stop offset="0" stop-color="#353c43"/><stop offset="1" stop-color="#262c32"/></linearGradient>
        <filter id="fGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <clipPath id="fHead"><path d="M150 52 L104 66 L90 116 L94 186 L112 236 L136 266 L150 272 L164 266 L188 236 L206 186 L210 116 L196 66 Z"/></clipPath>
      </defs>
      <ellipse cx="150" cy="210" rx="170" ry="230" fill="url(#fHalo)"/>
      <!-- the pad it stands on: a pool of light and two rings that turn -->
      <ellipse cx="150" cy="532" rx="118" ry="20" fill="url(#fPad)"/>
      <ellipse class="fring" cx="150" cy="532" rx="96" ry="15" fill="none" stroke="#5fd3ff" stroke-width="1.8" stroke-dasharray="6 10 40 10" filter="url(#fGlow)" opacity=".55"/>
      <ellipse class="fring2" cx="150" cy="532" rx="66" ry="10" fill="none" stroke="#5fd3ff" stroke-width="1" stroke-dasharray="2 7" opacity=".5"/>
      <g class="fall">
        <!-- legs, a natural stance with the feet a little apart, and shoes -->
        <g stroke="#5fd3ff" stroke-opacity=".3" stroke-width=".8" stroke-linejoin="round">
          <path d="M111 292 L151 292 L150 322 L144 408 L137 512 L113 512 L114 410 L108 330 Z" fill="url(#fLegL)"/>
          <path d="M189 292 L149 292 L150 322 L156 408 L163 512 L187 512 L186 410 L192 330 Z" fill="url(#fLegR)"/>
        </g>
        <path d="M150 300 L147 344 L150 372 L153 344 Z" fill="#070b10"/>
        <path d="M114 410 L144 408 L143 420 L114 422 Z" fill="#000" fill-opacity=".14"/><path d="M186 410 L156 408 L157 420 L186 422 Z" fill="#000" fill-opacity=".2"/>
        <g stroke="#5fd3ff" stroke-width="1.2" fill="none" opacity=".55" filter="url(#fGlow)"><path d="M113 338 L118 400"/><path d="M187 338 L182 400"/><path d="M116 470 L135 470"/><path d="M184 470 L165 470"/></g>
        <path d="M112 508 L138 508 L141 521 L138 531 L100 531 L99 524 L106 517 Z" fill="#eef1f3"/><path d="M99 527 L139 527" stroke="#5fd3ff" stroke-width="1.8" filter="url(#fGlow)"/>
        <path d="M188 508 L162 508 L159 521 L162 531 L200 531 L201 524 L194 517 Z" fill="#a3aab1"/><path d="M161 527 L201 527" stroke="#5fd3ff" stroke-width="1.8" filter="url(#fGlow)" opacity=".8"/>
        <g class="fupper">
          <!-- the jacket: broad at the shoulder, narrower at the waist; lit half, shadow half, dark collar and hem -->
          <g class="fchest">
            <g stroke="#5fd3ff" stroke-opacity=".3" stroke-width=".8" stroke-linejoin="round">
              <path d="M150 136 L134 132 L122 138 L101 146 L97 162 L103 210 L111 256 L110 296 L150 300 Z" fill="url(#fTopL)"/>
              <path d="M150 136 L166 132 L178 138 L199 146 L203 162 L197 210 L189 256 L190 296 L150 300 Z" fill="url(#fTopR)"/>
            </g>
            <path d="M103 210 L111 256 L118 256 L112 212 Z" fill="#000" fill-opacity=".08"/><path d="M197 210 L189 256 L182 256 L188 212 Z" fill="#000" fill-opacity=".16"/>
            <path d="M112 196 Q131 206 148 196" fill="none" stroke="#aeb5bb" stroke-width="1.2"/><path d="M188 196 Q169 206 152 196" fill="none" stroke="#535a61" stroke-width="1.2"/>
            <path d="M109 282 L191 282 L191 300 L109 300 Z" fill="#1b2128"/>
            <path d="M134 132 L150 162 L166 132 L160 126 L150 148 L140 126 Z" fill="#1b2128"/>
            <path d="M150 162 L150 282" stroke="#1b2128" stroke-width="1.6"/>
            <g class="fcirc" stroke="#5fd3ff" stroke-width="1.5" fill="none" filter="url(#fGlow)">
              <path d="M108 174 L127 168 L134 177 L144 177"/><path d="M192 174 L173 168 L166 177 L156 177"/>
              <path d="M117 226 L134 220 L150 220 L166 220 L183 226"/>
              <path d="M118 246 L131 252 L131 274"/><path d="M182 246 L169 252 L169 274"/>
              <circle cx="144" cy="177" r="2" fill="#5fd3ff"/><circle cx="156" cy="177" r="2" fill="#5fd3ff"/><circle cx="150" cy="220" r="2.2" fill="#5fd3ff"/>
            </g>
          </g>
          <!-- arms: each turns at the shoulder, the forearm and hand at the elbow; they taper to the wrist -->
          <g class="farmL">
            <path d="M95 150 L113 146 L112 234 L98 234 Z" fill="#d6dbdf" stroke="#5fd3ff" stroke-opacity=".3" stroke-width=".8"/><circle cx="104" cy="152" r="10.5" fill="#e1e5e8"/>
            <g class="fforeL">
              <circle cx="105" cy="233" r="7.6" fill="#cdd2d7"/>
              <path d="M97.5 232 L112.5 232 L110 302 L100 302 Z" fill="#cdd2d7" stroke="#5fd3ff" stroke-opacity=".3" stroke-width=".8"/>
              <path d="M99 292 L111 292" stroke="#5fd3ff" stroke-width="1.8" filter="url(#fGlow)"/>
              <path d="M100 302 L110 302 L113 314 L111 327 L106 333 L101 331 L98 318 Z" fill="#eef1f3"/><path d="M110 305 L117 313 L115 320 L111 316 Z" fill="#e1e5e8"/>
              <path d="M103 318 L104 330 M107 318 L107 331" stroke="#b9c0c6" stroke-width=".8"/>
            </g>
          </g>
          <g class="farmR">
            <path d="M205 150 L187 146 L188 234 L202 234 Z" fill="#7b8289" stroke="#5fd3ff" stroke-opacity=".3" stroke-width=".8"/><circle cx="196" cy="152" r="10.5" fill="#878e95"/>
            <g class="fforeR">
              <circle cx="195" cy="233" r="7.6" fill="#737a81"/>
              <path d="M202.5 232 L187.5 232 L190 302 L200 302 Z" fill="#737a81" stroke="#5fd3ff" stroke-opacity=".3" stroke-width=".8"/>
              <path d="M201 292 L189 292" stroke="#5fd3ff" stroke-width="1.8" filter="url(#fGlow)" opacity=".85"/>
              <path d="M200 302 L190 302 L187 314 L189 327 L194 333 L199 331 L202 318 Z" fill="#a3aab1"/><path d="M190 305 L183 313 L185 320 L189 316 Z" fill="#959ca3"/>
              <path d="M197 318 L196 330 M193 318 L193 331" stroke="#6c737a" stroke-width=".8"/>
            </g>
          </g>
          <!-- neck -->
          <path d="M141 112 L140 130 L150 148 L160 130 L159 112 Z" fill="#9aa1a8"/><path d="M150 112 L159 112 L160 130 L150 148 Z" fill="#7b8289"/>
          <g class="fheadg"><g transform="${HEAD}">
            <path d="M150 52 L104 66 L90 116 L94 186 L112 236 L136 266 L150 272 Z" fill="url(#fSkinL)"/>
            <path d="M150 52 L196 66 L210 116 L206 186 L188 236 L164 266 L150 272 Z" fill="url(#fSkinR)"/>
            <path d="M92 118 L96 72 L122 48 L160 42 L196 54 L210 82 L208 120 L198 92 L170 76 L150 88 L128 76 L104 94 Z" fill="#14181d"/>
            <path d="M150 88 L170 76 L182 64 L160 70 Z" fill="#2a3037"/>
            <path d="M104 196 L118 228" stroke="#a9b0b6" stroke-width="1.6"/><path d="M196 196 L182 228" stroke="#4b5258" stroke-width="1.6"/>
            <!-- the features move a little across the head as it turns and nods -->
            <g class="ffeat">
              <g class="fbrows"><path d="M108 132 L140 126 L142 132 L112 138 Z" fill="#14181d"/><path d="M192 132 L160 126 L158 132 L188 138 Z" fill="#14181d"/></g>
              <g class="feyes">
                <path d="M112 148 Q126 139 140 148 Q126 154 112 148 Z" fill="#14181d"/>
                <path d="M160 148 Q174 139 188 148 Q174 154 160 148 Z" fill="#14181d"/>
                <g class="fpup"><circle cx="127" cy="147.5" r="3" fill="#5fd3ff" filter="url(#fGlow)"/><circle cx="173" cy="147.5" r="3" fill="#5fd3ff" filter="url(#fGlow)"/></g>
              </g>
              <path d="M150 142 L146 196 L140 204 L152 206" fill="none" stroke="#5d646b" stroke-width="2.6" stroke-linejoin="round"/>
              <path class="fmouth" d="M130 230 Q150 233 170 230 Q150 236 130 230 Z" fill="#14181d"/>
              <path class="flip" d="M132 229 Q150 226 168 229" fill="none" stroke="#3a4148" stroke-width="1.6"/>
            </g>
            <!-- the wireframe: a contour mesh over the head, and a scan line that sweeps it -->
            <g clip-path="url(#fHead)" stroke="#5fd3ff" stroke-width="1.1" fill="none" opacity=".24">
              <path d="M90 100 Q150 92 210 100"/><path d="M92 160 Q150 168 208 160"/><path d="M106 220 Q150 230 194 220"/>
              <path d="M120 60 Q112 160 128 262"/><path d="M180 60 Q188 160 172 262"/>
              <rect class="fscan" x="80" y="40" width="140" height="5" fill="#5fd3ff" fill-opacity=".45" stroke="none"/>
            </g>
          </g></g>
        </g>
      </g>
      <!-- the voice: a waveform at its feet that moves with the words -->
      <g class="fwave" transform="translate(150 572)">${Array.from({ length: 21 }, (_, i) => `<rect x="${(i - 10) * 6 - 1.5}" y="-1" width="3" height="2" rx="1" fill="#5fd3ff" filter="url(#fGlow)"/>`).join("")}</g>
    </svg>`;
  }
  function mouthPath(o){   // o: 0 closed … 1 open; a little narrower as it opens, like a real mouth
    const d = 2 + o * 22, w = 20 - o * 4;
    return `M${150 - w} 230 Q150 ${229 - o * 2} ${150 + w} 230 Q150 ${230 + d} ${150 - w} 230 Z`;
  }

  // ---- how it moves ---------------------------------------------------------------------------------
  // Each joint is a small spring toward where it wants to be, so nothing snaps and a gesture settles with a
  // trace of overshoot. Angles in degrees: sh shoulder, el elbow (the left arm opens with +, the right with -);
  // tilt and turn and nod are the head; brow lifts it; gx, gy where the eyes look.
  const REST = { shL: 1.5, elL: 5, shR: -1.5, elR: -5 };
  const POSES = [
    { shL: 1.5, elL: 5, shR: -20, elR: -80 },      // an open hand, his right
    { shL: 20, elL: 80, shR: -1.5, elR: -5 },      // an open hand, his left
    { shL: 18, elL: 70, shR: -18, elR: -70 },    // both hands out
    { shL: 9, elL: 40, shR: -9, elR: -40 },      // both low, palms forward
    { shL: 1.5, elL: 5, shR: -9, elR: 106 },       // a hand to the chest
    { shL: 12, elL: 98, shR: -6, elR: -22 },     // making a point
    REST
  ];
  const S = {}; for (const k of ["shL", "elL", "shR", "elR", "tilt", "turn", "nod", "brow", "gx", "gy"]) S[k] = { x: REST[k] || 0, v: 0, to: REST[k] || 0 };
  let nextGesture = 0, nextGlance = 0, beat = 0, prevLvl = 0, lastBeat = 0, wasTalking = false, quiet = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pose = p => { for (const k of ["shL", "elL", "shR", "elR"]) S[k].to = p[k]; };
  const set = (root, sel, tf) => { const el = root.querySelector(sel); if (el) el.setAttribute("transform", tf); };
  function move(t, root){
    // breathing and the slow shift of weight never stop
    const breath = Math.sin(t / 1750), sway = Math.sin(t / 4100) + 0.45 * Math.sin(t / 2630 + 1.3);
    if (talking) {
      if (!wasTalking) { nextGesture = t + 250; }
      if (t > nextGesture) {           // a new gesture every second or two, the head turning with it
        const p = POSES[Math.floor(Math.random() * POSES.length)]; pose(p);
        S.turn.to = p.shR < -12 ? rnd(0.3, 1) : p.shL > 12 ? rnd(-1, -0.3) : rnd(-0.5, 0.5);
        S.tilt.to = rnd(-3.5, 3.5);
        nextGesture = t + rnd(1100, 2600);
      }
      // a stressed syllable: the loudness jumps, and the hands, head and brows give a small beat
      if (open > 0.5 && prevLvl <= 0.5 && t - lastBeat > 260) { beat = 1; lastBeat = t; }
      quiet = 0;
    } else {
      if (wasTalking) { pose(REST); S.turn.to = 0; S.tilt.to = 0; quiet = t; }
      // standing: now and then a small shift of an arm or a tilt of the head
      if (t > nextGesture) { const k = Math.random();
        if (k < 0.3) { S.shL.to = REST.shL + rnd(-2, 3); S.elL.to = REST.elL + rnd(-3, 9); }
        else if (k < 0.6) { S.shR.to = REST.shR - rnd(-2, 3); S.elR.to = REST.elR - rnd(-3, 9); }
        else { S.tilt.to = rnd(-2.5, 2.5); S.turn.to = rnd(-0.35, 0.35); }
        nextGesture = t + rnd(2600, 6000); }
    }
    wasTalking = talking; prevLvl = open; beat *= 0.86;
    if (t > nextGlance) {              // the eyes: mostly on him, a glance away now and then
      const away = Math.random() < (talking ? 0.3 : 0.45);
      S.gx.to = away ? rnd(-2.6, 2.6) : 0; S.gy.to = away ? rnd(-1, 1.4) : 0;
      nextGlance = t + (away ? rnd(350, 900) : rnd(1200, 3800));
    }
    S.nod.to = talking ? 0.9 * Math.sin(t / 620) * (0.4 + open) : 0;
    S.brow.to = talking ? Math.min(1, open * 0.6) : 0;
    for (const k in S) { const j = S[k], stiff = k === "gx" || k === "gy" ? 0.3 : 0.045, damp = k === "gx" || k === "gy" ? 0.55 : 0.8;
      j.v = j.v * damp + (j.to - j.x) * stiff; j.x += j.v; }
    const f = n => n.toFixed(2);
    const bL = beat * 7, nod = S.nod.x + beat * 1.6;
    set(root, ".fall", `rotate(${f(sway * 0.45)} 150 530)`);
    set(root, ".fupper", `translate(${f(sway * 2)} ${f(-breath * 1.1)}) rotate(${f(sway * 0.6)} 150 296)`);
    set(root, ".fchest", `translate(150 298) scale(${f(1 + 0.008 * breath)} ${f(1 + 0.011 * breath)}) translate(-150 -298)`);
    set(root, ".farmL", `rotate(${f(S.shL.x + breath * 0.7)} 104 152)`);
    set(root, ".fforeL", `rotate(${f(S.elL.x + (S.elL.x > 20 ? bL : 0))} 105 233)`);
    set(root, ".farmR", `rotate(${f(S.shR.x - breath * 0.7)} 196 152)`);
    set(root, ".fforeR", `rotate(${f(S.elR.x - (S.elR.x < -20 ? bL : S.elR.x > 20 ? -bL : 0))} 195 233)`);
    set(root, ".fheadg", `translate(${f(S.turn.x * 1.6)} ${f(nod * 0.7 - breath * 0.5)}) rotate(${f(S.tilt.x - sway * 0.5)} 150 132)`);
    set(root, ".ffeat", `translate(${f(S.turn.x * 8)} ${f(nod * 2.4)})`);
    set(root, ".fbrows", `translate(0 ${f(-(S.brow.x * 3 + beat * 3))})`);
    set(root, ".fpup", `translate(${f(S.gx.x)} ${f(S.gy.x)})`);
  }

  function frame(t){
    const sheet = live() ? host : null;
    if (!sheet) { raf = 0; talking = false; return; }
    // the coach's own voice (app.js CoachVoice): the mouth follows the loudness of the sound itself; the phone's
    // voice opens it on each word, or a steady chatter where the phone gives no word events
    const lvl = window.CoachVoice ? CoachVoice.level() : null;
    if (lvl != null) { talking = true; own = true; target = Math.min(1, lvl * 1.6); }
    else {
      if (own) { own = false; talking = false; }
      if (talking && t - lastWord > 260) target = 0.25 + 0.6 * Math.abs(Math.sin(t / 95)) * (0.6 + 0.4 * Math.sin(t / 37));
      if (!talking) target = 0;
    }
    open += (target - open) * 0.35;
    const m = sheet.querySelector(".fmouth"); if (m) m.setAttribute("d", mouthPath(Math.max(0, Math.min(1, open))));
    move(t, sheet);
    const ring = sheet.querySelector(".fring"); if (ring) { ring.setAttribute("opacity", talking ? (0.6 + 0.3 * Math.sin(t / 180)).toFixed(2) : "0.4"); ring.setAttribute("stroke-dashoffset", (-(t / 40) % 660).toFixed(1)); }
    const ring2 = sheet.querySelector(".fring2"); if (ring2) ring2.setAttribute("stroke-dashoffset", ((t / 55) % 660).toFixed(1));
    const circ = sheet.querySelector(".fcirc"); if (circ) circ.setAttribute("opacity", talking ? (0.75 + 0.25 * Math.sin(t / 120)).toFixed(2) : (0.5 + 0.08 * Math.sin(t / 1750)).toFixed(2));
    // the waveform: each bar follows the mouth with its own phase, flat when silent
    const bars = sheet.querySelectorAll(".fwave rect");
    bars.forEach((b, i) => { const amp = talking ? (2 + 22 * open * (0.4 + 0.6 * Math.abs(Math.sin(t / 70 + i * 0.9))) * (1 - Math.abs(i - 10) / 13)) : 2;
      b.setAttribute("y", (-amp / 2).toFixed(1)); b.setAttribute("height", amp.toFixed(1)); });
    const scan = sheet.querySelector(".fscan"); if (scan) scan.setAttribute("y", (40 + ((t / 12) % 240)).toFixed(0));
    const st = sheet.querySelector(".fstate"); if (st) { const s = busy ? "THINKING" : talking ? "SPEAKING" : "ONLINE"; if (st.textContent !== s) st.textContent = s; }
    sheet.classList.toggle("talking", talking);
    // which voice spoke last: the coach's own, or the phone's (and why), so a silent phone can be told from a missing key
    const vv = sheet.querySelector(".fvoice"); if (vv && window.CoachVoice && CoachVoice.last) { const s = "VOICE · " + String(CoachVoice.last).toUpperCase().slice(0, 28); if (vv.textContent !== s) vv.textContent = s; }
    subtitles(t);
    raf = requestAnimationFrame(frame);
  }
  // the coach is on screen: mounted on the Coach page, and that page is the one showing
  const alive = () => location.hash.replace(/^#/, "").split("?")[0] === "coach";
  const live = () => !!(host && host.isConnected && alive());
  function blink(){
    if (!live()) return;
    const e = host.querySelector(".feyes");
    const shut = () => { e.setAttribute("transform", "translate(0 148) scale(1 0.1) translate(0 -148)"); setTimeout(() => e.removeAttribute("transform"), 110); };
    if (e) { shut(); if (Math.random() < 0.18) setTimeout(shut, 260); }   // now and then a double blink
    setTimeout(blink, (talking ? 1800 : 2600) + Math.random() * 3400);
  }
  function tickClock(){ if (!live()) return; const c = host.querySelector(".fclock"); if (c) { const d = new Date(); c.textContent = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); } setTimeout(tickClock, 10000); }

  // ---- subtitles ----------------------------------------------------------------------------------
  // What it is saying, a sentence at a time, in step with the voice: by the sound's own clock (the coach's voice),
  // by the word the phone is on (the phone's voice), else at reading pace. The whole answer is in the conversation.
  let said = "", subs = [], subAt = -1, subT0 = 0, subChar = -1, busy = false, note = "";
  function chunks(text){
    const out = []; let at = 0;
    // a sentence ends at . ! ? followed by a space (never inside "1.8" or "3:15")
    for (const s of String(text).replace(/([.!?])\s+/g, "$1\n").split("\n").map(x => x + " ")) {
      let rest = s;
      while (rest.trim().length > 96) { let cut = rest.lastIndexOf(", ", 92); if (cut < 40) cut = rest.lastIndexOf(" ", 92); if (cut < 40) cut = 92; cut += 1;
        out.push({ text: rest.slice(0, cut).trim(), from: at }); at += cut; rest = rest.slice(cut); }
      if (rest.trim()) out.push({ text: rest.trim(), from: at }); at += rest.length;
    }
    return out;
  }
  function setSubs(text){ said = String(text || ""); subs = chunks(said); subAt = -1; quiet = 0; subT0 = performance.now(); subChar = -1; note = ""; }
  function subtitles(t){
    const el = capEl(); if (!el) return;
    let text = note;
    if (!note && subs.length) {
      let pos = null;
      const v = window.CoachVoice;
      if (v && v.playing && v.el && v.el.duration > 0 && isFinite(v.el.duration)) pos = said.length * (v.el.currentTime / v.el.duration);
      else if (talking && subChar >= 0) pos = subChar;
      else if (talking) pos = (t - subT0) / 62;                     // about sixteen characters a second
      if (pos != null) { let i = 0; while (i + 1 < subs.length && subs[i + 1].from <= pos) i++; subAt = i; }
      else if (subAt < 0) subAt = 0;
      // when it has finished, the last line stays a few seconds, then the stage is clear again
      text = !talking && quiet && t - quiet > 4500 && subAt >= subs.length - 1 ? "" : subs[Math.min(subAt, subs.length - 1)].text;
    }
    if (el.textContent !== text) el.textContent = text;
    host.classList.toggle("hascap", !!text);
  }
  const capEl = () => live() ? host.querySelector("[data-cap]") : null;
  function stop(){ try { speechSynthesis.cancel(); if (window.CoachVoice) CoachVoice.stop(); } catch (e) {} talking = false; subs = []; note = ""; }

  // the stage at the top of the Coach page: the figure, its subtitles, "Where am I?" at its feet
  function mount(el){
    if (!el) return;
    el.classList.remove("faceinline"); el.classList.add("stage");
    el.innerHTML = `<div class="stagehud tl"><span>COACH // <b class="fstate">STANDBY</b></span><span class="dim">GOAL · MASTERS ELITE</span></div>
      <div class="stagehud tr"><span class="fclock">--:--</span><span class="dim fvoice"></span></div>
      <div class="stagefig" title="Where am I?">${svg()}</div>
      <div class="stagecap" data-cap aria-live="polite"></div>
      <button class="stagestop" data-stop>Stop</button>
      <button class="primary stagebrief" data-brief>Where am I?</button>`;
    host = el;
    el.querySelector(".stagefig").onclick = () => briefing();
    el.querySelector("[data-brief]").onclick = () => briefing();
    el.querySelector("[data-stop]").onclick = stop;
    if (!raf) raf = requestAnimationFrame(frame);
    setTimeout(blink, 1200); tickClock();
    if (pending) { pending = false; setTimeout(briefing, 250); }
  }
  // anywhere else, the coach is on the Coach page
  function openFace(){ if (!alive()) location.hash = "#coach"; else if (!raf && live()) raf = requestAnimationFrame(frame); }
  function close(){ stop(); }
  // every utterance the phone's own voice speaks comes here: the coach moves with it while it is on screen
  function speaking(u){
    if (!u) return;
    const was = { start: u.onstart, end: u.onend, err: u.onerror, b: u.onboundary };
    u.onstart = e => { talking = true; subT0 = performance.now(); if (was.start) was.start(e); };
    u.onend = e => { talking = false; subChar = -1; if (was.end) was.end(e); };
    u.onerror = e => { talking = false; subChar = -1; if (was.err) was.err(e); };
    u.onboundary = e => { if (e.name === "word" || e.name === undefined) { lastWord = performance.now(); if (e.charIndex != null) subChar = e.charIndex; target = 0.55 + Math.random() * 0.45; setTimeout(() => { target = 0.15; }, 140); } if (was.b) was.b(e); };
  }
  async function briefing(){
    if (window.primeSound) try { primeSound(); } catch (e) {}   // the tap that asked unlocks the sound
    if (!live()) { pending = true; location.hash = "#coach"; return; }
    if (busy) return;
    busy = true; subs = []; note = "Reading your numbers…"; host.classList.add("busy");
    try {
      const r = await bridge("/voice/briefing");
      const reply = r.reply || "Nothing to say yet.";
      setSubs(reply);
      if (window.voiceBits && voiceBits.note) voiceBits.note("Where am I?", reply);   // kept in the conversation
      if (r.reply && typeof speak === "function") speak(r.reply);
    } catch (e) { note = String(e.message || e).slice(0, 120); setTimeout(() => { if (note && !talking) note = ""; }, 6000); }
    busy = false; if (host) host.classList.remove("busy");
  }
  // an answer from the conversation: its subtitles, as it is spoken
  function caption(text){ if (text) setSubs(text); }
  window.Face = { open: openFace, close, briefing, speaking, mount, caption, stop };
  // the Coach page drew before this file loaded: put the coach in it now
  if (alive()) mount(document.getElementById("chFace"));
})();
