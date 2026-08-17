// ============================================================
// withings.test.js — the scale's disconnect path, which is what you reach for
// when the wrong account got connected. The default keeps a true history; the
// purge is for the case where the readings were never yours.
// Run: node bridge/withings.test.js
// ============================================================
process.env.TZ = 'UTC';               // production runs UTC; the app zone is Eastern
process.env.FUEL_TOKEN = 'test-fuel-token';

const { stubStorage, serve, checker } = require('./test-helpers');
const ok = checker();

const TOKEN_Q = { headers: { 'x-fuel-token': process.env.FUEL_TOKEN } };
const ago = d => Date.now() - d * 864e5;

function fresh(seed) {
  const store = stubStorage(seed);
  for (const p of ['./withings-weight', './fuel-log'])
    delete require.cache[require.resolve(p)];
  return { store, withings: require('./withings-weight') };
}

// A store with the three kinds of entry that end up side by side: the athlete's
// own typed weights, readings mirrored from a real scale, and readings mirrored
// from a demo account that the app knew was demo.
const seedWith = extra => Object.assign({
  withings: { tokens: { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600e3 },
    weights: [{ ts: ago(1), kg: 81.9 }], updatetime: 1680497967, demo: false },
  'weigh-in': { entries: [
    { ts: ago(30), lb: 205, source: 'manual' },
    { ts: ago(20), lb: 203, source: 'shortcut' },
    { ts: ago(10), lb: 201, source: 'withings' },
    { ts: ago(5), lb: 200, source: 'withings' },
    { ts: ago(2), lb: 239, source: 'withings (demo)', demo: true }
  ] }
}, extra || {});

async function main() {

ok.section('/withings/disconnect — the default');
{
  const { store, withings } = fresh(seedWith());
  const app = await serve(withings.attach);
  const r = await app.get('/withings/disconnect', TOKEN_Q);
  ok('it answers ok', r.status === 200 && r.json.ok === true && r.json.disconnected === true,
    r.text.slice(0, 80));
  ok('the tokens are dropped', store.withings.tokens === null);
  ok("the scale's own store is emptied", store.withings.weights.length === 0);
  ok('and the sync cursor with it, so reconnecting backfills',
    store.withings.updatetime === null, String(store.withings.updatetime));
  ok('the demo flag is reset', store.withings.demo === false);
  const left = store['weigh-in'].entries.map(e => e.source);
  ok('a reading the app knew was demo is taken back out',
    !left.includes('withings (demo)'), JSON.stringify(left));
  ok('but a real scale history survives — it is still true',
    left.filter(s => s === 'withings').length === 2, JSON.stringify(left));
  ok('and so does everything typed in by hand',
    left.includes('manual') && left.includes('shortcut'), JSON.stringify(left));
  ok('it reports how many it removed', r.json.readings_removed === 1, String(r.json.readings_removed));
  ok('and that it did not purge', r.json.purged === false);
  await app.close();
}

ok.section('/withings/disconnect?purge=1 — the wrong account was connected');
{
  const { store, withings } = fresh(seedWith());
  const app = await serve(withings.attach);
  const r = await app.get('/withings/disconnect?purge=1', TOKEN_Q);
  const left = store['weigh-in'].entries.map(e => e.source);
  ok('every reading the scale mirrored goes, flagged demo or not',
    !left.some(s => String(s).startsWith('withings')), JSON.stringify(left));
  ok("the athlete's own entries are left alone",
    left.sort().join(',') === 'manual,shortcut', JSON.stringify(left));
  ok('it reports the count', r.json.readings_removed === 3, String(r.json.readings_removed));
  ok('and says it purged', r.json.purged === true);
  ok('the scale store is cleared the same way', store.withings.tokens === null
    && store.withings.weights.length === 0);
  await app.close();
}
{
  // The case this was written for: a demo account authorized through the
  // ordinary flow, so nothing is flagged and the default would leave it all.
  const { store, withings } = fresh({
    withings: { tokens: { access_token: 'a' }, weights: [{ ts: ago(1200), kg: 108.4 }], demo: false },
    'weigh-in': { entries: [
      { ts: ago(1), lb: 178, source: 'manual' },
      { ts: ago(1200), lb: 239, source: 'withings' },
      { ts: ago(1201), lb: 143.7, source: 'withings' },
      { ts: ago(1202), lb: 249.8, source: 'withings' }
    ] }
  });
  const app = await serve(withings.attach);
  const plain = await app.get('/withings/disconnect', TOKEN_Q);
  ok('unflagged demo readings survive a plain disconnect — which is the trap',
    plain.json.readings_removed === 0
      && store['weigh-in'].entries.filter(e => e.source === 'withings').length === 3,
    String(plain.json.readings_removed));
  const purged = await app.get('/withings/disconnect?purge=1', TOKEN_Q);
  ok('the purge is what clears them', purged.json.readings_removed === 3,
    String(purged.json.readings_removed));
  ok('leaving the hand-typed weight behind',
    store['weigh-in'].entries.length === 1 && store['weigh-in'].entries[0].source === 'manual',
    JSON.stringify(store['weigh-in'].entries.map(e => e.source)));
  await app.close();
}
{
  const { withings } = fresh({ withings: { tokens: null, weights: [] }, 'weigh-in': { entries: [] } });
  const app = await serve(withings.attach);
  const r = await app.get('/withings/disconnect?purge=1', TOKEN_Q);
  ok('disconnecting when nothing is connected is harmless',
    r.status === 200 && r.json.readings_removed === 0, r.text.slice(0, 60));
  ok('it needs a credential', (await app.get('/withings/disconnect')).status === 401);
  await app.close();
}

ok.section('/withings/status');
{
  const { withings } = fresh(seedWith());
  const app = await serve(withings.attach);
  const s = (await app.get('/withings/status', TOKEN_Q)).json;
  ok('it reports connected with a count', s.connected === true && s.weigh_ins === 1,
    JSON.stringify(s));
  ok('and the sync cursor, which is what dates the last reading',
    s.last_updatetime === 1680497967, String(s.last_updatetime));
  ok('status needs a credential', (await app.get('/withings/status')).status === 401);
  await app.close();
}
{
  const { withings } = fresh({ withings: { tokens: null, weights: [], demo: false } });
  const app = await serve(withings.attach);
  const s = (await app.get('/withings/status', TOKEN_Q)).json;
  ok('never connected reads as connected:false', s.connected === false && s.weigh_ins === 0,
    JSON.stringify(s));
  ok('connected() agrees', (await withings.connected()) === false);
  await app.close();
}

ok.done();
}

main().catch(e => { console.error(e); process.exit(1); });
