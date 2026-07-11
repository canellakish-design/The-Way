// Local runner for the Zwift PC. Netlify uses netlify/functions/api.js.
const app = require('./app');
const PORT = process.env.PORT || 8420;
app.listen(PORT, () => console.log('[the-way] bridge up on :' + PORT));
