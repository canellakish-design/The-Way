// node bridge/course.test.js — course mode: reading GPX and FIT courses, the course the player rides, the speed,
// what the trainer is sent, and the course ride saved as a virtual ride.
const assert = require('assert');
const C = require('../pwa/course');
const FIT = require('../pwa/fit');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok ' + name); };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what || ''} ${a} not within ${tol} of ${b}`);

// a straight test road north from a point: 2 km flat, 2 km at 8 %, 1 km down at 6 %
function road(){
  const pts = []; const lat0 = 44.1, lon0 = 5.2, mPerDegLat = 111195;
  let ele = 300;
  for (let d = 0; d <= 5000; d += 25){
    if (d > 0){ ele += d <= 2000 ? 0 : d <= 4000 ? 25 * 0.08 : -25 * 0.06; }
    pts.push({ lat: lat0 + d / mPerDegLat, lon: lon0, ele });
  }
  return pts;
}
const gpxOf = (pts, name, tag) => `<?xml version="1.0"?><gpx version="1.1" creator="test"><${tag === 'rtept' ? 'rte' : 'trk'}><name>${name}</name>${tag === 'rtept' ? '' : '<trkseg>'}` +
  pts.map(p => `<${tag || 'trkpt'} lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${p.ele.toFixed(1)}</ele></${tag || 'trkpt'}>`).join('') + `${tag === 'rtept' ? '' : '</trkseg>'}</${tag === 'rtept' ? 'rte' : 'trk'}></gpx>`;

// A FIT course file written here, field by field (as Garmin Connect and Ride with GPS write theirs): file_id, course
// (name), then records with position (semicircles), altitude (scale 5, offset 500) and distance (scale 100).
function fitCourse(pts, name, bigEndian){
  const bytes = []; const u8 = v => bytes.push(v & 0xFF);
  const put = (v, size) => { const b = []; for (let k = 0; k < size; k++) b.push((v >>> (8 * k)) & 0xFF); (bigEndian ? b.reverse() : b).forEach(u8); };
  const def = (lt, num, fields) => { u8(0x40 | lt); u8(0); u8(bigEndian ? 1 : 0); put(num, 2); u8(fields.length); for (const [f, s, t] of fields){ u8(f); u8(s); u8(t); } };
  def(0, 0, [[0, 1, 0x00]]); u8(0); u8(6);                         // file_id: type 6 = course
  const nm = Buffer.from(name + '\0'); def(1, 31, [[5, nm.length, 0x07]]); u8(1); nm.forEach(u8);
  def(2, 20, [[0, 4, 0x85], [1, 4, 0x85], [2, 2, 0x84], [5, 4, 0x86]]);
  let dist = 0;
  pts.forEach((p, k) => { if (k) dist += C.haversine(pts[k - 1], p); u8(2); put(Math.round(p.lat / 180 * 2147483648) >>> 0, 4); put(Math.round(p.lon / 180 * 2147483648) >>> 0, 4); put(Math.round((p.ele + 500) * 5), 2); put(Math.round(dist * 100), 4); });
  const data = Uint8Array.from(bytes), out = new Uint8Array(14 + data.length + 2), dv = new DataView(out.buffer);
  out[0] = 14; out[1] = 0x20; dv.setUint16(2, 2132, true); dv.setUint32(4, data.length, true); out.set([0x2E, 0x46, 0x49, 0x54], 8);
  dv.setUint16(12, FIT.crc16(out, 0, 12), true); out.set(data, 14); dv.setUint16(14 + data.length, FIT.crc16(out, 0, 14 + data.length), true);
  return out;
}

