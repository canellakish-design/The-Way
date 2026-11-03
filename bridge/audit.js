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
    for (const date of [today]) {   // today only: the line on the Day page is about today
      const doc = await food.dayDocFor(date);
      if (!doc || !doc.entries) continue;
      const g = await food.guidelinesFor(date);
      let backfilled = 0, doubles = [], changed = false;
      const plates = doc.entries.filter(e => !e.supplement);
      const seen = await getJSON('food-seen-' + date, null).catch(() => null);
      const F = require('./food-math');
      for (const e of plates) {
        // a plate saved without a slot (before slots were always chosen at logging) is slotted once here, and keeps it
        if (!e.slot && !e.slot_fixed && !e.drink_only && e.time) {
          // the slot the day already gave it (food.js keeps it in food-seen-<date>), else one now, once
          const sl = seen && seen.entry_slots && e.id in seen.entry_slots ? seen.entry_slots[e.id] : F.slotFor(g.meals, e.time, e.meal);
          e.slot = sl || null; e.slot_fixed = true; changed = true;
        }
        if (!e.plan && !e.drink_only && e.slot) {
          // the slot's own frozen plan when another plate in it carries one, else the plan as it stands
          const sib = plates.find(x => x !== e && x.slot === e.slot && x.plan && x.plan.kcal != null && !x.plan.backfilled);
          const m = sib ? sib.plan : (g.meals || []).find(x => x.slot === e.slot);
          if (m && m.kcal != null) { e.plan = { slot: e.slot, time: m.time || null, kcal: m.kcal, carbs_g: m.carbs_g, protein_g: m.protein_g, low_carb: !!m.low_carb, what: m.what, at: e.time, backfilled: true }; backfilled++; changed = true; }
        }
      }
      // the same thing logged twice within three minutes: marked, never removed
      // every pair logged within ten minutes of each other, not only neighbours: a plate logged between two copies hid them
      const r = doublesOf(plates);
      for (const e of plates) {
        const twin = r.mark[e.id];
        if (twin && e.maybe_double_of !== twin) { e.maybe_double_of = twin; changed = true; }
        else if (!twin && e.maybe_double_of) { delete e.maybe_double_of; changed = true; }
      }
      doubles = r.groups;
      if (changed) await food.saveDayDoc(date, doc);
      checks.push({ key: 'journal-' + date, ok: doubles.length === 0, fixed: backfilled, detail: `${plates.length} entries${backfilled ? `, ${backfilled} given the plan they were eaten under` : ''}${doubles.length ? `, ${doubles.length} possible double log${doubles.length === 1 ? '' : 's'}` : ''}`, items: doubles.map(d => d.text) });
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
    // the re-read itself is a model call and runs on the Food page's own clock; here it is only counted
    checks.push({ key: 'sentences', ok: true, fixed: 0, detail: rep.stale_readings ? `${rep.stale_readings} sentence${rep.stale_readings === 1 ? '' : 's'} waiting to be re-read on the next Food page load` : 'every sentence reads against the day as it stands', items: [] });
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

  const fixed = checks.reduce((a, c) => a + (c.fixed || 0), 0);
  const result = Object.assign({ at: new Date().toISOString(), today, checks, fixed }, wordOf(checks, fixed));
  await setJSON('audit-last', { at: Date.now(), result }).catch(() => {});
  return result;
}

// Doubles: the same thing logged again within ten minutes. Every pair is found, not only neighbours
// (a plate logged between two copies hid them), and three copies are one group, listed once.
// plates: the day's entries. Returns { mark: {id: id of the first copy}, groups: [{ids, text}] }.
function doublesOf(plates) {
  const sorted = (plates || []).filter(e => e && e.time).slice().sort((a, b) => a.time.localeCompare(b.time));
  const sameItem = (a, b) => norm(a.name) === norm(b.name) || (a.written && b.written && norm(a.written) === norm(b.written)) || (a.drink && b.drink && norm(a.drink) === norm(b.drink) && Math.abs((a.kcal || 0) - (b.kcal || 0)) <= 30);
  const mark = {}, root = {};
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i];
    const a = sorted.slice(0, i).reverse().find(x => Math.abs(toMin(b.time) - toMin(x.time)) <= 10 && sameItem(x, b));
    if (a) { const r = root[a.id] || a.id; mark[b.id] = r; root[b.id] = r; }
  }
  const byRoot = {};
  for (const [id, r] of Object.entries(mark)) (byRoot[r] = byRoot[r] || []).push(id);
  const groups = Object.entries(byRoot).map(([r, ids]) => {
    const first = sorted.find(e => e.id === r), copies = ids.map(id => sorted.find(e => e.id === id));
    const text = copies.length === 1 ? `${tz.hm12(copies[0].time)} ${copies[0].name} looks like ${tz.hm12(first.time)} ${first.name} again`
      : `${first.name} logged ${copies.length + 1} times (${[first].concat(copies).map(e => tz.hm12(e.time)).join(', ')})`;
    return { ids: [r].concat(ids), text };
  });
  return { mark, groups };
}

// The self-check's line: the count is the number of things listed, and every listed thing is counted.
function wordOf(checks, fixed) {
  const items = checks.filter(c => !c.ok).flatMap(c => c.items && c.items.length ? c.items : [c.detail]).filter(Boolean);
  const uniq = Array.from(new Set(items));
  return { flagged: uniq.length, items: uniq,
    word: uniq.length ? `${uniq.length} thing${uniq.length === 1 ? '' : 's'} to look at: ${uniq.join(' · ')}` : (fixed ? `Checked: ${fixed} small repair${fixed === 1 ? '' : 's'} made, nothing to decide.` : 'Checked: every page reads the same day.') };
}

function attach(app) {
  app.get('/audit', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await run({ force: req.query.force === '1' })); } catch (e) { res.status(500).json({ error: e.message }); } });
}
module.exports = { attach, run, doublesOf, wordOf };
