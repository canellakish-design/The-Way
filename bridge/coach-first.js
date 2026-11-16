// ============================================================
// coach-first.js: the coach speaks first (Harry, 15 Nov 2026, of the list of what would make the coach more
// effective: "Do it all"). Until now the coach only answered. Three things now come to him without asking, each
// to the phone (bridge/push.js) and onto the Day page:
//   the morning: one briefing a day, written once the day has begun: last night, today's sessions and what the day
//                needs. The quick coach writes it (voice.js understand), so it reads the same lines every answer does.
//   alerts:      plain rules over the day's numbers, no model: a session coming that the tank will not cover,
//                nothing in the journal by early afternoon, protein far behind in the evening. Each once a day.
//   the review:  Sunday evening the researched coach (coach.js) reads the week and writes it up: what worked, the one
//                thing to change, the shape of next week.
// Nothing is ever sent inside his sleep window or its last hour (sleep-window.js), and the copy of the site sends
// nothing at all. netlify/functions/coach-first.mjs calls tick() every five minutes.
//   GET  /coach/first        { morning, alerts, review }: what the Day page shows
//   POST /coach/first/run    { kind: 'morning' | 'alerts' | 'review' }: do one now (how the copy is tested)
// ============================================================
const { getJSON, setJSON, SANDBOX } = require('./storage');
const tz = require('./tz');

const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const race = (p, ms, fb) => Promise.race([Promise.resolve(p).catch(() => fb), new Promise(r => setTimeout(() => r(fb), ms))]);
const DEFAULT_R = { wake: 390, bed: 1350 };

// ---- when (pure) -------------------------------------------------------------------------------------
// awake and not in the last hour before bed: the only minutes anything is sent
const mayReach = (nowMin, R) => nowMin >= R.wake + 20 && nowMin <= R.bed - 60;
// the morning briefing: from twenty minutes after waking until noon
const morningDue = (nowMin, R, kept, today) => nowMin >= R.wake + 20 && nowMin < 12 * 60 && !(kept && kept.date === today);
// the week a review is owed for, or null. Sunday from 6:00p (its own week); Monday morning until noon (the week just
// ended) when Sunday's was missed. dow: 0 Sunday … 6 Saturday
function reviewDue(today, dow, nowMin, R, kept) {
  const week = dow === 0 && nowMin >= 18 * 60 && nowMin <= R.bed - 90 ? tz.shiftKey(today, -6)
    : dow === 1 && nowMin >= R.wake + 30 && nowMin < 12 * 60 ? tz.shiftKey(today, -7) : null;
  return week && !(kept && kept.week_of === week) ? week : null;
}

// ---- the alerts (pure): the day's report → what is worth a word now ---------------------------------
// day: food.dayReport(today). Each alert has a key (sent once a day), a title and a body for the phone.
function alertsFor(day, nowMin) {
  const out = []; if (!day) return out;
  const hm = t => tz.hm12(t), short = n => String(n || 'the session').replace(/,.*$/, '').replace(/:.*$/, '').trim();
  // a session 45 to 100 minutes off that the tank, with the plan's food, will not cover
  for (const s of ((day.energy && day.energy.sessions) || [])) {
    const st = toMin(s.time); if (st == null || s.done) continue;
    const lead = st - nowMin, lowQuick = s.need != null && s.pct != null && s.pct < s.need, lowLegs = s.need_legs != null && s.legs_pct != null && s.legs_pct < s.need_legs - 5;
    if (lead >= 45 && lead <= 100 && (lowQuick || lowLegs))
      out.push({ key: 'fuel-' + s.time, title: `Eat before ${short(s.name)} at ${hm(s.time)}`,
        body: `${lowQuick ? `It needs ${s.need}% in the quick store and you will start at ${s.pct}%.` : `Your legs will start at ${s.legs_pct}% and it needs ${s.need_legs}%.`} ${lowQuick ? 'Have 30 to 40 g of carbs now: toast with honey, or a bottle of Tailwind.' : 'Eat the pre-ride carbs on the plan and keep the effort honest.'}`, url: '/#fuel' });
  }
  const eaten = (day.entries || []).filter(e => e && !e.supplement && (e.kcal || 0) > 0);
  // nothing logged by early afternoon: every number later today rests on the journal
  if (nowMin >= 13 * 60 + 30 && nowMin < 15 * 60 && !eaten.length)
    out.push({ key: 'journal', title: 'Nothing in the journal yet today', body: 'Log what you have eaten so far, by voice or a photo, so the rest of today\'s numbers are right.', url: '/#food' });
  // protein far behind in the evening, while dinner can still fix it
  const t = day.target || {}, a = day.actual || {};
  if (nowMin >= 18 * 60 + 30 && nowMin < 20 * 60 && eaten.length && t.protein_g && a.protein_g != null && a.protein_g < 0.6 * t.protein_g)
    out.push({ key: 'protein', title: `Protein: ${Math.round(a.protein_g)} of ${t.protein_g} g`, body: `About ${Math.round(t.protein_g - a.protein_g)} g to go. Put 50 g or more on the dinner plate, and a Huel shake after if that still leaves you short.`, url: '/#food' });
  return out;
}

