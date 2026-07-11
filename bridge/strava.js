// Strava webhook: ride ingest -> ledger ride kcal + Signature inputs.
// v1: stores activity summaries; Signature analysis marked TODO until
// stream-level analysis lands. Subscription is created once via Strava's
// API (see deploy/install-windows.md).
const fs = require('fs'); const path = require('path');
const STORE = path.join(__dirname, 'strava.json');
const VERIFY = process.env.STRAVA_VERIFY_TOKEN || 'the-way';
const TOKEN = process.env.FUEL_TOKEN || '';

function load(){ try { return JSON.parse(fs.readFileSync(STORE,'utf8')); }
  catch { return { rides: [], eftp: null, lthr: null, ef_trend: 'flat' }; } }
function save(db){ fs.writeFileSync(STORE, JSON.stringify(db,null,2)); }

module.exports = function(app){
  // subscription validation handshake
  app.get('/strava/webhook', (req,res)=>{
    if (req.query['hub.verify_token'] === VERIFY)
      return res.json({ 'hub.challenge': req.query['hub.challenge'] });
    res.sendStatus(403);
  });
  app.post('/strava/webhook', (req,res)=>{
    res.sendStatus(200);
    const ev = req.body || {};
    if (ev.object_type === 'activity' && ev.aspect_type === 'create') {
      const db = load();
      db.rides.push({ id: ev.object_id, at: new Date().toISOString() });
      // TODO(Signature): fetch activity + streams with athlete OAuth token,
      // update rolling power curve -> eFTP, EF trend, LTHR estimate.
      save(db);
      console.log('[strava] activity', ev.object_id, 'queued');
    }
  });
  app.get('/signature', (req,res)=>{
    if ((req.query.token||'') !== TOKEN) return res.status(401).json({error:'bad token'});
    const db = load();
    res.json({ eftp: db.eftp, lthr: db.lthr, ef_trend: db.ef_trend,
      confidence: db.eftp ? 'ok' : 'low — no analyzed efforts yet' });
  });
};
