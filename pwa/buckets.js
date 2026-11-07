"use strict";
/* THE WAY — the magic buckets (Xert-style): three bars that fill as he rides, against what the day's
   workout plans for each. One rule set for the whole site: the bridge (bridge/buckets.js wraps this file
   and adds the stored thresholds), the workout player and the site's pages all read this file; the Garmin
   field gets the same lines and colours from /garmin/session/today.

     LOW   blue  #0099FF   power under VT1 (169 W)      heart rate under 117
     HIGH  amber #FFAA00   power VT1 to under VT2       117 to 138
     PEAK  red   #E00000   power at VT2 (208 W) or up   139 or up
   The lines are Tymewear's of 14 Aug 2026 (VT1 169 W at 117 bpm, VT2 208 W at 139 bpm) until a newer
   test is entered in the thresholds store.

   Power decides when there is a reading (0 W coasting is LOW); heart rate only when there is none.
   A plan's step goes to one bucket by its target watts (a % of the planning FTP, 175, at the middle of
   its range), a heart-rate step by the middle of its band; a free step fills no bucket.
   Loads as a browser global (window.Buckets) and as a Node module. */
(function(root){
  const LINES = Object.freeze({ vt1_w: 169, vt2_w: 208, vt1_hr: 117, vt2_hr: 139 });
  const COLOURS = Object.freeze({ low: '#0099FF', high: '#FFAA00', peak: '#E00000' });
  const KEYS = ['low', 'high', 'peak'];
  const LABELS = { low: 'LOW', high: 'HIGH', peak: 'PEAK' };
  const PLANNING_FTP = 175;

  const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const linesOf = L => Object.assign({}, LINES, L || {});

  // 0 LOW, 1 HIGH, 2 PEAK, or null when there is neither a power reading nor a heart rate
  function bucketOf(x, lines) {
    const L = linesOf(lines);
    const w = num(x && (x.w != null ? x.w : x.p != null ? x.p : x.power));
    if (w != null && w >= 0) return w < L.vt1_w ? 0 : w < L.vt2_w ? 1 : 2;
    const hr = num(x && (x.hr != null ? x.hr : x.h != null ? x.h : x.heart_rate));
    if (hr != null && hr > 30) return hr < L.vt1_hr ? 0 : hr < L.vt2_hr ? 1 : 2;
    return null;
  }

  // ---- the plan ----
  // A step's bucket: target watts by the middle of its range (% of FTP), a ramp by the middle of from and
  // to, absolute watts by their middle, a heart-rate band by its middle; a free step has none.
  function stepBucket(t, ftp, lines) {
    if (!t) return null;
    const F = ftp || PLANNING_FTP;
    if (t.type === 'power') return bucketOf({ w: Math.round((num(t.lo) + num(t.hi == null ? t.lo : t.hi)) / 2 / 100 * F) }, lines);
    if (t.type === 'ramp') return bucketOf({ w: Math.round((num(t.from) + num(t.to)) / 2 / 100 * F) }, lines);
    if (t.type === 'watts') return bucketOf({ w: Math.round((num(t.lo) + num(t.hi == null ? t.lo : t.hi)) / 2) }, lines);
    if (t.type === 'hr') return bucketOf({ hr: Math.round((num(t.lo) + num(t.hi == null ? t.lo : t.hi)) / 2) }, lines);
    return null;
  }
  // the timeline of a plan as segments { start, dur, b }; accepts the workout's steps (with repeats), the
  // player's expanded intervals ({ start_s, dur_s, target_w, target_w_end, target_hr, kind }), or the
  // Garmin field's arrays ([start_s, dur_s, target_w, hr_lo, hr_hi])
  function segmentsOf(steps, ftp, lines) {
    const out = []; let t = 0;
    const push = (dur, b) => { const d = Math.max(0, Math.round(num(dur) || 0)); out.push({ start: t, dur: d, b }); t += d; };
    for (const it of Array.isArray(steps) ? steps : []) {
      if (!it) continue;
      if (Array.isArray(it)) {
        const w = num(it[2]), lo = num(it[3]), hi = num(it[4]);
        push(it[1], w > 0 ? bucketOf({ w }, lines) : hi > 0 ? bucketOf({ hr: Math.round((lo + hi) / 2) }, lines) : null);
      } else if (it.kind === 'repeat') {
        const n = Math.max(1, Math.round(num(it.count) || 1));
        for (let k = 0; k < n; k++) for (const s of it.steps || []) push(s.dur_s, stepBucket(s.target, ftp, lines));
      } else if (it.target) push(it.dur_s, stepBucket(it.target, ftp, lines));
      else if (it.start_s != null || it.target_w !== undefined || it.target_hr !== undefined) {
        const w = num(it.target_w), we = num(it.target_w_end);
        const b = w != null ? bucketOf({ w: Math.round(we != null ? (w + we) / 2 : w) }, lines)
          : it.target_hr && num(it.target_hr.hi) ? bucketOf({ hr: Math.round((num(it.target_hr.lo) + num(it.target_hr.hi)) / 2) }, lines) : null;
        push(it.dur_s, b);
      } else push(it.dur_s, null);
    }
    return out;
  }
  // { low, high, peak } in seconds, the total, whether there is a plan at all, and dueAt(t): how much of
  // each bucket the plan has reached by t seconds into the ride (the due marker on each bar)
  function planFromSteps(steps, ftp, lines) {
    const segs = segmentsOf(steps, ftp || PLANNING_FTP, lines);
    const p = { low: 0, high: 0, peak: 0 };
    for (const s of segs) if (s.b != null) p[KEYS[s.b]] += s.dur;
    p.total = p.low + p.high + p.peak;
    p.planned = p.total > 0;
    p.dueAt = t => {
      const d = { low: 0, high: 0, peak: 0 }, T = Math.max(0, num(t) || 0);
      for (const s of segs) { if (s.b == null || s.start >= T) continue; d[KEYS[s.b]] += Math.min(s.dur, T - s.start); }
      return d;
    };
    return p;
  }
  const planOf = p => p ? { low: p.low, high: p.high, peak: p.peak } : null;

  // ---- the ride ----
  // seconds in each bucket from 1 Hz samples: [{ w, hr }] (or { p, h }), the player's store columns
  // { p: [], h: [] }, or Strava / intervals.icu streams { watts: [], heartrate: [] }
  function actualFromSamples(samples, lines) {
    const a = { low: 0, high: 0, peak: 0 };
    const add = (w, hr) => { const b = bucketOf({ w, hr }, lines); if (b != null) a[KEYS[b]]++; };
    if (Array.isArray(samples)) for (const s of samples) add(s && (s.w != null ? s.w : s.p), s && (s.hr != null ? s.hr : s.h));
    else if (samples && typeof samples === 'object') {
      const P = samples.watts || samples.p || [], H = samples.heartrate || samples.h || [];
      const n = Math.max(P.length || 0, H.length || 0);
      for (let i = 0; i < n; i++) add(P[i], H[i]);
    }
    a.total = a.low + a.high + a.peak;
    return a;
  }

  const api = { LINES, COLOURS, KEYS, LABELS, PLANNING_FTP, bucketOf, stepBucket, segmentsOf, planFromSteps, planOf, actualFromSamples, linesOf };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Buckets = api;
})(typeof window !== 'undefined' ? window : this);
