// node bridge/player.test.js — the workout player: the FIT encoder (pwa/fit.js) read back by a decoder
// written here, the workout as the player rides it, and a player ride as the Calendar counts it.
const assert = require('assert');
const FIT = require('../pwa/fit.js');
const P = require('./player');
const { playerRideAsDone, dedupeRides, gradeOne } = require('./workouts');

let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

// ---- a minimal FIT reader: enough to check what the encoder wrote ----
function readFit(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const hs = u8[0], dataSize = dv.getUint32(4, true);
  const out = { headerSize: hs, protocol: u8[1], profile: dv.getUint16(2, true), dataSize, magic: String.fromCharCode(u8[8], u8[9], u8[10], u8[11]),
    headerCrcOk: FIT.crc16(u8, 0, 12) === dv.getUint16(12, true), fileCrcOk: FIT.crc16(u8, 0, hs + dataSize) === dv.getUint16(hs + dataSize, true),
    wholeCrcZero: FIT.crc16(u8, 0, u8.length) === 0, messages: [] };
  const defs = {};
  let i = hs; const end = hs + dataSize;
  while (i < end) {
    const h = u8[i++];
    assert.strictEqual(h & 0x80, 0, 'no compressed timestamps are written');
    const lt = h & 0x0F;
    if (h & 0x40) {
      i++; const arch = u8[i++]; assert.strictEqual(arch, 0, 'little-endian');
      const num = dv.getUint16(i, true); i += 2; const nf = u8[i++]; const fields = [];
      for (let k = 0; k < nf; k++) { fields.push({ num: u8[i], size: u8[i + 1], type: u8[i + 2] }); i += 3; }
      defs[lt] = { num, fields };
    } else {
      const d = defs[lt]; assert.ok(d, 'data before its definition');
      const m = { num: d.num, f: {} };
      for (const f of d.fields) {
        const v = f.size === 1 ? u8[i] : f.size === 2 ? dv.getUint16(i, true) : dv.getUint32(i, true);
        const invalid = f.size === 1 ? 0xFF : f.size === 2 ? 0xFFFF : (f.type === 0x8C ? 0 : 0xFFFFFFFF);
        m.f[f.num] = v === invalid ? null : v; i += f.size;
      }
      out.messages.push(m);
    }
  }
  assert.strictEqual(i, end, 'messages end where the header says');
  return out;
}

// a fake 10-minute ride: three intervals, a 20 s pause, one HR dropout
function fakeRide() {
  const t0 = Date.UTC(2026, 10, 3, 12, 0, 0), samples = [];
  let t = t0;
  for (let s = 0; s < 600; s++) {
    if (s === 300) t += 20000;                               // the pause
    const i = s < 120 ? 0 : s < 480 ? 1 : 2;
    samples.push({ t, power: i === 1 ? 200 + (s % 3) : 120, cadence: 88, hr: s === 50 ? null : 100 + Math.min(40, Math.round(s / 10)), speed: 30, i });
    t += 1000;
  }
  return { startMs: t0, samples, pauses: [[t0 + 300000, t0 + 320000]], ftp: 175, tzOffsetS: -5 * 3600 };
}

ok('fit: header, both CRCs, a record a second, a lap an interval, the session as indoor cycling', () => {
  const r = FIT.buildActivity(fakeRide());
  const f = readFit(r.bytes);
  assert.strictEqual(f.headerSize, 14); assert.strictEqual(f.magic, '.FIT'); assert.strictEqual(f.protocol, 0x20);
  assert.ok(f.headerCrcOk, 'header CRC'); assert.ok(f.fileCrcOk, 'file CRC'); assert.ok(f.wholeCrcZero);
  assert.strictEqual(r.bytes.length, 14 + f.dataSize + 2);
  const by = num => f.messages.filter(m => m.num === num);
  assert.strictEqual(by(20).length, 600, 'records');
  assert.strictEqual(by(19).length, 3, 'laps');
  assert.strictEqual(by(0)[0].f[0], 4); assert.strictEqual(by(0)[0].f[1], 255);
  const ses = by(18)[0];
  assert.strictEqual(ses.f[5], 2); assert.strictEqual(ses.f[6], 6);
  assert.strictEqual(ses.f[8], 600 * 1000, 'timer time leaves out the pause');
  assert.strictEqual(ses.f[7], 620 * 1000, 'elapsed time keeps it');
  assert.strictEqual(ses.f[17], 140); assert.strictEqual(ses.f[21], 202);
  assert.strictEqual(ses.f[26], 3);
  // timer start, stop and start around the pause, the last stop: four timer events
  const ev = by(21); assert.strictEqual(ev.length, 4); assert.deepStrictEqual(ev.map(e => e.f[1]), [0, 4, 0, 4]);
  // the first record's time is FIT time (unix - 631065600), its speed in mm/s, the dropout invalid
  const rec = by(20);
  assert.strictEqual(rec[0].f[253], Date.UTC(2026, 10, 3, 12) / 1000 - 631065600);
  assert.strictEqual(rec[0].f[6], Math.round(30 / 3.6 * 1000));
  assert.strictEqual(rec[50].f[3], null);
  assert.strictEqual(by(34).length, 1); assert.strictEqual(by(34)[0].f[1], 1);
  assert.strictEqual(r.summary.seconds, 600); assert.strictEqual(r.summary.laps, 3);
});

