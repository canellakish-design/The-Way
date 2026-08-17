// ============================================================
// test-helpers.js — the three things the route tests here all need: a storage
// layer that lives in memory, a real Express app to fetch against, and a
// scriptable stand-in for the outbound fetch to WHOOP/Google.
// Still no framework: every test file remains a plain `node bridge/x.test.js`.
// ============================================================
const Module = require('module');
const path = require('path');

// Captured before anything gets stubbed. The test driver calls the local app
// with this, so a test that swaps global fetch for a fake WHOOP doesn't end up
// intercepting its own requests.
const REAL_FETCH = globalThis.fetch;

// Netlify Blobs hands back a fresh parse on every read, so a caller mutating
// what it got does not touch the store. The fake copies for the same reason —
// without it, code that reads, mutates and writes would appear to work even if
// it never wrote, and the whoop token-race guard would test nothing.
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Put a fake in the module cache under a real module's resolved path, so the
// module under test picks it up when it requires it. Works for JSON too —
// snacks.json is loaded at require time by intake.js.
function stubModule(request, exports) {
  const id = require.resolve(request);
  const m = new Module(id, null);
  m.filename = id;
  m.path = path.dirname(id);
  m.loaded = true;
  m.exports = exports;
  require.cache[id] = m;
  return exports;
}

// Everything that stores anything requires ./storage at load time, so the fake
// has to be in the module cache before the module under test is required.
// Returns the raw backing object, for asserting on what was actually written.
function stubStorage(seed) {
  const data = clone(seed) || {};
  stubModule('./storage', {
    ON_NETLIFY: false,
    getJSON: async (key, fallback) => (key in data ? clone(data[key]) : fallback),
    setJSON: async (key, val) => {
      if (data.__failWrites) throw new Error('blob store unavailable');
      data[key] = clone(val);
    }
  });
  return data;
}

// A real Express app on an ephemeral port. Real routing, real JSON body
// parsing, real status codes — the parts of a route worth testing are mostly
// in how it answers, and a hand-rolled req/res double gets those subtly wrong.
async function serve(...attachers) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  for (const a of attachers) a(app);
  const server = await new Promise(done => {
    const s = app.listen(0, '127.0.0.1', () => done(s));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, p, opts) => {
    const o = opts || {};
    const r = await REAL_FETCH(base + p, {
      method,
      redirect: o.redirect || 'follow',
      headers: Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}),
      body: o.body === undefined ? undefined : JSON.stringify(o.body)
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not every route answers JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  return {
    base,
    get: (p, opts) => call('GET', p, opts),
    post: (p, body, opts) => call('POST', p, Object.assign({}, opts, { body })),
    close: () => new Promise(done => server.close(done))
  };
}

// Swap global fetch for a scripted one. `handler(url, init, n)` returns
// { status, body }; the call log is returned too, so a test can assert on what
// was sent — which is the whole point for things like the refresh grant.
function stubFetch(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const i = init || {};
    calls.push({ url: u, method: i.method || 'GET', body: i.body ? String(i.body) : null,
      headers: i.headers || {} });
    const r = (await handler(u, i, calls.length - 1)) || {};
    const status = r.status || 200;
    const body = r.body === undefined ? {} : r.body;
    return {
      ok: status < 400,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
    };
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// The reporter the existing tests use, factored out: PASS/FAIL a line at a
// time, non-zero exit if anything failed.
function checker() {
  let failed = 0;
  const ok = (label, cond, extra) => {
    if (!cond) failed++;
    console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (extra ? '  ' + extra : ''));
  };
  ok.section = title => console.log('\n· ' + title);
  ok.done = () => {
    console.log(failed ? `\n${failed} FAILED` : '\nall passing');
    process.exit(failed ? 1 : 0);
  };
  return ok;
}

module.exports = { stubStorage, stubModule, serve, stubFetch, checker, REAL_FETCH };
