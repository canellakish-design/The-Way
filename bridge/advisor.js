// ============================================================
// advisor.js — the food advisor for where he is standing.
//
// Two asks, both answered from where the day stands (the same context the
// voice reads: what the next slot of the plan wants, the day's rules, what
// is still due, fuel and water on board):
//
//   POST /food/advise  { images:[{image_base64, media_type}], text?, places? }
//     A photo of what is in front of him (a shelf, a cooler, a menu, a
//     gas-station counter). The model names the items it can see with their
//     macros as sold, scores each against what he needs next, and picks.
//     With `places` (from /food/nearby) and no photo it picks a place and a
//     specific order there instead.
//
//   POST /food/nearby  { lat, lon }
//     What is within walking or a short ride: restaurants, fast food, cafés,
//     supermarkets, convenience stores, from OpenStreetMap (Overpass), with
//     distance. Kept separate from the model call so each stays inside the
//     function's time limit. The page asks for this first, then /food/advise
//     with the list; every place carries a directions link.
// ============================================================
const { auth } = require('./fuel-log');
const MODEL = process.env.FOOD_MODEL || 'claude-opus-5-5';

const FITS = ['yes', 'partly', 'no'];
const ITEM = { type: 'object', additionalProperties: false, required: ['name', 'kcal', 'carbs_g', 'protein_g', 'fat_g', 'fits', 'why', 'how_much'],
  properties: { name: { type: 'string' }, kcal: { type: 'integer' }, carbs_g: { type: 'integer' }, protein_g: { type: 'integer' }, fat_g: { type: 'integer' },
    fits: { type: 'string', enum: FITS }, why: { type: 'string' }, how_much: { type: 'string' } } };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items', 'pick', 'reply', 'place'],
  properties: {
    items: { type: 'array', items: ITEM },
    pick: { type: 'string' },          // the name of the item to go for, or "" when nothing here fits
    place: { type: 'string' },         // with places: the name of the place picked, else ""
    reply: { type: 'string' }
  }
};

async function ask(content) {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1800, fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content }] })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('advisor ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 160));
  const block = (j.content || []).find(c => c.type === 'text');
  if (!block) throw new Error('no answer');
  return JSON.parse(block.text.replace(/```json|```/g, '').trim());
}

function prompt(ctx, o) {
  const places = (o.places || []).slice(0, 25).map(p => `- ${p.name}${p.brand && p.brand !== p.name ? ` (${p.brand})` : ''}, ${p.kind}, ${p.dist_m} m`).join('\n');
  return `You advise one cyclist on what to eat right now, from what is in front of him. He is 55, 98 kg, losing weight slowly while training; the plan times his meals to the riding.

Where the day stands:
${ctx}

${o.images && o.images.length ? `The photo shows what is in front of him: a shelf, a cooler, a menu or a counter. Name up to 8 items you can actually identify (brand and size when readable) with their macros as sold or served.` : places ? `No photo. These places are near him now:\n${places}\nChoose the best one or two for what he needs next and name a specific order at each (a real menu item, sized), with its macros.` : 'No photo and no places: answer from what he wrote.'}
${o.text ? `He says: "${o.text}"` : ''}

Judge every item against what he needs NEXT: the next slot of the plan (its calories, its carbs, which may be a cap on a low-carb slot, its protein), today's eating rules, and what is still due today. fits is yes when it serves the next slot, partly when it is acceptable, no when it works against the plan. why is one plain sentence. how_much is the portion to buy or order ("one", "the small", "half the bag").
pick is the name of the single best item (a combination is allowed, written as one name), or "" if nothing here fits; place is the place it is at, or "".
reply is spoken aloud: under 40 words, plain, one choice and the one reason that decides it, the way a coach would say it standing next to him. Times in 12-hour form.`;
}

