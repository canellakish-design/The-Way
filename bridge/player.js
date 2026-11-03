// The workout player (docs/workout-player-spec.md, player v1). The page is pwa/player.js (#player).
//   GET  /player/session/:id     the workout to ride: its steps as a flat list of intervals in watts at the
//   GET  /player/session/today   planning FTP, and the ride's fuel slots from the day's food plan
//   POST /player/ride            { summary, samples, fit_base64, raw } -> the ride is kept here (it counts on
//                                Day and Calendar at once) and its FIT goes to intervals.icu -> { ok, stored, intervals_id | error }
//   POST /player/spike, GET /player/spike   the trainer test page's findings (pwa/player-test.html)
// A ride's id is its start time in ms: numeric, because the ride caches key on String(id).replace(/\D/g, '').
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const W = require('./workout-math');
const R = require('./ride-math');

const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const ICU = envStr('INTERVALS_ICU_BASE') || 'https://intervals.icu/api/v1';
const INDEX = 'player-rides', rideKey = id => 'player-ride-' + String(id).replace(/\D/g, '');
const isTime = s => /^\d{2}:\d{2}$/.test(String(s || ''));
const toMin = t => isTime(t) ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null;
const isRide = w => !/weight|lift|strength|^run$|virtualrun|trailrun|walk|hike/i.test(String((w && w.sport) || ''));

// ---------- the workout as the player rides it ----------
// Every step in order, repeats expanded, each with its start and its target in watts at the planning FTP.
// A heart-rate step or a free step has no watts: the trainer is let go (ERG off) and the rider holds the heart rate.
function expand(steps, st) {
  const s0 = W.settingsOf(st), ftp = s0.ftp, out = [];
  let t = 0;
  const pctW = p => Math.round(p / 100 * ftp);
  const push = (s, rep) => {
    const g = s.target || { type: 'free' };
    let kind = g.type, target_w = null, target_w_end = null, target_hr = null;
    if (g.type === 'power') target_w = pctW((g.lo + g.hi) / 2);
    else if (g.type === 'watts') { target_w = Math.round((g.lo + g.hi) / 2); kind = 'power'; }
    else if (g.type === 'ramp') { target_w = pctW(g.from); target_w_end = pctW(g.to); }
    else if (g.type === 'hr') target_hr = { lo: g.lo, hi: g.hi };
    else kind = 'free';
    const label = s.label || (rep && rep.label) || (kind === 'hr' ? `Hold HR ${target_hr.lo}–${target_hr.hi}` : kind === 'free' ? 'Ride by feel' : 'Interval');
    out.push({ label, start_s: t, dur_s: s.dur_s, target_w, target_w_end, target_hr, kind, cadence: s.cadence || null,
      rep: rep ? `${rep.n} of ${rep.of}` : null });
    t += s.dur_s;
  };
  for (const it of W.normItems(steps)) {
    if (it.kind === 'repeat') for (let n = 1; n <= it.count; n++) for (const s of it.steps) push(s, { n, of: it.count, label: it.label });
    else push(it, null);
  }
  return out;
}

// The ride's fuel from the day's food plan: the "before" meal in the hours ahead of the start, the bottle on the bike.
function fuelSlots(meals, time) {
  const sm = toMin(time);
  return (meals || []).filter(m => m && (m.slot === 'before' || m.slot === 'on the bike')).filter(m => {
    if (sm == null) return true;
    const mm = toMin(m.time); if (mm == null) return true;
    return m.slot === 'before' ? mm >= sm - 300 && mm <= sm : Math.abs(mm - sm) <= 30;
  }).map(m => ({ slot: m.slot, time: m.time || null, what: m.what || '', carbs_g: m.carbs_g || null, kcal: m.kcal || null }));
}

async function sessionFor(id) {
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const all = Object.values((await getJSON('plan-workouts', { workouts: {} })).workouts || {});
  const today = tz.todayKey();
  const todays = all.filter(w => w.date === today && isRide(w)).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1);
  let w;
  if (id === 'today') {
    // today's next ride: the first whose end has not passed, else the day's last
    const p = tz.parts(new Date()), now = p.h * 60 + p.mi;
    w = todays.find(x => toMin(x.time) == null || toMin(x.time) + Math.round(W.metrics(x.steps || [], st).duration_s / 60) > now) || todays[todays.length - 1] || null;
    if (!w) return { workout: null, settings: st, choices: [], date: today };
  } else {
    w = all.find(x => x.id === id);
    if (!w) { const e = new Error('no such workout'); e.status = 404; throw e; }
  }
  const intervals = expand(w.steps || [], st);
  const m = W.metrics(W.normItems(w.steps || []), st);
  let fuel = [];
  try { const g = await require('./food').guidelinesFor(w.date); fuel = fuelSlots(g.meals, w.time); } catch (e) { fuel = []; }
  return { date: w.date, settings: st,
    workout: { id: w.id, name: w.name, date: w.date, time: w.time || null, sport: w.sport, notes: w.notes || '',
      duration_s: m.duration_s, tss: m.tss, np_w: m.np_w, intervals_event_id: (w.sync && w.sync.intervals_event_id) || null },
    intervals, fuel,
    choices: todays.map(x => ({ id: x.id, name: x.name, time: x.time || null })) };
}

