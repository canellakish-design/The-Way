// ============================================================
// naps.js — naps (Harry, 14 Nov 2026: "Can naps improve my sleep score?" … "Yes build in Naps when appropriate and
// I'll enter them manually on the way").
// He enters a nap himself: on the Sleep page, by the Log button on the Day page's nap row, or by telling the coach
// ("I napped 25 minutes"). A nap counts toward that day's sleep: the night that ended that morning plus the nap,
// shown apart ("6.4 h + 25 min nap") and counted in the week's average (chain.js).
// When one is appropriate, the Day page offers it: after a night under 7 hours, a 25-minute nap in the first free
// half hour between 1 and 3 p.m. when he is at home (not at school or at a field, not inside a class, a drive, a
// game, his own block or a workout, and not in the 20 minutes before a workout). Never after 3 p.m.: a late or long
// nap takes from the night. The research behind the lengths and the hours: BJSM 2023 meta-analysis of napping
// (30 to 60 minutes helps performance and fatigue; a nap does not make up a short night in full), Lastella 2021
// (20 to 90 minutes between 1 and 4 p.m.).
//   GET /naps?from&to           the naps
//   POST /naps { minutes, time?, date? }
//   DELETE /naps/:id
// ============================================================
const crypto = require('crypto');
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const KEY = 'naps';
const NEED_H = 7;                            // a good night (chain.js): under this, a nap is offered
const FROM = 13 * 60, UNTIL = 15 * 60;       // the nap ends by 3 p.m.
const LEN = 25, SLOT = 30;                   // 25 minutes asleep, half an hour set aside
const hmOf = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

async function all() { const d = await getJSON(KEY, { naps: [] }); d.naps = Array.isArray(d.naps) ? d.naps : []; return d; }
async function add(b) {
  const minutes = Math.round(Number((b || {}).minutes));
  if (!(minutes >= 5 && minutes <= 180)) { const e = new Error('How long was the nap, in minutes (5 to 180)?'); e.status = 400; throw e; }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String((b || {}).date || '')) ? b.date : tz.todayKey();
  const p = tz.parts(new Date()), nowMin = p.h * 60 + p.mi;
  // when it began: the time given, else it has just ended
  const time = /^\d{2}:\d{2}$/.test(String((b || {}).time || '')) ? b.time : hmOf(Math.max(0, nowMin - minutes));
  const d = await all();
  const nap = { id: 'n_' + crypto.randomBytes(5).toString('hex'), date, time, minutes, at: new Date().toISOString() };
  d.naps.push(nap);
  d.naps = d.naps.filter(n => n.date >= tz.shiftKey(date, -120));
  await setJSON(KEY, d);
  return nap;
}
async function remove(id) { const d = await all(); const n = d.naps.length; d.naps = d.naps.filter(x => x.id !== id); if (d.naps.length === n) return false; await setJSON(KEY, d); return true; }
// minutes napped on each date
function totals(naps) { const out = {}; for (const n of naps || []) if (n && n.date && n.minutes > 0) out[n.date] = (out[n.date] || 0) + n.minutes; return out; }
async function minutesByDate() { return totals((await all()).naps); }

// The nights with their naps: hours becomes the night plus the nap; night_hours keeps the night alone.
function withNaps(nights, byDate) {
  return (nights || []).map(n => { const m = (byDate || {})[n.date] || 0; return m ? Object.assign({}, n, { night_hours: n.hours, nap_min: m, hours: Math.round((n.hours + m / 60) * 100) / 100 }) : n; });
}

// Where a nap fits today, or null. events: the day's rows (start_min, end_min, category, summary);
// o: { lastNightH, nowMin (today only) }
function slotFor(events, o) {
  const h = o && o.lastNightH;
  if (h == null || !(h > 0) || h >= NEED_H) return null;
  const ev = (events || []).filter(e => e && !e.allDay && e.start_min != null && e.end_min > e.start_min);
  const blocks = ev.filter(e => ['work', 'coaching', 'commute', 'travel', 'family', 'busy', 'training'].includes(e.category))
    .map(e => ({ start: e.start_min - (e.category === 'training' ? 20 : 0), end: e.end_min, coaching: e.category === 'coaching' }));
  const drives = ev.filter(e => e.category === 'commute').sort((a, b) => a.end_min - b.end_min);
  // at home: the last drive before then came home (or there has been none)
  const home = t => { const last = drives.filter(d => d.end_min <= t).pop(); return !last || /^drive home/i.test(String(last.summary || '')); };
  const first = Math.max(FROM, o && o.nowMin != null ? Math.ceil((o.nowMin + 5) / 5) * 5 : FROM);
  for (let t = first; t + SLOT <= UNTIL; t += 5) {
    if (!home(t) || blocks.some(b => t < b.end && t + SLOT > b.start)) continue;
    return { start: t, end: t + SLOT, minutes: LEN, why: `last night was ${Math.round(h * 10) / 10} h` };
  }
  return null;
}
// The day's nap rows: the naps taken (marked), else the one offered. lastNightH: today's night, when it is known.
function rowsFor(date, events, naps, o) {
  const base = { category: 'supplement', source: 'rx', kind: 'nap', calendar: 'The Way', allDay: false, blocking: false, rx_key: 'nap' };
  const fmt = require('./workouts').fmtMin;
  const mine = (naps || []).filter(n => n.date === date);
  if (mine.length) return mine.map(n => { const sm = (+n.time.slice(0, 2)) * 60 + (+n.time.slice(3, 5));
    return Object.assign({ summary: `Nap · ${n.minutes} min`, detail: 'counts toward today\'s sleep', minutes: n.minutes, start_min: sm, end_min: sm + n.minutes, from: fmt(sm), to: fmt(sm + n.minutes), taken: true, nap_id: n.id }, base); });
  const s = slotFor(events, o);
  if (!s) return [];
  return [Object.assign({ summary: `Nap · ${s.minutes} min`, detail: `${s.why}: set an alarm for ${s.minutes} minutes. Not after 3 p.m.`, minutes: SLOT, start_min: s.start, end_min: s.end, from: fmt(s.start), to: fmt(s.end), taken: false }, base)];
}
// last night's hours for today: the morning entered by hand, else what the chain last read from the watch
async function lastNight(today) {
  try { const m = ((await require('./wellness').all()).days || {})[today]; if (m && m.sleep_h != null) return m.sleep_h; } catch (e) { /* none by hand */ }
  try { const s = await getJSON('sleep-last', null); if (s && s.date === today && s.hours != null) return s.hours; } catch (e) { /* not read yet */ }
  return null;
}
function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/naps', async (req, res) => { if (!auth(req, res)) return;
    try { const d = await all(); const from = String(req.query.from || tz.shiftKey(tz.todayKey(), -13)), to = String(req.query.to || tz.todayKey());
      res.json({ naps: d.naps.filter(n => n.date >= from && n.date <= to), need_h: NEED_H, window: { from: hmOf(FROM), until: hmOf(UNTIL) }, minutes: LEN }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/naps', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: true, nap: await add(req.body || {}) }); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } });
  app.delete('/naps/:id', async (req, res) => { if (!auth(req, res)) return;
    try { res.json({ ok: await remove(String(req.params.id)) }); } catch (e) { res.status(500).json({ ok: false, error: e.message }); } });
}
module.exports = { attach, all, add, remove, totals, minutesByDate, withNaps, slotFor, rowsFor, lastNight, NEED_H, FROM, UNTIL, LEN, SLOT };
