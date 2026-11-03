// The coach's long questions run here: a Netlify background function (the "-background" name) may run
// for up to fifteen minutes and answers the caller at once with 202. bridge/coach.js starts it and the
// page polls the job it writes.
const coach = require('../../bridge/coach');
require('../../bridge/sandbox');   // the copy of the site never writes outside itself

// anything that would kill the process silently is written to the job, so the page can say what happened
let current = null;
const record = async (what, e) => { try { const { getJSON, setJSON } = require('../../bridge/storage'); if (!current) return; const j = await getJSON('coach-job-' + current, null); if (j) { j.status = 'error'; j.error = `${what}: ${String((e && e.stack) || e).slice(0, 400)}`; await setJSON('coach-job-' + current, j); } } catch (x) { /* nothing more to do */ } console.error('[coach]', what, e); };
process.on('uncaughtException', e => { record('crash', e); });
process.on('unhandledRejection', e => { record('unhandled', e); });

exports.handler = async (event) => {
  let id = null;
  try { id = JSON.parse(event.body || '{}').id; } catch (e) { id = null; }
  // a heartbeat test: {"beat": "name"} writes the seconds alive every five seconds for two minutes
  try { const b = JSON.parse(event.body || '{}').beat; if (b) { const { setJSON } = require('../../bridge/storage'); const t0 = Date.now(); for (let i = 0; i < 24; i++) { await setJSON('coach-beat-' + String(b).replace(/\W/g, ''), { alive_s: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }); await new Promise(r => setTimeout(r, 5000)); } return { statusCode: 200, body: 'beat done' }; } } catch (e) { /* not a beat */ }
  if (!/^[a-f0-9]{12}$/.test(String(id || ''))) return { statusCode: 400, body: 'no job' };
  current = id; console.log('[coach] start', id); await coach.runJob(id, 'background'); console.log('[coach] end', id);
  return { statusCode: 200, body: 'done' };
};
