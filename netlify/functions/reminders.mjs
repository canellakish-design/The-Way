// Every five minutes: the supplements and medicines that have come due go to the phone (bridge/push.js),
// and on a class morning the drive to school with live traffic (bridge/commute.js).
// Each goes once, within half an hour of its time, and not at all once it is logged as taken.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default async () => {
  try {
    const r = await require('../../bridge/push.js').reminders();
    // the drive to school: live traffic on a class morning, "leave now" to the phone (bridge/commute.js)
    const commute = await require('../../bridge/commute.js').check().catch(e => ({ error: e.message }));
    return new Response(JSON.stringify(Object.assign({}, r, { commute })), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { schedule: '*/5 * * * *' };
