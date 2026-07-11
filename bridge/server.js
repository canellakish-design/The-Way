// ============================================================
// THE WAY — Bridge (the brain). Runs on the Zwift PC.
// Env: FUEL_TOKEN, BASE_URL, ANTHROPIC_API_KEY,
//      WITHINGS_CLIENT_ID/SECRET, WHOOP_CLIENT_ID/SECRET,
//      STRAVA_VERIFY_TOKEN, HOME_LAT, HOME_LON
// ============================================================
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json({ limit: '15mb' })); // meal photos ride through here

require('./fuel-log')(app);
require('./withings-weight')(app);
require('./whoop')(app);
require('./strava')(app);
require('./prescriptions')(app);
require('./agent')(app);
require('./podcasts')(app);
require('./weather')(app);
require('./plan')(app);

// The PWA is served by the bridge itself — one origin, no CORS.
app.use(express.static(path.join(__dirname, '..', 'pwa')));

const PORT = process.env.PORT || 8420;
app.listen(PORT, () => console.log('[the-way] bridge up on :' + PORT));
