// The coach: Harry's training and nutrition coach at the highest level the model gives. Unlike the
// quick logger (voice.js), it reasons at high effort over the whole site: a read-only tool reaches every
// page's data through the site's own GET routes, web search and web fetch bring the current research, and
// a notebook keeps what was decided and noticed between conversations. A question can take minutes, so it
// runs as a job: POST /coach/ask starts it in the background function (netlify/functions/coach-background.js)
// and the page polls GET /coach/job/:id.
//   POST /coach/ask      { text }            -> { id }
//   GET  /coach/job/:id                      -> { status: running|done|error, steps[], say, answer, sources[] }
//   GET  /coach/thread                       -> the recent conversation
//   GET  /coach/notebook                     -> the coach's notes
const crypto = require('crypto');
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');
const BRIEF = require('./coach-brief');
const { LIBRARY } = require('./workout-library');

const MODEL = process.env.COACH_MODEL || 'claude-opus-5-5';
const auth = (req, res) => { if (req.get('x-the-way-app') === '1') return true; res.status(401).json({ error: 'bad token' }); return false; };

// The pages the coach may read: GET routes only, none that sync, sign in or change anything.
const READABLE = [
  ['/chain', 'the chain: ten links, this week and today, the verdict'],
  ['/food/day?date=YYYY-MM-DD', 'one day of food: targets, meal plan, journal entries with grades, hydration, live fuel, sessions'],
  ['/food/today', 'today\'s food (same as food/day for today)'],
  ['/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD', 'planned sessions and Strava rides with compliance, zones, breathing; up to 62 days'],
  ['/schedule', 'the day schedule (classes, coaching, training) for the days around today'],
  ['/scores', 'fitness (CTL, ATL, form), recovery this morning, HRV, resting HR, sleep, the daily series'],
  ['/signature', 'the power curve: TP, HIE, PP, bests 20 to 60 min, new bests, breakthroughs, ramp test'],
  ['/progress', 'four outcomes on a four-week clock: threshold power, 5-min power, efficiency in Zone 1, decoupling'],
  ['/fitness', 'fitness history and wellness rows'],
  ['/fitness/zones', 'heart-rate and power zones'],
  ['/lifts', 'the lifting plan, this week, every saved session with weights and reps, the 27-week plan'],
  ['/wellness', 'mornings and nights entered by hand (sleep, recovery)'],
  ['/weigh-in', 'every weigh-in'],
  ['/workouts', 'the planned workouts store'],
  ['/workout-debt', 'missed and owed training'],
  ['/rides/analysis', 'recent rides read from their streams'],
  ['/rides/:id/analysis', 'one ride in detail (id from calendar)'],
  ['/signature/ride/:id', 'one ride\'s power against the curve'],
  ['/fuel/ahead', 'fuel for the sessions ahead'],
  ['/weather/outlook', 'the riding weather ahead'],
  ['/route-weather', 'weather along the courses'],
  ['/courses', 'the ranked riding courses'],
  ['/audit', 'the site\'s self-check: doubles, stale readings'],
  ['/compliance', 'food compliance'],
  ['/intake/today', 'today\'s intake'],
  ['/macros/today', 'today\'s macro targets'],
  ['/profile', 'the athlete profile'],
  ['/status', 'which connections are live'],
  ['/race', 'race plans'],
  ['/flags/today', 'today\'s flags']
];
const ALLOWED = /^\/(chain|food\/(day|today)|calendar|schedule|scores|signature(\/ride\/[\w-]+)?|progress|fitness(\/zones)?|lifts|wellness|weigh-in|workouts|workout-debt|rides\/(analysis|[\w-]+\/analysis)|fuel\/ahead|weather\/outlook|route-weather|courses|audit|compliance|intake\/today|macros\/today|profile|status|race|flags\/today)(\?[\w=&.,:%-]*)?$/;

