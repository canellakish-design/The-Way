// scripts/smoke.js — the check before a push to main (Harry, 13 Nov 2026, after tomorrow's page showed no meals:
// "Make sure stuff like that doesn't happen again"). Run against the preview, then the live site:
//   node scripts/smoke.js https://deploy-preview-2--thewayforward.netlify.app
// It reads the site as he does and fails loudly on what has gone wrong before:
//   1. every day from yesterday to six days ahead has a food plan with its main meals
//   2. no meal sits inside a class, a game (from its warm-up) or a drive, on any of those days
//   3. no two things he is going to overlap unmarked (every overlap carries a clash mark)
//   4. the Day page draws meals on today, tomorrow and the day after, with no page errors (needs Playwright)
// Reading only: nothing is written.
const base = (process.argv[2] || 'https://thewayforward.netlify.app').replace(/\/$/, '');
const H = { 'x-the-way-app': '1' };
const get = async p => { const r = await fetch(base + p, { headers: H }); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const hm = m => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')}${m < 720 ? 'a' : 'p'}`;
const fails = [], notes = [];
const fail = m => { fails.push(m); console.log('FAIL ' + m); };

(async () => {
  const s = await get('/schedule?days=8&back=1');
  for (const d of s.days || []) {
    let f; try { f = await get('/food/day?date=' + d.date); } catch (e) { fail(`${d.date}: no food plan (${e.message})`); continue; }
    const meals = (f.meals || []).filter(m => m.time && m.kcal);
    const mains = meals.filter(m => /breakfast|lunch|dinner|after/.test(m.slot));
    if (mains.length < 2) fail(`${d.date}: only ${mains.length} main meals in the plan`);
    // what holds his hands: classes, games from their warm-up, drives
    const blocks = (d.events || []).filter(e => !e.allDay && e.start_min != null && ['work', 'coaching', 'commute', 'travel'].includes(e.category))
      .map(e => ({ s: e.category === 'coaching' ? e.start_min - 30 : e.start_min, e: e.end_min, name: e.summary }));
    for (const m of meals) {
      if (m.slot === 'on the bike' || (m.logged || []).length) continue;   // the bottle is the ride; a logged meal is where he ate it
      const t = toMin(m.time), hit = blocks.find(b => t < b.e && t + 30 > b.s);
      if (hit) fail(`${d.date}: ${m.slot} at ${hm(t)} is inside "${hit.name.slice(0, 40)}"`);
    }
    // overlaps among what he goes to must carry a mark
    const R = (d.events || []).filter(e => !e.allDay && e.start_min != null && e.end_min > e.start_min && ['work', 'coaching', 'commute', 'travel', 'family', 'busy', 'training'].includes(e.category));
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      const a = R[i], b = R[j];
      if (a.start_min < b.end_min && a.end_min > b.start_min && !(a.clash || b.clash || a.clash_by || b.clash_by) && !(a.category === 'work' && b.category === 'work') && !(a.category === 'coaching' && b.category === 'coaching') && d.date >= (s.days.find(x => x.today) || {}).date)
        fail(`${d.date}: "${a.summary.slice(0, 30)}" and "${b.summary.slice(0, 30)}" overlap with no mark`);
    }
    notes.push(`${d.date}: ${meals.length} meals, ${blocks.length} blocks`);
  }
  // the page itself, when a browser is at hand
  let pw = null; try { pw = require('playwright'); } catch (e) { notes.push('no Playwright here: the page check was skipped'); }
  if (pw) {
    const b = await pw.chromium.launch(), p = await b.newPage({ viewport: { width: 420, height: 900 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(base + '/#today', { waitUntil: 'load' }); await p.waitForTimeout(9000);
    for (const step of ['today', 'tomorrow', 'the day after']) {
      const titles = await p.$$eval('#dayList li.xrow .n', xs => xs.map(x => x.innerText.split('\n')[0].toLowerCase()));
      const n = titles.filter(t => /^(breakfast|lunch|dinner|after|before|snack)\b/.test(t)).length;
      if (n < 2) fail(`the Day page shows ${n} meals on ${step}`);
      notes.push(`page, ${step}: ${titles.length} rows, ${n} meals`);
      const next = await p.$('#dayNext:not([disabled])'); if (!next) break; await next.click(); await p.waitForTimeout(6000);
    }
    if (errs.length) fail('page errors: ' + errs.slice(0, 3).join(' | '));
    await b.close();
  }
  notes.forEach(n => console.log('  ' + n));
  console.log(fails.length ? `\n${fails.length} FAILED on ${base}` : `\nall clear on ${base}`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('smoke could not run: ' + e.message); process.exit(2); });