// Overpass: eating and shopping within 1.5 km, nearest first.
const KINDS = { restaurant: 'restaurant', fast_food: 'fast food', cafe: 'café', supermarket: 'supermarket', convenience: 'convenience store', greengrocer: 'greengrocer', deli: 'deli', bakery: 'bakery', fuel: 'gas station' };
function dist(aLat, aLon, bLat, bLon) {
  const R = 6371000, toR = d => d * Math.PI / 180;
  const dLat = toR(bLat - aLat), dLon = toR(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
// TomTom when a key is set (TOMTOM_API_KEY in Netlify): reliable and quick.
// Restaurants and fast food (7315), grocery (7332), gas stations (7311).
async function nearbyTomTom(lat, lon, r, key) {
  const u = `https://api.tomtom.com/search/2/nearbySearch/.json?key=${encodeURIComponent(key)}&lat=${lat}&lon=${lon}&radius=${r}&limit=40&categorySet=7315,7332,7311`;
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const res = await fetch(u, { signal: ac.signal });
    if (!res.ok) throw new Error('tomtom ' + res.status);
    const j = await res.json();
    return (j.results || []).filter(x => x.poi && x.poi.name && x.position).map(x => {
      const cats = (x.poi.categories || []).join(', ').toLowerCase();
      const kind = /fast food/.test(cats) ? 'fast food' : /caf|coffee/.test(cats) ? 'café' : /grocery|supermarket/.test(cats) ? 'supermarket' : /convenience/.test(cats) ? 'convenience store' : /gas|petrol/.test(cats) ? 'gas station' : 'restaurant';
      return { name: x.poi.name, brand: (x.poi.brands || [])[0] ? x.poi.brands[0].name : null, kind, cuisine: (x.poi.cuisines || []).join(', ') || null,
        lat: x.position.lat, lon: x.position.lon, dist_m: Math.round(x.dist || dist(lat, lon, x.position.lat, x.position.lon)),
        directions: `https://www.google.com/maps/dir/?api=1&destination=${x.position.lat},${x.position.lon}`, apple: `https://maps.apple.com/?daddr=${x.position.lat},${x.position.lon}` };
    }).sort((a, b) => a.dist_m - b.dist_m).slice(0, 25);
  } finally { clearTimeout(timer); }
}

async function nearby(lat, lon, radius) {
  const r = radius || 1500;
  const tt = (process.env.TOMTOM_API_KEY || '').trim();
  if (tt) { try { return await nearbyTomTom(lat, lon, r, tt); } catch (e) { /* fall through to OpenStreetMap */ } }
  const q = `[out:json][timeout:6];(
    nwr(around:${r},${lat},${lon})[amenity~"^(restaurant|fast_food|cafe|fuel)$"][name];
    nwr(around:${r},${lat},${lon})[shop~"^(supermarket|convenience|greengrocer|deli|bakery)$"][name];
  );out center tags 60;`;
  // the public mirrors are busy by turns: two tries, four seconds each
  const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  let j = null, lastErr = null;
  for (const url of MIRRORS.slice(0, 3)) {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 4000);
    try {
      const res = await fetch(url, { method: 'POST', signal: ac.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (!res.ok) throw new Error('overpass ' + res.status);
      j = await res.json(); break;
    } catch (e) { lastErr = e; } finally { clearTimeout(timer); }
  }
  if (!j) throw lastErr || new Error('no map service answered');
  const out = [];
  for (const el of j.elements || []) {
    const t = el.tags || {}; const la = el.lat != null ? el.lat : el.center && el.center.lat, lo = el.lon != null ? el.lon : el.center && el.center.lon;
    if (la == null || !t.name) continue;
    const kind = KINDS[t.amenity] || KINDS[t.shop] || t.amenity || t.shop;
    out.push({ name: t.name, brand: t.brand || null, kind, cuisine: t.cuisine || null, lat: la, lon: lo, dist_m: dist(lat, lon, la, lo),
      directions: `https://www.google.com/maps/dir/?api=1&destination=${la},${lo}`, apple: `https://maps.apple.com/?daddr=${la},${lo}` });
  }
  out.sort((a, b) => a.dist_m - b.dist_m);
  // one entry per name, nearest kept
  const seen = new Set();
  return out.filter(p => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 25);
}

async function advise(body) {
  const b = body || {};
  const images = Array.isArray(b.images) ? b.images.filter(i => i && i.image_base64).slice(0, 2) : [];
  const ctx = await require('./voice').context();
  const content = images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.media_type || 'image/jpeg', data: img.image_base64 } }));
  content.push({ type: 'text', text: prompt(ctx, { images, text: String(b.text || '').slice(0, 400), places: Array.isArray(b.places) ? b.places : null }) });
  const u = await ask(content);
  const items = (u.items || []).slice(0, 8);
  const pick = items.find(i => i.name === u.pick) || (u.pick ? { name: u.pick } : null);
  const place = (b.places || []).find(p => p.name === u.place) || null;
  return { items, pick, place, reply: String(u.reply || '').slice(0, 400) };
}

function attach(app) {
  app.post('/food/advise', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await advise(req.body)); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/food/nearby', async (req, res) => { if (!auth(req, res)) return;
    try {
      const lat = Number((req.body || {}).lat), lon = Number((req.body || {}).lon);
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return res.status(400).json({ error: 'lat and lon needed' });
      const places = await nearby(lat, lon, Number((req.body || {}).radius) || 1500);
      res.json({ lat, lon, places, search: `https://www.google.com/maps/search/food/@${lat},${lon},15z` });
    } catch (e) { res.status(502).json({ error: /abort/i.test(e.message) ? 'the map service took too long' : e.message, places: [], search: `https://www.google.com/maps/search/food/@${Number((req.body || {}).lat)},${Number((req.body || {}).lon)},15z` }); } });
}

module.exports = { attach, advise, nearby, prompt, SCHEMA };
