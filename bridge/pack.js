// ============================================================
// pack.js — what to pack, the night before (Harry, 13 Nov, the high-performance rules: on a long day of games,
// classes or driving with nowhere to eat, The Way says the night before what to pack and when it gets eaten).
// The meal plan (food-math placeSnacks) marks a meal that falls away from home "Pack it: at <place>"; at 8 p.m.
// tomorrow's packed meals go to the phone as one list. School days are not on it: lunch there is the dining hall.
//   GET /pack?date=YYYY-MM-DD    the list for a day (default tomorrow)
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');

// the packed meals of a day's plan, as lines a person reads
function listFrom(meals) {
  return (meals || []).filter(m => /Pack it/.test(String(m.what || ''))).map(m => {
    const where = (/Pack it: at ([^,.]+)/.exec(m.what) || [])[1] || 'away';
    const food = String(m.what || '').split(/(?<=\.)\s/)[0].replace(/\s*Pack it:.*$/, '').trim();
    return { slot: m.slot, time: m.time, at: tz.hm12(m.time), where, kcal: m.kcal || null, carbs_g: m.carbs_g || 0, protein_g: m.protein_g || 0,
      line: `${m.slot[0].toUpperCase() + m.slot.slice(1)}, ${tz.hm12(m.time)} at ${where}: about ${m.kcal || '?'} kcal, ${m.carbs_g || 0} g carbs, ${m.protein_g || 0} g protein. ${food}` };
  });
}
async function packFor(date) {
  const g = await require('./food').guidelinesFor(date);
  const items = listFrom(g.meals);
  // a recommended ride he said yes to (suggest.js): the bike goes in the car
  try {
    const d = await getJSON('plan-workouts', { workouts: {} });
    for (const w of Object.values(d.workouts || {})) if (w && w.date === date && w.suggested && w.location && !w.done)
      items.unshift({ slot: 'bike', time: w.time, at: tz.hm12(w.time), where: w.suggested.name, line: `Bike, helmet, shoes, kit and two bottles: ${w.name} at ${tz.hm12(w.time)}, ${w.suggested.near ? `after ${w.suggested.near}` : 'on the way'}.` });
  } catch (e) { /* the meals stand */ }
  return { date, items };
}
// 8 p.m.: tomorrow's list to the phone, once
async function nightPack(now) {
  if (/^(1|true|yes)$/i.test(String(process.env.THE_WAY_SANDBOX || ''))) return { skipped: 'sandbox' };
  const p = tz.parts(now || new Date()), nowMin = p.h * 60 + p.mi;
  if (nowMin < 20 * 60 || nowMin >= 20 * 60 + 5) return { skipped: 'not 8 p.m.' };
  const date = tz.todayKey(), log = await getJSON('pack-sent', {}).catch(() => ({})) || {};
  if (log.date === date) return { skipped: 'sent' };
  const r = await packFor(tz.shiftKey(date, 1));
  if (!r.items.length) return { skipped: 'nothing to pack' };
  const res = await require('./push').send({ title: 'Pack for tomorrow', body: r.items.map(x => x.line).join(' '), tag: 'way-pack', items: [], url: '/#today' });
  await setJSON('pack-sent', { date, at: new Date().toISOString() }).catch(() => {});
  return { sent: r.items.length, result: res };
}
function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/pack', async (req, res) => { if (!auth(req, res)) return;
    try { const d = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : tz.shiftKey(tz.todayKey(), 1); res.json(await packFor(d)); }
    catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, packFor, nightPack, listFrom };
