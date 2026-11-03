// The workout player (docs/workout-player-spec.md). For now only the spike: the trainer test page
// (pwa/player-test.html) sends what it found on the KICKR CORE and the Tymewear strap, so the
// Bluetooth details can be read here rather than copied by hand.
//   POST /player/spike   { found, log }   -> { ok }
//   GET  /player/spike                    -> the last few results
const { getJSON, setJSON } = require('./storage');
const auth = (req, res) => { if (req.get('x-the-way-app') === '1') return true; res.status(401).json({ error: 'bad token' }); return false; };

function attach(app) {
  app.post('/player/spike', async (req, res) => { if (!auth(req, res)) return;
    const d = await getJSON('player-spike', { runs: [] });
    d.runs = (d.runs || []).concat([Object.assign({ received: new Date().toISOString() }, req.body || {})]).slice(-5);
    await setJSON('player-spike', d);
    res.json({ ok: true, runs: d.runs.length });
  });
  app.get('/player/spike', async (req, res) => { if (!auth(req, res)) return; res.json(await getJSON('player-spike', { runs: [] })); });
}
module.exports = { attach };
