// The workouts the player rides, read from intervals.icu (26 Nov 2026: Harry plans there now, from Claude; The Way
// is only the player). Today's planned rides come from the intervals.icu calendar (events, category WORKOUT) with
// their structured steps (workout_doc), and each becomes the player's own shape (bridge/workout-math.js normItems).
//
// The watts follow The Way's planning FTP (175 unless Harry changes it on the player), never the FTP stored in
// intervals.icu: a step given as % of FTP is kept as a percentage and the player works out the watts. A step given in
// watts stays in watts. Heart rate given in bpm stays in bpm; % of LTHR or of max HR is worked out from the planning
// LTHR (139) and max HR (162). A zone with no number of its own takes the bpm or watts intervals.icu resolved.
// The finished ride goes back with the event's id (paired_event_id), so intervals.icu marks the plan done.
const tz = require('./tz');

const MAX_HR = 162;
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const BASE = envStr('INTERVALS_ICU_BASE') || 'https://intervals.icu/api/v1';
const isRideType = t => !/weight|strength|run|walk|hike|swim|yoga|workout$/i.test(String(t || 'Ride')) || /ride|cycl|bike/i.test(String(t || ''));

const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const pair = v => { if (!v || typeof v !== 'object') return null; const lo = num(v.start != null ? v.start : v.value), hi = num(v.end != null ? v.end : v.value); return lo == null && hi == null ? null : { lo: lo != null ? lo : hi, hi: hi != null ? hi : lo }; };

// one intervals.icu step to the player's target
function targetOf(s, st) {
  if (s.freeride) return { type: 'free' };
  const p = s.power && typeof s.power === 'object' ? s.power : null, pr = pair(s._power);
  if (p) {
    const u = String(p.units || '%ftp').toLowerCase(), v = pair(p);
    if (v && (u === '%ftp' || u === 'ftp')) return s.ramp && v.lo !== v.hi ? { type: 'ramp', from: Math.round(v.lo), to: Math.round(v.hi) } : { type: 'power', lo: Math.round(v.lo), hi: Math.round(v.hi) };
    if (v && (u === 'w' || u === 'watts')) return { type: 'watts', lo: Math.round(v.lo), hi: Math.round(v.hi) };
    if (pr) return { type: 'watts', lo: Math.round(pr.lo), hi: Math.round(pr.hi) };   // a power zone: the watts intervals.icu worked out
  }
  const h = s.hr && typeof s.hr === 'object' ? s.hr : null, hrr = pair(s._hr);
  if (h) {
    const u = String(h.units || '').toLowerCase(), v = pair(h);
    if (v && u === 'bpm') return { type: 'hr', lo: Math.round(v.lo), hi: Math.round(v.hi) };
    if (v && u === '%lthr') return { type: 'hr', lo: Math.round(v.lo / 100 * st.lthr), hi: Math.round(v.hi / 100 * st.lthr) };
    if (v && u === '%hr') return { type: 'hr', lo: Math.round(v.lo / 100 * MAX_HR), hi: Math.round(v.hi / 100 * MAX_HR) };
    if (hrr) return { type: 'hr', lo: Math.round(hrr.lo), hi: Math.round(hrr.hi) };
  }
  return { type: 'free' };
}
const cadenceOf = s => { const c = pair(s.cadence); return c ? { lo: Math.round(c.lo), hi: Math.round(c.hi) } : null; };
const labelOf = s => String(s.text || (s.warmup ? 'Warm-up' : s.cooldown ? 'Cool-down' : '')).slice(0, 60);

// intervals.icu's steps to the player's items: a step, or a repeat holding steps (a repeat inside a repeat is
// written out, since the player has one level)
function stepsOf(doc, st) {
  const out = [];
  const one = s => ({ kind: 'step', label: labelOf(s), dur_s: Math.max(1, Math.round(num(s.duration) || 60)), target: targetOf(s, st), cadence: cadenceOf(s) });
  const flat = (steps, reps) => { const xs = []; for (let r = 0; r < reps; r++) for (const s of steps || []) { if (Array.isArray(s.steps)) xs.push(...flat(s.steps, Math.max(1, num(s.reps) || 1))); else xs.push(one(s)); } return xs; };
  for (const s of (doc && Array.isArray(doc.steps)) ? doc.steps : []) {
    if (Array.isArray(s.steps)) {
      const reps = Math.max(1, num(s.reps) || 1), inner = s.steps.some(x => Array.isArray(x.steps)) ? flat(s.steps, 1) : s.steps.map(one);
      if (reps === 1) out.push(...inner); else out.push({ kind: 'repeat', label: String(s.text || '').slice(0, 60), count: Math.min(50, reps), steps: inner });
    } else out.push(one(s));
  }
  return out;
}

// an intervals.icu event to a workout the player rides
function workoutOf(e, st) {
  const local = String(e.start_date_local || ''), hhmm = local.slice(11, 16);
  return { id: 'icu-' + e.id, name: String(e.name || 'Ride').slice(0, 80), date: local.slice(0, 10),
    time: /^\d{2}:\d{2}$/.test(hhmm) && hhmm !== '00:00' ? hhmm : null,   // midnight is "some time today" in intervals.icu
    sport: e.type || 'Ride', notes: String(e.description || '').slice(0, 600), steps: stepsOf(e.workout_doc, st),
    sync: { intervals_event_id: e.id }, source: 'intervals.icu' };
}

async function eventsOn(date, opts) {
  const I = require('./intervals');
  if (!I.configured()) return { configured: false, events: [] };
  const athlete = envStr('INTERVALS_ICU_ATHLETE_ID');
  const u = `${BASE}/athlete/${encodeURIComponent(athlete)}/events?oldest=${date}&newest=${date}&category=WORKOUT&resolve=true`;
  const r = await ((opts && opts.fetch) || fetch)(u, { headers: I.headers() });
  if (!r.ok) throw new Error('intervals.icu ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const j = await r.json();
  return { configured: true, events: Array.isArray(j) ? j : [] };
}

// today's (or a day's) rides from intervals.icu, in the player's shape
async function ridesOn(date, st, opts) {
  const { events } = await eventsOn(date || tz.todayKey(), opts);
  return events.filter(e => String(e.category || 'WORKOUT').toUpperCase() === 'WORKOUT' && isRideType(e.type)).map(e => workoutOf(e, st));
}

module.exports = { ridesOn, workoutOf, stepsOf, targetOf, eventsOn };
