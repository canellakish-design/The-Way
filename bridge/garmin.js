// ============================================================
// garmin.js — The Way's own data field on the Edge (garmin/the-way-field) records the ride straight
// into the site, a batch of seconds every half minute over the phone, so an outdoor ride no longer
// needs Strava to reach the Day, the chain, the calendar and the coach. The ride lands in the player's
// store, in the player's shape (one sample a second: power, heart rate, cadence, speed), so every
// reader of a player ride reads it unchanged: the calendar counts it done, rides.js analyses it, the
// signature scans it, the debrief judges it. The Garmin still writes its own FIT file and sends it to
// Garmin Connect and intervals.icu as before; the site does not upload a second one.
//
//   POST /garmin/ride          { id: the ride's start in seconds since the epoch, name?, workout_id?,
//                                device?, t[], p[], h[], c[], s[], done? }  (t = timer seconds)
//   GET  /garmin/session/today the day's session, compact, for the field's target line
//   GET  /garmin/rides         the rides the field has sent, newest last
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const W = require('./workout-math');
const P = require('./player');
const partKey = id => 'garmin-ride-' + id;
const MIN_SECONDS = 120;      // a ride shorter than two minutes is a false start: kept, not counted

const nums = (a, n) => Array.from({ length: n }, (_, i) => { const v = Array.isArray(a) ? a[i] : null; return v == null || !Number.isFinite(Number(v)) ? null : Number(v); });

async function receive(b) {
  const startS = Math.round(Number((b || {}).id));
  if (!Number.isFinite(startS) || startS < 1.5e9 || startS > Date.now() / 1000 + 86400) { const e = new Error('id must be the ride\'s start in seconds since the epoch'); e.status = 400; throw e; }
  const id = startS * 1000;
  const part = await getJSON(partKey(id), { id, start_ms: id, name: null, workout_id: null, device: null, t: [], p: [], h: [], c: [], s: [], batches: 0, done: false });
  const n = Math.min(Array.isArray(b.t) ? b.t.length : 0, 3600);
  const t = nums(b.t, n), p = nums(b.p, n), h = nums(b.h, n), c = nums(b.c, n), s = nums(b.s, n);
  // the samples are one a second of timer time: a batch sent twice (the phone was slow to answer) adds nothing
  let last = part.t.length ? part.t[part.t.length - 1] : -1, added = 0;
  for (let i = 0; i < n; i++) {
    const ti = t[i] == null ? null : Math.round(t[i]);
    if (ti == null || ti <= last || part.t.length >= 12 * 3600) continue;
    // a hole (the field missed ticks) is filled with the same second count, empty values, so the columns stay one a second
    while (last + 1 < ti) { last++; part.t.push(last); part.p.push(null); part.h.push(null); part.c.push(null); part.s.push(null); }
    part.t.push(ti); part.p.push(p[i]); part.h.push(h[i]); part.c.push(c[i]); part.s.push(s[i] == null ? null : Math.round(s[i] * 10) / 10);
    last = ti; added++;
  }
  if (b.name) part.name = String(b.name).slice(0, 80);
  if (b.workout_id) part.workout_id = String(b.workout_id).slice(0, 40);
  if (b.device) part.device = String(b.device).slice(0, 30);
  if (b.done) part.done = true;
  part.batches++; part.updated = new Date().toISOString();
  await setJSON(partKey(id), part);
  const seconds = part.t.length;
  if (seconds < MIN_SECONDS) return { ok: true, id, seconds, added, counted: false, done: part.done };
  // the ride as the player stores one, rewritten on every batch: the Day sees it grow
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const S = P.cleanSamples({ t: part.t, p: part.p, c: part.c, h: part.h, s: part.s, tg: [], e: [], i: [] });
  const sum = Object.assign(P.summarize({ start_ms: id, name: part.name || 'Garmin ride', ftp: st.ftp, workout_id: part.workout_id }, S),
    { device: part.device || 'garmin', outdoor: true, live: !part.done });
  const now = new Date().toISOString();
  await setJSON(P.rideKey(id), { summary: sum, samples: S, raw: null, pauses: [], intervals: null, saved: now, device: part.device || 'garmin' });
  await setJSON('ride-v3-' + id, P.analysisOf(sum, S, st.ftp)).catch(() => {});
  const idx = await getJSON(P.INDEX, { rides: [] });
  const row = Object.assign({}, sum, { intervals_id: null, held_back: false, upload_error: null, saved_at: now, device: part.device || 'garmin', live: !part.done });
  const rides = (idx.rides || []).filter(x => String(x.id) !== String(id)).concat([row]).sort((a, b2) => a.id - b2.id).slice(-500);
  await setJSON(P.INDEX, { rides });
  return { ok: true, id, seconds, added, counted: true, done: part.done, avg_w: sum.avg_w, avg_hr: sum.avg_hr };
}

