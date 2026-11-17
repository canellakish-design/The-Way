// The Way as a connector for Claude (17 Nov 2026, Harry: "We need to create a tool for you to be able to write to the web", "The way").
// A Claude session or project that holds this connector can read the site and log to it: food and drink, a medicine or a
// supplement taken, a weigh-in, a nap, a lift, a session put on or changed, a calendar event, and the rest of what the
// coach's do_action does. Every write goes through voice.js run(), the same function the buttons and both coaches use, so
// nothing is logged twice or differently, and every check there still holds.
//   POST /mcp/<WAY_MCP_KEY>   (MCP over HTTP: initialize, tools/list, tools/call; JSON answers, no streams)
// The key is an environment variable Harry sets on Netlify (24 characters or more), never in the repository. Without it
// the connector is off (503). It only logs and plans inside The Way: nothing here sends anything to another person.
const crypto = require('crypto');
const C = require('./coach');
const same = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
const keyOK = (k) => { const want = String(process.env.WAY_MCP_KEY || '').trim(); return want.length >= 24 && !!k && same(String(k).trim(), want); };
const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
// the blank action: do_action's fields are all required in the coach's strict schema; here a caller sends only what the action uses
function blank() { const p = require('./voice').SCHEMA().properties.actions.items.properties; const o = {};
  Object.keys(p).forEach(k => { const t = p[k].type; o[k] = t === 'integer' || t === 'number' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : ''; }); return o; }
let TOOLS = null;
function tools() {
  if (TOOLS) return TOOLS;
  const fixed = C.allTools(); const pick = n => fixed.find(t => t.name === n); const loose = s => { const c = JSON.parse(JSON.stringify(s)); delete c.additionalProperties; return c; };
  const d = C.doTool(); const doSchema = loose(d.input_schema); doSchema.required = ['type'];
  const need = (n, req) => { const s = loose(pick(n).input_schema); s.required = req; return s; };
  TOOLS = [
    { name: 'read_site', description: pick('read_site').description, inputSchema: loose(pick('read_site').input_schema) },
    { name: 'log_food', description: pick('log_food').description + ' Read a photo of a meal, a drink or a receipt yourself and send what it shows as words with amounts.', inputSchema: need('log_food', ['text', 'kind']) },
    { name: 'schedule_workout', description: pick('schedule_workout').description + ' Fields you do not use may be left out.', inputSchema: need('schedule_workout', ['date']) },
    { name: 'change_workout', description: pick('change_workout').description + ' Fields you do not use may be left out.', inputSchema: need('change_workout', ['date', 'text']) },
    { name: 'do_action', description: d.description.replace('Every field is required: fill the ones the action uses and leave the rest "" or 0.', 'Send type and only the fields that action uses.'), inputSchema: doSchema },
  ];
  return TOOLS;
}
async function callTool(name, a, base) {
  const V = require('./voice'); a = a && typeof a === 'object' ? a : {}; const s = v => String(v == null ? '' : v); const n = v => Math.round(Number(v) || 0);
  if (name === 'read_site') { const out = await C.readSite(base, s(a.path)); if (typeof out !== 'string') throw new Error(out.error || 'could not read that page'); return out; }
  let act;
  if (name === 'log_food') { if (!s(a.text).trim()) throw new Error('text is needed: what he ate or drank, with amounts.'); act = { type: a.kind === 'drink' ? 'drink' : 'meal', text: s(a.text).slice(0, 2000) }; }
  else if (name === 'schedule_workout') act = { type: 'workout', date: s(a.date), time: s(a.time), library_key: s(a.library_key), name: s(a.name), sport: s(a.sport), minutes: n(a.minutes) };
  else if (name === 'change_workout') act = { type: 'workout_change', date: s(a.date), text: s(a.text), time: s(a.time), new_date: s(a.new_date), minutes: n(a.minutes), library_key: s(a.library_key) };
  else if (name === 'do_action') { if (!C.DO_TYPES.includes(a.type)) throw new Error('"' + s(a.type) + '" is not something do_action does. It does: ' + C.DO_TYPES.join(', ') + '.'); act = Object.assign(blank(), a); }
  else throw new Error('Unknown tool: ' + name);
  const out = await V.run(act, { base });
  if (!out || !out.ok) throw new Error((out && out.summary) || 'It was refused.');
  return JSON.stringify(out);
}
async function handle(m, base) {
  const { id, method, params } = m || {};
  if (method === 'initialize') return rpc(id, { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'the-way', version: '1.0.0' } });
  if (typeof method === 'string' && method.startsWith('notifications/')) return null;
  if (method === 'ping') return rpc(id, {});
  if (method === 'tools/list') return rpc(id, { tools: tools() });
  if (method === 'tools/call') {
    try { return rpc(id, { content: [{ type: 'text', text: await callTool(params && params.name, params && params.arguments, base) }] }); }
    catch (e) { return rpc(id, { content: [{ type: 'text', text: 'Error: ' + String((e && e.message) || e) }], isError: true }); }
  }
  return rpcErr(id, -32601, 'Method not found: ' + method);
}
function attach(app) {
  // its own pages are read from its own host: the live site, or a copy of it (a preview); never a host a request merely names
  const baseOf = req => { const host = req.get('x-forwarded-host') || req.get('host') || 'thewayforward.netlify.app'; return /(^|\.|--)thewayforward\.netlify\.app$/.test(host) ? 'https://' + host : 'https://thewayforward.netlify.app'; };
  app.all('/mcp/:key', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (String(process.env.WAY_MCP_KEY || '').trim().length < 24) return res.status(503).send('The connector is off: WAY_MCP_KEY is not set.');
    if (!keyOK(req.params.key)) return res.status(401).send('Unauthorized');
    if (req.method !== 'POST') return res.status(405).set('Allow', 'POST, OPTIONS').end();
    const msg = req.body; if (!msg || typeof msg !== 'object') return res.status(400).json(rpcErr(null, -32700, 'Parse error'));
    const base = baseOf(req);
    if (Array.isArray(msg)) { const out = (await Promise.all(msg.map(x => handle(x, base)))).filter(x => x != null); return out.length ? res.json(out) : res.status(202).end(); }
    const out = await handle(msg, base); return out == null ? res.status(202).end() : res.json(out);
  });
}
module.exports = { attach, tools, callTool, handle, blank };
