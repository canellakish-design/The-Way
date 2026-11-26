// The coach's tools, as the connector (mcp.js) offers them to Harry's own Claude: what it may read on the site
// (read_site), and what it may do (do_action and the rest), each described in the site's own words.
// The deep coach that used these tools here, on the site, called Claude through the paid API: it was taken
// out on 26 Nov 2026 (The Way runs free), with its page, its background function, the ride debrief and the
// week's review. Nothing in this file calls a model.
const tz = require('./tz');
const { LIBRARY } = require('./workout-library');


// The pages the coach may read: GET routes only, none that sync, sign in or change anything.
const READABLE = [
  ['/planner/model', 'his training model: how a riding week is shaped (base days as one ride or two, the lengths, the VO2 days), in words and as settings. He sets it'],
  ['/planner/week?from=YYYY-MM-DD', 'that week of riding laid out by the training model around what his calendar holds, day by day, with what it would change. Nothing is written by reading it'],
  ['/sleep-window', 'his sleep window as Setup has it, and the earliest a session may start'],
  ['/meds/today', 'his medicines today: which are due and which are taken'],
  ['/chain', 'the chain: ten links, this week and today, the verdict'],
  ['/history?from=YYYY-MM-DD&to=YYYY-MM-DD', 'the look back, one compact row a day (45 days at most): every meal eaten with its numbers, the food score and what it missed, each ride with its time, % of plan and the meal before it, lifts, sleep, recovery, naps, weight. The first thing to read for "what did I eat/do on…", for trends and for habits'],
  ['/history/patterns', 'what his whole record says: every week rolled up (food score, protein, rides, TSS, lifts, sleep, recovery, weight), his best food days (the model to copy), food habits and ride habits with how many days stand behind each, the last 7 days against the 3 weeks before. Read this for trends and for where he is heading'],
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
  ['/race', 'the season clock: the race the season is built around, weeks out, the phase and this week\'s buckets'],
  ['/routes', 'his Ride with GPS route library: each route with miles, climbing and its link'],
  ['/races', 'his race calendar: every race ahead with date, kind, priority (A/B/C), place, distance, climbing, status and link; past races with results; the season clock'],
  ['/flags/today', 'today\'s flags']
];
const ALLOWED = /^\/(chain|routes|races|history(\/patterns)?|food\/(day|today)|calendar|schedule|scores|signature(\/ride\/[\w-]+)?|progress|fitness(\/zones)?|lifts|wellness|weigh-in|workouts|workout-debt|rides\/(analysis|[\w-]+\/analysis)|fuel\/ahead|weather\/outlook|route-weather|courses|audit|compliance|intake\/today|macros\/today|profile|status|race|flags\/today|planner\/model|planner\/week|meds\/today|sleep-window)(\?[\w=&.,:%-]*)?$/;

// Everything the quick coach can do, the deep coach can do too (Harry, 17 Nov 2026: "I want the cycling coach to be able to
// have full functionality in The Way. Can log medicine. Change the schedule etc."): do_action takes ONE action in the
// quick coach's own shape and runs it through the same function (voice.js run), so nothing is logged twice or differently.
// Left to their own tools or to the phone: meal, drink, workout, workout_change (the three tools below), plan_week
// (the quick coach's own week tool), player, route_here and save_place (they need the phone in his hand), research and
// question (this coach IS the researched answer).
const DO_TYPES = ['supplement', 'medicine', 'weigh_in', 'remove_workout', 'event', 'event_change', 'remove', 'note', 'remember', 'wellness', 'nap', 'race', 'garmin', 'route', 'new_route', 'lift', 'training_model'];
function doTool() {
  const V = require('./voice');
  const item = JSON.parse(JSON.stringify(V.SCHEMA().properties.actions.items));
  item.properties.type.enum = item.properties.type.enum.filter(t => DO_TYPES.includes(t));
  // the quick coach's own words for each kind of action, so the two coaches read them the same way
  const lines = []; let keep = false;
  for (const ln of V.systemText().split('\n')) { const m = /^- ([a-z_]+):/.exec(ln); if (m) keep = DO_TYPES.includes(m[1]); else if (/^\s*$/.test(ln) || /^[A-Z]/.test(ln)) keep = false; if (keep) lines.push(ln); }
  return { name: 'do_action', description: 'Do one thing in The Way for him, the same way the buttons and the quick coach do it: mark a medicine or a supplement taken, log a weigh-in, a nap, the morning\'s numbers or a lift done, take a session off the calendar, add or move a calendar event, take something back out of today\'s food journal, add a race, send a session to his Garmin, set or make a route, change how his training is shaped, keep a note or something to remember. One call per action; several things are several calls. Every field is required: fill the ones the action uses and leave the rest "" or 0. Only when he asked for it or said it happened. The answer says what was done or why it was refused: tell him that plainly.\n\nThe kinds of action:\n' + lines.join('\n'),
    input_schema: item, strict: true };
}
let ALL = null;
const allTools = () => ALL || (ALL = FIXED.slice(0, -2).concat([doTool()], FIXED.slice(-2)));
const FIXED = [
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

module.exports = { DO_TYPES, doTool, allTools, READABLE, ALLOWED, readSite };
