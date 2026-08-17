// ============================================================
// intervals.js — intervals.icu planned work (the intervals and the lifting).
// Read-only: the plan is authored in intervals.icu, this just shows what the
// day owes. Env: INTERVALS_ICU_API_KEY, INTERVALS_ICU_ATHLETE_ID (e.g. i123456)
// Auth is HTTP Basic with the literal username "API_KEY".
// Honest seam: field names follow the current intervals.icu API — verify on
// the first live run; everything degrades visibly if they've moved.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const { auth } = require('./fuel-log');

const KEY = process.env.INTERVALS_ICU_API_KEY || '';
const ATHLETE = process.env.INTERVALS_ICU_ATHLETE_ID || '';
const BASE = 'https://intervals.icu/api/v1';
const TTL_MS = 10 * 60 * 1000;   // the plan changes rarely; don't refetch per page load

function configured() { return !!(KEY && ATHLETE); }
function headers() {
  return { Authorization: 'Basic ' + Buffer.from('API_KEY:' + KEY).toString('base64') };
}

const LIFT = /weight|strength|gym|kettlebell/i;
function kindOf(e) {
  const t = String(e.type || '') + ' ' + String(e.name || '');
  if (LIFT.test(t)) return 'lifting';
  return 'ride';
}
function fmtMin(m) {
  let h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'a' : 'p';
  h = h % 12; if (h === 0) h = 12;
  return h + ':' + String(mm).padStart(2, '0') + ap;
}

// One-line summary of the session's shape, so the day can be read at a glance
// without opening intervals.icu.
function shapeOf(e) {
  const bits = [];
  if (e.moving_time) bits.push(Math.round(e.moving_time / 60) + ' min');
  else if (e.icu_planned_duration) bits.push(Math.round(e.icu_planned_duration / 60) + ' min');
  if (e.icu_training_load) bits.push(e.icu_training_load + ' TSS');
  if (e.type) bits.push(String(e.type));
  return bits.join(' · ');
}

async function fetchRange(oldest, newest) {
  const u = new URL(BASE + '/athlete/' + encodeURIComponent(ATHLETE) + '/events');
  u.searchParams.set('oldest', oldest);
  u.searchParams.set('newest', newest);
  const r = await fetch(u, { headers: headers() });
  if (!r.ok) throw new Error('intervals.icu ' + r.status + ' ' + (await r.text()).slice(0, 120));
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

// Planned sessions only — completed rides come from Strava, and notes/holds
// on the intervals.icu calendar are not work to be done.
function isPlanned(e) {
  const c = String(e.category || '').toUpperCase();
  return c === 'WORKOUT' || c.startsWith('RACE');
}

async function plannedRange(oldest, newest) {
  if (!configured()) return { configured: false, days: {} };
  const cacheKey = 'intervals-cache';
  const cached = await getJSON(cacheKey, null);
  if (cached && cached.oldest === oldest && cached.newest === newest
      && Date.now() - cached.at < TTL_MS) {
    return { configured: true, days: cached.days, fetched_at: new Date(cached.at).toISOString(), cached: true };
  }
  const raw = await fetchRange(oldest, newest);
  const days = {};
  for (const e of raw) {
    if (!isPlanned(e)) continue;
    const local = String(e.start_date_local || '');
    const date = local.slice(0, 10);
    if (!date) continue;
    const hhmm = local.slice(11, 16);
    const sm = /^\d{2}:\d{2}$/.test(hhmm) ? (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(3, 5)) : null;
    // Midnight means "some time today" in intervals.icu, not 12am.
    const timed = sm != null && sm > 0;
    const mins = Math.round((e.moving_time || e.icu_planned_duration || 0) / 60);
    const kind = kindOf(e);
    (days[date] = days[date] || []).push({
      summary: e.name || (kind === 'lifting' ? 'Lifting' : 'Ride'),
      detail: shapeOf(e),
      description: e.description || null,
      category: 'training', source: 'intervals', kind,
      calendar: 'intervals.icu', allDay: !timed, blocking: false,
      minutes: mins || null,
      ...(timed ? {
        start_min: sm, end_min: sm + (mins || 60),
        from: fmtMin(sm), to: fmtMin(sm + (mins || 60))
      } : {})
    });
  }
  for (const k of Object.keys(days)) days[k].sort((a, b) => (a.start_min ?? 1e6) - (b.start_min ?? 1e6));
  await setJSON(cacheKey, { oldest, newest, days, at: Date.now() }).catch(() => {});
  return { configured: true, days, fetched_at: new Date().toISOString(), cached: false };
}

// A cheap liveness check for the Connections screen: does the key actually
// work? Deliberately does not touch the cache — the cache holds one range at a
// time, and a one-day probe would evict the fortnight the day page just
// fetched, causing both to refetch on every status load.
async function ping() {
  if (!configured()) return { ok: false, configured: false, reason: 'no API key' };
  const today = tz.todayKey();
  try {
    const raw = await fetchRange(today, today);
    return { ok: true, configured: true, planned_today: raw.filter(isPlanned).length, events_today: raw.length };
  } catch (e) {
    return { ok: false, configured: true, reason: e.message };
  }
}

function attach(app) {
  app.get('/intervals/ping', async (req, res) => { if (!auth(req, res)) return;
    res.json(await ping()); });
  app.get('/intervals/status', async (req, res) => { if (!auth(req, res)) return;
    res.json({ configured: configured(), athlete: ATHLETE || null }); });
  app.get('/intervals/day', async (req, res) => { if (!auth(req, res)) return;
    try {
      const date = req.query.date || tz.todayKey();
      const r = await plannedRange(date, date);
      res.json({ ...r, workouts: (r.days && r.days[date]) || [] });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, plannedRange, configured, ping };
