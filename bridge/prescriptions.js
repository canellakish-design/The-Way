// Prescription engine: Energy Bank units; dinner settles the day at TARGET.
// BASE_BURN is shared with fuel-log so the prescription math and the
// Balance can never drift apart. Workout kcal is read from Strava
// automatically (same source the Balance uses); an explicit ride_kcal
// param still overrides it for what-if questions.
const { auth, mealsToday, todaysWorkoutKcal, BASE_BURN } = require('./fuel-log');
const TARGET = -450, PROTEIN_GOAL = 190;
const UNITS = {
  protein: { kcal: 62, pr: 8 }, carb: { kcal: 84, pr: 1.5 },
  fat: { kcal: 119, pr: 0 }, greens: { kcal: 10, pr: 1 }
};
function toUnits(kcal, proteinNeed, carbWeighted) {
  const out = { protein: 0, carb: 0, fat: 0, greens: 2 };
  let k = kcal - 2 * UNITS.greens.kcal;
  out.protein = Math.max(2, Math.min(6, Math.round(proteinNeed * 0.45 / UNITS.protein.pr)));
  k -= out.protein * UNITS.protein.kcal;
  const fatShare = carbWeighted ? 0.20 : 0.35;
  out.fat = Math.max(1, Math.min(3, Math.round(k * fatShare / UNITS.fat.kcal)));
  k -= out.fat * UNITS.fat.kcal;
  out.carb = Math.max(0, Math.round(k / UNITS.carb.kcal));
  return out;
}
async function prescription(meal, rideK) {
  const meals = await mealsToday();
  const intake = meals.reduce((a, m) => a + (m.kcal || 0), 0);
  const protein = meals.reduce((a, m) => a + (m.protein_g || 0), 0);
  const workoutK = (rideK && rideK > 0) ? rideK : await todaysWorkoutKcal();
  const dayBurn = BASE_BURN + workoutK;
  let kcal = (meal === 'dinner')
    ? Math.round((dayBurn + TARGET - intake) / 10) * 10
    : Math.round((dayBurn * 0.62 + TARGET * 0.6 - intake) / 10) * 10;
  kcal = Math.max(300, kcal);
  return { meal, kcal, units: toUnits(kcal, Math.max(0, PROTEIN_GOAL - protein), meal !== 'dinner'),
    protein_so_far: protein,
    workout_kcal_included: workoutK,
    note: meal === 'dinner' ? 'settles the day in the band; leads protein'
                            : 'carb-weighted recovery; returns you to the green path' };
}
function attach(app) {
  app.get('/prescription/:meal', async (req, res) => { if (!auth(req, res)) return;
    res.json(await prescription(req.params.meal, Number(req.query.ride_kcal) || 0)); });
}
module.exports = { attach, prescription };
