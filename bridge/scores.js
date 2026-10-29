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

  const { stravaDone } = require('./workouts');
  const done = await stravaDone(from, today, st).catch(e => ({ connected: false, reason: e.message, rides: [] }));

  // Passive WHOOP read: the webhook keeps it fresh; the page can force a sync.
  let whoop = null;
  try { whoop = await require('./whoop').sleepLatest({ sync: false }); } catch (e) { whoop = null; }

  // Snapshot today's HRV/RHR into the wellness log so the baseline builds
  // even on days nobody opens the analysis page.
  let wellness = [];
  try {
    const { noteWellness } = require('./fitness');
    const d = await getJSON('fitness', { wellness: [] });
    if (await noteWellness(d)) await setJSON('fitness', d).catch(() => {});
    wellness = d.wellness || [];
  } catch (e) { wellness = []; }

  const out = M.scores({ loads: done.rides, from, to: today, today, shiftKey: tz.shiftKey, whoop, wellness });
  return Object.assign(out, {
    settings: { ftp: st.ftp, lthr: st.lthr },
    sources: {
      strava: { connected: !!done.connected, reason: done.reason || null, rides: (done.rides || []).length,
        basis: 'TSS from NP against FTP ' + st.ftp + ' W when Strava has power, heart rate against LTHR ' + st.lthr + ' otherwise' },
      whoop: { connected: !!(whoop && whoop.connected), synced_at: whoop ? whoop.synced_at : null,
        auth_error: whoop ? whoop.auth_error : null }
    }
  });
}

function attach(app) {
  app.get('/scores', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await build()); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, build };