const TOOLS = [
  { name: 'read_site', description: 'Read any page of The Way as JSON, exactly what the site shows. Paths you can read:\n' + READABLE.map(([p, d]) => `${p}: ${d}`).join('\n') + '\nRead several in parallel when the question spans them. Large answers are cut at about 60,000 characters.',
    input_schema: { type: 'object', properties: { path: { type: 'string', description: 'one of the paths above, with its query filled in' } }, required: ['path'], additionalProperties: false }, strict: true },
  { name: 'write_note', description: 'Write one line to your coaching notebook: a decision made with Harry, a pattern you noticed in his data, or something to check next time. Kept between conversations. Not for things the site already records.',
    input_schema: { type: 'object', properties: { note: { type: 'string' }, kind: { type: 'string', enum: ['decision', 'pattern', 'follow-up'] } }, required: ['note', 'kind'], additionalProperties: false }, strict: true },
  { name: 'schedule_workout', description: 'Put a session on the calendar, or log one already done ("I rode 45 minutes on Zwift at noon": the time it started, today). It goes through the same checks as every other way in: no session before 7 a.m. (if a time could be a.m. or p.m., ask instead of guessing), no second copy of a lift already planned that day. Use library_key when a library session fits; otherwise name, sport and minutes.',
    input_schema: { type: 'object', properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' }, time: { type: 'string', description: 'HH:MM 24-hour, or "" for no time' },
      library_key: { type: 'string', enum: [''].concat(LIBRARY.map(l => l.key)) },
      name: { type: 'string' }, sport: { type: 'string', enum: ['Ride', 'VirtualRide', 'Run', 'WeightTraining', 'Walk'] }, minutes: { type: 'integer' } },
      required: ['date', 'time', 'library_key', 'name', 'sport', 'minutes'], additionalProperties: false }, strict: true },
  { name: 'change_workout', description: 'Change a planned session: a new length (minutes = the new total), a new start (time), another day (new_date), or swap it for a library session. date = the day it is on now; text = what it is called.',
    input_schema: { type: 'object', properties: {
      date: { type: 'string' }, text: { type: 'string' }, time: { type: 'string', description: 'new HH:MM or ""' }, new_date: { type: 'string', description: 'YYYY-MM-DD or ""' },
      minutes: { type: 'integer', description: 'new total length, or 0 to keep' }, library_key: { type: 'string', enum: [''].concat(LIBRARY.map(l => l.key)) } },
      required: ['date', 'text', 'time', 'new_date', 'minutes', 'library_key'], additionalProperties: false }, strict: true },
  { name: 'log_food', description: 'Log a meal, snack or drink he tells you he had, in his words with amounts (the same reader the Food page uses grades it). One call per meal or drink. Only when he says he ate or drank it.',
    input_schema: { type: 'object', properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['meal', 'drink'] } }, required: ['text', 'kind'], additionalProperties: false }, strict: true },
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 }
];

