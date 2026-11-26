// The Way as a connector for Claude (17 Nov 2026, Harry: "We need to create a tool for you to be able to write to the web", "The way";
// then, through his Chief of Staff the same day: his Claude projects, Cycling Coach and Chief of Staff, use The Way directly
// instead of driving a browser. The Way is his source of truth for the meal plan and the food log).
//
//   POST /mcp   with the header Authorization: Bearer <WAY_MCP_KEY>   (or POST /mcp/<WAY_MCP_KEY>)
//   MCP over HTTP: initialize, tools/list, tools/call; JSON answers, no streams.
//
// READS give the day as the site shows it, cut down to what a reader needs: get_day (the timeline, rides, lifts, meals
// planned and logged with their macros, supplements, medicines, drives), get_week, get_recovery_and_sleep, get_weight,
// get_fitness, get_notebook, and read_site for any other page the coach may read.
// WRITES all go through voice.js run(), the one function the buttons and both coaches use, in the quick coach's own action
// shape (voice.js SCHEMA): nothing is logged twice or differently, and every check there still holds. Each write answers
// with exactly what changed: the entry as it was stored, or the session before and after.
//
// The key is an environment variable Harry sets on Netlify himself (24 characters or more), never in the repository and
// never printed. Without it the connector is off (503). On the copy of the site only (the sandbox, which keeps its own
// store), /mcp/copy with the site's own header is a second way in, so the connector can be tested without his key.
// Nothing here sends anything to another person.
const crypto = require('crypto');
const C = require('./coach');
const tz = require('./tz');
const { getJSON, ON_NETLIFY, SANDBOX } = require('./storage');

const same = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const keySet = () => String(process.env.WAY_MCP_KEY || '').trim().length >= 24;
const keyOK = (k) => keySet() && !!k && same(String(k).trim(), String(process.env.WAY_MCP_KEY).trim());
const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const str = v => String(v == null ? '' : v);
const int = v => Math.round(Number(v) || 0);
const dayNo = k => { const [y, m, d] = k.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekday = k => { const [y, m, d] = k.split('-').map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]; };
const mondayOf = k => tz.shiftKey(k, -((new Date(Date.UTC(...k.split('-').map((n, i) => i === 1 ? Number(n) - 1 : Number(n)))).getUTCDay() + 6) % 7));
const hm12 = t => (isTime(t) ? tz.hm12(t) : t || null);
const pick = (o, keys) => { const out = {}; if (!o) return out; keys.forEach(k => { if (o[k] != null) out[k] = o[k]; }); return out; };

