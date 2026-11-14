// ============================================================
// dayplan.js — one thing at a time (Harry, 13 Nov 2026: "How can I eat lunch while I'm coaching a game? How can
// I do cycle planning while I'm driving to Bethesda? … The Way is as much a planning app as it is a cycling app.
// It helps plan my day, which allows me to then plan my rides. But there can't be overlap. I can't be doing two
// things at one time.").
//
// The day's fixed blocks are the things that happen at their time whatever The Way says: classes and school
// events, coaching (from its "Arrive by" time, since he is at the field from then), the drives, travel, family.
// Everything The Way places itself goes in the free time between them:
//   meals and snacks   food-math placeMeals moves a meal out of a block, before it or after (food.js)
//   doses              a supplement or medicine inside a block moves just before it, else just after (calendar.js,
//                      push.js: the reminder and the row agree)
//   workouts, and his own blocks on the calendar (Cycle 3 Planning)
//                      can't be moved silently: a clash is marked on both rows, with the nearest free time that
//                      fits, one tap to move (the Day page)
// ============================================================
const tz = require('./tz');

// categories that hold him in place; 'busy' is his own block (movable by him), 'training' The Way's plan
const FIXED = new Set(['work', 'coaching', 'commute', 'travel', 'family', 'sleep']);
const MOVABLE = new Set(['busy', 'training']);
const RANK = c => FIXED.has(c) ? 2 : c === 'busy' ? 1 : c === 'training' ? 0 : -1;

// Changeover (Harry, 13 Nov: "this concept of the change over time … needs to be built into the code generally").
// Going from one thing to another takes time when the clothes or the place change: into a workout, 15 minutes to
// change and set up (after a drive, a class, a game); out of one, 20 to shower and change before the next thing.
// The same kind back to back (two classes, two games on one field) needs none, and a drive's own arrival is its
// changeover into the event (the "Arrive by" time). Every placer reads this one rule: the clash marks, the free
// windows workouts are planned in (calendar.js), and the fixes.
const CHANGE = { training: { before: 15, after: 20 } };
// Two sessions in two places (the lift at Life Time, then the ride in the pain cave at home: where.js) need the walk
// and the change between them too.
const PLACE_CHANGE = 15;
function changeover(a, b) {   // minutes needed between a ending and b starting
  if (!a || !b) return 0;
  if (a.category === 'training' && b.category === 'training') return a.place && b.place && a.place !== b.place ? PLACE_CHANGE : 0;
  if (a.category === b.category) return 0;
  const after = (CHANGE[a.category] || {}).after || 0, before = (CHANGE[b.category] || {}).before || 0;
  return Math.max(after, before);
}

// "Arrive by 1:40 PM" in a game's notes
function arriveBy(text) {
  const m = /arrive\s+by\s+(\d{1,2}):(\d{2})\s*([ap])\.?m/i.exec(String(text || ''));
  if (!m) return null;
  let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12;
  return h * 60 + +m[2];
}

// A day's timed events (calendar.js rows with start_min/end_min, or raw events with start/end) as blocks.
// o.categories: which count (default: the fixed ones); o.date: for raw events.
function blocksOf(events, o) {
  const cats = (o && o.categories) || FIXED;
  const out = [];
  for (const e of events || []) {
    if (!e || e.allDay || !cats.has(e.category)) continue;
    let s = e.start_min, en = e.end_min;
    if (s == null && e.start) {
      if (o && o.date && tz.keyOf(new Date(e.start)) !== o.date) continue;
      s = tz.minutesOf(new Date(e.start)); en = tz.minutesOf(new Date(e.end));
    }
    if (s == null || en == null || en <= s) continue;
    if (e.category === 'coaching') {
      // in the way from its "Arrive by" time; for a meal (o.eat) from the warm-up, half an hour before it starts
      if (o && o.eat) s = s - 30;
      else { const a = arriveBy(e.description); if (a != null && a < s && s - a <= 180) s = a; }
    }
    out.push({ start: s, end: en, name: String(e.summary || '').replace(/^Coaching · /, '').slice(0, 50), category: e.category });
  }
  return out.sort((a, b) => a.start - b.start);
}
// blocks that touch or overlap (gap under `join` minutes) are one stretch
function clusters(blocks, join) {
  const j = join == null ? 0 : join, out = [];
  for (const b of (blocks || []).slice().sort((a, b2) => a.start - b2.start)) {
    const last = out[out.length - 1];
    if (last && b.start <= last.end + j) { last.end = Math.max(last.end, b.end); last.names.push(b.name); }
    else out.push({ start: b.start, end: b.end, names: [b.name] });
  }
  return out;
}
const overlaps = (s, e, b) => s < b.end && e > b.start;
const freeAt = (s, len, blocks) => !(blocks || []).some(b => overlaps(s, s + len, b));

