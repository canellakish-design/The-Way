// Batch prep: 3 fixed slots. Ingredients added one-by-one (cumulative scale
// weight, vision reads the delta and estimates macros for it). Once built,
// one scoop is weighed and calibrated per batch; every scoop after that
// reuses that weight. Logging a scoop still writes through fuel-log's
// logMeal() — this module only computes what to send there.
// Env: ANTHROPIC_API_KEY (shared with kitchen.js / agent.js)
const { getJSON, setJSON } = require('./storage');
const { auth, logMeal } = require('./fuel-log');
const MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-6';
const SLOTS = [1, 2, 3];

function emptyBatch(slot) {
  return { slot, status: 'building', ingredients: [], total_g: 0,
    totals: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
    last_reading_g: 0, scoop_g: null, remaining_g: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}
async function db() {
  return getJSON('batches', { 1: emptyBatch(1), 2: emptyBatch(2), 3: emptyBatch(3) });
}
function checkSlot(slot) {
  const n = parseInt(slot, 10);
  if (!SLOTS.includes(n)) throw new Error('slot must be 1, 2, or 3');
  return n;
}

async function callVision(prompt, images) {
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
      model: MODEL, max_tokens: 500,
      messages: [{ role: 'user', content }]
    })
  });
  const j = await r.json();
  const block = (j.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no response from vision model: ' + JSON.stringify(j).slice(0, 200));
  const cleaned = block.text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('vision response was not valid JSON: ' + cleaned.slice(0, 200)); }
}

// Multiple photos of the SAME addition (e.g. one clear shot of the scale
// display, one of the food itself) — improves both weight-reading and
// ingredient-identification accuracy over a single photo.
async function readIngredientAddition(images, previous_total_g, userNotes) {
  const prompt = `These ${images.length} photo(s) all show the SAME moment: a bowl
of food on a kitchen scale, mid-batch-prep, immediately after one ingredient was
added. Use whichever photo most clearly shows the scale display to read the
weight, and whichever most clearly shows the food to identify the ingredient —
they are different angles of the same addition, not different additions.
The scale previously read ${previous_total_g}g before this addition. Read the
CURRENT total weight shown on the scale display. Identify the ingredient that
was just added (the newest, top-most one). Estimate nutrition for ONLY the
delta weight (current minus ${previous_total_g}g) of that ingredient — not the
whole bowl.${userNotes ? `\nThe person logging this added this note — treat it as authoritative over what you can see: "${userNotes}"` : ''}
Respond with ONLY raw JSON, no markdown fences, no preamble:
{"current_total_g":number,"ingredient_name":"...","delta_g":number,
"kcal":number,"protein_g":number,"carbs_g":number,"fat_g":number,
"confidence":"high|medium|low","notes":"one short sentence on any uncertainty"}`;
  return callVision(prompt, images);
}

// Multiple photos of the same scoop calibration (e.g. scale display + scoop itself).
async function readScoopWeight(images, userNotes) {
  const prompt = `These ${images.length} photo(s) all show the SAME moment: one
scoop of prepared food on a kitchen scale, used to calibrate portion size for a
batch. Use whichever photo most clearly shows the scale display. Read the exact
weight shown.${userNotes ? `\nThe person logging this added this note — treat it as authoritative over what you can see: "${userNotes}"` : ''}
Respond with ONLY raw JSON, no markdown fences, no preamble:
{"scoop_g":number,"confidence":"high|medium|low","notes":"one short sentence on any uncertainty"}`;
  return callVision(prompt, images);
}

function scoopMacros(batch) {
  const frac = batch.scoop_g / batch.total_g;
  return {
    kcal: Math.round(batch.totals.kcal * frac),
    protein_g: Math.round(batch.totals.protein_g * frac * 10) / 10,
    carbs_g: Math.round(batch.totals.carbs_g * frac * 10) / 10,
    fat_g: Math.round(batch.totals.fat_g * frac * 10) / 10
  };
}

