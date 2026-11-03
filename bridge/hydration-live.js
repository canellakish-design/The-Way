// ============================================================
// hydration-live.js — live hydration: his water balance through the day,
// from the drinks and meals he logged, the rides he did or has planned,
// and the weather those rides are in.
//
// The line is millilitres against the morning: zero is first thing, after
// the bathroom, before drinking. It drifts down at the resting loss rate
// (about 100 ml an hour awake: breath, skin and urine; half that asleep),
// jumps up as each drink empties from the stomach (first-order, half-time
// about 15 minutes for water and drinks up to 6% carbohydrate, slower for
// a gel without water), takes food water (what the camera saw, else 0.3 ml
// per kcal), and falls fast during a ride at the sweat rate the weather,
// the airflow and his power give.
//
// Sweat is a heat-balance estimate in the shape of the USARIEM equation
// (Gonzalez 2009): the evaporation the body needs after the air has taken
// what it can, over the skin area, with a floor for the sweating everyone
// does at work. Indoors the fan is the whole story; outdoors the ride's own
// speed is the airflow. Before calibration it is ±0.45 L/h (Jay 2024);
// post-ride weigh-ins tighten it to him (one multiplier, see calibrate).
//
// Bands are the position stands': under 1% of body mass down is fine,
// 1 to 2% costs endurance, over 2% is impaired; and a GAIN over the
// morning after a long ride is the dangerous side (hyponatraemia), drawn
// blue. Water drunk after a ride is kept at 70% unless it carries sodium
// (Tailwind, an electrolyte tab, milk, broth), then 90% (Shirreffs 1996).
// ============================================================
const STEP = 5, T0 = 5 * 60, T1 = 23 * 60 + 55;
const WAKE = 6 * 60, SLEEP = 22 * 60;
const REST_AWAKE_ML_H = 100, REST_ASLEEP_ML_H = 50;
const FOOD_ML_PER_KCAL = 0.3;
const GE = 0.20;                       // gross efficiency: watts out per watt of heat made
const HEIGHT_CM = 180;
const FAN_MS = 1.5, STILL_MS = 0.3, ROAD_MS = 6;
const RETAIN_PLAIN = 0.7, RETAIN_SODIUM = 0.9, POST_RIDE_H = 3;
const SODIUM_RE = /tailwind|electrolyte|nuun|lmnt|skratch|precision|salt|broth|soup|milk|gatorade|pedialyte|coconut water/i;
const GEL_RE = /gel|chew|block/i;
const DEFAULT_KG = 98;
const BOTTLE_ML = 600;
// Alcohol is a net loss of water. Its own water does not stay (the diuresis passes it), and the
// kidneys pass about 10 ml more for every gram of ethanol (Eggleton 1942; Shirreffs & Maughan 1997):
// a 12 oz beer (355 ml, 14 g) leaves the balance about 140 ml lower, a shot the same. "Drank" still
// counts the drink at its poured volume; the balance counts what the body keeps, which is less than
// nothing. The reader logs alcohol with 0 ml, so the volume comes from the kind (US servings).
const ETH_ML_PER_G = 10;
const EVENING_MIN = 20 * 60;          // drinks from here run their diuresis into the night
const NIGHT_DRINK_ML = 100;           // what each evening drink costs the morning beyond its own loss
const BEDTIME_NOTE_MIN = 18 * 60;     // alcohol logged from here earns one note before bed
const SERVINGS = [
  [/\bpints?\b/i, { ml: 473, g: 19, word: 'pint' }],
  [/\b(beer|lager|ale|ipa|stout|porter|pilsner|cider)s?\b/i, { ml: 355, g: 14, word: 'beer' }],
  [/\b(wine|prosecco|champagne|sangria|mimosa|spritz)\b/i, { ml: 150, g: 14, word: 'glass of wine' }],
  [/\b(cocktail|margarita|martini|negroni)s?\b/i, { ml: 150, g: 20, word: 'cocktail' }],
  [/\b(hard seltzer|white claw)\b/i, { ml: 355, g: 14, word: 'seltzer' }],
  [/\b(whisk(e)?y|bourbon|scotch|vodka|gin|rum|tequila|sake|shot of)\b/i, { ml: 44, g: 14, word: 'shot' }]
];
function alcoholServing(name) { for (const [re, v] of SERVINGS) if (re.test(name)) return v; return { ml: 355, g: 14, word: 'drink' }; }
// What a round of n drinks does to the balance: always below zero.
const alcoholNet = (sv, n) => -Math.round(sv.g * n * ETH_ML_PER_G);
const drinkWords = (n, word) => `${['one', 'two', 'three', 'four', 'five', 'six'][n - 1] || n} ${word}${n === 1 ? '' : word.endsWith('wine') ? '' : 's'}`.replace('glass of wines', 'glasses of wine');