// The day's session, small enough for the field to hold: the name, the line to count minutes above,
// and each step as [start_s, dur_s, target_w, hr_lo, hr_hi] (0 where a step has no such target).
async function sessionToday() {
  const s = await P.sessionFor('today');
  const vt2 = s.thresholds && s.thresholds.vt2_hr ? s.thresholds.vt2_hr : 139;
  // the buckets (buckets.js): the lines and colours the field draws with, and the plan in seconds per bucket.
  // buckets_plan null means no plan (a free ride, or a ride-by-feel session): the bars share the ride time.
  // The field reads these at each ride start, so a new threshold reaches the Edge with no rebuild.
  const bk = { lines: s.lines || null, colours: s.colours || null, buckets_plan: s.buckets_plan || null };
  if (!s.workout) return Object.assign({ name: null, workout_id: null, vt2_hr: vt2, steps: [] }, bk);
  // each step as [start_s, dur_s, target_w, hr_lo, hr_hi]; a free step is all zeros and fills no bucket
  const steps = (s.intervals || []).map(x => [x.start_s, x.dur_s, x.target_w || 0, x.target_hr ? x.target_hr.lo : 0, x.target_hr ? x.target_hr.hi : 0]);
  return Object.assign({ name: s.workout.name, workout_id: s.workout.id, time: s.workout.time, vt2_hr: vt2, steps }, bk);
}

// The Zwift Lab PC's build of the field (scripts/garmin-field.ps1) reports here after each run, so Claude can
// see from anywhere whether the Edge has the newest field: what was built, from which commit, and whether it
// reached the Edge. The last 30 runs are kept.
async function noteBuild(b) {
  const x = b || {};
  const row = { at: new Date().toISOString(), ok: !!x.ok, commit: x.commit ? String(x.commit).slice(0, 40) : null, tree: x.tree ? String(x.tree).slice(0, 40) : null,
    built: !!x.built, bytes: Number.isFinite(Number(x.bytes)) ? Number(x.bytes) : null, copied: x.copied ? String(x.copied).slice(0, 120) : null,
    mode: x.mode ? String(x.mode).slice(0, 20) : null, note: x.note ? String(x.note).slice(0, 300) : null, host: x.host ? String(x.host).slice(0, 60) : null };
  const d = await getJSON('garmin-build', { runs: [] });
  d.runs = (d.runs || []).concat([row]).slice(-30);
  if (row.copied) d.on_edge = { at: row.at, commit: row.commit, tree: row.tree, bytes: row.bytes };
  await setJSON('garmin-build', d);
  return row;
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.post('/garmin/ride', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await receive(req.body || {})); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
  app.get('/garmin/session/today', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await sessionToday()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/garmin/build', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: true, run: await noteBuild(req.body || {}) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
  app.get('/garmin/build', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await getJSON('garmin-build', { runs: [] })); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/garmin/rides', async (req, res) => { if (!auth(req, res)) return;
    try { const idx = await getJSON(P.INDEX, { rides: [] }); res.json({ rides: (idx.rides || []).filter(x => x.device).slice(-50) }); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, receive, sessionToday, noteBuild, MIN_SECONDS };
