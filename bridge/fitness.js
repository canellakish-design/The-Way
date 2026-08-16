// ============================================================
// fitness.js — the Signature: FTP, threshold HR and both zone sets, kept
// current from the rides that come in. zones.js holds the math; this holds the
// state, the ingestion, the recalculation triggers (§6) and the audit log.
//   GET  /fitness            current FTP, threshold HR, zones, every signal
//   GET  /fitness/zones      just the two zone tables
//   GET  /fitness/log        why the number changed, and by how much
//   POST /fitness/test       Tymewear ramp test — manual entry (§2a, §7)
//   POST /fitness/override   pin FTP / threshold HR; {clear:true} releases it
//   POST /fitness/breathing  steady-state (power, VE) data for the §2c curve
//   GET  /fitness/scan?activity=ID   pull one ride's streams and re-read eFTP
//   GET  /fitness/backfill?n=20      walk stored rides and do the same
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const Z = require('./zones');

const MAX_EFFORTS = 400, MAX_SEGMENTS = 2000, MAX_LOG = 200, MAX_WELLNESS = 120;

async function db() {
  return getJSON('fitness', {
    efforts: [], segments: [], wellness: [], test: null, override: null,
    accepted: null, log: [], scanned: []
  });
}

/* ---- wellness history -------------------------------------------------
   §2c wants a trailing 30-day HRV/RHR baseline to spot confounded rides, but
   WHOOP only ever stores its latest reading here. So we snapshot each day's
   reading as we see it; the baseline builds from the day this ships, and
   until there are enough days the confound filter simply doesn't fire. */
async function noteWellness(d) {
  try {
    const { sleepLatest } = require('./whoop');
    const s = await sleepLatest();
    const rec = s && s.recovery;
    if (!rec || rec.score == null) return;
    const date = new Date().toISOString().slice(0, 10);
    if (d.wellness.some(w => w.date === date)) return;
    d.wellness.push({ date, hrv: rec.hrv ?? null, rhr: rec.rhr ?? null, recovery: rec.score });
    if (d.wellness.length > MAX_WELLNESS) d.wellness = d.wellness.slice(-MAX_WELLNESS);
  } catch (e) { /* WHOOP unreachable — confound filter stays inert */ }
}

/* ---- the signals ---- */

function signalsFrom(d) {
  const test = Z.ftpFromTest(d.test);
  const eftp = Z.eftpFromEfforts(d.efforts);
  const flagged = Z.flagConfounded(d.segments, d.wellness);
  const ventilatory = Z.ventilatoryBreakpoints(flagged, (eftp && eftp.ftp) || (test && test.ftp));
  return { test, eftp, ventilatory, override: d.override };
}

async function compute(reason) {
  const d = await db();
  await noteWellness(d);
  const signals = signalsFrom(d);
  const accepted = Z.reconcile(signals);

  // §6 — log what drove the change, so "why did my FTP move" has an answer.
  const prev = d.accepted;
  const changed = !prev || prev.ftp !== accepted.ftp || prev.threshold_hr !== accepted.threshold_hr;
  if (changed && accepted.ftp) {
    d.log.push({
      at: new Date().toISOString(), reason: reason || 'recompute',
      ftp: accepted.ftp, from_ftp: prev ? prev.ftp : null,
      delta: prev && prev.ftp ? accepted.ftp - prev.ftp : null,
      threshold_hr: accepted.threshold_hr, source: accepted.source
    });
    if (d.log.length > MAX_LOG) d.log = d.log.slice(-MAX_LOG);
  }
  d.accepted = accepted;
  await setJSON('fitness', d);

  return {
    ftp: accepted.ftp, threshold_hr: accepted.threshold_hr,
    source: accepted.source, confidence: accepted.confidence, notes: accepted.notes || [],
    power_zones: Z.powerZones(accepted.ftp),
    hr_zones: Z.hrZones(accepted.threshold_hr),
    threshold_hr_source: accepted.threshold_hr_source || (accepted.source && accepted.threshold_hr ? 'VT2 heart rate' : null),
    signals: {
      test: signals.test, eftp: signals.eftp, ventilatory: signals.ventilatory,
      override: d.override || null
    },
    counts: { efforts: d.efforts.length, segments: d.segments.length, wellness_days: d.wellness.length,
      rides_scanned: d.scanned.length },
    changed
  };
}

/* ---- ingestion ---- */

