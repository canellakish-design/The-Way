// WHOOP v2: OAuth + webhooks (sleep.updated / recovery.updated) + morning
// reconciliation fetch. Mirrors withings-weight.js. Requires WHOOP membership.
// Verify endpoint/scope names against developer.whoop.com when building.
const fs = require('fs'); const path = require('path');
const STORE = path.join(__dirname, 'whoop.json');
const API = 'https://api.prod.whoop.com';
const CID = process.env.WHOOP_CLIENT_ID || '';
const SEC = process.env.WHOOP_CLIENT_SECRET || '';
const BASE = process.env.BASE_URL || '';
const TOKEN = process.env.FUEL_TOKEN || '';

function load(){ try { return JSON.parse(fs.readFileSync(STORE,'utf8')); }
  catch { return { tokens:null, sleep:null, recovery:null }; } }
function save(db){ fs.writeFileSync(STORE, JSON.stringify(db,null,2)); }

async function tok(db){
  if (!db.tokens) throw new Error('visit /whoop/auth');
  if (Date.now() < db.tokens.expires_at - 60000) return db.tokens.access_token;
  const r = await fetch(API + '/oauth/oauth2/token', { method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({ grant_type:'refresh_token', refresh_token:db.tokens.refresh_token,
      client_id:CID, client_secret:SEC })});
  const d = await r.json();
  db.tokens = { access_token:d.access_token, refresh_token:d.refresh_token,
    expires_at: Date.now() + d.expires_in*1000 };
  save(db); return db.tokens.access_token;
}

async function syncLatest(db){
  const t = await tok(db);
  const h = { Authorization: 'Bearer ' + t };
  const s = await (await fetch(API + '/developer/v2/activity/sleep?limit=1', { headers:h })).json();
  const rec = await (await fetch(API + '/developer/v2/recovery?limit=1', { headers:h })).json();
  if (s.records && s.records[0]) db.sleep = s.records[0];
  if (rec.records && rec.records[0]) db.recovery = rec.records[0];
  save(db);
}

module.exports = function(app){
  app.get('/whoop/auth', (req,res)=>{
    const u = new URL(API + '/oauth/oauth2/auth');
    u.searchParams.set('response_type','code');
    u.searchParams.set('client_id',CID);
    u.searchParams.set('redirect_uri',BASE + '/whoop/callback');
    u.searchParams.set('scope','read:sleep read:recovery offline');
    u.searchParams.set('state','the-way');
    res.redirect(u.toString());
  });
  app.get('/whoop/callback', async (req,res)=>{
    try{
      const r = await fetch(API + '/oauth/oauth2/token', { method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({ grant_type:'authorization_code', code:req.query.code,
          client_id:CID, client_secret:SEC, redirect_uri:BASE + '/whoop/callback' })});
      const d = await r.json();
      const db = load();
      db.tokens = { access_token:d.access_token, refresh_token:d.refresh_token,
        expires_at: Date.now() + d.expires_in*1000 };
      save(db);
      await syncLatest(db);
      res.send('WHOOP connected. Configure webhook URL in the developer dashboard: ' + BASE + '/whoop/webhook');
    }catch(e){ res.status(500).send('WHOOP auth failed: ' + e.message); }
  });
  // Webhooks are configured in WHOOP's dashboard (not via API): point them here.
  app.post('/whoop/webhook', (req,res)=>{
    res.sendStatus(200);
    syncLatest(load()).catch(e=>console.error('[whoop] sync failed:', e.message));
  });
  app.get('/sleep/latest', (req,res)=>{
    if ((req.query.token||'') !== TOKEN) return res.status(401).json({error:'bad token'});
    const db = load();
    // morning reconciliation: webhook delivery isn't guaranteed
    syncLatest(db).catch(()=>{});
    const s = db.sleep, r = db.recovery;
    res.json({
      sleep: s ? { performance: s.score ? s.score.sleep_performance_percentage : null,
                   hours: s.score ? Math.round(s.score.stage_summary.total_in_bed_time_milli/3.6e6*10)/10 : null } : null,
      recovery: r ? { score: r.score ? r.score.recovery_score : null,
                      hrv: r.score ? r.score.hrv_rmssd_milli : null,
                      rhr: r.score ? r.score.resting_heart_rate : null } : null });
  });
};