// ---------- the finished ride ----------
// samples arrive as columns, one entry a second: t (s from the start), p watts, c rpm, h bpm, s km/h, tg target W, e ERG 0/1, i interval
const col = (S, k, n) => { const a = Array.isArray(S && S[k]) ? S[k] : []; const out = new Array(n); for (let j = 0; j < n; j++) { const v = a[j]; out[j] = v == null || !Number.isFinite(+v) ? null : +v; } return out; };
function cleanSamples(S) {
  const n = Math.min(Array.isArray(S && S.t) ? S.t.length : 0, 12 * 3600);
  return { t: col(S, 't', n), p: col(S, 'p', n), c: col(S, 'c', n), h: col(S, 'h', n), s: col(S, 's', n), tg: col(S, 'tg', n), e: col(S, 'e', n), i: col(S, 'i', n) };
}
function np30(ws) {
  if (ws.length < 30) return null;
  let roll = 0, acc = 0, n = 0; const q = [];
  for (const w of ws) { roll += w; q.push(w); if (q.length > 30) roll -= q.shift(); if (q.length === 30) { acc += Math.pow(roll / 30, 4); n++; } }
  return n ? Math.round(Math.pow(acc / n, 0.25)) : null;
}
// The summary the site keeps, worked out here from the samples rather than taken on trust from the page.
function summarize(meta, S) {
  const start = Number(meta.start_ms), n = S.t.length;
  const pw = S.p.filter(v => v != null && v >= 0), hr = S.h.filter(v => v != null && v > 30), cad = S.c.filter(v => v != null && v > 0);
  const avg = xs => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const last = n ? S.t[n - 1] : 0;
  let dist = 0; for (const v of S.s) if (v != null && v > 0) dist += v / 3.6;
  const p = tz.parts(new Date(start));
  return { id: start, start_ms: start, date: tz.keyOf(new Date(start)), time: String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'),
    name: String(meta.name || 'Indoor ride').slice(0, 80), workout_id: meta.workout_id ? String(meta.workout_id).slice(0, 40) : null,
    seconds: n, elapsed_s: Math.round(last) + 1, distance_m: Math.round(dist),
    avg_w: avg(pw), np_w: np30(pw), max_w: pw.length ? Math.max(...pw) : null,
    avg_hr: avg(hr), max_hr: hr.length ? Math.max(...hr) : null, avg_cad: avg(cad),
    kj: Math.round(pw.reduce((a, b) => a + b, 0) / 1000), ftp: Number(meta.ftp) || null };
}
// The analysis the Calendar, the grade and Zone 1 time read for a ride (rides.js analyze() writes the same shape for
// a Strava ride): heart rate in the three zones from the strap's own samples, power from the trainer's.
function analysisOf(sum, S, ftp) {
  const hr1 = S.h.map(v => v == null ? 0 : v), pw1 = S.p.map(v => v == null ? 0 : v);
  const hasHr = S.h.some(v => v > 30), hasPw = S.p.some(v => v != null);
  return { id: sum.id, date: sum.date, name: sum.name, at: new Date().toISOString(), source: 'player',
    hr: hasHr ? R.hrSummary(hr1) : null, power: hasPw ? R.powerSummary(pw1, ftp) : null,
    couple: hasHr && hasPw ? R.decoupling(pw1, hr1) : null, resp: null, ve: null,
    sources: { hr: hasHr ? 'The Way player: the heart-rate strap, every second' : 'The Way player: no heart-rate strap on this ride',
      power: hasPw ? 'The Way player: the trainer\'s power, every second' : 'The Way player: no power', resp: 'The Way player: breathing not decoded yet' } };
}

