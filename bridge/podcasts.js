// Podcast pre-loader: bridge fetches RSS server-side (no CORS), caches
// newest episode per feed to disk; PWA streams from /podcasts/file/:name.
const fs = require('fs'); const path = require('path');
const TOKEN = process.env.FUEL_TOKEN || '';
const DIR = path.join(__dirname, 'podcast-cache');
const FEEDS_PATH = path.join(__dirname, 'podcast-feeds.json'); // ["https://feed1.rss", ...]
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR);

function feeds(){ try { return JSON.parse(fs.readFileSync(FEEDS_PATH,'utf8')); } catch { return []; } }

async function refresh(){
  for (const f of feeds()){
    try{
      const xml = await (await fetch(f)).text();
      const m = xml.match(/<enclosure[^>]*url="([^"]+)"/);
      const t = (xml.match(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([^\]<]+)/)||[])[1] || 'episode';
      if (!m) continue;
      const name = t.replace(/[^a-z0-9]+/gi,'-').slice(0,60) + '.mp3';
      const out = path.join(DIR, name);
      if (fs.existsSync(out)) continue;
      const audio = await fetch(m[1]);
      fs.writeFileSync(out, Buffer.from(await audio.arrayBuffer()));
      console.log('[podcasts] cached', name);
    }catch(e){ console.error('[podcasts]', f, e.message); }
  }
}
setInterval(refresh, 6*3600*1000); refresh();

module.exports = function(app){
  app.get('/podcasts/list', (req,res)=>{
    if ((req.query.token||'') !== TOKEN) return res.status(401).json({error:'bad token'});
    res.json({ episodes: fs.readdirSync(DIR).filter(f=>f.endsWith('.mp3')) });
  });
  app.get('/podcasts/file/:name', (req,res)=>{
    const p = path.join(DIR, path.basename(req.params.name));
    if (!fs.existsSync(p)) return res.sendStatus(404);
    res.sendFile(p);
  });
};
