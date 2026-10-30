// ============================================================
// voice.js — one sentence in, the right entries out.
//
// The phone turns speech into text (Web Speech on the page); this reads
// the text and does what it says: a meal, a drink, a supplement, a
// weigh-in, a workout on the calendar, or a question answered from the
// day. Several things in one breath are several actions. The model
// (the same one that reads the photos) returns a strict list of actions
// and one spoken sentence; the actions run through the same functions
// the buttons use, so nothing is logged twice or differently.
//
//   POST /voice { text }  →  { heard, actions:[{type, ok, summary}], reply }
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const { LIBRARY } = require('./workout-library');
const MODEL = process.env.FOOD_MODEL || 'claude-opus-5-5';

const SUPPS = () => require('./micro-math').TABLE.supplements.map(s => s.key);
const SCHEMA = () => ({
  type: 'object', additionalProperties: false, required: ['actions', 'reply'],
  properties: {
    reply: { type: 'string' },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['type', 'text', 'meal', 'supplement', 'lb', 'date', 'time', 'library_key', 'name', 'minutes', 'sport'],
      properties: {
        type: { type: 'string', enum: ['meal', 'drink', 'supplement', 'weigh_in', 'workout', 'note', 'question', 'remove', 'remove_workout'] },
        text: { type: 'string' },
        meal: { type: 'string', enum: ['', 'breakfast', 'lunch', 'dinner', 'snack', 'on the bike'] },
        supplement: { type: 'string', enum: [''].concat(SUPPS()) },
        lb: { type: 'number' },
        date: { type: 'string' }, time: { type: 'string' },
        library_key: { type: 'string', enum: [''].concat(LIBRARY.map(l => l.key)) },
        name: { type: 'string' }, minutes: { type: 'integer' },
        sport: { type: 'string', enum: ['', 'Ride', 'VirtualRide', 'WeightTraining'] }
      } } }
  }
});

async function context() {
  const today = tz.todayKey();
  const p = tz.parts(new Date());
  let day = null;
  try { day = await require('./food').dayReport(today); } catch (e) { day = null; }
  const lines = [`Today is ${today}, a ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(today + 'T12:00:00Z').getUTCDay()]}; the time is ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}.`];
  if (day) {
    lines.push(`Fuel: ${day.fuel_day}, target ${day.target.kcal} kcal, ${day.target.carbs_g} C / ${day.target.protein_g} P / ${day.target.fat_g} F; eaten so far ${day.actual.kcal} kcal, ${day.actual.carbs_g} C / ${day.actual.protein_g} P / ${day.actual.fat_g} F in ${day.actual.meals} meal(s).`);
    if (day.sessions.length) lines.push('Training today: ' + day.sessions.map(s => `${s.name}${s.time ? ' at ' + s.time : ''}${s.done ? ' (done)' : ''}`).join('; ') + '.');
    if (day.cue) lines.push('Where the day stands: ' + day.cue.text);
    if (day.hydration) lines.push(`Drinks so far ${day.hydration.drunk_ml} ml of ${day.hydration.target.total} ml.`);
    if (day.micros && day.micros.gaps.length) lines.push('Micronutrients short: ' + day.micros.gaps.map(g => g.label).join(', ') + '.');
  }
  return lines.join('\n');
}