// One ride: streams in, qualifying efforts out (§2b, §6 trigger 2).
async function ingestActivity(id, meta) {
  const { apiFetch } = require('./strava');
  const s = await apiFetch(`/activities/${id}/streams?keys=time,watts,heartrate&key_by_type=true`);
  const watts = s && s.watts && s.watts.data;
  if (!watts || !watts.length) return { ok: false, reason: 'no power stream on this activity' };
  const time = s.time && s.time.data;
  const w = Z.resample1Hz(time, watts);
  const hr = s.heartrate && s.heartrate.data ? Z.resample1Hz(time, s.heartrate.data) : null;
  const efforts = Z.effortsFromRide(w, hr, { activity_id: id, at: (meta && meta.at) || new Date().toISOString(), name: meta && meta.name });

  const d = await db();
  d.efforts = d.efforts.filter(e => e.activity_id !== id).concat(efforts);
  if (d.efforts.length > MAX_EFFORTS) d.efforts = d.efforts.slice(-MAX_EFFORTS);
  if (!d.scanned.includes(id)) d.scanned.push(id);
  await setJSON('fitness', d);

  const qualifying = efforts.filter(e => e.qualifying);
  const state = await compute(`ride ${id}`);
  return { ok: true, activity_id: id, efforts: efforts.length, qualifying: qualifying.length,
    best: qualifying[0] || null, ftp: state.ftp, changed: state.changed };
}

async function backfill(n) {
  const strava = await getJSON('strava', { rides: [] });
  const d = await db();
  const rides = (strava.rides || []).filter(r => r.aspect !== 'delete')
    .filter(r => r.avg_watts)                      // no power meter, nothing to read
    .filter(r => !d.scanned.includes(r.id))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, n || 20);
  const done = [];
  for (const r of rides) {
    try { done.push(await ingestActivity(r.id, { at: r.at, name: r.name })); }
    catch (e) { done.push({ ok: false, activity_id: r.id, reason: e.message }); }
  }
  return { scanned: done.length, results: done, state: await compute('backfill') };
}

function attach(app) {
  app.get('/fitness', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await compute('read')); }
    catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/fitness/zones', async (req, res) => { if (!auth(req, res)) return;
    try { const s = await compute('read');
      res.json({ ftp: s.ftp, threshold_hr: s.threshold_hr, power_zones: s.power_zones, hr_zones: s.hr_zones }); }
    catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/fitness/log', async (req, res) => { if (!auth(req, res)) return;
    const d = await db(); res.json({ log: d.log.slice().reverse() }); });

  // §2a / §7 — Tymewear has no API, so the ramp test is typed in.
  app.post('/fitness/test', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      if (!Number.isFinite(Number(b.vt2_power))) return res.status(400).json({ error: 'vt2_power required' });
      const d = await db();
      d.test = { vt2_power: Number(b.vt2_power), vt2_hr: b.vt2_hr ?? null,
        vt1_power: b.vt1_power ?? null, vt1_hr: b.vt1_hr ?? null,
        vo2max_power: b.vo2max_power ?? null, vo2max_hr: b.vo2max_hr ?? null,
        date: b.date || new Date().toISOString(), source: b.source || 'tymewear' };
      await setJSON('fitness', d);
      res.json({ ok: true, ...(await compute('dedicated test entered')) });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.post('/fitness/override', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      const d = await db();
      if (b.clear) d.override = null;
      else {
        if (!Number.isFinite(Number(b.ftp))) return res.status(400).json({ error: 'ftp required (or {"clear":true})' });
        d.override = { ftp: Number(b.ftp), threshold_hr: b.threshold_hr ?? null, at: new Date().toISOString() };
      }
      await setJSON('fitness', d);
      res.json({ ok: true, ...(await compute(b.clear ? 'override cleared' : 'manual override')) });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  // §2c — either pre-computed steady segments, or raw streams to segment here.
  app.post('/fitness/breathing', async (req, res) => { if (!auth(req, res)) return;
    try {
      const b = req.body || {};
      const meta = { at: b.at || new Date().toISOString(), activity_id: b.activity_id || null };
      let segs = [];
      if (Array.isArray(b.segments)) {
        segs = b.segments.filter(s => Number.isFinite(Number(s.power)) && Number.isFinite(Number(s.ve)))
          .map(s => ({ power: Math.round(Number(s.power)), ve: Number(s.ve), seconds: Number(s.seconds) || null, ...meta }));
      } else if (Array.isArray(b.watts) && Array.isArray(b.ve)) {
        const w = Z.resample1Hz(b.time, b.watts), v = Z.resample1Hz(b.time, b.ve);
        segs = Z.steadySegments(w, v, meta);
      } else {
        return res.status(400).json({ error: 'send {segments:[{power,ve}]} or {watts:[],ve:[],time:[]}' });
      }
      const d = await db();
      d.segments = d.segments.concat(segs);
      if (d.segments.length > MAX_SEGMENTS) d.segments = d.segments.slice(-MAX_SEGMENTS);
      await setJSON('fitness', d);
      res.json({ ok: true, added: segs.length, ...(await compute('breathing data')) });
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/fitness/scan', async (req, res) => { if (!auth(req, res)) return;
    try {
      if (!req.query.activity) return res.status(400).json({ error: 'activity id required' });
      res.json(await ingestActivity(req.query.activity, {}));
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/fitness/backfill', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await backfill(parseInt(req.query.n, 10) || 20)); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, compute, ingestActivity, backfill };
