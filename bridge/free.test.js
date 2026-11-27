// node bridge/free.test.js — The Way runs free (26 Nov 2026): no paid service is ever called, the site is the
// workout player only, and a finished ride is always kept, whatever happens with intervals.icu.
const assert = require('assert');
const storage = require('./storage');
const mem = {};
storage.getJSON = async (k, f) => (k in mem && mem[k] !== null ? JSON.parse(JSON.stringify(mem[k])) : f);
storage.setJSON = async (k, v) => { mem[k] = v === null ? null : JSON.parse(JSON.stringify(v)); };
const seen = [];
globalThis.fetch = async (u) => { seen.push(String(u)); return new Response('[]', { status: 200 }); };
const G = require('./free-guard');
let n = 0; const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('ok ' + name); });

(async () => {
  await ok('a paid service is refused before it leaves: Claude, OpenAI, TomTom', async () => {
    for (const u of ['https://api.anthropic.com/v1/messages', 'https://api.openai.com/v1/audio/speech', 'https://api.tomtom.com/routing/1/x'])
      await assert.rejects(fetch(u, { method: 'POST' }), /paid service/);
    assert.strictEqual(seen.length, 0, 'nothing reached the network');
  });
  await ok('the free services still pass: intervals.icu, Strava, Google, open-meteo', async () => {
    for (const u of ['https://intervals.icu/api/v1/athlete/i1/activities', 'https://www.strava.com/api/v3/uploads', 'https://www.googleapis.com/calendar/v3/x', 'https://api.open-meteo.com/v1/forecast'])
      await fetch(u);
    assert.strictEqual(seen.length, 4); assert.ok(!G.isPaid('https://intervals.icu/api/v1'));
  });
  await ok('the paid features are gone from the app', async () => {
    const fs = require('fs'), path = require('path');
    for (const f of ['coach-first.js', 'advisor.js', 'agent.js', 'kitchen.js', 'batches.js', 'tts.js']) assert.ok(!fs.existsSync(path.join(__dirname, f)), f + ' is still here');
    for (const f of ['coach-background.js', 'coach-first.mjs']) assert.ok(!fs.existsSync(path.join(__dirname, '..', 'netlify', 'functions', f)), f + ' is still here');
    for (const f of fs.readdirSync(__dirname).filter(x => /\.js$/.test(x) && !/\.test\.js$/.test(x) && x !== 'free-guard.js'))
      assert.ok(!/https:\/\/api\.(anthropic|openai|tomtom)\.com/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')) || /TomTom \(paid\) taken out/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')), f + ' still calls a paid service');
    const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
    assert.ok(/require\('\.\/free-guard'\)/.test(app));
    for (const m of ['coach', 'advisor', 'coach-first', 'tts', 'kitchen', 'batches', 'agent']) assert.ok(!new RegExp(`require\\('\\./${m}'\\)\\.attach`).test(app), m + ' is still attached');
  });
  await ok('a ride is kept when intervals.icu is not reachable, and says why it did not go', async () => {
    const P = require('./player');
    const start = Date.now() - 3600e3;
    const r = await P.saveRide({ summary: { start_ms: start, name: 'Z1 trainer 60 min', ftp: 175 },
      samples: { t: [0, 1, 2, 3], p: [120, 121, 122, 120], c: [88, 88, 89, 88], h: [108, 110, 111, 112], s: [30, 30, 30, 30] }, fit_base64: 'AAAA' });
    assert.strictEqual(r.stored, true); assert.strictEqual(r.ok, false); assert.ok(r.error);
    assert.ok(mem[P.rideKey(start)] && mem[P.rideKey(start)].samples.t.length === 4, 'the seconds are stored');
    assert.ok(mem[P.INDEX].rides.some(x => x.id === start && x.upload_error), 'the ride is on the index, with the reason it did not upload');
  });
  await ok('the player page always saves: End saves, nothing throws a ride away by itself', async () => {
    const src = require('fs').readFileSync(require.resolve('../pwa/player.js'), 'utf8');
    assert.ok(/End always saves the ride\./.test(src));
    assert.ok(/DB\.del\(x\.id\)/.test(src) && /x\.status === "saved" && Date\.now\(\) - \(x\.updated \|\| x\.id\) > 7 \* 864e5/.test(src), 'only an uploaded ride, a week on, leaves the computer');
    assert.ok(/Retry upload/.test(src) && /Finish and save the ride/.test(src));
  });
  await ok('the heart-rate mode is still there: the trainer\'s watts move to hold the band (Zone 1: 100 to 116, aim 110)', async () => {
    const src = require('fs').readFileSync(require.resolve('../pwa/player.js'), 'utf8');
    assert.ok(/const HR_Z1 = 116/.test(src) && /HR_Z1_AIM = 110/.test(src) && /function seekStep\(iv\)/.test(src) && /ctl\(ergWatts\(want\)/.test(src));
  });
  await ok('the site is the player only: one function, no schedules, no pages but the player', async () => {
    const fs = require('fs'), path = require('path');
    assert.deepStrictEqual(fs.readdirSync(path.join(__dirname, '..', 'netlify', 'functions')), ['api.js']);
    const html = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script src="(?:vendor\/maplibre\/)?([a-z-]+)\.js/g)].map(m => m[1]);
    assert.deepStrictEqual(scripts, ['shell', 'buckets', 'fit', 'edge', 'maplibre-gl', 'course', 'course-map', 'player']);
    assert.ok(!/mapbox\.com|api\.maptiler|stadiamaps|thunderforest|maps\.googleapis/.test(fs.readFileSync(path.join(__dirname, '..', 'pwa', 'course-map.js'), 'utf8')), 'no paid map service');
  });
  console.log(`${n} passed`);
})().catch(e => { console.error(e); process.exit(1); });