// One of the site's own pages, read (or written) from its own host with the site's own header: what the page shows.
async function site(base, path, opt) {
  const o = opt || {};
  const r = await fetch(base + (ON_NETLIFY ? '/.netlify/functions/api' : '') + path, { method: o.method || 'GET',
    headers: Object.assign({ 'x-the-way-app': '1' }, o.body ? { 'Content-Type': 'application/json' } : {}),
    body: o.body ? JSON.stringify(o.body) : undefined, signal: AbortSignal.timeout(o.ms || 20000) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
  if (!r.ok || j == null) throw new Error(`${path.split('?')[0]} answered ${r.status}${j && j.error ? ': ' + j.error : ''}`);
  return j;
}
// several pages at once; one that fails is named in could_not_read and the rest still answer
async function pages(base, map) {
  const names = Object.keys(map), missed = [];
  const got = await Promise.all(names.map(n => (typeof map[n] === 'string' ? site(base, map[n]) : map[n]()).catch(e => { missed.push(`${n}: ${String(e.message || e).slice(0, 140)}`); return null; })));
  const out = {}; names.forEach((n, i) => { out[n] = got[i]; }); out.missed = missed; return out;
}

// ── what a planned session, a ride done, a food entry and a meal row look like to a reader ──────────────────────────────
const isLift = w => /weight|strength/i.test(str(w && (w.sport || w.type)));
// a session read from the calendar page carries its length; one read from the store is measured from its steps
const minutesOf = w => { if (w.metrics && w.metrics.duration_s) return Math.round(w.metrics.duration_s / 60); try { const s = require('./workouts').durationOf(w.steps); return s > 0 ? Math.round(s / 60) : null; } catch (e) { return null; } };
const planned = w => Object.assign({ id: w.id, name: w.name, sport: w.sport, date: w.date, time: w.time || null, time_12h: hm12(w.time),
  minutes: minutesOf(w) }, w.metrics && w.metrics.tss != null ? { tss: w.metrics.tss } : {},
  w.logged ? { done: true } : {}, w.started_at ? { started_at: w.started_at } : {}, w.compliance ? { compliance_pct: w.compliance.pct } : {},
  w.sync && w.sync.state === 'synced' ? { on_garmin: true } : {}, w.auto_moved ? { moved_by_the_site_from: w.auto_moved.from } : {});
const ridden = r => Object.assign(pick(r, ['id', 'name', 'type', 'time', 'minutes', 'miles', 'avg_w', 'np_w', 'avg_hr', 'tss']), { time_12h: hm12(r.time) },
  r.plan_wid ? { planned_session_id: r.plan_wid } : {}, r.analysis && r.analysis.hr ? { hr_zone_minutes: r.analysis.hr.zones, minutes_above_hard: r.analysis.hr.minutes_above_hard } : {});
const entry = e => Object.assign(pick(e, ['id', 'date', 'time', 'name', 'portion', 'kcal', 'carbs_g', 'protein_g', 'fat_g']), { time_12h: hm12(e.time), meal: e.slot || e.meal || null },
  e.fluid_ml ? { fluid_ml: e.fluid_ml } : {}, e.supplement ? { supplement: e.key || true } : {}, e.corrected ? { corrected: true } : {});
const macros = o => pick(o, ['kcal', 'carbs_g', 'protein_g', 'fat_g']);
const sumOf = list => list.reduce((a, e) => { ['kcal', 'carbs_g', 'protein_g', 'fat_g'].forEach(k => { a[k] += Number(e[k]) || 0; }); return a; }, { kcal: 0, carbs_g: 0, protein_g: 0, fat_g: 0 });

// ── READS ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function getDay(base, a) {
  const today = tz.todayKey(), date = isDate(a.date) ? a.date : today, off = dayNo(date) - dayNo(today);
  const inSched = off >= -7 && off <= 20;   // the schedule page reaches a week back and three weeks ahead
  const p = await pages(base, Object.assign({
    food: '/food/day?date=' + date,
    calendar: `/calendar?from=${date}&to=${date}`,
    drives: '/commute/day?date=' + date,
    medicines: async () => require('./meds').dueFor(date, (await getJSON('meds-' + date, { taken: {} })).taken, await require('./sleep-window').get().catch(() => null)),
    lifts: async () => ((await getJSON('lifts', { sessions: [] })).sessions || []).filter(s => s.date === date),
    morning: async () => ((await require('./wellness').all()).days || {})[date] || null
  }, inSched ? { schedule: `/schedule?days=${off >= 0 ? off + 1 : -off + 1}&back=${off < 0 ? -off : 0}` } : {}));
  const out = { date, weekday: weekday(date), is_today: date === today, clock: 'times are his local time (US Eastern); time is 24-hour, time_12h is how to say it to him' };
  const sd = p.schedule && (p.schedule.days || []).find(d => d.date === date);
  if (sd) out.timeline = (sd.events || []).filter(e => !e.allDay).map(e => Object.assign({ from: e.from || null, to: e.to || null, what: e.summary,
    kind: e.workout_id ? (isLift(e) ? 'lift' : 'ride') : e.category === 'supplement' ? (/^med:/.test(str(e.rx_key)) ? 'medicine' : 'supplement') : e.category === 'commute' ? 'drive' : e.category || 'event' },
    e.location ? { where: str(e.location).slice(0, 80) } : {}, e.detail ? { detail: str(e.detail).slice(0, 160) } : {}, e.taken != null ? { taken: !!e.taken } : {}, e.workout_id ? { session_id: e.workout_id } : {}));
  else out.timeline_note = inSched ? 'the timeline could not be read' : 'the timeline reaches a week back and three weeks ahead; this date is outside it. Sessions, food and medicines below are still this date\'s.';
  if (sd && (sd.all_day || []).length) out.all_day = sd.all_day.map(e => e.summary || e).slice(0, 12);
  const cd = p.calendar && (p.calendar.days || [])[0];
  if (cd) {
    out.rides = { planned: (cd.planned || []).filter(w => !isLift(w)).map(planned), done: (cd.done || []).filter(r => !isLift(r)).map(ridden) };
    out.lifts = { planned: (cd.planned || []).filter(isLift).map(planned), done: (p.lifts || []).map(s => ({ id: s.id, name: s.name, template: s.template, volume_lb: s.volume_lb, exercises: (s.exercises || []).length, quick: !!s.quick })) };
    out.training_totals = cd.totals || null; if (cd.compliance) out.ride_compliance_pct = cd.compliance.pct; if (cd.rest) out.rest_day = cd.rest;
  }
  const f = p.food;
  if (f) {
    const by = {}; (f.entries || []).forEach(e => { by[e.id] = e; }); const used = new Set();
    out.food = { fuel_day: f.fuel_day, target: macros(f.target), logged_total: macros(f.actual),
      meals: (f.meals || []).map(m => { (m.logged || []).forEach(id => used.add(id)); return Object.assign({ meal: m.slot, time: m.time, time_12h: hm12(m.time),
        planned: Object.assign(macros(m), { carb_label: m.carb ? m.carb.word : null, what: m.what }), logged: (m.logged || []).map(id => by[id]).filter(Boolean).map(entry) },
        m.match ? { against_plan: m.match.key } : {}); }),
      also_logged: (f.entries || []).filter(e => !used.has(e.id) && !e.supplement).map(entry),
      drinks_ml: f.drinks_ml || 0, drink_target_ml: f.hydration ? f.hydration.target_ml : null };
    if (f.cue && f.cue.text) out.food.next = f.cue.text;
    out.supplements = ((f.supps && f.supps.due) || []).map(s => Object.assign(pick(s, ['key', 'name', 'time', 'why']), { time_12h: hm12(s.time), taken: !!s.taken }));
    out.sessions_and_their_fuel = (f.sessions || []).map(s => Object.assign(pick(s, ['name', 'minutes', 'tss', 'time', 'sport', 'done']), s.rx ? { kind: s.rx.kind, fuel: s.rx.words } : {}));
  }
  if (p.medicines) out.medicines = p.medicines.map(m => Object.assign(pick(m, ['key', 'name', 'time']), { time_12h: hm12(m.time), taken: !!m.taken }, m.taken_at ? { taken_at: m.taken_at } : {}));
  if (p.drives) out.drives = (p.drives.trips || []).map(t => Object.assign(pick(t, ['kind', 'label', 'arrive', 'back', 'from']),
    t.stored && t.stored.to ? { minutes_there: t.stored.to.min, delay_min: t.stored.to.delay_min } : {}, t.stored && t.stored.home ? { minutes_home: t.stored.home.min } : {}));
  if (p.morning) out.morning_numbers = pick(p.morning, ['sleep_h', 'sleep_score', 'recovery', 'hrv', 'rhr', 'source']);
  if (p.missed.length) out.could_not_read = p.missed;
  return out;
}

async function getWeek(base, a) {
  const today = tz.todayKey(), from = mondayOf(isDate(a.date) ? a.date : today), to = tz.shiftKey(from, 6);
  const p = await pages(base, { calendar: `/calendar?from=${from}&to=${to}`, model: '/planner/model' });
  if (!p.calendar) throw new Error('the week could not be read (' + p.missed.join('; ') + ')');
  const days = (p.calendar.days || []).map(d => Object.assign({ date: d.date, weekday: weekday(d.date) }, d.date === today ? { is_today: true } : {},
    d.fuel ? { fuel_day: d.fuel.label, carbs_g: d.fuel.carbs_g } : {}, d.rest ? { rest: d.rest } : {},
    { planned: (d.planned || []).map(planned).map(w => { delete w.date; return w; }), done: (d.done || []).map(ridden) }, d.compliance ? { ride_compliance_pct: d.compliance.pct } : {}));
  const tot = (p.calendar.days || []).reduce((s, d) => { const t = d.totals || {}; ['planned_min', 'done_min', 'planned_tss', 'done_tss', 'lift_planned_min', 'lift_done_min'].forEach(k => { s[k] = (s[k] || 0) + (t[k] || 0); }); return s; }, {});
  const out = { week_of: from, to, today, days, totals: tot, lifts_planned: days.reduce((n, d) => n + d.planned.filter(isLift).length, 0), lifts_done: days.reduce((n, d) => n + d.planned.filter(w => isLift(w) && w.done).length, 0) };
  if (p.model) out.how_his_training_is_shaped = p.model.words;
  if (p.missed.length) out.could_not_read = p.missed;
  return out;
}

async function getRecovery(base) {
  const today = tz.todayKey();
  const p = await pages(base, { chain: '/chain', scores: '/scores', sleep_window: '/sleep-window', naps: '/naps' });
  const out = { today };
  const L = p.chain && p.chain.links;
  if (L && L.recovery) { const r = L.recovery, has = (r.days || []).some(d => d.date === today && d.score != null);
    out.recovery = Object.assign({ today_has_a_reading: has, today: has ? r.today : null, today_band: has ? r.today_band : null },
      has ? {} : { note: 'no reading for this morning has reached the site yet: do not state today\'s recovery' },
      { week: { state: r.week_state || r.state, why: r.why, score_avg: r.score_week, hrv_ms: r.hrv_week_ms, hrv_baseline_ms: r.hrv_base_ms, resting_hr: r.rhr_week },
        days: (r.days || []).map(d => Object.assign({ date: d.date, score: d.score, hrv: d.hrv != null ? Math.round(d.hrv) : null }, d.manual ? { entered_by_hand_from: d.manual } : {}, d.estimated ? { estimated: true } : {})) }); }
  if (L && L.sleep) { const s = L.sleep, n = (s.nights || []).find(x => x.date === today);
    out.sleep = { last_night: n ? { hours: n.hours, score: n.score } : null, week_avg_hours: s.week, week_state: s.state,
      nights: (s.nights || []).map(x => Object.assign({ date: x.date, hours: x.hours, score: x.score }, x.manual ? { entered_by_hand_from: x.manual } : {})),
      magnesium: s.rx ? s.rx.magnesium : null };
    if (!n) out.sleep.note = 'last night has not reached the site yet'; }
  if (p.scores && p.scores.recovery && out.recovery && out.recovery.today_has_a_reading) { const m = pick(p.scores.recovery, ['hrv', 'hrv_baseline', 'hrv_delta_pct', 'rhr', 'rhr_baseline', 'resp', 'spo2', 'sleep_h', 'sleep_performance']); Object.keys(m).forEach(k => { if (typeof m[k] === 'number') m[k] = Math.round(m[k] * 10) / 10; }); out.recovery.this_morning = m; }
  if (p.sleep_window) out.sleep_window = pick(p.sleep_window, ['bed_hm', 'wake_hm', 'hours', 'earliest_workout_hm']);
  if (p.naps) out.naps_today = (p.naps.naps || []).map(n => pick(n, ['time', 'minutes']));
  if (p.missed.length) out.could_not_read = p.missed;
  return out;
}

async function getWeight(base) {
  const w = await site(base, '/weigh-in');
  return { latest: w.latest ? Object.assign(pick(w.latest, ['lb', 'at', 'source']), { weighed_today: !!w.latest.logged_today }) : null,
    seven_day_mean_lb: w.ma7_lb, trend_lb_a_week: w.trend_lb_wk, week_change_lb: w.week_change_lb, direction: w.direction ? w.direction.word : null,
    start_lb: w.start_lb, change_since_start_lb: w.change_since_start_lb, composition: w.composition || null, readings_last_7_days: w.readings_7d,
    scale_connected: !!w.withings_connected, readings: (w.all || []).slice(-30).map(r => ({ date: r.ts ? tz.keyOf(new Date(r.ts)) : r.date || null, lb: r.lb })) };
}

async function getFitness(base) {
  const p = await pages(base, { scores: '/scores', signature: '/signature', progress: '/progress' });
  const out = { today: tz.todayKey() };
  if (p.scores) { const t = p.scores.training || {}, f = p.scores.fatigue || {};
    out.load = { fitness_ctl: t.ctl, fatigue_atl: f.atl, form_tsb: f.tsb, form: f.form ? f.form.word : null, form_note: f.form ? f.form.note : null,
      ramp_7d: t.ramp_7d, ramp: t.ramp ? t.ramp.word : null, tss_last_7_days: t.tss_7d, tss_today: t.tss_today };
    out.planning = p.scores.settings || null; }
  if (p.signature && p.signature.power) { const w = p.signature.power;
    out.power = Object.assign(pick(w, ['ftp', 'wkg', 'pp', 'hie_kj', 'planning_ftp', 'ftp_28d_ago', 'change_w', 'weight_lb', 'medals', 'fade_note']),
      { ftp_is: 'threshold power fitted from his hard efforts (the signature); planning_ftp is what sessions are written against',
        last_breakthrough: w.last_breakthrough || null, last_near: w.last_near || null, to_break_through: (w.targets || []).map(t => ({ for: t.word, beat_watts: t.watts })) }); }
  if (p.progress) out.progress = { compared: p.progress.window, metrics: (p.progress.metrics || []).map(m => pick(m, ['label', 'unit', 'now', 'before', 'delta', 'state', 'why'])) };
  if (p.missed.length) out.could_not_read = p.missed;
  return out;
}

async function getNotebook() {
  const [nb, said] = await Promise.all([getJSON('coach-notebook', { notes: [] }), getJSON('voice-notes', { notes: [] })]);
  return { notebook: (nb.notes || []).slice(-60).map(n => pick(n, ['date', 'kind', 'note', 'by'])),
    his_notes: (said.notes || []).slice(-30).map(n => pick(n, ['date', 'text'])),
    what_these_are: 'notebook: what the coach decided with him, patterns it saw, and things he asked it to remember; both coaches read it before they answer. his_notes: notes he dictated.' };
}

// ── WRITES: one action in the quick coach's own shape, through the same function ────────────────────────────────────────
// the blank action: every field is required in the coach's strict schema; here a caller sends only what the action uses
function blank() { const p = require('./voice').SCHEMA().properties.actions.items.properties; const o = {};
  Object.keys(p).forEach(k => { const t = p[k].type; o[k] = t === 'integer' || t === 'number' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : ''; }); return o; }
const refuse = msg => { throw new Error(msg); };
async function act(a, base, x) {
  const V = require('./voice');
  const out = await V.run(Object.assign(blank(), a), Object.assign({ base, source: 'Claude connector' }, x || {}));
  if (!out || !out.ok) refuse((out && out.summary) || 'It was refused.');
  V.contextStale();   // the coach's kept read of the day is out of date
  return out;
}
const sessions = async () => { const d = await getJSON('plan-workouts', { workouts: {} }); const m = {}; Object.values(d.workouts || {}).forEach(w => { if (w && w.id) m[w.id] = planned(w); }); return m; };
// what a write did to the planned sessions: added, removed, and changed ones with before and after
function sessionDiff(before, after) {
  const ch = { added: [], removed: [], changed: [] }, face = w => JSON.stringify([w.name, w.sport, w.date, w.time, w.minutes, w.tss]);
  Object.keys(after).forEach(id => { if (!before[id]) ch.added.push(after[id]); else if (face(before[id]) !== face(after[id])) ch.changed.push({ before: before[id], after: after[id] }); });
  Object.keys(before).forEach(id => { if (!after[id]) ch.removed.push(before[id]); });
  Object.keys(ch).forEach(k => { if (!ch[k].length) delete ch[k]; });
  return Object.keys(ch).length ? ch : null;
}
// which session a move or a removal means: by its id, by the time it is on now, or by words from its name. Two that fit
// are never guessed between (a base day is two rides of one name): the answer names both and asks which.
async function whichSession(a) {
  if (!isDate(a.date)) refuse('date is needed: the day the session is on now, YYYY-MM-DD.');
  if (a.at && !isTime(a.at)) refuse('at is the time the session is on now, HH:MM on the 24-hour clock.');
  const all = Object.values(await sessions()).filter(w => w.date === a.date).sort((x, y) => str(x.time).localeCompare(str(y.time)));
  if (!all.length) refuse(`No planned session on ${tz.dayShort(a.date)}.`);
  const say = w => `${w.name}${w.time ? ' at ' + w.time_12h : ''} (session_id ${w.id})`;
  if (str(a.session_id)) { const w = all.find(x => x.id === str(a.session_id)); if (!w) refuse(`No session ${str(a.session_id)} on ${tz.dayShort(a.date)}. That day has: ${all.map(say).join('; ')}.`); return w.id; }
  const ws = str(a.name).toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 1 && !['the', 'my', 'ride', 'session', 'workout', 'min'].includes(x));
  let fit = ws.length ? all.filter(w => ws.some(x => str(w.name).toLowerCase().includes(x))) : all;
  if (ws.length && !fit.length) refuse(`Nothing on ${tz.dayShort(a.date)} is called "${str(a.name)}". That day has: ${all.map(say).join('; ')}.`);
  if (isTime(a.at)) { const t = fit.filter(w => w.time === a.at); if (!t.length) refuse(`Nothing at ${tz.hm12(a.at)} on ${tz.dayShort(a.date)}. That day has: ${all.map(say).join('; ')}.`); fit = t; }
  if (fit.length > 1) refuse(`${fit.length} sessions on ${tz.dayShort(a.date)} fit that: ${fit.map(say).join('; ')}. Send session_id, or at (the time it is on now).`);
  return fit[0].id;
}
async function withSessions(a, base) { const before = await sessions(); const out = await act(a, base); const ch = sessionDiff(before, await sessions());
  return { ok: true, summary: out.summary, changed: ch || 'nothing on the calendar changed' }; }

