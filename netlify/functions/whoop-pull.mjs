// Every 30 minutes, with nobody on the page: pull the night's sleep and
// recovery from WHOOP so the day's boxes are current when the app opens.
// The page itself also pulls when it is opened and the copy is older than
// ten minutes; this is the one that runs while the phone is in a pocket.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export default async () => {
  const { sleepLatest } = require('../../bridge/whoop.js');
  try {
    const { keepWarm } = require('../../bridge/whoop.js');
    await keepWarm().catch(() => {});
    const r = await sleepLatest({ sync: true });
    return new Response(JSON.stringify({ ok: true, synced_at: r && r.synced_at, auth_error: r && r.auth_error || null }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { schedule: '*/30 * * * *' };
