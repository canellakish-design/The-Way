// The Way — Express app (shared by server.js locally and the Netlify
// Function in production). No listen() here.
const express = require('express');
const path = require('path');
require('./sandbox');   // the copy of the site never writes outside itself
const { ON_NETLIFY, SANDBOX, withScope } = require('./storage');
const app = express();
app.use(express.json({ limit: '15mb' }));
// a page read (GET) reads each blob once, however many places ask for it (storage.js)
app.use((req, res, next) => (req.method === 'GET' ? withScope(next) : next()));
app.get('/sandbox', (req, res) => res.json({ sandbox: !!SANDBOX }));
require('./fuel-log').attach(app);
require('./plan').attach(app);
require('./weather').attach(app);
require('./courses').attach(app);
require('./chain').attach(app);
require('./coach').attach(app);
require('./player').attach(app);
require('./race').attach(app);
require('./whoop').attach(app);
require('./calendar').attach(app);
require('./ics').attach(app);
require('./intervals').attach(app);
// The plan: workouts authored here, sent to the Garmin through intervals.icu,
// and the week calendar that puts planned next to done.
require('./workouts').attach(app);
// The front page: Training, Recovery, Fatigue.
require('./scores').attach(app);
// Food: the photo journal, scored against the day's guidelines.
require('./food').attach(app);
// Every ride, read: heart rate and breathing from the streams.
require('./rides').attach(app);
require('./flags').attach(app);
require('./voice').attach(app);
require('./macros').attach(app);
require('./intake').attach(app);
require('./status').attach(app);
require('./weighin').attach(app);
require('./fitness').attach(app);
require('./zone-report').attach(app);
require('./advisor').attach(app);
require('./places').attach(app);
require('./wellness').attach(app);
require('./progress').attach(app);
require('./audit').attach(app);
require('./signature').attach(app);
require('./lifts').attach(app);
require('./strava').attach(app);
require('./garmin').attach(app);
require('./thresholds').attach(app);
require('./fresh-start').attach(app);
require('./body').attach(app);
require('./energy-meter').attach(app);
require('./sleep-window').attach(app);
require('./commute').attach(app);
require('./attend').attach(app);
require('./pack').attach(app);
require('./suggest').attach(app);
require('./tts').attach(app);
require('./meds').attach(app);
require('./push').attach(app);
require('./nights').attach(app);
require('./print').attach(app);
require('./kitchen').attach(app);
require('./batches').attach(app);
require('./agent').attach(app);
// The scale runs on the storage layer now, so it works hosted too. It used to
// sit in the local-only block below, which meant /withings/auth was a 404 on
// the deployed site — you could never connect the scale to the real app.
require('./withings-weight').attach(app);
// Local-only extras: static PWA + podcast cache need a real disk.
if (!ON_NETLIFY) {
  try { require('./podcasts')(app); } catch (e) {}
  app.use(express.static(path.join(__dirname, '..', 'pwa')));
}
module.exports = app;