const toMin = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };
const toHM = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const say = m => { let h = Math.floor(m / 60); const mm = String(m % 60).padStart(2, '0'); const ap = h < 12 ? 'a' : 'p'; h = h % 12 || 12; return h + ':' + mm + ap; };
const r50 = v => Math.round(v / 50) * 50;
const r10 = v => Math.round(v / 10) * 10;
const L = ml => (Math.round(Math.abs(ml) / 100) / 10).toFixed(1) + ' L';

// Du Bois skin area.
const bsa = kg => 0.007184 * Math.pow(kg, 0.425) * Math.pow(HEIGHT_CM, 0.725);
// Saturated vapour pressure, kPa, at °C (Tetens).
const pSat = c => 0.6108 * Math.exp(17.27 * c / (c + 237.3));

// Sweat, ml per hour, for watts of pedalling in air at tempC, humidity %
// and airflow m/s. The heat balance: metabolic heat less the work done,
// per square metre of skin; dry loss (convection + radiation, ~80% through
// kit) comes off; what is left must evaporate. Evaporation gets less
// efficient as the air's capacity to take it is approached (sweat drips),
// so the required sweat rises faster than the heat.
function sweatRate(watts, kg, env) {
  const e = env || {};
  const tempC = e.temp_c != null ? e.temp_c : 22, rh = e.humidity != null ? e.humidity : 50, v = Math.max(0.2, e.air_ms || STILL_MS);
  const area = bsa(kg > 40 ? kg : DEFAULT_KG);
  const M = Math.max(100, watts) / GE;                     // W of heat made
  const net = (M - Math.max(0, watts)) / area;             // W/m² to lose
  const tsk = 33;
  const hc = 8.3 * Math.pow(v, 0.6), hr = 4.7;
  const dry = (hc + hr) * (tsk - tempC) * 0.8;             // W/m² the air takes without sweat
  const ereq = Math.max(0, net - dry);
  const emax = Math.max(50, 16.5 * hc * (pSat(tsk) - rh / 100 * pSat(tempC)) * 0.35);
  const eff = Math.max(0.5, Math.min(1, 1 - 0.4 * Math.pow(ereq / emax, 2)));
  const gm2h = 150 + 1.48 * ereq / eff;                    // g/m²/h: a floor, plus what must evaporate (2.43 kJ/g)
  return Math.round(gm2h * area / 10) * 10;
}

// A session's watts and airflow. Trainer rides (VirtualRide) are indoors with
// the fan on; road rides carry their own wind; lifting is a warm room.
function sessionEnv(s, ftp, weatherHours) {
  const mins = s.minutes || 60;
  const lift = /lift|weight|strength/i.test(s.name || '') || s.sport === 'WeightTraining';
  const IF = s.tss ? Math.sqrt(s.tss / (mins / 60) / 100) : (/vo2|40\s*\/\s*20|threshold/i.test(s.name || '') ? 0.85 : 0.6);
  const watts = lift ? 60 : Math.min(1.2, Math.max(0.4, IF)) * (ftp || 175);
  const indoor = lift || s.sport === 'VirtualRide' || /zwift|trainer|indoor/i.test(s.name || '');
  // lifting is stop-start in a warm room: a flat 400 ml/h rather than the heat balance
  if (lift) return { watts, indoor: true, temp_c: 22, humidity: 50, air_ms: STILL_MS, fixed_ml_h: 400 };
  if (indoor || !weatherHours || !weatherHours.length) return { watts, indoor: true, temp_c: 22, humidity: 50, air_ms: FAN_MS };
  const start = toMin(s.time) || 9 * 60;
  const hrs = weatherHours.filter(h => h.hour * 60 >= start - 60 && h.hour * 60 <= start + mins);
  const pick = hrs.length ? hrs : weatherHours;
  const avg = k => pick.reduce((a, h) => a + (h[k] || 0), 0) / pick.length;
  const tempF = avg('temp_f');
  return { watts, indoor: false, temp_c: Math.round((tempF - 32) * 5 / 9), humidity: Math.round(avg('humidity')), air_ms: Math.max(ROAD_MS, avg('wind_mph') * 0.447 * 0.5),
    temp_f: Math.round(tempF) };
}

