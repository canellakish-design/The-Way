// ============================================================
// micro-math.js — micronutrients from the photo journal, as arithmetic. Pure.
//
// The model names the foods and their grams; the numbers come from the
// reference table (nutrients.json, USDA-based, per 100 g). A food the table
// does not know takes its share of the model's own estimate for the plate,
// flagged. Supplements are entries of their own. The score is the average
// over the tracked nutrients of intake against target, capped at 100 each,
// on a three-day rolling average, because a day short on one and long on
// the next is fine and a daily number would swing too much to act on.
// Sodium is a floor, not a cap: a cyclist sweats it out.
// ============================================================
let TABLE = { targets: {}, labels: {}, foods: [], supplements: [] };
try { TABLE = require('./nutrients.json'); } catch (e) { console.error('[micro] nutrients.json unreadable:', e.message); }

const KEYS = Object.keys(TABLE.targets || {});
const r1 = x => Math.round(x * 10) / 10;
const zero = () => Object.fromEntries(KEYS.map(k => [k, 0]));

function findFood(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  // longest matching phrase wins: "sweet potato" over "potato"
  let best = null;
  for (const f of TABLE.foods) for (const m of f.match) {
    if (n.includes(m) && (!best || m.length > best.m.length)) best = { f, m };
  }
  return best ? best.f : null;
}

// ingredients: [{name, grams}]; estimate: the model's whole-plate guess, same keys.
function plateMicros(ingredients, estimate) {
  const out = zero();
  let matchedG = 0, totalG = 0;
  const unknown = [];
  for (const ing of ingredients || []) {
    const g = Number(ing.grams) || 0;
    totalG += g;
    const f = findFood(ing.name);
    if (!f) { unknown.push(ing.name); continue; }
    matchedG += g;
    for (const k of KEYS) out[k] += (Number(f[k]) || 0) * g / 100;
  }
  const unmatchedShare = totalG ? 1 - matchedG / totalG : 1;
  if (estimate && unmatchedShare > 0) for (const k of KEYS) out[k] += (Number(estimate[k]) || 0) * unmatchedShare;
  for (const k of KEYS) out[k] = r1(out[k]);
  return { micros: out, matched_pct: totalG ? Math.round(matchedG / totalG * 100) : 0, unknown };
}

function supplementMicros(key) {
  const s = TABLE.supplements.find(x => x.key === key);
  if (!s) return null;
  const out = zero();
  for (const k of KEYS) out[k] = Number(s[k]) || 0;
  return { key: s.key, name: s.name, note: s.note, micros: out };
}

function sumDays(days) {
  const tot = zero();
  for (const d of days || []) for (const k of KEYS) tot[k] += Number(d && d[k]) || 0;
  return tot;
}

// days: [{...micros}] for today and up to six days before (today first).
// Each nutrient is averaged over its own window: energy-type nutrients
// settle in 3 days, iron, vitamin D, B12, zinc, sodium and omega-3 need 7.
// opts.ride_hours adds sweat sodium to the floor.
function dayScore(days, opts) {
  const o = opts || {};
  const list = (days || []).slice(0, 7);
  const n = Math.max(1, list.length);
  const per = KEYS.map(k => {
    const win = Math.min(n, (TABLE.windows && TABLE.windows[k]) || 3);
    const slice = list.slice(0, win);
    const avg = slice.reduce((s, d) => s + (Number(d && d[k]) || 0), 0) / win;
    let t = TABLE.targets[k];
    if (k === 'sodium_mg') t = Math.round(t + 1000 * (o.ride_hours || 0));
    const pct = Math.min(100, Math.round(avg / t * 100));
    return { key: k, label: TABLE.labels[k] || k, value: r1(avg), target: t, pct, window: win,
      settled: n >= ((TABLE.windows && TABLE.windows[k]) || 3),
      unit: k.endsWith('_mg') ? 'mg' : k.endsWith('_ug') ? 'µg' : 'g' };
  });
  const score = Math.round(per.reduce((s, p) => s + p.pct, 0) / per.length);
  const gaps = per.slice().sort((a, b) => a.pct - b.pct).filter(p => p.pct < 70).slice(0, 3);
  return { score, band: band(score), per, gaps, days_used: n };
}

function band(score) {
  if (score == null) return null;
  if (score >= 80) return { word: 'on target', tone: 'good' };
  if (score >= 60) return { word: 'close', tone: 'warn' };
  return { word: 'low', tone: 'bad' };
}

