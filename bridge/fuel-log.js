// Fuel ledger: meals in, fuel-state out. Exports functions for the agent.
const { getJSON, setJSON } = require('./storage');
const TOKEN = process.env.FUEL_TOKEN || '';
const BASE_BURN = 2050;
const DECAY_HOURS = 4, FASTED_HOURS = 10;

const hoursSince = iso => (Date.now() - new Date(iso).getTime()) / 3.6e6;
const isToday = iso => new Date(iso).toDateString() === new Date().toDateString();

async function db() { return getJSON('fuel-log', { meals: [] }); }

async function ballCarbs() {
  const seeds = await getJSON('seed-recipes', null);
  if (seeds) {
    const r = (seeds.recipes || []).find(x => x.role === 'ride_fuel_unit');
    if (r) return r.perUnit.carbs_g;
  }
  return 19.4; // Spicy Anchovy Rice Balls v1
}

async function fuelState() {
  const d = await db();
  const recent = d.meals.filter(m => hoursSince(m.logged_at) < DECAY_HOURS);
  let carbs = 0;
  for (const m of recent) carbs += (m.carbs_g || 0) * Math.max(0, 1 - hoursSince(m.logged_at) / DECAY_HOURS);
  const todays = d.meals.filter(m => isToday(m.logged_at));
  const last = d.meals.length ? d.meals[d.meals.length - 1].logged_at : null;
  const hSince = last ? hoursSince(last) : 999;
  return {
    carbs_g: Math.round(carbs),
    hours_since_meal: Math.round(hSince * 10) / 10,
    fasted: hSince >= FASTED_HOURS,
    meals_today: todays.length,
    balance_kcal: Math.round(todays.reduce((a, m) => a + (m.kcal || 0), 0)
      - BASE_BURN * (Date.now() - new Date().setHours(0, 0, 0, 0)) / 864e5),
    ball_carbs_g: await ballCarbs(),
    fresh: true
  };
}
async function mealsToday() {
  const d = await db();
  return d.meals.filter(m => isToday(m.logged_at));
}
async function logMeal(body) {
  const d = await db();
  const m = {
    name: String(body.name || 'meal'), meal: String(body.meal || 'snack'),
    carbs_g: Number(body.carbs_g) || 0, protein_g: Number(body.protein_g) || 0,
    fat_g: Number(body.fat_g) || 0, kcal: Number(body.kcal) || 0,
    logged_at: new Date().toISOString()
  };
  d.meals.push(m);
  d.meals = d.meals.filter(x => hoursSince(x.logged_at) < 168);
  await setJSON('fuel-log', d);
  return { ok: true, meal: m, state: await fuelState() };
}

function auth(req, res) {
  if ((req.query.token || req.get('x-fuel-token') || '') !== TOKEN || !TOKEN) {
    res.status(401).json({ ok: false, error: 'bad token' }); return false;
  }
  return true;
}

function attach(app) {
  app.post('/meals', async (req, res) => { if (!auth(req, res)) return;
    res.json(await logMeal(req.body || {})); });
  app.get('/meals/today', async (req, res) => { if (!auth(req, res)) return;
    res.json({ meals: await mealsToday() }); });
  app.delete('/meals/last', async (req, res) => { if (!auth(req, res)) return;
    const d = await db(); const removed = d.meals.pop();
    await setJSON('fuel-log', d);
    res.json({ ok: true, removed, state: await fuelState() }); });
  app.get('/fuel-state', async (req, res) => { if (!auth(req, res)) return;
    res.json(await fuelState()); });
}
module.exports = { attach, fuelState, mealsToday, logMeal, auth };
