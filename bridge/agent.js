// ============================================================
// agent.js — The Way Agent (Coach, voiced)
// POST /agent { text, mode? }  mode: "cockpit" (default) | "watch"
// Server-side daily thread; tools are the bridge's own data.
// Env: ANTHROPIC_API_KEY, FUEL_TOKEN
// ============================================================
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.FUEL_TOKEN || '';
const KEY = process.env.ANTHROPIC_API_KEY || '';
const THREAD = path.join(__dirname, 'agent-thread.json');
const PORT = process.env.PORT || 8420;

function loadThread() {
  try {
    const t = JSON.parse(fs.readFileSync(THREAD, 'utf8'));
    // new day = new thread (close-out summary carries context forward)
    if (t.day !== new Date().toDateString()) {
      return { day: new Date().toDateString(), messages: [], yesterday: t.summary || null };
    }
    return t;
  } catch {
    return { day: new Date().toDateString(), messages: [], yesterday: null };
  }
}
function saveThread(t) { fs.writeFileSync(THREAD, JSON.stringify(t, null, 2)); }

// local helper: call our own endpoints so the agent and UI share one brain
async function local(pathname) {
  const r = await fetch(`http://127.0.0.1:${PORT}${pathname}${pathname.includes('?') ? '&' : '?'}token=${TOKEN}`);
  return r.json();
}

const TOOLS = [
  { name: 'get_state', description: 'Current fuel state, ledger balance, meals today, carbs on board',
    input_schema: { type: 'object', properties: {} } },
  { name: 'get_weight', description: 'Latest weigh-in, 7-day trend, week change',
    input_schema: { type: 'object', properties: {} } },
  { name: 'get_sleep', description: 'Last night: WHOOP sleep performance, hours, recovery score, HRV, RHR',
    input_schema: { type: 'object', properties: {} } },
  { name: 'get_route_weather', description: 'Weather now and for the evening leg, wind interpreted against the route',
    input_schema: { type: 'object', properties: {} } },
  { name: 'get_prescription', description: 'Lunch or dinner prescription in Energy Bank units',
    input_schema: { type: 'object', properties: { meal: { type: 'string', enum: ['lunch', 'dinner'] } }, required: ['meal'] } },
  { name: 'log_meal', description: 'Log a meal to the ledger. CONFIRM with the athlete before calling.',
    input_schema: { type: 'object', properties: {
      name: { type: 'string' }, meal: { type: 'string' },
      kcal: { type: 'number' }, carbs_g: { type: 'number' },
      protein_g: { type: 'number' }, fat_g: { type: 'number' } }, required: ['name', 'kcal'] } },
];

async function runTool(name, input) {
  if (name === 'get_state') return local('/fuel-state');
  if (name === 'get_weight') return local('/weight/latest');
  if (name === 'get_sleep') return local('/sleep/latest');
  if (name === 'get_route_weather') return local('/route-weather');
  if (name === 'get_prescription') return local('/prescription/' + (input.meal || 'dinner'));
  if (name === 'log_meal') {
    const r = await fetch(`http://127.0.0.1:${PORT}/meals?token=${TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input) });
    return r.json();
  }
  return { error: 'unknown tool' };
}

function systemPrompt(mode, yesterday) {
  return `You are The Way — Harry's cycling and nutrition coach. Doctrine:
fuel the work, take the deficit at the margins; the day settles in the green
band (-600 to -300 kcal, target -450). FTP 265. Protein goal 190g. Five-day
cycle: Days 1 & 4 fasted Z2, HIIT, Day 3 grocery/batch, strength = 70lb
kettlebell. Ride Fuel Unit = spicy anchovy rice ball (19g carbs).
${yesterday ? 'Yesterday: ' + yesterday : ''}
Rules: be direct and brief — ${mode === 'watch'
    ? 'ONE short sentence, no follow-up questions (watch mode).'
    : 'two or three sentences max unless asked to go deeper.'}
Use tools for any number you state — never guess state. Before any write
(log_meal), confirm once conversationally. Numbers rounded; band language
("green", "-430") over false precision.`;
}

module.exports = function (app) {
  app.post('/agent', async (req, res) => {
    if ((req.query.token || req.body.token || '') !== TOKEN) {
      return res.status(401).json({ error: 'bad token' });
    }
    if (!KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const mode = req.body.mode === 'watch' ? 'watch' : 'cockpit';
    const t = loadThread();
    t.messages.push({ role: 'user', content: req.body.text || '' });

    try {
      let messages = t.messages.slice(-30); // keep the day, cap the window
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
        const toolUses = (d.content || []).filter(c => c.type === 'tool_use');
        reply = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
        if (toolUses.length === 0) break;
        messages = messages.concat([{ role: 'assistant', content: d.content }]);
        const results = [];
        for (const tu of toolUses) {
          const out = await runTool(tu.name, tu.input || {});
          results.push({ type: 'tool_result', tool_use_id: tu.id,
                         content: JSON.stringify(out) });
        }
        messages = messages.concat([{ role: 'user', content: results }]);
      }
      t.messages.push({ role: 'assistant', content: reply });
      saveThread(t);
      res.json({ reply, mode });
    } catch (e) {
      console.error('[agent]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Close-out writes the day's summary; it seeds tomorrow's briefing.
  app.post('/agent/closeout', (req, res) => {
    if ((req.query.token || '') !== TOKEN) return res.status(401).json({ error: 'bad token' });
    const t = loadThread();
    t.summary = String(req.body.summary || '').slice(0, 500);
    saveThread(t);
    res.json({ ok: true });
  });
};
