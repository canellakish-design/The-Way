// The Way runs free (Harry, 26 Nov 2026: "bring back The Way, free only"). Every feature that called a paid
// service was taken out; this guard is the backstop. It sits in front of fetch and refuses any request to a
// paid service before it leaves the function, so a forgotten call or a key set by mistake can never cost money.
// Free services (intervals.icu, Strava, Google Calendar, WHOOP, Withings, open-meteo, OpenStreetMap, USDA) pass.
const PAID = [
  /^https:\/\/api\.anthropic\.com\//,   // Claude: the coach, the meal photo reader, the voice coach, the agent
  /^https:\/\/api\.openai\.com\//,      // OpenAI: the coach's spoken voice
  /^https:\/\/api\.tomtom\.com\//       // TomTom: traffic, routing and place search (a paid API with a free allowance)
];
const isPaid = url => { const u = typeof url === 'string' ? url : (url && (url.href || url.url)) || ''; return PAID.some(re => re.test(String(u))); };

if (typeof globalThis.fetch === 'function' && !globalThis.fetch.__freeGuard) {
  const real = globalThis.fetch;
  const guarded = async (url, opts) => {
    if (isPaid(url)) {
      const u = typeof url === 'string' ? url : (url && (url.href || url.url)) || '';
      console.log('[free] refused a paid service:', String(u).replace(/\?.*$/, ''));
      throw new Error('That feature called a paid service and has been removed: The Way runs free.');
    }
    return real(url, opts);
  };
  guarded.__freeGuard = true;
  if (real.__sandboxed) guarded.__sandboxed = true;
  globalThis.fetch = guarded;
}
module.exports = { isPaid, PAID };
