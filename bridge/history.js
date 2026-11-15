// ============================================================
// history.js — the coach's look back (Harry, 14 Nov 2026: "I want the coach to be able to see back into my previous
// things… the coach wasn't able to tell me what I ate on Monday. I think the coach should look at things that I do
// that are successful and maybe recommend those moving forward… access to all of the data going back a long ways,
// looking at trends"; and: "look for key habits, like successful workouts after certain meals or certain timing").
//
// One compact row a day, kept in a store, so the coach can read weeks at a glance without rebuilding them:
//   what he ate (each meal by name, with its numbers) and the day's food score and what it missed,
//   what he trained (each ride with its time of day, how close it was to plan, and the meal before it; each lift),
//   how he slept, his recovery that morning, a nap, his weight.
// From the rows: his best food days (the model to copy), the habits that go with good sessions and good food days
// (each with how many days stand behind it), and the trends of the last week against the three before.
//
//   GET /history?from=YYYY-MM-DD&to=YYYY-MM-DD   the rows (45 days at most), built where missing
//   GET /history/patterns                         best days, habits, trends and the week-by-week roll-up of the whole record
//
// A past day's row is kept for good; the two days before today are rebuilt when older than half an hour (a correction to
// yesterday shows), today is always read fresh. The five-minute job fills in missing days a few at a time, back
// 120 days at first; after that the record only grows, and the weeks roll up so a season reads at a glance.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const KEY = 'history-days';
// BACK: how far the first fill reaches (the rides are on record 120 days, the food 60). From then on nothing is
// dropped: the record only grows (Harry, 14 Nov 2026: "access to all my data through my entire history").
const BACK = 120, GOOD_FOOD = 75, GOOD_RIDE = 85;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dowOf = date => DOW[new Date(date + 'T12:00:00Z').getUTCDay()];
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const r1 = n => n == null || !isFinite(n) ? null : Math.round(n * 10) / 10;
const avg = a => { const v = (a || []).filter(x => x != null && isFinite(x)); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
const cleanName = n => String(n || '').replace(/^(breakfast|lunch|dinner|snack|pre-workout snack|post-workout meal)\s*:\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 90);

// ---- one day, from what the site already knows (pure) ------------------------------------------------
// o: { date, report (food.dayReport), cal (one day of workouts.calendar), lifts ([{name, volume_lb}]),
//      night ({hours, score}), rec ({score, hrv}), nap_min, lb }
function rowOf(o) {
  const r = o.report || {}, c = r.compliance || {}, pm = (c.macros && c.macros.per_macro) || {};
  const eaten = (r.entries || []).filter(e => !e.supplement && !e.drink_only && (e.kcal || 0) > 0);
  const meals = eaten.map(e => ({ slot: e.slot || e.meal || '', time: e.time || '', name: cleanName(e.name), kcal: Math.round(e.kcal || 0), c: Math.round(e.carbs_g || 0), p: Math.round(e.protein_g || 0),
    portion: String(e.portion || '').slice(0, 120) })).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const food = eaten.length ? { score: c.overall != null ? Math.round(c.overall) : null, band: c.band ? c.band.word : null, day: r.fuel_day || null,
    kcal: r.actual ? r.actual.kcal : null, kcal_t: r.target ? r.target.kcal : null,
    carbs: pm.carbs_g ? pm.carbs_g.actual : null, carbs_t: pm.carbs_g ? pm.carbs_g.target : null,
    protein: pm.protein_g ? pm.protein_g.actual : null, protein_t: pm.protein_g ? pm.protein_g.target : null,
    fat: pm.fat_g ? pm.fat_g.actual : null, fat_t: pm.fat_g ? pm.fat_g.target : null,
    missed: ((c.guidelines && c.guidelines.checks) || []).filter(x => !x.ok).map(x => x.label) } : null;
  const cal = o.cal || {}, pct = cal.compliance && cal.compliance.pct != null ? cal.compliance.pct : null;
  // the meal before a session: the last thing with calories eaten before it started, and how long before
  const before = at => { if (at == null) return null; const m = meals.filter(x => toMin(x.time) != null && toMin(x.time) <= at && x.kcal >= 50).pop();
    return m ? { name: m.name, min_before: at - toMin(m.time), c: m.c, p: m.p } : null; };
  const done = (cal.done || []).map(a => ({ kind: /run/i.test(a.type || '') ? 'run' : 'ride', name: String(a.name || '').slice(0, 60), time: a.time || '', minutes: a.minutes || null, tss: a.tss != null ? Math.round(a.tss) : null,
    avg_hr: a.avg_hr || null, np_w: a.np_w || null, indoor: /virtual/i.test(a.type || ''), before: before(toMin(a.time)) }));
  for (const l of o.lifts || []) done.push({ kind: 'lift', name: String(l.name || 'Lift').slice(0, 60), volume_lb: l.volume_lb || null, tops: l.tops && l.tops.length ? l.tops : undefined });
  const planned = (cal.planned || []).map(w => String(w.name || '').slice(0, 60));
  return { date: o.date, dow: dowOf(o.date), food, meals, done, planned, plan_pct: pct,
    sleep_h: o.night && o.night.hours != null ? r1(o.night.hours) : null, sleep_score: o.night && o.night.score != null ? Math.round(o.night.score) : null,
    recovery: o.rec && o.rec.score != null ? Math.round(o.rec.score) : null, hrv: o.rec && o.rec.hrv != null ? Math.round(o.rec.hrv) : null,
    nap_min: o.nap_min || null, lb: o.lb != null ? r1(o.lb) : null };
}

// one line of a day, for the coach's eyes
function line(row) {
  const bits = [];
  if (row.food) { const f = row.food;
    bits.push(`food ${f.score != null ? f.score : '?'}${f.kcal != null ? ` (${f.kcal} of ${f.kcal_t} kcal, protein ${f.protein}/${f.protein_t} g, carbs ${f.carbs}/${f.carbs_t} g${f.day ? ', a ' + f.day : ''})` : ''}${f.missed && f.missed.length ? `, missed: ${f.missed.join('; ')}` : ''}`);
    const by = {}; for (const m of row.meals) (by[m.slot || 'other'] = by[m.slot || 'other'] || []).push(m);
    bits.push('ate: ' + Object.keys(by).map(s => `${s} ${by[s].map(m => `${m.name} (${m.kcal} kcal, ${m.c}C ${m.p}P${m.time ? ', ' + tz.hm12(m.time) : ''})`).join(' + ')}`).join('; '));
  } else bits.push('no food logged');
  if (row.done.length) bits.push('trained: ' + row.done.map(d => d.kind === 'lift' ? `${d.name} lift${d.volume_lb ? ` (${d.volume_lb} lb moved${d.tops ? ': ' + d.tops.join(', ') : ''})` : ''}`
    : `${d.name}${d.time ? ' at ' + tz.hm12(d.time) : ''}${d.minutes ? `, ${d.minutes} min` : ''}${d.tss != null ? `, ${d.tss} TSS` : ''}${d.avg_hr ? `, avg HR ${d.avg_hr}` : ''}${d.before ? `, ${d.before.min_before} min after ${d.before.name} (${d.before.c} g carbs)` : ', nothing eaten before it'}`).join('; ')
    + (row.plan_pct != null ? ` [riding ${row.plan_pct}% of plan]` : ''));
  else if (row.planned.length) bits.push(`planned but not done: ${row.planned.join(', ')}`);
  else bits.push('no training');
  if (row.sleep_h != null) bits.push(`slept ${row.sleep_h} h${row.sleep_score != null ? ` (score ${row.sleep_score})` : ''}${row.nap_min ? ` + ${row.nap_min} min nap` : ''}`);
  if (row.recovery != null) bits.push(`recovery ${row.recovery}`);
  if (row.lb != null) bits.push(`${row.lb} lb`);
  return `${row.dow} ${tz.dayShort(row.date).replace(/^\w+,?\s*/, '')}: ${bits.join(' | ')}`;
}

// ---- what the rows say (pure) ------------------------------------------------------------------------
// a group of days or sessions: how many, and the mean of what is being judged
const group = (label, items, val) => { const v = items.map(val).filter(x => x != null); return { label, n: v.length, mean: v.length ? Math.round(avg(v)) : null }; };
function patterns(rows, today) {
  const all = (rows || []).filter(r => r && r.date < (today || '9999')).sort((a, b) => a.date.localeCompare(b.date));
  const fed = all.filter(r => r.food && r.food.score != null);
  // his best food days: the model to copy
  const best = fed.filter(r => r.food.score >= GOOD_FOOD).sort((a, b) => b.food.score - a.food.score || b.date.localeCompare(a.date)).slice(0, 5)
    .map(r => ({ date: r.date, dow: r.dow, score: r.food.score, day: r.food.day, kcal: r.food.kcal, protein: r.food.protein, carbs: r.food.carbs, meals: r.meals.map(m => ({ slot: m.slot, time: m.time, name: m.name, kcal: m.kcal, c: m.c, p: m.p })) }));
  const worst = fed.filter(r => r.food.score < 60).sort((a, b) => a.food.score - b.food.score).slice(0, 3).map(r => ({ date: r.date, dow: r.dow, score: r.food.score, missed: r.food.missed }));
  // food habits: what the good days have in common
  const firstMeal = r => r.meals.filter(m => m.kcal >= 100)[0], bfP = r => r.meals.filter(m => /breakfast/i.test(m.slot)).reduce((a, m) => a + m.p, 0);
  const foodHabits = [
    [group('breakfast with 30 g protein or more', fed.filter(r => bfP(r) >= 30), r => r.food.score), group('breakfast under 30 g protein', fed.filter(r => bfP(r) < 30), r => r.food.score)],
    [group('first meal before 9 a.m.', fed.filter(r => firstMeal(r) && toMin(firstMeal(r).time) < 540), r => r.food.score), group('first meal at 9 a.m. or later', fed.filter(r => firstMeal(r) && toMin(firstMeal(r).time) >= 540), r => r.food.score)],
    [group('weekdays', fed.filter(r => !/Sat|Sun/.test(r.dow)), r => r.food.score), group('weekends', fed.filter(r => /Sat|Sun/.test(r.dow)), r => r.food.score)],
    [group('after 7 h sleep or more', fed.filter(r => r.sleep_h != null && r.sleep_h >= 7), r => r.food.score), group('after under 6.5 h sleep', fed.filter(r => r.sleep_h != null && r.sleep_h < 6.5), r => r.food.score)],
    [group('four or more meals logged', fed.filter(r => r.meals.length >= 4), r => r.food.score), group('three or fewer', fed.filter(r => r.meals.length <= 3), r => r.food.score)]
  ].filter(p => p[0].n && p[1].n);
  // session habits: each ride with the day's "% of plan" as how it went
  const rides = []; for (const r of all) for (const d of r.done) if (d.kind === 'ride') rides.push({ r, d, at: toMin(d.time), q: r.plan_pct });
  const q = x => x.q == null ? null : Math.min(120, x.q);
  const rideHabits = [
    [group('rides before 11 a.m.', rides.filter(x => x.at != null && x.at < 660), q), group('rides 11 a.m. to 3 p.m.', rides.filter(x => x.at != null && x.at >= 660 && x.at < 900), q), group('rides after 3 p.m.', rides.filter(x => x.at != null && x.at >= 900), q)],
    [group('rides within 90 min of eating', rides.filter(x => x.d.before && x.d.before.min_before < 90), q), group('rides 90 min to 3 h after eating', rides.filter(x => x.d.before && x.d.before.min_before >= 90 && x.d.before.min_before <= 180), q), group('rides over 3 h after eating or fasted', rides.filter(x => !x.d.before || x.d.before.min_before > 180), q)],
    [group('rides with 40 g carbs or more in the meal before', rides.filter(x => x.d.before && x.d.before.c >= 40), q), group('rides with under 40 g carbs before', rides.filter(x => x.d.before && x.d.before.c < 40), q)],
    [group('rides after 7 h sleep or more', rides.filter(x => x.r.sleep_h != null && x.r.sleep_h >= 7), q), group('rides after under 6.5 h sleep', rides.filter(x => x.r.sleep_h != null && x.r.sleep_h < 6.5), q)]
  ].map(p => p.filter(g => g.n)).filter(p => p.length >= 2);
  const goodRides = rides.filter(x => x.q != null && x.q >= GOOD_RIDE).slice(-6).map(x => ({ date: x.r.date, dow: x.r.dow, name: x.d.name, time: x.d.time, pct: x.q, before: x.d.before, sleep_h: x.r.sleep_h }));
  // trends: the last seven days against the three weeks before them
  const end = today || tz.todayKey(), wk = all.filter(r => r.date >= tz.shiftKey(end, -7)), prior = all.filter(r => r.date < tz.shiftKey(end, -7) && r.date >= tz.shiftKey(end, -28));
  const tr = (label, f, unit, dec) => { const a = avg(wk.map(f)), b = avg(prior.map(f)); return a == null && b == null ? null : { label, last7: a == null ? null : (dec ? r1(a) : Math.round(a)), before: b == null ? null : (dec ? r1(b) : Math.round(b)), unit }; };
  const mins = rs => rs.reduce((a, r) => a + r.done.reduce((x, d) => x + (d.minutes || 0), 0), 0);
  const trends = [tr('food score', r => r.food ? r.food.score : null, '', 0), tr('protein', r => r.food ? r.food.protein : null, 'g a day', 0), tr('sleep', r => r.sleep_h, 'h a night', 1), tr('recovery', r => r.recovery, '', 0), tr('weight', r => r.lb, 'lb', 1)].filter(Boolean);
  trends.push({ label: 'riding', last7: mins(wk), before: prior.length ? Math.round(mins(prior) / Math.max(1, prior.length / 7)) : null, unit: 'min a week' });
  return { days: all.length, days_with_food: fed.length, from: all.length ? all[0].date : null, weeks: weeks(all, today), best_food_days: best, worst_food_days: worst, food_habits: foodHabits, ride_habits: rideHabits, good_rides: goodRides, trends };
}

// week by week (Monday to Sunday): the long view, so a season's drift shows without reading every day
function weeks(rows, today) {
  const by = {};
  for (const r of (rows || []).filter(x => x && x.date < (today || '9999'))) {
    const dow = (new Date(r.date + 'T12:00:00Z').getUTCDay() + 6) % 7, mon = tz.shiftKey(r.date, -dow);
    (by[mon] = by[mon] || []).push(r);
  }
  return Object.keys(by).sort().map(mon => { const rs = by[mon], fed = rs.filter(r => r.food && r.food.score != null);
    const sum = f => rs.reduce((a, r) => a + r.done.reduce((x, d) => x + (f(d) || 0), 0), 0), rd = v => v == null ? null : Math.round(v);
    return { week_of: mon, days: rs.length, food_days: fed.length, food_score: rd(avg(fed.map(r => r.food.score))), good_food_days: fed.filter(r => r.food.score >= GOOD_FOOD).length,
      kcal: rd(avg(fed.map(r => r.food.kcal))), protein: rd(avg(fed.map(r => r.food.protein))),
      rides: rs.reduce((a, r) => a + r.done.filter(d => d.kind === 'ride').length, 0), ride_min: sum(d => d.kind === 'ride' ? d.minutes : 0), tss: sum(d => d.tss), lifts: rs.reduce((a, r) => a + r.done.filter(d => d.kind === 'lift').length, 0),
      sleep_h: r1(avg(rs.map(r => r.sleep_h))), recovery: rd(avg(rs.map(r => r.recovery))), lb: r1(avg(rs.map(r => r.lb))) }; });
}

// what the quick coach always has in view: the last fortnight day by day, his best days, the habits, the trends
function digestText(rows, today, days) {
  const n = days || 14, all = (rows || []).filter(r => r && r.date < today).sort((a, b) => b.date.localeCompare(a.date));
  if (!all.length) return '';
  const P = patterns(all, today), out = [];
  out.push(`LOOK BACK: his last ${Math.min(n, all.length)} days before today, newest first (the record goes back to ${tz.dayShort(P.from)} and is kept for good; look_back reads any stretch of it day by day). Food score is the day out of 100; ${GOOD_FOOD} or more is a good day.`);
  for (const r of all.slice(0, n)) out.push(line(r));
  if (P.best_food_days.length) out.push('HIS BEST FOOD DAYS, his own choices, the model to copy: ' + P.best_food_days.map(b => `${b.dow} ${tz.dayShort(b.date).replace(/^\w+,?\s*/, '')} scored ${b.score}${b.day ? ` (a ${b.day})` : ''}: ${b.meals.map(m => `${m.slot} ${m.name}`).join('; ')}`).join(' || '));
  const pair = p => p.map(g => `${g.label}: ${g.mean} (${g.n} ${g.n === 1 ? 'day' : 'days'})`).join(' vs ');
  if (P.food_habits.length) out.push('FOOD HABITS, mean food score: ' + P.food_habits.map(pair).join(' · '));
  if (P.ride_habits.length) out.push('RIDE HABITS, mean % of plan ridden that day: ' + P.ride_habits.map(p => p.map(g => `${g.label}: ${g.mean == null ? 'no plan to compare' : g.mean + '%'} (${g.n})`).join(' vs ')).join(' · '));
  // the long view: every week on record, oldest first (the last 16 when there are more)
  if (P.weeks.length > 1) out.push('WEEK BY WEEK (Monday to Sunday, oldest first; the last may be part of a week): ' + P.weeks.slice(-16).map(w => `week of ${tz.dayShort(w.week_of).replace(/^\w+,?\s*/, '')}: ${w.food_days ? `food ${w.food_score} over ${w.food_days} days (${w.good_food_days} good), protein ${w.protein} g` : 'no food logged'}, ${w.rides} rides ${w.ride_min} min${w.tss ? ' ' + w.tss + ' TSS' : ''}, ${w.lifts} lifts${w.sleep_h != null ? `, sleep ${w.sleep_h} h` : ''}${w.recovery != null ? `, recovery ${w.recovery}` : ''}${w.lb != null ? `, ${w.lb} lb` : ''}`).join(' || '));
  if (P.trends.length) out.push('TRENDS, last 7 days against the 3 weeks before: ' + P.trends.map(t => `${t.label} ${t.last7 == null ? 'none' : t.last7}${t.before != null ? ` (was ${t.before})` : ''}${t.unit ? ' ' + t.unit : ''}`).join('; '));
  return out.join('\n');
}

// ---- the store ---------------------------------------------------------------------------------------
async function store() { const d = await getJSON(KEY, { rows: {} }); d.rows = d.rows || {}; return d; }
// VER: the shape of a row; a row built to an older shape is built again (2: lifts carry their name, pounds and top sets)
const VER = 2;
const stale = (date, e, today) => !e || !e.at || e.v !== VER || (date >= tz.shiftKey(today, -2) && Date.now() - e.at > 30 * 60000);

// Build the rows of these dates (oldest first is cheapest: one calendar read and one sleep read for the span).
async function build(dates, budgetMs) {
  const list = (dates || []).filter(isDate).sort(); if (!list.length) return {};
  const t0 = Date.now(), today = tz.todayKey(), from = list[0], to = list[list.length - 1], out = {};
  const safe = (p, fb) => p.catch(() => fb);
  const [cal, liftsDoc, rec, naps, weigh] = await Promise.all([
    safe(require('./workouts').calendar(from, to), { days: [] }),
    safe(getJSON('lifts', { sessions: [] }), { sessions: [] }),
    safe(require('./recovery').weekBand(today, from < tz.shiftKey(today, -60) ? tz.shiftKey(today, -60) : from), { nights: [], recs: [] }),
    safe(require('./naps').minutesByDate(), {}),
    safe(getJSON('weigh-in', { entries: [] }), { entries: [] })
  ]);
  const lbOn = {}; for (const e of (weigh.entries || [])) { if (!e || !e.ts || !(e.lb > 0)) continue; const k = tz.keyOf(new Date(e.ts)); if (!lbOn[k] || e.ts < lbOn[k].ts) lbOn[k] = e; }
  const food = require('./food');
  for (const date of list) {
    if (budgetMs && Date.now() - t0 > budgetMs) break;
    let report = null; try { report = await food.dayReport(date); } catch (e) { report = null; }
    out[date] = rowOf({ date, report, cal: (cal.days || []).find(d => d.date === date) || null,
      lifts: (liftsDoc.sessions || []).filter(s => s.date === date).map(liftOf), night: (rec.nights || []).find(x => x.date === date) || null,
      rec: (rec.recs || []).find(x => x.date === date) || null, nap_min: naps[date] || null, lb: lbOn[date] ? lbOn[date].lb : null });
  }
  return out;
}
// a saved lift as the Lift page names it: the template's name, the pounds moved, its best set of each exercise
function liftOf(s) {
  let name = s.name || ''; try { const t = require('./lifts').TEMPLATES; const tpl = Array.isArray(t) ? t.find(x => x.key === s.template) : (t || {})[s.template]; if (!name && tpl && tpl.name) name = tpl.name; } catch (e) { /* the key stands */ }
  if (!name) name = s.template ? String(s.template).replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Lift';
  const volume = (s.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, x) => b + (x.lb || 0) * (x.reps || 0), 0), 0);
  const tops = (s.exercises || []).map(e => { const best = (e.sets || []).filter(x => x.lb > 0 && x.reps > 0).sort((a, b) => b.lb - a.lb || b.reps - a.reps)[0]; return best ? `${e.name || e.key} ${best.lb} lb x ${best.reps}` : null; }).filter(Boolean);
  return { name, volume_lb: volume || s.volume_lb || null, tops: tops.slice(0, 8) };
}
// The rows of a span, from the store, building what is missing or stale (within a time budget).
async function rows(from, to, o) {
  const today = tz.todayKey(), d = await store(), want = [];
  for (let k = from; k <= to && want.length < 62; k = tz.shiftKey(k, 1)) want.push(k);
  const need = want.filter(k => k <= today && (k === today || stale(k, d.rows[k], today)));
  if (need.length && !(o && o.cached)) {
    const built = await build(need, (o && o.budgetMs) || 12000); let dirty = false;
    for (const k of Object.keys(built)) { if (k === today) { d.rows[k] = { at: 0, row: built[k] }; continue; } d.rows[k] = { at: Date.now(), v: VER, row: built[k] }; dirty = true; }
    if (dirty) { const keep = {}; for (const k of Object.keys(d.rows)) if (k !== today) keep[k] = d.rows[k];   // nothing is dropped: the record only grows
      await setJSON(KEY, { rows: keep }).catch(() => {}); }
  }
  return want.filter(k => d.rows[k]).map(k => d.rows[k].row);
}
// The five-minute job: a few missing or stale days at a time, newest first, until the last 120 are on record.
async function tick() {
  const today = tz.todayKey(), d = await store(), need = [];
  for (let i = 1; i <= BACK && need.length < 3; i++) { const k = tz.shiftKey(today, -i); if (stale(k, d.rows[k], today)) need.push(k); }
  if (!need.length) return { built: 0 };
  const got = await rows(need[need.length - 1], need[0], { budgetMs: 9000 });
  return { built: need.length, on_record: Object.keys((await store()).rows).length, got: got.length };
}
// For the coach's context: from the store only, so a question never waits on it.
async function digest(days) {
  const today = tz.todayKey(), d = await store();
  return digestText(Object.values(d.rows).map(x => x.row), today, days);
}
// The coach's look_back tool: a span in full (portions too when it is a week or less).
async function lookBack(input) {
  const today = tz.todayKey();
  let to = isDate(input && input.to) ? input.to : today, from = isDate(input && input.from) ? input.from : tz.shiftKey(to, -6);
  if (to > today) to = today; if (from > to) from = to;
  if (from < tz.shiftKey(to, -44)) from = tz.shiftKey(to, -44);
  const rs = await rows(from, to, { budgetMs: 9000 }), brief = rs.length > 7;
  return { from, to, days: rs.map(r => brief ? Object.assign({}, r, { meals: r.meals.map(m => ({ slot: m.slot, time: m.time, name: m.name, kcal: m.kcal, c: m.c, p: m.p })) }) : r),
    note: rs.length ? undefined : 'nothing on record for those days' };
}

function attach(app) {
  app.get('/history', async (req, res) => { if (!auth(req, res)) return;
    try { const today = tz.todayKey(), to = isDate(req.query.to) ? req.query.to : today, from = isDate(req.query.from) ? req.query.from : tz.shiftKey(to, -13);
      res.json(await lookBack({ from, to })); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/history/patterns', async (req, res) => { if (!auth(req, res)) return;
    try { const today = tz.todayKey(), d = await store(); res.json(patterns(Object.values(d.rows).map(x => x.row), today)); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, rowOf, line, patterns, weeks, digestText, digest, rows, build, tick, lookBack, GOOD_FOOD, BACK };
