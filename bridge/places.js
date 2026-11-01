// ============================================================
// places.js — his own places: the burrito shop, the deli by the pitch, the
// café on the long loop. Saved with where they are and what to order there,
// so when he is near one the app says so and names the order, before the
// map and the menus get a say.
//
//   GET    /food/places?lat&lon        all of them, nearest first when a position is given
//   POST   /food/places                { name, lat, lon, kind?, notes?, orders?: [{name, kcal?, carbs_g?, protein_g?, fat_g?, why?}] }
//   POST   /food/places/:id/order      { name, kcal?, carbs_g?, protein_g?, fat_g?, why? }  add an order to a place
//   DELETE /food/places/:id
//
// near(lat, lon) is what /food/nearby and the advisor read: saved places within
// NEAR_M, nearest first, each with dist_m and its orders graded against what
// the plan wants next.
// ============================================================
const crypto = require('crypto');
const { getJSON, setJSON } = require('./storage');

const NEAR_M = 350;              // "you are at": a short walk
const SAME_M = 150;              // the same name this close is the same place, updated not duplicated

function dist(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
const cleanOrder = o => o && String(o.name || '').trim() ? {
  name: String(o.name).trim().slice(0, 80), kcal: Number(o.kcal) || null, carbs_g: Number(o.carbs_g) || null, protein_g: Number(o.protein_g) || null, fat_g: Number(o.fat_g) || null,
  why: String(o.why || '').slice(0, 160) || null, added: new Date().toISOString() } : null;

async function db() { return getJSON('places', { places: [] }); }
async function list() { return (await db()).places; }

async function add(b) {
  const name = String((b || {}).name || '').trim().slice(0, 80);
  const lat = Number((b || {}).lat), lon = Number((b || {}).lon);
  if (!name) throw new Error('a place needs a name');
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) throw new Error('a place needs where it is');
  const d = await db();
  const orders = (Array.isArray(b.orders) ? b.orders : []).map(cleanOrder).filter(Boolean);
  const same = d.places.find(p => p.name.toLowerCase() === name.toLowerCase() && dist(lat, lon, p.lat, p.lon) <= SAME_M);
  if (same) {
    if (b.notes) same.notes = String(b.notes).slice(0, 400);
    if (b.kind) same.kind = String(b.kind).slice(0, 40);
    for (const o of orders) if (!same.orders.some(x => x.name.toLowerCase() === o.name.toLowerCase())) same.orders.push(o);
    same.updated = new Date().toISOString();
    await setJSON('places', d); return Object.assign({ updated_existing: true }, same);
  }
  const p = { id: 'p_' + crypto.randomBytes(4).toString('hex'), name, lat, lon, kind: String((b || {}).kind || 'place').slice(0, 40), brand: (b || {}).brand || null,
    notes: String((b || {}).notes || '').slice(0, 400) || null, orders, visits: 0, created: new Date().toISOString() };
  d.places.push(p); await setJSON('places', d); return p;
}
async function addOrder(id, o) {
  const d = await db(); const p = d.places.find(x => x.id === id); if (!p) throw new Error('no such place');
  const order = cleanOrder(o); if (!order) throw new Error('an order needs a name');
  const i = p.orders.findIndex(x => x.name.toLowerCase() === order.name.toLowerCase());
  if (i >= 0) p.orders[i] = Object.assign(p.orders[i], order); else p.orders.push(order);
  await setJSON('places', d); return p;
}
async function remove(id) {
  const d = await db(); const n = d.places.length; d.places = d.places.filter(p => p.id !== id);
  if (d.places.length === n) return false; await setJSON('places', d); return true;
}
async function seen(id) {
  try { const d = await db(); const p = d.places.find(x => x.id === id); if (p) { p.visits = (p.visits || 0) + 1; p.last_seen = new Date().toISOString(); await setJSON('places', d); } } catch (e) { /* a visit count is not worth an error */ }
}

// an order against what the plan wants next: yes within a quarter, partly within three fifths, else no;
// an order with no numbers is his word, taken as yes
function fitOf(o, need) {
  if (!need || o.kcal == null) return 'yes';
  const rel = (have, want) => want > 0 ? Math.abs(have - want) / want : 0;
  const e = Math.max(rel(o.kcal, need.kcal), need.low_carb ? (o.carbs_g > need.carbs_g ? rel(o.carbs_g, need.carbs_g) : 0) : rel(o.carbs_g || 0, need.carbs_g), o.protein_g < (need.protein_g || 0) ? rel(o.protein_g || 0, need.protein_g) : 0);
  return e <= 0.25 ? 'yes' : e <= 0.6 ? 'partly' : 'no';
}
async function near(lat, lon, radius, need) {
  const r = radius || NEAR_M;
  const all = await list();
  return all.map(p => Object.assign({}, p, { dist_m: dist(lat, lon, p.lat, p.lon), saved: true,
      directions: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`, apple: `https://maps.apple.com/?daddr=${p.lat},${p.lon}`,
      orders: (p.orders || []).map(o => Object.assign({}, o, { fits: fitOf(o, need), yours: true, why: o.why || 'what you order here' })) }))
    .filter(p => p.dist_m <= r).sort((a, b) => a.dist_m - b.dist_m);
}
// the nearest saved place he is at right now, or null
async function here(coords, need) {
  if (!coords || !(Math.abs(Number(coords.lat)) <= 90)) return null;
  const n = await near(Number(coords.lat), Number(coords.lon), NEAR_M, need);
  return n[0] || null;
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/food/places', async (req, res) => { if (!auth(req, res)) return;
    try {
      const lat = Number(req.query.lat), lon = Number(req.query.lon);
      const all = await list();
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && req.query.lat) {
        const withD = all.map(p => Object.assign({}, p, { dist_m: dist(lat, lon, p.lat, p.lon) })).sort((a, b) => a.dist_m - b.dist_m);
        return res.json({ places: withD, here: withD.find(p => p.dist_m <= NEAR_M) || null, near_m: NEAR_M });
      }
      res.json({ places: all, near_m: NEAR_M });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/food/places', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: true, place: await add(req.body || {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
  app.post('/food/places/:id/order', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: true, place: await addOrder(String(req.params.id).replace(/[^\w]/g, ''), req.body || {}) }); } catch (e) { res.status(400).json({ ok: false, error: e.message }); } });
  app.delete('/food/places/:id', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: await remove(String(req.params.id).replace(/[^\w]/g, '')) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
}

module.exports = { attach, list, add, addOrder, remove, near, here, seen, dist, fitOf, NEAR_M };
