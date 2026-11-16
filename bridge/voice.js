// ============================================================
// voice.js — the advisor. One sentence in; the right entries out, or an
// answer grounded in the day.
//
// The phone turns speech into text (Web Speech on the page); this reads
// the text and does what it says: a meal, a drink, a supplement, a
// weigh-in, a workout on the calendar (added, changed, taken off), a
// calendar event (added, moved), or a question. Several things in one
// breath are several actions. The model (the same one that reads the
// photos) returns a strict list of actions and one spoken sentence; the
// actions run through the same functions the buttons use, so nothing is
// logged twice or differently.
//
// For a question it is an advisor, not a search box: it sees where the
// day stands (fuel and water on board, what the next session needs, the
// calories and macros still due, the micronutrients short, the calendar,
// the weather) and answers with a recommendation and the one reason that
// decides it: "whole milk: you are 30 g of fat under and the ride is
// Zone 1, so the fat is welcome."
//
//   POST /voice { text }  →  { heard, actions:[{type, ok, summary}], reply }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const { LIBRARY } = require('./workout-library');
const MODEL = process.env.FOOD_MODEL || 'claude-opus-5-5';
// Quick spoken answers and the conversation run on the faster model (Harry, 14 Nov 2026, after the two were timed on
// his own day: a steady 2.2 seconds against 3 to 6, at half the cost; "Sonnet for quick answers"). A photo, the meal
// analysis (food.js) and the researched answers (coach.js) stay on the stronger one. VOICE_MODEL in Netlify overrides.
const QUICK_MODEL = process.env.VOICE_MODEL || 'claude-sonnet-5-5';

const SUPPS = () => require('./micro-math').TABLE.supplements.map(s => s.key);
const FIELDS = ['type', 'text', 'meal', 'supplement', 'medicine', 'lb', 'date', 'time', 'new_date', 'library_key', 'name', 'minutes', 'sport', 'sleep_h', 'sleep_score', 'recovery', 'hrv', 'rhr'];
const SCHEMA = () => ({
  type: 'object', additionalProperties: false, required: ['actions', 'reply', 'offer'],
  properties: {
    reply: { type: 'string' },
    // a change he has not asked for, put to him as a Yes/No: label = the button, plan = exactly what Yes does
    offer: { type: 'object', additionalProperties: false, required: ['label', 'plan'], properties: { label: { type: 'string' }, plan: { type: 'string' } } },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: FIELDS,
      properties: {
        type: { type: 'string', enum: ['meal', 'drink', 'supplement', 'medicine', 'weigh_in', 'workout', 'workout_change', 'remove_workout', 'event', 'event_change', 'remove', 'note', 'save_place', 'wellness', 'nap', 'race', 'garmin', 'route', 'new_route', 'route_here', 'player', 'lift', 'training_model', 'plan_week', 'remember', 'research', 'question'] },
        text: { type: 'string' },
        meal: { type: 'string', enum: ['', 'breakfast', 'lunch', 'dinner', 'snack', 'on the bike'] },
        supplement: { type: 'string', enum: [''].concat(SUPPS()) },
        medicine: { type: 'string', enum: ['', 'bp', 'eye_am', 'eye_pm'] },
        lb: { type: 'number' },
        date: { type: 'string' }, time: { type: 'string' }, new_date: { type: 'string' },
        library_key: { type: 'string', enum: [''].concat(LIBRARY.map(l => l.key)) },
        name: { type: 'string' }, minutes: { type: 'integer' },
        sport: { type: 'string', enum: ['', 'Ride', 'VirtualRide', 'WeightTraining', 'Run'] },
        sleep_h: { type: 'number' }, sleep_score: { type: 'integer' }, recovery: { type: 'integer' }, hrv: { type: 'integer' }, rhr: { type: 'integer' }
      } } }
  }
});

const race = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise(r => setTimeout(() => r(fallback), ms))]);
const L = ml => (Math.abs(ml) / 1000).toFixed(1) + ' L';