function system(notebook, fresh) {
  const p = tz.parts(new Date());
  const now = `${tz.todayKey()} ${tz.hm12(String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'))} Eastern`;
  return `You are Harry's training and nutrition coach: a sports scientist and sports dietitian with the judgement of a coach who has worked with masters endurance athletes for years. You have the whole of his app, The Way, to read, the current research on the web, and your own notebook.

How you work:
- Look before you speak. For any question about him, read the pages that bear on it (read_site, several at once), over the dates that matter: a trend wants weeks, not a day. Never answer from memory of the app; never invent a session, meal or number.
- When the question turns on evidence (fuelling, protein timing, sleep, HRV, training load, masters athletes, weight loss without losing power, supplements), search for current research: position stands (ISSN, ACSM, IOC, ACSM/AND/DC), systematic reviews and meta-analyses first, then strong trials. Fetch the paper or the abstract when you rely on it. Say how strong the evidence is, plainly.
- Reason to one clear call. Weigh his data against the evidence and his goals; say what you would do, why, and what would change your mind.
- Write to your notebook when you make a decision with him or notice a pattern worth remembering. Read your notebook (below) before answering.
- What to eat before or after a session is the plan's meal for that slot in /food/today (meals[]: its time, grams of carbs and protein, its carb label in meals[].carb.word, and what it names). Name the label (Low carb, Balanced, High carb) as the card does whenever you name a meal, and fit the food to it. Size a meal to the plan's meal, never to close the whole day's totals: the day's totals are the plan's job, and a meal built to catch them up (Harry, 9 Nov: a 130 g carb sushi order against a 43 g low carb dinner) is the mistake. If you think the plan's meal is wrong for what is coming (a low carb dinner before a 7:00 a.m. VO2), say so plainly, name both (the plan says X; I would eat Y, because Z) and let him choose. Read it and give those grams; a meal you invent will be graded against the plan's and read as over or under.
- You can act: schedule_workout puts a session on the calendar or logs one already done, change_workout moves, lengthens or swaps a planned one, log_food logs what he ate or drank. Act when he asks you to, or when he agrees to what you proposed; say plainly in your answer what you changed. Never before 7 a.m.; when a time could be a.m. or p.m., ask. You never delete anything: removals are his, on the page.

Your answer has two parts, in this order:
SAY: one or two sentences, spoken aloud, the call and the reason, to him as "you".
Then the written answer, which he opens only if he wants more: at most about 120 words. Three or four short lines: the numbers behind the call (from the pages you read, with dates) and the evidence (each source named once with its year, and its link). No headers, no filler, no restating the call, 12-hour times. He finds long answers hard to use: less is better.

The coaching brief:
${BRIEF}

Your notebook (newest last):
${notebook.length ? notebook.slice(-40).map(n => `- ${n.date} [${n.kind}] ${n.note}`).join('\n') : '(empty)'}

${fresh ? `Scores and streaks count from ${tz.dayShort ? tz.dayShort(fresh) : fresh} (a fresh start Harry set). When you quote a week's adherence (the chain, the food week, the Lift count, rides done of planned), use only days since then and say "since ${tz.dayShort ? tz.dayShort(fresh) : fresh}"; the days before are not his to answer for. Fitness, HRV, weight and power keep their full history.\n\n` : ''}Now: ${now}.`;
}

async function readSite(base, path) {
  if (!ALLOWED.test(path)) return { error: `not a readable page: ${path}` };
  try {
    const r = await fetch(base + '/.netlify/functions/api' + path, { headers: { 'x-the-way-app': '1' }, signal: AbortSignal.timeout(45000) });
    const t = await r.text();
    if (!r.ok) return { error: `${r.status} ${t.slice(0, 200)}` };
    // photos and thumbnails are of no use to the coach and cost a great deal
    const clean = t.replace(/"(thumb|photo|image_base64)":"[^"]{200,}"/g, '"$1":"(image)"');
    return clean.length > 60000 ? clean.slice(0, 60000) + '…(cut)' : clean;
  } catch (e) { return { error: e.message }; }
}