ok('a GPX track: name, distance, climbing, the heights smoothed', () => {
  const c = C.read('ventoux.gpx', gpxOf(road(), 'Test road &amp; hill'));
  assert.strictEqual(c.name, 'Test road & hill');
  near(c.dist_m, 5000, 15, 'distance');
  near(c.ascent_m, 160, 6, 'climbing');          // 2 km at 8 %
  near(c.descent_m, 60, 6, 'descent');           // 1 km at 6 %
  assert.strictEqual(c.d[1] - c.d[0], 10, 'every 10 m');
});
ok('a GPX route (rtept) reads the same as a track', () => {
  const a = C.read('r.gpx', gpxOf(road(), 'Route', 'rtept')), b = C.read('t.gpx', gpxOf(road(), 'Route'));
  assert.strictEqual(a.dist_m, b.dist_m); assert.strictEqual(a.ascent_m, b.ascent_m);
});
ok('a FIT course, little-endian and big-endian: name, positions, heights, the file\'s own distance', () => {
  for (const be of [false, true]){
    const c = C.read('Mont Ventoux.fit', fitCourse(road(), 'Ventoux FIT', be));
    assert.strictEqual(c.name, 'Ventoux FIT'); near(c.dist_m, 5000, 15, 'distance'); near(c.ascent_m, 160, 6, 'climbing');
    near(c.lat[0], 44.1, 1e-6, 'lat'); near(c.lon[0], 5.2, 1e-6, 'lon');
  }
});
ok('files that cannot be ridden say why', () => {
  assert.throws(() => C.read('x.gpx', '<gpx></gpx>'), /no track or route points/);
  assert.throws(() => C.read('x.gpx', gpxOf(road().map(p => ({ lat: p.lat, lon: p.lon, ele: NaN })), 'flat').replace(/<ele>NaN<\/ele>/g, '')), /no heights/);
  assert.throws(() => C.read('x.fit', new Uint8Array(20)), /not a FIT file/);
});
ok('the grade at a point, the grade ahead, the next change, the climbing left', () => {
  const c = C.read('t.gpx', gpxOf(road(), 'Road'));
  near(C.gradeAt(c, 1000), 0, 0.2, 'flat'); near(C.gradeAt(c, 3000), 8, 0.3, 'climb'); near(C.gradeAt(c, 4500), -6, 0.3, 'descent');
  const nx = C.nextChange(c, 1000); assert.ok(nx && nx.at_m > 700 && nx.at_m < 1100 && nx.grade > 4, JSON.stringify(nx));
  near(C.climbLeft(c, 0), 160, 6, 'all to climb'); near(C.climbLeft(c, 4100), 0, 2, 'over the top');
  near(C.headingAt(c, 2500), 0, 1, 'heading north');
});
ok('the trainer gets the grade times the difficulty, held between the descent cap and the max grade', () => {
  assert.strictEqual(C.trainerGrade(8, { difficulty: 50 }), 4);          // an 8 % climb feels like 4 %
  assert.strictEqual(C.trainerGrade(8, { difficulty: 100 }), 8);
  assert.strictEqual(C.trainerGrade(25, { difficulty: 100 }), 10);       // max grade +10 %
  assert.strictEqual(C.trainerGrade(25, { difficulty: 100, max_grade: 6 }), 6);
  assert.strictEqual(C.trainerGrade(-14, { difficulty: 100 }), -5);      // descent cap about −5 %
  assert.strictEqual(C.trainerGrade(-6, { difficulty: 50 }), -3);
  assert.strictEqual(C.trainerGrade(8), 4, 'the defaults: 50 %, +10 %, −5 %');
});
ok('the FTMS simulation command: op code 0x11, wind 0, grade in 0.01 %, Crr 0.004, Cw 0.51', () => {
  assert.deepStrictEqual(Array.from(C.simBytes(0)), [0x11, 0, 0, 0, 0, 40, 51]);   // the player's flat road, byte for byte
  assert.deepStrictEqual(Array.from(C.simBytes(4)), [0x11, 0, 0, 0x90, 0x01, 40, 51]);   // 400 = 0x0190
  assert.deepStrictEqual(Array.from(C.simBytes(-5)), [0x11, 0, 0, 0x0C, 0xFE, 40, 51]);  // −500, two's complement
});
ok('the speed at 106 kg: about right on the flat and up a 8 % climb, faster when lighter, faster downhill', () => {
  const flat = C.steadySpeed(200, 0, 0) * 3.6, climb = C.steadySpeed(200, 8, 1000) * 3.6;
  assert.ok(flat > 30 && flat < 37, 'flat at 200 W: ' + flat.toFixed(1));
  assert.ok(climb > 7.5 && climb < 10, '8 % at 200 W: ' + climb.toFixed(1));
  assert.ok(C.steadySpeed(200, 8, 1000, { mass_kg: 80 }) > C.steadySpeed(200, 8, 1000));
  assert.ok(C.steadySpeed(0, -6, 1000) * 3.6 > 40, 'coasting a 6 % descent');
  assert.strictEqual(C.speedStep(0, 0, 0, 0, null, 1), 0, 'no power on the flat: still');
});
ok('a ride along the course: the distance grows, the grade is sent when it changes (or every 10 s), the end is found', () => {
  const c = C.read('t.gpx', gpxOf(road(), 'Road'));
  let st = { v: 0, x: 0, t: 0 }, sends = 0, sentOnClimb = null;
  for (let s = 0; s < 3600 && !st.done; s++){ st = Object.assign(st, C.second(c, st, 220, { difficulty: 50 })); if (st.send){ sends++; if (st.x > 3000 && st.x < 3500 && sentOnClimb == null) sentOnClimb = st.sent; } }
  assert.ok(st.done, 'reached the end'); near(st.x, c.dist_m, 0.5);
  near(sentOnClimb, 4, 0.3, 'the climb sent at half');
  assert.ok(sends < st.t / 3, 'not a command every second on a steady road: ' + sends + ' in ' + st.t);
});
ok('a course ride saved as a virtual ride: the course\'s distance and heights, the climbing, no positions', () => {
  const c = C.read('t.gpx', gpxOf(road(), 'Road')); const t0 = Date.UTC(2026, 10, 27, 15);
  let st = { v: 0, x: 0, t: 0 }; const samples = [];
  for (let s = 0; s < 1500 && !st.done; s++){ st = Object.assign(st, C.second(c, st, 220)); samples.push({ t: t0 + s * 1000, power: 220, cadence: 88, hr: 120, speed: st.v * 3.6, i: 0, dist_m: st.x, alt_m: st.alt }); }
  const f = FIT.buildActivity({ startMs: t0, samples, ftp: 175, virtual: true });
  near(f.summary.distance_m, Math.round(st.x), 1, 'distance'); assert.strictEqual(f.summary.virtual, true);
  near(f.summary.ascent_m, c.ascent_m, 6, 'climbing');
  const b = f.bytes; const sub = []; for (let k = 0; k < b.length - 1; k++) if (b[k] === 58) sub.push(k);
  assert.ok(sub.length > 0, 'sub sport 58 written');
  // read it back with the course reader's FIT parser: it has no positions, so no course in it
  assert.throws(() => C.parseFIT(b), /no points with a position/);
  // an ordinary ride is still indoor cycling, with no altitude
  const g = FIT.buildActivity({ startMs: t0, samples: samples.map(x => ({ t: x.t, power: x.power, cadence: x.cadence, hr: x.hr, speed: x.speed, i: 0 })), ftp: 175 });
  assert.strictEqual(g.summary.virtual, false); assert.strictEqual(g.summary.ascent_m, null);
});
ok('the made-up test course: from Bédoin to the summit, over 20 km, about 1,600 m of climbing, marked as made up', () => {
  const c = C.build(C.testCourse());
  assert.ok(/made up/.test(c.name)); assert.ok(c.dist_m > 20000, c.dist_m);
  near(c.ele[0], 300, 15); assert.ok(c.ascent_m > 1450 && c.ascent_m < 1750, c.ascent_m);
});
ok('the difficulty never changes the time: the same power over the same course, 50 % or 100 %, gives the same distance', () => {
  const c = C.read('t.gpx', gpxOf(road(), 'Road'));
  const run = diff => { let st = { v: 0, x: 0, t: 0 }; for (let s = 0; s < 900; s++) st = Object.assign(st, C.second(c, st, 230, { difficulty: diff })); return st; };
  const a = run(50), b = run(100);
  assert.strictEqual(a.x, b.x, 'same distance'); assert.notStrictEqual(a.sent, b.sent, 'only the trainer grade differs');
});
ok('the physics defaults: 98.4 kg rider + 8 kg bike, CdA 0.36, Crr 0.004; a lower CdA is faster on the flat', () => {
  assert.strictEqual(C.DEFAULTS.mass_kg, 106.4); assert.strictEqual(C.DEFAULTS.cda, 0.36); assert.strictEqual(C.DEFAULTS.crr, 0.004);
  assert.ok(C.steadySpeed(200, 0, 0, { cda: 0.30 }) > C.steadySpeed(200, 0, 0));
});
console.log(`${n} passed`);
