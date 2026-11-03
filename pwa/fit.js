"use strict";
/* THE WAY — a small FIT encoder for the workout player (docs/workout-player-spec.md).
   It writes one indoor ride as a FIT activity file in the browser, so the ride goes to
   intervals.icu exactly as a Garmin file would:
     header (14 bytes, its own CRC) · definition + data messages · file CRC
   Messages: file_id (activity, manufacturer "development"), event (timer start / stop),
   record (one per second: time, heart rate, cadence, power, speed, distance), one lap per
   workout interval, session (cycling, indoor cycling, totals), activity.
   FIT time is seconds since 1989-12-31 00:00 UTC (unix − 631065600). A missing value is
   written as the type's "invalid" (0xFF, 0xFFFF, 0xFFFFFFFF).
   Loads as a browser global (window.FIT) and as a Node module (bridge/player.test.js). */
(function(root){
  const FIT_EPOCH = 631065600;
  // base types: [code, bytes, invalid]
  const ENUM = [0x00, 1, 0xFF], U8 = [0x02, 1, 0xFF], U16 = [0x84, 2, 0xFFFF], U32 = [0x86, 4, 0xFFFFFFFF], U32Z = [0x8C, 4, 0x00000000], S32 = [0x85, 4, 0x7FFFFFFF];
  // the messages this file writes, by FIT profile number: [name, field number, base type]
  const MSG = {
    file_id:  { num: 0,  fields: [["type", 0, ENUM], ["manufacturer", 1, U16], ["product", 2, U16], ["serial_number", 3, U32Z], ["time_created", 4, U32]] },
    event:    { num: 21, fields: [["timestamp", 253, U32], ["event", 0, ENUM], ["event_type", 1, ENUM], ["event_group", 4, U8]] },
    record:   { num: 20, fields: [["timestamp", 253, U32], ["heart_rate", 3, U8], ["cadence", 4, U8], ["power", 7, U16], ["speed", 6, U16], ["distance", 5, U32]] },
    lap:      { num: 19, fields: [["message_index", 254, U16], ["timestamp", 253, U32], ["event", 0, ENUM], ["event_type", 1, ENUM], ["start_time", 2, U32],
                ["total_elapsed_time", 7, U32], ["total_timer_time", 8, U32], ["total_distance", 9, U32], ["avg_heart_rate", 15, U8], ["max_heart_rate", 16, U8],
                ["avg_cadence", 17, U8], ["avg_power", 19, U16], ["max_power", 20, U16], ["lap_trigger", 24, ENUM], ["sport", 25, ENUM], ["sub_sport", 39, ENUM]] },
    session:  { num: 18, fields: [["message_index", 254, U16], ["timestamp", 253, U32], ["event", 0, ENUM], ["event_type", 1, ENUM], ["start_time", 2, U32],
                ["sport", 5, ENUM], ["sub_sport", 6, ENUM], ["total_elapsed_time", 7, U32], ["total_timer_time", 8, U32], ["total_distance", 9, U32],
                ["total_calories", 11, U16], ["avg_heart_rate", 16, U8], ["max_heart_rate", 17, U8], ["avg_cadence", 18, U8], ["avg_power", 20, U16], ["max_power", 21, U16],
                ["first_lap_index", 25, U16], ["num_laps", 26, U16], ["trigger", 28, ENUM], ["normalized_power", 34, U16], ["training_stress_score", 35, U16],
                ["intensity_factor", 36, U16], ["threshold_power", 45, U16]] },
    activity: { num: 34, fields: [["timestamp", 253, U32], ["total_timer_time", 0, U32], ["num_sessions", 1, U16], ["type", 2, ENUM], ["event", 3, ENUM], ["event_type", 4, ENUM], ["local_timestamp", 5, U32]] }
  };
  const EVENT = { timer: 0, session: 8, lap: 9, activity: 26 }, EVENT_TYPE = { start: 0, stop: 1, stop_all: 4 };

  const CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
  function crc16(bytes, from, to, start){
    let crc = start || 0;
    for (let i = from || 0; i < (to == null ? bytes.length : to); i++){
      const b = bytes[i];
      let t = CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ CRC_TABLE[b & 0xF];
      t = CRC_TABLE[crc & 0xF]; crc = (crc >> 4) & 0x0FFF; crc = crc ^ t ^ CRC_TABLE[(b >> 4) & 0xF];
    }
    return crc;
  }

  // a growing little-endian byte buffer
  function Buf(){ this.a = new Uint8Array(4096); this.n = 0; }
  Buf.prototype.room = function(k){ if (this.n + k <= this.a.length) return; const b = new Uint8Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; };
  Buf.prototype.u8 = function(v){ this.room(1); this.a[this.n++] = v & 0xFF; };
  Buf.prototype.u16 = function(v){ this.u8(v); this.u8(v >>> 8); };
  Buf.prototype.u32 = function(v){ this.u16(v & 0xFFFF); this.u16((v >>> 16) & 0xFFFF); };
  Buf.prototype.bytes = function(){ return this.a.slice(0, this.n); };

  // a value as its base type allows: rounded, clamped below the invalid marker; missing -> invalid
  function put(buf, type, v){
    const [code, size, invalid] = type;
    let x = v == null || !Number.isFinite(+v) ? invalid : Math.round(+v);
    if (x !== invalid){
      if (code === 0x85) x = Math.max(-0x7FFFFFFF, Math.min(0x7FFFFFFE, x)) >>> 0;
      else x = Math.max(code === 0x8C ? 1 : 0, Math.min(invalid === 0 ? 0xFFFFFFFF : invalid - 1, x));
    }
    if (size === 1) buf.u8(x); else if (size === 2) buf.u16(x); else buf.u32(x);
  }

  function Writer(){ this.buf = new Buf(); this.local = {}; this.nextLocal = 0; this.counts = {}; }
  Writer.prototype.write = function(name, values){
    const m = MSG[name];
    let lt = this.local[name];
    if (lt == null){
      lt = this.local[name] = this.nextLocal++;
      const b = this.buf;
      b.u8(0x40 | lt); b.u8(0); b.u8(0);            // definition header, reserved, little-endian
      b.u16(m.num); b.u8(m.fields.length);
      for (const [, num, type] of m.fields){ b.u8(num); b.u8(type[1]); b.u8(type[0]); }
    }
    this.buf.u8(lt);
    for (const [key, , type] of m.fields) put(this.buf, type, values[key]);
    this.counts[name] = (this.counts[name] || 0) + 1;
  };
  Writer.prototype.finish = function(){
    const data = this.buf.bytes();
    const out = new Uint8Array(14 + data.length + 2);
    const dv = new DataView(out.buffer);
    out[0] = 14; out[1] = 0x20;                       // header size, protocol 2.0
    dv.setUint16(2, 2132, true);                      // profile 21.32
    dv.setUint32(4, data.length, true);
    out[8] = 0x2E; out[9] = 0x46; out[10] = 0x49; out[11] = 0x54;   // ".FIT"
    dv.setUint16(12, crc16(out, 0, 12), true);
    out.set(data, 14);
    dv.setUint16(14 + data.length, crc16(out, 0, 14 + data.length), true);
    return out;
  };

  const fitTime = ms => Math.round(ms / 1000) - FIT_EPOCH;
  // normalised power: the 30 s rolling mean, to the fourth power, averaged, fourth root
  function np(ws){
    if (ws.length < 30) return null;
    let roll = 0, acc = 0, n = 0; const q = [];
    for (const w of ws){ roll += w; q.push(w); if (q.length > 30) roll -= q.shift(); if (q.length === 30){ acc += Math.pow(roll / 30, 4); n++; } }
    return n ? Math.round(Math.pow(acc / n, 0.25)) : null;
  }
  function stats(rows){
    const pw = rows.map(r => r.power).filter(v => v != null && v >= 0);
    const hr = rows.map(r => r.hr).filter(v => v != null && v > 30);
    const cad = rows.map(r => r.cadence).filter(v => v != null && v > 0);
    const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    return { avg_power: avg(pw), max_power: pw.length ? Math.max(...pw) : null, avg_hr: avg(hr), max_hr: hr.length ? Math.max(...hr) : null,
      avg_cadence: avg(cad), np: np(pw), kj: pw.reduce((a, b) => a + b, 0) / 1000 };
  }

  /* o: { startMs, samples:[{t (ms), power, cadence, hr, speed (km/h), i (interval index)}], pauses:[[stopMs, resumeMs]], ftp, tzOffsetS }
     Returns { bytes: Uint8Array, summary }. */
  function buildActivity(o){
    const rows = (o.samples || []).filter(s => s && Number.isFinite(s.t)).slice().sort((a, b) => a.t - b.t);
    if (!rows.length) throw new Error("no samples to save");
    const w = new Writer();
    const t0 = rows[0].t, tEnd = rows[rows.length - 1].t;
    w.write("file_id", { type: 4, manufacturer: 255, product: 1, serial_number: Math.floor((o.startMs || t0) / 1000) % 0xFFFFFFFF || 1, time_created: fitTime(o.startMs || t0) });
    w.write("event", { timestamp: fitTime(t0), event: EVENT.timer, event_type: EVENT_TYPE.start, event_group: 0 });
    // the records, with the timer stopping and starting around each pause
    const pauses = (o.pauses || []).filter(p => p && p[0] >= t0 && p[0] <= tEnd).sort((a, b) => a[0] - b[0]);
    let pi = 0, dist = 0;
    for (const r of rows){
      while (pi < pauses.length && pauses[pi][1] != null && pauses[pi][1] <= r.t){
        w.write("event", { timestamp: fitTime(pauses[pi][0]), event: EVENT.timer, event_type: EVENT_TYPE.stop_all, event_group: 0 });
        w.write("event", { timestamp: fitTime(pauses[pi][1]), event: EVENT.timer, event_type: EVENT_TYPE.start, event_group: 0 });
        pi++;
      }
      const mps = r.speed != null && r.speed >= 0 ? r.speed / 3.6 : null;
      if (mps != null) dist += mps;                   // one second at this speed
      r.dist = dist;
      w.write("record", { timestamp: fitTime(r.t), heart_rate: r.hr > 0 ? r.hr : null, cadence: r.cadence, power: r.power,
        speed: mps == null ? null : mps * 1000, distance: dist * 100 });
    }
    w.write("event", { timestamp: fitTime(tEnd), event: EVENT.timer, event_type: EVENT_TYPE.stop_all, event_group: 0 });
    // one lap per workout interval: a run of samples with the same interval index
    const groups = [];
    for (const r of rows){ const g = groups[groups.length - 1]; if (g && g.i === (r.i == null ? -1 : r.i)) g.rows.push(r); else groups.push({ i: r.i == null ? -1 : r.i, rows: [r] }); }
    groups.forEach((g, k) => {
      const a = g.rows[0], z = g.rows[g.rows.length - 1], s = stats(g.rows);
      const prevDist = k ? groups[k - 1].rows[groups[k - 1].rows.length - 1].dist : 0;
      w.write("lap", { message_index: k, timestamp: fitTime(z.t), event: EVENT.lap, event_type: EVENT_TYPE.stop, start_time: fitTime(a.t),
        total_elapsed_time: (z.t - a.t + 1000), total_timer_time: g.rows.length * 1000, total_distance: (z.dist - prevDist) * 100,
        avg_heart_rate: s.avg_hr, max_heart_rate: s.max_hr, avg_cadence: s.avg_cadence, avg_power: s.avg_power, max_power: s.max_power,
        lap_trigger: k === groups.length - 1 ? 7 : 0, sport: 2, sub_sport: 6 });
    });
    const s = stats(rows), timer = rows.length, elapsed = Math.round((tEnd - t0) / 1000) + 1;
    const ftp = o.ftp || 175, IF = s.np ? s.np / ftp : null;
    const summary = { start_ms: t0, end_ms: tEnd, seconds: timer, elapsed_s: elapsed, distance_m: Math.round(dist),
      avg_w: s.avg_power != null ? Math.round(s.avg_power) : null, np_w: s.np, max_w: s.max_power,
      avg_hr: s.avg_hr != null ? Math.round(s.avg_hr) : null, max_hr: s.max_hr, avg_cad: s.avg_cadence != null ? Math.round(s.avg_cadence) : null,
      kj: Math.round(s.kj), laps: groups.length, ftp, tss: IF ? Math.round(timer / 3600 * IF * IF * 100) : null, if: IF ? Math.round(IF * 100) / 100 : null };
    w.write("session", { message_index: 0, timestamp: fitTime(tEnd), event: EVENT.session, event_type: EVENT_TYPE.stop, start_time: fitTime(t0),
      sport: 2, sub_sport: 6, total_elapsed_time: elapsed * 1000, total_timer_time: timer * 1000, total_distance: dist * 100,
      total_calories: s.kj, avg_heart_rate: s.avg_hr, max_heart_rate: s.max_hr, avg_cadence: s.avg_cadence, avg_power: s.avg_power, max_power: s.max_power,
      first_lap_index: 0, num_laps: groups.length, trigger: 0, normalized_power: s.np,
      training_stress_score: summary.tss != null ? summary.tss * 10 : null, intensity_factor: IF ? IF * 1000 : null, threshold_power: ftp });
    const tzs = o.tzOffsetS != null ? o.tzOffsetS : (typeof Date === "function" ? -new Date(tEnd).getTimezoneOffset() * 60 : 0);
    w.write("activity", { timestamp: fitTime(tEnd), total_timer_time: timer * 1000, num_sessions: 1, type: 0, event: EVENT.activity, event_type: EVENT_TYPE.stop, local_timestamp: fitTime(tEnd) + tzs });
    return { bytes: w.finish(), summary, counts: w.counts };
  }

  function toBase64(u8){
    if (typeof Buffer !== "undefined" && typeof window === "undefined") return Buffer.from(u8).toString("base64");
    let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  const FIT = { buildActivity, toBase64, crc16, FIT_EPOCH, MSG };
  if (typeof module !== "undefined" && module.exports) module.exports = FIT; else root.FIT = FIT;
})(typeof window !== "undefined" ? window : this);