async function runJob(id, who) {
  const key = 'coach-job-' + id;
  const job = await getJSON(key, null);
  if (!job || job.status !== 'queued') return;
  // one write queue per job: each save waits for the one before, so an older snapshot can never land after "done"
  let queue = Promise.resolve();
  const save = () => (queue = queue.then(() => setJSON(key, JSON.parse(JSON.stringify(job)))).catch(() => {}));
  job.status = 'running'; job.steps = []; job.started = new Date().toISOString(); job.where = who || 'in-process';
  await save();
  const T0 = Date.now();
  const step = async s => { job.steps.push(`${s} · ${Math.round((Date.now() - T0) / 1000)} s`); await save(); };
  try {
    const key = (process.env.ANTHROPIC_API_KEY || '').trim();
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Netlify');
    // the Messages API, called directly as the rest of the bridge does
    const create = async (body, ms) => {
      const ac = new AbortController(), timer = setTimeout(() => ac.abort(), ms || 300000);
      const payload = JSON.stringify(body); 
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ac.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'Content-Type': 'application/json' },
        body: payload });
      const j = await r.json().finally(() => clearTimeout(timer));
      if (!r.ok) throw new Error('coach ' + r.status + ': ' + ((j.error && j.error.message) || '').slice(0, 200));
      return j;
    };
    const notebook = (await getJSON('coach-notebook', { notes: [] })).notes || [];
    const thread = (await getJSON('coach-thread', { turns: [] })).turns || [];
    const messages = [];
    for (const t of thread.slice(-12)) messages.push({ role: t.role, content: t.text });
    while (messages.length && messages[0].role !== 'user') messages.shift();
    messages.push({ role: 'user', content: job.text });
    let final = null, sources = [];
    // The system prompt and the tools are the same on every step, so they are cached once per question (the
    // clock in the prompt is read once, not per step); the conversation so far is cached at its last block, so a
    // step pays full price only for what the last step added. Without this, every step re-bought the whole context.
    const fresh = await require('./fresh-start').freshStart();
    const sys = [{ type: 'text', text: system(notebook, fresh), cache_control: { type: 'ephemeral' } }];
    const cached = ms => ms.map((m, i) => {
      if (i !== ms.length - 1) return m;
      const c = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content.map(b => Object.assign({}, b));
      if (c.length) c[c.length - 1] = Object.assign({}, c[c.length - 1], { cache_control: { type: 'ephemeral' } });
      return { role: m.role, content: c };
    });
    const tally = { in: 0, cache_read: 0, cache_write: 0, out: 0 };
    const spend = u => { if (!u) return; tally.in += u.input_tokens || 0; tally.cache_read += u.cache_read_input_tokens || 0; tally.cache_write += u.cache_creation_input_tokens || 0; tally.out += u.output_tokens || 0;
      job.usage = Object.assign({}, tally, { usd: Math.round((tally.in * 4 + tally.cache_read * 0.4 + tally.cache_write * 5 + tally.out * 20) / 1e6 * 100) / 100 }); };
    const t0 = Date.now(), late = () => Date.now() - t0 > 9 * 60 * 1000;   // the background function stops at fifteen minutes
    for (let hop = 0; hop < 16; hop++) {
      if (late() && hop) { const last = messages[messages.length - 1]; if (last.role === 'user' && Array.isArray(last.content)) last.content.push({ type: 'text', text: 'Time is nearly up: answer now from what you have read.' }); }
      // each step gets what is left of eleven minutes (at least one); a step that runs out is retried once without tools
      const left = Math.max(60000, 11 * 60 * 1000 - (Date.now() - t0));
      await step(`thinking (step ${hop + 1})`);
      let res;
      const hb = setInterval(() => { job.wait = `step ${hop + 1}: waiting ${Math.round((Date.now() - t0) / 1000)} s`; save(); }, 15000);
      try { res = await create({ ...(late() ? { tool_choice: { type: 'none' } } : {}),
        model: MODEL, max_tokens: job.kind === 'debrief' ? 4000 : 16000, fallbacks: 'default',
        thinking: { type: 'adaptive' }, output_config: { effort: job.kind === 'debrief' ? 'medium' : 'high' },
        system: sys, tools: job.kind === 'debrief' ? TOOLS.filter(t => t.name === 'read_site') : TOOLS, messages: cached(messages)
      }, left); }
      catch (e) {
        clearInterval(hb);
        job.debug = (job.debug || []).concat([`step ${hop + 1} failed after ${Math.round((Date.now() - t0) / 1000)} s: ${e.name} ${String(e.message).slice(0, 160)}`]); await save();
        if (e.name !== 'AbortError') throw e;
        await step('taking too long: answering from what was read');
        const last = messages[messages.length - 1];
        if (last.role === 'user' && Array.isArray(last.content)) last.content.push({ type: 'text', text: 'Time is up: answer now from what you have read.' });
        else messages.push({ role: 'user', content: 'Time is up: answer now from what you have read so far.' });
        res = await create({ model: MODEL, max_tokens: 8000, fallbacks: 'default', thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
          system: sys, tools: TOOLS, tool_choice: { type: 'none' }, messages: cached(messages) }, 150000);
      }
      clearInterval(hb);
      messages.push({ role: 'assistant', content: res.content });
      spend(res.usage);
      job.debug = (job.debug || []).concat([`step ${hop + 1}: ${res.stop_reason}, ${Math.round((Date.now() - t0) / 1000)} s, ${(res.usage && res.usage.input_tokens) || 0} in / ${(res.usage && res.usage.cache_read_input_tokens) || 0} cached / ${(res.usage && res.usage.output_tokens) || 0} out`]);
      for (const b of res.content) {
        if (b.type === 'server_tool_use' && b.name === 'web_search') await step(`searching: ${String((b.input || {}).query || '').slice(0, 90)}`);
        if (b.type === 'server_tool_use' && b.name === 'web_fetch') await step(`reading: ${String((b.input || {}).url || '').slice(0, 90)}`);
        if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.push({ title: r.title, url: r.url });
      }
      if (res.stop_reason === 'pause_turn') continue;
      if (res.stop_reason === 'refusal') { final = 'SAY: I can\'t answer that one.\nThe request was declined.'; break; }
      const uses = res.content.filter(b => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) { final = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(); break; }
      const results = await Promise.all(uses.map(async u => {
        if (u.name === 'read_site') { await step(`reading ${u.input.path}`); const out = await readSite(job.base, u.input.path); return { type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out), is_error: typeof out !== 'string' }; }
        if (u.name === 'schedule_workout' || u.name === 'change_workout' || u.name === 'log_food') {
          const V = require('./voice'), i = u.input || {};
          const a = u.name === 'schedule_workout' ? { type: 'workout', date: i.date, time: i.time, library_key: i.library_key, name: i.name, sport: i.sport, minutes: i.minutes }
            : u.name === 'change_workout' ? { type: 'workout_change', date: i.date, text: i.text, time: i.time, new_date: i.new_date, minutes: i.minutes, library_key: i.library_key }
            : { type: i.kind === 'drink' ? 'drink' : 'meal', text: i.text };
          let out; try { out = await V.run(a, {}); } catch (e) { out = { ok: false, summary: e.message }; }
          await step(`${out.ok ? 'done' : 'refused'}: ${String(out.summary || '').slice(0, 90)}`);
          return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), is_error: !out.ok };
        }
        if (u.name === 'write_note') {
          const nb = await getJSON('coach-notebook', { notes: [] });
          nb.notes = (nb.notes || []).concat([{ date: tz.todayKey(), kind: u.input.kind, note: String(u.input.note).slice(0, 400) }]).slice(-200);
          await setJSON('coach-notebook', nb); await step(`noted: ${String(u.input.note).slice(0, 80)}`);
          return { type: 'tool_result', tool_use_id: u.id, content: 'saved' };
        }
        return { type: 'tool_result', tool_use_id: u.id, content: 'unknown tool', is_error: true };
      }));
      messages.push({ role: 'user', content: results });
    }
    if (!final) final = 'SAY: I ran out of steps before I could finish that.\nAsk again more narrowly and I will start from what I found.';
    const m = /^\s*\**SAY:\**\s*([\s\S]*?)(?:\n\s*\n|\n(?=[A-Z*])|$)/.exec(final);
    job.say = (m ? m[1].trim() : final.split('\n')[0]).replace(/\*\*/g, '');
    job.answer = m ? final.slice(m.index + m[0].length).trim() : final;
    // cited links: the ones the answer names, then the rest it searched
    // sources: every link the answer cites, titled from the search results where they match
    const cited = [...new Set((job.answer.match(/https?:\/\/[^\s)\]<>"]+/g) || []).map(u => u.replace(/[.,;:]+$/, '')))];
    job.sources = cited.map(u => ({ url: u, title: (sources.find(s => s.url === u) || {}).title || u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70) })).slice(0, 12);
    job.steps = job.steps.filter((x, i, a) => a.indexOf(x) === i);   // the same search said once
    job.status = 'done'; job.finished = new Date().toISOString();
    await save();
    if (job.kind === 'debrief' && job.ride_id) await setJSON('coach-debrief-' + String(job.ride_id).replace(/[^\w-]/g, ''), { job_id: job.id, status: 'done', ride: { id: job.ride_id, name: job.ride_name || null }, say: job.say, answer: job.answer, usage: job.usage || null, at: job.finished }).catch(() => {});
    const th = await getJSON('coach-thread', { turns: [] });
    th.turns = (th.turns || []).concat([{ role: 'user', text: job.kind === 'debrief' ? `Debrief: ${job.ride_name || 'the ride'}` : job.text, at: job.created }, { role: 'assistant', text: final, at: job.finished }]).slice(-40);
    await setJSON('coach-thread', th);
  } catch (e) {
    job.status = 'error'; job.error = String(e.message || e).slice(0, 300);
    await save();
    if (job.kind === 'debrief' && job.ride_id) await setJSON('coach-debrief-' + String(job.ride_id).replace(/[^\w-]/g, ''), { job_id: job.id, status: 'error', error: job.error, ride: { id: job.ride_id, name: job.ride_name || null }, at: new Date().toISOString() }).catch(() => {});
  }
}

