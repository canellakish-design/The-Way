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
    // The scale too: Withings weigh-ins land on their own once it is connected.
    let scale = null;
    try { const W = require('../../bridge/withings-weight.js'); if (await W.connected()) scale = await W.syncMeasures(); } catch (e) { scale = { error: e.message }; }
    // Keep the main function warm: a cold start on a phone's first request
    // of the morning is what reads as "the site is down".
    try { const base = (process.env.URL || '').replace(/\/$/, ''); if (base) await fetch(base + '/.netlify/functions/api/status', { headers: { 'x-the-way-app': '1' } }).catch(() => {}); } catch (e) { /* warmth is a nicety */ }
    const r = await sleepLatest({ sync: true });
    return new Response(JSON.stringify({ ok: true, synced_at: r && r.synced_at, auth_error: r && r.auth_error || null, scale }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { schedule: '*/30 * * * *' };
