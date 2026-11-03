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
  { type: 'web_search_20260209', name: 'web_search', max_uses: 6 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 }
];

function system(notebook) {
  const p = tz.parts(new Date());
  const now = `${tz.todayKey()} ${tz.hm12(String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0'))} Eastern`;
  return `You are Harry's training and nutrition coach: a sports scientist and sports dietitian with the judgement of a coach who has worked with masters endurance athletes for years. You have the whole of his app, The Way, to read, the current research on the web, and your own notebook.

How you work:
- Look before you speak. For any question about him, read the pages that bear on it (read_site, several at once), over the dates that matter: a trend wants weeks, not a day. Never answer from memory of the app; never invent a session, meal or number.
- When the question turns on evidence (fuelling, protein timing, sleep, HRV, training load, masters athletes, weight loss without losing power, supplements), search for current research: position stands (ISSN, ACSM, IOC, ACSM/AND/DC), systematic reviews and meta-analyses first, then strong trials. Fetch the paper or the abstract when you rely on it. Say how strong the evidence is, plainly.
- Reason to one clear call. Weigh his data against the evidence and his goals; say what you would do, why, and what would change your mind.
- Write to your notebook when you make a decision with him or notice a pattern worth remembering. Read your notebook (below) before answering.
- You change nothing in the app. If something should change, say exactly what and where.

Your answer has two parts, in this order:
SAY: one or two sentences, spoken aloud, the call and the reason, to him as "you".
Then the written answer: short paragraphs, the numbers behind the call (from the pages you read, with dates), and the evidence (each source named once with its year, and its link). No filler, no headers longer than a few words, 12-hour times.

The coaching brief:
${BRIEF}

Your notebook (newest last):
${notebook.length ? notebook.slice(-40).map(n => `- ${n.date} [${n.kind}] ${n.note}`).join('\n') : '(empty)'}

Now: ${now}.`;
}

async function readSite(base, path) {
  if (!ALLOWED.test(path)) return { error: `not a readable page: ${path}` };
  try {
    const r = await fetch(base + '/.netlify/functions/api' + path, { headers: { 'x-the-way-app': '1' } });
    const t = await r.text();
    if (!r.ok) return { error: `${r.status} ${t.slice(0, 200)}` };
    // photos and thumbnails are of no use to the coach and cost a great deal
    const clean = t.replace(/"(thumb|photo|image_base64)":"[^"]{200,}"/g, '"$1":"(image)"');
    return clean.length > 60000 ? clean.slice(0, 60000) + '…(cut)' : clean;
  } catch (e) { return { error: e.message }; }
}

async function runJob(id) {
  const key = 'coach-job-' + id;
  const job = await getJSON(key, null);
  if (!job || job.status !== 'queued') return;
  job.status = 'running'; job.steps = []; job.started = new Date().toISOString();
  await setJSON(key, job);
  const step = async s => { job.steps.push(s); await setJSON(key, job).catch(() => {}); };
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new (Anthropic.default || Anthropic)({ apiKey: (process.env.ANTHROPIC_API_KEY || '').trim(), timeout: 600000 });
    const notebook = (await getJSON('coach-notebook', { notes: [] })).notes || [];
    const thread = (await getJSON('coach-thread', { turns: [] })).turns || [];
    const messages = [];
    for (const t of thread.slice(-12)) messages.push({ role: t.role, content: t.text });
    while (messages.length && messages[0].role !== 'user') messages.shift();
    messages.push({ role: 'user', content: job.text });
    let final = null, sources = [];
    for (let hop = 0; hop < 16; hop++) {
      const res = await client.beta.messages.create({
        model: MODEL, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
        thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
        system: system(notebook), tools: TOOLS, messages
      });
      messages.push({ role: 'assistant', content: res.content });
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
    const m = /^\s*SAY:\s*([\s\S]*?)(?:\n\s*\n|\n(?=[A-Z])|$)/.exec(final);
    job.say = m ? m[1].trim() : final.split('\n')[0];
    job.answer = m ? final.slice(m.index + m[0].length).trim() : final;
    // cited links: the ones the answer names, then the rest it searched
    const seen = new Set(); job.sources = sources.filter(s => s.url && !seen.has(s.url) && seen.add(s.url)).filter(s => job.answer.includes(s.url) || job.answer.includes(s.title || '§')).slice(0, 12);
    job.status = 'done'; job.finished = new Date().toISOString();
    await setJSON(key, job);
    const th = await getJSON('coach-thread', { turns: [] });
    th.turns = (th.turns || []).concat([{ role: 'user', text: job.text, at: job.created }, { role: 'assistant', text: final, at: job.finished }]).slice(-40);
    await setJSON('coach-thread', th);
  } catch (e) {
    job.status = 'error'; job.error = String(e.message || e).slice(0, 300);
    await setJSON(key, job).catch(() => {});
  }
}

function attach(app) {
  app.post('/coach/ask', async (req, res) => { if (!auth(req, res)) return;
    const text = String((req.body || {}).text || '').trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'ask something' });
    const id = crypto.randomBytes(6).toString('hex');
    // the coach reads the site it was asked from: the real one, or the copy
    const host = req.get('x-forwarded-host') || req.get('host') || 'thewayforward.netlify.app';
    const base = /(^|\.)thewayforward\.netlify\.app$/.test(host) ? 'https://' + host : 'https://thewayforward.netlify.app';
    await setJSON('coach-job-' + id, { id, text, base, status: 'queued', created: new Date().toISOString(), steps: [] });
    try {
      const r = await fetch(base + '/.netlify/functions/coach-background', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
      if (r.status >= 400) throw new Error('background ' + r.status);
    } catch (e) {
      // no background function here (the PC bridge): run it in this process instead
      runJob(id).catch(() => {});
    }
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