ok('expand: repeats laid out in order, % of FTP as watts at 175, HR and free steps with no watts', () => {
  const steps = [
    { kind: 'step', label: 'Warm up', dur_s: 600, target: { type: 'ramp', from: 50, to: 70 } },
    { kind: 'repeat', label: '40/20', count: 3, steps: [{ label: 'On', dur_s: 40, target: { type: 'power', lo: 130, hi: 130 } }, { label: 'Off', dur_s: 20, target: { type: 'power', lo: 50, hi: 50 } }] },
    { kind: 'step', label: '', dur_s: 1200, target: { type: 'hr', lo: 100, hi: 116 } },
    { kind: 'step', label: '', dur_s: 300, target: { type: 'free' } }
  ];
  const x = P.expand(steps, { ftp: 175 });
  assert.strictEqual(x.length, 1 + 6 + 2);
  assert.deepStrictEqual([x[0].target_w, x[0].target_w_end, x[0].kind], [88, 122, 'ramp']);
  assert.deepStrictEqual([x[1].label, x[1].target_w, x[1].start_s, x[1].rep], ['On', 228, 600, '1 of 3']);
  assert.strictEqual(x[2].target_w, 88); assert.strictEqual(x[6].rep, '3 of 3');
  assert.strictEqual(x[7].target_w, null); assert.deepStrictEqual(x[7].target_hr, { lo: 100, hi: 116 }); assert.strictEqual(x[7].start_s, 600 + 180);
  assert.strictEqual(x[8].kind, 'free'); assert.strictEqual(x[8].label, 'Ride by feel');
});

ok('fuel: the "before" meal ahead of this ride and its bottle, not the evening ride\'s', () => {
  const meals = [{ slot: 'breakfast', time: '07:30' }, { slot: 'before', time: '10:30', what: 'Banana', carbs_g: 30 }, { slot: 'on the bike', time: '12:00', what: 'Bottle', carbs_g: 40 },
    { slot: 'before', time: '16:30', what: 'Toast' }, { slot: 'on the bike', time: '18:00', what: 'Bottle 2' }];
  assert.deepStrictEqual(P.fuelSlots(meals, '12:00').map(m => m.what), ['Banana', 'Bottle']);
  assert.strictEqual(P.fuelSlots(meals, null).length, 4);
});

ok('a player ride on the Calendar: the Strava shape, load from NP at FTP 175, Zone 1 minutes from the strap', () => {
  const ride = fakeRide();
  const S = P.cleanSamples({ t: ride.samples.map((s, k) => k), p: ride.samples.map(s => s.power), c: ride.samples.map(s => s.cadence),
    h: ride.samples.map(s => s.hr), s: ride.samples.map(s => s.speed), i: ride.samples.map(s => s.i) });
  const sum = P.summarize({ start_ms: ride.startMs, name: 'Zone 1, 10 min', workout_id: 'w_abc', ftp: 175 }, S);
  assert.strictEqual(sum.id, ride.startMs); assert.strictEqual(sum.date, '2026-11-03'); assert.strictEqual(sum.time, '07:00');   // noon UTC is 7:00a Eastern
  assert.strictEqual(sum.seconds, 600); assert.strictEqual(sum.max_hr, 140);
  const r = playerRideAsDone(Object.assign({}, sum, { intervals_id: 'i99' }), { ftp: 175, lthr: 139, hr_rest: 55 });
  assert.strictEqual(r.type, 'VirtualRide'); assert.strictEqual(r.source, 'player'); assert.strictEqual(r.device_watts, true);
  assert.strictEqual(r.minutes, 10); assert.strictEqual(r.np_w, sum.np_w); assert.ok(r.avg_w > 150 && r.avg_w < 170);
  assert.strictEqual(r.tss, Math.round(600 / 3600 * Math.pow(sum.np_w / 175, 2) * 100)); assert.strictEqual(r.tss_basis, 'power');
  assert.strictEqual(r.avg_hr, sum.avg_hr); assert.strictEqual(r.max_hr, 140); assert.strictEqual(r.workout_id, 'w_abc');
  // the analysis the Calendar reads: heart rate 116 and under is Zone 1 (the zone function rides.js uses)
  const a = P.analysisOf(sum, S, 175);
  assert.strictEqual(a.hr.seconds, 599);
  const under = S.h.filter(v => v != null && v <= 116).length;
  assert.strictEqual(a.hr.zone_pct.z1, Math.round(under / 599 * 100));
  assert.ok(a.power && a.power.np > 0); assert.ok(a.sources.hr.includes('player'));
  // a Garmin copy of the same ride with no power folds into the player's
  const twin = { id: 1, date: r.date, time: '07:01', name: 'Indoor Cycling', type: 'VirtualRide', minutes: 10, avg_w: null, avg_hr: 120 };
  const kept = dedupeRides([twin, r]);
  assert.strictEqual(kept.length, 1); assert.strictEqual(kept[0].source, 'player'); assert.strictEqual(kept[0].twin.id, 1);
  // graded against its planned session as any ride is
  const g = gradeOne({ name: 'Zone 1, 10 min', metrics: { duration_s: 600, tss: r.tss } }, [Object.assign({}, r, { analysis: { hr: a.hr } })]);
  assert.strictEqual(g.compliance.pct, 100);
});

console.log(n + ' passed');
