// The Way — the workout player's bridge (Express, shared by server.js locally and the Netlify Function in
// production). No listen() here.
// Since 26 Nov 2026 The Way is only the workout player, and free: Harry plans, logs and is coached inside Claude.
// The workouts come from intervals.icu, the finished ride goes back to intervals.icu. Everything else the site
// used to do (the Day, Calendar, Food, the coaches, the logs) was taken off; it is all in git history.
const express = require('express');
const path = require('path');
require('./sandbox');      // a preview never writes outside itself (no upload to intervals.icu from a preview)
require('./free-guard');   // no paid service is ever called (free-guard.js)
const { ON_NETLIFY, SANDBOX, withScope, getJSON, setJSON } = require('./storage');
const W = require('./workout-math');
const { auth } = require('./auth');
const app = express();
app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => (req.method === 'GET' ? withScope(next) : next()));
app.get('/sandbox', (req, res) => res.json({ sandbox: !!SANDBOX }));
app.get('/status', (req, res) => res.json({ ok: true, app: 'the-way-player', sandbox: !!SANDBOX }));
// The planning numbers the player rides at: FTP 175, LTHR 139 unless Harry changes them (only he does).
app.get('/workouts/settings', async (req, res) => { if (!auth(req, res)) return; res.json(W.settingsOf(await getJSON('workout-settings', W.DEFAULTS))); });
app.put('/workouts/settings', async (req, res) => { if (!auth(req, res)) return;
  const st = W.settingsOf(Object.assign({}, await getJSON('workout-settings', W.DEFAULTS), req.body || {}));
  await setJSON('workout-settings', st); res.json(st); });
require('./player').attach(app);       // the session to ride, the finished ride, the trainer test page's findings
require('./intervals').attach(app);    // /intervals/ping and /intervals/status: is intervals.icu connected
require('./thresholds').attach(app);   // the Tymewear lines (VT1, VT2) the player's zones are drawn from
if (!ON_NETLIFY) app.use(express.static(path.join(__dirname, '..', 'pwa')));
module.exports = app;
