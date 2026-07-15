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
    input_schema: { type: 'object', properties: { aerobic_h: { type: 'number' }, hi_min: { type: 'number' }, strength: { type: 'number' } } } },
  { name: 'get_research', description: 'Search PubMed for peer-reviewed sports science / nutrition / physiology literature. Use for "what does research say" questions — not general web queries. Returns article title/journal/year/abstract snippets, not full text.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] } },
  { name: 'get_nutrition', description: 'Look up calories, protein, carbs, and fat for a named food or branded product (USDA FoodData Central). Use whenever Harry names a food without giving its macros himself — never guess nutrition numbers from memory.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  // Anthropic's server-side web search — executed by Anthropic, not by us.
  // Good for current, general info (gear, software, news); not a literature
  // database, so prefer get_research for training/nutrition science.
  { type: 'web_search_20250305', name: 'web_search' }
];

// NCBI E-utilities — public, no API key required for light personal use.
// esearch finds matching PMIDs; efetch pulls plain-text abstracts. We don't
// parse the text into structured fields (title/authors/etc separately) —
// Claude reads the raw abstract chunk fine and it avoids a fragile XML
// parser for a personal tool. Text is capped per result so the coach
// paraphrases/summarizes rather than reading a dense abstract verbatim.
async function pubmedSearch(query, maxResults) {
  if (!query) return { error: 'query required' };
  const n = Math.min(Math.max(Number(maxResults) || 5, 1), 8);

  const esearchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${n}&sort=relevance&term=${encodeURIComponent(query)}`;
  const es = await fetch(esearchUrl).then(r => r.json());
  const ids = (es.esearchresult && es.esearchresult.idlist) || [];
  if (!ids.length) return { query, results: [] };

  const efetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&retmode=text&rettype=abstract&id=${ids.join(',')}`;
  const text = await fetch(efetchUrl).then(r => r.text());

  // NCBI's plain-text output separates records with a blank line before a
  // numbered heading ("1. J Appl Physiol. 2020 ..."). Split on that.
  const chunks = text.split(/\n(?=\d+\.\s)/).map(s => s.trim()).filter(Boolean);

  return {
    query,
    results: chunks.map((c, i) => ({
      pmid: ids[i] || null,
      link: ids[i] ? `https://pubmed.ncbi.nlm.nih.gov/${ids[i]}/` : null,
      text: c.slice(0, 1200)
    }))
  };
}

// USDA FoodData Central — free public nutrition database, structured
// macros (not text to summarize, unlike get_research). Sign up for a free
// key at https://fdc.nal.usda.gov/api-key-signup and set FDC_API_KEY; falls
// back to the shared DEMO_KEY (30 req/hr, 50/day) if unset — fine to test
// with, too rate-limited to lean on for daily coaching.
async function nutritionLookup(query) {
  if (!query) return { error: 'query required' };
  const key = process.env.FDC_API_KEY || 'DEMO_KEY';
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&query=${encodeURIComponent(query)}&pageSize=5`;
  const d = await fetch(url).then(r => r.json());
  if (d.error) return { error: d.error.message || 'FDC lookup failed' };

  const pick = (nutrients, match) => {
    const n = (nutrients || []).find(x => (x.nutrientName || '').toLowerCase().includes(match));
    return n ? Math.round(n.value * 10) / 10 : null;
  };

  const results = (d.foods || []).slice(0, 5).map(f => ({
    description: f.description,
    brand: f.brandOwner || null,
    serving: f.servingSize ? `${f.servingSize}${f.servingSizeUnit || ''}` : 'per 100g (no serving size on file)',
    kcal: pick(f.foodNutrients, 'energy'),
    protein_g: pick(f.foodNutrients, 'protein'),
    carbs_g: pick(f.foodNutrients, 'carbohydrate'),
    fat_g: pick(f.foodNutrients, 'total lipid')
  }));

  return { query, results };
}

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
    if (name === 'get_research') return await pubmedSearch(input.query, input.max_results);
    if (name === 'get_nutrition') return await nutritionLookup(input.query);
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

RESEARCH: get_research searches peer-reviewed literature (PubMed) — use it
for training/nutrition/physiology science questions ("does carb periodization
help," "what does research say about X"). web_search covers general current
info (gear, software, races, anything else) — use it for that instead.
get_nutrition looks up calories/protein/carbs/fat for a named food or
product — use it whenever Harry names something to eat without giving you
the macros himself, before logging it.

DOCTRINE (never violate):
- Fuel the work; take the deficit at the margins. Under-fueling is a bug.
- The band (-300 to -600) refers to the DAY'S END settle, not a live
  snapshot. A large negative balance in the morning while fasted is
  NORMAL and expected — do not treat it as an emergency or tell Harry
  to eat before a planned fasted ride. Fasted Z2 is doctrine: water +
  coffee, ride first, eat after.
- The band has a FLOOR at day's end. Never praise a huge deficit; coach
  the day's remaining meals to land the settle in green.
- Numbers come from tools, never memory. Round them (HRV 21, not
  21.267122); band language over false precision.
- Confirm before any write (log_meal, log_training): once, briefly.
- When citing get_research or web_search findings, paraphrase in your own
  words and name the source briefly (journal + year is enough). Never read
  a raw abstract verbatim — it's dense and this gets read aloud by TTS.

FORMAT: Plain text only. No markdown, no asterisks, no ---, no emojis,
no tables. Short paragraphs. This text is read aloud by TTS.

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
      // strip markdown so the reply reads clean (no **bold** or --- dashes)
      reply = reply.replace(/\*\*([^*]+)\*\*/g, '$1')  // **bold** -> bold
                   .replace(/\*([^*]+)\*/g, '$1')        // *italic* -> italic
                   .replace(/^---+$/gm, '')                // horizontal rules
                   .replace(/^#+\s/gm, '')                // headings
                   .replace(/\|[^\n]+\|/g, '')          // tables
                   .replace(/\n{3,}/g, '\n\n')          // excess newlines
                   .trim();
      t.messages.push({ role: 'assistant', content: reply });
      await setJSON('agent-thread', t);
      res.json({ reply, mode });
    } catch (e) { console.error('[agent]', e); res.status(500).json({ error: String(e.message || e) }); }
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
