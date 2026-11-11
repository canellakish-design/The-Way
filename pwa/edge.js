"use strict";
/* THE WAY — the Edge 1050 beside the workout player (Harry, 9 Nov 2026: "build the simulation of it, I even want
   it to look like the 1050", and "it should function exactly as it would outdoors").

   Two halves, one file, loaded by the page (window.Edge) and by the tests (require):
   - the FIELD: a second-by-second copy of garmin/the-way-field/source/TheWayField.mc (compute, the buckets,
     decoupling, on plan, the sync line) plus the ten features of handover-garmin-features-nov9.md that make
     sense on a trainer (fuel prompts with the lap button, the fuel tank, the Zone 1 guardrail, VO2 mode,
     the easy line, the ride rating, the pre-ride screen, the energy line). Turn-around-by needs GPS: indoors
     the bottom line stays the next event, as the field does with no fix.
   - the SCREEN: the field's onUpdate drawn on a 480 x 800 canvas with the field's own fonts, sizes and
     colours, inside a drawn Edge 1050 (bezel, lap and start buttons, page dots).
   The rules (which bucket, the plan, the lines, the colours) come from pwa/buckets.js, the same file the
   site, the player and the bridge use, so the Edge, the player and the site cannot disagree. */
(function (root) {
  const BK = () => root.Buckets || (typeof require !== 'undefined' ? require('./buckets.js') : null);
  const DEC = { green: '#22BB44', yellow: '#FFDD00', red: '#E00000' };
  const INK = '#FFFFFF', DIM = '#AAAAAA', BG = '#000000';   // the field on a black background (Garmin LT_GRAY)
  const DEC_SKIP_MIN = 10, KEEP_ALERT_S = 8;
  const QUICK_SHARE = 0.24, FULL_G = 110, LEGS_FULL_G = 320;
  const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const mmss = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const hms = s => { s = Math.max(0, Math.round(s)); return s < 3600 ? mmss(s) : `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  // ---- decoupling: the field's, to the line ----
  // Pa:HR from per-minute sums of power and heart rate (only seconds with both); the first 10 minutes are left
  // out, the rest split in half; (EF1 - EF2) / EF1 x 100 with EF = sum power / sum hr. Null before 20:00.
  function decoupling(minP, minH, minN, timerS) {
    const n = minN.length;
    if (timerS < 1200 || n < DEC_SKIP_MIN + 10) return null;
    const half = DEC_SKIP_MIN + Math.floor((n - DEC_SKIP_MIN) / 2);
    let p1 = 0, h1 = 0, p2 = 0, h2 = 0;
    for (let i = DEC_SKIP_MIN; i < n; i++) { if (i < half) { p1 += minP[i]; h1 += minH[i]; } else { p2 += minP[i]; h2 += minH[i]; } }
    if (h1 <= 0 || h2 <= 0 || p1 <= 0) return null;
    const ef1 = p1 / h1, ef2 = p2 / h2;
    const d = (ef1 - ef2) / ef1 * 100;
    return Math.abs(d) < 0.05 ? 0 : d;
  }
  const decColour = d => d == null ? null : d > 10 ? DEC.red : d >= 5 ? DEC.yellow : DEC.green;

  // the session's steps as the field gets them: [start_s, dur_s, target_w, hr_lo, hr_hi]; from the bridge's
  // /garmin/session/today when there is one, else from the player's intervals (a free step goes as Zone 1)
  function stepsOf(sess, intervals, lines) {
    if (sess && Array.isArray(sess.steps) && sess.steps.length) return sess.steps;
    const v1 = (lines && lines.vt1_hr) || 117;
    return (intervals || []).map(x => { const w = num(x.target_w), we = num(x.target_w_end), hr = x.target_hr && num(x.target_hr.hi) ? x.target_hr : null;
      const tw = w != null ? Math.round(we != null ? (w + we) / 2 : w) : 0;
      return [x.start_s, x.dur_s, tw, hr ? num(hr.lo) : tw ? 0 : v1 - 20, hr ? num(hr.hi) : tw ? 0 : v1 - 1]; });
  }

  // ---- the field ----
  function create(o) {
    const B = BK();
    const S = { sess: o.session || null, ftp: o.ftp || 175, rideId: o.rideId || Date.now(), name: o.name || (o.session && o.session.name) || 'The Way',
      lines: Object.assign({}, B.LINES, (o.session && o.session.lines) || o.lines || {}), colours: Object.assign({}, B.COLOURS, (o.session && o.session.colours) || o.colours || {}),
      intervals: o.intervals || [], kind: o.kind || '', time: o.time || null };
    const st = { timerS: 0, running: false, started: false, w: null, hr: null, cad: null, done: [0, 0, 0], plannedS: 0, onPlanS: 0, minP: [], minH: [], minN: [],
      over: 0, overRun: 0, overAlerted: false, decAlerted: false, above: 0, kcal: 0, quick: null, legs: null, gut: 0,
      prompts: [], alerts: [], page: 0, rating: null, rated: null, sentS: 0, lastOkAt: 0, lastCode: 0, sending: false };
    let steps = [], plan = [0, 0, 0], hasPlan = false, fromBridge = false;

    function setSession(sess) {
      S.sess = sess || null;
      if (sess) {
        Object.assign(S.lines, sess.lines || {}); Object.assign(S.colours, sess.colours || {});
        if (sess.name) S.name = sess.name;
        if (sess.time) { const mm = /^(\d{1,2}):(\d{2})$/.exec(sess.time); S.time = mm ? `${(+mm[1] % 12) || 12}:${mm[2]}${+mm[1] < 12 ? 'a' : 'p'}` : sess.time; }   // 12-hour clock
      }
      steps = stepsOf(S.sess, S.intervals, S.lines);
      fromBridge = !!(S.sess && Object.prototype.hasOwnProperty.call(S.sess, 'buckets_plan'));
      const bp = fromBridge ? S.sess.buckets_plan : null;
      if (fromBridge) { hasPlan = !!(bp && (bp.low || bp.high || bp.peak)); plan = hasPlan ? [bp.low || 0, bp.high || 0, bp.peak || 0] : [0, 0, 0]; }
      else { const p = planned(-1); plan = p; hasPlan = p[0] + p[1] + p[2] > 0; }
      // the fuel prompts: every_min from start_min, through the planned length
      const f = S.sess && S.sess.fuel, end = steps.reduce((m, x) => Math.max(m, x[0] + x[1]), 0) || 4 * 3600;
      st.prompts = [];
      if (f && f.every_min > 0) for (let m = f.start_min || f.every_min; m * 60 < end; m += f.every_min) st.prompts.push({ at: m * 60, grams: f.grams, product: f.product || 'Tailwind', state: 'due', nagged: false });
      const tk = S.sess && S.sess.tank;
      if (tk && st.quick == null) { st.quick = num(tk.quick_g) != null ? tk.quick_g : FULL_G * (tk.quick_pct || 0) / 100; st.legs = num(tk.legs_g) != null ? tk.legs_g : tk.legs_pct != null ? LEGS_FULL_G * tk.legs_pct / 100 : null; }
    }
    // 0 low, 1 high, 2 peak: power decides when there is a reading, else heart rate (the field's zoneOf)
    const zoneOf = (w, hr) => { const b = B.bucketOf({ w, hr }, S.lines); return b == null ? -1 : b; };
    const stepZone = x => x[2] > 0 ? zoneOf(x[2], null) : x[4] > 0 ? zoneOf(null, Math.round((x[3] + x[4]) / 2)) : -1;
    function stepAt(t) { for (const x of steps) if (t >= x[0] && t < x[0] + x[1]) return x; return null; }
    function planned(upTo) { const out = [0, 0, 0]; for (const x of steps) { const z = stepZone(x); if (z < 0) continue; let d = x[1]; if (upTo >= 0) d = Math.max(0, Math.min(x[1], upTo - x[0])); out[z] += d; } return out; }
    const planEnd = () => steps.reduce((m, x) => Math.max(m, x[0] + x[1]), 0);
    const z1Session = () => hasPlan && plan[1] === 0 && plan[2] === 0;
    const vo2 = () => S.sess && S.sess.vo2 ? S.sess.vo2 : null;
    const alert = (text, buzz) => { st.alerts.push({ text, buzz: buzz || 'double', t: st.timerS, until: st.timerS + KEEP_ALERT_S }); return { type: 'alert', text, buzz: buzz || 'double' }; };

    // one recorded second. t: ride time (the field's timer), wt: where the workout is (the player can skip a step)
    function second(x) {
      const t = num(x.t) != null ? x.t : st.timerS + 1, wt = num(x.wt) != null ? x.wt : t;
      st.w = num(x.w); st.hr = num(x.hr); st.cad = num(x.cad); st.running = true; st.started = true;
      if (t <= st.timerS && st.timerS > 0) return [];
      st.timerS = t; st.wt = wt + 1;   // the workout clock after this second, as the player's own clock reads
      const ev = [];
      const z = zoneOf(st.w, st.hr);
      if (z >= 0) st.done[z]++;
      const sp = stepAt(wt);
      if (sp) { const pz = stepZone(sp); if (pz >= 0) { st.plannedS++; if (z === pz) st.onPlanS++; } }
      if (st.w != null && st.hr != null && st.hr > 0) { const mi = Math.floor(t / 60); while (st.minN.length <= mi) { st.minP.push(0); st.minH.push(0); st.minN.push(0); } st.minP[mi] += st.w; st.minH[mi] += st.hr; st.minN[mi]++; }
      // energy: kJ from power is kcal (23% efficiency cancels 4.184); without power, from heart rate
      const IF = st.w != null ? st.w / S.ftp : st.hr != null ? Math.max(0.35, Math.min(1.1, 0.4 + (st.hr - 90) / Math.max(1, S.lines.vt2_hr - 90) * 0.5)) : 0;
      st.kcal += st.w != null ? st.w / 1000 : IF * S.ftp / 1000;
      // the fuel tank: the carb share of the burn, 24% from the quick store; eaten carbs come in at up to 90 g/h
      if (st.quick != null && IF > 0) {
        const kcalH = IF * S.ftp * 3600 / 4184 / 0.23, frac = Math.max(0.3, Math.min(0.95, 1.1 * IF - 0.2)), carbS = kcalH * frac / 4 / 3600;
        st.quick = Math.max(0, st.quick - carbS * QUICK_SHARE); if (st.legs != null) st.legs = Math.max(0, st.legs - carbS * (1 - QUICK_SHARE));
        if (st.gut > 0) { const take = Math.min(st.gut, 90 / 3600); st.gut -= take; st.quick = Math.min(FULL_G, st.quick + take); }
        // projected: the quick store at 25% within 20 minutes, once
        if (!st.lowAlerted && st.quick - carbS * QUICK_SHARE * 1200 <= FULL_G * 0.25) { st.lowAlerted = true; ev.push(alert('Low fuel in ~20 min: eat now', 'long')); }
      }
      // the Zone 1 guardrail: on a Zone 1 session, seconds over 116; 30 s running gives a double buzz
      const cap = S.lines.vt1_hr - 1;
      if (z1Session() && st.hr != null) {
        if (st.hr > cap) { st.over++; st.overRun++; if (st.overRun === 30) ev.push(alert(`Over ${cap}: ease off`, 'double')); } else st.overRun = 0;
      }
      const dec = decoupling(st.minP, st.minH, st.minN, t);
      if (dec != null && dec >= 5 && !st.decAlerted && !vo2()) { st.decAlerted = true; ev.push(alert('Drifting 5 %: ease off or eat', 'double')); }
      // VO2: time above the floor
      const v = vo2(); if (v && st.hr != null && st.hr >= v.hr_floor) { st.above++; if (st.above === v.goal_min[0] * 60) ev.push(alert(`${v.goal_min[0]} min above ${v.hr_floor}: goal reached`, 'long')); }
      // fuel prompts: due at their minute; a lap within 5 min eats it; missed, one nag 5 min later
      for (const p of st.prompts) {
        if (p.state === 'due' && t >= p.at) { p.state = 'open'; ev.push(alert(`Fuel: ${p.product} ${p.grams} g`, 'long')); }
        else if (p.state === 'open' && t >= p.at + 300) { p.state = 'missed'; if (!p.nagged) { p.nagged = true; ev.push(alert(`Fuel now: ${p.product} ${p.grams} g`, 'long')); } }
      }
      // the rating: in the last 5 minutes of a planned session, once
      const pe = planEnd();
      if (pe > 600 && !st.rated && !st.rating && wt >= pe - 300 && wt < pe) { st.rating = { ask: 'legs', presses: 0, firstAt: null, legs: null, breathing: null }; ev.push(alert('Legs? press lap 1 to 5', 'double')); }
      if (st.rating && st.rating.firstAt != null && t - st.rating.firstAt >= 10) ev.push(...closeRating());
      st.alerts = st.alerts.filter(a => a.until > t);
      return ev;
    }
    function closeRating() {
      const r = st.rating, n = Math.max(1, Math.min(5, r.presses)), out = [];
      if (r.ask === 'legs') { r.legs = n; r.ask = 'breathing'; r.presses = 0; r.firstAt = null; out.push(alert('Breathing? press lap 1 to 5', 'double')); }
      else { r.breathing = n; st.rated = { legs: r.legs, breathing: r.breathing }; st.rating = null;
        out.push({ type: 'post', path: '/garmin/rating', body: { ride_id: String(S.rideId), legs: r.legs, breathing: r.breathing, name: S.name } });
        out.push(alert(`Rated: legs ${r.legs}, breathing ${r.breathing}`, 'double')); }
      return out;
    }
    // the lap button: rating first, else eats the open fuel prompt (or one due within 5 min); laps still record
    function lap() {
      const t = st.timerS, out = [{ type: 'lap', t }];
      if (st.rating) { st.rating.presses++; if (st.rating.firstAt == null) st.rating.firstAt = t; return out; }
      const p = st.prompts.find(x => x.state === 'open') || st.prompts.find(x => x.state === 'missed' && t <= x.at + 900) || st.prompts.find(x => x.state === 'due' && x.at - t <= 300);
      if (p) { p.state = t <= p.at + 300 ? 'eaten' : 'late'; st.gut += p.grams; out.push({ type: 'post', path: '/garmin/fuel', body: { ride_id: String(S.rideId), t: Math.round(Date.now() / 1000), grams: p.grams, product: p.product } }); out.push(alert(`Logged: ${p.product} ${p.grams} g`, 'single')); }
      return out;
    }
    function synced(ok, seconds, code) { if (ok) { st.sentS = seconds; st.lastOkAt = Date.now(); } st.lastCode = code || (ok ? 200 : -1); }
    function stop() { st.running = false; }
    function syncWord() {
      if (!st.started) return 'The Way: ready';
      if (st.sending) return 'The Way: sending';
      if (st.lastOkAt > 0) { const ago = Math.floor((Date.now() - st.lastOkAt) / 1000); return `The Way: ${hms(st.sentS)} kept, ${ago < 60 ? 'just now' : mmss(ago) + ' ago'}`; }
      return 'The Way: waiting';
    }

    // what the screen shows now
    function model(nowMs) {
      const t = st.timerS, dec = decoupling(st.minP, st.minH, st.minN, t), v = vo2();
      const due = fromBridge && !hasPlan ? [0, 0, 0] : planned(st.wt == null ? t : st.wt);
      const ne = S.sess && S.sess.next_event; let next = 'next event: --';
      if (ne && ne.start) { const left = ne.start - Math.floor((nowMs || Date.now()) / 1000); const ti = String(ne.title || 'next event').slice(0, 20); next = `${ti}  ${left > 0 ? '-' + hms(left) : 'now'}`; }
      const sp = stepAt(st.wt == null ? t : st.wt), rep = sp ? steps.indexOf(sp) : -1;
      const f = S.sess && S.sess.fuel, en = S.sess && S.sess.energy;
      const eaten = st.prompts.filter(p => p.state === 'eaten').length, passed = st.prompts.filter(p => p.state === 'eaten' || p.state === 'late' || p.state === 'missed').length;
      const nextP = st.prompts.find(p => p.state === 'due' || p.state === 'open');
      const easy = t >= 3600 && dec != null && !v && !/mountain|mtb/i.test(S.name) ? Math.round(S.lines.vt1_w * (1 - dec / 100)) : null;
      // energy: eat X after to hold the day's net (X = target + base burn + ride kcal - eaten)
      const eatAfter = en && en.day_target_net != null && en.base_burn != null ? Math.round((en.day_target_net + en.base_burn + st.kcal - (en.eaten_kcal || 0)) / 50) * 50 : null;
      return {
        name: S.name, time: S.time, started: st.started, running: st.running, timerS: t, power: st.w, hr: st.hr, cad: st.cad,
        colours: S.colours, lines: S.lines, done: st.done.slice(), plan: hasPlan ? plan.slice() : [0, 0, 0], due, lit: st.running ? zoneOf(st.w, st.hr) : -1,
        hrZone: zoneOf(null, st.hr), dec, decColour: decColour(dec), onPlan: st.plannedS > 0 ? Math.floor(st.onPlanS * 100 / st.plannedS) : null,
        next, sync: syncWord(), syncTrouble: st.started && st.lastCode && st.lastCode !== 200,
        vo2: v ? { rep: rep + 1, reps: steps.length, left: sp ? sp[0] + sp[1] - (st.wt || t) : 0, band: sp && sp[4] ? `${sp[3]}–${sp[4]}` : sp && sp[2] ? `${sp[2]} W` : 'easy', above: st.above, floor: v.hr_floor, goal: v.goal_min, reached: st.above >= v.goal_min[0] * 60 } : null,
        z1: z1Session() ? { cap: S.lines.vt1_hr - 1, over: st.over } : null,
        fuel: f ? { product: f.product, grams: f.grams, eaten, passed, total: st.prompts.length, marks: st.prompts.map(p => p.state), next: nextP ? { in: nextP.at - t, grams: nextP.grams, product: nextP.product, open: nextP.state === 'open' } : null } : null,
        tank: st.quick != null ? { quick: Math.round(st.quick / FULL_G * 100), legs: st.legs != null ? Math.round(st.legs / LEGS_FULL_G * 100) : null } : null,
        kcal: Math.round(st.kcal), eatAfter, target: en ? en.day_target_net : null, easy,
        pre: !st.started ? { recovery: S.sess && S.sess.recovery != null ? S.sess.recovery : null, eat: S.sess && S.sess.eat_before || null } : null,
        rating: st.rating ? { ask: st.rating.ask, presses: st.rating.presses } : null,
        alert: st.alerts.length ? st.alerts[st.alerts.length - 1] : null, page: st.page,
      };
    }
    setSession(S.sess);
    return { second, lap, stop, synced, model, setSession, page: n => { st.page = ((n % 2) + 2) % 2; }, get state() { return st; }, get steps() { return steps; } };
  }

  // ---- the screen: the field's onUpdate on a 480 x 800 canvas ----
  // Garmin's Edge 1050 fonts in pixels (condensed on the device, so a little smaller here): XTINY 22, SMALL 32, MEDIUM 40, LARGE 50, NUMBER_MILD 64, NUMBER_MEDIUM 86, NUMBER_HOT 112
  const FONT = { xtiny: 22, small: 32, medium: 40, large: 50, mild: 64, nmedium: 86, hot: 112 };
  const FAM = '"Roboto Condensed","Arial Narrow","Helvetica Neue",Arial,sans-serif';
  const font = (px, bold) => `${bold ? '700 ' : ''}${px}px ${FAM}`;
  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function text(c, s, x, y, px, col, align, base, bold) { c.font = font(px, bold); c.fillStyle = col; c.textAlign = align || 'left'; c.textBaseline = base || 'top'; c.fillText(s, x, y); }
  // one line that must fit: the size steps down until it does
  function textFit(c, s, x, y, px, col, align, maxW, bold) { let p = px; c.font = font(p, bold); while (p > 16 && c.measureText(s).width > maxW) { p -= 2; c.font = font(p, bold); } text(c, s, x, y, p, col, align, 'top', bold); }
  function fitPx(c, s, maxW, maxH) { for (const px of [FONT.hot, FONT.nmedium, FONT.mild, FONT.large, FONT.medium]) { c.font = font(px, true); if (c.measureText(s).width <= maxW && px * 1.05 <= maxH) return px; } return FONT.small; }
  function tile(c, x, y, tw, th, label, value, bar, bg) {
    let fg = INK, dim = DIM;
    if (bg) { c.fillStyle = bg; rrect(c, x + 3, y + 3, tw - 6, th - 6, 8); c.fill(); fg = dim = bg === DEC.red ? '#FFFFFF' : '#000000'; }
    text(c, label, x + 8, y + 2, FONT.xtiny, dim);
    const room = tw - 16 - (bar ? 14 : 0), lh = FONT.xtiny * 1.15, px = fitPx(c, value, room, th - lh - 4);
    text(c, value, x + 8 + room / 2, y + lh + (th - lh) / 2, px, fg, 'center', 'middle', true);
    if (bar) { c.fillStyle = bar; rrect(c, x + tw - 16, y + lh + 6, 10, th - lh - 14, 4); c.fill(); }
  }
  function buckets(c, m, top, bot, w) {
    const cols = [m.colours.low, m.colours.high, m.colours.peak], names = ['LOW', 'HIGH', 'PEAK'], ink = ['#000', '#000', '#FFF'];
    const planAll = m.plan[0] + m.plan[1] + m.plan[2], bw = Math.floor(w / 5), gap = (w - 3 * bw) / 4, hBar = bot - top, xh = FONT.xtiny * 1.15;
    for (let i = 0; i < 3; i++) {
      const x = gap + i * (bw + gap), cx = x + bw / 2;
      let full = m.plan[i]; if (full <= 0) full = planAll > m.timerS ? planAll : m.timerS; if (full <= 0) full = 1;
      if (i === m.lit) { c.fillStyle = cols[i]; rrect(c, x - 4, top - xh - 8, bw + 8, xh + 6, 4); c.fill(); text(c, names[i], cx, top - xh - 4, FONT.xtiny, ink[i], 'center', 'top', true); }
      else text(c, names[i], cx, top - xh - 4, FONT.xtiny, INK, 'center');
      const f = Math.min(hBar, m.done[i] * hBar / full);
      if (f > 0) { c.fillStyle = cols[i]; c.fillRect(x, bot - f, bw, f); }
      if (i === m.lit) { c.strokeStyle = cols[i]; c.lineWidth = 8; c.strokeRect(x - 4, top - 2, bw + 8, hBar + 4); }
      else { c.strokeStyle = DIM; c.lineWidth = 3; c.strokeRect(x, top, bw, hBar); }
      if (planAll > 0 && m.plan[i] > 0) { const dy = bot - m.due[i] * hBar / m.plan[i]; c.strokeStyle = INK; c.lineWidth = 4; c.beginPath(); c.moveTo(x - 8, dy); c.lineTo(x + bw + 8, dy); c.stroke(); }
      let big = mmss(m.done[i]), sub = '';
      if (planAll > 0 && m.plan[i] > 0) { const left = m.plan[i] - m.done[i]; if (left >= 0) { big = mmss(left); sub = 'left of ' + mmss(m.plan[i]); } else { big = '+' + mmss(-left); sub = 'over ' + mmss(m.plan[i]); } }
      else if (planAll > 0) sub = 'none planned';
      text(c, big, cx, bot + 4, FONT.small, INK, 'center', 'top', true);
      textFit(c, sub, cx, bot + 4 + FONT.small * 1.15, FONT.xtiny, DIM, 'center', bw + gap - 6);
    }
  }
  function line(c, x1, y1, x2, y2, col, w) { c.strokeStyle = col; c.lineWidth = w || 1; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  function tankBar(c, m, x, y, w) {
    text(c, 'fuel tank', x, y, FONT.xtiny, DIM);
    const by = y + FONT.xtiny * 1.3; c.strokeStyle = DIM; c.lineWidth = 2; c.strokeRect(x, by, w, 22);
    const q = Math.max(0, Math.min(100, m.tank.quick)); c.fillStyle = INK; c.fillRect(x, by, w * q / 100, 22);
    if (m.tank.legs != null) { const lx = x + w * Math.max(0, Math.min(100, m.tank.legs)) / 100; line(c, lx, by - 8, lx, by + 30, DIM, 4); }
    text(c, `quick ${q}%${m.tank.legs != null ? `   legs ${m.tank.legs}%` : ''}`, x, by + 30, FONT.xtiny, INK);
  }
  function draw(canvas, m) {
    const c = canvas.getContext('2d'), w = 480, h = 800;
    c.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    c.fillStyle = BG; c.fillRect(0, 0, w, h);
    const xh = FONT.xtiny * 1.15, sh = FONT.small * 1.15, mid = h / 2;
    if (m.pre) return drawPre(c, m, w, h);
    if (m.page === 1) return drawFuelPage(c, m, w, h);
    // top half: the session's name, then the three buckets
    text(c, m.name || 'The Way', w / 2, 4, FONT.xtiny, DIM, 'center');
    const barTop = 4 + xh + 4 + xh + 6, barBot = mid - sh - xh - 10;
    buckets(c, m, barTop, barBot, w);
    line(c, 10, mid, w - 10, mid, DIM, 1);
    const syncTop = h - xh - 4, nextTop = syncTop - sh - 2, rowH = (nextTop - mid - 4) / 3, tw = w / 2, y0 = mid + 4;
    if (m.vo2) {
      // VO2 mode: the rep and its time left, the target band, the minutes above the floor
      tile(c, 0, y0, tw, rowH, `rep ${m.vo2.rep} of ${m.vo2.reps}`, mmss(m.vo2.left));
      tile(c, tw, y0, tw, rowH, 'target', m.vo2.band);
      tile(c, 0, y0 + rowH, tw, rowH, 'heart', m.hr == null ? '--' : String(m.hr), m.hrZone >= 0 ? [m.colours.low, m.colours.high, m.colours.peak][m.hrZone] : null);
      tile(c, tw, y0 + rowH, tw, rowH, 'watts', m.power == null ? '--' : String(m.power));
      const s = `above ${m.vo2.floor}: ${mmss(m.vo2.above)} of ${m.vo2.goal[0]} to ${m.vo2.goal[1]}`;
      if (m.vo2.reached) { c.strokeStyle = INK; c.lineWidth = 6; rrect(c, 6, y0 + 2 * rowH + 6, w - 12, rowH - 12, 10); c.stroke(); }
      text(c, s, w / 2, y0 + 2 * rowH + rowH / 2, FONT.medium, INK, 'center', 'middle', true);
    } else {
      tile(c, 0, y0, tw, rowH, 'heart', m.hr == null ? '--' : String(m.hr), m.hrZone >= 0 ? [m.colours.low, m.colours.high, m.colours.peak][m.hrZone] : null);
      tile(c, tw, y0, tw, rowH, 'watts', m.power == null ? '--' : String(m.power));
      tile(c, 0, y0 + rowH, tw, rowH, 'decoupling %', m.dec == null ? '--' : m.dec.toFixed(1), null, m.decColour);
      tile(c, tw, y0 + rowH, tw, rowH, 'on plan %', m.onPlan == null ? '--' : String(m.onPlan));
      tile(c, 0, y0 + 2 * rowH, w, rowH, 'time', hms(m.timerS));
      if (m.z1 && m.z1.over > 0) text(c, `over ${m.z1.cap}: ${mmss(m.z1.over)}`, w - 10, y0 + 2 * rowH + 2, FONT.xtiny, INK, 'right');
      line(c, tw, y0 + 4, tw, y0 + 2 * rowH - 4, DIM, 1);
    }
    line(c, 10, y0 + rowH, w - 10, y0 + rowH, DIM, 1); line(c, 10, y0 + 2 * rowH, w - 10, y0 + 2 * rowH, DIM, 1); line(c, 10, y0 + 3 * rowH, w - 10, y0 + 3 * rowH, DIM, 1);
    textFit(c, m.next, w / 2, nextTop, FONT.small, INK, 'center', w - 20);
    textFit(c, m.sync, w / 2, syncTop, FONT.xtiny, m.syncTrouble ? INK : DIM, 'center', w - 20);
    drawAlert(c, m, w, h);
  }
  // the second data screen, "The Way · Fuel & Time": fuel prompts, the tank, the energy line, the easy line
  function drawFuelPage(c, m, w, h) {
    text(c, 'The Way · Fuel & Time', w / 2, 4, FONT.xtiny, DIM, 'center');
    let y = 50;
    if (m.fuel) {
      text(c, 'fuel', 16, y, FONT.xtiny, DIM); y += 30;
      text(c, m.fuel.next ? (m.fuel.next.open ? `NOW: ${m.fuel.next.product} ${m.fuel.next.grams} g` : `${m.fuel.next.product} ${m.fuel.next.grams} g in ${mmss(m.fuel.next.in)}`) : 'no more prompts', 16, y, FONT.medium, INK, 'left', 'top', true); y += 52;
      text(c, `${m.fuel.eaten}/${m.fuel.passed} on time · ${m.fuel.total} planned`, 16, y, FONT.small, INK); y += 44;
      m.fuel.marks.forEach((s, i) => { const cx = 30 + i * 34; c.beginPath(); c.arc(cx, y + 12, 11, 0, Math.PI * 2); if (s === 'eaten' || s === 'late') { c.fillStyle = INK; c.fill(); } else { c.strokeStyle = s === 'due' ? DIM : INK; c.lineWidth = 3; c.stroke(); } });
      y += 44; text(c, 'press LAP when you eat', 16, y, FONT.xtiny, DIM); y += 44;
    } else { text(c, 'fuel: water only', 16, y, FONT.small, INK); y += 56; }
    line(c, 10, y, w - 10, y, DIM, 1); y += 12;
    if (m.tank) { tankBar(c, m, 16, y, w - 32); y += 110; } else { text(c, 'fuel tank: --', 16, y, FONT.small, DIM); y += 50; }
    line(c, 10, y, w - 10, y, DIM, 1); y += 12;
    text(c, 'ride kcal', 16, y, FONT.xtiny, DIM); text(c, String(m.kcal), 16, y + 28, FONT.mild, INK, 'left', 'top', true); y += 104;
    const k = v => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('en-US')}`;
    if (m.eatAfter != null) { textFit(c, m.eatAfter > 0 ? `eat ~${k(m.eatAfter)} more today to hold ${k(m.target)}` : `the day is covered at ${k(m.target)}`, 16, y, FONT.small, INK, 'left', w - 32); y += 48; }
    if (m.easy != null) { textFit(c, `easy line ≈ ${m.easy} W (estimate)`, 16, y, FONT.small, INK, 'left', w - 32); y += 48; }
    if (m.z1) { text(c, `over ${m.z1.cap}: ${mmss(m.z1.over)}`, 16, y, FONT.small, INK); y += 48; }
    const xh = FONT.xtiny * 1.15, syncTop = h - xh - 4, nextTop = syncTop - FONT.small * 1.15 - 2;
    textFit(c, m.next, w / 2, nextTop, FONT.small, INK, 'center', w - 20);
    textFit(c, m.sync, w / 2, syncTop, FONT.xtiny, DIM, 'center', w - 20);
    drawAlert(c, m, w, h);
  }
  // the pre-ride screen: the session and its time, recovery, the tank, what to eat before
  function drawPre(c, m, w, h) {
    text(c, 'The Way', w / 2, 8, FONT.xtiny, DIM, 'center');
    text(c, m.name || 'Free ride', w / 2, 60, FONT.medium, INK, 'center', 'top', true);
    if (m.time) text(c, m.time, w / 2, 112, FONT.small, DIM, 'center');
    let y = 190;
    if (m.pre.recovery != null) { text(c, 'recovery', 24, y, FONT.xtiny, DIM); text(c, `${m.pre.recovery}%`, 24, y + 28, FONT.mild, INK, 'left', 'top', true); y += 110; }
    if (m.tank) { tankBar(c, m, 24, y, w - 48); y += 120; }
    if (m.pre.eat) { text(c, 'eat before', 24, y, FONT.xtiny, DIM); y += 30; wrap(c, m.pre.eat, 24, y, w - 48, FONT.small); y += 120; }
    text(c, 'press ▶ to start', w / 2, h - 60, FONT.small, INK, 'center');
  }
  function wrap(c, s, x, y, maxW, px) { c.font = font(px); const words = String(s).split(/\s+/); let ln = ''; for (const wd of words) { const t = ln ? ln + ' ' + wd : wd; if (c.measureText(t).width > maxW && ln) { text(c, ln, x, y, px, INK); y += px * 1.2; ln = wd; } else ln = t; } if (ln) text(c, ln, x, y, px, INK); }
  // Edge alerts: a white box across the middle with heavy ink (weight and vibration, never a new colour)
  function drawAlert(c, m, w, h) {
    if (!m.alert && !m.rating) return;
    const s = m.rating ? `${m.rating.ask === 'legs' ? 'Legs' : 'Breathing'}? press lap 1 to 5${m.rating.presses ? `  (${m.rating.presses})` : ''}` : m.alert.text;
    c.fillStyle = '#FFFFFF'; rrect(c, 16, h / 2 - 90, w - 32, 180, 16); c.fill();
    c.strokeStyle = '#000'; c.lineWidth = 6; rrect(c, 24, h / 2 - 82, w - 48, 164, 12); c.stroke();
    c.font = font(FONT.medium, true); const lines = []; let ln = '';
    for (const wd of s.split(' ')) { const t = ln ? ln + ' ' + wd : wd; if (c.measureText(t).width > w - 80 && ln) { lines.push(ln); ln = wd; } else ln = t; } lines.push(ln);
    lines.forEach((l, i) => text(c, l, w / 2, h / 2 - (lines.length - 1) * 24 + i * 48, FONT.medium, '#000', 'center', 'middle', true));
  }

  // the device: a drawn Edge 1050 around the canvas, with the lap and start buttons and two page dots
  function deviceHTML(id) {
    // the 1050's shape and buttons (a 480 x 800 portrait screen in a deep bezel, power on the left side, lap and
    // start/stop on the bottom edge), without the maker's name: it is The Way's screen, not a copy of the product
    return `<div class="edge1050" id="${id}"><button class="e-btn e-pwr" type="button" aria-label="Power" tabindex="-1"></button><div class="e-body"><div class="e-glass"><canvas class="e-screen" width="480" height="800" aria-label="The Way field, as on the Edge 1050"></canvas></div><div class="e-chin"><div class="e-dots"><i class="on"></i><i></i></div><span class="e-word">THE WAY</span></div></div><div class="e-bottom"><button class="e-btn e-lap" type="button" aria-label="Lap">LAP</button><button class="e-btn e-start" type="button" aria-label="Start or stop">&#9654;&#10074;&#10074;</button></div></div>`;
  }

  const api = { create, draw, deviceHTML, decoupling, decColour, stepsOf, mmss, hms, DEC, FONT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Edge = api;
})(typeof window !== 'undefined' ? window : this);
