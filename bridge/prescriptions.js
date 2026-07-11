// Prescription engine: lunch returns you to the green path; dinner settles
// the day at TARGET. Energy Bank units from seed-recipes + built-in units.
const fs = require('fs'); const path = require('path');
const TOKEN = process.env.FUEL_TOKEN || '';
const BASE_BURN = 2050, TARGET = -450, PROTEIN_GOAL = 190;
const UNITS = {
  protein: { kcal: 62,  pr: 8,   label: 'Protein (meatball)' },
  carb:    { kcal: 84,  pr: 1.5, label: 'Carb (rice cake)' },
  fat:     { kcal: 119, pr: 0,   label: 'Fat (tbsp olive oil)' },
  greens:  { kcal: 10,  pr: 1,   label: 'Greens (fist arugula)' }
};

function today(mealsPath){
  try {
    const db = JSON.parse(fs.readFileSync(mealsPath,'utf8'));
    const n = new Date();
    return db.meals.filter(m => {
      const t = new Date(m.logged_at);
      return t.getFullYear()===n.getFullYear() && t.getMonth()===n.getMonth() && t.getDate()===n.getDate();
    });
  } catch { return []; }
}
function ridesKcalToday(){
  // v1: the Edge/Strava path fills this in later; until then callers pass ?ride_kcal
  return 0;
}
function toUnits(kcal, proteinNeed, carbWeighted){
  // protein first (kitchen-realistic caps), fat capped at 3 tbsp,
  // carbs take the remainder — big ride days become big carb days,
  // never a pool of olive oil.
  const out = { protein:0, carb:0, fat:0, greens:2 };
  let k = kcal - 2*UNITS.greens.kcal;
  out.protein = Math.max(2, Math.min(6, Math.round(proteinNeed * 0.45 / UNITS.protein.pr)));
  k -= out.protein * UNITS.protein.kcal;
  const fatShare = carbWeighted ? 0.20 : 0.35;
  out.fat = Math.max(1, Math.min(3, Math.round(k * fatShare / UNITS.fat.kcal)));
  k -= out.fat * UNITS.fat.kcal;
  out.carb = Math.max(0, Math.round(k / UNITS.carb.kcal));
  return out;
}

module.exports = function(app){
  app.get('/prescription/:meal', (req,res)=>{
    if ((req.query.token||'') !== TOKEN) return res.status(401).json({error:'bad token'});
    const meal = req.params.meal; // lunch | dinner
    const rideK = Number(req.query.ride_kcal) || ridesKcalToday();
    const meals = today(path.join(__dirname,'fuel-log.json'));
    const intake = meals.reduce((a,m)=>a+(m.kcal||0),0);
    const protein = meals.reduce((a,m)=>a+(m.protein_g||0),0);
    const dayBurn = BASE_BURN + rideK;
    let kcal;
    if (meal === 'dinner') {
      kcal = Math.round((dayBurn + TARGET - intake)/10)*10;
    } else {
      // lunch: land ~60% of the way to the day's close
      kcal = Math.round((dayBurn*0.62 + TARGET*0.6 - intake)/10)*10;
    }
    kcal = Math.max(300, kcal);
    const units = toUnits(kcal, Math.max(0, PROTEIN_GOAL - protein), meal !== 'dinner');
    res.json({ meal, kcal, units, protein_so_far: protein,
      note: meal==='dinner' ? 'settles the day in the band; leads protein'
                            : 'carb-weighted recovery; returns you to the green path' });
  });
};
