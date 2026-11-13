// ============================================================
// push.js — reminders on the phone (Harry, 9 Nov 2026): each supplement and medicine at its time, as a
// notification with a "Taken" button that logs it. Web Push to the installed app (on an iPhone the app
// must be on the Home Screen, iOS 16.4 and later; there the notification opens a one-tap "Taken" page).
// The VAPID key pair is made here on first use and kept in the store ('push-vapid'): nothing secret is in
// the repository. The phone's subscriptions are kept in 'push-subs'. reminders() runs every five minutes
// (netlify/functions/reminders.mjs) and sends what has come due in the last half hour, once, unless it is
// already taken. Items due at the same minute go in one notification (10:00 p.m.: BP medicine and eye drops).
//   GET  /push/key                     { publicKey }
//   POST /push/subscribe { subscription }   POST /push/unsubscribe { endpoint }
//   POST /push/test                    a test notification to every subscribed phone
//   GET  /push/due                     what is due today and what has been sent (for Setup)
// The copy (THE_WAY_SANDBOX) never sends on a schedule: it would reach the same phone twice.
// ============================================================
const { getJSON, setJSON, SANDBOX } = require('./storage');
const tz = require('./tz');
const WINDOW_MIN = 30;               // a reminder goes out up to half an hour after its time, never later
const CREATINE_AT = '12:00';         // creatine is any time: reminded at noon if not yet taken
const SUBJECT = 'https://thewayforward.netlify.app';

let wpMod = null;
const wp = () => wpMod || (wpMod = require('web-push'));
async function vapid() {
  let k = await getJSON('push-vapid', null);
  if (!k || !k.publicKey || !k.privateKey) { k = Object.assign(wp().generateVAPIDKeys(), { at: new Date().toISOString() }); await setJSON('push-vapid', k); }
  return k;
}
async function subs() { const d = await getJSON('push-subs', { subs: [] }); return d.subs || []; }
async function subscribe(sub, ua) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) { const e = new Error('not a push subscription'); e.status = 400; throw e; }
  const list = (await subs()).filter(s => s.endpoint !== sub.endpoint);
  list.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: new Date().toISOString(), ua: String(ua || '').slice(0, 120) });
  await setJSON('push-subs', { subs: list.slice(-6) });
  return { ok: true, devices: list.length };
}
async function unsubscribe(endpoint) {
  const list = (await subs()).filter(s => s.endpoint !== endpoint);
  await setJSON('push-subs', { subs: list });
  return { ok: true, devices: list.length };
}
// one notification to every phone; a phone that has gone away (404/410) is dropped
async function send(payload) {
  const k = await vapid(); const list = await subs();
  wp().setVapidDetails(SUBJECT, k.publicKey, k.privateKey);
  let sent = 0; const gone = [], errors = [];
  for (const s of list) {
    try { await wp().sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 1800, urgency: 'high' }); sent++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.endpoint); else errors.push(`${e.statusCode || ''} ${String(e.body || e.message).slice(0, 120)}`); }
  }
  if (gone.length) await setJSON('push-subs', { subs: list.filter(s => !gone.includes(s.endpoint)) });
  return { sent, devices: list.length, dropped: gone.length, errors };
}

