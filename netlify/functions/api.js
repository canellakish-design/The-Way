// The Way bridge as a Netlify Function. Wraps the same Express app the
// Zwift PC runs — no app.listen() here; serverless-http handles requests.
const serverless = require('serverless-http');
const app = require('../../bridge/app');

const handler = serverless(app);

exports.handler = async (event, context) => {
  // strip the function mount so Express sees /agent, /plan, etc.
  event.path = (event.path || '').replace(/^\/\.netlify\/functions\/api/, '') || '/';
  return handler(event, context);
};