function band(ml, kg) {
  const k = kg > 40 ? kg : DEFAULT_KG;
  if (ml == null) return { key: 'none', word: '', tone: 'neutral' };
  const pct = -ml / (k * 1000) * 100;
  // Above the morning: harmless up to a litre or so (the kidneys clear it in
  // hours); past 1.5 L it is more than the body clears quickly, and drinking
  // far beyond what was lost is the dangerous side after a long day.
  if (ml > 1500) return { key: 'blue', word: 'too much', tone: 'warn' };
  if (ml > 300) return { key: 'green', word: 'topped up', tone: 'good' };
  if (pct < 1) return { key: 'green', word: 'fine', tone: 'good' };
  if (pct < 2) return { key: 'yellow', word: 'behind', tone: 'warn' };
  return { key: 'red', word: 'dry', tone: 'bad' };
}

// o: { entries, sessions, now_min (null = whole day actual), kg, ftp,
//      weather: {hours:[...]} or null, sweat_k (calibration multiplier, 1 = none) }
function model(o) {
  const kg = o.kg > 40 ? o.kg : DEFAULT_KG;
  const now = o.now_min == null ? T1 : o.now_min;
  const k = o.sweat_k > 0 ? Math.max(0.5, Math.min(2, o.sweat_k)) : 1;
  const n = Math.floor((T1 - T0) / STEP) + 1;
  const idx = m => Math.round((m - T0) / STEP);
  const inflow = new Array(n).fill(0), sweat = new Array(n).fill(0), sweatProj = new Array(n).fill(0);
  // the sessions first: where the rides are decides how post-ride drinks are kept
  const sessions = [];
  for (const s of o.sessions || []) {
    const m = toMin(s.time); if (m == null) continue;
    const mins = s.minutes || 60;
    const env = sessionEnv(s, o.ftp, o.weather && o.weather.hours);
    const rate = (env.fixed_ml_h || sweatRate(env.watts, kg, env)) * k;      // ml/h
    const per = rate / 60 * STEP;
    const projected = !s.done && m + mins > now;
    for (let t = m; t < m + mins; t += STEP) { const i = idx(t); if (i >= 0 && i < n) (t > now ? sweatProj : sweat)[i] += per; }
    sessions.push({ name: s.name, time: s.time, min: m, end_min: m + mins, minutes: mins, done: !!s.done, projected,
      sweat_ml_h: Math.round(rate / 50) * 50, loss_ml: Math.round(rate * mins / 60 / 50) * 50, env });
  }
  const afterRide = m => sessions.some(s => m >= s.end_min && m <= s.end_min + POST_RIDE_H * 60);
  const duringRide = m => sessions.some(s => m >= s.min && m < s.end_min);
  const drinks = [];
  const alc = { drinks: 0, net_ml: 0, evening_drinks: 0, evening_net_ml: 0, word: null };
  // water already drunk but still in the stomach at this minute: the balance takes it as it lands
  let landing = 0;
  const pour = (atMin, ml, halfMin, isDrink) => {
    // first-order emptying from the stomach: the fraction still inside halves every halfMin
    const kk = Math.LN2 / halfMin; let left = ml;
    for (let j = 0; j < 72 && left > 0.5; j++) {
      const out = left * (1 - Math.exp(-kk * STEP));
      const i = idx(atMin) + j; if (i >= 0 && i < n) inflow[i] += out;
      if (isDrink && atMin <= now && T0 + (idx(atMin) + j) * STEP > now) landing += out;
      left -= out;
    }
  };
  for (const e of o.entries || []) {
    if (e.supplement || !e.time) continue;
    const m = toMin(e.time); if (m == null) continue;
    const name = String(e.drink || e.name || '');
    const nAlc = e.alcohol > 0 ? e.alcohol : require('./food-math').alcoholOf(e);
    if (nAlc) {
      // the water in it less what the ethanol makes the kidneys pass, spread over the hour after
      const sv = alcoholServing(String(e.name || '') + ' ' + name);
      const vol = e.fluid_ml > 0 ? e.fluid_ml : sv.ml * nAlc;
      const net = alcoholNet(sv, nAlc);
      for (let j = 0; j < 12; j++) { const i = idx(m) + j; if (i >= 0 && i < n) inflow[i] += net / 12; }   // over the hour after
      drinks.push({ id: e.id || null, time: e.time, min: m, ml: Math.round(vol), net_ml: Math.round(net), alcohol: nAlc, name: name || sv.word, word: sv.word, kept: 0, sodium: false });
      alc.drinks += nAlc; alc.net_ml += net; alc.word = alc.word || sv.word;
      if (m >= EVENING_MIN) { alc.evening_drinks += nAlc; alc.evening_net_ml += net; }
      continue;
    }
    let fluid = e.fluid_ml > 0 ? e.fluid_ml : 0;
    const foodWater = !e.drink_only && e.kcal > 0 && !fluid ? e.kcal * FOOD_ML_PER_KCAL : (!e.drink_only && e.kcal > 150 ? Math.max(0, e.kcal - 150) * FOOD_ML_PER_KCAL : 0);
    if (fluid) {
      const sodium = SODIUM_RE.test(name) || e.carbs_g >= 15 && /bottle|drink|mix/i.test(name);
      const keep = afterRide(m) ? (sodium ? RETAIN_SODIUM : RETAIN_PLAIN) : 1;
      const half = GEL_RE.test(name) && fluid < 150 ? 50 : duringRide(m) ? 20 : 15;
      pour(m, fluid * keep, half, true);
      drinks.push({ id: e.id || null, time: e.time, min: m, ml: Math.round(fluid), name: name || 'drink', kept: keep, sodium });
    }
    if (foodWater) pour(m, foodWater, 60);
  }
  // the start: yesterday's end less the night (or the scale's word), never a constant zero
  const start = Number.isFinite(o.start_ml) ? Math.max(-kg * 20, Math.min(300, o.start_ml)) : 0;
  const series = []; let bal = start, balActual = start;
  for (let i = 0; i < n; i++) {
    const t = T0 + i * STEP;
    const rest = (t >= WAKE && t < SLEEP ? REST_AWAKE_ML_H : REST_ASLEEP_ML_H) / 60 * STEP;
    const projected = t > now;
    bal = bal + inflow[i] - rest - sweat[i] - (projected ? sweatProj[i] : 0);
    balActual = balActual + inflow[i] - rest - sweat[i];     // what is logged and ridden, run to the end of the day
    series.push({ t: toHM(t), m: t, ml: Math.round(bal), pct: Math.round(-bal / (kg * 10) * 100) / 100, band: band(bal, kg).key, projected });
  }
  const at = m => series[Math.max(0, Math.min(n - 1, idx(m)))];
  const nowPt = at(now);
  // what each session ahead meets, and what to drink for it
  const upcoming = sessions.filter(s => s.end_min >= now - 10).map(s => {
    const p = at(s.min);
    const needBy = Math.max(now, s.min - 45);
    const deficit = -p.ml;
    const short = deficit > kg * 10 ? r50(deficit - kg * 5) : 0;     // past 1%: bring it back under half a percent
    const bottles = Math.max(1, Math.round(Math.min(900, s.sweat_ml_h) / BOTTLE_ML * 2) / 2);
    const hot = !s.env.indoor && s.env.temp_f >= 80;
    let advice = null;
    if (s.min > now && short >= 200) advice = `${short} ml by ${say(needBy)} for ${s.name.replace(/,.*$/, '')}. Water is fine.`;
    else if (s.min > now && s.loss_ml >= 1200) advice = `${s.name.replace(/,.*$/, '')}: about ${L(s.sweat_ml_h)} an hour${hot ? ' in the heat' : ''}. ${bottles === 1 ? 'A bottle' : bottles + ' bottles'} an hour${s.minutes >= 90 ? ', one of them with salt' : ''}. Weigh in after.`;
    else if (s.min <= now && now < s.end_min) advice = `Riding: about ${L(s.sweat_ml_h)} an hour. ${bottles === 1 ? 'A bottle' : bottles + ' bottles'} an hour.`;
    return { name: s.name, time: s.time, end_min: s.end_min, minutes: s.minutes, done: s.done, sweat_ml_h: s.sweat_ml_h, loss_ml: s.loss_ml,
      indoor: s.env.indoor, temp_f: s.env.temp_f || null, at_start_ml: p.ml, band: band(p.ml, kg), advice };
  });
  // the day's drinking target: what leaves, less what food brings, so the tile can say how much is left
  const restDay = (SLEEP - WAKE) / 60 * REST_AWAKE_ML_H + (24 - (SLEEP - WAKE) / 60) * REST_ASLEEP_ML_H;
  const sweatDay = sessions.reduce((a, s) => a + s.loss_ml, 0);
  const target = r50(Math.max(2000, restDay + sweatDay - 600));
  const drunk = drinks.reduce((a, d) => a + d.ml, 0);
  const nowB = band(nowPt.ml, kg);
  let advice = upcoming.find(s => s.advice) ? upcoming.find(s => s.advice).advice : null;
  if (nowPt.ml > 1500) advice = `${L(nowPt.ml)} ahead of what you have lost: more than the body clears quickly. No more water for now; salt with the next meal.`;
  else if (nowPt.ml > 300) advice = `Topped up: ${L(nowPt.ml)} ahead of this morning. Nothing wrong with that; no need to drink more for now, and salt with the next meal.`;
  else if (!advice && nowB.key === 'red') advice = `${L(-nowPt.ml)} down. ${r50(Math.min(750, -nowPt.ml - kg * 5))} ml now, the rest over the next two hours, with salt if a ride is behind it.`;
  else if (!advice && nowB.key === 'yellow') advice = `${L(-nowPt.ml)} down. A bottle in the next hour.`;
  else if (!advice && o.now_min != null && now >= 20 * 60 && nowPt.ml < -kg * 5) advice = `${r50(-nowPt.ml - kg * 3)} ml before bed.`;
  // the morning after: the night's drinks named, the start explained, water first
  if (o.night && o.night.drinks > 0 && now < 11 * 60 && start <= -300 && (!advice || nowB.key !== 'green'))
    advice = `${drinkWords(o.night.drinks, o.night.word || 'drink')} last night: starting ${L(-start)} down. ${r50(Math.min(750, -start))} ml of water before the coffee, the rest through the morning.`;
  if (o.weigh && o.weigh.lost_ml > 0 && now - (o.weigh.end_min || 0) < 4 * 60) advice = `The scale says ${L(o.weigh.lost_ml)} lost on the ride. ${L(o.weigh.lost_ml * 1.3)} over the next three hours, with salt, not all at once.`;
  return { series, now: { time: toHM(now), ml: nowPt.ml, pct: nowPt.pct, band: nowB, landing_ml: o.now_min == null ? 0 : r10(landing) }, sessions: upcoming, drinks,
    drunk_ml: drunk, target_ml: target, left_ml: Math.max(0, target - drunk), end_ml: Math.round(balActual), start_ml: Math.round(start), kg, sweat_k: k, step: STEP,
    weather_used: !!(o.weather && o.weather.hours && sessions.some(s => !s.env.indoor)),
    alcohol: alc.drinks ? { drinks: alc.drinks, net_ml: Math.round(alc.net_ml), evening_drinks: alc.evening_drinks, evening_net_ml: Math.round(alc.evening_net_ml), word: alc.word } : null,
    score: Math.max(0, Math.min(100, Math.round(100 - Math.max(0, -nowPt.ml) / (kg * 20) * 100))),   // 100 at the morning, 0 at 2% down
    advice,
    // one line each, for the pages to print as they are
    bedtime_note: o.now_min == null ? null : bedtimeNote(drinks),
    landing_note: o.now_min == null ? null : landingNote(landing),
    drank_counts: DRANK_COUNTS };
}

