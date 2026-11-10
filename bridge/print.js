// ============================================================
// print.js — The Way on one sheet of paper (Harry, 10 Nov 2026: "I want a printout of The Way each morning,
// at a certain time"). One letter page, black on white: the day's numbers at the top, then the day in time
// order (classes, coaching, workouts, meals with their carb label and grams, supplements and medicines with a
// box to tick), then lines for notes. Built from the same reports the Day page reads, so paper and screen agree.
//   GET /print/day?date=YYYY-MM-DD   (default today) → a printable HTML page; ?auto=1 opens the print dialog
// ============================================================
const tz = require('./tz');

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const hm12 = m => { if (m == null) return ''; const h = Math.floor(m / 60) % 24, mi = m % 60; return `${h % 12 || 12}:${String(mi).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`; };
const n0 = v => v == null ? '—' : Math.round(v).toLocaleString('en-US');
const SLOT = { before: 'Pre-ride', after: 'Post-ride', 'on the bike': 'On the bike' };

// everything on the sheet, as data (tested without a browser)
async function sheetFor(date) {
  const today = tz.todayKey();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : today;
  const ahead = Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  const food = require('./food');
  const [sched, day, nightsWeek] = await Promise.all([
    ahead >= 0 && ahead <= 13 ? require('./calendar').scheduleReport({ days: ahead + 1 }).catch(() => null) : null,
    food.dayReport(d).catch(() => null),
    require('./energy-meter').week(today).catch(() => null)
  ]);
  const sd = sched && (sched.days || []).find(x => x.date === d);
  const rows = [];
  for (const e of (sd && sd.events) || []) {
    if (e.allDay) { rows.push({ min: -1, kind: 'note', what: e.summary }); continue; }
    if (e.start_min == null) continue;
    if (e.category === 'supplement') { rows.push({ min: e.start_min, kind: 'dose', what: e.summary, detail: e.detail || '', tick: true, done: !!e.taken }); continue; }
    if (e.category === 'training') { rows.push({ min: e.start_min, end: e.end_min, kind: 'workout', what: e.summary, detail: e.minutes ? `${e.minutes} min` : '', tick: true }); continue; }
    rows.push({ min: e.start_min, end: e.end_min, kind: e.category === 'coaching' ? 'coaching' : 'event', what: e.summary });
  }
  for (const m of (day && day.meals) || []) {
    const t = m.next_day && Number.isFinite(m.at_min) ? m.at_min : toMin(m.time);
    if (t == null || (!m.kcal && !(m.carbs_g > 0))) continue;
    const name = SLOT[m.slot] || (m.slot ? m.slot[0].toUpperCase() + m.slot.slice(1) : 'Meal');
    rows.push({ min: t, kind: 'meal', what: `${name}${m.carb ? ` · ${m.carb.word}` : ''}`,
      detail: `${m.kcal ? `${m.kcal} kcal · ` : ''}${m.carbs_g || 0} g carbs · ${m.protein_g || 0} g protein. ${String(m.what || '').split(/(?<=\.)\s/)[0]}`, tick: true, done: (m.logged || []).length > 0 });
  }
  rows.sort((a, b) => a.min - b.min);
  const t = (day && day.target) || {};
  let morning = null;
  if (d === today) {
    try {
      const c = await require('./chain').report();
      const L = c.links || {};
      morning = { sleep_h: L.sleep && L.sleep.today, sleep_word: L.sleep && L.sleep.today_word, recovery: L.recovery && L.recovery.today,
        weight_lb: L.weight && L.weight.today, verdict: c.verdict };
    } catch (e) { morning = null; }
  }
  return { date: d, label: new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }),
    fuel_day: day && (day.fuel_day || day.day), target: { kcal: t.kcal, carbs_g: t.carbs_g, protein_g: t.protein_g, fat_g: t.fat_g, note: t.deficit_note || null },
    morning, week: nightsWeek ? { avg7: nightsWeek.avg7, lb_week: nightsWeek.lb_week } : null, rows };
}

