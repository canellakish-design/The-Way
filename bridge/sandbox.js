// The copy of The Way (THE_WAY_SANDBOX=1) must never change anything outside itself. This guard sits in
// front of fetch: a write to intervals.icu, to Google Calendar or to Strava's webhook list is answered
// here with a harmless stand-in and never leaves the function. Reads, logins (token refreshes), the
// Anthropic API and Withings (whose reads are POSTs) pass through untouched.
const SANDBOX = process.env.THE_WAY_SANDBOX === '1' || (() => { try { return require('./build-context.json').sandbox === true; } catch (e) { return false; } })();
const BLOCK = [/^https:\/\/intervals\.icu\//, /^https:\/\/www\.googleapis\.com\/calendar\//, /^https:\/\/www\.strava\.com\/api\/v3\/push_subscriptions/];
if (SANDBOX && typeof globalThis.fetch === 'function' && !globalThis.fetch.__sandboxed) {
  const real = globalThis.fetch;
  const guarded = async (url, opts) => {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const method = String((opts && opts.method) || (url && url.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && BLOCK.some(re => re.test(u))) {
      const body = /intervals\.icu/.test(u) ? (method === 'DELETE' ? '' : '[{"id":null,"sandbox":true}]') : JSON.stringify({ id: 'sandbox-' + Date.now(), sandbox: true });
      console.log('[sandbox] held back', method, u.replace(/\?.*$/, ''));
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return real(url, opts);
  };
  guarded.__sandboxed = true;
  globalThis.fetch = guarded;
}
module.exports = { SANDBOX };