function attach(app) {
  app.get('/batch/:slot', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const slot = checkSlot(req.params.slot);
      const d = await db();
      const b = d[slot];
      res.json({ ok: true, batch: b, scoops_remaining: b.scoop_g ? Math.floor(b.remaining_g / b.scoop_g) : null });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });

  app.get('/batches', async (req, res) => {
    if (!auth(req, res)) return;
    const d = await db();
    res.json({ ok: true, batches: SLOTS.map(s => ({ ...d[s],
      scoops_remaining: d[s].scoop_g ? Math.floor(d[s].remaining_g / d[s].scoop_g) : null })) });
  });

  // Add one ingredient to a batch — multiple photos of the same addition
  // (e.g. scale display + food close-up) improve read accuracy.
  app.post('/batch/:slot/ingredient', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const slot = checkSlot(req.params.slot);
      const { images, user_notes } = req.body || {};
      if (!images || !images.length) return res.status(400).json({ ok: false, error: 'missing images' });
      const d = await db();
      const b = d[slot];
      const read = await readIngredientAddition(images, b.last_reading_g, user_notes);
      const delta = Math.round(read.delta_g);
      b.ingredients.push({
        name: read.ingredient_name, added_g: delta,
        kcal: read.kcal, protein_g: read.protein_g, carbs_g: read.carbs_g, fat_g: read.fat_g,
        confidence: read.confidence, notes: read.notes, at: new Date().toISOString()
      });
      b.total_g = read.current_total_g;
      b.last_reading_g = read.current_total_g;
      b.totals.kcal += read.kcal; b.totals.protein_g += read.protein_g;
      b.totals.carbs_g += read.carbs_g; b.totals.fat_g += read.fat_g;
      b.updated_at = new Date().toISOString();
      await setJSON('batches', d);
      res.json({ ok: true, added: b.ingredients[b.ingredients.length - 1], batch: b });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Calibrate scoop size — multiple photos of the same weigh-in, logs it as
  // the first meal from this batch.
  app.post('/batch/:slot/scoop-calibrate', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const slot = checkSlot(req.params.slot);
      const { images, meal, user_notes } = req.body || {};
      if (!images || !images.length) return res.status(400).json({ ok: false, error: 'missing images' });
      const d = await db();
      const b = d[slot];
      if (!b.total_g) return res.status(400).json({ ok: false, error: 'batch has no ingredients yet' });
      const read = await readScoopWeight(images, user_notes);
      b.scoop_g = Math.round(read.scoop_g);
      b.remaining_g = b.total_g - b.scoop_g;
      b.status = 'active';
      b.updated_at = new Date().toISOString();
      await setJSON('batches', d);
      const macros = scoopMacros(b);
      const logged = await logMeal({ name: `Batch ${slot} scoop`, meal: meal || 'lunch', ...macros });
      res.json({ ok: true, batch: b, scoop_confidence: read.confidence, notes: read.notes, logged });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Log one more scoop from an already-calibrated batch — no photo needed.
  app.post('/batch/:slot/scoop', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const slot = checkSlot(req.params.slot);
      const { meal } = req.body || {};
      const d = await db();
      const b = d[slot];
      if (!b.scoop_g) return res.status(400).json({ ok: false, error: 'batch not calibrated yet — use /scoop-calibrate first' });
      if (b.remaining_g < b.scoop_g) return res.status(400).json({ ok: false, error: 'not enough left in this batch for a full scoop' });
      const macros = scoopMacros(b);
      b.remaining_g -= b.scoop_g;
      if (b.remaining_g < b.scoop_g) b.status = 'low';
      b.updated_at = new Date().toISOString();
      await setJSON('batches', d);
      const logged = await logMeal({ name: `Batch ${slot} scoop`, meal: meal || 'lunch', ...macros });
      res.json({ ok: true, batch: b, logged });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Retire a batch and start fresh in the same slot.
  app.post('/batch/:slot/reset', async (req, res) => {
    if (!auth(req, res)) return;
    try {
      const slot = checkSlot(req.params.slot);
      const d = await db();
      d[slot] = emptyBatch(slot);
      await setJSON('batches', d);
      res.json({ ok: true, batch: d[slot] });
    } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
  });
}

module.exports = { attach };
