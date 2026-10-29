// ============================================================
// workouts.js — The Way owns the plan.
//
// Planned workouts live here (Netlify Blobs key 'plan-workouts'). intervals.icu
// is the pipe to the Garmin: "Send to Garmin" writes the workout to the
// intervals.icu calendar, and intervals.icu's own Garmin Connect sync carries
// it to the Edge. The Way is the source of truth; intervals.icu is a mirror.
//
// intervals.icu write: POST /api/v1/athlete/{id}/events/bulk?upsert=true,
// keyed by external_id, workout in the `description` text syntax. The forum
// reports that `workout_doc` can sync to the device as an empty FIT; the
// description field does not.
//
// Env: INTERVALS_ICU_API_KEY, INTERVALS_ICU_ATHLETE_ID (shared with intervals.js)
// ============================================================
const crypto = require('crypto');
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const W = require('./workout-math');
const { LIBRARY } = require('./workout-library');

const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const KEY = envStr('INTERVALS_ICU_API_KEY');
const ATHLETE = envStr('INTERVALS_ICU_ATHLETE_ID');
// INTERVALS_ICU_BASE exists only so tests can point this at a stand-in server.
const BASE = envStr('INTERVALS_ICU_BASE') || 'https://intervals.icu/api/v1';
const TTL_MS = 10 * 60 * 1000;
const EXT = 'the-way:';
const SPORTS = ['Ride', 'VirtualRide', 'WeightTraining'];