const DRANK_COUNTS = 'Drank is every drink on the list at the volume poured, alcohol included; the balance is what the body keeps, and alcohol keeps less than nothing.';
// One note before bed when alcohol was logged from 6 p.m.: what it cost and the water to drink.
function bedtimeNote(drinks) {
  const eve = (drinks || []).filter(d => d.alcohol > 0 && d.min >= BEDTIME_NOTE_MIN);
  if (!eve.length) return null;
  const nAlc = eve.reduce((a, d) => a + d.alcohol, 0), net = eve.reduce((a, d) => a + (d.net_ml || 0), 0);
  const night = NIGHT_DRINK_ML * nAlc;
  const water = r50(Math.min(750, Math.max(250, -net + night)));
  const w = drinkWords(nAlc, eve[0].word || 'drink');
  return `${w.charAt(0).toUpperCase() + w.slice(1)} this evening: about ${Math.abs(Math.round(net))} ml down on the balance, and the night takes about ${night} ml more. ${water} ml of water before bed.`;
}
// A drink just logged moves the balance as it leaves the stomach, not all at once.
function landingNote(ml) {
  const v = r10(ml);
  return v >= 50 ? `${v} ml of what you just drank is still in the stomach: the balance takes it in as it lands, most of it within 45 minutes.` : null;
}