// Where the day stands, in plain lines the model can reason from.
// Reading the whole day takes about five seconds, half of the wait for an answer (measured 14 Nov 2026, when Harry asked
// for faster answers). So it is read ahead and kept: the page asks for it the moment he opens the Coach page, presses
// the talk button or starts a conversation (GET /voice/warm), and by the time he has finished speaking it is there.
// Kept 90 seconds, in this process and in the store (the next request may land on another process); anything he logs
// or changes through the coach clears it. The clock is never kept: the time of the question is added when it is asked.
const CTX_KEY = 'voice-context', CTX_TTL = 90000;
let ctxKept = null;
const ctxGood = c => c && c.text && c.slow != null && c.day === tz.todayKey() && Date.now() - c.at < CTX_TTL;
async function contextFresh() { ctxKept = null; try { await setJSON(CTX_KEY, { at: 0 }); } catch (e) { /* it ages out */ } }
async function contextBuild() {
  const now = await contextNow();
  ctxKept = { at: Date.now(), day: tz.todayKey(), text: now.text, slow: now.slow };
  try { await setJSON(CTX_KEY, ctxKept); } catch (e) { /* kept in this process at least */ }
  return ctxKept;
}
async function contextKept() {
  if (ctxGood(ctxKept)) return ctxKept;
  try { const c = await getJSON(CTX_KEY, null); if (ctxGood(c)) { ctxKept = c; return c; } } catch (e) { /* read it fresh */ }
  return null;
}
// the whole of it as one text (advisor.js reads it so)
async function context() { const p = await contextParts(); return (p.slow ? p.slow + '\n' : '') + p.live; }
// live: where the day stands at this minute; slow: the standing record, the same from turn to turn
async function contextParts() {
  const c = (await contextKept()) || (await contextBuild());
  const age = Math.round((Date.now() - c.at) / 1000), p = tz.parts(new Date());
  // read a moment ago: say so, and give the time now, so "starts in 12 minutes" is never read as the present
  const live = age < 20 ? c.text : `${c.text}\n(The lines above were read ${age} seconds ago. The time now is ${tz.hm12(String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'))}; count any "in N min" from there.)`;
  return { live, slow: c.slow || '' };
}
// ---- words the coach is given, kept pure so each correction stays a test (coach-rules.test.js) ----
// he is on the bike in the workout player and asks something: the page sends what the player shows at that second
// (pwa/player.js live()), so "how am I doing" is answered from his heart rate and power, not from the plan
function rideWords(r) {
  if (!r || typeof r !== 'object' || !/^(riding|paused|countin)$/.test(String(r.state || ''))) return '';
  const n = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x) : null; };
  const el = n(r.elapsed_s, 0, 86400), total = n(r.total_s, 1, 86400), hr = n(r.hr, 30, 230), pw = n(r.power, 0, 2000), cad = n(r.cadence, 0, 250), tg = n(r.target_w, 0, 2000), left = n(r.step_left_s, 0, 86400);
  const mm = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, name = String(r.name || 'the workout').slice(0, 80), step = String(r.step || '').slice(0, 60);
  return `\nHE IS ON THE BIKE NOW, in the workout player, riding ${name}${r.state === 'paused' ? ' (paused)' : r.state === 'countin' ? ' (about to start)' : ''}: ${el != null ? `${mm(el)} in${total ? ` of ${mm(total)}` : ''}` : 'time not given'}; heart rate ${hr != null ? hr : 'no reading'}; power ${pw != null ? pw + ' W' : 'no reading'}${tg != null ? ` against a target of ${tg} W` : ''}${cad != null ? `; cadence ${cad}` : ''}${step ? `; the step now: ${step}${left != null ? `, ${mm(left)} left in it` : ''}` : ''}${n(r.avg_hr, 30, 230) != null ? `; average heart rate so far ${n(r.avg_hr, 30, 230)}` : ''}${n(r.avg_power, 0, 2000) != null ? `, average power ${n(r.avg_power, 0, 2000)} W` : ''}. Answer as the coach beside him: from these numbers, in one or two short sentences he can take in while pedalling. Zone 1 is heart rate 100 to 116; on a one-hour trainer ride he holds near 110.`;
}
// a session that is done: what was ridden, never the plan's length read off its name
function doneWords(s, work) {
  const ride = /ride/i.test(String((s && s.sport) || ''));
  return ride && s.minutes && work && !work.compliant ? ` (ridden: ${s.minutes} min; a number in its name is the plan's, not what was ridden)` : s && s.minutes && (ride || /run/i.test(String(s.sport || ''))) ? ` (done, ${s.minutes} min)` : ' (done)';
}
function workWords(work) {
  return work && work.planned_min ? `RIDING TODAY AGAINST THE PLAN: ${work.done_min} of ${work.planned_min} planned minutes ridden${work.pct != null ? `, graded ${work.pct}% by the site` : ''}${work.compliant ? ' (ridden as planned)' : ' (NOT the full plan: never say the planned ride is done in full)'}. ${work.note || ''}`.trim() : null;
}
// last night by itself: the chain carries only the week's average
function nightWords(sleepLast, today) {
  const h = sleepLast && sleepLast.date === today && sleepLast.hours != null ? sleepLast.hours : null;
  return h != null ? `LAST NIGHT he slept ${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min (the night into today; his line is 7 h).`
    : 'LAST NIGHT: no reading for last night has reached the site yet (the watch has not synced today, or it was off). If he asks how he slept, say that; the week\'s average is in THE CHAIN.';
}
async function contextNow() {
  const today = tz.todayKey(), tomorrow = tz.shiftKey(today, 1);
  const p = tz.parts(new Date());
  const nowMin = p.h * 60 + p.mi;
  const W = require('./workout-math');
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const [day, sched, wx, week, chain, scores, sig, lifts, weigh, sleepLast, meds, notebook, said, debrief, win] = await Promise.all([
    race(require('./food').dayReport(today), 6000, null),
    race(require('./calendar').scheduleReport({ days: 2, light: true }), 5000, null),
    race(require('./weather').forecastAt(today, Math.max(nowMin, 7 * 60), 8 * 60), 2500, null),
    race(require('./workouts').calendar(today, tz.shiftKey(today, 6)), 4000, null),
    getJSON('chain-last', null).catch(() => null),
    getJSON('scores-last', null).catch(() => null),
    race(require('./signature').report(), 2500, null),
    getJSON('lifts', { sessions: [] }).catch(() => ({ sessions: [] })),
    race(require('./weighin').state(), 2500, null),
    getJSON('sleep-last', null).catch(() => null),
    race(require('./meds').today(), 2000, null),
    getJSON('coach-notebook', { notes: [] }).catch(() => ({ notes: [] })),
    getJSON('voice-notes', { notes: [] }).catch(() => ({ notes: [] })),
    getJSON('coach-debrief-last', null).catch(() => null),
    race(require('./sleep-window').get(), 1500, null)
  ]);
  // what changes slowly (his record, his routes, his races, the lifting, the notebook, the model) is kept apart: it
  // rides in a second cached block of the prompt, so a conversation pays for it once, not on every turn
  const slow = [];
  const lines = [`Today is ${today}, a ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today + 'T12:00:00Z').getUTCDay()]}; the time is ${tz.hm12(String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'))}.`];
  // the weight the food maths runs on is a planning figure; what he weighs is his last weigh-in (weighin.weightWords)
  lines.push(`Planning FTP ${st.ftp} W, threshold heart rate ${st.lthr}. The food maths runs on ${(day && day.target && day.target.kg) || 98} kg (a planning figure, never quoted as his weight).`);
  try { lines.push(require('./weighin').weightWords(weigh && weigh.all, today, { start_lb: weigh && weigh.start_lb })); } catch (e) { /* no weight line */ }
  // how his riding week is shaped (planner.js): he sets it, you plan by it
  try { slow.push(`TRAINING MODEL (he sets it; change it only when he tells you to): ${require('./planner').modelWords(await require('./planner').model())}`); } catch (e) { /* no model line */ }
  // his sleep window as Setup has it: the earliest a new session is placed is an hour after waking, 7:00a the floor
  if (win && win.bed_hm && win.wake_hm) slow.push(`SLEEP WINDOW: ${tz.hm12(win.bed_hm)} to ${tz.hm12(win.wake_hm)}. A new session is placed no earlier than ${tz.hm12(win.earliest_workout_hm || '07:30')} (an hour after waking); he may ask for 7:00a; nothing before 7:00a, ever.`);
  // last night, by itself: the chain below carries only the week's average (the coach had no reading of the night)
  lines.push(nightWords(sleepLast, today));
  // a read that did not come back in time is said, never passed over: without it the model answered from old turns
  if (!day) lines.push('TODAY\'S FOOD, MEALS, SESSIONS AND FUEL COULD NOT BE READ just now (the read ran out of time). Do not state any of today\'s food, meal, session, fuel or water numbers and log nothing that depends on them: say you cannot see the day at this moment and ask him to ask again in a few seconds.');
  if (!sched) lines.push('The calendar could not be read just now: do not state what is on it today or tomorrow from memory.');
  if (day) {
    const t = day.target, a = day.actual;
    lines.push(`Food day: ${day.fuel_day}. Whole-day target ${t.kcal} kcal, ${t.carbs_g} g carbs, ${t.protein_g} g protein, ${t.fat_g} g fat (${t.deficit ? `a ${Math.abs(t.deficit)} kcal deficit for weight loss` : 'no deficit today: recovery is low, eat to maintenance'}). Eaten so far: ${a.kcal} kcal, ${a.carbs_g} C / ${a.protein_g} P / ${a.fat_g} F in ${a.meals} meal(s). Still to eat today: ${Math.max(0, t.kcal - a.kcal)} kcal, ${Math.max(0, t.carbs_g - a.carbs_g)} C / ${Math.max(0, t.protein_g - a.protein_g)} P / ${Math.max(0, t.fat_g - a.fat_g)} F.`);
    // where each one is done (where.js): the lift at Life Time, a ride outside or, in bad weather, in the pain cave
    const todayEv = ((sched && sched.days) || []).find(d => d.date === today), evOf = s => todayEv && (todayEv.events || []).find(e => e.category === 'training' && e.summary === s.name);
    const whereOf = s => { if (s.done) return ''; const e = evOf(s), pl = e ? e.place : require('./where').placeOf({ sport: s.sport, name: s.name }); return pl ? `, ${pl === 'pain cave' ? 'in the pain cave at home' : pl === 'Life Time' ? 'at Life Time' : pl === 'home' ? 'at home' : 'outside'}${e && e.indoor ? ` (not outside: ${e.indoor.why})` : ''}` : ''; };
    // each session against the clock (Harry, 14 Nov 2026, 4:09p: the coach said the 3:15p lift "starts now": "Time of
    // day is off"): how long until it starts, how long it has been going, or that its time has passed
    const dur = m => m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}` : `${m} min`;
    const whenOf = s => { if (!s.time) return 'planned, no time set';
      // he pressed Start (workouts.js): that minute is the session's real start
      { const e = evOf(s); if (e && e.started_at) { const st0 = (+s.time.slice(0, 2)) * 60 + (+s.time.slice(3, 5)), en0 = st0 + (s.minutes || 60), end0 = tz.hm12(String(Math.floor(en0 / 60) % 24).padStart(2, '0') + ':' + String(en0 % 60).padStart(2, '0'));
        return nowMin < en0 ? `he pressed Start at ${tz.hm12(s.time)}: under way, ${dur(Math.max(0, nowMin - st0))} in, until about ${end0}` : `he pressed Start at ${tz.hm12(s.time)}; it should have finished about ${end0}; not logged yet`; } } const st = (+s.time.slice(0, 2)) * 60 + (+s.time.slice(3, 5)), en = st + (s.minutes || 60);
      const endHM = tz.hm12(String(Math.floor(en / 60) % 24).padStart(2, '0') + ':' + String(en % 60).padStart(2, '0'));
      return nowMin < st - 5 ? `planned, starts in ${dur(st - nowMin)}` : nowMin <= st + 5 ? 'planned, starts now'
        : nowMin < en ? `planned: it began ${dur(nowMin - st)} ago and runs until ${endHM}; not logged yet, he may be in it`
        : `planned: its time has passed (it was to end at ${endHM}, ${dur(nowMin - en)} ago); not logged yet`; };
    const doneOf = s => doneWords(s, day.work);
    if (day.sessions.length) lines.push('TRAINING TODAY, the complete list, there is no other session: ' + day.sessions.map(s => `${s.name}${s.sport ? ` [${s.sport === 'VirtualRide' ? 'trainer ride' : s.sport === 'Run' ? 'run' : s.sport === 'WeightTraining' ? 'lift' : 'ride'}]` : ''}${s.time ? ' at ' + tz.hm12(s.time) : ''}${whereOf(s)}${s.done ? doneOf(s) : ` (${whenOf(s)})`}`).join('; ') + '. Name a session only by this list: never a run when the list says ride, never a time that is not on it.');
    // how much of the plan was ridden (Harry rode 51 of 90 minutes on 15 Nov 2026 and the line said "Zone 1, 90 min (done)")
    if (workWords(day.work)) lines.push(workWords(day.work));
    else lines.push('No training today: no ride, no run, no lift. Do not name one.');
    // naps (naps.js): the one offered today after a short night, or the one he took
    { const todayEv2 = ((sched && sched.days) || []).find(d => d.date === today), naps = todayEv2 ? (todayEv2.events || []).filter(e => e.kind === 'nap') : [];
      if (naps.some(e => e.taken)) lines.push('NAP today, logged: ' + naps.filter(e => e.taken).map(e => `${e.minutes} min at ${e.from}`).join(', ') + '. A nap counts toward today\'s sleep: its first 30 minutes in full, half of the rest, 45 minutes at most.');
      else if (naps.length) lines.push(`NAP: ${naps[0].detail.split(':')[0]}, short of 7. A 25 minute nap fits at ${naps[0].from}, at home; it must end by 3 p.m. Offer it when he asks about energy, sleep or the afternoon; he logs it himself by saying "I napped 25 minutes".`); }
    if (day.cue) lines.push('Where the day stands: ' + day.cue.text);
    if (day.guidelines && day.guidelines.length) lines.push("Today's eating rules: " + day.guidelines.map(g => g.text).join(' ').slice(0, 400));
    { const nowM = (() => { const p = tz.parts(new Date()); return p.h * 60 + p.mi; })(), toM = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
      const recent = (day.entries || []).filter(e => !e.supplement && toM(e.time) != null && nowM - toM(e.time) <= 180);
      if (recent.length) lines.push('ALREADY IN THE JOURNAL in the last three hours (never log any of these again unless he says another, more, a second or again): ' + recent.map(e => `${tz.hm12(e.time)} ${e.name}${e.written ? ` (he said "${String(e.written).slice(0, 60)}")` : ''}`).join('; ') + '.'); }
    if (day.meals && day.meals.length) {
      // the same rows the Day page and the Food page show (food.js rowsFor): what is eaten, and what is still open
      const slotTxt = m => `${tz.hm12(m.time)}${m.next_day ? ' (after midnight)' : ''} ${m.slot === 'after' ? 'post-workout meal' : m.slot === 'before' ? 'pre-workout snack' : m.slot}`;
      const nums = m => m.kcal ? `${m.carb ? m.carb.word.toUpperCase() + ': ' : ''}${m.kcal} kcal, ${m.low_carb ? 'under ' : ''}${m.carbs_g || 0} g carbs, ${m.protein_g || 0} g protein` : `${m.carbs_g || 0} g carbs`;
      lines.push('Each meal carries the carb label its card shows (LOW CARB, BALANCED, HIGH CARB). When you name a meal, say its label first, in those words, and fit the food you suggest to it: never starch for a low carb meal, never a light plate for a high carb one. Size it to that meal, never to catch up the whole day; if the plan looks wrong for what is coming, say "the plan says X; I would eat Y because Z" and let him choose.');
      lines.push('The meal plan: ' + day.meals.map(m => `${slotTxt(m)} (${nums(m)}${(m.logged || []).length ? ', logged' + (m.match ? ', ' + m.match.word : '') : ''})`).join('; ') + '.');
      const open = day.meals.filter(m => !(m.logged || []).length && !m.covered_by && !(m.slot === 'on the bike' && !(m.carbs_g > 0)));
      lines.push(open.length
        ? `STILL OPEN ON THE PLAN, exactly as the Day page shows it (when he asks what is left to eat, name these slots by time and name with their numbers and what each says, and nothing else): ${open.map(m => `${slotTxt(m)}: ${m.what} (${nums(m)})`).join('; ')}.`
        : 'Every slot on the plan is logged: nothing is left to eat on the plan today.');
    }
    const e = day.energy;
    if (e && e.now) {
      const ateToday = (day.entries || []).some(x => !x.supplement && (x.kcal || 0) > 0);
      lines.push(`Live fuel now: quick store ${e.now.pct}% (${e.now.band.word}), legs ${e.now.legs_pct}%.` + (ateToday ? '' : ' NOTHING EATEN TODAY YET: these numbers are what is left from yesterday after the night. Never say he is fuelled, fed or has eaten; say what to eat before the session.') + (e.sessions || []).map(s => ` ${s.name} at ${tz.hm12(s.time)} needs ${s.need}% quick and ${s.need_legs}% legs; ${ateToday ? 'it will have' : 'with the planned food before it, it will have'} ${s.pct}% and ${s.legs_pct}% (${s.band.word}).`).join('') + (e.advice ? ' Advice: ' + e.advice : ''));
    }
    const h = day.hydration;
    if (h && h.now) lines.push(`Live hydration now: ${h.now.ml >= 0 ? '+' : '-'}${L(h.now.ml)} on the morning (${h.now.band.word}); ${L(h.drunk_ml)} drunk of about ${L(h.target_ml)} for the day.` + (h.sessions || []).filter(s => !s.done).map(s => ` ${s.name.replace(/,.*$/, '')} will sweat about ${L(s.sweat_ml_h)} an hour.`).join('') + (h.advice ? ' Advice: ' + h.advice : ''));
    if (day.micros && day.micros.gaps && day.micros.gaps.length) lines.push('Micronutrients short this week: ' + day.micros.gaps.map(g => g.label).join(', ') + '.');
    if (day.suggestion && !day.suggestion.none) lines.push(`NEXT ON THE PLAN: ${day.suggestion.name}: ${day.suggestion.what} About ${day.suggestion.kcal} kcal, ${day.suggestion.low_carb ? 'under ' : ''}${day.suggestion.carbs_g} g carbs, ${day.suggestion.protein_g} g protein.`);
  }
  if (sched && sched.days) {
    for (const d of sched.days.filter(x => x.date === today || x.date === tomorrow)) {
      const evs = (d.events || []).map(ev => `${ev.from}–${ev.to} ${ev.summary}${ev.workout_id ? ' [workout]' : ''}`);
      if (evs.length) lines.push(`Calendar ${d.date === today ? 'today' : 'tomorrow'}: ${evs.join('; ')}.`);
    }
    if (typeof sched.recovery === 'string') lines.push(`Recovery today (from the watch): ${sched.recovery} (${sched.recovery === 'green' ? 'ready' : sched.recovery === 'yellow' ? 'moderate, keep it easy' : 'low, rest or Zone 1 only'}).`);
  }
  if (wx && wx.summary) lines.push(`Weather for riding today: ${wx.summary}.`);
  // the week ahead, as the plan has it
  if (week && week.days) {
    const ahead = week.days.filter(d => d.date > today).map(d => {
      const items = (d.planned || []).map(w => `${w.name}${w.time ? ' ' + tz.hm12(w.time) : ''}${w.course && w.course.name ? ' on ' + w.course.name : ''}${/ride|run/i.test(String(w.sport || '')) ? (w.sync && w.sync.state === 'synced' ? ' [on the Garmin]' : ' [not on the Garmin]') : ''}`)
        .concat((d.intervals || []).map(e => `${e.name}${e.time ? ' ' + tz.hm12(e.time) : ''}`));
      return items.length ? `${d.date.slice(5)}: ${items.join(', ')}` : null;
    }).filter(Boolean);
    lines.push(ahead.length ? 'THE WEEK AHEAD (planned): ' + ahead.join(' · ') + '.' : 'Nothing planned for the rest of the week yet.');
  }
  // fuel the journal does not show (chain.js fuelChecks leaves it out of the score and names it): ask, never scold
  if (chain && chain.links && chain.links.fuel && Array.isArray(chain.links.fuel.unlogged) && chain.links.fuel.unlogged.length)
    lines.push('FUEL NOT LOGGED (left out of the Fuel score, not counted as missed): ' + chain.links.fuel.unlogged.map(u => `${u.what.join(' and ')} on ${String(u.name || 'a ride').replace(/,.*$/, '')}${u.time ? ' at ' + tz.hm12(u.time) : ''}`).join('; ') + '. When it fits the conversation, ask him once whether he had it, and log what he says with its time; never call it missed.');
  // fitness and form (CTL from the rides), from the last read of the scores
  if (scores && scores.ctl != null) lines.push(`Fitness (CTL) ${scores.ctl}, ${scores.ramp_7d >= 0 ? '+' : ''}${scores.ramp_7d} this week (${scores.ramp}); fatigue (ATL) ${scores.atl}, form ${scores.tsb} (${scores.form}). Green for fitness is a rise of 2 to 6 a week.`);
  // the chain on the front page: the week's links and where it breaks
  if (chain && chain.links && Date.now() - (chain.at || 0) < 12 * 3600e3) {
    const L = chain.links, w = (k, u) => L[k] && L[k].week != null ? `${k} ${L[k].week}${u || ''} (${L[k].state})` : `${k} —`;
    lines.push(`THE CHAIN this week: ${[w('sleep', ' h/night'), w('water', '% of target'), w('food', ' avg'), w('micros'), w('lift', '% of plan'), w('work', '% of plan'), w('recovery', '% vs band'), w('weight', ' lb/wk'), w('power', ' W FTP')].join('; ')}. Verdict: ${chain.verdict}${L.recovery && L.recovery.today_word ? ` This morning's recovery: ${L.recovery.today} (${L.recovery.today_word}).` : L.recovery && L.recovery.today != null ? ` This morning's recovery: ${L.recovery.today}.` : ''}`);
  }
  // the signature and zones
  if (sig && sig.signature) slow.push(`Power signature (Xert-style, from the last 90 days): TP ${sig.signature.tp} W, HIE ${sig.signature.hie_kj} kJ, PP ${sig.signature.pp} W, ${sig.confidence} confidence; planning FTP stays ${st.ftp} W unless he changes it. Zone 1 is heart rate 100 to 116, a floor as well as a ceiling (the site grades a Zone 1 ride by time at 116 and under); on a one-hour trainer ride he holds near 110.`);
  // the Power box: FTP the way Xert reads it, the breakthroughs, and what would be one today
  if (sig && sig.power) { const P = sig.power, bt = P.last_breakthrough;
    slow.push(`POWER (the Power box and page): his FTP the way Xert reads it is ${P.ftp} W${P.wkg ? `, ${P.wkg} W/kg at his latest weigh-in` : ''}${P.ftp_28d_ago != null ? `; four weeks ago it read ${P.ftp_28d_ago} W` : ''}. ${bt ? `Last breakthrough: ${bt.medal} on ${tz.dayShort(bt.date)}, ${bt.days_ago} days ago (${String(bt.text || '').slice(0, 160)})` : 'No breakthrough in the last 90 days'}.${P.fade_note ? ' ' + P.fade_note : ''} A breakthrough today would be any one of: ${P.targets.map(t => `${t.word} over ${t.watts} W`).join(', ')}, all-out on a fresh day. This number moves up only when an effort proves it and fades a percent a week once its efforts are four weeks old; Zone 1 riding builds the engine but cannot show on it. When he asks how to see his FTP improve, say that plainly, name those targets, and offer one breakthrough attempt in place of a VO2 session on a day he is fresh (never on a rest day, never the day after a leg day). It is not the planning FTP (${P.planning_ftp} W), which the plan and zones run on and only he changes.`); }
  // the lifting
  if (lifts && lifts.sessions) {
    const LF = require('./lifts'), five = LF.TEMPLATES.map(t => t.key), shortOf = k => (LF.TEMPLATES.find(t => t.key === k) || {}).short || k;
    const wk = lifts.sessions.filter(x => x.date >= LF.mondayOf(today) && x.date <= today && five.includes(x.template)), did = [...new Set(wk.map(x => x.template))];
    const last = lifts.sessions[lifts.sessions.length - 1];
    slow.push(`Lifting: five sessions, each once every seven days: Push, Pull, Upper, Legs 1 (heavy: squat, leg press, Romanian deadlift) and Legs 2 (lighter, one leg at a time, short of failure). Two leg days because leg strength is his limiter (his words, 15 Nov 2026) and the research on strength work for cyclists backs two a week while building. Where they go: each leg day two or three days before a hard ride (VO2, threshold, a race) and never the day before one, with two clear days between the two; deadlifts (Pull) not the day before a hard ride; a leg day or Pull three hours from a hard ride on the same day. The lifting week runs Monday to Sunday; a session missed is moved to a day still open or lost with the week, never stacked. This week so far: ${did.length} of the 5 (${did.map(shortOf).join(', ') || 'none'}${five.some(k => !did.includes(k)) ? '; not yet: ' + five.filter(k => !did.includes(k)).map(shortOf).join(', ') : ''})${last ? `, last ${shortOf(last.template)} on ${tz.dayShort(last.date)}` : ', none logged yet'}. Extra to the five, at home: the Pump and the Kettlebell Blasts A (swing and squat) and B (press and carry), each on the Lift page with its exercises. Lifting does not count toward fitness (CTL).`);
  }
  // supplements and medicines: what is taken and what is still due today (he asked the coach what he had taken; it could not see)
  if (day) { try { const SP = require('./supps').dueFor(today, day.sessions, day.entries, nowMin, null, win || undefined);
      lines.push('SUPPLEMENTS today: ' + SP.due.map(x => `${x.name}${x.taken ? ' taken' : x.past ? ' not taken (its ride is done)' : x.time ? ` due ${tz.hm12(x.time)}, not taken yet` : ' due today, not taken yet'}`).join('; ') + '.'); } catch (e) { /* no supplements line */ } }
  if (meds && meds.due && meds.due.length) lines.push('MEDICINES today: ' + meds.due.map(m => `${m.name} (${tz.hm12(m.time)}): ${m.taken ? 'taken' : 'not taken yet'}`).join('; ') + '.');
  // the researched coach's debrief of today's ride, which he has read on the Day page: the two coaches agree
  if (debrief && debrief.date === today && debrief.say) { const ride = String(debrief.answer || '').split(/\n{2,}/).find(p => /^\s*\*\*The ride\*\*/i.test(p)) || '';
    lines.push(`THE DEBRIEF of today's ride (${debrief.ride_name || 'the ride'}), written by the researched coach and shown on his Day page; agree with it and build on it: ${debrief.say} ${ride.replace(/\*\*/g, '').replace(/\s+/g, ' ').slice(0, 600)}`); }
  // what the coach has already said to him unasked today (coach-first.js): never contradict it without saying why
  try { const F = await race(require('./coach-first').state(), 1500, null);
    if (F && F.morning) lines.push(`THIS MORNING'S BRIEFING, which you sent to his phone at ${tz.hm12(new Date(F.morning.at).toLocaleTimeString('en-GB', { timeZone: tz.ZONE, hour: '2-digit', minute: '2-digit' }))}: "${String(F.morning.text).slice(0, 500)}"`);
    if (F && F.alerts && F.alerts.length) lines.push('ALERTS you sent to his phone today: ' + F.alerts.map(a => `${a.title} (${a.body})`).join('; ').slice(0, 500));
    if (F && F.review && F.review.status === 'done' && F.review.answer) slow.push(`THE WEEKLY REVIEW of the week of ${F.review.week_of}, written by the researched coach and shown on his Day page; build on it: ${F.review.say} ${String(F.review.answer).replace(/\*\*/g, '').replace(/\s+/g, ' ').slice(0, 900)}`); } catch (e) { /* nothing said yet */ }
  // one notebook for both coaches (coach.js write_note, the remember action here), and what he has told the coach lately
  { const nb = ((notebook && notebook.notes) || []).slice(-30);
    if (nb.length) slow.push('THE NOTEBOOK (kept between conversations by you and the researched coach: decisions made with him, what he asked you to remember, patterns, things to check). Coach by it; when a note is out of date say so:\n' + nb.map(n => `- ${n.date || ''} [${n.kind || 'note'}] ${String(n.note || '').slice(0, 300)}`).join('\n'));
    const lately = ((said && said.notes) || []).filter(n => n.date >= tz.shiftKey(today, -7)).slice(-10);
    if (lately.length) slow.push('WHAT HE TOLD YOU in the last week (his words, noted): ' + lately.map(n => `${tz.dayShort(n.date)}: "${String(n.text || '').slice(0, 160)}"`).join('; ') + '.'); }
  // his Ride with GPS routes (routes.js): the library he can ride from, kept six hours
  try { const RT = require('./routes'); slow.push(RT.libraryText(await race(RT.list(), 2500, null))); } catch (e) { /* no routes line */ }
  // his race calendar (races.js): what is ahead and the season's clock
  try { const R = require('./races'); slow.push(R.aheadText(await race(R.report(), 2000, null))); } catch (e) { /* no races line */ }
  // the look back (history.js): his last fortnight day by day, his best food days, his habits, the trends
  try { const hist = await race(require('./history').digest(14), 2500, ''); if (hist) slow.push(hist); } catch (e) { /* the day stands without it */ }
  return { text: lines.join('\n'), slow: slow.filter(Boolean).join('\n') };
}

