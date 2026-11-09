// Every five minutes: the supplements and medicines that have come due go to the phone (bridge/push.js).
// Each goes once, within half an hour of its time, and not at all once it is logged as taken.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default async () => {
  try {
    const r = await require('../../bridge/push.js').reminders();
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { schedule: '*/5 * * * *' };