const icuConfigured = () => !!(KEY && ATHLETE);
const icuHeaders = () => ({ Authorization: 'Basic ' + Buffer.from('API_KEY:' + KEY).toString('base64'), 'Content-Type': 'application/json' });
async function icu(method, pathname, body) {
  const r = await fetch(BASE + '/athlete/' + encodeURIComponent(ATHLETE) + pathname, {
    method, headers: icuHeaders(), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error('intervals.icu ' + r.status + ' ' + text.slice(0, 200));
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

// ---------- storage ----------
async function db() { return getJSON('plan-workouts', { workouts: {} }); }
async function save(d) { await setJSON('plan-workouts', d); }
async function settings() { return W.settingsOf(await getJSON('workout-settings', W.DEFAULTS)); }

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isTime = s => /^\d{2}:\d{2}$/.test(String(s || ''));

function clean(body, prev) {
  const b = body || {}, p = prev || {};
  const date = isDate(b.date) ? b.date : (p.date || tz.todayKey());
  return {
    id: p.id || 'w_' + crypto.randomBytes(6).toString('hex'),
    date,
    time: b.time === '' || b.time === null ? null : (isTime(b.time) ? b.time : (p.time || null)),
    sport: SPORTS.includes(b.sport) ? b.sport : (p.sport || 'Ride'),
    name: String(b.name != null ? b.name : (p.name || 'Workout')).slice(0, 80) || 'Workout',
    notes: String(b.notes != null ? b.notes : (p.notes || '')).slice(0, 2000),
    route_id: b.route_id != null ? String(b.route_id).replace(/\D/g, '').slice(0, 12) || null : (p.route_id || null),
    steps: b.steps ? W.normItems(b.steps) : (p.steps || []),
    sync: p.sync || { state: 'off' },
    created: p.created || new Date().toISOString(),
    updated: new Date().toISOString()
  };
}

function withMetrics(w, st) {
  return Object.assign({}, w, {
    metrics: W.metrics(w.steps, st),
    intervals_text: W.toIntervalsText(w.steps, st)
  });
}

// ---------- intervals.icu sync ----------
function descriptionFor(w, st) {
  // Notes go first as plain text. A notes line that ends in "4x" would be read
  // as a repeat header, so such lines get a full stop.
  const notes = (w.notes || '').split('\n').map(l => /\d+\s*x\s*$/i.test(l) ? l + '.' : l).join('\n').trim();
  const text = W.toIntervalsText(w.steps, st);
  return (notes ? notes + '\n\n' : '') + text;
}

async function syncOne(w, st) {
  if (!icuConfigured()) {
    return Object.assign({}, w, { sync: { state: 'error', at: new Date().toISOString(),
      error: 'intervals.icu is not connected: INTERVALS_ICU_API_KEY and INTERVALS_ICU_ATHLETE_ID are not set in Netlify.' } });
  }
  const m = W.metrics(w.steps, st);
  const ev = {
    category: 'WORKOUT',
    start_date_local: w.date + 'T' + (w.time || '00:00') + ':00',
    type: w.sport,
    name: w.name,
    description: descriptionFor(w, st),
    moving_time: m.duration_s,
    external_id: EXT + w.id
  };
  try {
    const res = await icu('POST', '/events/bulk?upsert=true', [ev]);
    const got = Array.isArray(res) ? res[0] : res;
    // Bust the day page's intervals cache so the new session shows straight away.
    await setJSON('intervals-cache', null).catch(() => {});
    await setJSON('calendar-icu-cache', null).catch(() => {});
    return Object.assign({}, w, { sync: { state: 'synced', at: new Date().toISOString(),
      intervals_event_id: got && got.id != null ? got.id : (w.sync && w.sync.intervals_event_id) || null,
      planned_at_ftp: st.ftp, planned_at_lthr: st.lthr } });
  } catch (e) {
    return Object.assign({}, w, { sync: Object.assign({}, w.sync, { state: 'error', at: new Date().toISOString(), error: e.message }) });
  }
}

async function unsyncOne(w) {
  const id = w && w.sync && w.sync.intervals_event_id;
  if (!id || !icuConfigured()) return;
  try { await icu('DELETE', '/events/' + encodeURIComponent(id)); } catch (e) { /* already gone is fine */ }
  await setJSON('intervals-cache', null).catch(() => {});
  await setJSON('calendar-icu-cache', null).catch(() => {});
}

// What intervals.icu has as the athlete's cycling FTP and threshold HR. Power
// targets are sent as % of FTP and heart rate as % of LTHR, so if these do not
// match The Way's planning numbers, the Garmin shows different targets from
// the ones planned here.
async function preflight() {
  const st = await settings();
  if (!icuConfigured()) return { ok: false, configured: false, plan: st, reason: 'intervals.icu is not connected in Netlify' };
  try {
    const a = await icu('GET', '');
    const ss = (a && (a.sportSettings || a.sport_settings)) || [];
    const ride = ss.find(s => (s.types || []).some(t => /ride/i.test(t))) || ss[0] || {};
    const got = { ftp: ride.ftp || null, lthr: ride.lthr || null, max_hr: ride.max_hr || null };
    const issues = [];
    if (got.ftp !== st.ftp) issues.push(`intervals.icu cycling FTP is ${got.ftp == null ? 'not set' : got.ftp + ' W'}; The Way plans at ${st.ftp} W.`);
    if (got.lthr !== st.lthr) issues.push(`intervals.icu threshold heart rate is ${got.lthr == null ? 'not set' : got.lthr + ' bpm'}; The Way plans at ${st.lthr} bpm.`);
    if (got.max_hr && got.max_hr !== 162) issues.push(`intervals.icu max heart rate is ${got.max_hr}; your measured max is 162.`);
    return { ok: !issues.length, configured: true, plan: st, intervals: got, issues };
  } catch (e) {
    return { ok: false, configured: true, plan: st, reason: e.message };
  }
}

// ---------- the calendar: planned + intervals.icu + done ----------
async function icuEvents(from, to) {
  if (!icuConfigured()) return { configured: false, events: [] };
  const key = 'calendar-icu-cache';
  const c = await getJSON(key, null);
  if (c && c.from === from && c.to === to && Date.now() - c.at < TTL_MS) return { configured: true, events: c.events };
  const raw = await icu('GET', `/events?oldest=${from}&newest=${to}`);
  const events = (Array.isArray(raw) ? raw : [])
    .filter(e => /^(WORKOUT|RACE)/i.test(String(e.category || '')))
    .filter(e => !String(e.external_id || '').startsWith(EXT))   // our own come from the store
    .map(e => ({ id: e.id, date: String(e.start_date_local || '').slice(0, 10),
      time: String(e.start_date_local || '').slice(11, 16).replace(/^00:00$/, '') || null,
      name: e.name || 'Session', type: e.type || null,
      minutes: Math.round((e.moving_time || e.icu_planned_duration || 0) / 60) || null,
      tss: e.icu_training_load || null }));
  await setJSON(key, { from, to, at: Date.now(), events }).catch(() => {});
  return { configured: true, events };
}

function epoch(dateKey, endOfDay) {
  const [y, m, d] = dateKey.split('-').map(Number);
  // A generous window either side; the activity's own local date decides the day.
  return Math.floor(Date.UTC(y, m - 1, d) / 1000) + (endOfDay ? 86400 + 6 * 3600 : -6 * 3600);
}

async function stravaDone(from, to, st) {
  const key = 'calendar-strava-cache';
  const c = await getJSON(key, null);
  if (c && c.from === from && c.to === to && Date.now() - c.at < TTL_MS) return { connected: true, rides: c.rides };
  let list;
  try {
    list = await require('./strava').apiFetch(`/athlete/activities?after=${epoch(from)}&before=${epoch(to, true)}&per_page=200`);
  } catch (e) { return { connected: false, reason: e.message, rides: [] }; }
  const rides = (Array.isArray(list) ? list : []).map(a => {
    const date = String(a.start_date_local || '').slice(0, 10);
    const secs = a.moving_time || 0;
    // TSS estimate: NP from Strava's weighted average power if there is one,
    // otherwise the heart-rate method against threshold. Labelled as such.
    let tss = null, basis = null;
    if (a.weighted_average_watts) { const IF = a.weighted_average_watts / st.ftp; tss = Math.round(secs / 3600 * IF * IF * 100); basis = 'power'; }
    // Strava only reports a weighted average on some rides; a plain average
    // still beats scoring the ride as nothing (it reads a little low on a
    // variable ride, which is the honest direction to be wrong in).
    else if (a.average_watts) { const IF = a.average_watts / st.ftp; tss = Math.round(secs / 3600 * IF * IF * 100); basis = 'average power'; }
    else if (a.average_heartrate) { const IF = Math.max(0, (a.average_heartrate - st.hr_rest) / (st.lthr - st.hr_rest)); tss = Math.round(secs / 3600 * IF * IF * 100); basis = 'heart rate'; }
    return { id: a.id, date, time: String(a.start_date_local || '').slice(11, 16), name: a.name || 'Activity',
      type: a.sport_type || a.type || null, minutes: Math.round(secs / 60),
      miles: a.distance ? Math.round(a.distance / 1609.34 * 10) / 10 : null,
      avg_w: a.average_watts ? Math.round(a.average_watts) : null,
      np_w: a.weighted_average_watts ? Math.round(a.weighted_average_watts) : null,
      avg_hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
      tss, tss_basis: basis };
  }).filter(r => r.date >= from && r.date <= to);
  await setJSON(key, { from, to, at: Date.now(), rides }).catch(() => {});
  return { connected: true, rides };
}

// A workout saved on a day already gone is the rider logging what he did,
// not planning what he will do. It counts as done unless Strava has the ride.
function pastNow(w, today) {
  if (w.date < today) return true;
  if (w.date > today) return false;
  if (!isTime(w.time)) return false;
  const p = tz.parts(new Date());
  const endMin = (+w.time.slice(0, 2)) * 60 + (+w.time.slice(3, 5)) + Math.round(W.metrics(w.steps || [], W.DEFAULTS).duration_s / 60);
  return p.h * 60 + p.mi >= endMin;
}
function loggedPlanned(workouts, st, today, ridesByDate) {
  return workouts.filter(w => pastNow(w, today) && !(ridesByDate[w.date] || []).length)
    .map(w => Object.assign(withMetrics(w, st), { logged: true }));
}

async function calendar(from, to) {
  const st = await settings();
  const d = await db();
  const planned = Object.values(d.workouts).filter(w => w.date >= from && w.date <= to).map(w => withMetrics(w, st));
  const [icuR, doneR] = await Promise.all([
    icuEvents(from, to).catch(e => ({ configured: true, error: e.message, events: [] })),
    stravaDone(from, to, st).catch(e => ({ connected: false, reason: e.message, rides: [] }))
  ]);
  const today = tz.todayKey();
  const ridesByDate = {};
  for (const r of doneR.rides) (ridesByDate[r.date] = ridesByDate[r.date] || []).push(r);
  const days = [];
  for (let k = from; k <= to; k = tz.shiftKey(k, 1)) {
    const p = planned.filter(w => w.date === k).sort((a, b) => (a.time || '99') < (b.time || '99') ? -1 : 1)
      .map(w => pastNow(w, today) && !(ridesByDate[k] || []).length ? Object.assign({}, w, { logged: true }) : w);
    const i = icuR.events.filter(e => e.date === k);
    const done = doneR.rides.filter(r => r.date === k);
    const logged = p.filter(w => w.logged);
    const plannedMin = Math.round(p.reduce((s, w) => s + w.metrics.duration_s, 0) / 60) + i.reduce((s, e) => s + (e.minutes || 0), 0);
    const doneMin = done.reduce((s, r) => s + r.minutes, 0) + Math.round(logged.reduce((s, w) => s + w.metrics.duration_s, 0) / 60);
    days.push({ date: k, planned: p, intervals: i, done,
      totals: { planned_min: plannedMin, done_min: doneMin,
        planned_tss: p.reduce((s, w) => s + w.metrics.tss, 0) + i.reduce((s, e) => s + (e.tss || 0), 0),
        done_tss: done.reduce((s, r) => s + (r.tss || 0), 0) + logged.reduce((s, w) => s + w.metrics.tss, 0) } });
    if (days.length > 62) break;
  }
  return { from, to, today, settings: st, days,
    sources: { intervals: { configured: icuR.configured, error: icuR.error || null },
               strava: { connected: doneR.connected, reason: doneR.reason || null } } };
}

// ---------- the day page ----------
// The plan's own workouts in the shape the day page draws planned sessions
// in (see intervals.js plannedRange), so a workout saved here shows on the
// day whether or not it has been sent to the Garmin yet.
function fmtMin(m) {
  let h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'a' : 'p';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + String(mm).padStart(2, '0') + ap;
}
async function plannedDays(from, to) {
  const st = await settings();
  const d = await db();
  const days = {};
  for (const w of Object.values(d.workouts)) {
    if (w.date < from || w.date > to) continue;
    const m = W.metrics(w.steps || [], st);
    const mins = Math.round(m.duration_s / 60);
    const sm = isTime(w.time) ? (+w.time.slice(0, 2)) * 60 + (+w.time.slice(3, 5)) : null;
    const timed = sm != null && sm > 0;
    (days[w.date] = days[w.date] || []).push({
      summary: w.name, detail: [mins + ' min', m.tss + ' TSS', w.sport].join(' · '),
      description: w.notes || null,
      category: 'training', source: 'plan', kind: w.sport === 'WeightTraining' ? 'lifting' : 'ride',
      calendar: 'The Way', allDay: !timed, blocking: false, minutes: mins || null,
      workout_id: w.id, synced: !!(w.sync && w.sync.state === 'synced'),
      ...(timed ? { start_min: sm, end_min: sm + (mins || 60), from: fmtMin(sm), to: fmtMin(sm + (mins || 60)) } : {})
    });
  }
  return days;
}

// ---------- routes ----------
function attach(app) {
  app.get('/workouts/settings', async (req, res) => { if (!auth(req, res)) return;
    res.json(await settings()); });
  app.put('/workouts/settings', async (req, res) => { if (!auth(req, res)) return;
    const st = W.settingsOf(Object.assign({}, await settings(), req.body || {}));
    await setJSON('workout-settings', st); res.json(st); });

  app.get('/workouts/library', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings();
    res.json({ settings: st, library: LIBRARY.map(t => Object.assign({}, t,
      { steps: W.normItems(t.steps) }, { metrics: W.metrics(W.normItems(t.steps), st) })) }); });

  app.get('/workouts/preflight', async (req, res) => { if (!auth(req, res)) return;
    res.json(await preflight()); });

  // Preview without saving: the builder calls this as you edit.
  app.post('/workouts/preview', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings(); const steps = W.normItems((req.body || {}).steps);
    res.json({ metrics: W.metrics(steps, st), profile: W.profile(steps, st), intervals_text: W.toIntervalsText(steps, st) }); });

  app.get('/calendar', async (req, res) => { if (!auth(req, res)) return;
    try {
      const today = tz.todayKey();
      const from = isDate(req.query.from) ? req.query.from : today;
      let to = isDate(req.query.to) ? req.query.to : tz.shiftKey(from, 6);
      if (to < from) to = from;
      res.json(await calendar(from, to));
    } catch (e) { res.status(500).json({ error: e.message }); } });

  app.get('/workouts', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings(); const d = await db();
    const from = isDate(req.query.from) ? req.query.from : '0000-00-00', to = isDate(req.query.to) ? req.query.to : '9999-99-99';
    res.json({ workouts: Object.values(d.workouts).filter(w => w.date >= from && w.date <= to)
      .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1).map(w => withMetrics(w, st)) }); });

  app.get('/workouts/:id', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings(); const w = (await db()).workouts[req.params.id];
    if (!w) return res.status(404).json({ error: 'no such workout' });
    res.json(Object.assign(withMetrics(w, st), { profile: W.profile(w.steps, st) })); });

  app.get('/workouts/:id/zwo', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings(); const w = (await db()).workouts[req.params.id];
    if (!w) return res.status(404).json({ error: 'no such workout' });
    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="${(w.name || 'workout').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'workout'}.zwo"`);
    res.send(W.toZwo(w, st)); });

  app.post('/workouts', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings(); const d = await db();
    let w = clean(req.body);
    if ((req.body || {}).send) w = await syncOne(w, st);
    d.workouts[w.id] = w; await save(d);
    res.json(withMetrics(w, st)); });

  app.put('/workouts/:id', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings(); const d = await db(); const prev = d.workouts[req.params.id];
    if (!prev) return res.status(404).json({ error: 'no such workout' });
    let w = clean(req.body, prev);
    // A workout already on the Garmin is changed there too, or it is marked
    // as out of date — never silently left different.
    if ((req.body || {}).send || (prev.sync && prev.sync.state === 'synced')) {
      // The date moving means intervals.icu keeps the old one unless removed.
      if (prev.date !== w.date) await unsyncOne(prev);
      w = await syncOne(w, st);
    }
    d.workouts[w.id] = w; await save(d);
    res.json(withMetrics(w, st)); });

  app.post('/workouts/:id/sync', async (req, res) => { if (!auth(req, res)) return;
    const st = await settings(); const d = await db(); const w = d.workouts[req.params.id];
    if (!w) return res.status(404).json({ error: 'no such workout' });
    const out = await syncOne(w, st); d.workouts[w.id] = out; await save(d);
    res.status(out.sync.state === 'synced' ? 200 : 502).json(withMetrics(out, st)); });

  app.delete('/workouts/:id', async (req, res) => { if (!auth(req, res)) return;
    const d = await db(); const w = d.workouts[req.params.id];
    if (!w) return res.status(404).json({ error: 'no such workout' });
    await unsyncOne(w); delete d.workouts[w.id]; await save(d);
    res.json({ ok: true, removed: w.id, removed_from_intervals: !!(w.sync && w.sync.intervals_event_id) }); });
}

module.exports = { attach, calendar, preflight, descriptionFor, stravaDone, plannedDays, loggedPlanned, pastNow };