// The standing part of the prompt, the same on every utterance, kept in a cached system block (docs/api-spend.md):
// who he is, how the app works, the action types and the reply rules. The day's state and his words follow.
function systemText() {
  return `You are his training and nutrition advisor, the voice of one cyclist's training and food app. He is 48 and training through a slow weight loss. His goal: to become a high-level masters cyclist, racing-fit for his age group, while the weight comes down slowly. You know the whole plan, sent with each message (today, the week ahead, the fitness numbers, the chain, the signature, the lifting) and you answer from it; when he asks what to do, give one clear call and the reason in a sentence. Turn what he said into actions, and write one spoken reply.

How the app works (the architecture, the models and their rules, the standing rules):
${require('./advisor-brief')}
${require('./expert')}

Action types:
- meal: something eaten. text = the plate in his words (keep every food and any weights); meal = which meal if he said or it is obvious from the time, else "".
- drink: something drunk on its own (water, coffee, a bottle, a shake with nothing else). text = what and roughly how much.
- supplement: one of the known supplements (supplement = its key). One action per supplement.
- medicine: a medicine taken (meds.js): medicine = "bp" (his blood pressure pill), "eye_am" (eye drops before noon) or "eye_pm" (eye drops from noon). "Took my pill and did my eye drops" at night is two actions: bp and eye_pm.
- weigh_in: lb = his weight in pounds (convert kg if he says kg).
- workout: a ride, run or session to put on the calendar, or one already done today said after the fact ("I ran 40 minutes on the treadmill": sport Run, minutes 40, time = when it started or ""). date = YYYY-MM-DD (resolve "tomorrow", "Saturday"; the next such day), time = HH:MM 24h or "" if none, library_key when one of the library sessions fits, else name/minutes/sport. Library: ${LIBRARY.map(l => `${l.key} (${l.name})`).join(', ')}.
- A session before 7 a.m. is against the rules. If he names a time before 7 (or an ambiguous "6:30" that could be morning), do NOT pick p.m. to get around it and do NOT change anything: return a question action and ask, e.g. "6:30 a.m. breaks the 7 a.m. rule. Keep it at 7:00a, or did you mean 6:30 p.m.?". Only an explicit p.m. ("6:30 pm", "half past six tonight") is an evening time.
- workout_change: change a planned session: make it longer or shorter (minutes = the NEW total length; "add 30 minutes" to a 90 means 120), move its start (time = new HH:MM), move it to another day (new_date), or swap it for another library session (library_key). date = the day it is on now (today if unsaid), text = what he called it or "".
- remove_workout: take a planned session off the calendar. date = its day, text = what he called it or "".
- event: anything else to put on the calendar (a dentist, a meeting, a drive). name = the title, date = YYYY-MM-DD, time = HH:MM or "" for all day, minutes = length (60 if he gave none), text = notes or "".
- event_change: move or change a calendar event that is not a workout: text = which event in his words, date = the day it is on now, time = new start HH:MM or "", new_date = the day to move it to or "", minutes = new length or 0, name = new title or "".
- remove: take something back out of today's food journal. text = what to remove ("the salmon", "the water"), or "" for the last thing logged ("undo", "delete that").
- note: a passing remark about how he feels or slept today, text = his words. You see the last week of them under WHAT HE TOLD YOU.
- remember: he tells you something to keep for good: about himself, his kit, his constraints, his preferences or how he wants to be coached ("remember that I can't ride before 9 on Thursdays", "I only have one kettlebell", "don't suggest oatmeal, I hate it"). text = the fact as one plain sentence that will still make sense months from now, with the date if it has one. It goes in THE NOTEBOOK, which you and the researched coach both read on every question. Use it also when he corrects you on a standing fact ("I told you, I never ride at Life Time"). Not for a remark about today (that is a note), and not instead of the action that does the thing: a change to how his training week is shaped is a training_model action too.
- garmin: he wants a planned ride or run put on his Garmin, or taken off it ("send tomorrow's ride to my Garmin", "put this week's rides on the Garmin", "take Thursday's ride off the Garmin"). It goes through intervals.icu, which passes it to the Garmin. date = the day (the first day of a stretch); new_date = the last day when he means several days ("this week": today to six days on), else ""; text = words that name the session, or "" for every ride and run in the day or stretch; name = "off" to take it off, else "". A session already on the Garmin that you change with workout_change is re-sent by itself; do not add a garmin action for that. Lifts are not sent: he logs them on the Lift tab.
- route: he wants one of HIS ROUTES (the list under where the day stands) to be the route for a planned ride ("ride the Loch Raven loop on Saturday", "use my Annapolis 30 for tomorrow's ride"). name = the route's name as in the list; date = the ride's day; text = words that name the ride, or "". Only a route in the list.
- new_route: he wants a new route made and saved to his Ride with GPS library. Two kinds. A loop from home for a ride of a given length ("make me a 90 minute road loop", "build a two hour loop heading north"): minutes = the riding time; text = "direction=north|northeast|east|southeast|south|southwest|west|northwest; type=road|gravel|mtb; start=here", leaving out what he did not say (start=here only when he wants the loop from where he is standing now and not from home); name = a name if he gave one, else "". Or a ride he has already done, kept as a route ("save last Saturday's ride as a route called Davidsonville loop"): text = "from=YYYY-MM-DD" (the day of that ride), minutes 0, name = the name he gave. date = the day of a planned ride it should become the route for, else "". The loop is drawn by a map service on roads a bicycle can use: tell him to look it over in Ride with GPS before he rides it. It reaches the Garmin the way his other Ride with GPS routes do.
- route_here: he is somewhere and wants to ride one of his routes from there ("where do I start", "what's the best route from here", "start the Loch Raven loop from where I am"). FIRST call routes_near, once, and read what it gives (if it answers with an error, say what it said and do not call it again); pick the best for him now: a short way to the route, a length that fits the time he has or today's planned ride, daylight left, how fresh he is. In the reply name the route, its length, its kind as the row gives it (a loop, an out and back, or one way), and WHERE TO GO to start it: the street the nearest point is on, how far and which way from him ("head a mile north to Clopper Road and pick it up there"); the start is the point on the route nearest him, never the route's usual start. Then add this action so the page shows directions to that point: name = the route's name as routes_near gave it (or the one he named); minutes = the time he has, or 0; text = "save=yes" ONLY when he asks for it saved, made or put on his Garmin (the route is then saved to Ride with GPS begun at that point, as a new route beside the original), otherwise "" and put the saving to him as an offer (plan: "Save <route> to Ride with GPS starting from the point nearest me"); date = the day of a planned ride the saved route should become the route for, else "". If routes_near finds none near him, say so and offer a loop drawn from where he stands (new_route with start=here). If it says no location came, tell him to allow location for the site.
- lift: he says he DID one of his lifting sessions and wants it counted ("I did legs this morning", "push is done", "finished my lift", "I did the kettlebell blast"). name = the session as he named it: Push, Pull, Upper, Legs 1, Legs 2, Pump, Kettlebell Blast A or Kettlebell Blast B; plain "Kettlebell Blast" or "Legs" when he does not say which, and "" when he only says "my lift" (the one planned that day is taken; never guess the letter or the number). date = the day he did it (today unless he says). It is marked done for the week's count without its sets; say that the sets and weights go on the Lift page if he wants the targets to move. Never a workout action for a lift already done: that would put a second copy on the calendar. To PLAN a lift or a Blast on a day, that is a workout action with its library_key.
- training_model: he changes HOW his training is shaped, for good ("from now on base days are two one-hour rides", "go back to one ride a day", "make the long ride two and a half hours", "VO2 on Tuesdays only"). text = the settings to change, as "base=double|single; hours=2; single=90; short=60; long=150; apart=4h; vo2=Tue,Fri|none", only the ones he named; name = his own words. It changes the model and nothing on the calendar: after it, call plan_week for the week ahead and offer to write it.
- plan_week: the week you laid out with the plan_week TOOL. text = "show; id=<plan_id>" to put the laid-out week on the page day by day (add it whenever you have just laid a week out, with the tool's plan_id), or "apply=yes; id=<plan_id>" to WRITE that plan to his calendar (the plan_id the tool gave, which your offer carried). "apply=yes" only when he has said yes to the week on the table (his yes to your offer, or "write it", "do it", "build it" after seeing it); never in the same turn you first lay a week out. date = any day of that week.
  BUILDING A WEEK: when he asks you to plan, build or reorganize a week ("plan next week", "rebuild my week around the trip", "what would my week look like with two rides a day?"), call the plan_week tool first: it reads his calendar and lays the week out by the TRAINING MODEL; you do not place rides one by one yourself. Tell him the shape of the week in a few sentences (the days that changed, the hours of riding against now, anything the planner could not place and why; and when the tool gives a step_from_last_week, say it plainly and offer the smaller week, some doubles as single hours), add a plan_week action with text "show", and offer the writing (label "Yes, write this week", plan "Write the week you just laid out to my calendar: plan <plan_id>", with the tool's plan_id). If he wants a day different ("make Friday the long ride at 2", "no ride Thursday"), call the tool again with that day in overrides; if he changes how he trains for good, that is a training_model action first. The planner does not move lifts and does not invent a ride on a day he is away: say so when it matters, and offer a single ride (a workout action) for a ride on the way.
- player: he wants to do a planned ride now in The Way's own workout player ("open the player", "start today's ride in the player", "let's ride"). date = the ride's day (today unless he says); text = words that name it, or "". The page opens the player on it; he presses Start there.
- nap: he says he napped ("I napped 25 minutes", "just had a half hour nap", "napped from 1:40 to 2:05"). minutes = how long; time = when it began as HH:MM 24-hour if he said, else ""; date = today unless he names another day. It counts toward that day's sleep (30 minutes in full, half of the rest, 45 at most). A plan to nap later, or a question about napping, is a question, never a nap.
- wellness: the morning's numbers from the strap or the watch, said aloud ("recovery 85, sleep 7 hours 28, HRV 42, resting 56"). sleep_h = hours as a decimal (7:28 is 7.47), sleep_score = the sleep percent if given, recovery = the recovery percent, hrv, rhr = resting heart rate; 0 for any not given. date = the morning it belongs to (today unless he says last night's for a past day), text = where it came from ("WHOOP", "Garmin") or "".
- race: he wants a race put on his race calendar ("add the Greenbelt crit on May 6 as a B race", "put Gran Fondo Maryland down for September 19, that's my A race"). name = the race's name; date = its day as YYYY-MM-DD (the next such date ahead); text = the rest as "priority=A|B|C; kind=road race|criterium|time trial|gran fondo|gravel|mountain bike|cyclocross|hill climb|other; location=…; distance_mi=…; notes=…", leaving out what he did not say (priority B when he did not say). Only when he asks to add one; a question about his races is answered from RACES AHEAD. He changes or removes a race on the Races page.
- save_place: he wants the place he is at remembered ("save this place", "remember this café", "add Mags, I get the sunrise burrito here"). name = the place's name as he said it, text = what to order there or any note, or "". It is saved where he is standing.
- A PHOTO, or up to four, may come with his words (the images at the top of this turn). Look at them first, together: several photos are usually one thing from different sides (a plate and its label, the pages of a menu, two screens of his watch, his position from the side and the front), so read them as one and say so when they are separate things. In the reply say in a few words what you see, then what it means for him today and the one thing to do. What to do with it:
  a plate, a snack or a drink he says he had, is having or asks you to log: a meal (or drink) action, text = what is on the plate with amounts as you see them ("grilled salmon about 6 oz, a cup of white rice, broccoli").
  a plate, a menu, a shelf or a fridge he is asking about ("is this ok", "what should I get"): a question; pick for what is left of today's plan and say why in a number. Log nothing.
  a screenshot of his watch or strap (sleep, recovery, HRV, resting heart rate): a wellness action with the numbers read off it (a nap on it: a nap action). A scale: a weigh_in.
  a ride or workout screen, a chart, his bike, his position on it, a tyre, a part, a route or anything else: a question; read it as his coach and say what you would change.
  a body part, a rash, a swelling or an injury: say what you can see, never a diagnosis, and say plainly when it is one for a doctor.
  Never describe what is not in the photo. If it is too dark, cut off or unreadable, say so and ask for another.
- THE CLOCK: every answer is as of the time given at the top of the day's state. Say "starts now" only of something marked "starts now"; a session marked as begun is under way, and one whose time has passed is over (ask if he did it, never say it is starting). An earlier answer of yours in this conversation was true when you gave it and may be out of date: never repeat its times as if they were now.
- "Repeat", "say that again", "what did you say": give the same information again, but as it stands at the time now (what has started, ended or is next has moved on since), in fresh words.
- research: the question is too big for a quick answer and he should not be kept waiting: a study of more than about three weeks day by day, a comparison across months, a "why" with several possible causes that the lines in front of you do not settle, or anything that wants the science looked up. Do NOT chase it with look_back calls. Give your first read in the reply in one or two sentences from what is in front of you, say that you are taking a proper look and that the full answer will follow in a minute or two, and add this action with text = his question in full, with the dates or the detail needed to answer it without this conversation. The researched coach then reads his record at length and the answer appears under yours and is spoken. One research action a turn, and only for a question: never for something to log, plan or change. A question the lines and one look_back can answer is answered now, with no research action.
- question: he asked for advice or an answer. No other fields; the answer goes in the reply. "What's my next workout", "what's next", "when do I ride", "what's on today" are questions: answer from the calendar above (the next session still to come today, else the next day's), never a workout_change or remove_workout, and never "there is nothing called …". A question or a remark about food already in the journal ("why is my lunch score low", "was that enough carbs", "that was a good lunch") is a question, never a meal or a drink: nothing new was eaten, so nothing is logged.
Several things in one breath are several actions, in the order said. If nothing actionable was said, return no actions and reply with what you understood.
A QUESTION ON ITS OWN NEEDS NO ACTION: when all he did was ask, return actions as an empty list and put the answer in the reply (writing the action out only delays the answer). Use the question type only alongside other actions.
Fill every field: "" or 0 where it does not apply.

The reply, spoken aloud, plain and friendly, to him as "you" (never "he" or "his"), no lists, no numbers he did not ask for:
- For logged things: one short sentence confirming them (under 20 words).
- For a question: advise. Pick one option and say the one reason that decides it, from the day's numbers (what the next session needs, the calories and macros still due, fuel and water on board, the rules of the day, the weather, the calendar). Under 45 words. If two options are truly equal, say so and pick the simpler one. Never say "it depends" without then deciding. Coffee with whole milk adds about 3 g fat and 40 kcal over skim; a scoop of Tailwind is 25 g carbs (the plan's bottle on a hard day is two scoops, 50 g); a Huel plant protein shake 20 g protein (he takes no whey). Prefer the choice that serves the next session, then the day's deficit.
- Times in 12-hour form (3:30p, never 15:30).

THE LOOK BACK (the block that begins "LOOK BACK" under where the day stands):
- It is his real record: every meal he logged with its numbers, each day's food score and what it missed, each ride with its time and the meal before it, lifts, sleep, recovery, weight. Answer "what did I eat on Monday", "how did I sleep last week", "when did I last ride well" from it, naming the foods and the numbers. Never say you cannot see a past day that is in it. A look-back answer may run to 70 words.
- For a day or a stretch that is not in the block, or when he wants more detail (portions, a whole month), call look_back with the dates first, then answer. One call is enough; ask for the span you need (45 days a call). The block says how far back the record goes; if he asks for further back than that, say when it starts.
- Coach from what has worked FOR HIM. When he asks what to eat, how to fix a low food score or how to keep the chain, point first to one of HIS BEST FOOD DAYS and name its meals ("Monday scored 80: eggs, the teriyaki chicken plate, sushi with rice at dinner; repeat that shape tomorrow"), fitted to what tomorrow's training needs. When a food day is going badly, say which of his own good days it differs from and how.
- HABITS: the FOOD HABITS and RIDE HABITS lines compare groups of his own days, with the count behind each. Use one when it bears on the question, with its count ("your three rides within 90 minutes of eating all hit plan; the two fasted ones did not"). Under 4 days in a group is a hint, not a rule: say "so far". Never invent a pattern that is not in the lines or the days.
- TRENDS and WEEK BY WEEK: when he asks how things are going, or where he is heading, read the weeks in order and say the direction with the numbers at both ends ("food went 52, 61, 70 over three weeks; sleep is flat at six and a half hours"). You may extrapolate: say where the line leads if nothing changes and the one habit of his own that would bend it. Say plainly when the record is too short to tell.

OFFERING A CHANGE (the offer field):
- An offer comes from what he asked. Unasked, you may raise a change in two cases only, one at a time, in one sentence after the answer: something in the next few hours that is plainly unsafe or wrong; or a finding from his own record that bears on what he just asked about or on a session today or tomorrow (the next bullet).
- When his record points to a better time or order for something on his calendar (a ride that goes better earlier, a session too soon after a meal, a hard day after his usual short night), say the finding in one sentence, say exactly what you would change, and end with "Want me to change it?". Do NOT make the change yet: no action for it. Set offer.label to the few words for the button ("Move Tuesday's ride to 10:30a") and offer.plan to the complete change in plain words with dates and times ("Move the VO2 ride on 2026-11-17 from 16:00 to 10:30.").
- Offer only what your actions can do (workout_change, workout, remove_workout, event_change) and only one change at a time. Meals are placed by the app around the sessions; never offer to move a meal.
- No offer: offer.label and offer.plan are "".
- When he says "Yes. Do it: …" he has pressed Yes on your offer: carry out exactly that plan now with actions and confirm what changed in one sentence. "No" to an offer: say fine and leave it.`;
}

