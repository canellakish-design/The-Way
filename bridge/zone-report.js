// ============================================================
// zone-report.js — the training zones page: the zones he trains by, where
// they sit on the heart-rate and power scales, and how his recent riding
// splits across them.
//
// The plan is three-zone (Seiler): Zone 1 under the first ventilatory
// threshold, Zone 3 above the second, Zone 2 the band between. The two
// thresholds are measured (Tymewear: VT1 117, VT2 139 bpm) and live in
// ride-math.js; the VO2 line (152, 94% of a 162 max) is the yardstick for
// the 40/20s. Power sits alongside from the planning FTP (workout-settings,
// 175 W): Zone 1 is what the library's trainer rides hold, 50 to 68% of
// FTP; the 40/20 "on" step is 109%.
//
// The seven-zone tables (Coggan power, %LTHR heart rate) come from zones.js
// for anyone who wants the finer cut; the page leads with the three.
//
// Time in zone is read from the rides' heart-rate streams already analysed
// (rides.js), this week and the last four, against the polarised target:
// three quarters of the minutes in Zone 1, a fifth in Zone 3, as little as
// possible in the middle. Rides without heart rate are counted by minutes
// only and said so.
//   GET /zones  →  { anchors, three, power_zones, hr_zones, time, rides, sessions }
// ============================================================
const { getJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const W = require('./workout-math');
const Z = require('./zones');
const R = require('./ride-math');
const { LIBRARY } = require('./workout-library');

const TARGET = { z1: 75, z2: 5, z3: 20 };
const pct = (a, b) => b > 0 ? Math.round(a / b * 100) : null;

function three(st) {
  const ftp = st.ftp, hr = R.HR;
  return [
    { key: 'z1', name: 'Zone 1', what: 'Easy. The base. Breathing through the nose, a sentence at a time.',
      hr: { lo: null, hi: hr.vt1 - 1, cue: `under ${hr.vt1 - 1}` }, power: { lo: Math.round(ftp * 0.50), hi: Math.round(ftp * 0.68), pct: '50–68%' },
      sessions: LIBRARY.filter(l => /^z1-/.test(l.key)).map(l => l.name), target_pct: TARGET.z1,
      why: 'Mitochondria, fat burning, the engine. Most of the riding, at an effort that costs little to recover from.' },
    { key: 'z2', name: 'Zone 2', what: 'Between the thresholds. Tempo and sweet spot. Hard enough to tire, not hard enough to change much.',
      hr: { lo: hr.vt1, hi: hr.vt2 - 1, cue: `${hr.vt1} to ${hr.vt2 - 1}` }, power: { lo: Math.round(ftp * 0.68), hi: Math.round(ftp * 0.95), pct: '68–95%' },
      sessions: LIBRARY.filter(l => /^mtb-/.test(l.key)).map(l => l.name), target_pct: TARGET.z2,
      why: 'The zone the plan avoids on purpose. Group rides and climbs drift here; the Zone 1 rule (watts come down when the heart rate climbs) is there to stop it.' },
    { key: 'z3', name: 'Zone 3', what: 'Hard. Threshold and above. The 40/20s live here.',
      hr: { lo: hr.vt2, hi: null, cue: `${hr.vt2} and up · VO2 above ${hr.hard}` }, power: { lo: Math.round(ftp * 0.95), hi: null, pct: '95%+' },
      sessions: LIBRARY.filter(l => /vo2/.test(l.key)).map(l => l.name), target_pct: TARGET.z3,
      why: `VO2 max and threshold. Judged by minutes above ${hr.hard} bpm, 8 to 12 a session. Once a week is enough; twice when recovery is green.` }
  ];
}

// by: 'hr' or 'power'. Power is the cleaner read of Zone 1 discipline (heart
// rate drifts with heat and coffee); heart rate is what the VO2 line is on.
function split(rides, by) {
  const k = by || 'hr';
  const withIt = rides.filter(r => r[k] && r[k].zones);
  const sum = z => Math.round(withIt.reduce((a, r) => a + (r[k].zones[z] || 0), 0));
  const z1 = sum('z1_min'), z2 = sum('z2_min'), z3 = sum('z3_min'), tot = z1 + z2 + z3;
  const all = Math.round(rides.reduce((a, r) => a + (r.minutes || 0), 0));
  return { by: k, rides: rides.length, with_data: withIt.length, minutes: all, z1_min: z1, z2_min: z2, z3_min: z3,
    z1_pct: pct(z1, tot), z2_pct: pct(z2, tot), z3_pct: pct(z3, tot),
    hard_min: k === 'hr' ? Math.round(withIt.reduce((a, r) => a + (r.hr.minutes_above_hard || 0), 0) * 10) / 10 : null };
}

function verdict(s) {
  if (!s || s.z1_pct == null) return { key: 'none', word: '', text: s && s.by === 'power' ? 'No power streams read yet.' : 'No heart-rate data yet. Rides with a strap or the WHOOP feed this.' };
  if (s.z1_pct >= 70 && s.z2_pct <= 15) return { key: 'green', word: 'polarised', text: `${s.z1_pct}% easy, ${s.z3_pct}% hard, ${s.z2_pct}% in the middle. That is the shape the plan wants.` };
  if (s.z2_pct > 30) return { key: 'red', word: 'middle-heavy', text: `${s.z2_pct}% of the minutes sat between the thresholds. Those rides were too hard to be easy and too easy to be hard. Bring the Zone 1 watts down.` };
  if (s.z3_pct > 30) return { key: 'yellow', word: 'too much hard', text: `${s.z3_pct}% hard. One hard session a week is the plan; the rest is Zone 1.` };
  return { key: 'yellow', word: 'drifting', text: `${s.z1_pct}% easy, ${s.z2_pct}% in the middle. Zone 1 means under ${R.HR.vt1 - 1}: when it climbs, the watts come down.` };
}

async function report() {
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const today = tz.todayKey();
  let analyses = {}, rides = [], connected = false;
  try {
    const { stravaDone } = require('./workouts');
    const win = await require('./rides').forWindow(tz.shiftKey(today, -27), today, st);
    connected = !!win.connected; analyses = win.analyses || {};
    const done = await stravaDone(tz.shiftKey(today, -27), today, st);
    rides = (done.rides || []).map(r => Object.assign({ id: r.id, date: r.date, name: r.name, minutes: r.minutes, tss: r.tss }, { hr: analyses[r.id] ? analyses[r.id].hr : null, power: analyses[r.id] ? analyses[r.id].power : null }))
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) { rides = []; }
  const week = rides.filter(r => r.date >= tz.shiftKey(today, -6)), month = rides;
  const sw = split(week, 'hr'), sm = split(month, 'hr'), pw = split(week, 'power'), pm = split(month, 'power');
  return {
    anchors: { ftp: st.ftp, lthr: st.lthr, vt1: R.HR.vt1, vt2: R.HR.vt2, vo2_line: R.HR.hard, max_hr: R.HR.max, hr_rest: st.hr_rest,
      note: 'Planning FTP and threshold heart rate from the workout settings; VT1 and VT2 measured (Tymewear). Zones move only when these are changed on the Setup page.' },
    three: three(st),
    target: TARGET,
    power_zones: Z.powerZones(st.ftp), hr_zones: Z.hrZones(st.lthr),
    time: { week: Object.assign(sw, { verdict: verdict(sw) }), month: Object.assign(sm, { verdict: verdict(sm) }),
      power_week: Object.assign(pw, { verdict: verdict(pw) }), power_month: Object.assign(pm, { verdict: verdict(pm) }) },
    rides: rides.slice(0, 12).map(r => ({ id: r.id, date: r.date, name: r.name, minutes: r.minutes, tss: r.tss,
      z1_min: r.hr && r.hr.zones ? Math.round(r.hr.zones.z1_min) : null, z2_min: r.hr && r.hr.zones ? Math.round(r.hr.zones.z2_min) : null, z3_min: r.hr && r.hr.zones ? Math.round(r.hr.zones.z3_min) : null,
      hard_min: r.hr ? r.hr.minutes_above_hard : null, avg_hr: r.hr ? r.hr.avg : null, estimated: r.hr ? r.hr.estimated || null : null,
      p1_min: r.power && r.power.zones ? Math.round(r.power.zones.z1_min) : null, p2_min: r.power && r.power.zones ? Math.round(r.power.zones.z2_min) : null, p3_min: r.power && r.power.zones ? Math.round(r.power.zones.z3_min) : null,
      np: r.power ? r.power.np : null, avg_w: r.power ? r.power.avg : null })),
    connected
  };
}

function attach(app) {
  app.get('/zones', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await report()); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, report, three, split, verdict, TARGET };
