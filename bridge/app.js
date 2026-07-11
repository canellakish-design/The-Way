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
require('./agent').attach(app);

// Local-only extras: static PWA + podcast cache need a real disk.
if (!ON_NETLIFY) {
  try { require('./podcasts')(app); } catch (e) {}
  try { require('./withings-weight')(app); } catch (e) {}
  try { require('./strava')(app); } catch (e) {}
  app.use(express.static(path.join(__dirname, '..', 'pwa')));
}

module.exports = app;