async function logMeal(a, base) {
  const F = require('./food'), today = tz.todayKey(), text = str(a.text).trim();
  if (!text) refuse('text is needed: what he ate or drank, with amounts.');
  if (a.time && !isTime(a.time)) refuse('time is HH:MM on the 24-hour clock, e.g. 12:30 or 18:05.');
  const date = isDate(a.date) ? a.date : today;
  if (dayNo(date) > dayNo(today) || dayNo(date) < dayNo(today) - 7) refuse('date must be today or one of the last seven days.');
  const given = {}; ['kcal', 'carbs_g', 'protein_g', 'fat_g'].forEach(k => { if (a[k] != null && a[k] !== '' && Number.isFinite(Number(a[k])) && Number(a[k]) >= 0) given[k] = Math.round(Number(a[k])); });
  const stated = Object.keys(given).length ? ` (${[given.kcal != null ? given.kcal + ' kcal' : null, given.carbs_g != null ? given.carbs_g + ' g carbs' : null, given.protein_g != null ? given.protein_g + ' g protein' : null, given.fat_g != null ? given.fat_g + ' g fat' : null].filter(Boolean).join(', ')}, as measured)` : '';
  const sent = text.slice(0, 560 - stated.length) + stated;
  // the same words sent again within twenty minutes are a retry, whatever time he said he ate: never a second entry
  const twin = ((await F.dayDocFor(today)).entries || []).find(e => e.written === sent && Date.now() - Date.parse(e.at) < 20 * 60000);
  if (twin) refuse(`Already in the journal (${twin.name}, ${tz.hm12(twin.time)}, logged a few minutes ago). Not logged again; change the words if it really was a second helping.`);
  // his own numbers and the time he ate go in with the entry itself, so the meal is chosen for that time once
  const out = await act({ type: a.kind === 'drink' ? 'drink' : 'meal', text: sent, meal: str(a.meal) }, base, { time: isTime(a.time) ? a.time : undefined, given: Object.keys(given).length ? given : undefined });
  const find = async d => ((await F.dayDocFor(d)).entries || []).find(e => e.id === out.entry_id) || null;
  let e = await find(today); if (!e) refuse('It was logged (' + out.summary + ') but the entry could not be read back.');
  let moved = null;
  if (date !== today) {   // eaten on an earlier day: the Food page's own move, which re-slots it into that day's plan
    await site(base, '/food/' + encodeURIComponent(e.id), { method: 'PUT', body: Object.assign({ date: today, to_date: date }, isTime(a.time) ? { time: a.time } : {}), ms: 16000 });
    e = (await find(date)) || e; moved = { moved_to: date }; }
  const note = isTime(a.time) && a.time !== e.time ? { time_note: `logged at ${tz.hm12(e.time)}: a time later than now is not taken` } : {};
  const all = ((await F.dayDocFor(date)).entries || []).filter(x => !x.supplement);
  return { ok: true, summary: out.summary, changed: Object.assign({ added: entry(e), macros_are: Object.keys(given).length === 4 ? 'the numbers given' : Object.keys(given).length ? 'the numbers given, the rest read from the words' : 'read from the words by The Way' },
    e.plan ? { the_plan_for_that_meal: Object.assign(pick(e.plan, ['slot', 'time', 'kcal', 'carbs_g', 'protein_g']), { what: str(e.plan.what).slice(0, 200) }) } : {},
    moved || {}, note, { day_logged_now: Object.assign(sumOf(all), { entries: all.length, date }) }) };
}

