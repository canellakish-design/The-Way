// node bridge/mcp.test.js
// The Way as a connector for Claude: off without the key, closed to a wrong key, and every write goes through the same
// function the buttons and the coaches use. No model and no outside site is called here.
const assert = require('assert'); const http = require('http');
const KEY = 'stand-in-key-0123456789abcdef';
(async () => {
  const app = require('./app'); const srv = http.createServer(app).listen(0); const port = srv.address().port;
  const post = async (key, body) => { const r = await fetch(`http://127.0.0.1:${port}/mcp/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { status: r.status, j, t }; };
  const call = async (name, args) => (await post(KEY, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).j.result;
  try {
    delete process.env.WAY_MCP_KEY; assert.strictEqual((await post(KEY, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 503); // off until he sets the key
    process.env.WAY_MCP_KEY = 'short'; assert.strictEqual((await post('short', { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 503); // a short key is no key
    process.env.WAY_MCP_KEY = KEY;
    assert.strictEqual((await post('wrong-key-0123456789abcdefgh', { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/mcp/${KEY}`)).status, 405);
    const init = await post(KEY, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }); assert.strictEqual(init.j.result.serverInfo.name, 'the-way');
    assert.strictEqual((await post(KEY, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const list = (await post(KEY, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).j.result.tools;
    assert.deepStrictEqual(list.map(t => t.name), ['read_site', 'log_food', 'schedule_workout', 'change_workout', 'do_action']);
    list.forEach(t => { assert.ok(t.description.length > 40 && t.inputSchema.type === 'object', t.name); });
    const d = list.find(t => t.name === 'do_action'); assert.deepStrictEqual(d.inputSchema.required, ['type']); assert.ok(d.inputSchema.properties.type.enum.includes('medicine') && !d.inputSchema.properties.type.enum.includes('meal'));
    // a medicine marked taken with only the fields it uses: it shows on the day's list, as from the button
    const ok = await call('do_action', { type: 'medicine', medicine: 'bp' }); assert.ok(!ok.isError && /Taken: Blood pressure medicine/.test(ok.content[0].text), JSON.stringify(ok));
    assert.strictEqual((await require('./meds').today()).due.find(x => x.key === 'bp').taken, true); await require('./meds').mark('bp', true);
    // refused, in words: an unknown medicine, an action that is not do_action's, an empty meal, a page that is not readable, an unknown tool
    assert.ok((await call('do_action', { type: 'medicine', medicine: 'aspirin' })).isError);
    const meal = await call('do_action', { type: 'meal', text: 'a burrito' }); assert.ok(meal.isError && /not something do_action does/.test(meal.content[0].text));
    assert.ok((await call('log_food', { text: '  ', kind: 'meal' })).isError);
    const page = await call('read_site', { path: '/voice/briefing' }); assert.ok(page.isError && /not a readable page/.test(page.content[0].text));
    assert.ok((await call('delete_everything', {})).isError);
    assert.strictEqual((await post(KEY, { jsonrpc: '2.0', id: 3, method: 'resources/list' })).j.error.code, -32601);
    console.log('the way connector: ok');
  } finally { srv.close(); }
  process.exit(0);   // the app keeps timers of its own
})().catch(e => { console.error(e); process.exit(1); });