// The nearest start, to `want`, for something `len` long that touches no block, within [earliest, latest - len].
// Searches outward in 5-minute steps; null when the day has no room.
function nearestFree(want, len, blocks, earliest, latest) {
  const lo = earliest == null ? 0 : earliest, hi = (latest == null ? 1440 : latest) - len;
  const ok = t => t >= lo && t <= hi && freeAt(t, len, blocks);
  if (ok(want)) return want;
  // the edges of each block are the natural candidates: just before it starts, just after it ends
  const cands = [];
  for (const b of blocks || []) { cands.push(b.start - len, b.end); }
  for (let d = 5; d <= 1440; d += 5) { cands.push(want - d, want + d); }
  const good = cands.filter(ok).sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b);
  return good.length ? good[0] : null;
}

// A dose (a few minutes) inside a block: just before the stretch it falls in if that is after `earliest`, else
// 10 minutes after it ends. Returns { min, moved, why } (why: "before the drive", "after Practice").
function placeDose(t, len, blocks, earliest) {
  const L = len || 10;
  for (const c of clusters(blocks, 10)) {
    if (!overlaps(t, t + L, c)) continue;
    const before = c.start - L - 5;
    if (earliest == null || before >= earliest) return { min: before, moved: true, why: `before ${c.names[0]}` };
    return { min: c.end + 10, moved: true, why: `after ${c.names[c.names.length - 1]}` };
  }
  return { min: t, moved: false };
}

// The clashes of a day's rows: every pair of a fixed or movable row over another (doses and meals are placed,
// never clash). Each row that should move gets { clash: { with, fix_min } }: the lower in rank moves (a workout
// before his own block, his own block before anything fixed); two fixed rows both get the mark, no fix.
// win: { wake, bed } (sleep-window.js) bounds the fix.
function markClashes(rows, win) {
  const R = (rows || []).filter(r => r && !r.allDay && r.start_min != null && r.end_min > r.start_min && (FIXED.has(r.category) || MOVABLE.has(r.category)));
  const wake = win && win.wake != null ? win.wake : 390, bed = win && win.bed != null ? win.bed : 1350;
  const effStart = r => { if (r.category === 'coaching') { const a = arriveBy(r.description); if (a != null && a < r.start_min && r.start_min - a <= 180) return a; } return r.start_min; };
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j];
    const as = effStart(a), bs = effStart(b);
    // over each other, or too close to change between (a 4:15 ride when the drive home ends at 4:14)
    // a drive's edges move a few minutes with the traffic: an overlap of five minutes or less with one is not a clash
    const lap = Math.min(a.end_min, b.end_min) - Math.max(as, bs);
    // (his own blocks only: a workout needs its changeover, so for a workout any overlap counts)
    const wobble = lap <= 5 && ((a.category === 'commute' && b.category === 'busy') || (b.category === 'commute' && a.category === 'busy'));
    const over = as < b.end_min && a.end_min > bs && !wobble;
    const gapAB = bs - a.end_min, gapBA = as - b.end_min;
    const tight = !over && ((gapAB >= 0 && gapAB < changeover(a, b)) || (gapBA >= 0 && gapBA < changeover(b, a)));
    if (!over && !tight) continue;
    const ra = RANK(a.category), rb = RANK(b.category);
    // two workouts too tight between two places: the later one gives way (on top of each other they still ask him to pick)
    const twoPlaces = tight && a.category === 'training' && b.category === 'training';
    const mover = ra < rb ? a : rb < ra ? b : twoPlaces ? (as <= bs ? b : a) : null, other = mover === a ? b : mover === b ? a : null;
    if (!mover) { if (tight) continue; for (const [x, y] of [[a, b], [b, a]]) x.clash = x.clash || { with: y.summary, fix_min: null, both_fixed: true }; continue; }
    if (mover.clash && mover.clash.fix_min != null) continue;
    // the fix: the nearest time that touches nothing fixed, nothing of his own, and no other workout, with the
    // changeover kept on both sides of each
    const len = mover.end_min - mover.start_min;
    // ten minutes of slack beside a drive, so the next traffic reading does not bring the clash back
    // (on top of the changeover: a workout is put 25 minutes after a drive, and moved again only under 15)
    const slack = r => (r.category === 'commute' ? 10 : 0);
    const blocks = R.filter(r => r !== mover).map(r => ({ start: effStart(r) - slack(r) - changeover(mover, r), end: r.end_min + slack(r) + changeover(r, mover) }));
    const earliest = mover.category === 'training' ? wake + 60 : wake;
    const latest = mover.category === 'training' ? bed - 60 : bed;
    const fix = nearestFree(mover.start_min, len, blocks, earliest, latest);
    // the changeover that is short: the mover's before the other thing, or after it
    const moverFirst = effStart(mover) < effStart(other);
    const need = moverFirst ? changeover(mover, other) : changeover(other, mover);
    mover.clash = tight ? { with: other.summary, fix_min: fix, tight: true, need, side: moverFirst ? 'before' : 'after' } : { with: other.summary, fix_min: fix };
    other.clash_by = other.clash_by || mover.summary;
  }
  return rows;
}

