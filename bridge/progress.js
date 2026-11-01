// ============================================================
// progress.js — is the engine getting better. Four outcomes, each on a
// four-week clock (the last 28 days against the 28 before), from rides
// that carry power, and power with heart rate:
//   tp     threshold power from the signature, refitted on the 90 days ending each week
//   p5     the best five minutes in the window (the VO2 end of the curve)
//   ef     watts a heartbeat on Zone 1 rides (the Zone 1 training's own scoreboard)
//   decoup heart-rate drift on steady rides of 90 minutes or more (Friel: under 5% is a base)
// Green when the month moved the right way, amber flat, red the wrong way,
// grey when there were not enough rides to say. CTL is not here: it is dose,
// not outcome, and lives on the Fitness line.
//   GET /progress
// ============================================================
const { getJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const WEEKS = 8, HALF = 28;
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const r1 = v => v == null ? null : Math.round(v * 10) / 10;

// the state of a metric from its two halves: up is good for the first three, down for decoupling
function stateOf(key, now, before, n) {
  if (now == null || before == null || (n && (n.now < 1 || n.before < 1))) return 'none';
  const d = now - before;
  if (key === 'tp') return d >= 2 ? 'good' : d > -2 ? 'warn' : 'bad';
  if (key === 'p5') return d >= 5 ? 'good' : d > -5 ? 'warn' : 'bad';
  if (key === 'ef') { const pct = before > 0 ? d / before * 100 : 0; return pct >= 2 ? 'good' : pct > -2 ? 'warn' : 'bad'; }
  if (key === 'decoup') { if (now <= 5) return 'good'; return d <= -1 ? 'good' : d < 1 ? 'warn' : 'bad'; }
  return 'none';
}

async function report() {
  const S = require('./signature');
  const Rd = require('./rides');
  const W = require('./workout-math');
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const today = tz.todayKey();
  const weekEnds = []; for (let k = WEEKS - 1; k >= 0; k--) weekEnds.push(tz.shiftKey(today, -7 * k));
  const nowFrom = tz.shiftKey(today, -HALF), beforeFrom = tz.shiftKey(today, -2 * HALF);
  const inNow = d => d > nowFrom && d <= today, inBefore = d => d > beforeFrom && d <= nowFrom;

  // --- the signature's rides: TP by week, best five minutes by window
  const sig = await getJSON('signature', { rides: {}, scanned: [] });
  const srides = Object.values(sig.rides || {}).filter(r => r && r.mmp && r.date);
  const tpAt = t => { const sub = srides.filter(r => r.date <= t && r.date > tz.shiftKey(t, -90)); if (sub.length < 3) return null; const f = S.fit(S.pointsOf(sub), { floor: false }); return f ? f.tp : null; };
  const tpSeries = weekEnds.map(t => ({ date: t, v: tpAt(t) }));
  const tpNow = tpSeries[tpSeries.length - 1].v, tpBefore = tpAt(nowFrom);
  const p5In = (a, b) => { const v = srides.filter(r => r.date > a && r.date <= b).map(r => r.mmp[300] || 0).filter(Boolean); return v.length ? Math.max(...v) : null; };
  const p5Series = weekEnds.map(t => ({ date: t, v: p5In(tz.shiftKey(t, -HALF), t) }));
  const p5Now = p5In(nowFrom, today), p5Before = p5In(beforeFrom, nowFrom);
  const nSig = { now: srides.filter(r => inNow(r.date)).length, before: srides.filter(r => inBefore(r.date)).length };

  // --- the ride analyses: watts a beat on Zone 1 rides, drift on long steady ones
  let rides = [], connected = false;
  try { const { stravaDone } = require('./workouts'); const d = await stravaDone(beforeFrom, today, st); rides = d.rides || []; connected = !!d.connected; } catch (e) { rides = []; }
  const an = []; let reread = 0;
  for (const r of rides) {
    let a = await getJSON(Rd.key(r.id), null);
    // a long ride read before the drift existed is read again, two a call, so the number fills in over a few loads
    if (a && a.power && a.hr && a.couple === undefined && (r.minutes || 0) >= 90 && reread < 2) { reread++; try { a = await Rd.analyze(r, { force: true, ftp: st.ftp }); } catch (e) { /* next time */ } }
    if (a) an.push(Object.assign({ minutes: r.minutes, date: r.date, name: r.name }, a));
  }
  const z1Rides = an.filter(a => a.power && a.hr && a.power.avg >= 60 && a.hr.avg > 60 && (a.minutes || 0) >= 45 && a.hr.zone_pct && a.hr.zone_pct.z1 >= 70)
    .map(a => ({ date: a.date, name: a.name, ef: Math.round(a.power.avg / a.hr.avg * 100) / 100 }));
  const efSeries = weekEnds.map(t => ({ date: t, v: r1(mean(z1Rides.filter(x => x.date > tz.shiftKey(t, -HALF) && x.date <= t).map(x => x.ef))) }));
  const efNowList = z1Rides.filter(x => inNow(x.date)), efBeforeList = z1Rides.filter(x => inBefore(x.date));
  const dRides = an.filter(a => a.couple && a.couple.steady && (a.minutes || 0) >= 90).map(a => ({ date: a.date, name: a.name, pct: a.couple.pct, ef: a.couple.ef }));
  const dSeries = weekEnds.map(t => ({ date: t, v: r1(mean(dRides.filter(x => x.date > tz.shiftKey(t, -HALF) && x.date <= t).map(x => x.pct))) }));
  const dNowList = dRides.filter(x => inNow(x.date)), dBeforeList = dRides.filter(x => inBefore(x.date));

  const metric = (key, label, unit, now, before, series, n, why, better) => ({ key, label, unit, now, before, delta: now != null && before != null ? Math.round((now - before) * 10) / 10 : null,
    series, n, state: stateOf(key, now, before, n), why, better });
  const metrics = [
    metric('tp', 'Threshold power', 'W', tpNow, tpBefore, tpSeries, nSig, 'the signature refitted on the 90 days ending each week; it moves only when a hard effort proves it', 'up'),
    metric('p5', 'Five-minute power', 'W', p5Now, p5Before, p5Series, nSig, 'the best five minutes in each 28 days, from the rides with power', 'up'),
    metric('ef', 'Watts a heartbeat, Zone 1', 'W/bpm', r1(mean(efNowList.map(x => x.ef))), r1(mean(efBeforeList.map(x => x.ef))), efSeries, { now: efNowList.length, before: efBeforeList.length }, 'average power over average heart rate on rides of 45 minutes or more spent 70% or more in Zone 1, with power and heart rate on the file', 'up'),
    metric('decoup', 'Decoupling', '%', r1(mean(dNowList.map(x => x.pct))), r1(mean(dBeforeList.map(x => x.pct))), dSeries, { now: dNowList.length, before: dBeforeList.length }, 'on steady rides of 90 minutes or more: how far watts a beat fell from the first half to the second; under 5% is a built base', 'down')
  ];
  const said = metrics.filter(m => m.state !== 'none');
  const word = !said.length ? 'Not enough rides with power yet to say which way the engine is moving.'
    : said.every(m => m.state === 'good') ? 'The engine is moving the right way on every count that has data.'
    : said.some(m => m.state === 'bad') ? `Moving the wrong way: ${said.filter(m => m.state === 'bad').map(m => m.label.toLowerCase()).join(', ')}.`
    : `Holding: ${said.filter(m => m.state === 'warn').map(m => m.label.toLowerCase()).join(', ')} flat over the month.`;
  return { today, window: { now_from: nowFrom, before_from: beforeFrom }, metrics, word, connected,
    counts: { signature_rides: srides.length, z1_rides: z1Rides.length, long_steady: dRides.length, reread } };
}

function attach(app) {
  app.get('/progress', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await report()); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, report, stateOf };