function promptFor(text, ctx, continuing) {
  return `${continuing ? 'This is a conversation: the turns above are what he said and what you answered. Answer the latest thing he said in that light. If he is answering a question you asked, or choosing between options you gave, act on it now.' : 'He spoke one or more things.'}

Where the day stands:
${ctx}

He said: "${text}"`;
}

// A conversation: the earlier turns come back from the page (what he said,
// what was answered), so "yes, do that" or "the second one" has something to
// point at. The prompt with the day's context rides on the latest turn only.
const MAX_PHOTOS = 4;
const TOOLS = [{ name: 'look_back', description: 'Read his record for a span of past days (today included), one row a day: every meal eaten with its numbers and portions, the food score and what it missed, each ride with its time of day, how close to plan and the meal before it, lifts, sleep, recovery, naps, weight. Use it when he asks about a day or a stretch that is not in the LOOK BACK block, or wants more detail than the block gives. 45 days at most in one call; the LOOK BACK block says how far back the record goes.',
  input_schema: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string', description: 'first day, YYYY-MM-DD' }, to: { type: 'string', description: 'last day, YYYY-MM-DD' } } } },
  { name: 'routes_near', description: 'Which of his Ride with GPS routes pass near where he is standing right now (his location comes with his message), best first. Each row: the route, its length, climbing and riding time from the nearest point, whether it is a loop, and the point ON THE ROUTE nearest him: the street it is on, how far from him and in which direction. Use it when he asks what to ride from where he is, where to go to start a route, or for the best route near him. minutes = the riding time he has or today\'s planned ride length, 0 if unknown.',
    input_schema: { type: 'object', additionalProperties: false, required: ['minutes'], properties: { minutes: { type: 'integer', description: 'riding time he has, in minutes; 0 if unknown' }, type: { type: 'string', enum: ['road', 'gravel', 'mtb'] } } } },
  { name: 'plan_week', description: 'Lay out a whole week of riding from his TRAINING MODEL around what his calendar really holds: the fixed things, drives, rest days, days away, the lifts, what is already ridden, daylight and the forecast. Nothing is written: the week is laid out, kept, and returned to you day by day with what would change on his calendar. Call it ONCE in a turn, with everything he asked for in that one call. ONLY when he asks for a week to be planned, built, rebuilt or changed (never for a question about the past, how something went, or advice on what to change: those are answered in words). Use it whenever he asks you to plan, build, rebuild or reorganize a week, to see what a change to the model would do before he commits to it, or to set single days by hand. week_of: any day of the week to plan, YYYY-MM-DD (today for this week). changes: settings of the model to TRY for this layout without saving them, as "base=double|single; hours=2; single=90; short=60; long=150; apart=4h; vo2=Tue,Fri|none" ("" for the model as it stands). overrides: days he sets by hand for this week only, as "YYYY-MM-DD=off|vo2|base|double|single:MINUTES@HH:MM|long:MINUTES@HH:MM" separated by ";" (minutes and @time optional, 24-hour), e.g. "2026-11-20=long:150@14:00; 2026-11-21=off" ("" for none).',
    input_schema: { type: 'object', additionalProperties: false, required: ['week_of', 'changes', 'overrides'], properties: { week_of: { type: 'string' }, changes: { type: 'string' }, overrides: { type: 'string' } } } }];
async function understand(text, history, extra, image, opt) {
  const T = (opt && opt.ms) || {}, tStart = Date.now();
  // on the copy only: another model to time against the usual one (never on the real site)
  const images = (Array.isArray(image) ? image : image ? [image] : []).slice(0, MAX_PHOTOS);
  // on the copy only: another model to time against the usual one (never on the real site)
  const model = (opt && opt.model && require('./sandbox').SANDBOX) ? opt.model : images.length ? MODEL : QUICK_MODEL;
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const prior = (Array.isArray(history) ? history : []).slice(-10)
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && h.text)
    .map(h => ({ role: h.role, content: String(h.text).slice(0, 600) }));
  // the API wants the turns to alternate and to start with him
  const turns = []; for (const t of prior) { if (!turns.length && t.role !== 'user') continue; if (turns.length && turns[turns.length - 1].role === t.role) turns[turns.length - 1].content += '\n' + t.content; else turns.push(t); }
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  // a photo he sent rides in front of his words (Harry, 14 Nov 2026: "upload a photo onto the coach and have him analyze")
  const tCtx = Date.now(); const ctxParts = await contextParts(), ctxText = ctxParts.live; T.context_ms = Date.now() - tCtx;
  // two cached blocks: the standing prompt, then his standing record; the minute's lines ride with his words
  const system = [{ type: 'text', text: systemText(), cache_control: { type: 'ephemeral' } }]
    .concat(ctxParts.slow ? [{ type: 'text', text: 'HIS STANDING RECORD, read from the site with the lines under "Where the day stands" in his message and as true as they are (the training model, the sleep window, the signature, the lifting, the notebook, his routes, his races, the look back):\n' + ctxParts.slow, cache_control: { type: 'ephemeral' } }] : []);
  const first = (p => images.length ? images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.image_base64 } })).concat([{ type: 'text', text: p }]) : p)(promptFor(text, ctxText + (extra ? '\n' + extra : ''), turns.length > 0));
  let messages = turns.concat([{ role: 'user', content: first }]);
  // He can look back (history.js): when the question is about days that are not in front of him, he asks for them
  // with look_back, reads them and then answers. Two looks at most, so a spoken answer never waits long.
  const t0 = Date.now();
  const ask = async () => { for (let round = 0; ; round++) {
    // a week laid out is the last look he needs in a turn, and a yes to a plan ("… plan p_abc") needs no look at all:
    // each look that is not needed is two or three seconds of his waiting
    // The whole answer has a deadline (the request is cut off by the host at about thirty seconds, and he heard
    // nothing at all: Harry, 16 Nov 2026, "if I ask a more complex question it seems like it times out"). A look is
    // allowed only in the first ten seconds; each call to the model is given what is left of the time and no more.
    const deadline = (opt && opt.deadline) || tStart + 22000, left = deadline - Date.now();
    if (left < 2500) throw Object.assign(new Error('deadline'), { deadline: true });
    const more = round < 2 && Date.now() - tStart < 10000 && !T.planned && !/\bplan p_[a-z0-9]{4,}\b/i.test(String(text || ''));
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      signal: AbortSignal.timeout(Math.max(2000, left)),
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify({ model, max_tokens: 1500, fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA() } },
        system,
        tools: TOOLS, tool_choice: more ? { type: 'auto' } : { type: 'none' },
        messages })
    });
    const j = await r.json();
    if (j.usage) { console.log('voice usage', JSON.stringify(j.usage)); T.out_tokens = (T.out_tokens || 0) + (j.usage.output_tokens || 0); T.in_tokens = (j.usage.input_tokens || 0) + (j.usage.cache_read_input_tokens || 0) + (j.usage.cache_creation_input_tokens || 0); T.cached_tokens = j.usage.cache_read_input_tokens || 0; }
    T.rounds = round + 1; T.model_ms = Date.now() - tStart - (T.context_ms || 0); T.model = j.model || model;
    if (!r.ok) throw new Error('voice ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 160));
    const uses = (j.content || []).filter(c => c.type === 'tool_use');
    if (j.stop_reason === 'tool_use' && uses.length && more) {
      T.tools = (T.tools || []).concat(uses.map(u => u.name));
      const results = await Promise.all(uses.map(async u => { let out; try { out = u.name === 'look_back' ? await require('./history').lookBack(u.input || {})
          : u.name === 'routes_near' ? await (async () => { const R = require('./routes'), N = await R.near(opt && opt.coords, { minutes: (u.input || {}).minutes, type: (u.input || {}).type, budget_ms: 6000 });
              return { reach_miles: N.reach_miles, routes: N.routes.map(x => ({ name: x.name, miles: x.miles, gain_ft: x.gain_ft, minutes: x.minutes, kind: x.kind, surface: x.surface, unpaved_pct: x.unpaved_pct, start_on: x.place, miles_from_him: x.join_miles, direction_from_him: x.direction })),
                note: N.routes.length ? 'Best first. The start is the point on the route nearest him, not the route\'s own start.' : `None of his routes passes within ${N.reach_miles} miles of him. A loop can be drawn from where he stands (new_route with start=here).` }; })()
          : u.name === 'plan_week' ? await (async () => { if (T.planned) return Object.assign({}, T.planned, { note: 'You already laid a week out in this turn: this is that same plan. Do not call plan_week again; answer from it.' });
              const P = await require('./planner').propose((u.input || {}).week_of, { changes: (u.input || {}).changes, overrides: (u.input || {}).overrides });
              return (T.planned = { plan_id: P.id, week_of: P.week_of, model: P.model_words, tried_not_saved: P.tried, days: P.lines, riding_minutes: P.riding_min, step_from_last_week: P.step_note, would_change: P.changes,
                note: 'Laid out, not written. Tell him the week in a few sentences (the page shows it day by day when you add a plan_week action with text "show"), and put the writing to him as an offer whose plan names this plan_id.' }); })()
          : { error: 'no such tool' }; } catch (e) { out = { error: e.message }; }
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) }; }));
      messages = messages.concat([{ role: 'assistant', content: j.content }, { role: 'user', content: results }]);
      continue;
    }
    const block = (j.content || []).find(c => c.type === 'text');
    if (!block) throw new Error('no answer');
    return JSON.parse(block.text.replace(/```json|```/g, '').trim());
  } };
  // a call cut off at the deadline is a deadline, whatever name the runtime gives it
  try { return await ask(); } catch (e) { if (e && (e.deadline || e.name === 'TimeoutError' || e.name === 'AbortError')) throw Object.assign(new Error('deadline'), { deadline: true }); throw e; }
}

