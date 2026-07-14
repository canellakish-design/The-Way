// Kitchen vision: photo of food -> Claude vision -> macro/micronutrient proposal.
// Does NOT write to the ledger — returns a proposal for the Day tab to pre-fill,
// then the existing POST /meals path (fuel-log.js) does the actual write.
// Env: ANTHROPIC_API_KEY (same key agent.js already uses)
const { auth } = require('./fuel-log');
const MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-6';

const PROMPT = `You are looking at a photo of food, possibly on a kitchen scale.
Identify the food and estimate a full nutrition breakdown for the portion shown.
If a scale display is visible in the photo, read the exact weight and use it to
scale your estimate; otherwise estimate portion size visually.{{NOTES}}
Respond with ONLY raw JSON, no markdown fences, no preamble, in this exact shape:
{"food_name":"...","meal_guess":"breakfast|lunch|dinner|snack","weight_g":number|null,
"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,
"micronutrients":{"fiber_g":number,"sodium_mg":number,"iron_mg":number,"vitamin_c_mg":number},
"confidence":"high|medium|low","notes":"one short sentence on any uncertainty"}`;

async function analyze(images, userNotes) {
  const prompt = PROMPT.replace('{{NOTES}}', userNotes
    ? `\nThe person logging this meal added this note — treat it as authoritative over what you can see: "${userNotes}"`
    : '');
  const content = images.map(img => ({ type: 'image',
    source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.image_base64 } }));
  content.push({ type: 'text', text: prompt });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content }]
    })
  });
  const j = await r.json();
  const block = (j.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no response from vision model: ' + JSON.stringify(j).slice(0, 200));
  const cleaned = block.text.replace(/```json|```/g, '').trim();
  let proposal;
  try { proposal = JSON.parse(cleaned); }
  catch { throw new Error('vision response was not valid JSON: ' + cleaned.slice(0, 200)); }
  return proposal;
}

function attach(app) {
  app.post('/kitchen/log', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const { images, user_notes } = req.body || {};
      if (!images || !images.length) return res.status(400).json({ ok: false, error: 'missing images' });
      const proposal = await analyze(images, user_notes);
      res.json({ ok: true, proposal });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = { attach };
