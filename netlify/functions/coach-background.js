// The coach's long questions run here: a Netlify background function (the "-background" name) may run
// for up to fifteen minutes and answers the caller at once with 202. bridge/coach.js starts it and the
// page polls the job it writes.
const coach = require('../../bridge/coach');
require('../../bridge/sandbox');   // the copy of the site never writes outside itself

exports.handler = async (event) => {
  let id = null;
  try { id = JSON.parse(event.body || '{}').id; } catch (e) { id = null; }
  if (!/^[a-f0-9]{12}$/.test(String(id || ''))) return { statusCode: 400, body: 'no job' };
  await coach.runJob(id);
  return { statusCode: 200, body: 'done' };
};
