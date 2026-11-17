// node bridge/mcp.test.js
// The Way as a connector for Claude: off without the key, closed to a wrong key, the reads answer in a reader's shape, and
// every write goes through the same function the buttons and the coaches use and answers with exactly what changed.
// No model and no outside site is called here; everything written is taken back at the end.
const assert = require('assert'); const http = require('http');
const KEY = 'stand-in-key-0123456789abcdef';
(async () => {
  const app = require('./app'); const M = require('./mcp'); const { getJSON, setJSON } = require('./storage'); const tz = require('./tz');
  const srv = http.createServer(app).listen(0); const port = srv.address().port;
  const post = async (key, body, headers) => { const r = await fetch(`http://127.0.0.1:${port}/mcp/${key}`, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}), body: JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; } return { status: r.status, j, t }; };
  const call = async (name, args) => (await post(KEY, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } })).j.result;
  const good = async (name, args) => { const r = await call(name, args); assert.ok(!r.isError, name + ': ' + r.content[0].text); return JSON.parse(r.content[0].text); };
  const bad = async (name, args, rx) => { const r = await call(name, args); assert.ok(r.isError, name + ' should be refused: ' + r.content[0].text); if (rx) assert.ok(rx.test(r.content[0].text), r.content[0].text); };
  // what the test writes, kept to put back
  const keep = {}; for (const k of ['weigh-in', 'wellness-manual', 'voice-notes', 'coach-notebook', 'plan-workouts']) keep[k] = await getJSON(k, null);
  const today = tz.todayKey();
  try {
    // ── the door ──
    delete process.env.WAY_MCP_KEY; assert.strictEqual((await post(KEY, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 503); // off until he sets the key
    assert.strictEqual((await post('copy', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'x-the-way-app': '1' })).status, 503);     // the copy's door is not a door on the real site
    process.env.WAY_MCP_KEY = 'short'; assert.strictEqual((await post('short', { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 503); // a short key is no key
    process.env.WAY_MCP_KEY = KEY;
    assert.strictEqual((await post('wrong-key-0123456789abcdefgh', { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
    assert.strictEqual((await post('copy', { jsonrpc: '2.0', id: 1, method: 'ping' }, { 'x-the-way-app': '1' })).status, 401);
    assert.strictEqual((await fetch(`http://127.0.0.1:${port}/mcp/${KEY}`)).status, 405);
    const init = await post(KEY, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    assert.strictEqual(init.j.result.serverInfo.name, 'the-way'); assert.strictEqual(init.j.result.protocolVersion, '2025-06-18'); assert.ok(/source of truth/.test(init.j.result.instructions));
    assert.strictEqual((await post(KEY, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).j.result.protocolVersion, '2025-06-18');
    assert.strictEqual((await post(KEY, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    assert.strictEqual((await post(KEY, { jsonrpc: '2.0', id: 3, method: 'resources/list' })).j.error.code, -32601);

    // ── the list ──
    const list = (await post(KEY, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).j.result.tools;
    assert.deepStrictEqual(list.map(t => t.name), ['get_day', 'get_week', 'get_recovery_and_sleep', 'get_weight', 'get_fitness', 'get_notebook', 'read_site',
      'log_meal', 'log_weight', 'log_sleep', 'log_wellness', 'mark_taken', 'move_workout', 'remove_workout', 'schedule_workout', 'move_event', 'add_note', 'do_action']);
    list.forEach(t => { assert.ok(t.description.length > 40 && t.inputSchema.type === 'object' && t.annotations && t.annotations.title, t.name);
      assert.strictEqual(t.annotations.readOnlyHint, /^(get_|read_)/.test(t.name), t.name + ' read or write');
      assert.ok(!/[–—]/.test(t.description), t.name + ': no dashes in what he may read'); });
    assert.strictEqual(list.find(t => t.name === 'remove_workout').annotations.destructiveHint, true);
    const d = list.find(t => t.name === 'do_action'); assert.deepStrictEqual(d.inputSchema.required, ['type']); assert.ok(d.inputSchema.properties.type.enum.includes('medicine') && !d.inputSchema.properties.type.enum.includes('meal'));
    assert.deepStrictEqual(list.find(t => t.name === 'mark_taken').inputSchema.properties.medicine.enum, ['bp', 'eye_am', 'eye_pm']);
    assert.deepStrictEqual(list.find(t => t.name === 'log_meal').inputSchema.required, ['text']);

    // ── the small rules ──
    assert.strictEqual(M.mondayOf('2026-11-17'), '2026-11-16'); assert.strictEqual(M.mondayOf('2026-11-22'), '2026-11-16'); assert.strictEqual(M.mondayOf('2026-11-16'), '2026-11-16');
    const w1 = { id: 'a', name: 'Zone 1', sport: 'Ride', date: '2026-11-18', time: '09:00', minutes: 60, tss: 30 };
    assert.strictEqual(M.sessionDiff({ a: w1 }, { a: w1 }), null);
    assert.deepStrictEqual(M.sessionDiff({ a: w1 }, { a: Object.assign({}, w1, { time: '16:00' }) }).changed[0].after.time, '16:00');
    assert.deepStrictEqual(Object.keys(M.sessionDiff({ a: w1 }, {})), ['removed']); assert.deepStrictEqual(Object.keys(M.sessionDiff({}, { a: w1 })), ['added']);

    // ── a weigh-in: the reading stored, the one before, the difference ──
    await setJSON('weigh-in', { entries: [{ ts: Date.now() - 86400000, lb: 219, source: 'test' }] });
    const w = await good('log_weight', { lb: 218.4 });
    assert.strictEqual(w.changed.added.lb, 218.4); assert.strictEqual(w.changed.added.source, 'Claude connector'); assert.strictEqual(w.changed.previous.lb, 219); assert.strictEqual(w.changed.difference_lb, -0.6); assert.strictEqual(w.changed.readings, 2);
    await bad('log_weight', { lb: 20 }, /No usable weight/);
    const gw = await good('get_weight', {}); assert.strictEqual(gw.latest.lb, 218.4);

    // ── a night's sleep, then the morning's numbers: before, after, and which fields changed ──
    const s = await good('log_sleep', { sleep_h: 6.08, sleep_score: 80, date: today, source: 'WHOOP' });
    assert.deepStrictEqual(s.changed.fields_changed, ['sleep_h', 'sleep_score']); assert.strictEqual(s.changed.after.sleep_h, 6.08); assert.strictEqual(s.changed.after.source, 'WHOOP'); assert.strictEqual(s.changed.date, today);
    const m = await good('log_wellness', { recovery: 76, date: today });
    assert.deepStrictEqual(m.changed.fields_changed, ['recovery']); assert.strictEqual(m.changed.before.sleep_h, 6.08); assert.strictEqual(m.changed.after.sleep_h, 6.08); assert.strictEqual(m.changed.after.recovery, 76);
    assert.strictEqual((await good('log_wellness', { recovery: 76, date: today })).changed.fields_changed, 'none: the same numbers were already there');
    await bad('log_wellness', {}, /Nothing to record/); await bad('log_sleep', { recovery: 80 }, /Nothing to record/); await bad('log_sleep', { sleep_h: 7, date: 'yesterday' }, /YYYY-MM-DD/);

    // ── a medicine: marked once, never twice ──
    await require('./meds').mark('bp', true);
    const t1 = await good('mark_taken', { medicine: 'bp' }); assert.strictEqual(t1.changed.taken, true); assert.strictEqual(t1.changed.name, 'Blood pressure medicine'); assert.ok(t1.changed.taken_at);
    const t2 = await good('mark_taken', { medicine: 'bp' }); assert.ok(/already marked/.test(t2.summary) && /^nothing/.test(t2.changed));
    assert.strictEqual((await require('./meds').today()).due.find(x => x.key === 'bp').taken_at, t1.changed.taken_at); await require('./meds').mark('bp', true);
    await bad('mark_taken', {}, /one of medicine/); await bad('mark_taken', { medicine: 'bp', supplement: 'creatine' }, /not both/); await bad('mark_taken', { medicine: 'aspirin' });
    const dm = await good('do_action', { type: 'medicine', medicine: 'eye_am' }); assert.ok(/Taken: Eye drops/.test(dm.summary)); await require('./meds').mark('eye_am', true);

    // ── a note for today, and a fact for the notebook ──
    const n1 = await good('add_note', { text: 'Felt flat on the stairs this morning.' }); assert.strictEqual(n1.changed.added.text, 'Felt flat on the stairs this morning.');
    const n2 = await good('add_note', { text: 'He prefers the long ride on Friday.', remember: true }); assert.strictEqual(n2.changed.added.note, 'He prefers the long ride on Friday.'); assert.strictEqual(n2.changed.added.kind, 'he said');
    const nb = await good('get_notebook', {}); assert.ok(nb.notebook.some(x => x.note === 'He prefers the long ride on Friday.') && nb.his_notes.some(x => x.text === 'Felt flat on the stairs this morning.'));
    await bad('add_note', { text: ' ' }, /text is needed/);

    // ── a session: put on, moved, taken off, each answer saying exactly what changed ──
    const day = tz.shiftKey(today, 9), next = tz.shiftKey(today, 10);
    const a1 = await good('schedule_workout', { date: day, time: '10:00', name: 'Connector test ride', sport: 'Ride', minutes: 60 });
    assert.strictEqual(a1.changed.added.length, 1); assert.strictEqual(a1.changed.added[0].time, '10:00'); assert.strictEqual(a1.changed.added[0].minutes, 60); assert.strictEqual(a1.changed.added[0].time_12h, '10:00a');
    const a2 = await good('move_workout', { date: day, name: 'Connector test', new_date: next, time: '16:30' });
    assert.strictEqual(a2.changed.changed.length, 1); assert.deepStrictEqual([a2.changed.changed[0].before.date, a2.changed.changed[0].before.time], [day, '10:00']); assert.deepStrictEqual([a2.changed.changed[0].after.date, a2.changed.changed[0].after.time], [next, '16:30']);
    await bad('move_workout', { date: next, name: 'Connector test' }, /Say what to change/); await bad('move_workout', { date: tz.shiftKey(today, 40), time: '10:00' }, /No planned session/);
    const a3 = await good('remove_workout', { date: next, name: 'Connector test' }); assert.strictEqual(a3.changed.removed.length, 1); assert.strictEqual(a3.changed.removed[0].name, 'Connector test ride');
    await bad('remove_workout', { date: next, name: 'Connector test' }, /No planned session/); await bad('remove_workout', {}, /date is needed/);

    // ── food: refused before anything is read or written ──
    await bad('log_meal', { text: '  ' }, /text is needed/); await bad('log_meal', { text: 'rice', time: '7pm' }, /24-hour/); await bad('log_meal', { text: 'rice', date: tz.shiftKey(today, 1) }, /today or one of the last seven/);
    await bad('move_event', { date: today }, /name/);

    // ── the reads: a reader's shape, and a page that will not answer is named, not fatal ──
    const gd = await good('get_day', {}); assert.strictEqual(gd.date, today); assert.ok(gd.weekday && gd.is_today === true); assert.deepStrictEqual(gd.medicines.map(x => x.key).sort(), ['bp', 'eye_am', 'eye_pm']);
    assert.strictEqual(gd.morning_numbers.recovery, 76);
    const far = await good('get_day', { date: '2026-01-05' }); assert.strictEqual(far.weekday, 'Monday'); assert.ok(/outside it/.test(far.timeline_note));
    const page = await call('read_site', { path: '/voice/briefing' }); assert.ok(page.isError && /not a readable page/.test(page.content[0].text));
    const meal = await call('do_action', { type: 'meal', text: 'a burrito' }); assert.ok(meal.isError && /not something do_action does/.test(meal.content[0].text));
    assert.ok((await call('delete_everything', {})).isError);
    console.log('the way connector: ok');
  } finally {
    for (const k of Object.keys(keep)) { if (keep[k] != null) await setJSON(k, keep[k]); }
    try { const W = require('./wellness'); if (!keep['wellness-manual']) await W.remove(today); } catch (e) { /* nothing to take back */ }
    srv.close();
  }
  process.exit(0);   // the app keeps timers of its own
})().catch(e => { console.error(e); process.exit(1); });