// Nothing stays on top of anything (Harry, 14 Nov 2026: "Whenever any event is 'on top' of another event you have to
// move stuff around. Fix for this and all future days."). A workout that overlaps something fixed, or sits too tight
// against it, is moved by The Way itself to the nearest free time that fits (the same fix the Day page used to offer
// as a button), today's not-yet-started ones and every day ahead. One workout a day per pass; the next pass (the
// five-minute run, or the Day page when it sees a mark) takes the next. A ride with a place of its own (a recommended
// ride he said yes to) is left alone: its drives are fitted around it. Two fixed things over each other cannot be
// moved: they keep their mark.
// days: scheduleReport's days; workouts: the plan store's map; → [{ id, date, from, to, why }]
// an event he owns: added in The Way (l:), or on his own Google calendar (g:<his address>:<id>), not a shared one
const ownKey = k => /^l:/.test(String(k)) || /^g:[^@:]+@mdunitedfc\.org:[^:]+$/i.test(String(k));
// …and his alone: a meeting, a call or anything with guests or a video link has other people waiting on its time.
// The Way never moves those; they keep their mark and he decides (the IDP meetings with a Meet link, 14 Nov 2026).
const WITH_PEOPLE = /\b(meetings?|calls?|1\s*[:x-]\s*1|one[- ]on[- ]one|interviews?|seminars?|trainings?|discussions?|sessions?|webinars?|appointments?|appt|conference|lunch|dinner|coffee)\b/i;
const solo = e => !e.with_others && !WITH_PEOPLE.test(String(e.summary || ''));
function movesFor(days, today, nowMin, workouts) {
  const out = [];
  for (const day of days || []) {
    if (day.date < today) continue;
    const soon = m => day.date === today && m <= nowMin + 10;
    const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    for (const e of day.events || []) {
      if (!e.clash || e.clash.fix_min == null) continue;
      if (soon(e.start_min) || soon(e.clash.fix_min)) continue;            // started, or the fix is already past
      if (e.category === 'training' && e.workout_id) {
        const w = (workouts || {})[e.workout_id]; if (!w || w.location) continue;
        out.push({ kind: 'workout', id: w.id, date: day.date, name: w.name, from: w.time, to: hm(e.clash.fix_min), why: e.clash.with, tight: !!e.clash.tight });
        break;
      }
      // his own block (Harry, 14 Nov: "Yes, move mine too"): one he made in The Way, or on his own Google calendar;
      // never an event on a shared calendar (the school's, the club's, a team's)
      if (e.category === 'busy' && e.edit && ownKey(e.edit) && solo(e)) {
        out.push({ kind: 'event', key: e.edit, date: day.date, name: e.summary, from: hm(e.start_min), to: hm(e.clash.fix_min), why: e.clash.with, tight: !!e.clash.tight });
        break;
      }
    }
  }
  return out;
}
async function autoMove(now) {
  const { getJSON } = require('./storage');
  const s = await require('./calendar').scheduleReport({ days: 8 });
  const p = tz.parts(now || new Date());
  const d = await getJSON('plan-workouts', { workouts: {} });
  const moves = movesFor(s.days, tz.todayKey(), p.h * 60 + p.mi, d.workouts), done = [];
  for (const mv of moves) {
    try {
      if (mv.kind === 'event') { const r = await require('./calendar').editEvent(mv.key, { date: mv.date, start: mv.to }); if (!r) throw new Error('no such event'); }
      else await require('./workouts').update(mv.id, { time: mv.to, auto_moved: { from: mv.from, why: String(mv.why || '').slice(0, 80), tight: mv.tight, at: new Date().toISOString() } });
      done.push(mv);
    }
    catch (e) { done.push(Object.assign({ error: e.message }, mv)); }
  }
  return { moved: done };
}
function attach(app) {
  const { auth } = require('./fuel-log');
  // what would be moved, without moving it
  app.get('/dayplan/moves', async (req, res) => { if (!auth(req, res)) return;
    try { const { getJSON } = require('./storage'); const s = await require('./calendar').scheduleReport({ days: 8 }); const p = tz.parts(new Date()); const d = await getJSON('plan-workouts', { workouts: {} });
      res.json({ moves: movesFor(s.days, tz.todayKey(), p.h * 60 + p.mi, d.workouts) }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/dayplan/resolve', async (req, res) => { if (!auth(req, res)) return; try { res.json(await autoMove()); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, movesFor, ownKey, solo, autoMove, CHANGE, changeover, FIXED, MOVABLE, arriveBy, blocksOf, clusters, nearestFree, placeDose, markClashes, freeAt };