// ---- the doing ---------------------------------------------------------------------------------------
async function push(payload) { if (SANDBOX) return { skipped: 'the copy sends nothing' }; try { return await require('./push').send(payload); } catch (e) { return { error: e.message }; } }

const MORNING = 'This is his MORNING BRIEFING, written once at the start of the day and sent to his phone before he has asked anything: take no actions and make no offer. Under 85 words, plain speech, no lists, to him as "you". If the WHAT GOT BETTER line names a move today or this week, open with it in one sentence, the link and its number ("Sleep is green: 7 hours a night this week, up from amber"). Then, in this order: last night (the LAST NIGHT line; if there is no reading say the watch has not synced and move on) and this morning\'s recovery if there is one; today\'s sessions with their times and where (a rest day is said as one, plainly); the first meal and the one fuelling thing that matters for today\'s first session; then the one thing to watch today, from the chain or the notebook. Every time and number from the lines you were given, nothing from memory. No greeting beyond "Morning."';
async function morning(force) {
  const today = tz.todayKey();
  const kept = await getJSON('coach-morning', null);
  if (!force && kept && kept.date === today) return { kept: true };
  // the night and the chain are read first, so the briefing has this morning's numbers (chain.js keeps sleep-last)
  await race(require('./chain').report(), 12000, null);
  const V = require('./voice'); V.contextStale();
  const u = await V.understand('Give me my morning briefing.', [], MORNING);
  const text = String(u.reply || '').trim().slice(0, 700);
  if (!text) return { error: 'no briefing written' };
  const doc = { date: today, text, at: new Date().toISOString() };
  await setJSON('coach-morning', doc);
  const sent = await push({ title: 'Morning · your day', body: text.slice(0, 220), tag: 'way-morning-' + today, url: '/#today' });
  return { written: true, text, sent };
}

async function alerts(nowMin, force) {
  const today = tz.todayKey();
  const log = await getJSON('coach-alerts', { date: today, sent: {} });
  if (log.date !== today) { log.date = today; log.sent = {}; }   // recent_wins is kept across days
  // the day's report is the costly read: only when a rule could fire. A session 45 to 100 minutes off (the reminder
  // plan keeps today's sessions), or one of the two clock windows not yet used
  let near = false;
  try { const plan = await getJSON('push-plan', null); near = !!(plan && plan.date === today && (plan.sessions || []).some(s => s.start - nowMin >= 45 && s.start - nowMin <= 100)); } catch (e) { near = false; }
  const clock = (nowMin >= 13 * 60 + 30 && nowMin < 15 * 60 && !log.sent.journal) || (nowMin >= 18 * 60 + 30 && nowMin < 20 * 60 && !log.sent.protein);
  if (!force && !near && !clock) return { checked: false };
  const day = await race(require('./food').dayReport(today), 15000, null);
  const due = alertsFor(day, nowMin).filter(a => !log.sent[a.key]);
  const out = [];
  for (const a of due) {
    const sent = await push({ title: a.title, body: a.body, tag: `way-coach-${today}-${a.key}`, url: a.url });
    log.sent[a.key] = { at: new Date().toISOString(), title: a.title, body: a.body };
    out.push({ key: a.key, title: a.title, sent });
  }
  if (out.length) await setJSON('coach-alerts', log);
  return { checked: true, sent: out };
}

