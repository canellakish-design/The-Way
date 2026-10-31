// ============================================================
// scores.js — the front page: Training, Recovery, Fatigue.
//   GET /scores
// Training and Fatigue are Fitness (CTL) and Fatigue (ATL) from the Banister
// model over the last 120 days of completed rides (Strava, TSS estimated the
// same way the week calendar does it: power when there is an NP, heart rate
// otherwise). Recovery is WHOOP's score, with HRV and resting HR read against
// the 30-day median the fitness module has been snapshotting each morning.
// The arithmetic is in scores-math.js; this just gathers the inputs.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const W = require('./workout-math');
const M = require('./scores-math');

const HISTORY_DAYS = 120;   // 42-day constant: what was before this is under 6% of the number

async function build() {
  const today = tz.todayKey();
  const from = tz.shiftKey(today, -(HISTORY_DAYS - 1));
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));

  const { stravaDone, loggedPlanned } = require('./workouts');
  const done = await stravaDone(from, today, st).catch(e => ({ connected: false, reason: e.message, rides: [] }));
  // Workouts saved on days already gone, with no Strava ride that day, are
  // the rider's own log of what he did. They carry their planned TSS.
  let logged = [];
  try {
    const plan = await getJSON('plan-workouts', { workouts: {} });
    const byDate = {};
    for (const r of done.rides || []) (byDate[r.date] = byDate[r.date] || []).push(r);
    logged = loggedPlanned(Object.values(plan.workouts || {}).filter(w => w.date >= from && w.date <= today), st, today, byDate)
      .map(w => ({ date: w.date, tss: w.metrics.tss, logged: true }));
  } catch (e) { logged = []; }
  const loads = (done.rides || []).concat(logged);

  // WHOOP: the webhook pushes a new night when it is scored; failing that,
  // this read pulls when the stored copy is more than ten minutes old (the
  // sync has its own cache and in-flight guard, so a page's several calls
  // cost one request). The front page used to get this from the old
  // recovery card; the tiles need it here.
  let whoop = null;
  try { whoop = await require('./whoop').sleepLatest(); } catch (e) { whoop = null; }
  // The Garmin, through intervals.icu: HRV, resting heart rate, sleep and
  // Garmin's own readiness, one row a day. It stands in whenever WHOOP has no
  // fresh night (not connected, token dead, or more than 20 hours old), in the
  // shape the scoring already reads, so the tile needs no second path.
  let garmin = null, recoverySource = 'whoop';
  const whoopFresh = whoop && whoop.connected && !whoop.auth_error && whoop.recovery && whoop.recovery.score != null
    && whoop.synced_at && (Date.now() - new Date(whoop.synced_at).getTime()) < 20 * 36e5;
  if (!whoopFresh) {
    try {
      const iv = require('./intervals');
      if (iv.configured()) {
        const w = await iv.wellnessRange(tz.shiftKey(today, -35), today);
        const rows = (w.days || []).filter(d => d.hrv != null || d.rhr != null || d.sleep_h != null);
        const latest = rows.filter(d => d.date >= tz.shiftKey(today, -1)).pop() || null;
        if (latest) {
          const hist = rows.filter(d => d.date !== latest.date).slice(-30);
          const hrvB = M.vsBaseline(latest.hrv, hist.map(d => d.hrv));
          // Garmin's readiness when it reports one; else a score from HRV against
          // the month and the night's sleep, said to be an estimate
          let score = latest.readiness, basis = 'Garmin training readiness';
          if (score == null) {
            score = Math.max(10, Math.min(100, Math.round(60 + (hrvB.delta_pct || 0) * 1.2 + ((latest.sleep_h || 7) - 7) * 8)));
            basis = 'estimated from HRV against your 30-day baseline and last night\'s sleep';
          }
          garmin = { connected: true, source: 'garmin', synced_at: latest.updated || new Date(latest.date + 'T12:00:00Z').toISOString(), date: latest.date, basis,
            recovery: { score, hrv: latest.hrv, rhr: latest.rhr, resp: latest.respiration, spo2: latest.spo2 },
            sleep: { hours: latest.sleep_h, performance: latest.sleep_score }, body_battery: latest.body_battery_max, hist };
          recoverySource = 'garmin';
        }
      }
    } catch (e) { garmin = null; }
  }

  // Snapshot today's HRV/RHR into the wellness log so the baseline builds
  // even on days nobody opens the analysis page.
  let wellness = [];
  try {
    const { noteWellness } = require('./fitness');
    const d = await getJSON('fitness', { wellness: [] });
    if (await noteWellness(d)) await setJSON('fitness', d).catch(() => {});
    wellness = d.wellness || [];
  } catch (e) { wellness = []; }

  // the Garmin's mornings also feed the baseline log the confound filter and the HRV guide read
  if (garmin && garmin.hist) {
    try {
      const d = await getJSON('fitness', { wellness: [] }); let dirty = false;
      for (const r of garmin.hist.concat([{ date: garmin.date, hrv: garmin.recovery.hrv, rhr: garmin.recovery.rhr }])) {
        if (r.hrv == null && r.rhr == null) continue;
        if (!(d.wellness || []).some(x => x.date === r.date)) { d.wellness.push({ date: r.date, hrv: r.hrv ?? null, rhr: r.rhr ?? null, recovery: null, resp: r.respiration ?? null, source: 'garmin' }); dirty = true; }
      }
      if (dirty) { d.wellness.sort((a, b) => a.date.localeCompare(b.date)); d.wellness = d.wellness.slice(-120); await setJSON('fitness', d).catch(() => {}); wellness = d.wellness; }
    } catch (e) { /* the baseline log is a nicety */ }
  }
  const out = M.scores({ loads, from, to: today, today, shiftKey: tz.shiftKey, whoop: garmin || whoop, wellness });
  return Object.assign(out, {
    settings: { ftp: st.ftp, lthr: st.lthr },
    sources: {
      strava: { connected: !!done.connected, reason: done.reason || null, rides: (done.rides || []).length, logged: logged.length,
        basis: 'TSS from NP against FTP ' + st.ftp + ' W when Strava has power, heart rate against LTHR ' + st.lthr + ' otherwise' },
      recovery: { source: recoverySource, basis: garmin ? garmin.basis : 'WHOOP recovery', synced_at: garmin ? garmin.synced_at : (whoop ? whoop.synced_at : null), date: garmin ? garmin.date : null,
        body_battery: garmin ? garmin.body_battery : null, garmin_configured: require('./intervals').configured() },
      whoop: { connected: !!(whoop && whoop.connected), synced_at: whoop ? whoop.synced_at : null,
        auth_error: whoop ? whoop.auth_error : null }
    }
  });
}

function attach(app) {
  app.get('/scores', async (req, res) => { if (!auth(req, res)) return;
    try {
      const out = await build();
      // a compact copy for the advisor
      try { const t = out.training || {}, f = out.fatigue || {}, r = out.recovery || {};
        await setJSON('scores-last', { at: Date.now(), ctl: t.ctl, ramp_7d: t.ramp_7d, ramp: t.ramp ? t.ramp.word : null, tss_7d: t.tss_7d, atl: f.atl, tsb: f.tsb, form: f.form ? f.form.word : null, recovery: r.score, recovery_word: r.band ? r.band.word : null, hrv: r.hrv, rhr: r.rhr, source: out.sources && out.sources.recovery ? out.sources.recovery.source : null }); } catch (e) { /* no store */ }
      res.json(out);
    }
    catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, build };
