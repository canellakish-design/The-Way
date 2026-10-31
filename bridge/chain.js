// ============================================================
// chain.js — the front page's chain: Sleep → Food → Micros → Water → Work →
// Recovery → Weight, every link on the same seven-day clock, and where it breaks.
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
const ORDER = ['sleep', 'food', 'micros', 'water', 'work', 'recovery', 'weight'];
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
      food: () => `food: on plan ${L.food.days_on} of ${L.food.days_logged} logged days, averaging ${L.food.week}.`,
      micros: () => `micros: ${L.micros.week} this week${L.micros.gaps && L.micros.gaps.length ? `, low on ${L.micros.gaps.slice(0, 3).join(', ')}` : ''}.`,
      water: () => `water: averaging ${L.water.week} this week; the scale will wobble with it.`,
      work: () => `workouts: ${L.work.done_min} of ${L.work.planned_min} planned minutes done.`,
      recovery: () => `recovery: averaging ${L.recovery.week}. The training is landing on a body that is not absorbing it.`
    }[first]();
    text = `Chain breaks at ${say}${wWord ? ` Weight ${wWord}.` : ''}`;
  }
  return { break_at: first || null, text };
}

// ---- the week's facts ----------------------------------------------------
async function pastDay(date, store) {
  if (store.days[date]) return store.days[date];
  const food = require('./food');
  const r = await food.dayReport(date);
  const logged = (r.entries || []).some(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
  const row = { food: logged && r.compliance ? r.compliance.overall : null, logged, water: r.hydration ? r.hydration.score : null, drunk_ml: r.hydration ? r.hydration.drunk_ml : null };
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
    if (store.days[d]) { rows[d] = store.days[d]; continue; }
    if (fresh >= NEW_PER_CALL) continue;
    try { rows[d] = await pastDay(d, store); fresh++; } catch (e) { /* that day stays unread */ }
  }
  let todayRow = null;
  try {
    const food = require('./food');
    const r = await food.dayReport(today);
    const logged = (r.entries || []).some(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
    todayRow = { food: logged && r.compliance ? r.compliance.overall : null, logged, water: r.hydration && r.hydration.now ? r.hydration.score : null, water_now: r.hydration && r.hydration.now ? r.hydration.now : null, drunk_ml: r.hydration ? r.hydration.drunk_ml : null, micros: r.micros ? { score: r.micros.score, word: r.micros.band && r.micros.band.word, gaps: (r.micros.gaps || []).map(g => g.label) } : null };
  } catch (e) { todayRow = null; }
  if (store.dirty) { delete store.dirty; for (const k of Object.keys(store.days)) if (k < tz.shiftKey(today, -45)) delete store.days[k]; await setJSON('chain-days', store).catch(() => {}); }
  const foodDays = past.map(d => rows[d]).filter(x => x && x.logged && x.food != null).map(x => x.food).concat(todayRow && todayRow.logged && todayRow.food != null ? [todayRow.food] : []);
  const waterDays = past.map(d => rows[d]).filter(x => x && x.water != null).map(x => x.water).concat(todayRow && todayRow.water != null ? [todayRow.water] : []);
  const readDays = past.filter(d => rows[d]).length + 1;

  // sleep and recovery: the Garmin's mornings through intervals.icu
  let nights = [], recs = [];
  try {
    const iv = require('./intervals');
    if (iv.configured()) {
      const w = await iv.wellnessRange(tz.shiftKey(today, -40), today);
      const all = (w.days || []);
      const M = require('./scores-math');
      for (const d of all) {
        if (d.date < dates[0]) continue;
        if (d.sleep_h != null) nights.push({ date: d.date, hours: d.sleep_h, score: d.sleep_score });
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
    for (const day of cal.days || []) { work.planned_min += day.totals.planned_min || 0; work.done_min += day.totals.done_min || 0; work.days.push({ date: day.date, planned_min: day.totals.planned_min, done_min: day.totals.done_min }); }
  } catch (e) { work = { planned_min: 0, done_min: 0, days: [] }; }
  // weight: the seven-day mean against the seven before
  let weight = null;
  try { weight = await require('./weighin').state(); } catch (e) { weight = null; }

  const sleepWeek = r1(avg(nights.map(n => n.hours)));
  const lastNight = nights.length ? nights[nights.length - 1] : null;
  const foodWeek = r0(avg(foodDays)), waterWeek = r0(avg(waterDays));
  const recWeek = r0(avg(recs.map(r => r.score))), recToday = recs.length && recs[recs.length - 1].date >= tz.shiftKey(today, -1) ? recs[recs.length - 1] : null;
  const workRatio = work.planned_min > 0 ? work.done_min / work.planned_min : (work.done_min > 0 ? 1 : null);
  const links = {
    sleep: { week: sleepWeek, state: stateOf('sleep', sleepWeek), today: lastNight ? lastNight.hours : null, today_word: lastNight && lastNight.score != null ? `score ${lastNight.score}` : (lastNight ? 'last night' : 'no watch'), unit: 'h a night', nights: nights.slice(-7), basis: 'hours asleep per night, from the Garmin through intervals.icu' },
    food: { week: foodWeek, state: foodDays.length >= 3 ? stateOf('food', foodWeek) : (foodDays.length ? stateOf('food', foodWeek) : 'none'), days_logged: foodDays.length, days_on: foodDays.filter(x => x >= 80).length, today: todayRow && todayRow.logged ? todayRow.food : null, unit: 'compliance', micros: todayRow ? todayRow.micros : null, basis: `the day's compliance score averaged over the logged days of the last ${DAYS} (${readDays} days read)` },
    micros: { week: todayRow && todayRow.micros ? todayRow.micros.score : null, state: stateOf('micros', todayRow && todayRow.micros ? todayRow.micros.score : null), today: todayRow && todayRow.micros ? todayRow.micros.score : null, today_word: todayRow && todayRow.micros ? todayRow.micros.word : null, gaps: todayRow && todayRow.micros ? todayRow.micros.gaps : [], unit: 'this week', basis: 'thirteen nutrients against their daily targets, averaged over the week\'s journal' },
    water: { week: waterWeek, state: stateOf('water', waterWeek), today: todayRow && todayRow.water_now ? todayRow.water_now.ml : null, today_word: todayRow && todayRow.water_now && todayRow.water_now.band ? todayRow.water_now.band.word : null, unit: 'score', basis: 'the hydration score (100 at the morning, 0 at 2% down) averaged over the week' },
    work: { week: workRatio == null ? null : Math.round(workRatio * 100), state: stateOf('work', workRatio), planned_min: work.planned_min, done_min: work.done_min, today: (work.days.find(d => d.date === today) || {}).done_min || 0, today_planned: (work.days.find(d => d.date === today) || {}).planned_min || 0, unit: '% of plan', basis: 'minutes ridden or lifted against minutes planned, this week' },
    recovery: { week: recWeek, state: stateOf('recovery', recWeek), today: recToday ? recToday.score : null, today_word: recToday && recToday.estimated ? 'estimated' : null, unit: 'average', days: recs.slice(-7), basis: 'Garmin training readiness, or an estimate from HRV against the month and the night\'s sleep' },
    weight: { week: weight ? weight.week_change_lb : null, state: stateOf('weight', weight ? weight.week_change_lb : null), today: weight && weight.latest ? Math.round(weight.latest.lb) : null, today_word: weight && weight.latest ? (weight.latest.logged_today ? 'today' : 'last reading') : null, unit: 'lb a week', since_start: weight ? weight.change_since_start_lb : null, basis: 'the seven-day mean weight against the seven days before it' }
  };
  const v = verdict(links);
  return { order: ORDER, links, break_at: v.break_at, verdict: v.text, days: DAYS, read_days: readDays };
}

function attach(app) {
  app.get('/chain', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await report()); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, report, verdict, stateOf, ORDER };
