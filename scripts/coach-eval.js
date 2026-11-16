#!/usr/bin/env node
// Ask the real coach the questions Harry has corrected it on (bridge/coach-evals/cases.json) and check each answer.
//   node scripts/coach-eval.js [base-url] [--writes] [--only id,id]
// Each case is one fresh question to POST /voice, so a run costs a few cents a case on the Anthropic key.
// Without --writes only questions are asked (nothing is logged, safe on the real site). With --writes the cases that
// log something are asked too, and only a deploy preview (the sandbox copy) is accepted for those.
// bridge/coach-rules.test.js holds the checks that need no model; this is for what only the model's answer shows.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), base = (args.find(a => /^https?:/.test(a)) || 'https://deploy-preview-2--thewayforward.netlify.app').replace(/\/$/, '');
const writes = args.includes('--writes'), only = (args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean);
if (writes && !/deploy-preview/.test(base)) { console.error('--writes is for a deploy preview only: it logs food and lifts.'); process.exit(2); }
const H = { 'Content-Type': 'application/json', 'x-the-way-app': '1' };
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bridge', 'coach-evals', 'cases.json'), 'utf8'))
  .filter(c => (writes || !c.writes) && (!args.includes('--only') || only.includes(c.id)));
const rx = s => new RegExp(s, 'i');

(async () => {
  let latest = null;
  try { const w = await (await fetch(base + '/weigh-in', { headers: H })).json(); const all = (w.all || w.entries || []).slice().sort((a, b) => String(a.ts || a.date).localeCompare(String(b.ts || b.date))); latest = all.length ? all[all.length - 1].lb : (w.latest && w.latest.lb) || null; } catch (e) { /* that case is skipped */ }
  let bad = 0, cost = { in: 0, cached: 0, out: 0 };
  for (const c of cases) {
    const t0 = Date.now(); let d = null, err = null;
    try { const r = await fetch(base + '/voice', { method: 'POST', headers: H, body: JSON.stringify({ text: c.say, history: [] }), signal: AbortSignal.timeout(45000) }); d = await r.json(); if (!r.ok) err = d.error || r.status; }
    catch (e) { err = e.message; }
    const fails = [];
    if (err) fails.push('no answer: ' + err);
    else {
      const reply = String(d.reply || ''), types = (d.actions || []).map(a => a.type), tools = (d.ms && d.ms.tools) || [];
      for (const p of c.reply_has || []) if (!rx(p).test(reply)) fails.push(`the reply should say /${p}/`);
      for (const p of c.reply_not || []) if (rx(p).test(reply)) fails.push(`the reply should not say /${p}/`);
      for (const t of c.actions || []) if (!types.includes(t)) fails.push(`no ${t} action`);
      if (c.actions_any && !c.actions_any.some(t => types.includes(t))) fails.push(`none of ${c.actions_any.join(', ')}`);
      for (const t of c.no_actions || []) if (types.includes(t)) fails.push(`a ${t} action it should not take`);
      if (c.only_actions && types.some(t => !c.only_actions.includes(t))) fails.push(`actions beyond ${c.only_actions.join(', ')}: ${types.join(', ')}`);
      if (c.max_actions != null && types.length > c.max_actions) fails.push(`${types.length} actions, at most ${c.max_actions}`);
      for (const t of c.tools || []) if (!tools.includes(t)) fails.push(`did not call ${t}`);
      for (const t of c.no_tools || []) if (tools.includes(t)) fails.push(`called ${t}, which this did not ask for`);
      if (c.max_seconds && (Date.now() - t0) / 1000 > c.max_seconds) fails.push(`took ${((Date.now() - t0) / 1000).toFixed(1)} s, over ${c.max_seconds}`);
      if (!reply.trim()) fails.push('an empty reply');
      if (c.has_offer && !(d.offer && d.offer.plan)) fails.push('no offer');
      if (c.reply_has_latest_weight) { if (latest == null) fails.push('(skipped: no weigh-in to compare)'); else if (!reply.includes(String(latest)) && !reply.includes(String(Math.round(latest)))) fails.push(`the reply should give the latest weigh-in, ${latest} lb`); }
      if (d.ms) { cost.in += (d.ms.in_tokens || 0) - (d.ms.cached_tokens || 0); cost.cached += d.ms.cached_tokens || 0; cost.out += d.ms.out_tokens || 0; }
      const real = fails.filter(f => !/^\(skipped/.test(f));
      console.log(`${real.length ? 'FAIL' : 'ok  '} ${c.id} (${((Date.now() - t0) / 1000).toFixed(1)}s)${real.length ? '\n     ' + real.join('\n     ') + `\n     he said: "${c.say}"\n     reply: ${reply.slice(0, 300)}\n     actions: ${types.join(', ') || 'none'}\n     why it is here: ${c.from}` : ''}`);
      if (real.length) bad++;
      continue;
    }
    console.log(`FAIL ${c.id}\n     ${fails.join('\n     ')}`); bad++;
  }
  console.log(`\n${cases.length - bad} of ${cases.length} passed on ${base}${writes ? '' : ' (questions only; --writes on a preview asks the logging cases too)'}`);
  console.log(`tokens: ${cost.in} fresh in, ${cost.cached} read from cache, ${cost.out} out`);
  process.exit(bad ? 1 : 0);
})();
