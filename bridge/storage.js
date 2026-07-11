// Storage layer: Netlify Blobs in production, local JSON files on the PC.
// One codebase, two homes. All access is async.
const fs = require('fs');
const path = require('path');

const ON_NETLIFY = !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT ||
                      process.env.AWS_LAMBDA_FUNCTION_NAME);

let storeP = null;
function store() {
  if (!storeP) storeP = import('@netlify/blobs').then(m => m.getStore('the-way'));
  return storeP;
}
function file(key) { return path.join(__dirname, key + '.json'); }

async function getJSON(key, fallback) {
  if (ON_NETLIFY) {
    try {
      const s = await store();
      const v = await s.get(key, { type: 'json' });
      return v == null ? fallback : v;
    } catch { return fallback; }
  }
  try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); }
  catch { return fallback; }
}
async function setJSON(key, val) {
  if (ON_NETLIFY) {
    const s = await store();
    await s.setJSON(key, val);
    return;
  }
  fs.writeFileSync(file(key), JSON.stringify(val, null, 2));
}
module.exports = { getJSON, setJSON, ON_NETLIFY };
