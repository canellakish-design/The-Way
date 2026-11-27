"use strict";
/* THE WAY — riding a course on the trainer (Harry, 26 Nov 2026). The arithmetic of course mode, with no page in it,
   so the tests can run it in Node and the player runs it in the browser:
     - reading a course: GPX (track or route points) or a FIT course file (record messages), into points
     - the course the player rides: points every 10 m, the height smoothed, distance, climbing, the grade at any metre,
       the way the road points at any metre (for the arrow)
     - the speed: from his power, rider (98.4 kg) plus bike (8 kg), CdA 0.36, Crr 0.004, the TRUE (smoothed) grade, no
       drafting, no wind. The difficulty never enters it: it changes how the trainer feels, not his time
     - what the trainer is sent: the grade times the difficulty (50 % by default), held between the descent cap (about
       −5 %) and the max grade (+10 %), as an FTMS Indoor Bike Simulation command (op code 0x11)
   Course mode follows the gradient only: heart rate, power and cadence are shown and kept, never fed back into the
   trainer. The GPS points are used to measure the course and draw it on the map; the saved ride carries no GPS track.
   Loads as a browser global (window.Course) and as a Node module (bridge/course.test.js). */
(function(root){
  const STEP_M = 10;                       // the course is resampled every 10 m
  const SMOOTH_M = 100;                    // the height is averaged over 100 m (GPS heights are noisy)
  const GRADE_M = 40;                      // the grade at a point: the smoothed rise over 40 m around it
  const DEFAULTS = { mass_kg: 106.4, difficulty: 50, max_grade: 10, descent_cap: -5, crr: 0.004, cda: 0.36, drivetrain: 0.97 };   // 98.4 kg rider + 8 kg bike

  // ---------- reading files ----------
  const R = 6371008.8, rad = x => x * Math.PI / 180;
  function haversine(a, b){
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b){
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // GPX: <trkpt> (a recorded or exported track) or <rtept> (a route), each with lat, lon and <ele>. Plain text parsing,
  // so it runs the same in Node and the browser.
  function parseGPX(text){
    const s = String(text || "");
    const name = (/<(?:trk|rte|metadata)>[\s\S]*?<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i.exec(s) || /<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/i.exec(s) || [])[1];
    const pts = [];
    const re = /<(trkpt|rtept)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gi; let m;
    while ((m = re.exec(s))){
      const attr = m[2], body = m[4] || "";
      const lat = +((/\blat\s*=\s*["']([-\d.eE+]+)["']/.exec(attr) || [])[1]), lon = +((/\blon\s*=\s*["']([-\d.eE+]+)["']/.exec(attr) || [])[1]);
      const eleM = /<ele>\s*([-\d.eE+]+)\s*<\/ele>/i.exec(body);
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon, ele: eleM ? +eleM[1] : null });
    }
    if (pts.length < 2) throw new Error("no track or route points in this GPX file");
    return { name: name ? decodeXML(name.trim()) : null, points: pts };
  }
  const decodeXML = t => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (x, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");

  // FIT course (or activity) file: the record messages (20) give the points; course (31) field 5 gives the name.
  // A small reader: normal and compressed-timestamp headers, either byte order, developer fields skipped.
  function parseFIT(buf){
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const hsize = u8[0];
    if (u8.length < 12 || String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== ".FIT") throw new Error("not a FIT file");
    const end = Math.min(u8.length, hsize + dv.getUint32(4, true));
    const defs = {}; const pts = []; let name = null; let i = hsize;
    const SEMI = 180 / 2147483648;
    while (i < end){
      const h = u8[i++];
      if (h & 0x80){ const lt = (h >> 5) & 3; const d = defs[lt]; if (!d) throw new Error("FIT: data before its definition"); i = readData(d, i); continue; }
      const lt = h & 0x0F;
      if (h & 0x40){
        const little = u8[i + 1] === 0, num = little ? dv.getUint16(i + 2, true) : dv.getUint16(i + 2, false), nf = u8[i + 4];
        let j = i + 5; const fields = [];
        for (let k = 0; k < nf; k++){ fields.push({ num: u8[j], size: u8[j + 1], type: u8[j + 2] & 0x1F }); j += 3; }
        let devSize = 0;
        if (h & 0x20){ const nd = u8[j]; j++; for (let k = 0; k < nd; k++){ devSize += u8[j + 1]; j += 3; } }
        defs[lt] = { little, num, fields, devSize }; i = j;
      } else { const d = defs[lt]; if (!d) throw new Error("FIT: data before its definition"); i = readData(d, i); }
    }
    function readData(d, at){
      let j = at; const v = {};
      for (const f of d.fields){
        if (d.num === 20 && (f.num === 0 || f.num === 1) && f.size === 4){ const x = dv.getInt32(j, d.little); if (x !== 0x7FFFFFFF) v[f.num] = x * SEMI; }
        else if (d.num === 20 && f.num === 2 && f.size === 2){ const x = dv.getUint16(j, d.little); if (x !== 0xFFFF) v.alt = x / 5 - 500; }
        else if (d.num === 20 && f.num === 78 && f.size === 4){ const x = dv.getUint32(j, d.little); if (x !== 0xFFFFFFFF) v.ealt = x / 5 - 500; }
        else if (d.num === 20 && f.num === 5 && f.size === 4){ const x = dv.getUint32(j, d.little); if (x !== 0xFFFFFFFF) v.dist = x / 100; }
        else if ((d.num === 31 && f.num === 5) || (d.num === 0 && f.num === 8)){ let s = ""; for (let k = 0; k < f.size && u8[j + k]; k++) s += String.fromCharCode(u8[j + k]); try{ s = decodeURIComponent(escape(s)); }catch{} if (s && (d.num === 31 || !name)) name = s; }
        j += f.size;
      }
      j += d.devSize;
      if (d.num === 20 && v[0] != null && v[1] != null) pts.push({ lat: v[0], lon: v[1], ele: v.ealt != null ? v.ealt : v.alt != null ? v.alt : null, dist: v.dist != null ? v.dist : null });
      return j;
    }
    if (pts.length < 2) throw new Error("no points with a position in this FIT file");
    return { name, points: pts };
  }

  // ---------- the course the player rides ----------
  // points -> { name, dist_m, ascent_m, descent_m, d:[], ele:[], lat:[], lon:[] } every 10 m, with the height smoothed
  function build(parsed, fallbackName){
    const P = parsed.points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (P.length < 2) throw new Error("the course needs at least two points");
    if (!P.some(p => Number.isFinite(p.ele))) throw new Error("this course has no heights, so it has no hills to ride");
    // distance along the course: the file's own when it has it all the way, else measured point to point
    let cum = [0];
    const fileDist = P.every(p => Number.isFinite(p.dist)) && P[P.length - 1].dist > 0;
    for (let k = 1; k < P.length; k++) cum.push(fileDist ? P[k].dist - P[0].dist : cum[k - 1] + haversine(P[k - 1], P[k]));
    // fill missing heights from the neighbours
    const ele = P.map(p => Number.isFinite(p.ele) ? p.ele : null);
    for (let k = 0; k < ele.length; k++) if (ele[k] == null){ let a = k - 1, b = k + 1; while (a >= 0 && ele[a] == null) a--; while (b < ele.length && ele[b] == null) b++; ele[k] = a < 0 ? ele[b] : b >= ele.length ? ele[a] : ele[a] + (ele[b] - ele[a]) * (cum[k] - cum[a]) / ((cum[b] - cum[a]) || 1); }
    const total = cum[cum.length - 1];
    if (!(total > 50)) throw new Error("the course is too short to ride");
    // resample every 10 m
    const n = Math.floor(total / STEP_M) + 1, d = [], e = [], lat = [], lon = [];
    let k = 0;
    for (let s = 0; s < n; s++){
      const at = Math.min(total, s * STEP_M);
      while (k < cum.length - 2 && cum[k + 1] < at) k++;
      const f = cum[k + 1] > cum[k] ? (at - cum[k]) / (cum[k + 1] - cum[k]) : 0;
      d.push(at); e.push(ele[k] + (ele[k + 1] - ele[k]) * f); lat.push(P[k].lat + (P[k + 1].lat - P[k].lat) * f); lon.push(P[k].lon + (P[k + 1].lon - P[k].lon) * f);
    }
    if (d[d.length - 1] < total){ d.push(total); e.push(ele[ele.length - 1]); lat.push(P[P.length - 1].lat); lon.push(P[P.length - 1].lon); }
    // smooth the height: a moving average over 100 m
    const half = Math.round(SMOOTH_M / STEP_M / 2), sm = [];
    for (let s = 0; s < e.length; s++){ let a = 0, c = 0; for (let j = Math.max(0, s - half); j <= Math.min(e.length - 1, s + half); j++){ a += e[j]; c++; } sm.push(a / c); }
    let up = 0, down = 0;
    for (let s = 1; s < sm.length; s++){ const x = sm[s] - sm[s - 1]; if (x > 0) up += x; else down -= x; }
    return { name: (parsed.name || fallbackName || "Course").slice(0, 80), dist_m: Math.round(total), ascent_m: Math.round(up), descent_m: Math.round(down),
      ele_min: Math.round(Math.min(...sm)), ele_max: Math.round(Math.max(...sm)), d, ele: sm.map(x => Math.round(x * 10) / 10), lat, lon };
  }
  function read(nameOrNull, data){
    // data: a string (GPX) or bytes (FIT); the file name picks the reader when it can
    const isFit = data instanceof ArrayBuffer || data instanceof Uint8Array || /\.fit$/i.test(nameOrNull || "");
    const base = String(nameOrNull || "").replace(/\.(gpx|fit)$/i, "").replace(/[_-]+/g, " ").trim();
    if (isFit) return build(parseFIT(data instanceof ArrayBuffer || data instanceof Uint8Array ? data : new TextEncoder().encode(data)), base);
    return build(parseGPX(typeof data === "string" ? data : new TextDecoder().decode(data)), base);
  }

  // the index just before distance x, and the fraction toward the next point
  function locate(C, x){
    const dd = Math.max(0, Math.min(C.dist_m, x));
    let k = Math.min(C.d.length - 2, Math.floor(dd / STEP_M));
    while (k > 0 && C.d[k] > dd) k--;
    while (k < C.d.length - 2 && C.d[k + 1] < dd) k++;
    const f = C.d[k + 1] > C.d[k] ? (dd - C.d[k]) / (C.d[k + 1] - C.d[k]) : 0;
    return { k, f };
  }
  const lerp = (arr, L) => arr[L.k] + (arr[L.k + 1] - arr[L.k]) * L.f;
  const eleAt = (C, x) => lerp(C.ele, locate(C, x));
  const posAt = (C, x) => { const L = locate(C, x); return { lat: lerp(C.lat, L), lon: lerp(C.lon, L) }; };
  // the real grade in percent at x: the smoothed rise over 40 m around it
  function gradeAt(C, x){
    const a = Math.max(0, x - GRADE_M / 2), b = Math.min(C.dist_m, x + GRADE_M / 2);
    if (b - a < 1) return 0;
    return (eleAt(C, b) - eleAt(C, a)) / (b - a) * 100;
  }
  // the average grade over a stretch ahead
  const gradeOver = (C, from, len) => { const b = Math.min(C.dist_m, from + len); return b - from < 1 ? 0 : (eleAt(C, b) - eleAt(C, from)) / (b - from) * 100; };
  // the way the road points at x, from the next 30 m (so the arrow doesn't jitter on a noisy point)
  function headingAt(C, x){
    const a = posAt(C, Math.max(0, Math.min(x, C.dist_m - 30))), b = posAt(C, Math.min(C.dist_m, Math.max(x, 0) + 30));
    return bearing(a, b);
  }
  // climbing still to come from x
  function climbLeft(C, x){
    const L = locate(C, x); let up = 0, prev = eleAt(C, x);
    for (let s = L.k + 1; s < C.ele.length; s++){ const y = C.ele[s]; if (y > prev) up += y - prev; prev = y; }
    return up;
  }
  // the next change of grade: the first 100 m stretch ahead that differs from the road now by 2 % or more; it starts
  // about the middle of that stretch, and what it becomes is the 300 m after it
  function nextChange(C, x){
    const now = gradeOver(C, x, 100);
    for (let s = x + 50; s < C.dist_m - 50; s += 25){
      if (Math.abs(gradeOver(C, s, 100) - now) >= 2) return { at_m: Math.round(s + 50 - x), grade: Math.round(gradeOver(C, s + 100, 300) * 10) / 10 };
    }
    return null;
  }

  // ---------- the speed: his power moves him along the course ----------
  // P_wheel = drivetrain × P. Forces: gravity and rolling on the grade, the air (density falls with height).
  // m dv/dt = P_wheel / v − F, worked in tenths of a second. Uses the real grade, not the trainer's (as Zwift does:
  // the difficulty changes how the climb feels, not how fast it goes).
  function airDensity(alt){ return 1.225 * Math.exp(-Math.max(0, alt || 0) / 8500); }
  function speedStep(v, watts, gradePct, alt, o, dt){
    const q = Object.assign({}, DEFAULTS, o || {}), m = q.mass_kg, g = 9.80665, th = Math.atan((gradePct || 0) / 100);
    const P = Math.max(0, watts || 0) * q.drivetrain, rho = airDensity(alt);
    let x = Math.max(0, v || 0); const n = Math.max(1, Math.round((dt || 1) / 0.1)), h = (dt || 1) / n;
    for (let s = 0; s < n; s++){
      const F = m * g * (Math.sin(th) + q.crr * Math.cos(th)) + 0.5 * rho * q.cda * x * x * Math.sign(x || 1);
      const drive = P / Math.max(x, 1.0);
      x = x + (drive - F) / (m + 1.2) * h;      // + the wheels' spin
      if (x < 0) x = 0;
      if (x > 25) x = 25;                       // 90 km/h, the most a descent gives
    }
    return x;
  }
  // the steady speed at a power on a grade (for the tests and the start screen's estimate)
  function steadySpeed(watts, gradePct, alt, o){ let v = 5; for (let s = 0; s < 400; s++) v = speedStep(v, watts, gradePct, alt, o, 1); return v; }

  // ---------- the trainer ----------
  // the grade the trainer is sent: the real grade × difficulty, held between the descent cap and the max grade
  function trainerGrade(realPct, o){
    const q = Object.assign({}, DEFAULTS, o || {});
    const x = (realPct || 0) * Math.max(0, Math.min(100, q.difficulty)) / 100;
    return Math.round(Math.max(q.descent_cap, Math.min(q.max_grade, x)) * 100) / 100;
  }
  // FTMS Set Indoor Bike Simulation (0x11): wind speed sint16 (0.001 m/s), grade sint16 (0.01 %), Crr uint8 (0.0001),
  // wind resistance coefficient uint8 (0.01 kg/m). The same Crr 0.004 and Cw 0.51 as the player's flat road.
  function simBytes(gradePct, o){
    const q = Object.assign({ wind: 0, crr: 0.004, cw: 0.51 }, o || {});
    const b = new Uint8Array(7), dv = new DataView(b.buffer);
    b[0] = 0x11;
    dv.setInt16(1, Math.round(q.wind * 1000), true);
    dv.setInt16(3, Math.max(-32768, Math.min(32767, Math.round(gradePct * 100))), true);
    b[5] = Math.max(0, Math.min(255, Math.round(q.crr * 10000)));
    b[6] = Math.max(0, Math.min(255, Math.round(q.cw * 100)));
    return b;
  }

  // ---------- one second of a course ride ----------
  // state { v (m/s), x (m along), sent (grade last sent), sentAt (s) }; returns what changed and whether to send
  function second(C, st, watts, o){
    const real = gradeAt(C, st.x), alt = eleAt(C, st.x);
    const v = speedStep(st.v, watts, real, alt, o, 1);
    const x = Math.min(C.dist_m, st.x + (st.v + v) / 2);
    const done = x >= C.dist_m;
    const tg = done ? 0 : trainerGrade(gradeAt(C, x), o);
    const t = (st.t || 0) + 1;
    const send = st.sent == null || Math.abs(tg - st.sent) >= 0.1 || t - (st.sentAt || 0) >= 10;
    return { v, x, t, real: Math.round(real * 10) / 10, trainer: tg, alt: eleAt(C, x), done, send, sent: send ? tg : st.sent, sentAt: send ? t : st.sentAt };
  }

  // the profile as an SVG path (distance across, height up), for the page and the tests
  function profilePath(C, w, h, pad){
    const p = pad || 0, lo = C.ele_min - 10, hi = C.ele_max + 10, X = d => p + (w - 2 * p) * d / C.dist_m, Y = y => h - p - (h - 2 * p) * (y - lo) / ((hi - lo) || 1);
    const step = Math.max(1, Math.floor(C.d.length / 600));
    let s = `M${X(0).toFixed(1)},${(h - p).toFixed(1)}`;
    for (let k = 0; k < C.d.length; k += step) s += `L${X(C.d[k]).toFixed(1)},${Y(C.ele[k]).toFixed(1)}`;
    s += `L${X(C.dist_m).toFixed(1)},${Y(C.ele[C.ele.length - 1]).toFixed(1)}L${X(C.dist_m).toFixed(1)},${(h - p).toFixed(1)}Z`;
    return { path: s, X, Y };
  }

  // A made-up test course shaped like Mont Ventoux from Bédoin, until Harry sends his own GPX: it starts at Bédoin
  // and ends at the summit (their real positions) but the road between is invented (zigzags), as are the heights
  // (a steady climb, steeper in the forest, gentler near the top). Not the real climb: only for testing.
  function testCourse(){
    const A = { lat: 44.1244, lon: 5.1797 }, B = { lat: 44.1741, lon: 5.2786 };
    const pts = [], N = 220, total = 21000;
    for (let k = 0; k <= N; k++){
      const f = k / N;
      const zig = Math.sin(f * Math.PI * 11) * 0.012 * (f > 0.25 ? 1 : 0.3);
      const lat = A.lat + (B.lat - A.lat) * f + zig, lon = A.lon + (B.lon - A.lon) * f - zig * 0.6;
      const d = f * total;
      const g = d < 5500 ? 0.045 : d < 15500 ? 0.092 : 0.075;   // per metre
      pts.push({ lat, lon, d, g });
    }
    let ele = 300; const out = [];
    for (let k = 0; k <= N; k++){ if (k) ele += (pts[k].d - pts[k - 1].d) * pts[k].g; out.push({ lat: pts[k].lat, lon: pts[k].lon, ele: Math.round(ele * 10) / 10 }); }
    return { name: "Test course (Ventoux-like, made up)", points: out };
  }

  const Course = { DEFAULTS, STEP_M, parseGPX, parseFIT, build, read, locate, eleAt, posAt, gradeAt, gradeOver, headingAt, climbLeft, nextChange,
    speedStep, steadySpeed, trainerGrade, simBytes, second, profilePath, testCourse, haversine, bearing, airDensity };
  if (typeof module !== "undefined" && module.exports) module.exports = Course; else root.Course = Course;
})(typeof window !== "undefined" ? window : this);
