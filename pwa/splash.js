/* splash.js — the opening (Harry, 14 Nov 2026: "Whenever I open the way I want the words This is the Way to flash
   in sparking lights").
   Each time the app is opened (loaded, or come back to after ten minutes away) the words THIS IS THE WAY appear
   over a black screen, lit by sparks: the letters are drawn in points of light that twinkle, a flash runs across
   them, sparks fall away, and it clears to the app in about two and a half seconds. A tap clears it at once. With
   "reduce motion" on, the words show still for a second and fade.
   It loads first and stands alone: no other file is needed, and nothing waits on it. */
(function(){
  const AWAY_MS = 10 * 60 * 1000, LIFE = 2600, FADE = 450;
  const GOLD = [255, 226, 150], WHITE = [255, 255, 255], GREEN = [123, 196, 142];
  let showing = false, hiddenAt = 0;

  function show(){
    if (showing) return; showing = true;
    const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = document.createElement("div");
    el.id = "waySplash"; el.setAttribute("role", "img"); el.setAttribute("aria-label", "This is the Way");
    el.style.cssText = "position:fixed;inset:0;z-index:99999;background:#000;display:flex;align-items:center;justify-content:center;transition:opacity " + FADE + "ms ease;touch-action:none;cursor:pointer";
    const cv = document.createElement("canvas"); cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    el.appendChild(cv); document.body.appendChild(el);
    let raf = 0, gone = false;
    const done = () => { if (gone) return; gone = true; el.style.opacity = "0"; el.style.pointerEvents = "none"; setTimeout(() => { cancelAnimationFrame(raf); el.remove(); showing = false; }, FADE + 30); };
    el.addEventListener("pointerdown", done);

    // the black screen is up at once; the lights start when the app's own lettering is ready (350 ms at most)
    const build = () => {
      if (gone) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = window.innerWidth, H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const g = cv.getContext("2d"); g.scale(dpr, dpr);
      // the words, set in two lines on a narrow screen, with WAY in the app's green
      const lines = W < 640 ? [["THIS IS", WHITE], ["THE WAY", null]] : [["THIS IS THE WAY", null]];
      const font = px => `800 ${px}px "Saira Condensed","Arial Narrow","Roboto Condensed",Arial,sans-serif`;
      let size = Math.min(H * 0.2, 170); g.font = font(size);
      const widest = () => Math.max(...lines.map(l => g.measureText(l[0]).width));
      while (widest() > W * 0.86 && size > 24) { size -= 2; g.font = font(size); }
      const lh = size * 1.02, top = H / 2 - (lines.length - 1) * lh / 2;
      // draw the words once, off screen, and take the points of light from them
      const off = document.createElement("canvas"); off.width = W; off.height = H;
      const og = off.getContext("2d"); og.font = font(size); og.textBaseline = "middle"; og.textAlign = "left";
      const wordAt = [];   // [{x0, x1, y, text, col}]
      lines.forEach((l, i) => {
        const w = og.measureText(l[0]).width, x = (W - w) / 2, y = top + i * lh;
        og.fillStyle = "#fff"; og.fillText(l[0], x, y);
        const way = l[0].lastIndexOf("WAY"), xWay = way >= 0 ? x + og.measureText(l[0].slice(0, way)).width : Infinity;
        wordAt.push({ x, y, text: l[0], xWay });
      });
      const px = og.getImageData(0, 0, W, H).data, step = Math.max(3, Math.round(size / 26)), pts = [];
      for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (px[(y * W + x) * 4 + 3] > 128) {
        const line = wordAt.reduce((a, b) => Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a, wordAt[0]);
        pts.push({ x, y, green: x >= line.xWay, ph: Math.random() * 6.283, sp: 3 + Math.random() * 6, big: Math.random() < 0.07, lit: (x / W) * 0.55 + Math.random() * 0.12 });
      }
      const sparks = [];
      const star = (x, y, r, a, c) => {   // a four-point sparkle
        g.globalAlpha = a; g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        g.beginPath(); g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r); g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
      };
      const words = a => { g.globalAlpha = a; g.font = font(size); g.textBaseline = "middle"; g.textAlign = "left";
        for (const l of wordAt) { const way = l.text.lastIndexOf("WAY");
          if (way < 0) { g.fillStyle = "#F2F1EC"; g.fillText(l.text, l.x, l.y); continue; }
          g.fillStyle = "#F2F1EC"; g.fillText(l.text.slice(0, way), l.x, l.y); g.fillStyle = "#7BC48E"; g.fillText("WAY", l.xWay, l.y); } };

      if (still) { g.clearRect(0, 0, W, H); words(1); setTimeout(done, 1100); return; }
      const t0 = performance.now();
      const frame = now => {
        if (gone) return;
        const t = (now - t0) / 1000, u = Math.min(1, (now - t0) / LIFE);
        g.clearRect(0, 0, W, H);
        g.globalCompositeOperation = "lighter";
        const sweep = (t - 0.75) / 0.5;                 // the flash that runs across the words, left to right
        const flash = t > 1.25 && t < 1.6 ? 1 - (t - 1.25) / 0.35 : 0;   // then the whole line flares once
        // the words themselves, coming up under the lights and holding
        words(Math.max(0, Math.min(1, (t - 0.55) / 0.6)) * 0.9 + flash * 0.1);
        g.shadowColor = "rgba(255,226,150,.9)"; g.shadowBlur = 0;
        for (const p of pts) {
          const on = (t - p.lit * 0.9) / 0.25; if (on <= 0) continue;        // lit from left to right as it starts
          const tw = 0.5 + 0.5 * Math.sin(t * p.sp + p.ph);                   // each point twinkles on its own
          const near = Math.max(0, 1 - Math.abs(p.x / W - sweep) * 7);       // brighter as the flash passes
          const a = Math.min(1, on) * (0.25 + 0.75 * tw * tw) * (t > 2.0 ? Math.max(0, 1 - (t - 2.0) / 0.5) : 1) + near * 0.9 + flash * 0.6;
          const c = near > 0.3 || flash > 0.3 ? WHITE : p.green ? GREEN : (tw > 0.7 ? WHITE : GOLD);
          const r = (p.big ? step * 1.9 : step * 0.62) * (0.7 + 0.6 * tw + near * 1.2 + flash * 0.8);
          star(p.x, p.y, r, Math.min(1, a), c);
          if (Math.random() < 0.0035 + near * 0.04 + flash * 0.02) sparks.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 60, life: 0.5 + Math.random() * 0.7, age: 0, c: p.green ? GREEN : GOLD });
        }
        // sparks thrown off the letters: they drift, fall and go out
        for (let i = sparks.length - 1; i >= 0; i--) { const s = sparks[i]; s.age += 1 / 60; if (s.age >= s.life) { sparks.splice(i, 1); continue; }
          s.vy += 140 / 60; s.x += s.vx / 60; s.y += s.vy / 60; const k = 1 - s.age / s.life; star(s.x, s.y, 1.2 + 2.6 * k, k, k > 0.6 ? WHITE : s.c); }
        g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
        if (u >= 1) { done(); return; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    };
    const ready = document.fonts && document.fonts.load ? document.fonts.load('800 80px "Saira Condensed"') : Promise.resolve();
    Promise.race([ready, new Promise(r => setTimeout(r, 350))]).then(build, build);
    setTimeout(done, LIFE + 1500);   // whatever happens, the app is never kept behind it
  }

  // opened: now, and whenever he comes back after ten minutes away
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) { hiddenAt = 0; show(); }
  });
  window.WaySplash = { show };
})();
