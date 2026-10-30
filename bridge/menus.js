// ============================================================
// menus.js — chain menus with published nutrition, and what to order.
//
// menus.json holds the menus (approximate published values; the chain's
// own app has the exact figure). A place from the map matches a brand by
// name. For a brand, choose() ranks the orders against what the plan wants
// next: the slot's calories, its protein, its carbs (a cap on a low-carb
// slot, a target otherwise), and the day's rules (nothing fried or sweet
// when it can be helped). A main may take a side or a drink with it. What
// he has actually ordered at a brand is remembered (the journal entry's
// place) and comes first next time.
//   brandFor(place) → brand | null
//   choose(brand, need, remembered) → [{ name, items, kcal, carbs_g, protein_g, fat_g, fits, why }]
// ============================================================
const { getJSON, setJSON } = require('./storage');
let DB = { brands: [] };
try { DB = require('./menus.json'); } catch (e) { console.error('[menus] menus.json unreadable:', e.message); }

const norm = s => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function brandFor(place) {
  if (!place) return null;
  const hay = [place.brand, place.name].filter(Boolean).map(norm);
  for (const b of DB.brands) for (const n of b.names) {
    const nn = norm(n);
    if (hay.some(h => h === nn || h.startsWith(nn + ' ') || h.includes(' ' + nn + ' ') || h.endsWith(' ' + nn) || (nn.length >= 5 && h.includes(nn)))) return b;
  }
  return null;
}

const sum = (items, k) => items.reduce((a, i) => a + (i[k] || 0), 0);
function describe(items) {
  return { kcal: sum(items, 'kcal'), carbs_g: sum(items, 'carbs_g'), protein_g: sum(items, 'protein_g'), fat_g: sum(items, 'fat_g'), sodium_mg: sum(items, 'sodium_mg') };
}
// How far an order sits from what the slot wants. Lower is better.
function distance(items, need) {
  const d = describe(items);
  const kcal = need.kcal || 500, prot = need.protein_g || 30;
  let e = Math.abs(d.kcal - kcal) / kcal;
  e += 1.5 * Math.max(0, prot - d.protein_g) / prot;                                  // protein short costs more than protein over
  if (need.low_carb) e += 2 * Math.max(0, d.carbs_g - (need.carbs_g || 20)) / Math.max(20, need.carbs_g || 20);
  else if (need.carbs_g) e += 0.7 * Math.abs(d.carbs_g - need.carbs_g) / need.carbs_g;
  if (items.some(i => (i.tags || []).includes('fried'))) e += 0.3;
  if (items.some(i => (i.tags || []).includes('sweet'))) e += 0.2;
  if (d.sodium_mg > 2000) e += 0.15;
  return Math.round(e * 1000) / 1000;
}
function why(items, need) {
  const d = describe(items);
  const bits = [];
  const kcal = need.kcal || 500;
  bits.push(Math.abs(d.kcal - kcal) / kcal <= 0.15 ? 'calories on the slot' : d.kcal > kcal ? `${d.kcal - kcal} kcal over the slot` : `${kcal - d.kcal} kcal under the slot`);
  if (need.protein_g) bits.push(d.protein_g >= need.protein_g ? 'protein covered' : `protein ${need.protein_g - d.protein_g} g short`);
  if (need.low_carb) bits.push(d.carbs_g <= (need.carbs_g || 20) ? 'under the carb cap' : `${d.carbs_g - (need.carbs_g || 20)} g over the carb cap`);
  else if (need.carbs_g) bits.push(Math.abs(d.carbs_g - need.carbs_g) / need.carbs_g <= 0.25 ? 'carbs about right' : d.carbs_g > need.carbs_g ? 'carbs heavy' : 'carbs light');
  if (items.some(i => (i.tags || []).includes('fried'))) bits.push('fried');
  return bits.join(', ');
}
function fitsOf(e) { return e <= 0.35 ? 'yes' : e <= 0.8 ? 'partly' : 'no'; }

// need: { kcal, carbs_g, protein_g, low_carb, slot }; remembered: [{name, count}] for this brand
function choose(brand, need, remembered) {
  if (!brand) return [];
  const n = need || { kcal: 500, protein_g: 30 };
  const items = brand.items || [];
  const isDrink = i => (i.tags || []).includes('drink'), isSide = i => (i.tags || []).includes('side');
  const mains = items.filter(i => !isDrink(i) && !isSide(i));
  const extras = items.filter(i => isDrink(i) || isSide(i));
  const cands = [];
  for (const m of mains) cands.push([m]);
  for (const m of mains) for (const x of extras) cands.push([m, x]);
  // on the bike or a snack slot, a drink or a side alone is a fair order
  if (/bike|snack|before/.test(n.slot || '')) for (const x of extras) cands.push([x]);
  const rem = new Map((remembered || []).map(r => [norm(r.name), r.count || 1]));
  const scored = cands.map(items => {
    let e = distance(items, n);
    const yours = items.some(i => rem.has(norm(i.name)));
    if (yours) e -= 0.15;                                          // what he actually orders there, when it is close
    return { items, e, yours };
  }).sort((a, b) => a.e - b.e);
  const out = []; const seen = new Set();
  for (const s of scored) {
    const key = s.items.map(i => i.name).join(' + ');
    if (seen.has(key)) continue; seen.add(key);
    const d = describe(s.items);
    out.push({ name: key, items: s.items.map(i => i.name), kcal: d.kcal, carbs_g: d.carbs_g, protein_g: d.protein_g, fat_g: d.fat_g, sodium_mg: d.sodium_mg,
      fits: fitsOf(s.e), why: why(s.items, n) + (s.yours ? '; your usual here' : ''), yours: s.yours, distance: s.e });
    if (out.length >= 3) break;
  }
  return out;
}

// What he has ordered where: one small store, by brand.
async function remembered(brandKey) {
  const d = await getJSON('orders', { brands: {} });
  return (d.brands[brandKey] || []).sort((a, b) => b.count - a.count).slice(0, 8);
}
async function remember(brandKey, item) {
  if (!brandKey || !item || !item.name) return;
  const d = await getJSON('orders', { brands: {} });
  const list = d.brands[brandKey] = d.brands[brandKey] || [];
  const hit = list.find(x => norm(x.name) === norm(item.name));
  if (hit) { hit.count = (hit.count || 1) + 1; hit.last = new Date().toISOString(); Object.assign(hit, { kcal: item.kcal, carbs_g: item.carbs_g, protein_g: item.protein_g, fat_g: item.fat_g }); }
  else list.push({ name: item.name, kcal: item.kcal, carbs_g: item.carbs_g, protein_g: item.protein_g, fat_g: item.fat_g, count: 1, last: new Date().toISOString() });
  d.brands[brandKey] = list.slice(-20);
  await setJSON('orders', d);
}

function brands() { return DB.brands.map(b => ({ key: b.key, name: b.names[0], items: b.items.length })); }

module.exports = { brandFor, choose, describe, distance, remembered, remember, brands, norm };