function attach(app) {
  // a job starts here, whatever asked for it: a question from the page, or a ride that just landed
  const baseOf = req => { const host = req.get('x-forwarded-host') || req.get('host') || 'thewayforward.netlify.app';
    return /(^|\.|--)thewayforward\.netlify\.app$/.test(host) ? 'https://' + host : 'https://thewayforward.netlify.app'; };
  const startJob = async (text, base, extra) => {
    const id = crypto.randomBytes(6).toString('hex');
    const job = Object.assign({ id, text, base, status: 'queued', created: new Date().toISOString(), steps: [] }, extra || {});
    await setJSON('coach-job-' + id, job);
    try {
      const r = await fetch(base + '/.netlify/functions/coach-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (r.status >= 400) throw new Error('background ' + r.status);
    } catch (e) {
      // on Netlify the job only ever runs in the background function: a request may live 30 seconds, a question needs minutes
      if (require('./storage').ON_NETLIFY) { await setJSON('coach-job-' + id, Object.assign(job, { status: 'error', error: 'could not start the coach: ' + e.message })); return id; }
      runJob(id).catch(() => {});   // the PC bridge has no background function: run it here
    }
    return id;
  };
  app.post('/coach/ask', async (req, res) => { if (!auth(req, res)) return;
    const text = String((req.body || {}).text || '').trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'ask something' });
    res.json({ id: await startJob(text, baseOf(req)) });
  });
  // The debrief: after a ride, the coach reads it and says how it went, what to improve and what to eat next.
  // One per ride, keyed by the ride; asking again for a ride that has one returns it. The Day asks for today's.
  const DEBRIEF_KEY = id => 'coach-debrief-' + String(id).replace(/[^\w-]/g, '');
  const todayRides = async () => {
    const W = require('./workouts'), today = tz.todayKey();
    const cal = await W.calendar(today, today);
    const day = (cal.days || [])[0] || {};
    // a false start is not a ride (Harry, 9 Nov: the player saved a 0-minute "Z1 trainer 90 min" at 3:59p before the
    // real one at 4:04p, and the coach debriefed both): under 5 minutes gets no debrief, and of two saves with the same
    // name the longer one is the ride
    const real = (day.done || []).filter(r => (W.isRideSport ? W.isRideSport(r) : true) && (r.minutes || 0) >= 5);
    const keep = real.filter(r => !real.some(o => o !== r && String(o.name) === String(r.name) && ((o.minutes || 0) > (r.minutes || 0) || ((o.minutes || 0) === (r.minutes || 0) && String(o.id) > String(r.id)))));
    return keep.map(r => ({ id: String(r.id), name: r.name, time: r.time || null, minutes: r.minutes || null,
      planned: (day.planned || []).filter(w => w.compliance).map(w => ({ name: w.name, band: w.compliance.band, pct: w.compliance.pct, basis: w.compliance.basis })) }));
  };
  app.get('/coach/debrief/today', async (req, res) => { if (!auth(req, res)) return;
    try {
      const rides = await todayRides();
      const out = [];
      for (const r of rides) { const d = await getJSON(DEBRIEF_KEY(r.id), null); out.push({ ride: r, debrief: d }); }
      res.json({ rides: out });
    } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/coach/debrief', async (req, res) => { if (!auth(req, res)) return;
    const rid = String((req.body || {}).ride_id || '').trim(); if (!rid) return res.status(400).json({ error: 'ride_id' });
    const have = await getJSON(DEBRIEF_KEY(rid), null);
    if (have && have.status !== 'error' && !(req.body || {}).again) return res.json({ id: have.job_id, debrief: have });
    const rides = await todayRides().catch(() => []);
    const ride = rides.find(r => r.id === rid) || { id: rid, name: String((req.body || {}).name || 'the ride') };
    const graded = (ride.planned || []).map(p => `${p.name}: ${p.band}${p.pct != null ? ` ${p.pct}%` : ''} (${p.basis})`).join('; ');
    const text = `DEBRIEF the ride "${ride.name}" (${tz.todayKey()}${ride.time ? ' ' + tz.hm12(ride.time) : ''}, ride id ${rid}). Read /rides/${rid}/analysis, /calendar?from=${tz.todayKey()}&to=${tz.todayKey()} (the plan it was graded against), /food/today and /fuel/ahead.
The site's own grade of it, which you repeat as it stands and never contradict: ${graded || 'not graded against a plan'}. The lines the site uses: Zone 1 is heart rate 116 and under; the VO2 line is 139 (VT2); there is no other heart-rate line. Use only numbers from the pages. The ride's fuel prescription is in /food/today under sessions[].rx (grams before, on the bike and within two hours after; a low before means under 20 g on purpose): judge what he ate against it, not against a rule of your own.
Then answer in exactly this shape:
SAY: one sentence to him, warm and specific: the one thing he did well, or the one thing to do differently next time. It must agree with the grade above.
**The ride**: at most three short lines, each a number from the pages (minutes, the zone split against the plan, heart rate against the goal, power). Encouragement where it is earned; one concrete improvement where it is not, said once.
**Next meal**: the next meal on today's plan, by its name, its carb label exactly as the card shows it (meals[].carb.word: Low carb, Balanced or High carb) and its planned time (from /food/today's meal plan), and what to make it, fitted to that label (grams of carbs and protein, a real food or two). Never invent a meal or a time the plan does not have. One line.
No research, no links, nothing else.`;
    const id = await startJob(text, baseOf(req), { kind: 'debrief', ride_id: rid, ride_name: ride.name });
    await setJSON(DEBRIEF_KEY(rid), { job_id: id, status: 'running', ride: { id: rid, name: ride.name, time: ride.time || null }, at: new Date().toISOString() });
    res.json({ id });
  });
  app.get('/coach/job/:id', async (req, res) => { if (!auth(req, res)) return;
    const job = await getJSON('coach-job-' + String(req.params.id).replace(/[^a-f0-9]/g, ''), null);
    if (!job) return res.status(404).json({ error: 'no such question' });
    res.json(job);
  });
  app.get('/coach/thread', async (req, res) => { if (!auth(req, res)) return; res.json(await getJSON('coach-thread', { turns: [] })); });
  app.get('/coach/notebook', async (req, res) => { if (!auth(req, res)) return; res.json(await getJSON('coach-notebook', { notes: [] })); });
}

module.exports = { attach, runJob, READABLE, ALLOWED };