// a link turned green: said to his phone when it is seen, one a day at the most, and each link once in three days
// (pure: winDue; the chain's last read is where the wins are kept)
function winDue(wins, log, today) {
  if (!wins || !wins.length || Object.keys((log && log.sent) || {}).some(k => /^win-/.test(k))) return null;
  const recent = (log && log.recent_wins) || {};
  return wins.find(w => w.to === 'good' && !(recent[w.key] && recent[w.key] >= tz.shiftKey(today, -2))) || null;
}
async function win() {
  const today = tz.todayKey(), last = await getJSON('chain-last', null);
  if (!last || !Array.isArray(last.wins) || !last.wins.length || Date.now() - (last.at || 0) > 3 * 3600e3) return { checked: false };
  const log = await getJSON('coach-alerts', { date: today, sent: {} }), carried = log.recent_wins || {};
  if (log.date !== today) { log.date = today; log.sent = {}; }
  const w = winDue(last.wins, log, today); if (!w) return { checked: true };
  const title = `${w.name} is green`, body = `${w.text}.`;
  const sent = await push({ title, body, tag: `way-coach-${today}-win`, url: '/#today' });
  log.sent['win-' + w.key] = { at: new Date().toISOString(), title, body }; log.recent_wins = Object.assign({}, carried, { [w.key]: today });
  await setJSON('coach-alerts', log);
  return { checked: true, sent: { key: w.key, title, sent } };
}
const reviewText = (mon) => { const sun = tz.shiftKey(mon, 6), next = tz.shiftKey(mon, 7);
  return `WEEKLY REVIEW of the week ${mon} to ${sun} (Monday to Sunday). Read /history?from=${mon}&to=${sun}, /history/patterns, /chain, /calendar?from=${mon}&to=${sun}, /lifts, /weigh-in, /planner/model and /planner/week?from=${next}. Use only numbers from the pages; where a page has no number for something, say it is not on record rather than estimate it.
Then answer in exactly this shape:
SAY: one sentence to him, warm and specific: the week in a line, by its most telling number.

**The week**: riding done against planned (hours and sessions), the hard sessions, the lifts done of the five, sleep (the nights' average and the shortest night), food (the average score and protein), weight (the latest weigh-in against the one a week before). Three or four lines.
**What worked**: every link of the chain that moved up a colour this week and held (/chain gives them as wins_week), by name with its number, and one or two things he did, each with its day, that are worth repeating. Lead the answer with these.
**The one thing to change**: the first broken link of the chain this week, what it cost him, and the one concrete habit that mends it next week. One thing only.
**Next week**: the week as the planner lays it out (/planner/week): the hours, the hard days, and anything on the calendar that needs a decision from him (a trip, a rest day, a clash). End by telling him he can say "plan my week" to the coach to have it written.
Under 230 words. Every time in the 12-hour clock.`; };
async function review(week, base) {
  const C = require('./coach');
  const id = await C.startJob(reviewText(week), base, { kind: 'review', week_of: week });
  await setJSON('coach-review', { week_of: week, status: 'running', job_id: id, at: new Date().toISOString() });
  return { started: id, week_of: week };
}
// coach.js calls this when the review's job ends
async function reviewDone(job) {
  if (job.status !== 'done') { await setJSON('coach-review', { week_of: job.week_of, status: 'error', error: job.error || 'it did not finish', at: new Date().toISOString() }); return; }
  await setJSON('coach-review', { week_of: job.week_of, status: 'done', say: job.say, answer: job.answer, at: job.finished });
  const p = tz.parts(new Date()), R = await race(require('./sleep-window').get(), 2000, null) || DEFAULT_R;
  if (mayReach(p.h * 60 + p.mi, R)) await push({ title: 'Your week in review', body: String(job.say || '').slice(0, 220), tag: 'way-review-' + job.week_of, url: '/#today' });
}

// every five minutes
async function tick(now) {
  if (SANDBOX) return { skipped: 'the copy does nothing on a schedule' };
  const today = tz.todayKey(), p = tz.parts(now || new Date()), nowMin = p.h * 60 + p.mi, dow = new Date(today + 'T12:00:00Z').getUTCDay();
  const R = await race(require('./sleep-window').get(), 2000, null) || DEFAULT_R;
  const out = { now: nowMin };
  if (!mayReach(nowMin, R)) return Object.assign(out, { quiet: true });
  try { if (morningDue(nowMin, R, await getJSON('coach-morning', null), today)) out.morning = await morning(); } catch (e) { out.morning = { error: e.message }; }
  try { out.alerts = await alerts(nowMin); } catch (e) { out.alerts = { error: e.message }; }
  try { out.win = await win(); } catch (e) { out.win = { error: e.message }; }
  try { const week = reviewDue(today, dow, nowMin, R, await getJSON('coach-review', null));
    if (week) out.review = await review(week, (process.env.URL || 'https://thewayforward.netlify.app').replace(/\/$/, '')); } catch (e) { out.review = { error: e.message }; }
  return out;
}

async function state() {
  const today = tz.todayKey();
  const [m, a, r] = await Promise.all([getJSON('coach-morning', null), getJSON('coach-alerts', null), getJSON('coach-review', null)]);
  // the review stays on the Day page for the Sunday it is written and the Monday after
  const fresh = r && r.status === 'done' && r.week_of && today <= tz.shiftKey(r.week_of, 7);
  return { morning: m && m.date === today ? m : null,
    alerts: a && a.date === today ? Object.keys(a.sent || {}).map(k => Object.assign({ key: k }, a.sent[k])) : [],
    review: r ? (fresh ? r : { week_of: r.week_of, status: r.status, at: r.at, shown: false }) : null };
}

function attach(app) {
  const { auth } = require('./fuel-log');
  app.get('/coach/first', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await state()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/coach/first/run', async (req, res) => { if (!auth(req, res)) return;
    try {
      const kind = String((req.body || {}).kind || ''), p = tz.parts(new Date()), nowMin = (req.body || {}).now_min != null ? Number(req.body.now_min) : p.h * 60 + p.mi;
      const host = req.get('x-forwarded-host') || req.get('host') || '', base = /(^|\.|--)thewayforward\.netlify\.app$/.test(host) ? 'https://' + host : 'https://thewayforward.netlify.app';
      if (kind === 'morning') return res.json(await morning(true));
      if (kind === 'alerts') return res.json(await alerts(nowMin, true));
      if (kind === 'review') { const today = tz.todayKey(), dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; return res.json(await review(String((req.body || {}).week_of || tz.shiftKey(today, -dow)), base)); }
      res.status(400).json({ error: 'kind: morning, alerts or review' });
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, tick, state, morning, alerts, review, reviewDone, alertsFor, mayReach, morningDue, reviewDue, reviewText, winDue, win };
