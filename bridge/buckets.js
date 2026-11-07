// ============================================================
// buckets.js — the magic buckets on the bridge. The rules themselves (the lines, the colours, which
// bucket a second or a step belongs to, the plan and the ride in seconds per bucket) live in one file the
// workout player and the site's pages load too, pwa/buckets.js; this wraps it with the lines from the
// thresholds store (thresholds.js), so a new Tymewear test moves every bucket view at once.
// ============================================================
const B = require('../pwa/buckets.js');
const PLANNING_FTP = 175;   // never 196: the plan's watts are % of the planning FTP

// the lines in force on a day, as the rules take them
async function currentLines(day) {
  try {
    const t = await require('./thresholds').current(day);
    return { vt1_w: t.vt1_w, vt2_w: t.vt2_w, vt1_hr: t.vt1_hr, vt2_hr: t.vt2_hr, date: t.date, source: t.source };
  } catch (e) { return Object.assign({}, B.LINES, { date: null, source: 'built in' }); }
}
const pick = L => ({ vt1_w: L.vt1_w, vt2_w: L.vt2_w, vt1_hr: L.vt1_hr, vt2_hr: L.vt2_hr });

// what a session hands its readers: the lines, the colours and the plan in seconds per bucket
function sessionBuckets(steps, lines, ftp) {
  const plan = B.planFromSteps(steps, ftp || PLANNING_FTP, pick(lines));
  return { lines: Object.assign(pick(lines), { date: lines.date || null, source: lines.source || null }), colours: Object.assign({}, B.COLOURS),
    buckets_plan: plan.planned ? B.planOf(plan) : null };
}

module.exports = Object.assign({}, B, { PLANNING_FTP, currentLines, sessionBuckets, pick });
