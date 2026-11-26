// Who may call the bridge: the page itself (the x-the-way-app header, or a same-origin request), or a caller that
// knows FUEL_TOKEN. Moved here from fuel-log.js when the site became the workout player only (26 Nov 2026).
// What it is NOT: secret. Anyone who knows the URL can call these endpoints with a one-line script: the header
// keeps other websites out (a browser cannot send it cross-origin without a preflight this never approves).
const envStr = k => (process.env[k] || '').trim().replace(/^['"]|['"]$/g, '');
const TOKEN = envStr('FUEL_TOKEN');
function sameOrigin(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const src = req.get('origin') || req.get('referer') || '';
  if (!host || !src) return false;
  try { return new URL(src).host === host; } catch { return false; }
}
function auth(req, res) {
  const supplied = req.query.token || req.get('x-fuel-token') || '';
  if (TOKEN && supplied === TOKEN) return true;
  if (req.get('x-the-way-app') === '1' || sameOrigin(req)) return true;
  res.status(401).json({ ok: false, error: 'bad token' }); return false;
}
module.exports = { auth };
