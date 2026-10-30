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

const SUPPS = () => require('./micro-math').TABLE.supplements.map(s => s.key);
const FIELDS = ['type', 'text', 'meal', 'supplement', 'lb', 'date', 'time', 'new_date', 'library_key', 'name', 'minutes', 'sport'];
const SCHEMA = () => ({
  type: 'object', additionalProperties: false, required: ['actions', 'reply'],
  properties: {
    reply: { type: 'string' },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: FIELDS,
      properties: {
        type: { type: 'string', enum: ['meal', 'drink', 'supplement', 'weigh_in', 'workout', 'workout_change', 'remove_workout', 'event', 'event_change', 'remove', 'note', 'question'] },
        text: { type: 'string' },
        meal: { type: 'string', enum: ['', 'breakfast', 'lunch', 'dinner', 'snack', 'on the bike'] },
        supplement: { type: 'string', enum: [''].concat(SUPPS()) },
        lb: { type: 'number' },
        date: { type: 'string' }, time: { type: 'string' }, new_date: { type: 'string' },
        library_key: { type: 'string', enum: [''].concat(LIBRARY.map(l => l.key)) },
        name: { type: 'string' }, minutes: { type: 'integer' },
        sport: { type: 'string', enum: ['', 'Ride', 'VirtualRide', 'WeightTraining'] }
      } } }
  }
});

const race = (p, ms, fallback) => Promise.race([p.catch(() => fallback), new Promise(r => setTimeout(() => r(fallback), ms))]);
const L = ml => (Math.abs(ml) / 1000).toFixed(1) + ' L';

