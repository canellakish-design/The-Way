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
require('./prescriptions').attach(app);
require('./whoop').attach(app);
require('./calendar').attach(app);
require('./intervals').attach(app);
require('./macros').attach(app);
require('./intake').attach(app);
require('./status').attach(app);
require('./weighin').attach(app);
require('./fitness').attach(app);
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