const toMin = t => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
const toHM = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
// Harry, 9 Nov: "If I have a late session, make the reminder after the session." A reminder that falls
// inside a session (from its start to its end) moves to 10 minutes after it ends. sessions: [{ start, end }]
// in minutes. The pre-ride doses are timed before their ride and never fall inside it.
const AFTER_MIN = 10;
function shiftAfter(items, sessions) {
  const ss = (sessions || []).filter(x => x && x.start != null && x.end > x.start).sort((a, b) => a.start - b.start);
  return (items || []).map(x => {
    let t = toMin(x.time); if (t == null) return x;
    for (const s of ss) if (t >= s.start && t < s.end) t = s.end + AFTER_MIN;   // sessions in order: one ending into the next moves on again
    return t === toMin(x.time) ? x : Object.assign({}, x, { time: toHM(Math.min(t, 1439)), moved_from: x.time, after_session: true });
  });
}
const sessionsOf = r => ((r && r.sessions) || []).filter(x => toMin(x.time) != null).map(x => ({ start: toMin(x.time), end: toMin(x.time) + (x.minutes || 60), name: x.name }));
// today's reminders: the supplements the day report schedules (kept 20 minutes) and the medicines
async function dueToday(date) {
  let plan = await getJSON('push-plan', null);
  if (!plan || plan.date !== date || Date.now() - Date.parse(plan.at) > 20 * 60000) {
    const r = await require('./food').dayReport(date).catch(() => null);
    const due = ((r && r.supps && r.supps.due) || []).map(x => ({ kind: 'supp', key: x.key, name: x.name, short: x.key === 'sodium_bicarb' ? 'bicarbonate' : x.key === 'magnesium' ? 'magnesium' : x.key === 'creatine' ? 'creatine' : x.key,
      time: x.time || (x.key === 'creatine' ? CREATINE_AT : null), why: x.why || '' })).filter(x => x.time);
    plan = { date, at: new Date().toISOString(), supps: due, sessions: sessionsOf(r) };
    await setJSON('push-plan', plan).catch(() => {});
  }
  const doc = await getJSON('food-' + date, { entries: [] }).catch(() => ({ entries: [] }));
  const tookSupp = k => (doc.entries || []).some(e => e && e.supplement && e.key === k);
  const meds = (await require('./meds').today()).due.map(m => ({ kind: 'med', key: m.key, name: m.name, short: m.short, time: m.time, why: '', taken: m.taken }));
  const items = shiftAfter(plan.supps.map(x => Object.assign({}, x, { taken: tookSupp(x.key) })).concat(meds), plan.sessions);
  // and out of classes, games, drives and his own blocks, as the Day page shows it (dayplan.js placeDose)
  try {
    const DP = require('./dayplan');
    const ev = await require('./calendar').eventsBetween(date, date);
    const blocks = DP.blocksOf(ev, { date, categories: new Set(['work', 'coaching', 'commute', 'travel', 'family', 'busy']) });
    const win = await require('./sleep-window').get().catch(() => null);
    for (const x of items) {
      const t = toMin(x.time); if (t == null || x.taken) continue;
      const p = DP.placeDose(t, 10, blocks, win ? win.wake : null);
      if (p.moved) { x.moved_from = x.moved_from || x.time; x.time = toHM(p.min); }
    }
  } catch (e) { /* the times stand */ }
  return items.sort((a, b) => a.time.localeCompare(b.time));
}
// the notification for the items due at one time
function payloadFor(date, items) {
  const names = items.map(x => x.name);
  const time = tz.hm12(items[0].time);
  return { title: `${time} · ${items.length === 1 ? names[0] : names.join(' + ')}`,
    body: items.map(x => x.why).filter(Boolean).join(' · ') || 'Tap Taken when it is done.',
    tag: `way-${date}-${items[0].time}`, date, items: items.map(x => ({ kind: x.kind, key: x.key, name: x.name })),
    url: '/#take?items=' + items.map(x => `${x.kind}:${x.key}`).join(',') };
}
// what to send now: due in the last half hour, not taken, not sent; grouped by time
function pick(items, nowMin, sent) {
  const due = items.filter(x => !x.taken && !sent[`${x.kind}:${x.key}`] && toMin(x.time) != null && nowMin >= toMin(x.time) && nowMin < toMin(x.time) + WINDOW_MIN);
  const groups = {};
  for (const x of due) (groups[x.time] = groups[x.time] || []).push(x);
  return Object.keys(groups).sort().map(t => groups[t]);
}
async function reminders(now) {
  if (SANDBOX) return { skipped: 'the copy never sends on a schedule' };
  const date = tz.todayKey(), p = tz.parts(now || new Date()), nowMin = p.h * 60 + p.mi;
  if (!(await subs()).length) return { skipped: 'no phone subscribed' };
  const log = await getJSON('push-sent', { date, sent: {} });
  if (log.date !== date) { log.date = date; log.sent = {}; }
  const items = await dueToday(date);
  const out = [];
  for (const group of pick(items, nowMin, log.sent)) {
    const r = await send(payloadFor(date, group));
    for (const x of group) log.sent[`${x.kind}:${x.key}`] = new Date().toISOString();
    out.push({ items: group.map(x => x.key), result: r });
  }
  if (out.length) await setJSON('push-sent', log);
  return { date, now: tz.hm12(String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0')), sent: out };
}

function attach(app) {
  const { auth } = require('./fuel-log');
  const wrap = fn => async (req, res) => { if (!auth(req, res)) return; try { res.json(await fn(req)); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } };
  app.get('/push/key', wrap(async () => ({ publicKey: (await vapid()).publicKey })));
  app.post('/push/subscribe', wrap(req => subscribe((req.body || {}).subscription, req.headers['user-agent'])));
  app.post('/push/unsubscribe', wrap(req => unsubscribe(String((req.body || {}).endpoint || ''))));
  app.post('/push/test', wrap(() => send({ title: 'The Way · reminders are on', body: 'Supplements and medicines will come here at their times.', tag: 'way-test', items: [], url: '/#today' })));
  app.get('/push/due', wrap(async () => { const date = tz.todayKey(); const log = await getJSON('push-sent', { date, sent: {} }); return { date, devices: (await subs()).length, items: await dueToday(date), sent: log.date === date ? log.sent : {} }; }));
}
module.exports = { attach, shiftAfter, sessionsOf, reminders, dueToday, payloadFor, pick, send, subscribe, unsubscribe, vapid, WINDOW_MIN };
