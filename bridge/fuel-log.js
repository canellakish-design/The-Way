// ============================================================
// fuel-log.js — replaces morning-fuel.js in strava-bridge.js
// Wire in with:  require('./fuel-log')(app);
// Env: FUEL_TOKEN (shared secret, also entered in the Edge field settings)
//
// The bridge is the single source of truth for daily fuel state.
// Kitchen tablet logs every meal (photo analysis auto-posts here);
// the Edge 530 asks one question at ride start: GET /fuel-state.
// ============================================================
const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, 'fuel-log.json');
const SEEDS = path.join(__dirname, 'seed-recipes.json');
const BASE_BURN = 2050; // kcal/day baseline, prorated by minute (estimate)
function ballCarbs() {
  try {
    const r = JSON.parse(fs.readFileSync(SEEDS, 'utf8')).recipes
      .find(x => x.role === 'ride_fuel_unit');
    return r ? r.perUnit.carbs_g : 19;
  } catch { return 19; }
}
const TOKEN = process.env.FUEL_TOKEN || '';

// Digestion model: a meal's carbs become "available" quickly, then
// decay linearly to zero over DECAY_HOURS as they're absorbed/stored.
const DECAY_HOURS = 4;
// No meals in this many hours => fasted state for the substrate model.
const FASTED_HOURS = 10;

function load() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
  catch { return { meals: [] }; }
}
function save(db) { fs.writeFileSync(LOG_PATH, JSON.stringify(db, null, 2)); }

function hoursSince(iso) { return (Date.now() - new Date(iso).getTime()) / 3.6e6; }
function isToday(iso) {
  const t = new Date(iso), n = new Date();
  return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth()
      && t.getDate() === n.getDate();
}

// Effective carbs on board right now
function fuelState(db) {
  const recent = db.meals.filter(m => hoursSince(m.logged_at) < DECAY_HOURS);
  let carbs = 0;
  for (const m of recent) {
    const h = hoursSince(m.logged_at);
    carbs += (m.carbs_g || 0) * Math.max(0, 1 - h / DECAY_HOURS);
  }
  const todays = db.meals.filter(m => isToday(m.logged_at));
  const lastMeal = db.meals.length
    ? db.meals[db.meals.length - 1].logged_at : null;
  const hSince = lastMeal ? hoursSince(lastMeal) : 999;
  return {
    carbs_g: Math.round(carbs),
    hours_since_meal: Math.round(hSince * 10) / 10,
    fasted: hSince >= FASTED_HOURS,
    meals_today: todays.length,
    // v1 balance: today's intake minus prorated baseline. Ride kcal joins
    // this once the Strava webhook lands; until then the Edge adds its own
    // live ride burn on top.
    balance_kcal: Math.round(
      todays.reduce((a, m) => a + (m.kcal || 0), 0)
      - BASE_BURN * (Date.now() - new Date().setHours(0,0,0,0)) / 86400000),
    ball_carbs_g: ballCarbs(),
    fresh: true, // computed live, always fresh by construction
  };
}

function requireToken(req, res, next) {
  const supplied = req.query.token || req.get('x-fuel-token') || '';
  if (!TOKEN || supplied !== TOKEN) {
    return res.status(401).json({ ok: false, error: 'bad token' });
  }
  next();
}

module.exports = function attach(app) {
  // Kitchen tablet posts every meal here (auto-called after photo analysis).
  // Body: { name, meal: 'breakfast'|'lunch'|'dinner'|'snack',
  //         carbs_g, protein_g, fat_g, kcal }
  app.post('/meals', requireToken, (req, res) => {
    const db = load();
    const m = {
      name: String(req.body.name || 'meal'),
      meal: String(req.body.meal || 'snack'),
      carbs_g: Number(req.body.carbs_g) || 0,
      protein_g: Number(req.body.protein_g) || 0,
      fat_g: Number(req.body.fat_g) || 0,
      kcal: Number(req.body.kcal) || 0,
      logged_at: new Date().toISOString(),
    };
    db.meals.push(m);
    // keep 7 days of history
    db.meals = db.meals.filter(x => hoursSince(x.logged_at) < 168);
    save(db);
    console.log('[fuel-log] meal:', m.meal, m.name, m.carbs_g + 'g carbs');
    res.json({ ok: true, meal: m, state: fuelState(db) });
  });

  // Edge 530 fetches this at ride start.
  app.get('/fuel-state', requireToken, (req, res) => {
    res.json(fuelState(load()));
  });

  // Today's log, for the kitchen dashboard's daily view / kcal budget.
  app.get('/meals/today', requireToken, (req, res) => {
    const db = load();
    res.json({ meals: db.meals.filter(m => isToday(m.logged_at)) });
  });

  // Undo a mis-logged meal.
  app.delete('/meals/last', requireToken, (req, res) => {
    const db = load();
    const removed = db.meals.pop();
    save(db);
    res.json({ ok: true, removed, state: fuelState(db) });
  });
};

/* ------------------------------------------------------------
Kitchen dashboard integration (Coach Tadej Fuel):

Hook this into the END of your existing photo-analysis flow — the
moment Claude's vision API returns estimated macros, log the meal.
Logging a meal = taking a picture.

async function logMeal(name, mealType, macros) {
  const r = await fetch(BRIDGE_URL + '/meals?token=' + FUEL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name, meal: mealType,
      carbs_g: macros.carbs, protein_g: macros.protein,
      fat_g: macros.fat, kcal: macros.kcal,
    }),
  });
  if (!r.ok) throw new Error('meal log failed: ' + r.status);
  const data = await r.json();
  // show carbs-on-board in the dashboard UI so failures are visible
  return data.state;
}

// after photo analysis resolves:
//   const state = await logMeal(analysis.name, guessMealType(), analysis.macros);
//   renderFuelState(state);   // e.g. "On board: 62g carbs"
------------------------------------------------------------ */
