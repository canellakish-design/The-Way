// ============================================================
// rides.js — every ride, read: heart rate and breathing from the streams.
//
// Heart rate comes from Strava's streams (the Garmin uploads there).
// Breathing is not on Strava: the Garmin records a respiration stream in
// the FIT file, and intervals.icu, which syncs from Garmin Connect, serves
// it. So each ride is matched to its intervals.icu activity by start time
// and the respiration stream is read from there when the device recorded
// one. Each ride is analysed once and cached under 'ride-<strava id>'.
//
//   GET /rides/analysis?from=&to=      analyses for the rides in the window
//                                      (reads up to 4 new ones per call)
//   GET /rides/:id/analysis            one ride, analysed now
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const Z = require('./zones');
const R = require('./ride-math');

const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const KEY = envStr('INTERVALS_ICU_API_KEY');
const ATHLETE = envStr('INTERVALS_ICU_ATHLETE_ID');
const ICU = envStr('INTERVALS_ICU_BASE') || 'https://intervals.icu/api/v1';
const PER_CALL = 4;
const key = id => 'ride-' + String(id).replace(/\D/g, '');

async function icuGet(pathname) {
  if (!(KEY && ATHLETE)) throw new Error('intervals.icu not configured');
  const r = await fetch(ICU + pathname, { headers: { Authorization: 'Basic ' + Buffer.from('API_KEY:' + KEY).toString('base64') } });
  const text = await r.text();
  if (!r.ok) throw new Error('intervals.icu ' + r.status + ' ' + text.slice(0, 120));
  try { return JSON.parse(text); } catch { return null; }
}

// intervals.icu's activity for a Strava ride: same day, start within 10 minutes.
async function icuActivityFor(ride) {
  const date = ride.date;
  const list = await icuGet(`/athlete/${encodeURIComponent(ATHLETE)}/activities?oldest=${date}&newest=${date}`);
  if (!Array.isArray(list) || !list.length) return null;
  const startMin = ride.time ? (+ride.time.slice(0, 2)) * 60 + (+ride.time.slice(3, 5)) : null;
  const near = list.map(a => {
    const t = String(a.start_date_local || '').slice(11, 16);
    const m = /^\d{2}:\d{2}$/.test(t) ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null;
    return { a, d: startMin == null || m == null ? 999 : Math.abs(m - startMin) };
  }).sort((x, y) => x.d - y.d)[0];
  return near && near.d <= 10 ? near.a : (list.length === 1 ? list[0] : null);
}

// Whatever intervals.icu holds about breathing: a respiration stream if the
// FIT carried one, else the activity's own average. Field names are read
// loosely on purpose; the result says what it found.
async function breathingFrom(icuActivity) {
  if (!icuActivity) return { resp: null, source: 'no intervals.icu activity matched' };
  const fields = Object.keys(icuActivity).filter(k => /resp|breath/i.test(k));
  let resp = null, streamType = null;
  try {
    const streams = await icuGet(`/activity/${encodeURIComponent(icuActivity.id)}/streams`);
    const list = Array.isArray(streams) ? streams : (streams && Array.isArray(streams.streams) ? streams.streams : []);
    const s = list.find(x => /resp|breath/i.test(String(x.type || x.name || '')));
    if (s && Array.isArray(s.data)) { streamType = s.type || s.name; resp = R.respSummary(s.data); }
  } catch (e) { /* no stream access: fall through to the activity fields */ }
  if (!resp && fields.length) {
    const avg = fields.map(k => Number(icuActivity[k])).find(v => Number.isFinite(v) && v > 4 && v < 90);
    if (avg != null) resp = { avg: Math.round(avg * 10) / 10, max: null, p90: null, min: null, samples: 0 };
  }
  return { resp, source: resp ? (streamType ? `intervals.icu stream "${streamType}" (Garmin)` : `intervals.icu field ${fields.join(', ')} (Garmin)`)
    : (fields.length ? `intervals.icu has ${fields.join(', ')} but no value` : 'the Garmin recorded no respiration for this ride') ,
    icu_id: icuActivity.id };
}

async function analyze(ride, opts) {
  const o = opts || {};
  const cached = await getJSON(key(ride.id), null);
  if (cached && !o.force) return cached;
  const out = { id: ride.id, date: ride.date, name: ride.name, at: new Date().toISOString(), hr: null, resp: null, sources: {} };
  try {
    const s = await require('./strava').apiFetch(`/activities/${ride.id}/streams?keys=time,heartrate,watts&key_by_type=true`);
    const time = s && s.time && s.time.data;
    const hr = s && s.heartrate && s.heartrate.data;
    if (hr && hr.length) { out.hr = R.hrSummary(Z.resample1Hz(time, hr)); out.sources.hr = 'Strava heart-rate stream (Garmin)'; }
    else out.sources.hr = 'no heart-rate stream on Strava';
  } catch (e) { out.sources.hr = 'Strava: ' + e.message; out.error = e.message; }
  try {
    const b = await breathingFrom(await icuActivityFor(ride));
    out.resp = b.resp; out.sources.resp = b.source; out.icu_id = b.icu_id || null;
  } catch (e) { out.sources.resp = 'intervals.icu: ' + e.message; }
  // A Strava failure (a rate limit) is not a result: do not cache it as one.
  if (!out.error) await setJSON(key(ride.id), out).catch(() => {});
  return out;
}

// Analyses for a window: cached ones straight away, up to PER_CALL new ones.
async function forWindow(from, to, st) {
  const { stravaDone } = require('./workouts');
  const done = await stravaDone(from, to, st);
  const rides = done.rides || [];
  const out = {}; let fresh = 0;
  for (const r of rides) {
    const c = await getJSON(key(r.id), null);
    if (c) { out[r.id] = c; continue; }
    if (fresh < PER_CALL) { fresh++; out[r.id] = await analyze(r); }
  }
  return { from, to, connected: done.connected, analyses: out, pending: rides.filter(r => !out[r.id]).length };
}

function attach(app) {
  app.get('/rides/analysis', async (req, res) => { if (!auth(req, res)) return;
    try {
      const W = require('./workout-math');
      const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
      const today = tz.todayKey();
      const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : tz.shiftKey(today, -13);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
      res.json(await forWindow(from, to, st));
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/rides/:id/analysis', async (req, res) => { if (!auth(req, res)) return;
    try {
      const { stravaDone } = require('./workouts');
      const W = require('./workout-math');
      const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
      const today = tz.todayKey();
      const done = await stravaDone(tz.shiftKey(today, -120), today, st);
      const ride = (done.rides || []).find(r => String(r.id) === String(req.params.id));
      if (!ride) return res.status(404).json({ error: 'no such ride in the last 120 days' });
      res.json(await analyze(ride, { force: req.query.force === '1' }));
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, analyze, forWindow };