// Tomorrow's start from tonight's end: the night between the model's last
// step (11:55 p) and its first (5 a) costs about 250 ml. A deficit carried
// to bed is still there in the morning; a surplus is passed as urine, so a
// gain never carries. When the scale has this morning's reading and a
// three-day baseline, the two are averaged: the scale sees the whole body,
// the model only what was logged.
const NIGHT_ML = 5 * REST_ASLEEP_ML_H;
// Evening alcohol: its net loss is already in the day's end, and the diuresis runs on for hours
// after the last one, so each drink after 8 p.m. costs the morning about 100 ml more. The morning
// after four pints starts further down than the day's end suggests, which is what the body does.
function carryOver(prevEndMl, scale, prevAlc) {
  const night = prevAlc && prevAlc.evening_drinks > 0 ? { drinks: prevAlc.evening_drinks, word: prevAlc.word || 'drink', drain_ml: Math.round(Math.max(0, prevAlc.evening_net_ml) + NIGHT_DRINK_ML * prevAlc.evening_drinks) } : null;
  const base = prevEndMl == null ? null : prevEndMl - (night ? night.drain_ml : 0);
  // capped at 1.5 L: a drink that went unlogged must not compound into a permanent red
  let carry = base == null ? null : Math.max(-1500, Math.min(0, base - NIGHT_ML));
  const out = r => night ? Object.assign(r, { night }) : r;
  if (carry == null && !scale) return out({ start_ml: 0, from: 'none' });
  if (scale && scale.today_kg > 40 && scale.baseline_kg > 40) {
    const fromScale = Math.min(0, Math.max(-3000, (scale.today_kg - scale.baseline_kg) * 1000));
    if (carry == null) return out({ start_ml: Math.round(fromScale), from: 'scale' });
    return out({ start_ml: Math.round((carry + fromScale) / 2), from: 'both', carried_ml: Math.round(carry), scale_ml: Math.round(fromScale) });
  }
  return out({ start_ml: Math.round(carry), from: 'yesterday' });
}

