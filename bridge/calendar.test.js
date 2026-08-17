// ============================================================
// calendar.test.js — the Training Availability Engine: what a title gets
// classified as, which windows survive a day of blocking events, what the day
// looks like hour by hour, and the week's recommended volume.
// Run: node bridge/calendar.test.js
// ============================================================
process.env.TZ = 'UTC';               // production runs UTC; the app zone is Eastern
process.env.FUEL_TOKEN = 'test-fuel-token';

const { stubStorage, serve, checker } = require('./test-helpers');
const tz = require('./tz');
const ok = checker();

const TOKEN_Q = { headers: { 'x-fuel-token': process.env.FUEL_TOKEN } };
// A fixed midweek day, so the fixtures do not drift with the calendar.
const DAY = '2026-08-19';
const OTHER_DAY = '2026-08-20';
const DAY_MIN = 990;                  // 5:00a–9:30p, the waking window

// A wall-clock time in Harry's zone as an instant — the same conversion the
// app does. Building these in UTC is exactly the bug the tz module exists for.
const at = (key, h, m) => {
  const [y, mo, d] = key.split('-').map(Number);
  return tz.zonedToUTC(y, mo, d, h, m || 0).toISOString();
};
const ev = o => Object.assign({
  summary: 'Event', category: 'busy', allDay: false, location: null,
  calendar: 'Primary', account: 'harry@example.com', source: 'calendar'
}, o);
// A timed event on `key`, from h1:m1 to h2:m2 Eastern.
const timed = (key, h1, m1, h2, m2, o) =>
  ev(Object.assign({ start: at(key, h1, m1), end: at(key, h2, m2) }, o));
const allDay = (start, end, o) =>
  ev(Object.assign({ start, end, allDay: true }, o));

function fresh(seed) {
  const store = stubStorage(seed);
  for (const p of ['./calendar', './fuel-log', './classes'])
    delete require.cache[require.resolve(p)];
  return { store, cal: require('./calendar') };
}
const C = fresh({}).cal;
const mins = w => w.windows.map(x => x.minutes);
const spans = w => w.windows.map(x => x.from + '–' + x.to);

