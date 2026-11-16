// Every five minutes: the coach speaks first (bridge/coach-first.js): the morning briefing once the day has begun,
// the alerts the day's numbers call for, and the week's review on Sunday evening. Its own function, apart from the
// reminders, because the briefing asks the model and must not hold a pill reminder back.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default async () => {
  try {
    const r = await require('../../bridge/coach-first.js').tick();
    return new Response(JSON.stringify(r), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { schedule: '*/5 * * * *' };