const words = t => String(t || '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !/^(the|that|last|one|from|remove|delete|move|change|my|ride|workout|session|event|today|tomorrow|this|and|for|with)$/.test(w));
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const isTime = t => /^\d{2}:\d{2}$/.test(t || '');

// The planned session on a day that his words point at (or the only one).
async function findWorkout(date, text) {
  const d = await getJSON('plan-workouts', { workouts: {} });
  const onDay = Object.values(d.workouts || {}).filter(w => w.date === date).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  const ws = words(text);
  const named = ws.length ? onDay.find(w => ws.some(x => String(w.name || '').toLowerCase().includes(x))) : null;
  if (named) return named;
  // "my lift", "the weights", "the gym" name no session, but they are not the ride ("move my lift" on a VO2 morning
  // took the day's first session, the ride): the kind he said, when the day holds one of that kind
  const isLift = w => /weight|strength/i.test(String(w.sport || '')), t = String(text || '');
  const liftish = /\b(lift|lifts|lifting|weights?|gym|strength|kettlebell|blast|pump)\b/i.test(t), rideish = /\b(ride|bike|spin|trainer|zwift|vo2|zone)\b/i.test(t);
  const pool = liftish && !rideish ? onDay.filter(isLift) : rideish && !liftish ? onDay.filter(w => !isLift(w)) : onDay;
  return pool[0] || onDay[0] || null;
}
// The planned ride on a day that his words point at, else the day's first ride (never a lift).
async function findRide(date, text) {
  const d = await getJSON('plan-workouts', { workouts: {} });
  const rides = Object.values(d.workouts || {}).filter(w => w && w.date === date && /ride/i.test(String(w.sport || ''))).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  const ws = words(text);
  return (ws.length ? rides.find(w => ws.some(x => String(w.name || '').toLowerCase().includes(x))) : null) || rides[0] || null;
}
// A Zone 1 of a new length is the library's template at that length; anything
// else keeps its shape and its longest step grows or shrinks to fit.
function resized(w, minutes) {
  const z1 = /^Zone 1, (\d+) min$/.exec(w.name || '');
  if (z1) {
    const near = LIBRARY.filter(l => /^z1-/.test(l.key)).map(l => ({ l, d: Math.abs(+l.key.slice(3) - minutes) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d <= 10) return { name: near.l.name, sport: near.l.sport, notes: near.l.notes, steps: near.l.steps };
  }
  const W = require('./workout-math');
  const items = W.normItems(w.steps || []);
  const total = W.metrics(items, W.settingsOf(W.DEFAULTS)).duration_s;
  const delta = minutes * 60 - total;
  const flat = items.filter(s => s.kind === 'step');
  const longest = flat.reduce((a, s) => (s.dur_s || 0) > (a.dur_s || 0) ? s : a, flat[0] || null);
  if (longest) longest.dur_s = Math.max(300, (longest.dur_s || 0) + delta);
  return { steps: items, name: (w.name || '').replace(/\b(\d+) min\b/, minutes + ' min') };
}

async function run(a, x) {
  const food = require('./food');
  switch (a.type) {
    case 'meal': case 'drink': {
      // the same words logged again within twenty minutes are the same food, said twice, unless he says it was more
      { const twin = await food.twinToday(a.text);   // one rule with the Food page's POST /food/text (food-math twinOf)
        if (twin) return { ok: false, summary: `Already in the journal at ${tz.hm12(twin.time)}: ${twin.name}. Not logged again; say "another ${String(a.text).slice(0, 30)}" if it was more.` }; }
      // a question or a remark is never a meal (food.js refuses words with nothing eaten in them)
      // with a photo in the turn, the reader sees the plate itself, not only the coach's words for it
      let e; try { e = await food.addPhoto({ text: a.text, meal: a.meal || undefined, images: x && x.images && x.images.length ? x.images : x && x.image ? [x.image] : undefined }); }
      catch (err) { if (err && err.not_food) return { ok: false, type: 'question', summary: 'Nothing logged: that was a question, not food.' }; throw err; }
      // a meal that lands on the plan (green against its slot) is worth a cheer on the page
      let celebrate = false, slot = null;
      try { const day = await food.dayReport(e.date); const m = (day.meals || []).find(x => (x.logged || []).includes(e.id)); slot = m ? m.slot : null; celebrate = !!(m && m.match && m.match.key === 'green' && (e.kcal || 0) >= 100); } catch (err) { celebrate = false; }
      return { ok: true, summary: `${a.type === 'drink' ? 'Drink' : 'Meal'} logged: ${e.name}, ${e.kcal} kcal${e.fluid_ml ? `, ${e.fluid_ml} ml` : ''}.${celebrate ? ' On the plan.' : ''}`, entry_id: e.id, celebrate, slot };
    }
    case 'supplement': {
      const e = await food.addSupplement(a.supplement);
      return e ? { ok: true, summary: `Supplement logged: ${e.name}.` } : { ok: false, summary: `Unknown supplement "${a.supplement}".` };
    }
    case 'medicine': {
      try { const r = await require('./meds').mark(a.medicine); const m = r.due.find(x => x.key === a.medicine); return { ok: true, summary: `Taken: ${m ? m.name : a.medicine}.` }; }
      catch (e) { return { ok: false, summary: `Unknown medicine "${a.medicine}".` }; }
    }
    case 'weigh_in': {
      const lb = Number(a.lb);
      if (!(lb >= 50 && lb <= 500)) return { ok: false, summary: 'No usable weight heard.' };
      const d = await getJSON('weigh-in', { entries: [] });
      d.entries.push({ ts: Date.now(), lb: Math.round(lb * 10) / 10, source: 'voice' });
      await setJSON('weigh-in', d);
      return { ok: true, summary: `Weigh-in logged: ${lb} lb.` };
    }
    case 'workout': {
      const lib = LIBRARY.find(l => l.key === a.library_key);
      const minutes = a.minutes > 0 ? a.minutes : 60;
      const body = lib ? { name: lib.name, sport: lib.sport, notes: lib.notes, steps: lib.steps }
        : { name: a.name || `Ride, ${minutes} min`, sport: a.sport || 'Ride', notes: '', steps: [{ kind: 'step', label: 'Ride', dur_s: minutes * 60, target: { type: 'free' } }] };
      body.date = isDate(a.date) ? a.date : tz.todayKey();
      body.time = isTime(a.time) ? a.time : null;
      // a lift said after the fact is already on the calendar (and saved on the Lift page): never add a second copy
      if (/weight|lift|strength/i.test(String(body.sport || '')) || /^(push|pull|upper|legs|pump)\b/i.test(String(body.name || ''))) {
        const WK = require('./workouts'), db = await getJSON('plan-workouts', { workouts: {} });
        const same = Object.values(db.workouts || {}).find(w => w.date === body.date && !WK.isRideSport(w));
        if (same) return { ok: true, summary: `${same.name} is already on the calendar for ${tz.dayShort(body.date)}${same.time ? ' at ' + tz.hm12(same.time) : ''}; a session saved on the Lift page marks it done. Nothing added.` };
      }
      let w; try { w = await require('./workouts').create(body); } catch (e) { return { ok: false, summary: e.message }; }
      return { ok: true, summary: `On the calendar: ${w.name}, ${tz.dayShort(w.date)}${w.time ? ' at ' + tz.hm12(w.time) : ''}.`, workout_id: w.id };
    }
    case 'workout_change': {
      const date = isDate(a.date) ? a.date : tz.todayKey();
      const hit = await findWorkout(date, a.text);
      if (!hit) return { ok: false, summary: `No planned session on ${tz.dayShort(date)} to change.` };
      const body = { date: isDate(a.new_date) ? a.new_date : hit.date, time: isTime(a.time) ? a.time : hit.time };
      const lib = LIBRARY.find(l => l.key === a.library_key);
      if (lib) Object.assign(body, { name: lib.name, sport: lib.sport, notes: lib.notes, steps: lib.steps });
      else if (a.minutes > 0) Object.assign(body, resized(hit, a.minutes));
      let w; try { w = await require('./workouts').update(hit.id, body); } catch (e) { return { ok: false, summary: e.message }; }
      const what = [lib ? `now ${w.name}` : a.minutes > 0 ? `now ${Math.round(w.metrics.duration_s / 60)} min` : null, isTime(a.time) ? `at ${tz.hm12(a.time)}` : null, isDate(a.new_date) ? `on ${tz.dayShort(a.new_date)}` : null].filter(Boolean).join(', ');
      return { ok: true, summary: `Changed: ${hit.name}${what ? ', ' + what : ''}${w.sync && w.sync.state === 'synced' ? ' (re-sent)' : ''}.`, workout_id: w.id };
    }
    case 'remove_workout': {
      const date = isDate(a.date) ? a.date : tz.todayKey();
      const hit = await findWorkout(date, a.text);
      if (!hit) return { ok: false, summary: `No planned session on ${tz.dayShort(date)}.` };
      await require('./workouts').remove(hit.id);
      return { ok: true, summary: `Off the calendar: ${hit.name}, ${tz.dayShort(hit.date)}.` };
    }
    case 'event': {
      const j = await require('./calendar').addEvent({ title: a.name || a.text || 'Event', date: a.date, start: a.time || '', minutes: a.minutes || 60, notes: a.text && a.name ? a.text : '' });
      return { ok: true, summary: `On the calendar: ${a.name || a.text}, ${a.date}${a.time ? ' at ' + tz.hm12(a.time) : ''}${j.pushed_to_google ? ', and on Google' : j.google_connected ? '' : ' (Google not connected yet, it goes when it is)'}.` };
    }
    case 'event_change': {
      const cal = require('./calendar');
      const date = isDate(a.date) ? a.date : tz.todayKey();
      const sched = await cal.scheduleReport({ days: 8 });
      const day = (sched.days || []).find(d => d.date === date);
      const ws = words(a.text);
      const evs = ((day && day.events) || []).filter(e => e.edit && !e.workout_id);
      const hit = (ws.length ? evs.find(e => ws.some(x => String(e.summary || '').toLowerCase().includes(x))) : null) || (evs.length === 1 ? evs[0] : null);
      if (!hit) return { ok: false, summary: `Could not find "${a.text}" on ${date}.` };
      const b = {};
      if (isDate(a.new_date)) b.date = a.new_date;
      if (isTime(a.time)) b.start = a.time; else if (isDate(a.new_date)) b.start = String(hit.from ? toHM24(hit.start_min) : '');
      if (a.minutes > 0) b.minutes = a.minutes; else if (b.start && hit.minutes) b.minutes = hit.minutes;
      if (a.name) b.title = a.name;
      const r = await cal.editEvent(hit.edit, b);
      if (!r) return { ok: false, summary: `"${hit.summary}" could not be changed.` };
      const what = [isDate(a.new_date) ? `to ${a.new_date}` : null, isTime(a.time) ? `at ${tz.hm12(a.time)}` : null, a.minutes > 0 ? `${a.minutes} min` : null, a.name ? `now "${a.name}"` : null].filter(Boolean).join(', ');
      return { ok: true, summary: `Moved: ${hit.summary}${what ? ', ' + what : ''}${r.where === 'google' ? ', and on Google' : ''}.` };
    }
    case 'remove': {
      const list = (await food.todayEntries()).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
      if (!list.length) return { ok: false, summary: 'Nothing in the journal today to remove.' };
      const ws = words(a.text).filter(w => !/^(entry|meal|journal)$/.test(w));
      const hit = ws.length ? list.slice().reverse().find(e => ws.some(w => String(e.name || '').toLowerCase().includes(w))) : list[list.length - 1];
      if (!hit) return { ok: false, summary: `Nothing matching "${a.text}" in today's journal.` };
      await food.removeEntry(hit.id, tz.todayKey());
      return { ok: true, summary: `Removed: ${hit.name}${hit.time ? ' (' + tz.hm12(hit.time) + ')' : ''}.` };
    }
    case 'remember': {
      const fact = String(a.text || '').trim().slice(0, 400);
      if (!fact) return { ok: false, summary: 'Nothing to remember was said.' };
      const nb = await getJSON('coach-notebook', { notes: [] });
      nb.notes = (nb.notes || []).concat([{ date: tz.todayKey(), kind: 'he said', note: fact, by: 'quick' }]).slice(-200);
      await setJSON('coach-notebook', nb);
      return { ok: true, summary: `Remembered: ${fact}` };
    }
    case 'note': {
      const d = await getJSON('voice-notes', { notes: [] });
      d.notes.push({ at: new Date().toISOString(), date: tz.todayKey(), text: String(a.text).slice(0, 500) });
      d.notes = d.notes.slice(-200);
      await setJSON('voice-notes', d);
      return { ok: true, summary: 'Noted.' };
    }
    case 'race': {
      // text carries the rest as "priority=A; kind=criterium; location=…; distance_mi=…; notes=…"
      const kv = {}; for (const part of String(a.text || '').split(';')) { const m = /^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i.exec(part); if (m) kv[m[1].toLowerCase()] = m[2]; }
      let r; try { r = await require('./races').add({ name: a.name, date: a.date, priority: kv.priority, kind: kv.kind, location: kv.location, distance_mi: kv.distance_mi ? Number(kv.distance_mi) : undefined, notes: kv.notes }); }
      catch (e) { return { ok: false, summary: e.message }; }
      return { ok: true, summary: `On the race calendar: ${r.name}, ${tz.dayShort(r.date)} ${r.date.slice(0, 4)}, a ${r.priority} race (${r.kind}).` };
    }
    case 'garmin': {
      const W = require('./workouts'), from = isDate(a.date) ? a.date : tz.todayKey(), to = isDate(a.new_date) && a.new_date >= from && a.new_date <= tz.shiftKey(from, 13) ? a.new_date : from;
      const d = await getJSON('plan-workouts', { workouts: {} }), ws = words(a.text), off = /^(off|remove|take)/i.test(String(a.name || ''));
      let list = Object.values(d.workouts || {}).filter(w => w && w.date >= from && w.date <= to && /ride|run/i.test(String(w.sport || ''))).sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || '')));
      if (ws.length) { const named = list.filter(w => ws.some(x => String(w.name || '').toLowerCase().includes(x))); if (named.length) list = named; }
      if (off) list = list.filter(w => w.sync && w.sync.state === 'synced');
      if (!list.length) return { ok: false, summary: off ? `Nothing ${from === to ? 'on ' + tz.dayShort(from) : 'in those days'} is on the Garmin.` : `No planned ride or run ${from === to ? 'on ' + tz.dayShort(from) : 'in those days'} to send.` };
      const done = [], failed = [];
      for (const w of list.slice(0, 12)) { const r = off ? await W.unsend(w.id).catch(e => ({ sync: { state: 'error', error: e.message } })) : await W.send(w.id).catch(e => ({ sync: { state: 'error', error: e.message } }));
        const good = off ? r && r.sync && r.sync.state === 'off' : r && r.sync && r.sync.state === 'synced';
        (good ? done : failed).push(`${w.name} (${tz.dayShort(w.date)})${good ? '' : ': ' + String(r && r.sync && r.sync.error || 'not sent').slice(0, 80)}`); }
      return { ok: done.length > 0, summary: (done.length ? `${off ? 'Off the Garmin' : 'Sent to the Garmin through intervals.icu'}: ${done.join(', ')}.` : '') + (failed.length ? ` Not ${off ? 'removed' : 'sent'}: ${failed.join('; ')}.` : '') };
    }
    case 'route': {
      const R = require('./routes'), L = await R.list();
      if (!L.connected) return { ok: false, summary: L.reason || 'Ride with GPS is not connected.' };
      const r = R.match(L.routes, a.name || a.text);
      if (!r) return { ok: false, summary: `No route like "${String(a.name || a.text).slice(0, 40)}" in your Ride with GPS library.` };
      const date = isDate(a.date) ? a.date : tz.todayKey(), hit = await findRide(date, a.text);
      if (!hit) return { ok: false, summary: `No planned ride on ${tz.dayShort(date)} to put ${r.name} on.` };
      try { await require('./workouts').update(hit.id, { route_id: r.id }); } catch (e) { return { ok: false, summary: e.message }; }
      return { ok: true, summary: `${r.name}${r.miles != null ? ` (${r.miles} mi${r.gain_ft != null ? ', ' + r.gain_ft + ' ft' : ''})` : ''} is the route for ${hit.name}, ${tz.dayShort(date)}.`, workout_id: hit.id };
    }
    case 'new_route': {
      const R = require('./routes'), kv = {}; for (const part of String(a.text || '').split(';')) { const m = /^\s*([a-z_]+)\s*=\s*(.+?)\s*$/i.exec(part); if (m) kv[m[1].toLowerCase()] = m[2]; }
      let points, name, desc, what;
      try {
        if (isDate(kv.from)) { const t = await R.rideTrack(kv.from); points = t.points; name = String(a.name || t.ride.name || 'Ride').slice(0, 100); desc = `From your ride on ${tz.dayShort(kv.from)}.`; what = `your ${tz.dayShort(kv.from)} ride`; }
        else { const fromHere = /^here$/i.test(kv.start || '') && x && x.coords;
          const L = await R.loop({ start: fromHere ? { lat: x.coords.lat, lon: x.coords.lon } : await R.home(), minutes: a.minutes > 0 ? a.minutes : 60, direction: kv.direction, type: kv.type });
          if (fromHere) { const from = 'where you are'; points = L.points; name = String(a.name || `Loop from ${tz.dayShort(tz.todayKey())}, ${L.miles} mi${L.direction ? ' ' + L.direction : ''}`).slice(0, 100); desc = `Drawn by The Way from ${from} for a ${L.minutes} minute ${L.type} ride. Look it over before riding it.`; what = `a ${L.miles} mile loop from ${from}${L.direction ? ', heading ' + L.direction : ''} (about ${L.minutes} min)`; } else {
          points = L.points; name = String(a.name || `Loop from home, ${L.miles} mi${L.direction ? ' ' + L.direction : ''}`).slice(0, 100); desc = `Drawn by The Way for a ${L.minutes} minute ${L.type} ride. Look it over before riding it.`; what = `a ${L.miles} mile loop from home${L.direction ? ', heading ' + L.direction : ''} (about ${L.minutes} min)`; } }
        const s = await R.save(R.gpx(points, name), name, desc, 8000);
        if (s.sandbox) return { ok: true, summary: `Drew ${what} as "${name}". On the copy nothing is sent to Ride with GPS.` };
        let tied = '';
        if (s.route_id && isDate(a.date)) { const hit = await findRide(a.date, ''); if (hit) { await require('./workouts').update(hit.id, { route_id: s.route_id }).catch(() => {}); tied = ` It is the route for ${hit.name}, ${tz.dayShort(a.date)}.`; } }
        return { ok: true, summary: `Saved to Ride with GPS: "${name}", ${what}.${s.url ? ' ' + s.url : ' ' + (s.note || '')}${tied}`, url: s.url || null };
      } catch (e) { return { ok: false, summary: e.message }; }
    }
    case 'route_here': {
      const R = require('./routes'), c = x && x.coords;
      if (!c) return { ok: false, summary: 'No location came with that. Allow location for the site and ask again.' };
      const save = /save\s*=\s*(yes|true|1)/i.test(String(a.text || ''));
      let h; try { h = await R.startHere(c, { name: a.name || '', minutes: a.minutes > 0 ? a.minutes : 0, save, wait_ms: 8000 }); } catch (e) { return { ok: false, summary: e.message }; }
      let tail = '';
      if (save && h.saved) { const sv = h.saved;
        if (sv.sandbox) tail = ` The re-started route is drawn as "${h.new_name}"; on the copy nothing is sent to Ride with GPS.`;
        else { tail = ` ${sv.already ? 'Already in' : 'Saved to'} Ride with GPS as "${h.new_name}"${sv.pending ? ' (it is still building there)' : ''}.`;
          if (sv.route_id && isDate(a.date)) { const hit = await findRide(a.date, ''); if (hit) { await require('./workouts').update(hit.id, { route_id: sv.route_id }).catch(() => {}); tail += ` It is the route for ${hit.name}, ${tz.dayShort(a.date)}.`; } } } }
      return { ok: true, summary: `${R.hereText(h)}.${tail}`, link: { href: h.maps, label: 'Directions to the start' }, link2: save && h.saved && h.saved.url ? { href: h.saved.url, label: 'The route in Ride with GPS' } : { href: h.url, label: 'The route in Ride with GPS' } };
    }
    case 'lift': {
      const LF = require('./lifts'), date = isDate(a.date) ? a.date : tz.todayKey(), said = String(a.name || a.text || '').trim();
      // a Blast by its letter only when he gave one: "the kettlebell blast" is the one planned that day
      const bareLegs = /^\s*(my\s+|the\s+)?legs?(\s+day)?\s*$/i.test(said);   // "legs" with no number: the leg day planned that day, not always Legs 1
      let key = (bareLegs ? null : LF.templateOf(said)) || (/blast\s*[ab]\b/i.test(said) ? LF.blastOf(said) : null) || (/\bpump\b/i.test(said) ? 'pump' : /\bleg/i.test(said) ? (/2|two|second|light/i.test(said) ? 'legs-2' : null) : null);
      if (!key) {   // the lift planned that day, when there is one (or one that fits his word)
        const d = await getJSON('plan-workouts', { workouts: {} });
        const planned = [...new Set(Object.values(d.workouts || {}).filter(w => w && w.date === date && /weight|strength/i.test(String(w.sport || ''))).map(w => LF.templateOf(w.name) || LF.blastOf(w.name)).filter(Boolean))];
        const fits = /\bleg/i.test(said) ? planned.filter(LF.isLegs) : /blast|kettlebell/i.test(said) ? planned.filter(k => /^blast-/.test(k)) : planned;
        if (fits.length === 1) key = fits[0];
        else if (/\bleg/i.test(said) && !fits.length) return { ok: false, summary: 'Which leg day was it: Legs 1 (squat, leg press, Romanian deadlift) or Legs 2 (split squat, hip thrust)?' };
        else if (/blast|kettlebell/i.test(said) && !fits.length) return { ok: false, summary: 'Which Blast was it: A (swing and squat) or B (press and carry)?' };
        else return { ok: false, summary: fits.length ? `Which one did you do: ${fits.map(k => LF.nameOf(k)).join(' or ')}?` : 'Which session was it: Push, Pull, Upper, Legs 1, Legs 2, the Pump or a Kettlebell Blast?' };
      }
      try { await LF.save({ template: key, date, quick: true, notes: 'told to the coach' }); } catch (e) { return { ok: e.status === 409, summary: e.message }; }
      const c = await LF.weekCountPlaced((await getJSON('lifts', { sessions: [] })).sessions || [], tz.todayKey()).catch(() => null);
      return { ok: true, summary: `${LF.nameOf(key)} logged for ${tz.dayShort(date)}${LF.isExtra(key) ? ', extra to the five' : c ? `: ${c.word} this week` : ''}. The sets and weights go on the Lift page when you want the targets to move.`, open_hint: '#lift?t=' + key };
    }
    case 'training_model': {
      const P = require('./planner'), patch = P.parseChanges(a.text);
      if (!Object.keys(patch).length) return { ok: false, summary: 'I could not read a change to the training model in that.' };
      const m = await P.setModel(patch, a.name || '');
      return { ok: true, summary: `Training model changed. ${P.modelWords(m)}` };
    }
    case 'plan_week': {
      const P = require('./planner'), t = String(a.text || '');
      if (/apply\s*=\s*(yes|true|1)/i.test(t)) {
        // the plan he said yes to, by its id: a week laid out since then is not written in its place
        const pid = (/\bid\s*=\s*(p_[a-z0-9]+)/i.exec(t) || [])[1] || null;
        if (!pid && !(await P.proposal(null))) return { ok: false, summary: 'No week is on the table to write. Ask me to lay the week out first.' };
        let r; try { r = await P.apply(pid); } catch (e) { return { ok: false, summary: e.message }; }
        if (r.already) return { ok: true, summary: `That week (from ${tz.dayShort(r.week_of)}) is already written.`, lines: r.done };
        return { ok: !(r.failed || []).length || r.done.length > 0, summary: `Written: the week of ${tz.dayShort(r.week_of)}. ${r.done.length} change${r.done.length === 1 ? '' : 's'}${r.kept ? `, ${r.kept} ride${r.kept === 1 ? '' : 's'} left as ${r.kept === 1 ? 'it was' : 'they were'}` : ''}${(r.failed || []).length ? `; ${r.failed.length} did not go through` : ''}.`, lines: r.done.concat((r.failed || []).map(x => 'not done: ' + x)), open: '#calendar' };
      }
      // show: the week on the table, day by day, as it was laid out a moment ago (laid out now if there is none)
      let p = await P.proposal((/\bid\s*=\s*(p_[a-z0-9]+)/i.exec(t) || [])[1] || null);
      if (!p || p.applied_at) { try { p = await P.propose(isDate(a.date) ? a.date : tz.todayKey(), {}); } catch (e) { return { ok: false, summary: e.message }; } }
      const c = p.changes;
      return { ok: true, summary: `The week of ${tz.dayShort(p.week_of)}, laid out and not yet written: ${Math.round(p.riding_min.this_plan / 6) / 10} h of riding (${Math.round(p.riding_min.now_planned / 6) / 10} h on the calendar now). A yes would add ${c.add}, change ${c.change} and take off ${c.remove}.`, lines: p.lines };
    }
    case 'player': {
      const date = isDate(a.date) ? a.date : tz.todayKey(), hit = await findRide(date, a.text);
      if (!hit) return { ok: false, summary: `No planned ride on ${tz.dayShort(date)} to open in the player.` };
      return { ok: true, summary: `Opening the player: ${hit.name}.`, open: '#player?id=' + encodeURIComponent(hit.id), workout_id: hit.id };
    }
    case 'nap': {
      let nap; try { nap = await require('./naps').add({ minutes: a.minutes, time: a.time || undefined, date: a.date || undefined }); } catch (e) { return { ok: false, summary: e.message }; }
      return { ok: true, summary: `Nap logged: ${nap.minutes} min at ${tz.hm12(nap.time)}. It counts as ${require('./naps').creditOf(nap.minutes)} min toward today's sleep.` };
    }
    case 'wellness': {
      const W = require('./wellness');
      const day = await W.set({ date: a.date || undefined, sleep_h: a.sleep_h || undefined, sleep_score: a.sleep_score || undefined, recovery: a.recovery || undefined, hrv: a.hrv || undefined, rhr: a.rhr || undefined, source: a.text || 'by hand' });
      const bits = [day.sleep_h != null ? `sleep ${day.sleep_h} h` : null, day.sleep_score != null ? `sleep score ${day.sleep_score}` : null, day.recovery != null ? `recovery ${day.recovery}` : null, day.hrv != null ? `HRV ${day.hrv}` : null, day.rhr != null ? `resting HR ${day.rhr}` : null].filter(Boolean);
      return { ok: true, summary: `Morning recorded for ${day.date}: ${bits.join(', ')}${day.source && day.source !== 'by hand' ? ` (${day.source})` : ''}.` };
    }
    case 'save_place': {
      const P = require('./places');
      const c = x && x.coords;
      if (!c || !(Math.abs(Number(c.lat)) <= 90)) return { ok: false, summary: 'No location came with that. Allow location for the site, or save it from the Food page with Find food near me.' };
      const orders = String(a.text || '').trim() ? [{ name: String(a.text).trim().slice(0, 80), why: 'what you order here' }] : [];
      const p = await P.add({ name: a.name || a.text || 'this place', lat: c.lat, lon: c.lon, notes: a.text || '', orders });
      return { ok: true, summary: `${p.updated_existing ? 'Updated' : 'Saved'}: ${p.name}${orders.length ? `, order ${orders[0].name}` : ''}. It will come up when you are within ${P.NEAR_M} m.` };
    }
    case 'research': {
      const q = String(a.text || '').trim().slice(0, 2000);
      if (!q) return { ok: false, summary: 'There was no question to look into.' };
      const id = await require('./coach').startJob(q, (x && x.base) || 'https://thewayforward.netlify.app', { kind: 'handoff' });
      return { ok: true, summary: 'Taking a proper look: the full answer follows in a minute or two.', job: id };
    }
    case 'question': return { ok: true, summary: 'Advice below.' };
    default: return { ok: false, summary: 'Did not understand that part.' };
  }
}
const toHM24 = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

