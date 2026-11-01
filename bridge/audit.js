// ============================================================
// audit.js — the site checks itself. Every page reads the same stores, but a
// change in one place can leave another stale: a ride read before a field
// existed, a plate logged before its slot's plan was frozen, one bottle
// photographed and then typed, two files for one ride. This runs the checks,
// makes the repairs that lose nothing, and reports what needs a decision.
//
//   GET /audit            run it (throttled to once a minute unless ?force=1)
// Returns { at, checks: [{ key, ok, fixed, detail, items }], word }.
// Repairs made here: a missing plan snapshot is backfilled with the day's
// plan as it stands and marked as such; a ride analysis that still carries a
// dead-token message is read again; a sentence left stale by a later entry is
// re-read (wellness.js and food.js already do the rest on their own clocks).
// Never done here: deleting anything. A likely double log is marked, not
// removed; the journal shows the mark and the remove button is his.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const norm = s => String(s || '').toLowerCase().replace(/\b(one|a|an|1)\b/g, '').replace(/\d+\s*ml/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toMin = t => { const m = /^(\d{2}):(\d{2})$/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; };

async function run(o) {
  const force = !!(o && o.force);
  const last = await getJSON('audit-last', null);
  if (!force && last && Date.now() - last.at < 60e3) return last.result;
  const today = tz.todayKey();
  const checks = [];
  const food = require('./food');

  // 1. the journal: every plate carries the plan it was eaten under; doubles are marked
  try {
    for (const date of [tz.shiftKey(today, -1), today]) {
      const doc = await food.dayDocFor(date);
      if (!doc || !doc.entries) continue;
      const g = await food.guidelinesFor(date);
      let backfilled = 0, doubles = [], changed = false;
      const plates = doc.entries.filter(e => !e.supplement);
      const F = require('./food-math');
      for (const e of plates) {
        // a plate saved without a slot (before the wider rule) is slotted here the way the day report slots it
        if (!e.slot && !e.drink_only && e.time) { const sl = F.slotFor(g.meals, e.time, e.meal); if (sl) { e.slot = sl; changed = true; } }
        if (!e.plan && !e.drink_only && e.slot) {
          const m = (g.meals || []).find(x => x.slot === e.slot);
          if (m && m.kcal != null) { e.plan = { slot: e.slot, kcal: m.kcal, carbs_g: m.carbs_g, protein_g: m.protein_g, low_carb: !!m.low_carb, what: m.what, at: e.time, backfilled: true }; backfilled++; changed = true; }
        }
      }
      // the same thing logged twice within three minutes: marked, never removed
      const sorted = plates.filter(e => e.time).slice().sort((a, b) => a.time.localeCompare(b.time));
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1], b = sorted[i];
        const close = Math.abs(toMin(b.time) - toMin(a.time)) <= 3;
        const same = norm(a.name) === norm(b.name) || (a.drink && b.drink && norm(a.drink) === norm(b.drink) && Math.abs((a.kcal || 0) - (b.kcal || 0)) <= 30);
        if (close && same) { if (b.maybe_double_of !== a.id) { b.maybe_double_of = a.id; changed = true; } doubles.push({ date, id: b.id, name: b.name, time: b.time, twin: a.name, twin_time: a.time }); }
        else if (b.maybe_double_of === a.id) { delete b.maybe_double_of; changed = true; }
      }
      if (changed) await food.saveDayDoc(date, doc);
      checks.push({ key: 'journal-' + date, ok: doubles.length === 0, fixed: backfilled, detail: `${plates.length} entries${backfilled ? `, ${backfilled} given the plan they were eaten under` : ''}${doubles.length ? `, ${doubles.length} possible double log${doubles.length === 1 ? '' : 's'}` : ''}`, items: doubles.map(d => `${tz.hm12(d.time)} ${d.name} looks like ${tz.hm12(d.twin_time)} ${d.twin} again`) });
    }
  } catch (e) { checks.push({ key: 'journal', ok: false, detail: 'could not read the journal: ' + e.message, items: [] }); }

  // 2. the rides: one file a ride, analyses without dead-token residue, each planned session matched once
  try {
    const { stravaDone } = require('./workouts');
    const W = require('./workout-math');
    const st = W.settingsOf(await getJSON('workout-settings', W.DEFAULTS));
    const Rd = require('./rides');
    const d = await stravaDone(tz.shiftKey(today, -7), today, st);
    const twins = (d.rides || []).filter(r => r.twin).map(r => `${r.date} ${r.name} folded with ${r.twin.name}`);
    let reread = 0; const stale = [];
    for (const r of d.rides || []) {
      const a = await getJSON(Rd.key(r.id), null);
      const bad = a && JSON.stringify(a.sources || {}).match(/token refresh failed|missing a required parameter/i);
      if (bad && reread < 2) { reread++; try { await Rd.analyze(r, { force: true, ftp: st.ftp }); } catch (e) { stale.push(r.name); } }
      else if (bad) stale.push(r.name);
    }
    checks.push({ key: 'rides', ok: stale.length === 0, fixed: reread, detail: `${(d.rides || []).length} rides this week${twins.length ? `, ${twins.length} folded from two files` : ''}${reread ? `, ${reread} read again` : ''}`, items: twins.concat(stale.map(s => `${s}: analysis still carries an old error`)) });
  } catch (e) { checks.push({ key: 'rides', ok: false, detail: 'could not read the rides: ' + e.message, items: [] }); }

  // 3. the day's sentences: none left stale by a later entry
  try {
    const rep = await food.dayReport(today);
    let rechecked = 0;
    if (rep.stale_readings) { try { const r = await food.recheckDay(today); rechecked = r.rechecked || 0; } catch (e) { /* next pass */ } }
    checks.push({ key: 'sentences', ok: true, fixed: rechecked, detail: rep.stale_readings ? `${rep.stale_readings} sentence${rep.stale_readings === 1 ? '' : 's'} re-read against the day as it stands` : 'every sentence reads against the day as it stands', items: [] });
    // 4. the day's sessions agree across the food plan and the calendar
    const cal = await require('./workouts').calendar(today, today);
    const day = cal.days && cal.days[0];
    const planned = day ? (day.planned || []).filter(w => !/weight|lift|strength/i.test(String(w.sport || ''))) : [];
    const gradedTwice = planned.filter(w => w.compliance && w.compliance.basis && /of/.test(w.compliance.basis)).length > (day ? (day.done || []).length : 0);
    checks.push({ key: 'sessions', ok: !gradedTwice, detail: `${planned.length} planned, ${day ? (day.done || []).length : 0} ridden, food plan reads ${rep.sessions.length} session${rep.sessions.length === 1 ? '' : 's'} (${rep.fuel_day})`, items: gradedTwice ? ['one ride is grading more than one planned session'] : [] });
  } catch (e) { checks.push({ key: 'day', ok: false, detail: 'could not read the day: ' + e.message, items: [] }); }

  // 5. the morning numbers: a hand-entered morning and the watch's copy agree
  try {
    const Wl = require('./wellness');
    const man = (await Wl.all()).days[today];
    if (man) {
      const iv = require('./intervals');
      const w = iv.configured() ? await iv.wellnessRange(today, today) : { days: [] };
      const g = (w.days || [])[0];
      const items = [];
      if (g && g.sleep_h != null && man.sleep_h != null && Math.abs(g.sleep_h - man.sleep_h) > 0.75) items.push(`sleep: ${man.source} says ${man.sleep_h} h, the Garmin ${g.sleep_h} h; the hand-entered number stands`);
      checks.push({ key: 'wellness', ok: items.length === 0, detail: man ? `this morning entered by hand (${man.source})${g ? ', the Garmin has a copy too' : ''}` : '', items });
    }
  } catch (e) { /* no feed: nothing to compare */ }

  const flagged = checks.filter(c => !c.ok);
  const fixed = checks.reduce((a, c) => a + (c.fixed || 0), 0);
  const result = { at: new Date().toISOString(), today, checks, fixed, flagged: flagged.length,
    word: flagged.length ? `${flagged.length} thing${flagged.length === 1 ? '' : 's'} to look at: ${flagged.flatMap(c => c.items.length ? c.items : [c.detail]).join(' · ')}` : (fixed ? `Checked: ${fixed} small repair${fixed === 1 ? '' : 's'} made, nothing to decide.` : 'Checked: every page reads the same day.') };
  await setJSON('audit-last', { at: Date.now(), result }).catch(() => {});
  return result;
}

function attach(app) {
  app.get('/audit', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await run({ force: req.query.force === '1' })); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, run };