// Where the day stands, in plain lines the model can reason from.
async function context() {
  const today = tz.todayKey(), tomorrow = tz.shiftKey(today, 1);
  const p = tz.parts(new Date());
  const nowMin = p.h * 60 + p.mi;
  const W = require('./workout-math');
  const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
  const [day, sched, wx] = await Promise.all([
    race(require('./food').dayReport(today), 6000, null),
    race(require('./calendar').scheduleReport({ days: 2 }), 5000, null),
    race(require('./weather').forecastAt(today, Math.max(nowMin, 7 * 60), 8 * 60), 2500, null)
  ]);
  const lines = [`Today is ${today}, a ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today + 'T12:00:00Z').getUTCDay()]}; the time is ${tz.hm12(String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'))}.`];
  if (day) {
    const t = day.target, a = day.actual;
    lines.push(`He weighs ${t.kg || 98} kg; planning FTP ${st.ftp} W, threshold heart rate ${st.lthr}.`);
    lines.push(`Food day: ${day.fuel_day}. Whole-day target ${t.kcal} kcal, ${t.carbs_g} g carbs, ${t.protein_g} g protein, ${t.fat_g} g fat (${t.deficit ? `a ${Math.abs(t.deficit)} kcal deficit for weight loss` : 'no deficit today: recovery is low, eat to maintenance'}). Eaten so far: ${a.kcal} kcal, ${a.carbs_g} C / ${a.protein_g} P / ${a.fat_g} F in ${a.meals} meal(s). Still to eat today: ${Math.max(0, t.kcal - a.kcal)} kcal, ${Math.max(0, t.carbs_g - a.carbs_g)} C / ${Math.max(0, t.protein_g - a.protein_g)} P / ${Math.max(0, t.fat_g - a.fat_g)} F.`);
    if (day.sessions.length) lines.push('Training today: ' + day.sessions.map(s => `${s.name}${s.time ? ' at ' + tz.hm12(s.time) : ''}${s.done ? ' (done)' : ' (planned)'}`).join('; ') + '.');
    else lines.push('No training today.');
    if (day.cue) lines.push('Where the day stands: ' + day.cue.text);
    if (day.guidelines && day.guidelines.length) lines.push("Today's eating rules: " + day.guidelines.map(g => g.text).join(' ').slice(0, 400));
    if (day.meals && day.meals.length) lines.push('The meal plan: ' + day.meals.map(m => `${tz.hm12(m.time)} ${m.slot} (${m.carbs_g} C, ${m.protein_g || 0} P${(m.logged || []).length ? ', logged' + (m.match ? ', ' + m.match.word : '') : ''})`).join('; ') + '.');
    const e = day.energy;
    if (e && e.now) {
      lines.push(`Live fuel now: quick store ${e.now.pct}% (${e.now.band.word}), legs ${e.now.legs_pct}%.` + (e.sessions || []).map(s => ` ${s.name} at ${tz.hm12(s.time)} needs ${s.need}% quick and ${s.need_legs}% legs; it will have ${s.pct}% and ${s.legs_pct}% (${s.band.word}).`).join('') + (e.advice ? ' Advice: ' + e.advice : ''));
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
    if (typeof sched.recovery === 'string') lines.push(`WHOOP recovery today: ${sched.recovery} (${sched.recovery === 'green' ? 'ready' : sched.recovery === 'yellow' ? 'moderate, keep it easy' : 'low, rest or Zone 1 only'}).`);
  }
  if (wx && wx.summary) lines.push(`Weather for riding today: ${wx.summary}.`);
  return lines.join('\n');
}

function promptFor(text, ctx, continuing) {
  return `You are the voice of one cyclist's training and food app, and his advisor. He is 55 and training through a slow weight loss. ${continuing ? 'This is a conversation: the turns above are what he said and what you answered. Answer the latest thing he said in that light. If he is answering a question you asked, or choosing between options you gave, act on it now.' : 'He spoke one or more things.'} Turn what he said into actions, and write one spoken reply.

Where the day stands:
${ctx}

Action types:
- meal: something eaten. text = the plate in his words (keep every food and any weights); meal = which meal if he said or it is obvious from the time, else "".
- drink: something drunk on its own (water, coffee, a bottle, a shake with nothing else). text = what and roughly how much.
- supplement: one of the known supplements (supplement = its key). One action per supplement.
- weigh_in: lb = his weight in pounds (convert kg if he says kg).
- workout: a ride or session to put on the calendar. date = YYYY-MM-DD (resolve "tomorrow", "Saturday"; the next such day), time = HH:MM 24h or "" if none, library_key when one of the library sessions fits, else name/minutes/sport. Library: ${LIBRARY.map(l => `${l.key} (${l.name})`).join(', ')}.
- workout_change: change a planned session: make it longer or shorter (minutes = the NEW total length; "add 30 minutes" to a 90 means 120), move its start (time = new HH:MM), move it to another day (new_date), or swap it for another library session (library_key). date = the day it is on now (today if unsaid), text = what he called it or "".
- remove_workout: take a planned session off the calendar. date = its day, text = what he called it or "".
- event: anything else to put on the calendar (a dentist, a meeting, a drive). name = the title, date = YYYY-MM-DD, time = HH:MM or "" for all day, minutes = length (60 if he gave none), text = notes or "".
- event_change: move or change a calendar event that is not a workout: text = which event in his words, date = the day it is on now, time = new start HH:MM or "", new_date = the day to move it to or "", minutes = new length or 0, name = new title or "".
- remove: take something back out of today's food journal. text = what to remove ("the salmon", "the water"), or "" for the last thing logged ("undo", "delete that").
- note: anything about how he feels or slept, text = his words.
- question: he asked for advice or an answer. No other fields; the answer goes in the reply.
Several things in one breath are several actions, in the order said. If nothing actionable was said, return no actions and reply with what you understood.
Fill every field: "" or 0 where it does not apply.

The reply, spoken aloud, plain and friendly, no lists, no numbers he did not ask for:
- For logged things: one short sentence confirming them (under 20 words).
- For a question: advise. Pick one option and say the one reason that decides it, from the numbers above (what the next session needs, the calories and macros still due, fuel and water on board, the rules of the day, the weather, the calendar). Under 45 words. If two options are truly equal, say so and pick the simpler one. Never say "it depends" without then deciding. Coffee with whole milk adds about 3 g fat and 40 kcal over skim; a scoop of Tailwind is 25 g carbs (the plan's bottle on a hard day is two scoops, 50 g); a scoop of whey 25 g protein. Prefer the choice that serves the next session, then the day's deficit.
- Times in 12-hour form (3:30p, never 15:30).

He said: "${text}"`;
}

// A conversation: the earlier turns come back from the page (what he said,
// what was answered), so "yes, do that" or "the second one" has something to
// point at. The prompt with the day's context rides on the latest turn only.
async function understand(text, history) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const prior = (Array.isArray(history) ? history : []).slice(-10)
    .filter(h => h && (h.role === 'user' || h.role === 'assistant') && h.text)
    .map(h => ({ role: h.role, content: String(h.text).slice(0, 600) }));
  // the API wants the turns to alternate and to start with him
  const turns = []; for (const t of prior) { if (!turns.length && t.role !== 'user') continue; if (turns.length && turns[turns.length - 1].role === t.role) turns[turns.length - 1].content += '\n' + t.content; else turns.push(t); }
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA() } },
      messages: turns.concat([{ role: 'user', content: promptFor(text, await context(), turns.length > 0) }]) })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('voice ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 160));
  const block = (j.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no answer');
  return JSON.parse(block.text.replace(/```json|```/g, '').trim());
}

const words = t => String(t || '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !/^(the|that|last|one|from|remove|delete|move|change|my|ride|workout|session|event|today|tomorrow|this|and|for|with)$/.test(w));
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
const isTime = t => /^\d{2}:\d{2}$/.test(t || '');

// The planned session on a day that his words point at (or the only one).
async function findWorkout(date, text) {
  const d = await getJSON('plan-workouts', { workouts: {} });
  const onDay = Object.values(d.workouts || {}).filter(w => w.date === date).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  const ws = words(text);
  return (ws.length ? onDay.find(w => ws.some(x => String(w.name || '').toLowerCase().includes(x))) : null) || onDay[0] || null;
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

async function run(a) {
  const food = require('./food');
  switch (a.type) {
    case 'meal': case 'drink': {
      const e = await food.addPhoto({ text: a.text, meal: a.meal || undefined });
      return { ok: true, summary: `${a.type === 'drink' ? 'Drink' : 'Meal'} logged: ${e.name}, ${e.kcal} kcal${e.fluid_ml ? `, ${e.fluid_ml} ml` : ''}.`, entry_id: e.id };
    }
    case 'supplement': {
      const e = await food.addSupplement(a.supplement);
      return e ? { ok: true, summary: `Supplement logged: ${e.name}.` } : { ok: false, summary: `Unknown supplement "${a.supplement}".` };
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
      const w = await require('./workouts').create(body);
      return { ok: true, summary: `On the calendar: ${w.name}, ${w.date}${w.time ? ' at ' + tz.hm12(w.time) : ''}.`, workout_id: w.id };
    }
    case 'workout_change': {
      const date = isDate(a.date) ? a.date : tz.todayKey();
      const hit = await findWorkout(date, a.text);
      if (!hit) return { ok: false, summary: `No planned session on ${date} to change.` };
      const body = { date: isDate(a.new_date) ? a.new_date : hit.date, time: isTime(a.time) ? a.time : hit.time };
      const lib = LIBRARY.find(l => l.key === a.library_key);
      if (lib) Object.assign(body, { name: lib.name, sport: lib.sport, notes: lib.notes, steps: lib.steps });
      else if (a.minutes > 0) Object.assign(body, resized(hit, a.minutes));
      const w = await require('./workouts').update(hit.id, body);
      const what = [lib ? `now ${w.name}` : a.minutes > 0 ? `now ${Math.round(w.metrics.duration_s / 60)} min` : null, isTime(a.time) ? `at ${tz.hm12(a.time)}` : null, isDate(a.new_date) ? `on ${a.new_date}` : null].filter(Boolean).join(', ');
      return { ok: true, summary: `Changed: ${hit.name}${what ? ', ' + what : ''}${w.sync && w.sync.state === 'synced' ? ' (re-sent)' : ''}.`, workout_id: w.id };
    }
    case 'remove_workout': {
      const date = isDate(a.date) ? a.date : tz.todayKey();
      const hit = await findWorkout(date, a.text);
      if (!hit) return { ok: false, summary: `No planned session on ${date}.` };
      await require('./workouts').remove(hit.id);
      return { ok: true, summary: `Off the calendar: ${hit.name}, ${hit.date}.` };
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
    case 'note': {
      const d = await getJSON('voice-notes', { notes: [] });
      d.notes.push({ at: new Date().toISOString(), date: tz.todayKey(), text: String(a.text).slice(0, 500) });
      d.notes = d.notes.slice(-200);
      await setJSON('voice-notes', d);
      return { ok: true, summary: 'Noted.' };
    }
    case 'question': return { ok: true, summary: 'Advice below.' };
    default: return { ok: false, summary: 'Did not understand that part.' };
  }
}
const toHM24 = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

function attach(app) {
  app.post('/voice', async (req, res) => { if (!auth(req, res)) return;
    try {
      const text = String((req.body || {}).text || '').trim().slice(0, 1000);
      if (!text) return res.status(400).json({ error: 'nothing heard' });
      const u = await understand(text, (req.body || {}).history);
      const actions = [];
      for (const a of (u.actions || []).slice(0, 6)) {
        try { actions.push(Object.assign({ type: a.type }, await run(a))); }
        catch (e) { actions.push({ type: a.type, ok: false, summary: e.message.slice(0, 120) }); }
      }
      res.json({ heard: text, actions, reply: String(u.reply || '').slice(0, 600) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, understand, run, context, promptFor, resized };