// A post-ride weigh-in against the morning one: measured sweat = weight lost
// + what was drunk on the ride, less 10% for breath and metabolic water on
// long rides. Against what the model said, that is one calibration point.
// points: [{measured_ml, modelled_ml}] → the multiplier to use (1 until three).
function calibrate(points) {
  const ok = (points || []).filter(p => p.measured_ml > 100 && p.modelled_ml > 100);
  if (ok.length < 3) return { k: 1, points: ok.length };
  const ratios = ok.map(p => p.measured_ml / p.modelled_ml).sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  // three to four points pull halfway; five and more count in full
  const w = Math.min(1, (ok.length - 2) / 3);
  return { k: Math.round((1 + (med - 1) * w) * 100) / 100, points: ok.length };
}
function measured(preKg, postKg, drankMl, minutes) {
  if (!(preKg > 40 && postKg > 40)) return null;
  const lost = (preKg - postKg) * 1000 + (drankMl || 0);
  return Math.round(lost * (minutes >= 120 ? 0.9 : 0.95));
}

module.exports = { model, sweatRate, sessionEnv, band, calibrate, measured, carryOver, alcoholServing, alcoholNet, bedtimeNote, landingNote, DRANK_COUNTS, toMin, toHM, STEP, BOTTLE_ML, NIGHT_ML };
