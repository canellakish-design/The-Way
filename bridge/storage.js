// Storage layer: Netlify Blobs in production, local JSON files on the PC.
const fs = require('fs');
const path = require('path');

const ON_NETLIFY = !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT ||
                      process.env.AWS_LAMBDA_FUNCTION_NAME);

// The copy (THE_WAY_SANDBOX=1, set by netlify.toml for the "copy" branch and deploy previews) keeps
// its own store: it reads the real store where it has nothing of its own yet, so it opens on a snapshot
// of the real data, and every write stays in the copy. The one exception is the login keys of the
// services whose refresh tokens rotate (Strava, WHOOP, Withings, RWGPS): a refresh in the copy is
// written through, so the real site's login never goes stale.
const SANDBOX = process.env.THE_WAY_SANDBOX === '1';
const MAIN = 'the-way', COPY = 'the-way-copy';
const WRITE_THROUGH = new Set(['strava', 'whoop', 'withings', 'rwgps']);
const storeP = {};
function store(name) {
  name = name || (SANDBOX ? COPY : MAIN);
  if (!storeP[name]) {
    storeP[name] = import('@netlify/blobs').then(m => {
      const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID || '';
      const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN || '';
      if (siteID && token) {
        return m.getStore({ name, siteID, token });
      }
      // try auto-config last
      return m.getStore(name);
    });
  }
  return storeP[name];
}
function file(key) { return path.join(__dirname, key + '.json'); }

async function getJSON(key, fallback) {
  if (ON_NETLIFY) {
    try {
      const s = await store();
      let v = await s.get(key, { type: 'json' });
      if (v == null && SANDBOX) v = await (await store(MAIN)).get(key, { type: 'json' });
      return v == null ? fallback : v;
    } catch (e) {
      console.error('[storage] getJSON failed:', e.message);
      return fallback;
    }
  }
  try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); }
  catch { return fallback; }
}
async function setJSON(key, val) {
  if (ON_NETLIFY) {
    const s = await store();
    await s.setJSON(key, val);
    if (SANDBOX && WRITE_THROUGH.has(key)) await (await store(MAIN)).setJSON(key, val);
    return;
  }
  fs.writeFileSync(file(key), JSON.stringify(val, null, 2));
}
module.exports = { getJSON, setJSON, ON_NETLIFY, SANDBOX };