// What would lift the score most: foods by a typical serving and supplements,
// ranked by score points gained per kcal (supplements are free), filtered by
// the fuel day's carb cap. Iron is gated: only when iron has been low.
const KCAL = { 'white rice, cooked': 260, 'brown rice, cooked': 220, 'oats, cooked': 160, 'potato, baked': 190, 'sweet potato, baked': 135,
  'bread, whole wheat': 150, 'pasta, cooked': 320, 'quinoa, cooked': 220, 'salmon, cooked': 300, 'tuna, canned': 130, 'sardines, canned': 190,
  'anchovies': 60, 'shrimp, cooked': 120, 'chicken breast, cooked': 250, 'chicken thigh, cooked': 270, 'turkey, cooked': 180, 'beef, lean, cooked': 300,
  'pork, lean, cooked': 220, 'egg, whole': 150, 'tofu, firm': 210, 'edamame': 120, 'lentils, cooked': 230, 'black beans, cooked': 200,
  'greek yogurt, nonfat': 100, 'cottage cheese': 180, 'milk, 2%': 120, 'cheese, cheddar': 120, 'whey protein': 120, 'spinach, cooked': 20,
  'kale, cooked': 35, 'broccoli, cooked': 35, 'mixed salad greens': 15, 'carrot': 33, 'bell pepper': 30, 'tomato': 18, 'cucumber': 12, 'kimchi': 15,
  'avocado': 110, 'mushrooms': 18, 'onion': 16, 'nori seaweed': 2, 'banana': 105, 'blueberries': 57, 'orange': 60, 'apple': 95, 'mango': 90,
  'dates and dried fruit': 110, 'almonds': 165, 'chia or flax seeds': 75, 'olive oil': 120, 'soy sauce': 10, 'dark chocolate': 170, 'tailwind or sports drink': 200 };
const CARBS = { 'white rice, cooked': 56, 'brown rice, cooked': 46, 'oats, cooked': 27, 'potato, baked': 42, 'sweet potato, baked': 31, 'bread, whole wheat': 26,
  'pasta, cooked': 62, 'quinoa, cooked': 39, 'banana': 27, 'dates and dried fruit': 30, 'dark chocolate': 13, 'tailwind or sports drink': 50, 'mango': 22, 'apple': 25, 'orange': 15, 'milk, 2%': 12 };

function suggest(days, opts) {
  const o = opts || {};
  const base = dayScore(days, o);
  const carbCap = o.post ? Infinity : o.day === 'rest' ? 15 : o.day === 'normal' ? 30 : Infinity;
  const today = (days && days[0]) || zero();
  const rest = (days || []).slice(1);
  const scoreWith = add => dayScore([Object.fromEntries(KEYS.map(k => [k, (today[k] || 0) + (add[k] || 0)]))].concat(rest), o).score;
  const out = [];
  for (const f of TABLE.foods) {
    const carbs = CARBS[f.name] || 0;
    if (carbs > carbCap) continue;
    const add = {}; for (const k of KEYS) add[k] = (Number(f[k]) || 0) * f.serving_g / 100;
    const gain = scoreWith(add) - base.score;
    if (gain <= 0) continue;
    const kcal = KCAL[f.name] || 100;
    out.push({ kind: 'food', name: f.name, serving_g: f.serving_g, kcal, gain, per_kcal: gain / kcal,
      closes: KEYS.filter(k => add[k] / TABLE.targets[k] >= 0.15).map(k => TABLE.labels[k]).slice(0, 3) });
  }
  for (const s of TABLE.supplements) {
    if (s.gate && !KEYS.every(k => s.gate[k] == null || (base.per.find(p => p.key === k) || {}).pct < s.gate[k])) continue;
    const add = {}; for (const k of KEYS) add[k] = Number(s[k]) || 0;
    const gain = scoreWith(add) - base.score;
    if (gain <= 0) continue;
    out.push({ kind: 'supplement', key: s.key, name: s.name, note: s.note, kcal: 0, gain, per_kcal: gain / 10,
      closes: KEYS.filter(k => add[k] / TABLE.targets[k] >= 0.15).map(k => TABLE.labels[k]).slice(0, 3) });
  }
  out.sort((a, b) => b.gain - a.gain || a.kcal - b.kcal);
  const foods = out.filter(x => x.kind === 'food').slice(0, 3);
  const supps = out.filter(x => x.kind === 'supplement').slice(0, 3);
  return { score: base.score, foods: foods.map(x => ({ ...x, score_after: base.score + x.gain })),
    supplements: supps.map(x => ({ ...x, score_after: base.score + x.gain })),
    performance: TABLE.performance || [] };
}

module.exports = { KEYS, TABLE, findFood, plateMicros, supplementMicros, sumDays, dayScore, band, suggest, zero };