function attach(app) {
  // The coach's face (pwa/face.js) asks for this: a spoken briefing from the whole plan. Where he is, what to adjust,
  // what to do this week toward the goal (Harry, 14 Nov 2026).
  app.get('/voice/briefing', async (req, res) => { if (!auth(req, res)) return;
    try {
      const u = await understand('Give me my briefing.', [], 'This is a briefing, spoken to him by his coach\'s face, not a question to act on: take no actions. Three short parts in plain speech, no lists, under 110 words in all: where he is now, with two or three of the real numbers (fitness, the week\'s riding, sleep, weight) and his rung on the watts-per-kilo ladder; the one limiter to fix now and why, as an expert coach would name it; and what to do this week to move toward being a high-level masters cyclist. Speak to him as "you". Warm, direct, a coach who knows him.');
      res.json({ reply: String(u.reply || '').slice(0, 900) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  // read the day ahead of the question (the page calls this as he opens the Coach page or starts to talk)
  app.get('/voice/warm', async (req, res) => { if (!auth(req, res)) return;
    try { const t = Date.now(), had = await contextKept(); if (!had || Date.now() - had.at > 30000) await contextBuild(); res.json({ ok: true, fresh: !had, ms: Date.now() - t }); }
    catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/voice', async (req, res) => { if (!auth(req, res)) return;
    try {
      // a Siri Shortcut named "The Way" can pass its own name along ("The way what's my next workout"): it is the
      // name of the door, not part of the sentence
      let text = String((req.body || {}).text || '').trim().replace(/^(hey\s+)?(siri[\s,]+)?the\s*way\b[\s,:.!?-]*/i, '').trim().slice(0, 1000);
      // photos: up to four, as the Food page sends them (Harry, 14 Nov 2026: "I should be able to add multiple
      // photos"); `image` is the one-photo form older pages send. With no words it is "look at this"
      const sent = Array.isArray((req.body || {}).images) ? req.body.images : (req.body || {}).image ? [req.body.image] : [];
      const okImg = img => img && typeof img.image_base64 === 'string' && img.image_base64.length > 200 && img.image_base64.length < 7e6 && /^[A-Za-z0-9+/=]+$/.test(img.image_base64.slice(0, 200));
      const images = sent.filter(okImg).slice(0, MAX_PHOTOS).map(img => ({ image_base64: img.image_base64, media_type: /^image\/(jpeg|png|webp|gif)$/.test(String(img.media_type || '')) ? img.media_type : 'image/jpeg' }));
      if (sent.length && !images.length) return res.status(400).json({ error: 'That photo could not be read. Try another.' });
      const image = images[0] || null;
      if (image && !text) text = images.length > 1 ? `Look at these ${images.length} photos and tell me what matters.` : 'Look at this photo and tell me what matters.';
      if (!text) return res.status(400).json({ error: 'nothing heard' });
      const coords = (req.body || {}).coords && Math.abs(Number(req.body.coords.lat)) <= 90 ? { lat: Number(req.body.coords.lat), lon: Number(req.body.coords.lon) } : null;
      let here = null; try { here = coords ? await require('./places').here(coords) : null; } catch (e) { here = null; }
      const ms = {}, tAll = Date.now();
      const host = req.get('x-forwarded-host') || req.get('host') || '', base = /(^|\.|--)thewayforward\.netlify\.app$/.test(host) ? 'https://' + host : 'https://thewayforward.netlify.app';
      // The answer has twenty seconds. Past that the host would cut the request off and he would hear nothing, so the
      // wait ends here instead: a question goes to the researched coach, which has minutes (coach.js), and he is told
      // so at once; anything that was to be logged, planned or changed is not done, and he is asked to say it again
      // (the day is read by then, so the second go is quick).
      let u;
      try { u = await Promise.race([understand(text, (req.body || {}).history, here ? `Where he is right now: at ${here.name}, one of his saved places (${here.dist_m} m)${(here.orders || []).length ? `; what he orders there: ${here.orders.map(o => o.name).join(', ')}` : ''}${here.notes ? `; note: ${here.notes}` : ''}.` : (coords ? 'His location came with this message, so a place can be saved where he stands, and routes_near can say which of his routes pass near him.' : '')
        + ((req.body || {}).talk ? '\nTHIS IS A LIVE SPOKEN CONVERSATION: he is talking to you out loud and you answer out loud, turn after turn. Speak like a coach across a table: one to three short sentences, under 40 words unless he asks for detail. Do not repeat what you said in an earlier turn. When you need one fact to coach well, ask one short question back and stop. Speech recognition wrote his words down: read past small mishearings.' : '') + rideWords((req.body || {}).ride), images, { ms, model: (req.body || {}).model, coords, deadline: tAll + 20000 }),
          new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('deadline'), { deadline: true })), 21500))]); }
      catch (e) {
        if (!(e && e.deadline)) throw e;
        Object.assign(ms, { total_ms: Date.now() - tAll, deadline: true });
        const doing = images.length || /^\s*(please\s+|can you\s+|could you\s+)?(plan|build|rebuild|schedule|move|log|add|remove|delete|put|set|send|save|remember|change|start|open|make)\b/i.test(text) || /^\s*(yes|no)\b/i.test(text) || /^\s*(ok|okay|do it|go|go ahead)\s*[.!]*\s*$/i.test(text);
        if (doing) return res.json({ heard: text, actions: [], reply: 'That took longer than it should, and I stopped before doing anything. Say it once more: your day is read now, so it will be quick.', slow: true, ms, offer: null });
        const id = await require('./coach').startJob(text, base, { kind: 'handoff' });
        return res.json({ heard: text, actions: [{ type: 'research', ok: true, summary: 'Taking a proper look: the full answer follows in a minute or two.', job: id }],
          reply: 'That one needs a proper look, more than I can do in a few seconds. I am going through your record now, and the full answer will be here in a minute or two.', slow: true, ms, offer: null });
      }
      const actions = [];
      if ((u.actions || []).some(a => a.type !== 'question' && a.type !== 'research')) await contextFresh();
      for (const a of (u.actions || []).slice(0, 6)) {
        try { actions.push(Object.assign({ type: a.type }, await run(a, { coords, here, image, images, base }))); }
        catch (e) { actions.push({ type: a.type, ok: false, summary: e.message.slice(0, 120) }); }
      }
      // The reply is written before the actions run (Harry heard "Logged" and then the action asked which leg day it
      // was). What he is told is what happened: an action that did not go through, or came back with a question,
      // is the answer; and a week written is confirmed from what was written, not from what was meant.
      const failed = actions.find(x => x.ok === false), wrote = actions.find(x => x.ok && x.type === 'plan_week' && /^Written:/.test(x.summary || ''));
      if (failed) u.reply = failed.summary; else if (wrote) u.reply = wrote.summary;
      if (!String(u.reply || '').trim() && actions.length) u.reply = actions.map(x => x.summary).filter(Boolean)[0] || '';   // never an empty answer
      res.json({ heard: text, actions, reply: String(u.reply || '').slice(0, image ? 900 : 600), photo: !!image, photos: images.length, ms: Object.assign(ms, { total_ms: Date.now() - tAll }),
        offer: u.offer && String(u.offer.plan || '').trim() ? { label: String(u.offer.label || 'Yes, change it').slice(0, 60), plan: String(u.offer.plan).slice(0, 400) } : null });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

// a write somewhere else in the app: the kept read is out of date (not waited on)
function contextStale() { ctxKept = null; setJSON(CTX_KEY, { at: 0 }).catch(() => {}); }
module.exports = { attach, understand, run, context, contextStale, promptFor, resized, systemText, doneWords, workWords, nightWords, rideWords };