function html(s, auto) {
  const box = done => `<span class="box">${done ? '✓' : ''}</span>`;
  const row = r => r.kind === 'note' ? '' : `<tr class="${r.kind}"><td class="t">${esc(hm12(r.min))}${r.end && r.end > r.min ? `–${esc(hm12(r.end))}` : ''}</td>
    <td class="w"><b>${esc(r.what)}</b>${r.detail ? `<div class="d">${esc(r.detail)}</div>` : ''}</td><td class="c">${r.tick ? box(r.done) : ''}</td></tr>`;
  const notes = s.rows.filter(r => r.kind === 'note').map(r => esc(r.what));
  const m = s.morning, w = s.week, t = s.target;
  const sign = v => v == null ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  return `<!doctype html><html><head><meta charset="utf-8"><title>The Way · ${esc(s.label)}</title>
<style>
@page{size:letter;margin:0.45in}
*{box-sizing:border-box}
body{margin:0;font:11.5px/1.35 -apple-system,"Helvetica Neue",Arial,sans-serif;color:#000;background:#fff}
h1{font-size:20px;margin:0;letter-spacing:.5px}
.top{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #000;padding-bottom:4px}
.kind{font-size:12px;text-transform:uppercase;letter-spacing:1px}
.nums{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 4px;font-size:12px}
.nums b{font-size:15px}
.allday{font-size:11px;margin:2px 0 6px;color:#333}
table{width:100%;border-collapse:collapse;margin-top:6px}
td{border-bottom:1px solid #bbb;padding:4px 4px;vertical-align:top}
td.t{width:104px;white-space:nowrap;font-variant-numeric:tabular-nums}
td.c{width:22px;text-align:right}
.d{font-size:10.5px;color:#222}
tr.workout td{border-bottom:1.5px solid #000} tr.workout b{font-size:13px}
tr.event b,tr.coaching b{font-weight:500}
.box{display:inline-block;width:13px;height:13px;border:1.4px solid #000;text-align:center;line-height:11px;font-size:11px}
.verdict{margin:6px 0 0;font-size:11.5px}
.lines{margin-top:12px} .lines div{border-bottom:1px solid #999;height:20px}
.foot{margin-top:8px;font-size:9.5px;color:#555}
@media screen{body{max-width:8.5in;margin:16px auto;padding:0 16px}}
</style></head><body>
<div class="top"><h1>THE WAY · ${esc(s.label)}</h1><span class="kind">${esc(s.fuel_day || '')}</span></div>
<div class="nums">
  <span>Day <b>${n0(t.kcal)}</b> kcal · <b>${n0(t.carbs_g)}</b> C · <b>${n0(t.protein_g)}</b> P · <b>${n0(t.fat_g)}</b> F</span>
  ${m ? `<span>Sleep <b>${m.sleep_h != null ? m.sleep_h : '—'}</b> h${m.sleep_word ? ` (${esc(m.sleep_word)})` : ''}</span><span>Recovery <b>${m.recovery != null ? m.recovery : '—'}</b></span>${m.weight_lb ? `<span>Weight <b>${m.weight_lb}</b> lb</span>` : ''}` : ''}
  ${w && w.avg7 != null ? `<span>Energy, 7 days <b>${sign(w.avg7)}</b>/day · ${sign(w.lb_week)} lb/wk</span>` : ''}
</div>
${t.note ? `<div class="allday">${esc(t.note)}</div>` : ''}
${m && m.verdict ? `<div class="verdict">${esc(m.verdict)}</div>` : ''}
${notes.length ? `<div class="allday">${notes.join(' · ')}</div>` : ''}
<table>${s.rows.map(row).join('')}</table>
<div class="lines"><div></div><div></div><div></div><div></div></div>
<div class="foot">Printed ${esc(new Date().toLocaleString('en-US', { timeZone: tz.ZONE || 'America/New_York', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' }))} · thewayforward.netlify.app</div>
${auto ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300))</script>' : ''}
</body></html>`;
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/print/day', async (req, res) => { if (!auth(req, res)) return;
    try { const s = await sheetFor(String(req.query.date || '')); res.set('Content-Type', 'text/html; charset=utf-8'); res.send(html(s, req.query.auto === '1')); }
    catch (e) { res.status(500).send(`<p>Could not build the sheet: ${esc(e.message)}</p>`); } });
}
module.exports = { attach, sheetFor, html, hm12 };
