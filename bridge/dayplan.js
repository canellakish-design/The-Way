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
    if (e.category === 'coaching') { const a = arriveBy(e.description); if (a != null && a < s && s - a <= 180) s = a; }
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
    if (!(as < b.end_min && a.end_min > bs)) continue;
    const ra = RANK(a.category), rb = RANK(b.category);
    const mover = ra < rb ? a : rb < ra ? b : null, other = mover === a ? b : mover === b ? a : null;
    if (!mover) { for (const [x, y] of [[a, b], [b, a]]) x.clash = x.clash || { with: y.summary, fix_min: null, both_fixed: true }; continue; }
    if (mover.clash && mover.clash.fix_min != null) continue;
    // the fix: the nearest time that touches nothing fixed, nothing of his own, and no other workout
    const len = mover.end_min - mover.start_min;
    const blocks = R.filter(r => r !== mover).map(r => ({ start: effStart(r), end: r.end_min }));
    const earliest = mover.category === 'training' ? wake + 60 : wake;
    const latest = mover.category === 'training' ? bed - 60 : bed;
    const fix = nearestFree(mover.start_min, len, blocks, earliest, latest);
    mover.clash = { with: other.summary, fix_min: fix };
    other.clash_by = other.clash_by || mover.summary;
  }
  return rows;
}

module.exports = { FIXED, MOVABLE, arriveBy, blocksOf, clusters, nearestFree, placeDose, markClashes, freeAt };
