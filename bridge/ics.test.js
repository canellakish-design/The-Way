// ics.test.js — the iCal reader, against a feed shaped like Google's.
// Run: node bridge/ics.test.js
process.env.TZ='UTC';   // production runs UTC; the app zone is America/New_York
const ics = require('./ics');
const tz = require('./tz');
let failed = 0;
const ok=(l,c,x='')=>{ if(!c) failed++; console.log((c?'PASS':'FAIL')+' — '+l+(x?'  '+x:'')); };

const FEED = [
'BEGIN:VCALENDAR','PRODID:-//Google Inc//Google Calendar 70.9054//EN','VERSION:2.0',
'X-WR-CALNAME:16 ECNL',
// weekly Tue/Thu training, 6:00-7:30pm Eastern, with one cancelled date
'BEGIN:VEVENT','UID:train@google.com','SUMMARY:U16 ECNL training',
'LOCATION:Seminary Park','DTSTART;TZID=America/New_York:20260818T180000',
'DTEND;TZID=America/New_York:20260818T193000','RRULE:FREQ=WEEKLY;BYDAY=TU,TH',
'EXDATE;TZID=America/New_York:20260827T180000','END:VEVENT',
// one-off match, UTC form
'BEGIN:VEVENT','UID:match@google.com','SUMMARY:Match vs Bethesda',
'DTSTART:20260822T140000Z','DTEND:20260822T160000Z','END:VEVENT',
// all-day showcase spanning 3 days
'BEGIN:VEVENT','UID:showcase@google.com','SUMMARY:ECNL Showcase',
'DTSTART;VALUE=DATE:20260829','DTEND;VALUE=DATE:20260901','END:VEVENT',
// folded long line + escaped comma
'BEGIN:VEVENT','UID:long@google.com','SUMMARY:Team meeting\\, film review and ',' planning',
'DTSTART;TZID=America/New_York:20260819T160000','DTEND;TZID=America/New_York:20260819T170000','END:VEVENT',
// cancelled
'BEGIN:VEVENT','UID:gone@google.com','SUMMARY:Cancelled thing','STATUS:CANCELLED',
'DTSTART;TZID=America/New_York:20260820T090000','DTEND;TZID=America/New_York:20260820T100000','END:VEVENT',
'END:VCALENDAR'].join('\r\n');

const evs = ics.eventsFromFeed(FEED, null, '2026-08-17', '2026-09-06');
const byDay = {};
for (const e of evs) { const k = e.allDay ? e.start : tz.keyOf(new Date(e.start)); (byDay[k]=byDay[k]||[]).push(e); }

ok('calendar name from X-WR-CALNAME', evs[0].calendar==='16 ECNL', evs[0].calendar);
const tue = evs.find(e=>!e.allDay && tz.keyOf(new Date(e.start))==='2026-08-18');
ok('recurring Tue instance exists', !!tue);
ok('  at 6:00pm Eastern (not UTC)', tue && tz.fmtMin(tz.minutesOf(new Date(tue.start)))==='6:00p', tue&&tz.fmtMin(tz.minutesOf(new Date(tue.start))));
ok('  90 minutes long', tue && (new Date(tue.end)-new Date(tue.start))===90*60000);
ok('  location kept', tue && tue.location==='Seminary Park', tue&&tue.location);
ok('BYDAY gives Thursday too', !!evs.find(e=>tz.keyOf(new Date(e.start))==='2026-08-20' && /training/.test(e.summary)));
ok('EXDATE removes Aug 27', !evs.find(e=>tz.keyOf(new Date(e.start))==='2026-08-27' && /training/.test(e.summary)));
ok('recurrence continues into September', !!evs.find(e=>tz.keyOf(new Date(e.start))==='2026-09-01' && /training/.test(e.summary)));
const match = evs.find(e=>/Match/.test(e.summary));
ok('UTC-form event converts to 10:00a Eastern', match && tz.fmtMin(tz.minutesOf(new Date(match.start)))==='10:00a', match&&tz.fmtMin(tz.minutesOf(new Date(match.start))));
const show = evs.find(e=>/Showcase/.test(e.summary));
ok('all-day event kept as all-day', show && show.allDay===true && show.start==='2026-08-29', show&&show.start);
ok('  spans to Sep 1 exclusive', show && show.end==='2026-09-01', show&&show.end);
const meet = evs.find(e=>/Team meeting/.test(e.summary));
ok('folded line rejoined + comma unescaped', meet && meet.summary==='Team meeting, film review and planning', meet&&meet.summary);
ok('cancelled event dropped', !evs.find(e=>/Cancelled/.test(e.summary)));
ok('nothing before the window', !evs.find(e=>(e.allDay?e.start:tz.keyOf(new Date(e.start)))<'2026-08-17'));
ok('nothing after the window', !evs.find(e=>(e.allDay?e.start:tz.keyOf(new Date(e.start)))>'2026-09-06'));
console.log('total events expanded:', evs.length);

// the app's zone helpers, exercised across both DST directions
ok('6am EDT reads as 6am', tz.minutesOf(new Date('2026-08-17T10:00:00Z'))===360);
ok('6am EST reads as 6am', tz.minutesOf(new Date('2027-01-15T11:00:00Z'))===360);
ok('day key holds at 9pm Eastern', tz.keyOf(new Date('2026-08-18T01:00:00Z'))==='2026-08-17');

console.log(failed ? `\n${failed} FAILED` : '\nall passing');
process.exit(failed ? 1 : 0);
