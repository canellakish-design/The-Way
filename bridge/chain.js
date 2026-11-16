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
// weight and power close the chain: they are what the links before them produce, so the break is never looked for there
const ORDER = ['plan', 'sleep', 'water', 'food', 'micros', 'lift', 'fuel', 'work', 'recovery', 'weight', 'power'];
const OUTCOMES = ['weight', 'power'];
const PLAN_RIDE_MIN = 360;      // a planned week: six hours of riding on the calendar, five lifts, every ride with a start time
const avg = xs => { const v = xs.filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const r0 = x => x == null ? null : Math.round(x);

// ---- the states, one rule a link --------------------------------------
function stateOf(key, v) {
  if (v == null) return 'none';
  switch (key) {
    case 'sleep': return v >= 7 ? 'good' : v >= 6.25 ? 'warn' : 'bad';
    case 'food': case 'micros': return v >= 80 ? 'good' : v >= 60 ? 'warn' : 'bad';
    // the hydration score is 100 at the morning and 0 at 2% of body weight down, so the tile's
    // bands map to it as: under 1% down (50 and up) fine, 1 to 1.5% behind, past that dry
    case 'water': return v >= 50 ? 'good' : v >= 25 ? 'warn' : 'bad';
    case 'work': return v >= 0.85 ? 'good' : v >= 0.6 ? 'warn' : 'bad';
    case 'fuel': return v >= 0.8 ? 'good' : v >= 0.6 ? 'warn' : 'bad';   // the share of what the rides asked for that went in; it never passes 100
    case 'lift': return v >= 0.8 ? 'good' : v >= 0.5 ? 'warn' : 'bad';
    case 'recovery': return v >= 67 ? 'good' : v >= 34 ? 'warn' : 'bad';   // the published bands, the same as the tile's
    case 'weight': return v <= -0.8 ? 'good' : v <= 0.3 ? 'warn' : 'bad';
    case 'plan': return v >= 0.8 ? 'good' : v >= 0.5 ? 'warn' : 'bad';     // a pound a week down is the pace; 0.8 allows for the scale
  }
  return 'none';
}

// Where the chain breaks, and the sentence. links: { key: { week, state, ... } }
function verdict(links) {
  const first = ORDER.filter(k => !OUTCOMES.includes(k)).find(k => links[k] && (links[k].state === 'bad' || links[k].state === 'warn'));
  const w = links.weight || {};
  // short: the link, its number, nothing the box already says (Harry, 9 Nov: "too many words")
  const wWord = w.week == null ? null : w.week <= -0.8 ? `down ${Math.abs(w.week)} lb/wk, on pace` : w.week < -0.2 ? `down ${Math.abs(w.week)} lb/wk, under 1 lb` : w.week <= 0.3 ? 'flat' : `up ${w.week} lb/wk`;
  const L = links;
  let text;
  if (!first) {
    if (w.week == null) text = 'Every link holds. No weight yet.';
    else if (w.creatine_water && w.week > 0) text = `Every link holds. Weight ${wWord}: creatine water until day 14 (day ${w.creatine_days}).`;
    else if (w.state === 'good') text = `Chain holds. Weight ${wWord}.`;
    else text = `Every link holds, weight ${wWord}: check the calorie target.`;
  } else {
    const say = {
      sleep: () => `sleep: ${L.sleep.week} h a night.`,
      food: () => `macros: ${L.food.days_on} of ${L.food.days_logged} days on plan${L.food.kcal_today != null && L.food.kcal_target ? `; today ${L.food.kcal_today.toLocaleString('en-US')} of ${L.food.kcal_target.toLocaleString('en-US')} kcal${L.food.protein_today != null && L.food.protein_target ? `, ${L.food.protein_today} of ${L.food.protein_target} g protein` : ''}` : ''}.`,
      micros: () => `micros: ${L.micros.week}${L.micros.gaps && L.micros.gaps.length ? `, low ${L.micros.gaps.slice(0, 3).join(', ')}` : ''}.`,
      water: () => `water: ${L.water.week} balance.`,
      plan: () => `planning: ${L.plan.ride_min} of ${L.plan.ride_target_min} ride min placed${L.plan.week_label ? ` (${L.plan.week_label})` : ''}, ${L.plan.lifts} of 5 lifts${L.plan.untimed ? `, ${L.plan.untimed} untimed` : ''}.`,
      fuel: () => `fuelling: ${L.fuel.week}% of plan.`,
      work: () => `riding: ${L.work.done_min} of ${L.work.planned_min} min${L.work.in_zone_pct != null && L.work.in_zone_pct < 95 ? `, ${L.work.in_zone_pct}% in zone` : ''}.`,
      lift: () => `lifting: ${L.lift.count_word || `${L.lift.sessions} of ${L.lift.target}`}.`,
      recovery: () => `recovery: ${L.recovery.why || `${L.recovery.week}% vs band`}.`
    }[first]();
    // red is a break; amber is a weak link: the chain holds, with a warning on it
    text = `${links[first].state === 'bad' ? 'Chain breaks at' : 'Chain weak at'} ${say}${wWord ? ` Weight ${wWord}.` : ''}`;
  }
  // a green recovery on a week that asked for little is not credit
  if (L.recovery && L.recovery.state === 'good' && L.work && L.lift && (L.work.state === 'bad' || L.work.state === 'warn') && (L.lift.state === 'bad' || L.lift.state === 'warn')) text += ' Recovery green: little asked.';
  return { break_at: first || null, break_state: first ? links[first].state : null, text };
}

// ---- what got better (Harry, 16 Nov 2026: "when things improve that should be highlighted a bit more by the
// Coach … I moved from yellow to green for sleep … so we can focus a bit more on the positive") ------------
// Every time the chain is read, each link's colour is set against the colour it had at the read before, and a
// change is written down as a move (store: chain-moves). A win is the latest move of a link, upward, that still
// holds: so a link that rose and fell back is not one. Grey says nothing either way.
const RANK = { bad: 0, warn: 1, good: 2 };
const LINK_NAME = { plan: 'Plan', sleep: 'Sleep', water: 'Hydration', food: 'Macros', micros: 'Micros', lift: 'Lift', fuel: 'Fuel', work: 'Ride', recovery: 'Recovery', weight: 'Weight', power: 'Power' };
const COLOUR = { bad: 'red', warn: 'amber', good: 'green' };
const valueWord = (k, L) => L.week == null ? '' : k === 'sleep' ? `${L.week} h a night this week` : k === 'food' || k === 'micros' ? `${L.week} on average this week`
  : k === 'fuel' ? `${L.week}% fuelled this week` : k === 'work' ? `${L.week}% of the riding planned` : k === 'plan' ? `${L.week}% of the week ahead placed` : k === 'water' ? `balance ${L.week} this week`
  : k === 'lift' ? (L.count_word || `${L.sessions} lifts this week`) : k === 'weight' ? `${L.week > 0 ? '+' : ''}${L.week} lb a week` : k === 'power' ? `FTP ${L.week} W` : k === 'recovery' ? `${L.week}${L.week_kind === 'score' ? ' average' : '% against your band'}` : `${L.week}`;
// pure: the colours kept and the links now → the colours to keep and the moves made, up or down
function movesOf(kept, links, at, date) {
  const states = Object.assign({}, kept || {}), moves = [];
  for (const k of ORDER) { const L = links[k]; if (!L || RANK[L.state] == null) continue;
    const was = states[k];
    if (was && RANK[was.s] != null && was.s !== L.state) moves.push({ key: k, name: LINK_NAME[k], from: was.s, to: L.state, up: RANK[L.state] > RANK[was.s], week: L.week, was: was.w, word: valueWord(k, L), at, date });
    states[k] = { s: L.state, w: L.week }; }
  return { states, moves };
}
// pure: the wins of the last `days` days (0: today's): the latest move of each link, when it is upward and still holds
function winsOf(moves, links, today, days) {
  const from = tz.shiftKey(today, -(days || 0)), last = {};
  for (const m of moves || []) if (m.date >= from) last[m.key] = m;
  return Object.values(last).filter(m => m.up && links[m.key] && RANK[links[m.key].state] != null && RANK[links[m.key].state] >= RANK[m.to])
    .map(m => Object.assign({}, m, { text: `${m.name} moved from ${COLOUR[m.from]} to ${COLOUR[m.to]}${m.word ? `: ${m.word}` : ''}` }));
}
async function trackMoves(links, today) {
  let d = await getJSON('chain-moves', null), fresh = false;
  if (!d || !d.states) {
    // the first read has nothing to set against. Sleep and Macros are seeded from the record of the seven days
    // before today (history.js), so a link that turned on the very day this began is still seen to have moved
    d = { states: {}, moves: [] }; fresh = true;
    try { const H = require('./history'), rs = await Promise.race([H.rows(tz.shiftKey(today, -7), tz.shiftKey(today, -1), { budgetMs: 3000 }), new Promise(r => setTimeout(() => r([]), 3500))]);
      const mean = v => { const x = v.filter(y => y != null); return x.length >= 3 ? x.reduce((a, b) => a + b, 0) / x.length : null; };
      const sl = mean(rs.map(r => r.sleep_h)), fd = mean(rs.map(r => r.food ? r.food.score : null));
      if (sl != null) d.states.sleep = { s: stateOf('sleep', sl), w: Math.round(sl * 10) / 10 };
      if (fd != null) d.states.food = { s: stateOf('food', fd), w: Math.round(fd) };
    } catch (e) { /* it starts from today's colours */ }
  }
  const M = movesOf(d.states, links, new Date().toISOString(), today);
  const changed = fresh || M.moves.length || ORDER.some(k => M.states[k] && (!d.states[k] || d.states[k].s !== M.states[k].s || d.states[k].w !== M.states[k].w));
  const moves = (d.moves || []).concat(M.moves).filter(m => m.date >= tz.shiftKey(today, -30)).slice(-80);
  if (changed) await setJSON('chain-moves', { states: M.states, moves, at: Date.now() }).catch(() => {});
  return { wins: winsOf(moves, links, today, 0), wins_week: winsOf(moves, links, today, 6), slips: moves.filter(m => m.date === today && !m.up).map(m => ({ key: m.key, name: m.name, from: m.from, to: m.to })) };
}

// ---- recovery against the rider's own band: recovery.js, the one model the whole site reads ----
const { recoveryState, mean, sd } = require('./recovery');

// ---- the week's facts ----------------------------------------------------
const ROW_V = 10;   // 10: the fuel calculus of 16 Nov (the ride's own prescription, the tank at its start, capped parts, weighted rides)   // 9: protein over its figure costs nothing   // 8: the weighted fuel mean   // 7: the after window and the low before   // 5: fuel checks   // bump when what a row holds changes; older rows are re-read
// Fuel for a day (the calculus of 16 Nov 2026; Harry: "What do you think of all this fueling? Any way to improve
// the calculus?" … "Do it"). Each ride is scored on what its own prescription asked for (food-math.js sessionRx,
// carried on the session as rx), not on whatever meals the plan happened to put near it:
//   before   was the tank at what the ride needs when it began (the live fuel model's reading at its start: the
//            quick store and the legs against the ride's need). When he ate does not matter, only what was on
//            board. A ride the plan keeps low (train-low) is the one place over costs: at or under its 20 g is
//            the point. With no tank reading, the carbs of the four hours before against the prescription.
//   bottle   the carbs taken on the bike against the prescription's, when it gives any (none under 75 minutes easy).
//   after    the meal after: protein and carbs against the prescription, weighted to carbs after a hard or long
//            ride (recover high, inside two hours) and to protein after an easy one (the next meal, inside three).
//            What lands in the hour past the window counts at half, so a dinner five minutes late is not a zero.
//   supp     beetroot before a hard or long ride, bicarbonate before a hard one. Not asked of an easy ride.
// Every part is a share from 0 to 1 and never more: a surplus in one cannot hide a gap in another, and over is
// the Macros link's business. The parts are weighed by the kind of ride (FUEL_WEIGHTS) and the week weighs its
// rides by how much fuelling them matters (RIDE_WEIGHT): one VO2 session counts as three easy hours.
// What was not logged is not scored as missed: a ride on a day with no food in the journal has no score, and a
// bottle or a meal after it with nothing at all logged in its window is left out and named (unlogged), so the
// coach can ask once. Lifts and runs are not fuel checks. A ride is scored from the minute it starts.
const NOT_RIDE = /lift|weight|strength|push|pull|upper|legs|pump|\brun\b|treadmill/i;
const FUEL_WEIGHTS = {
  hard:  { pre: 0.35, bottle: 0.35, after: 0.25, supp: 0.05 },
  long:  { pre: 0.30, bottle: 0.40, after: 0.25, supp: 0.05 },
  light: { pre: 0.40, bottle: 0.20, after: 0.40, supp: 0 },
  low:   { pre: 0.50, bottle: 0, after: 0.50, supp: 0 }
};
const RIDE_WEIGHT = { hard: 3, long: 3, light: 1, low: 1 };
const AFTER_CARB_SHARE = { hard: 0.6, long: 0.6, light: 0.3, low: 0.3 };
const AFTER_WINDOW_MIN = { hard: 120, long: 120, light: 180, low: 180 }, AFTER_TAIL_MIN = 60;
const HARD_NAME = /vo2|40\s*\/\s*20|threshold|race|interval|sweet/i;
const cap1 = v => Math.max(0, Math.min(1, v));
const fuelMean = (parts, kind) => { const W = FUEL_WEIGHTS[kind] || FUEL_WEIGHTS.light, on = parts.filter(p => !p.unlogged && p.ratio != null && (W[p.kind] || 0) > 0);
  const w = on.reduce((a, p) => a + W[p.kind], 0); return w ? on.reduce((a, p) => a + p.ratio * W[p.kind], 0) / w : null; };
function fuelChecks(r) {
  const F = require('./food-math');
  const out = [];
  const rides = (r.sessions || []).filter(x => F.toMin(x.time) != null && !NOT_RIDE.test(x.name || '') && !/WeightTraining|Run/i.test(x.sport || ''));
  const food = (r.entries || []).filter(e => !e.supplement);
  const ents = food.filter(e => F.toMin(e.time) != null);
  const supTaken = k => (r.entries || []).filter(e => e.supplement && e.key === k).length;
  // today a ride is scored from its start, and its after part once the two hours have run
  const nowMin = r.date === tz.todayKey() ? (() => { const p = tz.parts(new Date()); return p.h * 60 + p.mi; })() : 24 * 60;
  const starts = (r.energy && r.energy.starts) || [];
  let suppDone = false;
  rides.forEach(x => {
    const st = F.toMin(x.time), mins = x.minutes || 60, end = st + mins;
    if (st > nowMin) return;
    // a ride that was planned and never ridden is not a fuel check; today's, under way or just ended, is
    if (!(x.done || x.kept) && !(r.date === tz.todayKey() && nowMin < end + 60)) return;
    const nameHard = HARD_NAME.test(String(x.name || '').replace(/intervals\.?\s*icu/ig, ''));
    const rx = x.rx || {}, kind = FUEL_WEIGHTS[rx.kind] ? rx.kind : nameHard ? 'hard' : mins >= 120 ? 'long' : 'light';
    const base = { kind: 'ride', name: x.name, time: x.time, rx_kind: kind, weight: RIDE_WEIGHT[kind] || 1 };
    // a day with nothing in the journal says nothing about how the ride was fuelled
    if (!food.some(e => (e.kcal || 0) > 0 || (e.carbs_g || 0) > 0)) { out.push(Object.assign(base, { ratio: null, pct: null, parts: [], not_logged: true, unlogged: ['the day'], ok: false, near: false })); return; }
    const parts = [];
    // ---- before
    const ate = ents.filter(e => F.toMin(e.time) >= st - 240 && F.toMin(e.time) < st).reduce((a, e) => a + (e.carbs_g || 0), 0);
    const tank = starts.find(q => q.time === x.time && q.name === x.name) || starts.find(q => q.time === x.time) || null;
    if (kind === 'low' || rx.low) {
      const lim = (rx.before_g || 20) * 1.25;
      parts.push({ kind: 'pre', low: true, got_g: Math.round(ate), plan_g: rx.before_g || 20, ratio: ate <= lim ? 1 : cap1(lim / ate), word: ate <= lim ? 'kept low, as planned' : 'over the low the plan asked for' });
    } else if (tank && tank.need != null) {
      const q = tank.need > 0 ? tank.pct / tank.need : 1, l = tank.need_legs > 0 ? tank.legs_pct / tank.need_legs : 1, ratio = cap1(Math.min(q, l));
      parts.push({ kind: 'pre', by: 'tank', tank_pct: tank.pct, need: tank.need, legs_pct: tank.legs_pct, need_legs: tank.need_legs, got_g: Math.round(ate), plan_g: rx.before_g != null ? rx.before_g : null, ratio,
        word: ratio >= 1 ? `tank ${tank.pct}% at the start, ${tank.need}% needed` : q <= l ? `tank ${tank.pct}% at the start, ${tank.need}% needed` : `legs ${tank.legs_pct}% at the start, ${tank.need_legs}% needed` });
    } else if (rx.before_g > 0) {
      parts.push({ kind: 'pre', by: 'grams', got_g: Math.round(ate), plan_g: rx.before_g, ratio: cap1(ate / rx.before_g), word: `${Math.round(ate)} of ${rx.before_g} g carbs in the four hours before` });
    }
    // ---- on the bike
    if (rx.during_g > 0 && nowMin >= end) {
      const win = (r.entries || []).filter(e => F.toMin(e.time) != null && F.toMin(e.time) >= st - 15 && F.toMin(e.time) <= end + 15);
      const got = win.filter(e => !e.supplement && (e.slot === 'on the bike' || F.toMin(e.time) >= st)).reduce((a, e) => a + (e.carbs_g || 0), 0);
      const none = !win.filter(e => !e.supplement).length;
      parts.push({ kind: 'bottle', got_g: Math.round(got), plan_g: rx.during_g, ratio: none ? null : cap1(got / rx.during_g), unlogged: none || undefined, word: none ? 'nothing logged on the bike' : `${Math.round(got)} of ${rx.during_g} g carbs on the bike` });
    }
    // ---- after: the window from the end, once it has run; the hour past it at half
    const aw = AFTER_WINDOW_MIN[kind] || 120;
    if ((rx.after_g > 0 || rx.after_protein_g > 0) && (x.done || x.kept) && nowMin >= end + aw) {
      const share = e => { const t = F.toMin(e.time); return e.slot === 'on the bike' || t < end - 5 || t > end + aw + AFTER_TAIL_MIN ? 0 : t <= end + aw ? 1 : 0.5; };
      const c = ents.reduce((a, e) => a + (e.carbs_g || 0) * share(e), 0), pr = ents.reduce((a, e) => a + (e.protein_g || 0) * share(e), 0);
      const none = !ents.some(e => F.toMin(e.time) >= end - 5 && (e.kcal || 0) > 0);            // no food at all logged after it that day
      const late = ents.some(e => share(e) === 0.5 && (e.kcal || 0) > 0) && !ents.some(e => share(e) === 1 && (e.protein_g || 0) >= 15);
      const cs = AFTER_CARB_SHARE[kind] != null ? AFTER_CARB_SHARE[kind] : 0.5, pc = rx.after_g > 0 ? cap1(c / rx.after_g) : null, pp = rx.after_protein_g > 0 ? cap1(pr / rx.after_protein_g) : null;
      const ratio = pc == null ? pp : pp == null ? pc : cs * pc + (1 - cs) * pp, hrs = aw === 120 ? 'two' : 'three';
      parts.push({ kind: 'after', got_g: Math.round(c), plan_g: rx.after_g || 0, got_protein_g: Math.round(pr), plan_protein_g: rx.after_protein_g || 0, window_min: aw, late: late || undefined, ratio: none ? null : ratio, unlogged: none || undefined,
        word: none ? 'no food logged after it' : `${Math.round(pr)} of ${rx.after_protein_g || 0} g protein and ${Math.round(c)} of ${rx.after_g || 0} g carbs in the ${hrs} hours after${late ? ' (the meal came late: counted at half)' : ''}` });
    }
    // ---- supplements: only where they do something, once a day
    if (!suppDone && (kind === 'hard' || kind === 'long')) {
      suppDone = true;
      const due = ['beetroot'].concat(kind === 'hard' ? ['sodium_bicarb'] : []), taken = due.reduce((a, k) => a + Math.min(1, supTaken(k)), 0);
      parts.push({ kind: 'supp', got: taken, due: due.length, keys: due, ratio: cap1(taken / due.length), word: `${taken} of ${due.length} taken (${due.map(k => k === 'sodium_bicarb' ? 'bicarbonate' : k).join(', ')})` });
    }
    const ratio = fuelMean(parts, kind), unlogged = parts.filter(p => p.unlogged).map(p => p.kind === 'bottle' ? 'the bottle' : 'the meal after');
    if (!parts.length) return;
    out.push(Object.assign(base, { ratio: ratio == null ? null : Math.round(ratio * 100) / 100, pct: ratio == null ? null : Math.round(ratio * 100), parts, unlogged: unlogged.length ? unlogged : undefined,
      not_logged: ratio == null || undefined, ok: ratio != null && ratio >= 0.8, near: ratio != null && ratio >= 0.6 }));
  });
  return out;
}
// the week's fuelling: its rides' scores, each weighed by how much fuelling it matters (1.0 is everything asked for)
function fuelScore(list) { const rs = (list || []).filter(c => c.kind === 'ride' && c.ratio != null); const w = rs.reduce((a, c) => a + (c.weight || 1), 0); return w ? rs.reduce((a, c) => a + c.ratio * (c.weight || 1), 0) / w : null; }
async function pastDay(date, store) {
  if (store.days[date] && store.days[date].v === ROW_V) return store.days[date];
  const food = require('./food');
  const r = await food.dayReport(date);
  const logged = (r.entries || []).some(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
  // water for a past day is the balance the day ended on, the same measure the
  // tile and the Live tab show (100 at the morning, 0 at 2% down); a day with no
  // drink logged at all says nothing rather than reading as dry
  const h = r.hydration || {};
  const supps = (r.entries || []).filter(e => e && e.supplement && e.key).map(e => e.key);
  const rideDay = (r.sessions || []).some(x => !/lift|weight|strength|push|pull|upper|legs|pump/i.test(x.name || '') && !/WeightTraining/i.test(x.sport || ''));
  const hardDay = (r.sessions || []).some(x => /vo2|40\s*\/\s*20|threshold|race|interval/i.test(String(x.name || '').replace(/intervals\.?\s*icu/ig, '')));
  const row = { v: ROW_V, fuel: fuelChecks(r), food: logged && r.compliance ? r.compliance.overall : null, logged, water: (h.drunk_ml || 0) > 0 && h.score != null ? h.score : null, drunk_ml: h.drunk_ml || null, target_ml: h.target_ml || null,
    supps, ride: rideDay, hard: hardDay };
  store.days[date] = row; store.dirty = true;
  return row;
}

// "Nov 2 – Nov 8": the Plan link's own week, the seven days from today
function planWeekLabel(today) {
  const lab = k => new Date(k + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${lab(today)} – ${lab(tz.shiftKey(today, 6))}`;
}
// Today's macros for the box, the Food page's own numbers: kcal and protein against the day's targets.
// The tone reads them against what is due by now: over the whole day's kcal by more than 20% is red,
// by 10% amber; protein under 60% of what is due by now red, under 80% amber; nothing logged is grey.
function macrosToday(m) {
  if (!m) return { kcal_today: null, kcal_target: null, protein_today: null, protein_target: null, protein_due: null, today_state: 'none' };
  const kcal = m.kcal || 0, prot = m.protein_g || 0, tk = m.target_kcal || null, tp = m.target_protein_g || null;
  const dueP = m.due_protein_g != null ? m.due_protein_g : tp;
  let state = 'none';
  if (m.logged && tk) {
    const over = kcal / tk, pr = dueP ? prot / dueP : 1;
    state = over > 1.2 || pr < 0.6 ? 'bad' : over > 1.1 || pr < 0.8 ? 'warn' : 'good';
  }
  return { kcal_today: m.logged ? Math.round(kcal) : null, kcal_target: tk ? Math.round(tk) : null, protein_today: m.logged ? Math.round(prot) : null, protein_target: tp ? Math.round(tp) : null,
    protein_due: dueP != null ? Math.round(dueP) : null, today_state: state };
}

async function report() {
  const today = tz.todayKey();
  const dates = []; for (let i = DAYS - 1; i >= 0; i--) dates.push(tz.shiftKey(today, -i));
  // the fresh start (fresh-start.js): days before it drop out of every graded link's week; physiology keeps its history
  const FS = await require('./fresh-start').freshStart();
  const counts = d => !FS || d >= FS, todayIn = counts(today);
  const weekFrom = FS && FS > dates[0] ? (FS > today ? today : FS) : dates[0];
  const past = dates.slice(0, -1).filter(counts);
  const store = await getJSON('chain-days', { days: {} });
  store.dirty = false;
  // food and water: today live, past days from the store (a couple read fresh per call)
  // The sections below are independent (the journal, the watch, the calendar three ways, the lifts), and each
  // waits on its own reads; they run together and the report is assembled once all are in.
  const tasks = [];
  let fresh = 0; const rows = {}; let todayRow = null;
  tasks.push((async () => {
  for (const d of past) {
    if (store.days[d] && store.days[d].v === ROW_V) { rows[d] = store.days[d]; continue; }
    if (fresh >= NEW_PER_CALL) continue;
    try { rows[d] = await pastDay(d, store); fresh++; } catch (e) { /* that day stays unread */ }
  }
  try {
    const food = require('./food');
    const r = await food.dayReport(today);
    const logged = (r.entries || []).some(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
    const h = r.hydration || {};
    // today: the balance now, the same number the tile shows
    // today counts the rides that have started: one still ahead has had no chance yet (fuelChecks scores from the start)
    todayRow = { fuel: fuelChecks(r), fuel_now: r.energy && r.energy.now ? r.energy.now : null, food: logged && r.compliance ? r.compliance.overall : null, logged, water: h.now && h.score != null ? h.score : null, water_now: h.now || null, drunk_ml: h.drunk_ml || null, target_ml: h.target_ml || null,
      supps: (r.entries || []).filter(e => e && e.supplement && e.key).map(e => e.key), rx: r.supps || null,
      ride: (r.sessions || []).some(x => !/lift|weight|strength|push|pull|upper|legs|pump/i.test(x.name || '') && !/WeightTraining/i.test(x.sport || '')),
      hard: (r.sessions || []).some(x => /vo2|40\s*\/\s*20|threshold|race|interval/i.test(String(x.name || '').replace(/intervals\.?\s*icu/ig, ''))),
      macros: { kcal: r.actual ? r.actual.kcal : null, protein_g: r.actual ? r.actual.protein_g : null, target_kcal: r.target ? r.target.kcal : null, target_protein_g: r.target ? r.target.protein_g : null,
        due_kcal: r.compliance && r.compliance.due ? r.compliance.due.kcal : null, due_protein_g: r.compliance && r.compliance.due ? r.compliance.due.protein_g : null, logged },
      micros: r.micros ? { score: r.micros.score, word: r.micros.band && r.micros.band.word, gaps: (r.micros.gaps || []).map(g => g.label) } : null };
  } catch (e) { todayRow = null; }
  if (store.dirty) { delete store.dirty; for (const k of Object.keys(store.days)) if (k < tz.shiftKey(today, -45)) delete store.days[k]; await setJSON('chain-days', store).catch(() => {}); }
  })());

  // sleep and recovery: the Garmin's mornings through intervals.icu
  let nights = [], recs = [], band = { state: 'none', why: 'no watch' }, hrvWeekMs = null, hrvBaseMs = null, rhrWeek = null;
  // one recovery model for the whole site (recovery.js): the same band the Day's tile and advice read
  tasks.push((async () => { try {
    const R = await require('./recovery').weekBand(today, weekFrom);
    nights = R.nights; recs = R.recs; band = R.band; hrvWeekMs = R.hrv_week_ms; hrvBaseMs = R.hrv_base_ms; rhrWeek = R.rhr_week;
  } catch (e) { nights = []; recs = []; } })());
  // work: minutes done against minutes planned over the week
  let work = { planned_min: 0, done_min: 0, days: [] }, liftsPlanned = 0;
  const planAhead = { ride_min: 0, rides: 0, untimed: 0, lifts: 0, days: [] };
  tasks.push((async () => { try {
    const { calendar } = require('./workouts');
    const cal = await calendar(weekFrom, today);
    // riding only: the lifting is its own link. Planned: the plan's rides and intervals.icu's; done: Strava's rides and rides logged by hand.
    const isWeight = x => /weight|lift|strength|^run$|^virtualrun$|^walk$|^hike$/i.test(String(x.sport || x.type || ''));   // riding only: lifts, runs and walks are not rides
    // a ride counts by its minutes, discounted by how far it strayed from its zone: a Zone 1 day wants 80% of
    // the ride at 116 and under, a hard day wants 15% of it over threshold; a ride with no heart rate counts whole
    const HARD = /vo2|40\s*\/\s*20|threshold|race|interval|sweet/i;
    const Rd = require('./rides');
    work.credit_min = 0; work.hr_min = 0; work.hr_credit_min = 0;
    for (const day of cal.days || []) {
      if (!counts(day.date)) continue;   // before the fresh start: not graded
      // today's sessions count in the plan once their planned end has passed (an untimed one from 9 p.m.): the
      // week's ratio at dawn, or mid-ride, is the week so far, not the session he is still on or has not reached
      const nowM = (() => { const p = tz.parts(new Date()); return p.h * 60 + p.mi; })();
      const minsOf = x => x.metrics ? Math.round((x.metrics.duration_s || 0) / 60) : (x.minutes || 0);
      const over = x => day.date !== today || (x.time ? require('./food-math').toMin(x.time) + minsOf(x) <= nowM : nowM >= 21 * 60);
      const planned = (day.planned || []).filter(w => !isWeight(w) && over(w)).reduce((a, w) => a + Math.round((w.metrics ? w.metrics.duration_s : 0) / 60), 0)
        + (day.intervals || []).filter(e => !isWeight(e) && over(e)).reduce((a, e) => a + (e.minutes || 0), 0);
      const hardDay = (day.planned || []).concat(day.intervals || []).some(w => HARD.test(String(w.name || '')));
      let done = 0, credit = 0;
      for (const r of (day.done || []).filter(r => !isWeight(r))) {
        const mins = r.minutes || 0; done += mins;
        let f = 1;
        try { const a = r.id ? await getJSON(Rd.key(r.id), null) : null; const z = a && a.hr && a.hr.zone_pct;
          if (z) { f = hardDay ? Math.min(1, z.z3 / 15) : Math.min(1, z.z1 / 80); work.hr_min += mins; work.hr_credit_min += mins * f; } } catch (e) { f = 1; }
        credit += mins * f;
      }
      const logged = (day.planned || []).filter(w => !isWeight(w) && w.logged).reduce((a, w) => a + Math.round((w.metrics ? w.metrics.duration_s : 0) / 60), 0);
      done += logged; credit += logged;
      work.planned_min += planned; work.done_min += done; work.credit_min += Math.round(credit); work.days.push({ date: day.date, planned_min: planned, done_min: done, credit_min: Math.round(credit) });
    }
  } catch (e) { work = { planned_min: 0, done_min: 0, credit_min: 0, days: [] }; } })());
  // lifts already on the calendar for the week ahead (the first week's word, before a session is logged)
  tasks.push((async () => { try {
    const { calendar } = require('./workouts');
    const ahead = await calendar(today, tz.shiftKey(today, 6));
    const blast = w => require('./food-math').isBlast(w);   // a Kettlebell Blast is an extra, not one of the five
    for (const day of ahead.days || []) liftsPlanned += (day.planned || []).filter(w => /weight|lift|strength/i.test(String(w.sport || '')) && !w.logged && !blast(w)).length;
    // the Plan link: the week ahead as it stands on the calendar
    const isW = x => /weight|lift|strength|^run$|^virtualrun$|^walk$|^hike$/i.test(String(x.sport || x.type || ''));
    for (const day of ahead.days || []) {
      const rides = (day.planned || []).filter(w => !isW(w)).map(w => ({ name: w.name, time: w.time || null, minutes: Math.round((w.metrics ? w.metrics.duration_s : 0) / 60), logged: !!w.logged, ridden: !!w.compliance }))
        .concat((day.intervals || []).filter(e => !isW(e)).map(e => ({ name: e.name, time: e.time || null, minutes: e.minutes || 0, logged: false })));
      const isLiftW = w => /weight|lift|strength/i.test(String(w.sport || '')) || /\blift\b|^push\b|\bpull\b|\bupper\b|\blegs\b|\bpump\b/i.test(String(w.name || ''));
      const lifts = (day.planned || []).filter(w => isLiftW(w) && !blast(w)).map(w => ({ name: w.name, time: w.time || null }));
      planAhead.days.push({ date: day.date, rides, lifts, ride_min: rides.reduce((a, r) => a + r.minutes, 0) });
      planAhead.ride_min += rides.reduce((a, r) => a + r.minutes, 0); planAhead.rides += rides.length; planAhead.untimed += rides.filter(r => !r.time).length; planAhead.lifts += lifts.length;
    }
  } catch (e) { /* none counted */ } })());
  // the morning after a hard day: a low reading is expected, and says so
  let hardYesterday = null;
  tasks.push((async () => { try {
    const { calendar } = require('./workouts');
    const cal = await calendar(tz.shiftKey(today, -1), tz.shiftKey(today, -1));
    const d0 = (cal.days || [])[0];
    const hard = d0 ? (d0.done || []).find(r => /vo2|40\s*\/\s*20|threshold|race|interval/i.test(String(r.name || '').replace(/intervals\.?\s*icu/ig, '')) || (r.tss || 0) >= 60 || (r.minutes || 0) >= 120) : null;
    hardYesterday = hard ? hard.name.replace(/^Zwift - Intervals icu: /i, '').slice(0, 30) : null;
  } catch (e) { hardYesterday = null; } })());
  // lift: sessions logged this week against the plan's five (the Lift tab's store, read directly)
  let lift = { sessions: 0, pumps: 0, target: 5, of: 5, word: '0 of 5', today: [], week: [] };
  tasks.push((async () => { try {
    const d = await getJSON('lifts', { sessions: [] });
    const L = require('./lifts');
    const wk = (d.sessions || []).filter(x => x.date >= weekFrom && counts(x.date) && x.date <= today && !L.isExtra(x.template));
    const nameOf = k => (L.TEMPLATES.find(t => t.key === k) || {}).short || (L.TEMPLATES.find(t => t.key === k) || {}).name || k;
    // the count is the Lift page's own (lifts.weekCount): the first week judged on the sessions due, a ninth week a deload
    const c = await L.weekCountPlaced(d.sessions || [], today);
    lift = { sessions: c.sessions, pumps: c.pumps, blasts: c.blasts || 0, target: 5, expected: c.expected, of: c.of, due: c.due, week_from: c.from, word: c.word, first_week: c.first_week, started: c.started, deload: c.deload, week_no: c.week_no,
      today: wk.filter(x => x.date === today).map(x => nameOf(x.template)), week: wk.map(x => ({ date: x.date, name: nameOf(x.template), volume_lb: (x.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, q) => b + (q.lb || 0) * (q.reps || 0), 0), 0) })) };
  } catch (e) { /* no lifts yet */ } })());
  await Promise.all(tasks);
  const foodDays = past.map(d => rows[d]).filter(x => x && x.logged && x.food != null).map(x => x.food).concat(todayIn && todayRow && todayRow.logged && todayRow.food != null ? [todayRow.food] : []);
  const waterDays = past.map(d => rows[d]).filter(x => x && x.water != null).map(x => x.water).concat(todayIn && todayRow && todayRow.water != null ? [todayRow.water] : []);
  const readDays = past.filter(d => rows[d]).length + (todayIn ? 1 : 0);
  // the supplements over the week, and when creatine began (its water on the scale)
  const S = require('./supps');
  const suppRows = past.map(d => rows[d]).filter(Boolean).concat(todayRow && todayIn ? [todayRow] : []);
  const rxWeek = S.weekOf(suppRows);
  let creatineStart = null;
  try {
    // the three weeks read together, not one after another (the week's docs are already in hand from the rows above)
    const keys = Array.from({ length: 21 }, (_, i) => tz.shiftKey(today, -(20 - i)));
    const docs = await Promise.all(keys.map(k => getJSON('food-' + k, null).catch(() => null)));
    for (let i = 0; i < keys.length; i++) { const doc = docs[i]; if (doc && (doc.entries || []).some(e => e && e.supplement && e.key === 'creatine')) { creatineStart = keys[i]; break; } }
  } catch (e) { creatineStart = null; }
  const creatineDays = creatineStart ? Math.round((Date.parse(today) - Date.parse(creatineStart)) / 864e5) + 1 : null;
  const rxToday = todayRow && todayRow.rx ? todayRow.rx : null;
  const rxLine = link => rxToday ? rxToday.due.filter(x => x.link === link).map(x => `${x.key === 'sodium_bicarb' ? 'bicarb' : x.key === 'magnesium' ? 'Mg' : x.key}${x.taken ? ' ✓' : x.time ? ' ' + tz.hm12(x.time) : ' due'}`).join(' · ') : '';
  // weight: the seven-day mean against the seven before
  let weight = null;
  try { weight = await require('./weighin').state(); } catch (e) { weight = null; }
  // power: his FTP the way Xert reads it, and the breakthroughs (signature.js)
  let power = null;
  try { const sg = await Promise.race([require('./signature').report(), new Promise(r => setTimeout(() => r(null), 6000))]); power = sg && sg.power ? sg.power : null; } catch (e) { power = null; }

  // last night as the watch (or his own entry) gave it, kept for the Day page's nap offer (naps.js); then the naps:
  // a nap counts toward its day, the night kept apart
  try { const ln = nights.length && nights[nights.length - 1].date === today ? nights[nights.length - 1] : null; if (ln && ln.counted) await setJSON('sleep-last', { date: today, hours: ln.hours, at: Date.now() }); } catch (e) { /* the offer waits */ }
  try { const NP = require('./naps'); nights = NP.withNaps(nights, await NP.minutesByDate()); } catch (e) { /* the nights stand */ }
  const sleepWeek = r1(avg(nights.filter(n => n.counted).map(n => n.hours)));
  // last night is the record dated today; an older one is the watch not synced yet, not tonight's number
  const lastNight = nights.length && nights[nights.length - 1].date === today ? nights[nights.length - 1] : null;
  const notSynced = nights.length && nights[nights.length - 1].date !== today;
  const foodWeek = r0(avg(foodDays)), waterWeek = r0(avg(waterDays));
  const recWeek = r0(avg(recs.map(r => r.score))), recToday = recs.length && recs[recs.length - 1].date === today ? recs[recs.length - 1] : null;
  const workRatio = work.planned_min > 0 ? (work.credit_min != null ? work.credit_min : work.done_min) / work.planned_min : (work.done_min > 0 ? 1 : null);
  const links = {
    plan: (() => {
      const rideShare = Math.min(1, planAhead.ride_min / PLAN_RIDE_MIN), liftShare = Math.min(1, planAhead.lifts / 5), timed = planAhead.rides ? (planAhead.rides - planAhead.untimed) / planAhead.rides : 1;
      const score = 0.5 * rideShare + 0.3 * liftShare + 0.2 * timed;
      const td = planAhead.days.find(d => d.date === today) || { rides: [], lifts: [] };
      const firstRide = td.rides.find(r => !r.logged && !r.ridden) || td.rides[td.rides.length - 1], firstLift = td.lifts[0];
      const todayWord = firstRide ? `${firstRide.name.replace(/^Zwift - Intervals icu: /i, '').slice(0, 26)}${firstRide.time ? ` ${tz.hm12(firstRide.time)}` : ', no time'}` : firstLift ? `${firstLift.name.slice(0, 20)}${firstLift.time ? ` ${tz.hm12(firstLift.time)}` : ''}` : 'rest';
      return { week: Math.round(score * 100), state: stateOf('plan', score), ride_min: planAhead.ride_min, ride_target_min: PLAN_RIDE_MIN, rides: planAhead.rides, untimed: planAhead.untimed, lifts: planAhead.lifts,
        today: td.rides.length + td.lifts.length, today_word: todayWord, today_state: firstRide ? (firstRide.time ? 'good' : 'warn') : firstLift ? 'good' : 'none', days: planAhead.days,
        // the planning score, not the calendar's "done of plan": how much of the seven days ahead is placed, on its own week
        unit: 'placed', from: today, to: tz.shiftKey(today, 6), week_label: planWeekLabel(today),
        basis: `how much of the seven days ahead (${planWeekLabel(today)}) is placed on the calendar, not how much of it is done (that is the Calendar's "done of plan"): minutes of riding against ${PLAN_RIDE_MIN} (half the mark), five lifts placed (three tenths), and every ride given a start time (two tenths); 80 green, 50 amber` };
    })(),
    sleep: { week: sleepWeek, state: stateOf('sleep', sleepWeek), today: lastNight ? lastNight.hours : null, today_word: `${lastNight && lastNight.score != null ? `score ${lastNight.score}${lastNight.manual ? ` · ${lastNight.manual}` : ''}` : (lastNight ? (lastNight.manual ? `from ${lastNight.manual}` : 'last night') : notSynced ? 'no sync yet' : 'no watch')}${lastNight && lastNight.nap_min ? ` · incl. ${lastNight.nap_credit_min} of a ${lastNight.nap_min} min nap` : ''}${rxToday && rxToday.magnesium_last_night ? ' · Mg ✓' : ''}`, unit: 'h a night', nights: nights.slice(-7),
      rx: { magnesium: rxWeek.magnesium, last_night: rxToday ? rxToday.magnesium_last_night : null, tonight: rxLine('sleep') }, basis: 'hours asleep per night, from the Garmin through intervals.icu, plus any nap he logs that day (its first 30 minutes in full, half of the rest, 45 minutes at most); magnesium an hour before bed rides along' },
    // The Macros box shows what the Food page prints at its top, read from the same day report on every
    // call: today's kcal against the day's target, and protein against its target. (The compliance
    // average stays for the chain's verdict, but it is not on the box: its macro half bottoms out at 0
    // once a macro is far past what is due, so on a day already over it did not move with a log.)
    food: Object.assign({ week: foodWeek, state: foodDays.length >= 3 ? stateOf('food', foodWeek) : (foodDays.length ? stateOf('food', foodWeek) : 'none'), days_logged: foodDays.length, days_on: foodDays.filter(x => x >= 80).length, today: todayRow && todayRow.logged ? todayRow.food : null, unit: 'kcal', micros: todayRow ? todayRow.micros : null, basis: `the box is today's kcal and protein against the day's targets, the numbers at the top of the Food page; the chain's verdict uses the day's compliance score averaged over the logged days of the last ${DAYS} (${readDays} days read)` },
      macrosToday(todayRow && todayRow.macros)),
    micros: { week: todayIn && todayRow && todayRow.micros ? todayRow.micros.score : null, state: stateOf('micros', todayIn && todayRow && todayRow.micros ? todayRow.micros.score : null), today: todayRow && todayRow.micros ? todayRow.micros.score : null, today_word: todayRow && todayRow.micros ? todayRow.micros.word : null, gaps: todayRow && todayRow.micros ? todayRow.micros.gaps : [], unit: 'this week', basis: 'thirteen nutrients against their daily targets, averaged over the week\'s journal' },
    water: { week: waterWeek, state: stateOf('water', waterWeek), today: todayRow && todayRow.water_now ? todayRow.water_now.ml : null, today_word: todayRow && todayRow.water_now && todayRow.water_now.band ? todayRow.water_now.band.word : null, unit: 'balance', basis: 'the hydration balance score each day ended on (100 at the morning, 0 at 2% down), the same measure the tile and the Live tab show, averaged over the days with a drink logged' },
    fuel: (() => {
      const all = past.flatMap(d => (rows[d] && rows[d].fuel) || []).concat(todayRow && todayIn ? (todayRow.fuel || []) : []);
      const score = fuelScore(all), todays = todayRow ? fuelScore(todayRow.fuel || []) : null;
      const fn = todayRow && todayRow.fuel_now;
      return { week: score == null ? null : Math.round(score * 100), state: stateOf('fuel', score), rides: all.filter(c => c.kind === 'ride').length, list: all.slice(-12),
        ok: all.filter(c => c.ok).length, checks: all.length,
        rx: { beetroot: rxWeek.beetroot, sodium_bicarb: rxWeek.sodium_bicarb, today: rxLine('fuel') || null },
        today: todays != null ? Math.round(todays * 100) : null,
        today_word: todays != null ? `${todays >= 0.8 ? 'fuelled' : todays >= 0.6 ? 'a little short' : 'short'}${(todayRow.fuel || []).some(c => c.so_far) ? ' so far' : ''}` : (todayRow && (todayRow.fuel || []).some(c => c.not_logged) ? 'not logged' : fn ? 'no ride yet' : null),
        unlogged: all.filter(c => c.unlogged && c.unlogged.length).map(c => ({ name: c.name, time: c.time, what: c.unlogged })).slice(-4),
        today_tone: todays != null ? stateOf('fuel', todays) : null, tank_now: fn ? fn.pct : null, legs_today: fn ? fn.legs_pct : null, unit: 'fuelled',
        basis: 'each ride in the last seven days against its own fuel prescription. Before: whether the tank was at what the ride needs when it began (the live fuel model; a train-low ride is the one place over costs). On the bike: the carbs taken against the prescription, when it gives any. After: the protein and carbs of the two hours after, weighted to carbs after a hard or long ride and to protein after an easy one. Beetroot and bicarbonate count only before a hard or long ride. Each part runs from 0 to 100 and no further, so a surplus in one cannot hide a gap in another; a hard or long ride counts three times an easy one in the week; and what was not logged at all is left out and named, not scored as missed. 80 and up green, 60 amber' };
    })(),
    work: { week: workRatio == null ? null : Math.round(workRatio * 100), state: stateOf('work', workRatio), planned_min: work.planned_min, done_min: work.done_min, credit_min: work.credit_min,
      in_zone_pct: work.hr_min ? Math.round(work.hr_credit_min / work.hr_min * 100) : null, today: (work.days.find(d => d.date === today) || {}).done_min || 0, today_planned: (work.days.find(d => d.date === today) || {}).planned_min || 0, unit: '% of plan',
      today_word: null, basis: 'minutes ridden against minutes of riding planned this week, each ride discounted by how far it strayed from its zone (a Zone 1 day wants 80% at 116 and under, a hard day 15% over threshold); the lifting is its own link' },
    // five a week on the seven-day clock, no grace week: none lifted is a broken link. A deload week stays grey.
    // the plan's first week is judged against the sessions due since it started, not a full five
    // the box reads "1 of 1 due" in the plan's first week and "3 of 5" after it, the Lift page's own count
    lift: { week: Math.round(Math.min(1, lift.sessions / (lift.of || 5)) * 100),
      // judged on the sessions due by now in this Monday-to-Sunday week (a Monday rest day reads "0 of 5" in grey, not red)
      state: lift.deload || (lift.first_week && !lift.of) || lift.due === 0 ? 'none' : stateOf('lift', lift.sessions / (lift.due || lift.of || 5)),
      first_week: !!lift.first_week, of: lift.of != null ? lift.of : 5, count_word: lift.word,
      sessions: lift.sessions, pumps: lift.pumps || 0, blasts: lift.blasts || 0, extras: (lift.pumps || 0) + (lift.blasts || 0), target: lift.target, expected: lift.expected, started: lift.started, deload: lift.deload, week_no: lift.week_no,
      today: lift.today.length, planned_ahead: liftsPlanned, planned_today: (() => { const td = planAhead.days.find(d => d.date === today); const l = td && td.lifts[0]; return l ? `${l.name.slice(0, 18)}${l.time ? ' ' + tz.hm12(l.time) : ''}` : null; })(), today_word: `${lift.today.length ? lift.today.join(', ') : (!lift.started ? (liftsPlanned ? `${liftsPlanned} on the calendar` : 'not started') : lift.deload ? 'deload week' : '')}${rxLine('lift') ? (lift.today.length || !lift.started || lift.deload ? ' · ' : '') + rxLine('lift') : ''}` || null, week_list: lift.week, unit: lift.first_week ? `of ${lift.of} due` : `of ${lift.of || 5}`,
      rx: { creatine: rxWeek.creatine, started: creatineStart, days: creatineDays },
      basis: lift.first_week ? `the plan's first week: ${lift.sessions} of the ${lift.expected} sessions the plan placed from its first day through today; 80% green, 50% amber` : `sessions logged on the Lift tab this week (Monday to Sunday) against the plan's five; the colour reads them against the ${lift.due != null ? lift.due : 5} due by now: 80% green, 50% amber` },
    recovery: (() => {
      const todayScore = recToday ? recToday.score : null;
      const dayBand = todayScore == null ? null : todayScore >= 67 ? 'good' : todayScore >= 34 ? 'warn' : 'bad';
      const dip = dayBand && dayBand !== 'good' && hardYesterday;
      // the border is the week against the band; a red morning takes it red for the day
      // until the watch has its fourteen nights there is no HRV band: the week is then the mornings' own recovery
      // scores averaged (67 and up green, 34 amber), so the box is never blank while the band builds
      const interim = band.state === 'none' && recWeek != null;
      const interimState = interim ? (recWeek >= 67 ? 'good' : recWeek >= 34 ? 'warn' : 'bad') : null;
      const state = interim ? (dayBand === 'bad' ? 'bad' : interimState) : band.state === 'none' ? 'none' : dayBand === 'bad' ? 'bad' : band.state;
      return { week: interim ? recWeek : band.pct, week_kind: interim ? 'score' : 'band', state, week_state: band.state, steps: band.steps, why: band.why, hrv_week_ms: hrvWeekMs, hrv_base_ms: hrvBaseMs, rhr_week: rhrWeek, rhr_up: band.rhr_up,
        score_week: recWeek, today: todayScore, today_band: dayBand, today_word: dip ? `dip after ${hardYesterday} · normal` : dayBand === 'bad' ? 'red morning: easy day' : (recToday && recToday.estimated ? 'estimated' : null),
        hard_yesterday: hardYesterday, days: recs.slice(-7), unit: interim ? 'avg' : 'vs band',
        basis: interim ? `the week's morning recovery scores averaged (67 and up green, 34 to 66 amber) while the new watch builds its HRV band (${band.why || 'fourteen nights needed'}); the morning line is the day's readiness`
          : 'the week\'s HRV against your own 60-day band (a step is half its night-to-night spread); the morning line is the day\'s readiness' };
    })(),
    weight: (() => {
      // the trend line through three weeks of readings when there is one; the week-on-week means until then
      const wk = weight ? (weight.trend_lb_wk != null ? weight.trend_lb_wk : weight.week_change_lb) : null;
      // creatine's first two weeks put a pound or two of water on the scale: not the week going wrong
      const creatineWater = creatineDays != null && creatineDays <= 14;
      let state = stateOf('weight', wk);
      if (creatineWater && (state === 'bad' || state === 'warn') && wk != null && wk <= 2.5) state = 'warn';
      return { week: wk, state, today: weight && weight.latest ? Math.round(weight.latest.lb) : null, today_word: creatineWater ? `creatine day ${creatineDays}: water` : (weight && weight.latest ? (wk == null && weight.change_since_start_lb != null ? `${weight.change_since_start_lb > 0 ? '+' : ''}${weight.change_since_start_lb} since ${weight.start_lb || 'the start'}` : weight.latest.logged_today ? 'today' : weight.weigh_today ? 'weigh in today' : 'last reading') : (weight && weight.weigh_today ? 'weigh in today' : null)),
        unit: 'lb a week', since_start: weight ? weight.change_since_start_lb : null, creatine_water: creatineWater, creatine_days: creatineDays,
        trend_days: weight ? weight.trend_days : 0, pace_lb_wk: -1,
        basis: `${weight && weight.trend_lb_wk != null ? `the trend line through the last ${weight.trend_days} days of readings, in lb a week; green at a pound a week down` : 'the seven-day mean weight against the seven days before it, until three weeks of readings draw a trend line; green at a pound a week down'}${creatineWater ? '; creatine started ' + creatineDays + ' days ago, so a pound or two of this is water and the week is not called up until day 14' : ''}` };
    })(),
    // Power (Harry, 15 Nov 2026: "a power box with an FTP calculated the same way Xert calculates them, and
    // breakthroughs"; "I want to see improvement on my FTP"). The big number is the signature's threshold power;
    // green when it has risen in four weeks or a breakthrough fell inside them, amber when it has faded 3% or
    // more, grey while it holds. Never red: it is an outcome, read from efforts, not a task for the day.
    power: (() => {
      const P = power;
      if (!P || P.ftp == null) return { week: null, state: 'none', today: null, today_word: 'no power read yet', unit: 'W',
        basis: 'threshold power from the fitness signature (Xert\'s three numbers, fitted to your rides with power); it needs a few rides read on the Zones page' };
      const bt = P.last_breakthrough, recent = !!(bt && bt.days_ago <= 28);
      const state = recent || (P.change_w != null && P.change_w >= 2) ? 'good' : (P.change_w != null && P.change_w <= -Math.max(3, Math.round(P.ftp * 0.03))) ? 'warn' : 'none';
      const word = bt && bt.days_ago === 0 ? `${bt.medal} breakthrough today` : P.change_w != null && P.change_w !== 0 ? `${P.change_w > 0 ? '+' : '−'}${Math.abs(P.change_w)} W in 4 wk`
        : bt ? `breakthrough ${bt.days_ago} d ago` : P.fading ? 'fading: no hard effort' : 'holding';
      return { week: P.ftp, state, today: P.wkg, today_word: word, unit: 'W', wkg: P.wkg, change_w: P.change_w, ftp_28d_ago: P.ftp_28d_ago, fading: !!P.fading,
        last_breakthrough: bt ? { date: bt.date, medal: bt.medal, days_ago: bt.days_ago } : null, medals: P.medals, planning_ftp: P.planning_ftp,
        basis: 'your FTP the way Xert reads it: the threshold power of the fitness signature (threshold power, high-intensity energy and peak power, the lowest curve that stays above your hardest efforts of the last 90 days). An effort counts in full for four weeks and then fades a percent a week, so the number drifts down unless a hard effort renews it; a ride that beats the curve is a breakthrough and moves it up (bronze, silver or gold for one, two or three of the numbers rising). Green when it rose in four weeks or a breakthrough fell inside them, amber when it faded 3% or more, grey while it holds. The plan and the zones run on the planning FTP, which only you change' };
    })()
  };
  const v = verdict(links);
  // what moved up a colour today and this week, and the box that did it marked
  let W = { wins: [], wins_week: [], slips: [] };
  try { W = await trackMoves(links, today); for (const w of W.wins) if (links[w.key]) links[w.key].up = true; } catch (e) { /* the chain stands without it */ }
  return { wins: W.wins, wins_week: W.wins_week, slips: W.slips, order: ORDER, links, break_at: v.break_at, break_state: v.break_state || null, verdict: v.text, days: DAYS, read_days: readDays, fresh_start: FS, week_from: weekFrom };
}

function attach(app) {
  app.get('/chain', async (req, res) => { if (!auth(req, res)) return;
    try {
      const r = await report();
      // a compact copy for the advisor, which cannot afford the full read inside a turn
      try { await setJSON('chain-last', { at: Date.now(), verdict: r.verdict, break_at: r.break_at, wins: r.wins || [], wins_week: r.wins_week || [],
        links: Object.fromEntries(ORDER.map(k => [k, { week: r.links[k].week, state: r.links[k].state, today: r.links[k].today, today_word: r.links[k].today_word || null, why: r.links[k].why || null, unlogged: r.links[k].unlogged && r.links[k].unlogged.length ? r.links[k].unlogged : undefined }])) }); } catch (e) { /* no store */ }
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { movesOf, winsOf, ROW_V, fuelChecks, fuelScore, attach, report, macrosToday, planWeekLabel, verdict, stateOf, recoveryState, ORDER };
