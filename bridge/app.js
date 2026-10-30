// The Way — Express app (shared by server.js locally and the Netlify
// Function in production). No listen() here.
const express = require('express');
const path = require('path');
const { ON_NETLIFY } = require('./storage');
const app = express();
app.use(express.json({ limit: '15mb' }));
require('./fuel-log').attach(app);
require('./plan').attach(app);
require('./weather').attach(app);
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
require('./signature').attach(app);
require('./strava').attach(app);
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