// The FIT file to intervals.icu, as a Garmin's would arrive: multipart, field "file". On the copy the sandbox guard
// answers for intervals.icu (the upload is held back), which reads here as stored with no intervals.icu id.
async function uploadFit(b64, sum, pairedEvent) {
  const I = require('./intervals');
  const athlete = envStr('INTERVALS_ICU_ATHLETE_ID');
  if (!I.configured()) return { ok: false, error: 'intervals.icu is not connected: INTERVALS_ICU_API_KEY and INTERVALS_ICU_ATHLETE_ID are not set in Netlify.' };
  const bytes = Buffer.from(String(b64 || ''), 'base64');
  if (bytes.length < 16 || bytes.toString('latin1', 8, 12) !== '.FIT') return { ok: false, error: 'the FIT file did not arrive' };
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'application/octet-stream' }), 'ride.fit');
  const q = new URLSearchParams({ name: sum.name, external_id: 'the-way-player-' + sum.id });
  if (pairedEvent) q.set('paired_event_id', String(pairedEvent));
  try {
    const r = await fetch(`${ICU}/athlete/${encodeURIComponent(athlete)}/activities?${q}`, { method: 'POST', headers: I.headers(), body: fd });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: 'intervals.icu ' + r.status + ' ' + text.slice(0, 200) };
    let j = null; try { j = JSON.parse(text); } catch (e) { j = null; }
    const one = Array.isArray(j) ? j[0] : j;
    if (one && one.sandbox) return { ok: true, intervals_id: null, held_back: true };
    const id = one && (one.id || one.activity_id || (Array.isArray(one.activities) && one.activities[0] && one.activities[0].id));
    return { ok: true, intervals_id: id != null ? String(id) : null };
  } catch (e) { return { ok: false, error: 'intervals.icu: ' + e.message }; }
}

async function saveRide(body) {
  const b = body || {}, meta = b.summary || {};
  const start = Number(meta.start_ms != null ? meta.start_ms : meta.id);
  if (!Number.isInteger(start) || start < 1.5e12 || start > Date.now() + 864e5) { const e = new Error('summary.start_ms must be the ride\'s start in ms'); e.status = 400; throw e; }
  const S = cleanSamples(b.samples);
  if (!S.t.length) { const e = new Error('no samples'); e.status = 400; throw e; }
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const sum = summarize(Object.assign({}, meta, { start_ms: start, ftp: meta.ftp || st.ftp }), S);
  const raw = b.raw && typeof b.raw === 'object' ? b.raw : null;
  const idx = await getJSON(INDEX, { rides: [] });
  const prev = (idx.rides || []).find(x => String(x.id) === String(sum.id));
  // the ride itself first: whatever happens with intervals.icu, The Way has it
  await setJSON(rideKey(sum.id), { summary: sum, samples: S, raw, pauses: Array.isArray(meta.pauses) ? meta.pauses.slice(0, 500) : [], intervals: Array.isArray(meta.intervals) ? meta.intervals.slice(0, 400) : null, saved: new Date().toISOString() });
  await setJSON('ride-v3-' + sum.id, analysisOf(sum, S, st.ftp)).catch(() => {});
  // an earlier try that already reached intervals.icu is not sent twice
  let up;
  if (prev && prev.intervals_id) up = { ok: true, intervals_id: prev.intervals_id, already: true };
  else if (b.fit_base64) up = await uploadFit(b.fit_base64, sum, meta.intervals_event_id || null);
  else up = { ok: false, error: 'no FIT file sent' };
  const row = Object.assign({}, sum, { intervals_id: up.intervals_id || null, held_back: !!up.held_back, upload_error: up.ok ? null : up.error, saved_at: new Date().toISOString() });
  const rides = (idx.rides || []).filter(x => String(x.id) !== String(sum.id)).concat([row]).sort((a, b2) => a.id - b2.id).slice(-500);
  await setJSON(INDEX, { rides });
  if (up.intervals_id) { const a = await getJSON('ride-v3-' + sum.id, null); if (a) await setJSON('ride-v3-' + sum.id, Object.assign(a, { icu_id: up.intervals_id })).catch(() => {}); }
  return { ok: !!up.ok, stored: true, id: sum.id, summary: row, intervals_id: up.intervals_id || null, held_back: !!up.held_back, error: up.ok ? null : up.error };
}

// The index of player rides between two dates (workouts.js counts them as done rides).
async function ridesBetween(from, to) {
  const idx = await getJSON(INDEX, { rides: [] });
  return (idx.rides || []).filter(x => x && x.date >= from && x.date <= to);
}

function attach(app) {
  app.get('/player/session/:id', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await sessionFor(req.params.id === 'today' ? 'today' : String(req.params.id))); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); } });

  app.post('/player/ride', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await saveRide(req.body)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); } });

  app.get('/player/rides', async (req, res) => { if (!auth(req, res)) return;
    res.json(await getJSON(INDEX, { rides: [] })); });

  app.post('/player/spike', async (req, res) => { if (!auth(req, res)) return;
    const d = await getJSON('player-spike', { runs: [] });
    d.runs = (d.runs || []).concat([Object.assign({ received: new Date().toISOString() }, req.body || {})]).slice(-5);
    await setJSON('player-spike', d);
    res.json({ ok: true, runs: d.runs.length });
  });
  app.get('/player/spike', async (req, res) => { if (!auth(req, res)) return; res.json(await getJSON('player-spike', { runs: [] })); });
}
module.exports = { attach, expand, fuelSlots, summarize, analysisOf, cleanSamples, saveRide, uploadFit, ridesBetween, rideKey, INDEX };
