// Every five minutes: the supplements and medicines that have come due go to the phone (bridge/push.js),
// and on a class morning the drive to school with live traffic (bridge/commute.js).
// Each goes once, within half an hour of its time, and not at all once it is logged as taken.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default async () => {
  try {
    // the calendars, kept fresh here so pages and the coach read the saved copy at once (bridge/calendar.js)
    const calendar = await require('../../bridge/calendar.js').syncIfStale(4 * 60 * 1000).then(d => ({ synced_at: d.synced_at })).catch(e => ({ error: e.message }));
    const r = await require('../../bridge/push.js').reminders();
    // the drive to school: live traffic on a class morning, "leave now" to the phone (bridge/commute.js)
    const commute = await require('../../bridge/commute.js').check().catch(e => ({ error: e.message }));
    // 8 p.m.: tomorrow's maybes, going or not (bridge/attend.js)
    const attend = await require('../../bridge/attend.js').nightCheck().catch(e => ({ error: e.message }));
    // 8 p.m.: what to pack for tomorrow (bridge/pack.js)
    const pack = await require('../../bridge/pack.js').nightPack().catch(e => ({ error: e.message }));
    return new Response(JSON.stringify(Object.assign({}, r, { calendar, commute, attend, pack })), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { schedule: '*/5 * * * *' };
