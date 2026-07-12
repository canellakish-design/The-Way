// The Way Coach. Tools call module functions directly (no self-HTTP —
// required for serverless). Daily thread persisted in storage.
const { getJSON, setJSON } = require('./storage');
const { auth, fuelState, logMeal } = require('./fuel-log');
const { getPlan } = require('./plan');
const { routeWeather } = require('./weather');
const { prescription } = require('./prescriptions');
const { weekState, logTraining } = require('./race');
const { sleepLatest } = require('./whoop');
const calendar = require('./calendar');

const KEY = process.env.ANTHROPIC_API_KEY || '';

async function loadThread() {
  const t = await getJSON('agent-thread', null);
  if (!t || t.day !== new Date().toDateString()) {
    return { day: new Date().toDateString(), messages: [], yesterday: t ? t.summary : null };
  }
  return t;
}

const TOOLS = [
  { name: 'get_state', description: 'Fuel state: ledger balance, carbs on board, meals today', input_schema: { type: 'object', properties: {} } },
  { name: 'get_weight', description: 'Latest weigh-in and 7-day trend', input_schema: { type: 'object', properties: {} } },
  { name: 'get_sleep', description: 'WHOOP sleep performance, hours, recovery, HRV, RHR', input_schema: { type: 'object', properties: {} } },
  { name: 'get_route_weather', description: 'Weather now/evening, wind vs the planned route', input_schema: { type: 'object', properties: {} } },
  { name: 'get_plan', description: "Planned ride: name, start time, route facts", input_schema: { type: 'object', properties: {} } },
  { name: 'get_race_week', description: "Weeks to race, phase, this week's buckets: needed/done/remaining", input_schema: { type: 'object', properties: {} } },
  { name: 'get_availability', description: "Today's calendar-derived training windows (from Google Calendar), best window length, recovery color, and the engine's session recommendation. Also weekly available vs recommended hours.",
    input_schema: { type: 'object', properties: { scope: { type: 'string', enum: ['today', 'week'] } } } },
  { name: 'get_prescription', description: 'Lunch or dinner in Energy Bank units',
    input_schema: { type: 'object', properties: { meal: { type: 'string', enum: ['lunch', 'dinner'] } }, required: ['meal'] } },
  { name: 'log_meal', description: 'Write a meal to the ledger. CONFIRM first.',
    input_schema: { type: 'object', properties: { name: { type: 'string' }, meal: { type: 'string' },
      kcal: { type: 'number' }, carbs_g: { type: 'number' }, protein_g: { type: 'number' }, fat_g: { type: 'number' } }, required: ['name', 'kcal'] } },
  { name: 'log_training', description: 'Drain week buckets after a session. CONFIRM first. aerobic_h = Z2 hours, hi_min = minutes at threshold+, strength = sessions.',
    input_schema: { type: 'object', properties: { aerobic_h: { type: 'number' }, hi_min: { type: 'number' }, strength: { type: 'number' } } } }
];

async function runTool(name, input) {
  try {
    if (name === 'get_state') return await fuelState();
    if (name === 'get_weight') return await getJSON('withings-trend', { note: 'no scale connected yet' });
    if (name === 'get_sleep') return await sleepLatest();
    if (name === 'get_route_weather') return await routeWeather(NaN);
    if (name === 'get_plan') return await getPlan();
    if (name === 'get_race_week') return await weekState();
    if (name === 'get_availability') {
      const d = await (require('./storage').getJSON('gcal', { tokens: null, events: [] }));
      if (!d.tokens) return { connected: false, note: 'Google Calendar not connected — /gcal/auth' };
      const s = await sleepLatest().catch(() => null);
      const rec = s && s.recovery ? s.recovery.score : null;
      if ((input.scope || 'today') === 'week') return calendar.weekAvailability(d.events, rec);
      const key = new Date().toISOString().slice(0, 10);
      const day = calendar.windowsForDate(d.events, key);
      const w = await weekState().catch(() => null);
      return { ...day, ...calendar.recommendToday(day, rec, w ? w.remaining : null) };
    }
    if (name === 'get_prescription') return await prescription(input.meal || 'dinner', 0);
    if (name === 'log_meal') return await logMeal(input);
    if (name === 'log_training') return await logTraining(input);
  } catch (e) { return { error: e.message }; }
  return { error: 'unknown tool' };
}

function systemPrompt(mode, yesterday) {
  return `You are The Way — Harry's coach. Not an assistant: a coach with a
point of view, built into his training and fueling operating system.

THE ATHLETE: Harry. Competitive cyclist, Cervelo R5, FTP 265. Green band:
the day settles -300 to -600 kcal (target -450). Protein goal 190g.
Training ingredients: fasted Z2, HIIT, 70lb kettlebell strength, batch
cooking day, 35-mile evening commute leg. Ride Fuel Unit = spicy anchovy
rice ball, 19g carbs.

THE RACE: Gran Fondo Maryland (Medio) — Sept 20, 2026, Frederick. 57 miles,
6,200 ft: a climbing race, won on W/kg and repeated threshold climbs. The
race creates the training: weekly buckets (get_race_week) say what the week
owes. Harry chooses WHEN to pay; you coach WHAT is owed and flag imbalance.
After sessions, offer to log them (log_training, confirm first).

AVAILABILITY: When the calendar is connected (get_availability), it is the
source of truth for WHEN Harry can train — never ask him how many hours he
has. Answer "can I ride tomorrow?" by reading the calendar: name the
blocks, name the window, check recovery, then recommend the session that
pays what the week owes and fits the window.

DOCTRINE (never violate):
- Fuel the work; take the deficit at the margins. Under-fueling is a bug.
- The band has a FLOOR. Never praise a huge deficit; coach it back to green.
- Numbers come from tools, never memory. Round them; band language over
  false precision.
- Confirm before any write (log_meal, log_training): once, briefly.

VOICE: Direct, warm, economical. A coach at the trainer, not a wellness app.
${mode === 'watch' ? 'WATCH MODE: ONE short sentence. No follow-up questions.'
                   : 'Two or three sentences unless asked to go deeper.'}
${yesterday ? 'Yesterday: ' + yesterday : ''}`;
}

function attach(app) {
  app.post('/agent', async (req, res) => {
    if (!auth(req, res)) return;
    if (!KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const mode = req.body.mode === 'watch' ? 'watch' : 'cockpit';
    const t = await loadThread();
    t.messages.push({ role: 'user', content: req.body.text || '' });
    try {
      let messages = t.messages.slice(-30);
      let reply = '';
      for (let hop = 0; hop < 4; hop++) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': KEY,
                     'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 500,
            system: systemPrompt(mode, t.yesterday), tools: TOOLS, messages })
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        const uses = (d.content || []).filter(c => c.type === 'tool_use');
        reply = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
        if (!uses.length) break;
        messages = messages.concat([{ role: 'assistant', content: d.content }]);
        const results = [];
        for (const u of uses) results.push({ type: 'tool_result', tool_use_id: u.id,
          content: JSON.stringify(await runTool(u.name, u.input || {})) });
        messages = messages.concat([{ role: 'user', content: results }]);
      }
      t.messages.push({ role: 'assistant', content: reply });
      await setJSON('agent-thread', t);
      res.json({ reply, mode });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post('/agent/closeout', async (req, res) => {
    if (!auth(req, res)) return;
    const t = await loadThread();
    t.summary = String(req.body.summary || '').slice(0, 500);
    await setJSON('agent-thread', t);
    res.json({ ok: true });
  });
}
module.exports = { attach };
