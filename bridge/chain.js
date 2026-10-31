// ============================================================
// chain.js — the front page's chain: Sleep → Hydration → Macros → Micros →
// Lift → Ride → Recovery → Weight, every link on the same seven-day clock, and where it breaks.
//
// Weight is the lagging indicator at the end; the links before it are what
// move it, in roughly the order they act: sleep sets appetite and recovery,
// food sets the balance, water moves the scale day to day, the work done
// sets the spend and the fitness, recovery says whether the body is
// absorbing it. Today's numbers cannot have caused this week's weight, so
// each link is its seven-day value, with today beside it. The first link
// from the left that is not on target is where the chain breaks, and one
// sentence says so; when every link holds and the weight still does not
// move, the calorie target is the suspect, and the sentence says that too.
//
// Past days' food and water scores are kept in one small store once read,
// a couple of new days per call, so the page never waits on a week of
// recomputation.
//   GET /chain  → { links: {sleep, food, water, work, recovery, weight}, order, break, verdict }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const DAYS = 7, NEW_PER_CALL = 2;
const ORDER = ['sleep', 'water', 'food', 'micros', 'lift', 'work', 'recovery', 'weight'];
const avg = xs => { const v = xs.filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const r0 = x => x == null ? null : Math.round(x);

// ---- the states, one rule a link --------------------------------------
function stateOf(key, v) {
  if (v == null) return 'none';
  switch (key) {
    case 'sleep': return v >= 7 ? 'good' : v >= 6.25 ? 'warn' : 'bad';
    case 'food': case 'micros': case 'water': return v >= 80 ? 'good' : v >= 60 ? 'warn' : 'bad';
    case 'work': return v >= 0.85 ? 'good' : v >= 0.6 ? 'warn' : 'bad';
    case 'lift': return v >= 0.8 ? 'good' : v >= 0.5 ? 'warn' : 'bad';
    case 'recovery': return v >= 67 ? 'good' : v >= 50 ? 'warn' : 'bad';
    case 'weight': return v <= -0.3 ? 'good' : v <= 0.3 ? 'warn' : 'bad';
  }
  return 'none';
}

// Where the chain breaks, and the sentence. links: { key: { week, state, ... } }
function verdict(links) {
  const first = ORDER.slice(0, -1).find(k => links[k] && (links[k].state === 'bad' || links[k].state === 'warn'));
  const w = links.weight || {};
  const wWord = w.week == null ? null : w.week <= -0.3 ? `down ${Math.abs(w.week)} lb this week` : w.week <= 0.3 ? 'flat this week' : `up ${w.week} lb this week`;
  const L = links;
  let text;
  if (!first) {
    if (w.week == null) text = 'Every link holds. The scale has not said yet.';
    else if (w.state === 'good') text = `The chain holds: weight ${wWord}.`;
    else text = `Every link holds and weight is ${wWord}: the calorie target is the suspect, not the week.`;
  } else {
    const say = {
      sleep: () => `sleep: ${L.sleep.week} h a night this week. Appetite and recovery follow it.`,
      food: () => `macros: on plan ${L.food.days_on} of ${L.food.days_logged} logged days, averaging ${L.food.week}.`,
      micros: () => `micros: ${L.micros.week} this week${L.micros.gaps && L.micros.gaps.length ? `, low on ${L.micros.gaps.slice(0, 3).join(', ')}` : ''}.`,
      water: () => `hydration: ${L.water.week}% of target this week; the scale wobbles with it.`,
      work: () => `riding: ${L.work.done_min} of ${L.work.planned_min} planned minutes ridden.`,
      lift: () => `lifting: ${L.lift.sessions} of ${L.lift.target} sessions this week.`,
      recovery: () => `recovery: ${L.recovery.why || `${L.recovery.week}% against your band`}. The training is landing on a body that is not absorbing it.`
    }[first]();
    text = `Chain breaks at ${say}${wWord ? ` Weight ${wWord}.` : ''}`;
  }
  // a green recovery on a week that asked for little is not credit
  if (L.recovery && L.recovery.state === 'good' && L.work && L.lift && (L.work.state === 'bad' || L.work.state === 'warn') && (L.lift.state === 'bad' || L.lift.state === 'warn')) text += ' Recovery is green because little was asked of it.';
  return { break_at: first || null, text };
}

// ---- recovery against the rider's own band ----------------------------------
// The week's HRV (the mean of ln rMSSD over the last seven nights) against a
// 60-day baseline of the same, with a step of half the baseline's night-to-
// night spread (the smallest worthwhile change, Plews and Buchheit). Inside
// or above the band is green; one step under is a dip; two steps under, or
// one step under with the resting heart rate up and short sleep, is red.
// Fewer than fourteen nights and there is no band yet. The baseline moves
// with the rider, so green keeps meaning normal for the rider he is now.
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const sd = xs => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
function recoveryState(o) {
  const n = (o.hrv_week || []).length + (o.hrv_base || []).length;
  if (n < 14 || (o.hrv_week || []).length < 3 || (o.hrv_base || []).length < 7) return { state: 'none', steps: null, pct: null, why: `${n} nights so far; a band needs fourteen` };
  const lw = mean(o.hrv_week.map(Math.log)), lb = mean(o.hrv_base.map(Math.log)), s = Math.max(0.03, (sd(o.hrv_base.map(Math.log)) || 0.08) * 0.5);
  const steps = (lw - lb) / s, pct = Math.round((Math.exp(lw - lb) - 1) * 100);
  const rhrUp = o.rhr_week != null && o.rhr_base != null && o.rhr_sd != null && o.rhr_week > o.rhr_base + Math.max(0.8, 0.5 * o.rhr_sd);
  const shortSleep = o.sleep_week != null && o.sleep_week < 6.25;
  let state, why;
  if (steps <= -2) { state = 'bad'; why = `HRV ${pct}% under your band, two steps down`; }
  else if (steps <= -1 && rhrUp && shortSleep) { state = 'bad'; why = `HRV ${pct}% under your band with resting HR up and short sleep`; }
  else if (steps <= -1) { state = 'warn'; why = `HRV ${pct}% under your band: a dip`; }
  else { state = 'good'; why = steps >= 1 ? `HRV ${pct > 0 ? '+' : ''}${pct}% above your band` : `HRV inside your band (${pct > 0 ? '+' : ''}${pct}%)`; }
  return { state, steps: Math.round(steps * 10) / 10, pct, rhr_up: !!rhrUp, why };
}

// ---- the week's facts ----------------------------------------------------
const ROW_V = 2;   // bump when what a row holds changes; older rows are re-read
async function pastDay(date, store) {
  if (store.days[date] && store.days[date].v === ROW_V) return store.days[date];
  const food = require('./food');
  const r = await food.dayReport(date);
  const logged = (r.entries || []).some(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
  // water for a past day is what was drunk against the day's target, not the
  // end-of-day balance (which reads low on every day the last glass was not logged)
  const h = r.hydration || {};
  const row = { v: ROW_V, food: logged && r.compliance ? r.compliance.overall : null, logged, water: h.target_ml ? Math.min(100, Math.round((h.drunk_ml || 0) / h.target_ml * 100)) : null, drunk_ml: h.drunk_ml || null, target_ml: h.target_ml || null };
  store.days[date] = row; store.dirty = true;
  return row;
}

async function report() {
  const today = tz.todayKey();
  const dates = []; for (let i = DAYS - 1; i >= 0; i--) dates.push(tz.shiftKey(today, -i));
  const past = dates.slice(0, -1);
  const store = await getJSON('chain-days', { days: {} });
  store.dirty = false;
  // food and water: today live, past days from the store (a couple read fresh per call)
  let fresh = 0; const rows = {};
  for (const d of past) {
    if (store.days[d] && store.days[d].v === ROW_V) { rows[d] = store.days[d]; continue; }
    if (fresh >= NEW_PER_CALL) continue;
    try { rows[d] = await pastDay(d, store); fresh++; } catch (e) { /* that day stays unread */ }
  }
  let todayRow = null;
  try {
    const food = require('./food');
    const r = await food.dayReport(today);
    const logged = (r.entries || []).some(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
    const h = r.hydration || {};
    // today counts toward the week only once the day is mostly drunk: the share of the target so far, scaled to the share of the waking day gone
    const p = tz.parts(new Date()); const dayShare = Math.max(0.2, Math.min(1, (p.h * 60 + p.mi - 6 * 60) / (16 * 60)));
    todayRow = { food: logged && r.compliance ? r.compliance.overall : null, logged, water: h.target_ml ? Math.min(100, Math.round((h.drunk_ml || 0) / (h.target_ml * dayShare) * 100)) : null, water_now: h.now || null, drunk_ml: h.drunk_ml || null, target_ml: h.target_ml || null, micros: r.micros ? { score: r.micros.score, word: r.micros.band && r.micros.band.word, gaps: (r.micros.gaps || []).map(g => g.label) } : null };
  } catch (e) { todayRow = null; }
  if (store.dirty) { delete store.dirty; for (const k of Object.keys(store.days)) if (k < tz.shiftKey(today, -45)) delete store.days[k]; await setJSON('chain-days', store).catch(() => {}); }
  const foodDays = past.map(d => rows[d]).filter(x => x && x.logged && x.food != null).map(x => x.food).concat(todayRow && todayRow.logged && todayRow.food != null ? [todayRow.food] : []);
  const waterDays = past.map(d => rows[d]).filter(x => x && x.water != null).map(x => x.water).concat(todayRow && todayRow.water != null ? [todayRow.water] : []);
  const readDays = past.filter(d => rows[d]).length + 1;

  // sleep and recovery: the Garmin's mornings through intervals.icu
  let nights = [], recs = [], band = { state: 'none', why: 'no watch' }, hrvWeekMs = null, hrvBaseMs = null, rhrWeek = null;
  try {
    const iv = require('./intervals');
    if (iv.configured()) {
      const w = await iv.wellnessRange(tz.shiftKey(today, -60), today);
      const all = (w.days || []);
      const weekFrom = dates[0], baseFrom = tz.shiftKey(today, -60);
      const hrvWeek = all.filter(d => d.date >= weekFrom && d.hrv > 0).map(d => d.hrv);
      const hrvBase = all.filter(d => d.date >= baseFrom && d.date < weekFrom && d.hrv > 0).map(d => d.hrv);
      const rhrW = all.filter(d => d.date >= weekFrom && d.rhr > 0).map(d => d.rhr), rhrB = all.filter(d => d.date >= baseFrom && d.date < weekFrom && d.rhr > 0).map(d => d.rhr);
      const sleepW = all.filter(d => d.date >= weekFrom && d.sleep_h >= 2.5).map(d => d.sleep_h);
      band = recoveryState({ hrv_week: hrvWeek, hrv_base: hrvBase, rhr_week: mean(rhrW), rhr_base: mean(rhrB), rhr_sd: sd(rhrB), sleep_week: mean(sleepW) });
      hrvWeekMs = hrvWeek.length ? Math.round(mean(hrvWeek)) : null; hrvBaseMs = hrvBase.length ? Math.round(mean(hrvBase)) : null; rhrWeek = rhrW.length ? Math.round(mean(rhrW)) : null;
      const M = require('./scores-math');
      for (const d of all) {
        if (d.date < dates[0]) continue;
        // a night under two and a half hours is the watch off the wrist, not a night: kept in the list, left out of the mean
        if (d.sleep_h != null) nights.push({ date: d.date, hours: d.sleep_h, score: d.sleep_score, counted: d.sleep_h >= 2.5 });
        let score = d.readiness;
        if (score == null && (d.hrv != null || d.sleep_h != null)) {
          const hist = all.filter(x => x.date < d.date && x.hrv != null).slice(-30).map(x => x.hrv);
          const b = M.vsBaseline ? M.vsBaseline(d.hrv, hist) : { delta_pct: 0 };
          score = Math.max(10, Math.min(100, Math.round(60 + ((b && b.delta_pct) || 0) * 1.2 + ((d.sleep_h || 7) - 7) * 8)));
        }
        if (score != null) recs.push({ date: d.date, score, hrv: d.hrv, estimated: d.readiness == null });
      }
    }
  } catch (e) { nights = []; recs = []; }
  // work: minutes done against minutes planned over the week
  let work = { planned_min: 0, done_min: 0, days: [] };
  try {
    const { calendar } = require('./workouts');
    const cal = await calendar(dates[0], today);
    // riding only: the lifting is its own link. Planned: the plan's rides and intervals.icu's; done: Strava's rides and rides logged by hand.
    const isWeight = x => /weight|lift|strength/i.test(String(x.sport || x.type || ''));
    for (const day of cal.days || []) {
      const planned = (day.planned || []).filter(w => !isWeight(w)).reduce((a, w) => a + Math.round((w.metrics ? w.metrics.duration_s : 0) / 60), 0)
        + (day.intervals || []).filter(e => !isWeight(e)).reduce((a, e) => a + (e.minutes || 0), 0);
      const done = (day.done || []).filter(r => !isWeight(r)).reduce((a, r) => a + (r.minutes || 0), 0)
        + (day.planned || []).filter(w => !isWeight(w) && w.logged).reduce((a, w) => a + Math.round((w.metrics ? w.metrics.duration_s : 0) / 60), 0);
      work.planned_min += planned; work.done_min += done; work.days.push({ date: day.date, planned_min: planned, done_min: done });
    }
  } catch (e) { work = { planned_min: 0, done_min: 0, days: [] }; }
  // the morning after a hard day: a low reading is expected, and says so
  let hardYesterday = null;
  try {
    const { calendar } = require('./workouts');
    const cal = await calendar(tz.shiftKey(today, -1), tz.shiftKey(today, -1));
    const d0 = (cal.days || [])[0];
    const hard = d0 ? (d0.done || []).find(r => /vo2|40\s*\/\s*20|threshold|race|interval/i.test(String(r.name || '').replace(/intervals\.?\s*icu/ig, '')) || (r.tss || 0) >= 60 || (r.minutes || 0) >= 120) : null;
    hardYesterday = hard ? hard.name.replace(/^Zwift - Intervals icu: /i, '').slice(0, 30) : null;
  } catch (e) { hardYesterday = null; }
  // lift: sessions logged this week against the plan's five (the Lift tab's store, read directly)
  let lift = { sessions: 0, pumps: 0, target: 5, today: [], week: [] };
  try {
    const d = await getJSON('lifts', { sessions: [] });
    const L = require('./lifts');
    const all7 = (d.sessions || []).filter(x => x.date >= dates[0] && x.date <= today);
    const pumps = all7.filter(x => x.template === 'pump').length;
    const wk = all7.filter(x => x.template !== 'pump');
    const nameOf = k => (L.TEMPLATES.find(t => t.key === k) || {}).short || (L.TEMPLATES.find(t => t.key === k) || {}).name || k;
    // the plan's clock: from the first session on this plan; the first week is judged on pace, a ninth week is a deload
    const first = (d.sessions || []).filter(x => L.TEMPLATES.some(t => t.key === x.template)).map(x => x.date).sort()[0] || null;
    const dayN = first ? Math.round((Date.parse(today) - Date.parse(first)) / 864e5) + 1 : 0;
    const weekNo = first ? Math.floor((dayN - 1) / 7) + 1 : 0;
    const expected = !first ? 0 : dayN < 7 ? Math.min(5, Math.ceil(5 * dayN / 7)) : 5;
    lift = { sessions: wk.length, pumps, target: 5, expected, started: !!first, deload: weekNo > 0 && weekNo % 9 === 0, week_no: weekNo,
      today: wk.filter(x => x.date === today).map(x => nameOf(x.template)), week: wk.map(x => ({ date: x.date, name: nameOf(x.template), volume_lb: (x.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, q) => b + (q.lb || 0) * (q.reps || 0), 0), 0) })) };
  } catch (e) { /* no lifts yet */ }
  // weight: the seven-day mean against the seven before
  let weight = null;
  try { weight = await require('./weighin').state(); } catch (e) { weight = null; }

  const sleepWeek = r1(avg(nights.filter(n => n.counted).map(n => n.hours)));
  const lastNight = nights.length ? nights[nights.length - 1] : null;
  const foodWeek = r0(avg(foodDays)), waterWeek = r0(avg(waterDays));
  const recWeek = r0(avg(recs.map(r => r.score))), recToday = recs.length && recs[recs.length - 1].date >= tz.shiftKey(today, -1) ? recs[recs.length - 1] : null;
  const workRatio = work.planned_min > 0 ? work.done_min / work.planned_min : (work.done_min > 0 ? 1 : null);
  const links = {
    sleep: { week: sleepWeek, state: stateOf('sleep', sleepWeek), today: lastNight ? lastNight.hours : null, today_word: lastNight && lastNight.score != null ? `score ${lastNight.score}` : (lastNight ? 'last night' : 'no watch'), unit: 'h a night', nights: nights.slice(-7), basis: 'hours asleep per night, from the Garmin through intervals.icu' },
    food: { week: foodWeek, state: foodDays.length >= 3 ? stateOf('food', foodWeek) : (foodDays.length ? stateOf('food', foodWeek) : 'none'), days_logged: foodDays.length, days_on: foodDays.filter(x => x >= 80).length, today: todayRow && todayRow.logged ? todayRow.food : null, unit: 'compliance', micros: todayRow ? todayRow.micros : null, basis: `the day's compliance score averaged over the logged days of the last ${DAYS} (${readDays} days read)` },
    micros: { week: todayRow && todayRow.micros ? todayRow.micros.score : null, state: stateOf('micros', todayRow && todayRow.micros ? todayRow.micros.score : null), today: todayRow && todayRow.micros ? todayRow.micros.score : null, today_word: todayRow && todayRow.micros ? todayRow.micros.word : null, gaps: todayRow && todayRow.micros ? todayRow.micros.gaps : [], unit: 'this week', basis: 'thirteen nutrients against their daily targets, averaged over the week\'s journal' },
    water: { week: waterWeek, state: stateOf('water', waterWeek), today: todayRow && todayRow.water_now ? todayRow.water_now.ml : null, today_word: todayRow && todayRow.water_now && todayRow.water_now.band ? todayRow.water_now.band.word : null, unit: 'of target', basis: 'what was drunk against each day\'s target, averaged over the week' },
    work: { week: workRatio == null ? null : Math.round(workRatio * 100), state: stateOf('work', workRatio), planned_min: work.planned_min, done_min: work.done_min, today: (work.days.find(d => d.date === today) || {}).done_min || 0, today_planned: (work.days.find(d => d.date === today) || {}).planned_min || 0, unit: '% of plan', basis: 'minutes ridden against minutes of riding planned, this week; the lifting is its own link' },
    // grey before the first session and in a deload week; in the first week, judged against the sessions due so far
    lift: { week: lift.started ? Math.round(lift.sessions / lift.target * 100) : null,
      state: !lift.started || lift.deload ? 'none' : stateOf('lift', lift.sessions / Math.max(1, lift.expected)),
      sessions: lift.sessions, pumps: lift.pumps || 0, target: lift.target, expected: lift.expected, started: lift.started, deload: lift.deload, week_no: lift.week_no,
      today: lift.today.length, today_word: lift.today.length ? lift.today.join(', ') : (!lift.started ? 'not started' : lift.deload ? 'deload week' : null), week_list: lift.week, unit: 'of plan',
      basis: 'sessions logged on the Lift tab in the last seven days against the plan\'s five; the first week is judged on pace' },
    recovery: (() => {
      const todayScore = recToday ? recToday.score : null;
      const dayBand = todayScore == null ? null : todayScore >= 67 ? 'good' : todayScore >= 34 ? 'warn' : 'bad';
      const dip = dayBand && dayBand !== 'good' && hardYesterday;
      // the border is the week against the band; a red morning takes it red for the day
      const state = band.state === 'none' ? 'none' : dayBand === 'bad' ? 'bad' : band.state;
      return { week: band.pct, state, week_state: band.state, steps: band.steps, why: band.why, hrv_week_ms: hrvWeekMs, hrv_base_ms: hrvBaseMs, rhr_week: rhrWeek, rhr_up: band.rhr_up,
        score_week: recWeek, today: todayScore, today_band: dayBand, today_word: dip ? `dip after ${hardYesterday} · normal` : dayBand === 'bad' ? 'red morning: easy day' : (recToday && recToday.estimated ? 'estimated' : null),
        hard_yesterday: hardYesterday, days: recs.slice(-7), unit: 'vs band', basis: 'the week\'s HRV against your own 60-day band (a step is half its night-to-night spread); the morning line is the day\'s readiness' };
    })(),
    weight: { week: weight ? weight.week_change_lb : null, state: stateOf('weight', weight ? weight.week_change_lb : null), today: weight && weight.latest ? Math.round(weight.latest.lb) : null, today_word: weight && weight.latest ? (weight.latest.logged_today ? 'today' : 'last reading') : null, unit: 'lb a week', since_start: weight ? weight.change_since_start_lb : null, basis: 'the seven-day mean weight against the seven days before it' }
  };
  const v = verdict(links);
  return { order: ORDER, links, break_at: v.break_at, verdict: v.text, days: DAYS, read_days: readDays };
}

function attach(app) {
  app.get('/chain', async (req, res) => { if (!auth(req, res)) return;
    try {
      const r = await report();
      // a compact copy for the advisor, which cannot afford the full read inside a turn
      try { await setJSON('chain-last', { at: Date.now(), verdict: r.verdict, break_at: r.break_at,
        links: Object.fromEntries(ORDER.map(k => [k, { week: r.links[k].week, state: r.links[k].state, today: r.links[k].today, today_word: r.links[k].today_word || null, why: r.links[k].why || null }])) }); } catch (e) { /* no store */ }
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, report, verdict, stateOf, recoveryState, ORDER };