function promptFor(text, ctx) {
  return `You run the voice of one cyclist's training and food app. He spoke one or more things; turn them into actions, and write one short spoken reply (plain, friendly, under 25 words, no lists).
${ctx}

Action types:
- meal: something eaten. text = the plate in his words (keep every food and any weights); meal = which meal if he said or it is obvious from the time, else "".
- drink: something drunk on its own (water, coffee, a bottle, a shake with nothing else). text = what and roughly how much.
- supplement: one of the known supplements (supplement = its key). One action per supplement.
- weigh_in: lb = his weight in pounds (convert kg if he says kg).
- workout: a ride or session to put on the calendar. date = YYYY-MM-DD (resolve "tomorrow", "Saturday"; the next such day), time = HH:MM 24h or "" if none, library_key when one of the library sessions fits, else name/minutes/sport. Library: ${LIBRARY.map(l => `${l.key} (${l.name})`).join(', ')}.
- remove: take something back out of today's food journal. text = what to remove in his words ("the salmon", "the water"), or "" for the last thing logged ("undo", "delete that").
- remove_workout: take a planned session off the calendar. date = its day (YYYY-MM-DD), text = what he called it or "".
- note: anything about how he feels or slept, text = his words.
- question: he asked something; answer it in the reply from the day's context above. No other fields.
Several things in one breath are several actions, in the order said. If nothing actionable was said, return no actions and reply with what you understood.
Fill every field: "" or 0 where it does not apply.

He said: "${text}"`;
}

async function understand(text) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA() } },
      messages: [{ role: 'user', content: promptFor(text, await context()) }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('voice ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 160));
  const block = (j.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no answer');
  return JSON.parse(block.text.replace(/```json|```/g, '').trim());
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
      body.date = /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : tz.todayKey();
      body.time = /^\d{2}:\d{2}$/.test(a.time) ? a.time : null;
      const w = await require('./workouts').create(body);
      return { ok: true, summary: `On the calendar: ${w.name}, ${w.date}${w.time ? ' at ' + w.time : ''}.`, workout_id: w.id };
    }
    case 'remove': {
      const list = (await food.todayEntries()).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
      if (!list.length) return { ok: false, summary: 'Nothing in the journal today to remove.' };
      const words = String(a.text || '').toLowerCase().split(/\W+/).filter(w => w.length > 2 && !/^(the|that|last|entry|one|meal|from|journal|remove|delete)$/.test(w));
      const hit = words.length ? list.slice().reverse().find(e => words.some(w => String(e.name || '').toLowerCase().includes(w))) : list[list.length - 1];
      if (!hit) return { ok: false, summary: `Nothing matching "${a.text}" in today's journal.` };
      await food.removeEntry(hit.id, tz.todayKey());
      return { ok: true, summary: `Removed: ${hit.name}${hit.time ? ' (' + hit.time + ')' : ''}.` };
    }
    case 'remove_workout': {
      const d = await getJSON('plan-workouts', { workouts: {} });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : tz.todayKey();
      const words = String(a.text || '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
      const onDay = Object.values(d.workouts || {}).filter(w => w.date === date);
      const hit = (words.length ? onDay.find(w => words.some(x => String(w.name || '').toLowerCase().includes(x))) : null) || onDay[0];
      if (!hit) return { ok: false, summary: `No planned session on ${date}.` };
      await require('./workouts').remove(hit.id);
      return { ok: true, summary: `Off the calendar: ${hit.name}, ${hit.date}.` };
    }
    case 'note': {
      const d = await getJSON('voice-notes', { notes: [] });
      d.notes.push({ at: new Date().toISOString(), date: tz.todayKey(), text: String(a.text).slice(0, 500) });
      d.notes = d.notes.slice(-200);
      await setJSON('voice-notes', d);
      return { ok: true, summary: 'Noted.' };
    }
    case 'question': return { ok: true, summary: 'Answered.' };
    default: return { ok: false, summary: 'Did not understand that part.' };
  }
}

function attach(app) {
  app.post('/voice', async (req, res) => { if (!auth(req, res)) return;
    try {
      const text = String((req.body || {}).text || '').trim().slice(0, 1000);
      if (!text) return res.status(400).json({ error: 'nothing heard' });
      const u = await understand(text);
      const actions = [];
      for (const a of (u.actions || []).slice(0, 6)) {
        try { actions.push(Object.assign({ type: a.type }, await run(a))); }
        catch (e) { actions.push({ type: a.type, ok: false, summary: e.message.slice(0, 120) }); }
      }
      res.json({ heard: text, actions, reply: String(u.reply || '').slice(0, 300) });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, understand, run };