async function logWeight(a, base) {
  const last = async () => { const d = await getJSON('weigh-in', { entries: [] }); const e = (d.entries || [])[(d.entries || []).length - 1]; return e ? { lb: e.lb, at: new Date(e.ts).toISOString(), source: e.source || null, n: d.entries.length } : null; };
  const before = await last(); const out = await act({ type: 'weigh_in', lb: Number(a.lb) }, base); const after = await last();
  return { ok: true, summary: out.summary, changed: { added: pick(after, ['lb', 'at', 'source']), previous: before ? pick(before, ['lb', 'at']) : null,
    difference_lb: before ? Math.round((after.lb - before.lb) * 10) / 10 : null, readings: after.n } };
}

async function logMorning(a, base, only) {
  const W = require('./wellness'), date = isDate(a.date) ? a.date : tz.todayKey();
  const f = {}; (only || ['sleep_h', 'sleep_score', 'recovery', 'hrv', 'rhr']).forEach(k => { if (a[k] != null && a[k] !== '' && Number(a[k]) > 0) f[k] = Number(a[k]); });
  if (!Object.keys(f).length) refuse('Nothing to record: give at least one of ' + (only || ['sleep_h', 'sleep_score', 'recovery', 'hrv', 'rhr']).join(', ') + '.');
  if (a.date && !isDate(a.date)) refuse('date is YYYY-MM-DD: the morning the numbers belong to.');
  const get = async () => { const d = ((await W.all()).days || {})[date]; return d ? pick(d, ['sleep_h', 'sleep_score', 'recovery', 'hrv', 'rhr', 'source']) : null; };
  const before = await get(); const out = await act(Object.assign({ type: 'wellness', date, text: str(a.source).slice(0, 40) || 'Claude connector' }, f), base); const after = await get();
  const fields = Object.keys(f).filter(k => !before || before[k] !== after[k]);
  return { ok: true, summary: out.summary, changed: { date, fields_changed: fields.length ? fields : 'none: the same numbers were already there', before, after } };
}