async function main() {

// ---- classification --------------------------------------------------
ok.section('classify');
{
  const c = C.classify;
  ok('a manual override beats everything', c('Zwift ride', { 'Zwift ride': 'family' }, 'coaching') === 'family');
  ok("a dedicated calendar beats the title's own words",
    c('Team meeting', null, 'coaching') === 'coaching', c('Team meeting', null, 'coaching'));
  ok('a ride is training', c('Morning Zwift ride') === 'training');
  ok('an interval session is training', c('Interval session — 6x4') === 'training');
  ok('coaching is coaching', c('Coaching — 16 ECNL') === 'coaching');
  ok('a drive is a commute, not work', c('Drive to McDonogh') === 'commute', c('Drive to McDonogh'));
  ok('school is work', c('McDonogh faculty meeting') === 'work');
  ok('a flight is travel', c('Flight to Newark') === 'travel');
  ok('a tentative hold is flexible', c('Hold — maybe') === 'flexible');
  ok('an unknown title is busy, not free', c('Dentist') === 'busy');
  // Current behaviour, pinned rather than endorsed: nothing in the title rules
  // matches a session named the way intervals.icu names it. It costs nothing
  // today — planned work arrives already categorised from intervals.js — but a
  // Google event titled this way blocks the very window it describes.
  ok('an intervals.icu-style title is NOT recognised as training (falls through to busy)',
    c('VO2 6x4 (dawn)') === 'busy', c('VO2 6x4 (dawn)'));
  ok('an empty title is busy', c('') === 'busy' && c(undefined) === 'busy');
}

// ---- the availability windows ---------------------------------------
ok.section('windowsForDate');
{
  const w = C.windowsForDate([], DAY);
  ok('an empty day is one window, 5:00a to 9:30p',
    w.windows.length === 1 && w.available_min === DAY_MIN, JSON.stringify(spans(w)));
  ok('and it is labelled a morning window',
    w.windows[0].from === '5:00a' && w.windows[0].to === '9:30p' && w.windows[0].slot === 'morning',
    JSON.stringify(w.windows[0]));
}
{
  const w = C.windowsForDate([timed(DAY, 9, 0, 12, 0, { category: 'work' })], DAY);
  ok('a blocking event splits the day in two', mins(w).join(',') === '240,570', JSON.stringify(spans(w)));
  ok('available time is what is left', w.available_min === 810, String(w.available_min));
}
{
  // The engine answers when Harry *can* train; a ride already on the calendar
  // is not something to schedule around.
  const w = C.windowsForDate([timed(DAY, 6, 0, 7, 30, { category: 'training' })], DAY);
  ok('a training event does not block training time', w.available_min === DAY_MIN,
    String(w.available_min));
}
{
  const w = C.windowsForDate([timed(DAY, 9, 0, 12, 0, { category: 'work' }),
    timed(DAY, 10, 0, 11, 0, { category: 'busy' })], DAY);
  ok('an event inside another does not carve a phantom window',
    mins(w).join(',') === '240,570', JSON.stringify(spans(w)));
}
{
  // 5:00a–8:00a then 8:20a–10:00a: the 20-minute gap is not a training window.
  const w = C.windowsForDate([timed(DAY, 5, 0, 8, 0, { category: 'work' }),
    timed(DAY, 8, 20, 10, 0, { category: 'work' })], DAY);
  ok('a sliver under 30 minutes is not offered as a window',
    mins(w).join(',') === '690', JSON.stringify(spans(w)));
}
{
  const w = C.windowsForDate([timed(DAY, 20, 0, 23, 0, { category: 'family' })], DAY);
  ok('an event running past bedtime clamps rather than going negative',
    mins(w).join(',') === '900' && w.windows[0].to === '8:00p', JSON.stringify(spans(w)));
}
{
  // Classes come from the timetable, not Google, and occupy the day just as hard.
  const w = C.windowsForDate([], DAY, [[480, 600]]);
  ok('an outside busy block occupies the day too',
    mins(w).join(',') === '180,690', JSON.stringify(spans(w)));
}
{
  const w = C.windowsForDate([allDay(DAY, OTHER_DAY, { category: 'travel', summary: 'NJ Showcase' })], DAY);
  ok('an all-day travel event takes the whole day',
    w.windows.length === 0 && w.available_min === 0 && w.travel === true, JSON.stringify(w));
}
{
  const w = C.windowsForDate([allDay(DAY, OTHER_DAY, { category: 'busy' })], DAY);
  ok('an all-day block is not necessarily travel',
    w.available_min === 0 && w.travel === false, JSON.stringify(w));
}
{
  // A showcase weekend: end is exclusive, the way Google writes all-day events.
  const showcase = allDay('2026-08-21', '2026-08-24', { category: 'travel' });
  ok('a multi-day event covers its first day', C.windowsForDate([showcase], '2026-08-21').available_min === 0);
  ok('and its middle day', C.windowsForDate([showcase], '2026-08-22').available_min === 0);
  ok('and its last day', C.windowsForDate([showcase], '2026-08-23').available_min === 0);
  ok('but not the day the end date names', C.windowsForDate([showcase], '2026-08-24').available_min === DAY_MIN);
}
{
  ok('an event on another day does not touch this one',
    C.windowsForDate([timed(OTHER_DAY, 9, 0, 17, 0, { category: 'work' })], DAY).available_min === DAY_MIN);
}
{
  // 13:00Z on this date is 9:00a Eastern. Reading it in the server's UTC would
  // block from 1:00p and hand back a morning that is not free.
  const w = C.windowsForDate([ev({ start: '2026-08-19T13:00:00Z', end: '2026-08-19T16:00:00Z',
    category: 'work' })], DAY);
  ok('clock times are read in Harry\'s zone, not the server\'s',
    w.windows[0].to === '9:00a', JSON.stringify(spans(w)));
}
{
  const midday = C.windowsForDate([timed(DAY, 5, 0, 13, 0, { category: 'work' })], DAY);
  ok('a window opening at 1:00p is midday', midday.windows[0].slot === 'midday', midday.windows[0].slot);
  const evening = C.windowsForDate([timed(DAY, 5, 0, 16, 0, { category: 'work' })], DAY);
  ok('a window opening at 4:00p is evening', evening.windows[0].slot === 'evening', evening.windows[0].slot);
}

// ---- the recommendation ----------------------------------------------
ok.section('recommendToday');
{
  const day = (windowMins, travel) => ({ windows: windowMins.map(m => ({ minutes: m })), travel: !!travel });
  const r = C.recommendToday;
  ok('travel is a rest day whatever the calendar says',
    r(day([180], true), 80, { hi_min: 60 }).recommendation === 'rest day — no window');
  ok('no window worth the name is a rest day',
    r(day([20, 15]), 80).recommendation === 'rest day — no window');
  ok('red recovery overrides a wide-open day',
    r(day([300]), 20).recommendation === 'mobility + easy walk — recovery is red');
  ok('yellow with an hour is Z2 only', r(day([90]), 50).recommendation === 'Z2 only, keep it honest');
  ok('yellow with less is a recovery spin',
    r(day([45]), 50).recommendation === 'mobility + recovery spin');
  ok('green with hard minutes owed and an hour free is threshold',
    r(day([90]), 80, { hi_min: 45, aerobic_h: 0 }).recommendation
      === 'threshold session (e.g., 4×8) — hard minutes owed');
  ok('green with only the aerobic bucket owed and 75 minutes is Z2',
    r(day([80]), 80, { hi_min: 0, aerobic_h: 3 }).recommendation === 'Z2 — pay the aerobic bucket');
  ok('green with nothing owed and 40 minutes is openers or strength',
    r(day([45]), 80).recommendation === 'openers or strength');
  ok('a short green window is mobility', r(day([35]), 80).recommendation === 'mobility');
  ok('the best window is the widest one, not the first',
    r(day([35, 120]), 80).best_window_min === 120, String(r(day([35, 120]), 80).best_window_min));
  // Band edges, so a change to them is deliberate.
  ok('67 is green', r(day([300]), 67).recovery === 'green');
  ok('66 is yellow', r(day([300]), 66).recovery === 'yellow');
  ok('34 is yellow', r(day([300]), 34).recovery === 'yellow');
  ok('33 is red', r(day([300]), 33).recovery === 'red');
  ok('no recovery data is not treated as red',
    r(day([300]), null).recovery === null && r(day([300]), null).recommendation === 'openers or strength',
    JSON.stringify(r(day([300]), null)));
}

// ---- the week --------------------------------------------------------
ok.section('weekAvailability');
{
  const w = C.weekAvailability([], null);
  ok('seven days, starting today', w.days.length === 7 && w.days[0].date === tz.todayKey(),
    w.days.map(d => d.date).join(','));
  ok('each day carries its weekday', !!w.days[0].dow);
  ok('a clear week is 115.5 free hours', w.available_h === 115.5, String(w.available_h));
  ok('without recovery data it takes a conservative share',
    w.recommended_h === 63.5 && /no recovery data/.test(w.reason),
    JSON.stringify({ h: w.recommended_h, reason: w.reason }));
}
{
  const green = C.weekAvailability([], 80);
  const yellow = C.weekAvailability([], 50);
  const red = C.weekAvailability([], 20);
  ok('green takes the largest share', green.recommended_h === 69.3 && green.reason === 'recovery green',
    String(green.recommended_h));
  ok('yellow is trimmed below green',
    yellow.recommended_h < green.recommended_h && /trimmed/.test(yellow.reason),
    JSON.stringify({ y: yellow.recommended_h, reason: yellow.reason }));
  ok('red is trimmed below yellow',
    red.recommended_h < yellow.recommended_h && /minimal/.test(red.reason),
    JSON.stringify({ r: red.recommended_h, reason: red.reason }));
  ok('the raw free hours do not move with recovery — only the share does',
    green.available_h === red.available_h);
}
{
  const busyWeek = [];
  for (let i = 0; i < 7; i++) busyWeek.push(allDay(tz.shiftKey(tz.todayKey(), i),
    tz.shiftKey(tz.todayKey(), i + 1), { category: 'travel' }));
  const w = C.weekAvailability(busyWeek, 80);
  ok('a week away is zero hours', w.available_h === 0 && w.recommended_h === 0, JSON.stringify(w.available_h));
  ok('and every day is flagged as travel', w.days.every(d => d.travel === true));
}

// ---- the day, hour by hour -------------------------------------------
ok.section('scheduleForDate');
{
  const events = [
    timed(DAY, 18, 0, 19, 30, { summary: 'U16 ECNL training', category: 'coaching',
      source: 'coaching', calendar: '16 ECNL', location: 'Seminary Park' }),
    timed(DAY, 9, 0, 12, 0, { summary: 'Classes', category: 'work' }),
    timed(DAY, 6, 0, 7, 0, { summary: 'VO2 6x4 (dawn)', category: 'training' }),
    allDay(DAY, OTHER_DAY, { summary: 'NJ Showcase (away)', category: 'travel' })
  ];
  const s = C.scheduleForDate(events, DAY);
  ok('all-day events are separated from the timeline',
    s.all_day.length === 1 && s.all_day[0].summary === 'NJ Showcase (away)', JSON.stringify(s.all_day));
  ok('timed events come back in clock order',
    s.events.map(e => e.summary).join(' | ') === 'VO2 6x4 (dawn) | Classes | U16 ECNL training',
    s.events.map(e => e.summary).join(' | '));
  ok('clock times are formatted for the page',
    s.events[0].from === '6:00a' && s.events[2].to === '7:30p',
    JSON.stringify([s.events[0].from, s.events[2].to]));
  ok('durations computed', s.events.map(e => e.minutes).join(',') === '60,180,90',
    s.events.map(e => e.minutes).join(','));
  ok('blocking is marked per event, and a ride does not block',
    s.events.map(e => e.blocking).join(',') === 'false,true,true',
    s.events.map(e => e.blocking).join(','));
  ok('the coaching calendar is named and its source kept',
    s.events[2].calendar === '16 ECNL' && s.events[2].source === 'coaching');
  ok('location carried through', s.events[2].location === 'Seminary Park');
  ok('everything is returned, blocking or not', s.events.length === 3);
}
{
  const s = C.scheduleForDate([], DAY);
  ok('an empty day is an empty timeline, not a null',
    Array.isArray(s.events) && s.events.length === 0 && s.all_day.length === 0);
}

// ---- the days the front page renders ---------------------------------
ok.section('scheduleDays');
{
  const today = tz.todayKey();
  const days = C.scheduleDays([], 3, null, 1);
  ok('day 0 is as far back as asked', days[0].date === tz.shiftKey(today, -1), days[0].date);
  ok('three days returned', days.length === 3, String(days.length));
  ok('today is flagged, and only today',
    days.filter(d => d.today).length === 1 && days[1].today === true,
    days.map(d => d.date + (d.today ? '*' : '')).join(','));
  ok('each day carries its weekday and label', !!days[0].dow && !!days[0].label,
    days[0].dow + ' / ' + days[0].label);
  ok('and its availability', days[0].available_min === DAY_MIN);
}
{
  const today = tz.todayKey();
  const planned = {};
  planned[today] = [
    { summary: 'Threshold 3x12 (dawn)', category: 'training', source: 'intervals',
      kind: 'ride', allDay: false, blocking: false, start_min: 330, end_min: 401, minutes: 71 },
    { summary: 'Strength — Phase 1', category: 'training', source: 'intervals',
      kind: 'lifting', allDay: true, blocking: false, minutes: 45 }
  ];
  const days = C.scheduleDays([timed(today, 9, 0, 12, 0, { summary: 'Classes', category: 'work' })],
    2, planned, 0);
  const day0 = days[0];
  ok('planned work is merged into the day in clock order',
    day0.events.map(e => e.summary).join(' | ') === 'Threshold 3x12 (dawn) | Classes',
    day0.events.map(e => e.summary).join(' | '));
  ok('an untimed planned session goes to the all-day row',
    day0.all_day.length === 1 && day0.all_day[0].summary === 'Strength — Phase 1',
    JSON.stringify(day0.all_day.map(e => e.summary)));
  ok('planned work does not consume the availability windows',
    day0.available_min === 810, String(day0.available_min));
  ok('a day with no planned work is still a day', days[1].events.length === 0);
}

// ---- the routes ------------------------------------------------------
ok.section('routes');
{
  const { cal } = fresh({ gcal: { accounts: [
    { id: 'harry@mdunitedfc.org', tokens: { access_token: 'a', refresh_token: 'r',
      expires_at: Date.now() + 3600e3 }, calendar_list: [{ id: 'p', name: 'harry@mdunitedfc.org', primary: true },
      { id: 'e', name: '16 ECNL' }], synced_at: '2026-08-17T10:00:00.000Z' },
    { id: 'harry@school.edu', tokens: { access_token: 'b' }, calendar_list: [],
      auth_error: 'invalid_grant' }
  ], events: [ev({ start: at(DAY, 9, 0), end: at(DAY, 10, 0), account: 'harry@mdunitedfc.org' })],
    synced_at: '2026-08-17T10:00:00.000Z' } });
  const app = await serve(cal.attach);

  ok('/gcal/status needs a credential', (await app.get('/gcal/status')).status === 401);
  const st = (await app.get('/gcal/status', TOKEN_Q)).json;
  ok('both accounts are listed', st.connected === true && st.accounts.length === 2,
    JSON.stringify(st.accounts.map(a => a.id)));
  ok('the coaching calendar is named among them',
    st.accounts[0].calendars.includes('16 ECNL'), JSON.stringify(st.accounts[0].calendars));
  ok('a broken account reports its error rather than vanishing',
    st.accounts[1].auth_error === 'invalid_grant', JSON.stringify(st.accounts[1]));
  ok('event count reported', st.events === 1);

  ok('/gcal/disconnect needs to be told which account',
    (await app.get('/gcal/disconnect', TOKEN_Q)).status === 400);
  const d = (await app.get('/gcal/disconnect?account=harry@school.edu', TOKEN_Q)).json;
  ok('disconnecting removes exactly that account', d.removed === 1
    && d.accounts.join(',') === 'harry@mdunitedfc.org', JSON.stringify(d));
  const after = (await app.get('/gcal/status', TOKEN_Q)).json;
  ok("the remaining account's events survive", after.events === 1 && after.accounts.length === 1);
  await app.close();
}
{
  const { cal } = fresh({});
  const app = await serve(cal.attach);
  const st = (await app.get('/gcal/status', TOKEN_Q)).json;
  ok('never connected reads as connected:false with no accounts',
    st.connected === false && st.accounts.length === 0 && st.events === 0, JSON.stringify(st));
  ok('/availability answers connected:false rather than erroring',
    (await app.get('/availability', TOKEN_Q)).json.connected === false);
  ok('/availability/today likewise',
    (await app.get('/availability/today', TOKEN_Q)).json.connected === false);
  await app.close();
}
{
  // The single-account shape this used to have must migrate, not disappear.
  const { store, cal } = fresh({ gcal: { tokens: { access_token: 'a', refresh_token: 'r',
    expires_at: Date.now() + 3600e3 }, account_email: 'harry@mdunitedfc.org',
    calendar_list: [{ id: 'p', name: 'primary', primary: true }], events: [] } });
  const app = await serve(cal.attach);
  const st = (await app.get('/gcal/status', TOKEN_Q)).json;
  ok('an old single-account store migrates to the account list',
    st.connected === true && st.accounts.length === 1 && st.accounts[0].id === 'harry@mdunitedfc.org',
    JSON.stringify(st.accounts));
  ok('and the migration is written back', !store.gcal.tokens && store.gcal.accounts.length === 1,
    JSON.stringify(Object.keys(store.gcal)));
  await app.close();
}

ok.done();
}

main().catch(e => { console.error(e); process.exit(1); });