async function markTaken(a, base) {
  const M = require('./meds'), F = require('./food'), V = require('./voice');
  const med = str(a.medicine), sup = str(a.supplement);
  if (!!med === !!sup) refuse('Give one of medicine (bp, eye_am, eye_pm) or supplement (' + V.SCHEMA().properties.actions.items.properties.supplement.enum.filter(Boolean).join(', ') + '), not both.');
  if (med) { const was = (await M.today()).due.find(x => x.key === med);
    const out = await act({ type: 'medicine', medicine: med }, base); const now = (await M.today()).due.find(x => x.key === med);
    return { ok: true, summary: was && was.taken ? `${now.name} was already marked taken today. Nothing changed.` : out.summary,
      changed: was && was.taken ? 'nothing: it was already marked taken at ' + tz.hm12(hmOfISO(was.taken_at)) : { medicine: now.key, name: now.name, due: now.time, taken: true, taken_at: now.taken_at } }; }
  const had = ((await F.dayDocFor(tz.todayKey())).entries || []).find(e => e.supplement && e.key === sup);
  if (had && a.again !== true) return { ok: true, summary: `${had.name} is already logged today at ${tz.hm12(had.time)}. Not logged a second time.`, changed: 'nothing: send again: true if he really took a second one' };
  const out = await act({ type: 'supplement', supplement: sup }, base);
  const e = ((await F.dayDocFor(tz.todayKey())).entries || []).filter(x => x.supplement && x.key === sup).pop();
  return { ok: true, summary: out.summary, changed: { added: e ? { id: e.id, supplement: e.key, name: e.name, date: e.date, time: e.time, time_12h: hm12(e.time) } : { supplement: sup } } };
}
const hmOfISO = iso => { const p = tz.parts(new Date(iso)); return String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'); };

async function addNote(a, base) {
  const text = str(a.text).trim(); if (!text) refuse('text is needed: the note itself.');
  if (a.remember === true) { const out = await act({ type: 'remember', text: text.slice(0, 400) }, base);
    const n = ((await getJSON('coach-notebook', { notes: [] })).notes || []).pop();
    return { ok: true, summary: out.summary, changed: { added: n, to: 'the coach\'s notebook, which both coaches read before they answer' } }; }
  await act({ type: 'note', text: text.slice(0, 500) }, base);
  const n = ((await getJSON('voice-notes', { notes: [] })).notes || []).pop();
  return { ok: true, summary: 'Noted.', changed: { added: pick(n, ['date', 'at', 'text']), to: 'his notes, which the coach reads with the day' } };
}

// ── the tool list ───────────────────────────────────────────────────────────────────────────────────────────────────────
const DATE = { type: 'string', description: 'YYYY-MM-DD in his local time (US Eastern). Leave out for today.' };
const TIME = { type: 'string', description: 'HH:MM on the 24-hour clock, his local time, e.g. 07:30 or 18:05.' };
const obj = (properties, required) => ({ type: 'object', properties, required: required || [] });
const RO = title => ({ title, readOnlyHint: true, openWorldHint: false });
const RW = (title, destructive) => ({ title, readOnlyHint: false, destructiveHint: !!destructive, idempotentHint: false, openWorldHint: false });
let TOOLS = null;
function tools() {
  if (TOOLS) return TOOLS;
  const V = require('./voice'), P = V.SCHEMA().properties.actions.items.properties;
  const fixed = C.allTools(); const of = n => fixed.find(t => t.name === n); const loose = s => { const c = JSON.parse(JSON.stringify(s)); delete c.additionalProperties; return c; };
  const d = C.doTool(); const doSchema = loose(d.input_schema); doSchema.required = ['type'];
  const sched = loose(of('schedule_workout').input_schema); sched.required = ['date'];
  TOOLS = [
    { name: 'get_day', annotations: RO('The Way: one day'), inputSchema: obj({ date: DATE }),
      description: 'One day in The Way, today or any date, as the site shows it: the timeline in order (classes, coaching, drives, sessions, supplements and medicines with their times), rides and lifts planned and done, the meal plan with each meal\'s planned macros and what he logged against it with its macros, the day\'s target and logged totals, supplements and medicines due and taken, and the drives. The Way is his source of truth for the meal plan and the food log. Read this before you say what is due, eaten or planned.' },
    { name: 'get_week', annotations: RO('The Way: the week plan'), inputSchema: obj({ date: Object.assign({}, DATE, { description: 'Any date in the week you want, YYYY-MM-DD. Leave out for this week. Weeks run Monday to Sunday.' }) }),
      description: 'The week plan: every day Monday to Sunday with the sessions planned (ride or lift, time, minutes, load) and done, the carb level of each day, the week\'s planned and done totals, and how his training is shaped (the rule the planner builds weeks from).' },
    { name: 'get_recovery_and_sleep', annotations: RO('The Way: recovery and sleep'), inputSchema: obj({}),
      description: 'Recovery and sleep: this morning\'s recovery and whether a reading has arrived yet, the last seven mornings, the week against his own HRV band, last night and the last seven nights of sleep, his sleep window (bed, wake, earliest session) and today\'s naps. If today has no reading, say so; never give yesterday\'s as today\'s.' },
    { name: 'get_weight', annotations: RO('The Way: weight'), inputSchema: obj({}),
      description: 'His weight: the latest weigh-in, the seven-day mean, the trend in pounds a week, the change since the fresh start, body composition when the scale gave it, and the last readings.' },
    { name: 'get_fitness', annotations: RO('The Way: fitness'), inputSchema: obj({}),
      description: 'His fitness: training load (fitness CTL, fatigue ATL, form TSB, the ramp), the power signature (threshold power, watts per kilo, peak power, the last breakthrough and what would beat the curve) and what has moved over the last four weeks against the four before.' },
    { name: 'get_notebook', annotations: RO('The Way: the coach\'s notebook'), inputSchema: obj({}),
      description: 'The coach\'s notebook: decisions made with him, patterns the coach saw in his data, what he asked it to remember, and the notes he dictated. Read it before advising, so you do not contradict what was already decided.' },
    { name: 'read_site', annotations: RO('The Way: any page'), inputSchema: loose(of('read_site').input_schema), description: of('read_site').description + ' Use the get_ tools first: they are shorter. This is for the pages they do not cover.' },
    { name: 'log_meal', annotations: RW('The Way: log a meal or a drink'),
      inputSchema: obj({ text: { type: 'string', description: 'What he ate or drank, with amounts: "200 g cooked rice, 150 g chicken thigh, a tablespoon of olive oil". Read a photo, a label or a receipt yourself and send what it shows as words.' },
        meal: { type: 'string', enum: P.meal.enum.filter(Boolean), description: 'Which meal it was, when he said. Leave out and The Way picks the meal from the time.' },
        kcal: { type: 'number', description: 'His own number when he has one (a label, a scale, an app). Leave out and The Way reads the macros from the words.' },
        carbs_g: { type: 'number' }, protein_g: { type: 'number' }, fat_g: { type: 'number' },
        time: Object.assign({}, TIME, { description: 'When he ate it, HH:MM on the 24-hour clock, if it was not just now.' }),
        date: Object.assign({}, DATE, { description: 'YYYY-MM-DD if it was eaten on an earlier day (up to seven days back). Leave out for today.' }),
        kind: { type: 'string', enum: ['meal', 'drink'], description: 'drink for something only drunk (water, coffee, a bottle on the bike). Default meal.' } }, ['text']),
      description: 'Log something he ate or drank to The Way\'s food journal, once. Give the macros when he has them (kcal, carbs_g, protein_g, fat_g): his numbers are stored as given; without them The Way reads the macros from the words. Only for food he says he ate or drank, never for a plan or a question. The same words within twenty minutes are refused as a double. The answer is the entry as stored (meal, time, macros), the plan for that meal, and the day\'s logged total now.' },
    { name: 'log_weight', annotations: RW('The Way: log a weigh-in'), inputSchema: obj({ lb: { type: 'number', description: 'His weight in pounds, e.g. 218.4.' } }, ['lb']),
      description: 'Log a weigh-in, in pounds, as of now. The answer is the reading stored, the one before it and the difference.' },
    { name: 'log_sleep', annotations: RW('The Way: log last night\'s sleep'),
      inputSchema: obj({ sleep_h: { type: 'number', description: 'Hours asleep as a decimal: 6 h 05 is 6.08, 7 h 30 is 7.5.' }, sleep_score: { type: 'integer', description: 'The sleep score or sleep performance out of 100, when the strap gave one.' },
        date: Object.assign({}, DATE, { description: 'The morning he woke up, YYYY-MM-DD. Leave out for this morning.' }), source: { type: 'string', description: 'Where the numbers came from, e.g. WHOOP or Garmin.' } }, ['sleep_h']),
      description: 'Record a night\'s sleep by hand for the morning he woke: hours asleep, and the score when there is one. A number given by hand wins over the feed for that date. The answer is that morning before and after.' },
    { name: 'log_wellness', annotations: RW('The Way: log the morning\'s numbers'),
      inputSchema: obj({ recovery: { type: 'integer', description: 'Recovery out of 100.' }, hrv: { type: 'integer', description: 'HRV in milliseconds.' }, rhr: { type: 'integer', description: 'Resting heart rate.' },
        sleep_h: { type: 'number', description: 'Hours asleep as a decimal.' }, sleep_score: { type: 'integer' },
        date: Object.assign({}, DATE, { description: 'The morning the numbers belong to, YYYY-MM-DD. Leave out for this morning.' }), source: { type: 'string', description: 'Where the numbers came from, e.g. WHOOP.' } }),
      description: 'Record a morning\'s numbers by hand: recovery, HRV, resting heart rate, and sleep when he gave it. Send only the ones he gave; the others keep what they had. The answer is that morning before and after, and which fields changed.' },
    { name: 'mark_taken', annotations: RW('The Way: a medicine or supplement taken'),
      inputSchema: obj({ medicine: { type: 'string', enum: P.medicine.enum.filter(Boolean), description: 'bp = blood pressure medicine, eye_am = morning eye drops, eye_pm = evening eye drops.' },
        supplement: { type: 'string', enum: P.supplement.enum.filter(Boolean) }, again: { type: 'boolean', description: 'true only when he took a second dose of a supplement already logged today.' } }),
      description: 'Mark one medicine or one supplement as taken now, today. One call each. Only when he says he took it. A medicine already marked, or a supplement already logged today, is not logged twice: the answer says so.' },
    { name: 'move_workout', annotations: RW('The Way: move or change a planned session'),
      inputSchema: obj({ date: Object.assign({}, DATE, { description: 'The date the session is on now, YYYY-MM-DD.' }), name: { type: 'string', description: 'Words from the session\'s name ("VO2", "Zone 1", "Push") when the day has more than one.' },
        session_id: { type: 'string', description: 'The session\'s id from get_day or get_week (w_...). The surest way to say which one.' }, at: Object.assign({}, TIME, { description: 'The time it is on now, HH:MM, when two sessions that day have the same name.' }), 
        new_date: Object.assign({}, DATE, { description: 'The date to move it to, YYYY-MM-DD. Leave out to keep the day.' }), time: Object.assign({}, TIME, { description: 'The new start time, HH:MM on the 24-hour clock. Leave out to keep the time.' }),
        minutes: { type: 'integer', description: 'A new length in minutes, to shorten or lengthen it. Leave out to keep the length.' }, library_key: Object.assign({}, P.library_key, { enum: P.library_key.enum.filter(Boolean), description: 'Swap it for this session from the library. Leave out to keep the session.' }) }, ['date']),
      description: 'Move a planned ride or lift to another day or time, shorten or lengthen it, or swap it for a library session. The site\'s own rules still apply (nothing before his earliest session time, spacing between sessions) and it says so when it refuses. When two sessions on the day fit, nothing is guessed: the answer lists them and asks which. The answer is the session before and after.' },
    { name: 'remove_workout', annotations: RW('The Way: take a planned session off', true),
      inputSchema: obj({ date: Object.assign({}, DATE, { description: 'The date the session is on, YYYY-MM-DD.' }), name: { type: 'string', description: 'Words from the session\'s name when the day has more than one.' },
        session_id: { type: 'string', description: 'The session\'s id from get_day or get_week (w_...). The surest way to say which one.' }, at: Object.assign({}, TIME, { description: 'The time it is on now, HH:MM, when two sessions that day have the same name.' }) }, ['date']),
      description: 'Take one planned ride or lift off the calendar. Only when he asked for it to come off. It can be put back with schedule_workout. The answer is the session that was removed.' },
    { name: 'schedule_workout', annotations: RW('The Way: put a session on the calendar'), inputSchema: sched, description: of('schedule_workout').description + ' Fields you do not use may be left out. The answer is the session as it was added.' },
    { name: 'move_event', annotations: RW('The Way: move a calendar event'),
      inputSchema: obj({ date: Object.assign({}, DATE, { description: 'The date the event is on now, YYYY-MM-DD.' }), name: { type: 'string', description: 'Words from the event\'s title.' }, new_date: Object.assign({}, DATE, { description: 'The date to move it to.' }),
        time: Object.assign({}, TIME, { description: 'The new start time.' }), minutes: { type: 'integer', description: 'A new length in minutes.' }, new_name: { type: 'string', description: 'A new title.' } }, ['date', 'name']),
      description: 'Move, lengthen or rename one of his OWN calendar events (not a workout: use move_workout; not a class, a team\'s or the club\'s event: those are never moved from here). The answer says what it was moved to.' },
    { name: 'add_note', annotations: RW('The Way: add a note'),
      inputSchema: obj({ text: { type: 'string', description: 'The note, in a sentence or two.' }, remember: { type: 'boolean', description: 'true for a standing fact or preference the coach must keep in mind from now on ("he does not eat bananas"): it goes in the coach\'s notebook. false or left out: a note about today.' } }, ['text']),
      description: 'Add a note to The Way: a note about today the coach reads with the day, or (remember: true) a standing fact or decision in the coach\'s notebook. The answer is the note as stored.' },
    { name: 'do_action', annotations: RW('The Way: anything else the app does'), inputSchema: doSchema,
      description: d.description.replace('Every field is required: fill the ones the action uses and leave the rest "" or 0.', 'Send type and only the fields that action uses.') + '\n\nUse the named tools above first (log_meal, log_weight, log_sleep, log_wellness, mark_taken, move_workout, remove_workout, move_event, add_note); this one is for the rest: a nap, a lift done, a race, a route, his Garmin, a new calendar event, the shape of his training.' }
  ];
  return TOOLS;
}

const READS = { get_day: getDay, get_week: getWeek, get_recovery_and_sleep: getRecovery, get_weight: getWeight, get_fitness: getFitness, get_notebook: getNotebook };
async function callTool(name, a, base) {
  a = a && typeof a === 'object' ? a : {};
  if (READS[name]) return JSON.stringify(await READS[name](base, a));
  if (name === 'read_site') { const out = await C.readSite(base, str(a.path)); if (typeof out !== 'string') throw new Error(out.error || 'could not read that page'); return out; }
  let out;
  if (name === 'log_meal') out = await logMeal(a, base);
  else if (name === 'log_weight') out = await logWeight(a, base);
  else if (name === 'log_sleep') out = await logMorning(a, base, ['sleep_h', 'sleep_score']);
  else if (name === 'log_wellness') out = await logMorning(a, base);
  else if (name === 'mark_taken') out = await markTaken(a, base);
  else if (name === 'add_note') out = await addNote(a, base);
  else if (name === 'move_workout') {
    if (!isDate(a.new_date) && !isTime(a.time) && !(int(a.minutes) > 0) && !str(a.library_key)) refuse('Say what to change: new_date, time, minutes or library_key.');
    out = await withSessions({ type: 'workout_change', date: a.date, text: await whichSession(a), new_date: str(a.new_date), time: str(a.time), minutes: int(a.minutes), library_key: str(a.library_key) }, base); }
  else if (name === 'remove_workout') out = await withSessions({ type: 'remove_workout', date: a.date, text: await whichSession(a) }, base);
  else if (name === 'schedule_workout') out = await withSessions({ type: 'workout', date: str(a.date), time: str(a.time), library_key: str(a.library_key), name: str(a.name), sport: str(a.sport), minutes: int(a.minutes) }, base);
  else if (name === 'move_event') { if (!isDate(a.date) || !str(a.name).trim()) refuse('date (YYYY-MM-DD) and name (words from the event\'s title) are needed.');
    const r = await act({ type: 'event_change', date: a.date, text: str(a.name), new_date: str(a.new_date), time: str(a.time), minutes: int(a.minutes), name: str(a.new_name) }, base);
    out = { ok: true, summary: r.summary, changed: { event: (/^Moved: (.+?)(, (to|at|now|\d)|\.$)/.exec(r.summary) || [])[1] || str(a.name), was_on: a.date,
      now: Object.assign({}, isDate(a.new_date) ? { date: a.new_date } : {}, isTime(a.time) ? { time: a.time, time_12h: tz.hm12(a.time) } : {}, int(a.minutes) > 0 ? { minutes: int(a.minutes) } : {}, str(a.new_name) ? { title: str(a.new_name) } : {}) } }; }
  else if (name === 'do_action') { if (!C.DO_TYPES.includes(a.type)) refuse('"' + str(a.type) + '" is not something do_action does. It does: ' + C.DO_TYPES.join(', ') + '.');
    const touches = ['remove_workout', 'garmin', 'route', 'new_route'].includes(a.type);
    if (touches) out = await withSessions(a, base); else { const r = await act(a, base); out = Object.assign({ ok: true, summary: r.summary }, pick(r, ['lines', 'url', 'workout_id'])); } }
  else throw new Error('Unknown tool: ' + name);
  return JSON.stringify(out);
}

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const HOW = 'The Way is Harry\'s own training, food and planning site, and his source of truth for the meal plan and the food log. Dates are YYYY-MM-DD and times HH:MM (24-hour) in his local time, US Eastern; say times to him on the 12-hour clock. Read before you answer: get_day for a day, get_week for the plan. Write only what he said happened or asked for, once: every write answers with exactly what changed, so tell him that plainly, and tell him when a write was refused and why. Nothing here reaches another person.';
async function handle(m, base) {
  const { id, method, params } = m || {};
  if (method === 'initialize') return rpc(id, { protocolVersion: VERSIONS.includes(params && params.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'the-way', title: 'The Way', version: '1.1.0' }, instructions: HOW });
  if (typeof method === 'string' && method.startsWith('notifications/')) return null;
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') return rpc(id, { tools: tools() });
  if (method === 'tools/call') {
    try { return rpc(id, { content: [{ type: 'text', text: await callTool(params && params.name, params && params.arguments, base) }] }); }
    catch (e) { return rpc(id, { content: [{ type: 'text', text: 'Error: ' + String((e && e.message) || e) }], isError: true }); }
  }
  return rpcErr(id, -32601, 'Method not found: ' + method);
}
function attach(app) {
  // its own pages are read from its own host: the live site, or a copy of it (a preview); never a host a request merely names
  const baseOf = req => { if (!ON_NETLIFY) return 'http://' + (req.get('host') || '127.0.0.1');
    // the site's own name comes from Netlify (URL), so a new site (26 Nov 2026: the old one was deleted) needs no change here
    const site = (() => { try { return new URL(process.env.URL || 'https://thewayforward.netlify.app').host; } catch (e) { return 'thewayforward.netlify.app'; } })();
    const host = req.get('x-forwarded-host') || req.get('host') || site;
    return host === site || host.endsWith('--' + site) ? 'https://' + host : 'https://' + site; };
  // the key comes in the address (/mcp/<key>) or, better, in a request header claude.ai sends with every call
  // (Authorization: Bearer <key>, or x-way-key: <key>, to plain /mcp): a header stays out of addresses and logs
  const keyFrom = req => { if (req.params.key) return req.params.key; const a = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || ''); return (a && a[1]) || req.get('x-way-key') || ''; };
  const serve = async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, x-way-key, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    // the copy keeps its own store and is already open to the site's own header: /mcp/copy is the way in for tests there
    const copyDoor = SANDBOX && req.params.key === 'copy' && req.get('x-the-way-app') === '1';
    if (!copyDoor) {
      if (!keySet()) return res.status(503).send('The connector is off: WAY_MCP_KEY is not set.');
      if (!keyOK(keyFrom(req))) return res.status(401).send('Unauthorized');
    }
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST, OPTIONS').end();
    const msg = req.body; if (!msg || typeof msg !== 'object') return res.status(400).json(rpcErr(null, -32700, 'Parse error'));
    const base = baseOf(req);
    if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(x => handle(x, base)))).filter(x => x != null); return out.length ? res.json(out) : res.status(202).end(); }
    const out = await handle(msg, base); return out == null ? res.status(202).end() : res.json(out);
  };
  app.all('/mcp', serve); app.all('/mcp/:key', serve);
}
module.exports = { attach, tools, callTool, handle, blank, sessionDiff, mondayOf };
