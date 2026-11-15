// ============================================================
// lifts.js — the weight training: Mike Matthews' five-day plan (Bigger
// Leaner Stronger), logged set by set, with each week's five days placed
// around the riding and the coaching calendar.
//
// The plan's shape is the book's: five workouts, each once every seven
// days, in this order when nothing else decides it: Push; Pull and calves;
// Upper body and core; Legs; Upper body and core. From 15 Nov 2026 the second upper day is a second leg day
// (Harry: "I think leg strength is an issue"; the 2026 review of strength work for cyclists: two leg-focused
// sessions a week while building, one to maintain): Push; Pull and calves; Upper body and core; Legs 1 (the
// book's heavy leg day); Legs 2 (lighter, one leg at a time, short of failure). Each is two or three
// major muscle groups, nine to twelve hard sets of 4 to 6 reps on the big
// lifts (about 80 to 85% of a one-rep max), 6 to 8 or 8 to 10 on the
// smaller ones, two to three minutes between hard sets, hardest lift
// first. Progression is Matthews' double progression: when a hard set
// reaches the top of its range, the next set (here, the next session) adds
// weight, ten pounds on the Bowflex and the next bell up for a kettlebell,
// five pounds on the small lifts, and the reps go back to the bottom of
// the range; a set that cannot reach the bottom of the range drops the
// weight a step. Eight weeks on, then a deload week.
//
// The five are the book's barbell and dumbbell lifts, done at school or at
// Lifetime; each note names the home version on the Bowflex and the bells.
//
// Where the five land in the week: legs goes on the day before a day off
// the bike or a long coaching day (so the soreness falls on a day with no
// ride), or on a long coaching day itself (no ride anyway). The two days
// with no lift are the two biggest riding days. The other four fill the
// rest in the book's order, with the pull day (deadlift) kept a day clear of
// the legs day (Romanian deadlift) when the week allows.
//   GET  /lifts                 templates, this week's placement, each exercise's target, history
//   POST /lifts                 { template, date?, exercises:[{name, sets:[{reps, lb}]}], notes? }
//   POST /lifts/schedule        { time? } puts this week's five on the calendar as planned workouts
//   DELETE /lifts/:id
// ============================================================
const { getJSON, setJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');

const BELLS = [18, 26, 35, 44, 53, 62, 70, 80, 88];     // the common kettlebell sizes, in pounds
// ex(name, sets, lo, hi, kind, start, note, inc): kind bar | db | cable | bell | bowflex | reps | time; inc is the step in pounds
// What each lift is: the muscles it trains and how it is done, shown under its name on the Lift page (Harry,
// 14 Nov 2026: "Put a description under every lift"). The short cue and the at-home version stay in `note`.
const DESC = {
  'Incline barbell bench press': 'Upper chest and the front of the shoulders, with the triceps. On a bench set to about 30 degrees, grip just outside shoulder width, lower the bar to the upper chest and press it back up over the shoulders.',
  'Barbell bench press': 'The whole chest, with the shoulders and triceps. Lying flat with your eyes under the bar, lower it to mid-chest and press it up and slightly back.',
  'Dumbbell bench press': 'The chest, each side working on its own through a longer range than the bar allows. Lying flat, lower a dumbbell beside each side of the chest and press them up together.',
  'Triceps pushdown': 'The triceps, the back of the upper arm. At a high cable, keep the upper arms still at your sides and straighten the elbows fully, then let the hands rise to chest height.',
  'Barbell deadlift': 'The whole back of the body: hamstrings, glutes, lower and upper back, and grip. With the bar over mid-foot, hinge down to grip it with a flat back and stand up by pushing the floor away; lower it the same way.',
  'Barbell row': 'The middle and upper back and the lats, with the biceps. Hinged forward with a flat back and the bar at arm\'s length, pull it to the lower ribs and lower it under control.',
  'Lat pulldown': 'The lats, the wide muscles of the back, with the biceps. Seated with the thighs under the pad, pull the bar from overhead to the upper chest and let it rise until the arms are straight.',
  'Standing calf raise': 'The calves. With the balls of the feet on a step or the machine\'s platform, lower the heels to a full stretch, then rise as high as you can.',
  'Close-grip bench press': 'The triceps first, with the chest and shoulders. A bench press with the hands shoulder width apart: lower the bar to the lower chest with the elbows close to the body and press up.',
  'One-arm dumbbell row': 'The lats and middle back, one side at a time. With one hand and knee on a bench and the back flat, pull the dumbbell from a straight arm up to the hip and lower it slowly.',
  'Seated dumbbell press': 'The shoulders, with the triceps. Sitting upright with a dumbbell at each shoulder, press them overhead until the arms are straight and lower them to ear height.',
  'Captain\'s chair leg raise': 'The abdominals and hip flexors. Held up on the forearm pads with your back against the rest, raise the knees (or straight legs) to hip height and lower them slowly.',
  'Barbell back squat': 'The quads and glutes, with the whole trunk bracing. With the bar across the upper back and feet about shoulder width, sit down between the hips until the thighs pass parallel, then stand.',
  'Leg press': 'The quads and glutes, without loading the back. Seated in the machine, lower the platform until the knees are well bent and press it away.',
  'Romanian deadlift': 'The hamstrings and glutes. From standing with the bar at the thighs, push the hips back with soft knees and a flat back until the hamstrings are stretched, then stand tall.',
  'Barbell overhead press': 'The shoulders and triceps, with the trunk holding you steady. Standing, press the bar from the collarbones straight overhead to locked arms and lower it back.',
  'Dumbbell row': 'The lats and middle back, one side at a time. With one hand on a bench and the back flat, pull the dumbbell up to the hip and lower it slowly.',
  'Alternating dumbbell curl': 'The biceps. Standing with a dumbbell in each hand, curl one to the shoulder with the elbow still, lower it, then the other.',
  'Cable crunch': 'The abdominals, against weight. Kneeling under a high cable with the rope held beside your head, curl the trunk down, ribs toward hips, without sitting back.',
  'Bowflex seated row': 'The middle back and lats. Sitting facing the rods with the chest up, pull the handles to your ribs and return under control.',
  'Bowflex chest press': 'The chest, shoulders and triceps. Sitting with your back on the pad, press the handles forward until the arms are straight.',
  'Kettlebell seated press': 'The shoulders. Sitting tall, press one bell from the shoulder to overhead and lower it; then the other side.',
  'Kettlebell curl': 'The biceps. Holding one bell by the horns in both hands, curl it to the chest with the elbows at your sides.',
  'Bulgarian split squat': 'The quads and glutes, one leg at a time, as on the bike. With the back foot on a bench behind you and a dumbbell in each hand, lower straight down until the front thigh is level, then stand.',
  'Barbell hip thrust': 'The glutes, the muscle that drives the pedal down. With the shoulders on a bench and the bar across the hips, push the hips up until the body is level from knee to shoulder, pause, and lower.',
  'Single-leg leg press': 'The quads and glutes of each leg on its own, so the stronger leg cannot carry the weaker. One foot on the plate, lower until the knee nears the chest and press, without locking out.',
  'Seated leg curl': 'The hamstrings, the back of the thigh. Sitting with the pad over the lower shins, bend the knees to pull it under the seat and let it back slowly.',
  'Two-hand kettlebell swing': 'The hips: glutes and hamstrings, with the grip and the trunk holding on. Hinge back with a flat back, hike the bell between the legs and snap the hips forward so it floats to chest height; the arms only guide it.',
  'Goblet squat': 'The quads and glutes, with the trunk held upright by the bell. Holding the bell by the horns at the chest, sit down between the heels until the elbows touch the knees, then stand.',
  'Kettlebell one-arm row': 'The lats and the middle back, one side at a time. One hand and knee on a bench or the bell-side foot back in a split stance, pull the bell to the hip and lower it slowly.',
  'Half-kneeling kettlebell press': 'The shoulder, with the trunk and hips kept square. On one knee, the bell racked at the shoulder on the kneeling side, press it straight overhead and lower it to the rack.',
  'Dead bug': 'The deep abdominals. On your back with arms and knees up, lower the opposite arm and leg toward the floor while the lower back stays pressed down, then change sides.',
  'Farmer carry': 'The grip, the shoulders and the whole trunk. A bell in each hand (or one racked at the shoulder), walk tall with short quick steps and the ribs down.',
  'Suitcase carry': 'The side of the trunk, which stops you tipping. One bell in one hand, walk tall without leaning toward it or away from it; change hands.',
  'Hollow hold': 'The abdominals, held long. On your back with the lower back pressed down, lift the shoulders and the straight legs a little off the floor and hold.',
  'Plank': 'The whole trunk. Forearms and toes on the floor, the body held in one straight line.'
};
const ex = (name, sets, lo, hi, kind, start, note, inc) => ({ name, desc: DESC[name] || '', sets, reps_lo: lo, reps_hi: hi, kind, start_lb: start, note: note || '', inc: inc || (kind === 'bowflex' || kind === 'bar' || kind === 'cable' ? 10 : kind === 'db' ? 5 : 0), rest_min: hi <= 6 ? 3 : hi <= 8 ? 2.5 : 2 });
const TEMPLATES = [
  { key: 'push', name: 'Push', short: 'Push', minutes: 55, order: 1,
    why: 'Chest, shoulders and triceps: incline bench, bench, dumbbell bench, triceps pushdown. At Life Time.',
    exercises: [
      // Harry, 9 Nov: the incline first, and 135 (the bar and a 45 a side) for 4 as its starting point
      ex('Incline barbell bench press', 3, 4, 6, 'bar', 135, 'Bench at 30 degrees. At home: Bowflex incline press.', 10),
      ex('Barbell bench press', 3, 4, 6, 'bar', 135, 'Shoulder blades pinned, bar to the chest, feet planted. At home: Bowflex chest press.', 10),
      ex('Dumbbell bench press', 3, 4, 6, 'db', 50, 'The weight of one dumbbell. Elbows at 45 degrees. At home: kettlebell floor press.', 5),
      ex('Triceps pushdown', 3, 6, 8, 'cable', 50, 'Elbows pinned to the sides. At home: Bowflex pushdown.', 5)
    ] },
  { key: 'pull', name: 'Pull and calves', short: 'Pull', minutes: 55, order: 2,
    why: 'Back and biceps, calves at the end: deadlift, barbell row, lat pulldown, calf raise.',
    exercises: [
      ex('Barbell deadlift', 3, 4, 6, 'bar', 185, 'Hips back, bar close, stand tall; reset every rep. At home: two-bell kettlebell deadlift.', 10),
      ex('Barbell row', 3, 4, 6, 'bar', 115, 'Pull to the belly, squeeze the blades, no shrug. At home: Bowflex seated row.', 10),
      ex('Lat pulldown', 3, 4, 6, 'cable', 120, 'Chest up, elbows down and back. At home: Bowflex lat pulldown.', 10),
      ex('Standing calf raise', 3, 8, 10, 'cable', 150, 'Machine, or a bell in hand with toes on a step. Pause at the top and the bottom.', 10)
    ] },
  { key: 'upper-1', name: 'Upper body and core', short: 'Upper', minutes: 50, order: 3,
    why: 'The book\'s upper day: close-grip bench, one-arm dumbbell row, seated dumbbell press, then core.',
    exercises: [
      ex('Close-grip bench press', 3, 4, 6, 'bar', 115, 'Hands shoulder width, elbows tucked. At home: Bowflex close-grip press.', 10),
      ex('One-arm dumbbell row', 3, 4, 6, 'db', 55, 'Each side, hand on the bench, pull to the hip. At home: kettlebell one-arm row.', 5),
      ex('Seated dumbbell press', 3, 4, 6, 'db', 40, 'The weight of one dumbbell. Ribs down. At home: kettlebell seated press.', 5),
      ex('Captain\'s chair leg raise', 3, 10, 15, 'reps', 0, 'Slow down, no swing. At home: hanging knee raise or lying leg raise.')
    ] },
  { key: 'legs', name: 'Legs 1', short: 'Legs 1', minutes: 55, order: 4,
    why: 'The heavy leg day, the book\'s: back squat, leg press, Romanian deadlift, calf raise. Placed two or three days before a hard ride, never the day before one.',
    exercises: [
      ex('Barbell back squat', 3, 4, 6, 'bar', 155, 'Below parallel, knees out, brace. At home: two-bell kettlebell front squat.', 10),
      ex('Leg press', 3, 6, 8, 'cable', 270, 'Feet shoulder width, knees to the chest, do not lock out. At home: Bulgarian split squat with bells.', 20),
      ex('Romanian deadlift', 3, 4, 6, 'bar', 135, 'Hinge until the hamstrings pull, no lower; the bar stays on the thighs. At home: two-bell kettlebell RDL.', 10),
      ex('Standing calf raise', 3, 8, 10, 'cable', 150, 'Machine, or a bell in hand with toes on a step.', 10)
    ] },
  { key: 'legs-2', name: 'Legs 2', short: 'Legs 2', minutes: 50, order: 5,
    why: 'The second leg day, lighter and one leg at a time: split squat, hip thrust, single-leg press, leg curl. Every set stops a rep or two short of failure, so the legs are ready for the next hard ride. Two or three days before one, never the day before, and two clear days from Legs 1 when the week allows.',
    exercises: [
      ex('Bulgarian split squat', 3, 6, 8, 'db', 30, 'Each leg; the weight of one dumbbell. Back foot on the bench, front shin near upright. At home: the same with two bells.', 5),
      ex('Barbell hip thrust', 3, 6, 8, 'bar', 135, 'Shoulders on the bench, bar over the hips, a pause at the top. At home: kettlebell glute bridge.', 10),
      ex('Single-leg leg press', 3, 8, 10, 'cable', 110, 'Each leg, about half of what both legs press. Do not lock out. At home: kettlebell step-up.', 10),
      ex('Seated leg curl', 3, 8, 10, 'cable', 90, 'Slow on the way back. At home: sliding leg curl on the floor.', 10)
    ] }
];
// The second upper day the plan held until 15 Nov 2026 (two leg days took its place). Kept so an entry still on the
// calendar and any saved session keep their name; it is not one of the five and is never placed.
const RETIRED = [
  { key: 'upper-2', name: 'Upper 2: upper body and core', retired: true, short: 'Upper 2', minutes: 50, order: 5,
    why: 'The book\'s second upper day: overhead press, dumbbell row, curls, then core.',
    exercises: [
      ex('Barbell overhead press', 3, 4, 6, 'bar', 85, 'Glutes tight, press straight up, head through at the top. At home: Bowflex shoulder press.', 10),
      ex('Dumbbell row', 3, 4, 6, 'db', 55, 'Each side. At home: Bowflex seated row.', 5),
      ex('Alternating dumbbell curl', 3, 6, 8, 'db', 25, 'The weight of one dumbbell; no swing. At home: kettlebell curl.', 5),
      ex('Cable crunch', 3, 10, 12, 'cable', 80, 'Kneeling, crunch the ribs to the hips. At home: Bowflex cable crunch.', 5)
    ] }
];
// The pump: a short home session on the Bowflex and the kettlebell, upper
// body and core only so the legs stay fresh for the riding and the heavy
// days. Light loads taken close to failure (10 to 15 reps) grow muscle about
// as well as heavy ones; they build less strength, which is the five's job.
// It supplements the five, never replaces one, and does not count toward
// them. Any day but legs and the day before it.
const PUMP = { key: 'pump', name: 'Pump at home', short: 'Pump', minutes: 20, supplement: true,
  why: 'Fifteen to twenty minutes on the Bowflex and the bell, upper body and core, every set close to failure. Volume for the arms, shoulders and back that barely touches recovery. Does not count toward the five.',
  exercises: [
    ex('Bowflex seated row', 3, 10, 15, 'bowflex', 70, 'Close to failure on every set; a minute between.', 5),
    ex('Bowflex chest press', 2, 10, 15, 'bowflex', 70, '', 5),
    ex('Kettlebell seated press', 2, 10, 15, 'bell', 26, 'One bell, each side.'),
    ex('Kettlebell curl', 2, 10, 15, 'bell', 18, 'Both hands on the horns.'),
    ex('Plank', 2, 45, 60, 'time', 0, 'Seconds. Hips level, breathe.')
  ] };
// The Kettlebell Blasts: thirty minutes at home with one bell, extra to the five like the Pump, never one of them.
// They were calendar notes only until 15 Nov 2026 (Harry: "move the kettlebell blasts to lifting. So when I click on
// lifting, they're there. And do the same thing with the instructions"): now they are sessions here, each exercise
// with its description, its target and its sets to log. Effort 6 to 7 out of 10, never to failure.
const BLAST_CUE = 'Bell: one you can swing for 15 crisp reps with about 3 left in the tank. Effort 6 to 7 out of 10, never to failure: this is extra to the five gym lifts.';
const BLASTS = [
  { key: 'blast-a', name: 'Kettlebell Blast A', short: 'Blast A', minutes: 30, supplement: true, blast: true, title: 'Swing and Squat',
    why: 'Swing and Squat: twenty minutes on the minute, swings on the odd minutes and goblet squats on the even ones, then a carry and a plank. It works the legs, so not on a leg day, the day before one, or the day before a hard ride. Extra to the five.',
    warmup: 'Warm up, 5 min: halos, 5 each way; prying goblet squat hold, 3 × 20 s; hip hinge with the bell, 10.',
    cue: 'The blast is 20 minutes on the minute: a new set at the top of every minute, swings on the odd minutes, goblet squats on the even ones, and rest for what is left of the minute. ' + BLAST_CUE,
    exercises: [
      ex('Two-hand kettlebell swing', 10, 10, 15, 'bell', 35, 'Odd minutes. Crisp: stop the set when the snap goes.'),
      ex('Goblet squat', 10, 5, 8, 'bell', 35, 'Even minutes. Elbows inside the knees at the bottom.'),
      ex('Suitcase carry', 2, 30, 40, 'time', 0, 'Seconds each side, about 40 m. The finish, with the plank.'),
      ex('Plank', 2, 45, 60, 'time', 0, 'Seconds. Hips level, breathe.')
    ] },
  { key: 'blast-b', name: 'Kettlebell Blast B', short: 'Blast B', minutes: 30, supplement: true, blast: true, title: 'Press and Carry',
    why: 'Press and Carry: three rounds of row, press, swing and dead bug, then a carry and a hollow hold. Upper body and trunk, so it fits beside a leg day. Extra to the five.',
    warmup: 'Warm up, 5 min: halos, 5 each way; arm bars, 3 each side; bird dogs, 8 each side.',
    cue: 'The blast is 3 rounds of about 6 minutes, 1 minute of rest between rounds: row, press, swings, dead bug, one after the other. ' + BLAST_CUE,
    exercises: [
      ex('Kettlebell one-arm row', 3, 8, 10, 'bell', 35, 'Each side.'),
      ex('Half-kneeling kettlebell press', 3, 6, 8, 'bell', 26, 'Each side. Ribs down, no lean.'),
      ex('Two-hand kettlebell swing', 3, 10, 15, 'bell', 35, 'Crisp: stop the set when the snap goes.'),
      ex('Dead bug', 3, 30, 40, 'time', 0, 'Seconds. Lower back on the floor the whole time.'),
      ex('Farmer carry', 2, 30, 40, 'time', 0, 'Seconds each side, about 40 m; or one bell racked. The finish, with the hollow hold.'),
      ex('Hollow hold', 3, 20, 30, 'time', 0, 'Seconds.')
    ] }
];
// a Blast runs on the clock, not on long rests: what is left of the minute (A), a breath between exercises (B)
for (const t of BLASTS) for (const e of t.exercises) e.rest_min = t.key === 'blast-a' ? 0.5 : 0.75;
const ALL = TEMPLATES.concat([PUMP], BLASTS);
// an extra (the Pump, a Kettlebell Blast): logged and shown, never one of the five and never holding a day against them
const isExtra = k => k === 'pump' || /^blast-/.test(String(k || ''));
// a calendar entry's name to its Blast ("Kettlebell Blast B · home"), else null
const blastOf = name => { const m = /kettlebell\s*blast\s*([ab])?\b/i.exec(String(name || '')); return m ? 'blast-' + (m[1] || 'b').toLowerCase() : null; };
// the words a Blast carries on the calendar, written from the session itself
const blastNotes = t => `${t.name.toUpperCase()} · ${t.title} · ${t.minutes} min\n\n${t.warmup}\n\n${t.exercises.map(e => `  ${e.name}, ${e.sets} × ${e.reps_lo}${e.reps_hi !== e.reps_lo ? ' to ' + e.reps_hi : ''}${e.kind === 'time' ? ' s' : ''}${e.note ? ' (' + e.note + ')' : ''}`).join('\n')}\n\n${t.cue}\nOpen it on the Lift page for each exercise's description and to log the sets.`;
const LEGACY = { 'lift-a': 'Lift A: hinge and push', 'lift-b': 'Lift B: squat and pull' };   // the two sessions this plan replaced
const nameOf = key => (ALL.concat(RETIRED).find(t => t.key === key) || {}).name || LEGACY[key] || key;
const isLegs = k => k === 'legs' || k === 'legs-2';

const e1rm = (lb, reps) => lb > 0 && reps > 0 ? Math.round(lb * (1 + reps / 30)) : null;
function nextBell(lb) { const i = BELLS.findIndex(b => b > lb); return i < 0 ? lb + 10 : BELLS[i]; }
function prevBell(lb) { const below = BELLS.filter(b => b < lb); return below.length ? below[below.length - 1] : Math.max(0, lb - 10); }
const WEIGHTED = new Set(['bell', 'bowflex', 'bar', 'db', 'cable']);
function increment(def, lb) { return def.kind === 'bell' ? nextBell(lb) : WEIGHTED.has(def.kind) ? lb + (def.inc || 10) : lb; }
function decrement(def, lb) { return def.kind === 'bell' ? prevBell(lb) : WEIGHTED.has(def.kind) ? Math.max(0, lb - (def.inc || 10)) : lb; }

// The target for an exercise given the last time it was done (Matthews'
// double progression: a hard set at the top of the range adds weight, a set
// under the bottom of the range takes it off).
function target(def, last) {
  if (!last || !last.sets || !last.sets.length) return { lb: def.start_lb, reps: def.reps_lo, why: 'first time: a weight that makes the last rep hard at the bottom of the range', progress: false };
  const sets = last.sets.filter(s => s.reps > 0);
  const lb = Math.max(...sets.map(s => s.lb || 0));
  const topReps = Math.max(...sets.map(s => s.reps)), minReps = Math.min(...sets.map(s => s.reps));
  if (def.kind === 'time' || def.kind === 'reps') {
    const allTop = sets.length >= def.sets && sets.every(s => s.reps >= def.reps_hi);
    if (allTop) return { lb: 0, reps: Math.min(def.reps_hi + (def.kind === 'time' ? 15 : 2), def.reps_hi * 2), why: `every set reached ${def.reps_hi}: add ${def.kind === 'time' ? '15 seconds' : 'two reps'}`, progress: true };
    return { lb: 0, reps: Math.max(def.reps_lo, Math.min(def.reps_hi, minReps + 1)), why: `hold until every set reaches ${def.reps_hi}`, progress: false };
  }
  if (topReps >= def.reps_hi) return { lb: increment(def, lb), reps: def.reps_lo, why: `a set reached ${def.reps_hi} at ${lb} lb: up to ${increment(def, lb)}, back to ${def.reps_lo} reps`, progress: true };
  if (minReps < def.reps_lo && sets.length >= 2) return { lb: decrement(def, lb), reps: def.reps_lo, why: `a set fell to ${minReps} at ${lb} lb: back to ${decrement(def, lb)} and ${def.reps_lo} to ${def.reps_hi} reps`, progress: false, back: true };
  return { lb, reps: Math.min(def.reps_hi, minReps + 1), why: `${lb} lb again; the weakest set did ${minReps}, aim for ${Math.min(def.reps_hi, minReps + 1)}`, progress: false };
}

async function db() { return getJSON('lifts', { sessions: [] }); }

// ---- the periodization: the next 26 weeks from where the weights are now ----
// Three blocks on the Matthews pattern, each eight weeks and a deload:
//   Block 1, strength: the templates as written (4 to 6 on the big lifts).
//   Block 2, strength-endurance: every range two reps higher (6 to 8 on the
//     big lifts), starting at about 90% of where block 1 ends.
//   Block 3, strength: 4 to 6 again, starting one step above block 1's end.
// Within a block the weights are projected at the rate the double
// progression tends to deliver: a Bowflex compound lift steps up every two
// weeks for the first four, then every three; a kettlebell lift climbs a
// bell every three weeks; a small lift steps every three weeks; timed and
// bodyweight work adds its increment every two. Every week the real
// sessions come in, the projection starts again from them, so this is a
// forecast that keeps correcting itself, never a schedule to hit at any cost.
const BLOCKS = [
  { key: 'strength', name: 'Strength', weeks: 8, shift: 0, start: 'current' },
  { key: 'endurance', name: 'Strength-endurance', weeks: 8, shift: 2, start: 'ninety' },
  { key: 'strength2', name: 'Strength', weeks: 8, shift: 0, start: 'plus' }
];
const roundTo = (def, lb) => def.kind === 'bell' ? (BELLS.find(b => b >= lb - 1) || Math.ceil(lb / 10) * 10) : Math.max(0, Math.round(lb / (def.inc || 5)) * (def.inc || 5));
function stepEvery(def, weekInBlock) {
  if (def.kind === 'time' || def.kind === 'reps') return 2;
  if (def.kind === 'bell') return 3;
  if (def.kind === 'db') return 3;                                          // five-pound dumbbell jumps come slower
  return def.reps_hi <= 6 ? (weekInBlock <= 4 ? 2 : 3) : 3;                 // bar and cable compounds
}
function mondayOf(key) { const d = new Date(key + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }
function periodization(templates, sessions, today) {
  const first = sessions.find(s => TEMPLATES.some(t => t.key === s.template));   // the pump does not start the clock
  const week1 = mondayOf(first ? first.date : today);
  const weekNow = Math.floor((Date.parse(today) - Date.parse(week1)) / (7 * 864e5)) + 1;
  const lastOf = {};
  for (const s of sessions) for (const e of s.exercises || []) lastOf[e.name] = { date: s.date, sets: e.sets };
  const out = [];
  for (const t of templates) {
    const rows = [];
    // the starting point of each exercise: the next target from the last time, else the template's start
    const cur = {}; for (const e of t.exercises) { const tg = target(e, lastOf[e.name] || null); cur[e.name] = e.kind === 'time' || e.kind === 'reps' ? tg.reps : tg.lb; }
    const block1End = {};
    let w = 1;
    for (const b of BLOCKS) {
      const startOf = {};
      for (const e of t.exercises) {
        const v = cur[e.name];
        if (e.kind === 'time' || e.kind === 'reps') startOf[e.name] = b.start === 'current' ? v : b.start === 'ninety' ? Math.max(e.reps_lo, Math.round(v * 0.9)) : v + (e.kind === 'time' ? 15 : 2);
        else startOf[e.name] = b.start === 'current' ? v : b.start === 'ninety' ? roundTo(e, v * 0.9) : increment(e, v);
      }
      const val = Object.assign({}, startOf);
      for (let k = 1; k <= b.weeks; k++) {
        if (k > 1) for (const e of t.exercises) {
          if ((k - 1) % stepEvery(e, k) === 0) val[e.name] = e.kind === 'time' || e.kind === 'reps' ? Math.min(e.reps_hi * 2 + e.reps_lo, val[e.name] + (e.kind === 'time' ? 15 : 2)) : increment(e, val[e.name]);
        }
        rows.push({ week: w, from: tz.shiftKey(week1, (w - 1) * 7), block: b.key, block_name: b.name, deload: false, now: w === weekNow,
          targets: t.exercises.map(e => ({ name: e.name, lb: e.kind === 'time' || e.kind === 'reps' ? 0 : val[e.name], reps_lo: e.kind === 'time' || e.kind === 'reps' ? val[e.name] : e.reps_lo + b.shift, reps_hi: e.kind === 'time' || e.kind === 'reps' ? val[e.name] : e.reps_hi + b.shift, kind: e.kind })) });
        w++;
      }
      // the block's end seeds the next; a deload week follows
      for (const e of t.exercises) cur[e.name] = val[e.name];
      if (b.key === 'strength') Object.assign(block1End, val);
      if (b.key === 'endurance') for (const e of t.exercises) cur[e.name] = block1End[e.name];   // block 3 climbs from block 1's end, not block 2's lighter loads
      rows.push({ week: w, from: tz.shiftKey(week1, (w - 1) * 7), block: b.key, block_name: b.name, deload: true, now: w === weekNow,
        targets: t.exercises.map(e => ({ name: e.name, lb: e.kind === 'time' || e.kind === 'reps' ? 0 : val[e.name], reps_lo: e.kind === 'time' || e.kind === 'reps' ? val[e.name] : e.reps_lo + b.shift, reps_hi: e.kind === 'time' || e.kind === 'reps' ? val[e.name] : e.reps_lo + b.shift + 1, kind: e.kind, half_sets: true })) });
      w++;
    }
    out.push({ key: t.key, name: t.name, short: t.short, rows });
  }
  return { week1, week_now: weekNow, weeks: out[0] ? out[0].rows.length : 0, blocks: BLOCKS.map(b => ({ key: b.key, name: b.name, weeks: b.weeks })), templates: out,
    basis: 'from the next target of each lift (the last session, or the template\'s start), projected at the rate the double progression tends to deliver; re-projected from the real sessions each time one is saved' };
}

// ---- the week ---------------------------------------------------------
// days: [{ date, ride: {name, minutes, tss, hard} | null, coaching_min, long_coaching, off }]
// Returns the same days with .lift set to a template key or null, plus why.
const HARD = /vo2|40\s*\/\s*20|threshold|race|interval|sweet\s*spot|\b(ftp|ramp)\s*test/i;
const LONG_COACHING_MIN = 4 * 60;
const AWAY_DRIVE_MIN = 90;   // a single drive this long: he is not near Life Time that day
// A day can hold more than one lift (Push saved, Pull put on the calendar the same evening): x.locks is
// every session on that day, x.locked the first of them. A key held anywhere is not placed again.
const locksOf = x => x.locks && x.locks.length ? x.locks : x.locked ? [x.locked] : [];
function placeWeek(days, o) {
  const opts = o || {};
  const d = days.map(x => Object.assign({}, x, { lift: null, why: '' }));
  const n = d.length;
  if (!n) return d;
  const load = x => x.ride ? (x.ride.tss || 0) + (x.ride.minutes || 0) / 3 + (x.ride.hard ? 40 : 0) : 0;
  // 1. the two leg days, the heavy one first. Each: the day before a day off the bike (100) or a long coaching day
  //    (90), else a long coaching day itself (80), else a day off (50), else the day before the lightest ride; a
  //    hard-ride day is a last resort. The days past the week (opts.ahead) are looked at, never filled: Sunday is
  //    two days before Tuesday's VO2 whether or not Tuesday is in the window.
  const all = d.concat(opts.ahead || []);
  const recent = opts.recent || {};   // a session lifted in the six days before the window is not due again inside it (10 Nov: Push twice)
  const loads = d.map(load), top = Math.max(...loads), biggest = top > 0 && loads.filter(v => v === top).length === 1 ? loads.indexOf(top) : -1;   // the one biggest ride, when there is one
  const LEGS = ['legs', 'legs-2'], legsAt = {};
  const legsScore = (x, i, key) => {
    let s = -1e3;
    const next = all[i + 1];
    const hardPen = x.ride && x.ride.hard ? 160 : 0;   // a hard-ride day: only when nothing else is open (it must lose to the 70 below)
    if (next && !next.ride) s = 100 - hardPen - load(x) / 10;
    else if (next && next.long_coaching) s = 90 - hardPen - load(x) / 10;
    else if (x.long_coaching) s = 80 - hardPen;
    else if (!x.ride) s = 50;
    else if (next) s = 20 - load(next) / 5 - hardPen;
    else s = 10 - hardPen - load(x) / 10;               // the last day known: nothing is known of the day after
    // Legs against the hard rides (Harry, 15 Nov 2026: "do legs 2 to 3 days out before I do the VO2 max intervals").
    // Heavy leg work leaves the legs short of their best for two days, sometimes three (the drop in what the muscle
    // can be made to do is measurable 48 hours after heavy lifting), so: never the day before a hard ride, and best
    // two or three days ahead of the next one. This outweighs where the soreness would otherwise be put.
    if (next && next.ride && next.ride.hard) s -= 200;
    else if ([all[i + 2], all[i + 3]].some(y => y && y.ride && y.ride.hard)) s += 70;
    if (i === biggest) s -= 40;                           // the week's biggest ride: a leg day there only for want of another
    // the deadlifts (Pull) beside it, on the calendar or done the day before the week begins: a day clear when it can be
    if ([d[i - 1], d[i + 1]].some(y => y && locksOf(y).includes('pull')) || (i === 0 && recent.pull === tz.shiftKey(x.date, -1))) s -= 30;
    // the other leg day: never the same day or the next, and two clear days between them when the week allows
    for (const other of LEGS) if (other !== key) {
      const j = legsAt[other] != null ? legsAt[other] : d.findIndex(y => locksOf(y).includes(other));
      const gap = j >= 0 ? Math.abs(i - j) : recent[other] ? Math.round((Date.parse(x.date) - Date.parse(recent[other])) / 864e5) : null;
      if (gap != null) s -= gap === 0 ? 5e3 : gap === 1 ? 300 : gap === 2 ? 60 : 0;
    }
    if (opts.done && opts.done[x.date]) s += 1e3;                      // already lifted that day: it stands
    if (locksOf(x).length && !locksOf(x).includes(key)) s = -2e3;
    if ((x.rest || x.away || x.past) && !(opts.done && opts.done[x.date])) s = -3e3;   // a rest day (all three classes), a day away, a day gone: nothing is placed on it
    return s;
  };
  for (const key of LEGS) {
    let idx = d.findIndex(x => locksOf(x).includes(key)), best = -1e9;   // already on the calendar this week: it stands
    const held = idx >= 0;
    // done in the days before the week: due again only from the fifth day after it (Legs 1 on a Sunday is not due
    // before Friday, and the days before that are the other leg day's)
    const dueFrom = recent[key] ? tz.shiftKey(recent[key], 5) : null;
    if (!held) d.forEach((x, i) => { if (Object.values(legsAt).includes(i) || (dueFrom && x.date < dueFrom)) return; const s = legsScore(x, i, key); if (s > best) { best = s; idx = i; } });
    if (idx < 0 || (!held && best <= -1500)) continue;                   // no day will take it this week
    legsAt[key] = idx;
    const x = d[idx], next = all[idx + 1];
    x.lift = key;
    const hardAhead = [all[idx + 2], all[idx + 3]].find(y => y && y.ride && y.ride.hard), gapDays = hardAhead ? all.indexOf(hardAhead) - idx : 0;
    x.why = next && (!next.ride || next.long_coaching) ? `the day before ${!next.ride ? 'a day off the bike' : 'a long coaching day'} (${tz.labelOf(next.date)}), so the soreness lands where it costs no ride`
      : x.long_coaching ? `a long coaching day (${Math.round(x.coaching_min / 60)} h), no ride anyway`
      : !x.ride ? 'a day off the bike' : 'the lightest riding ahead of it';
    if (hardAhead) x.why += `; ${gapDays === 2 ? 'two' : 'three'} days before ${hardAhead.ride.name} (${tz.labelOf(hardAhead.date)}), so the legs are fresh for it`;
  }
  const legIdxs = Object.values(legsAt);
  // 2. the days with no lift. A rest day, a day away and a day already gone take nothing. Of the days still open,
  //    as many as the sessions left to place need are used, and the biggest riding days are the ones left free.
  const shut = x => (x.rest || x.away || x.past) && !(opts.done && opts.done[x.date]) && !locksOf(x).length;
  const restDays = d.map((x, i) => ({ x, i })).filter(p => !legIdxs.includes(p.i) && shut(p.x));
  // a session already on the calendar this week is placed where it is, not again somewhere else
  const four = ['push', 'pull', 'upper-1'].filter(k => !d.some(x => locksOf(x).includes(k)) && !(opts.rolling && recent[k]));
  const rest = d.map((x, i) => ({ x, i })).filter(p => !legIdxs.includes(p.i) && !p.x.locked && !restDays.some(r => r.i === p.i)).sort((a, b) => load(b.x) - load(a.x));
  const free = new Set(restDays.map(p => p.i).concat(rest.slice(0, Math.max(0, rest.length - four.length)).map(p => p.i)));
  for (const i of free) d[i].why = d[i].past ? '' : d[i].rest ? `no lift: a rest day (${d[i].rest})` : d[i].away ? `no lift: a day away (${d[i].away})` : d[i].ride ? `no lift: one of the biggest riding days (${d[i].ride.name})` : 'no lift: a rest day';
  // (a week asked for from a day that is not a Monday: a day left free because its session was done just before says so)
  if (opts.rolling) { const heldKeys = Object.keys(recent).filter(k => recent[k] && !isLegs(k));
    if (heldKeys.length) for (const p of rest.slice(Math.max(0, n - 5 - restDays.length), Math.max(0, rest.length - four.length))) d[p.i].why = `no lift: ${heldKeys.map(k => `${nameOf(k)} was done ${tz.labelOf(recent[k])}`).join(', ')}`; }
  // 3. the other three, in the book's order, with pull kept a day clear of the leg days when it can be
  const slots = d.map((x, i) => i).filter(i => !legIdxs.includes(i) && !free.has(i) && !(d[i].locked && d[i].locked !== 'any'));
  const perms = permutations(four);
  let bestP = null, bestS = 1e9;
  for (const p of perms) {
    let s = 0;
    p.forEach((k, j) => {
      const i = slots[j]; if (i == null) return;
      if (k === 'pull' && legIdxs.some(j => Math.abs(i - j) <= 1)) s += 3;           // deadlift next to a leg day
      if (k === 'push' && d[i].ride && d[i].ride.hard) s += 0.5;                      // a push day on the 40/20s is fine, a pull day a little better
      if (k === 'pull' && all[i + 1] && all[i + 1].ride && all[i + 1].ride.hard) s += 2;   // deadlifts the day before a hard ride
      if (recent[k] && Math.round((Date.parse(d[i].date) - Date.parse(recent[k])) / 864e5) < 5) s += 2;   // the same session less than five days on
      if (k === 'push' || k === 'upper-1') { const other = k === 'push' ? 'upper-1' : 'push';   // bench, then close-grip bench the next day
        for (const nb of [d[i - 1], d[i + 1]]) if (nb && locksOf(nb).includes(other)) s += 1;
        const oj = p.indexOf(other); if (oj >= 0 && slots[oj] != null && Math.abs(slots[oj] - i) === 1) s += 0.5; }
    });
    for (let a = 0; a < p.length; a++) for (let b = a + 1; b < p.length; b++) if (four.indexOf(p[a]) > four.indexOf(p[b])) s += 1;   // the book's order, when nothing else decides
    if (s < bestS) { bestS = s; bestP = p; }
  }
  (bestP || four).forEach((k, j) => { const i = slots[j]; if (i != null) { d[i].lift = k; d[i].why = d[i].ride ? `with the ride (${d[i].ride.name})` : d[i].long_coaching ? 'a coaching day, no ride' : 'a day off the bike'; } });
  const held = Object.keys(recent).filter(k => recent[k]);
  if (opts.rolling) for (const i of slots.slice(four.length)) if (!d[i].lift && held.length) d[i].why = `no lift: ${held.map(k => `${nameOf(k)} was done ${tz.labelOf(recent[k])}`).join(', ')}`;
  for (const x of d) if (x.locked && x.locked !== 'any') { x.lift = x.locked; x.why = opts.done && opts.done[x.date] ? 'logged' : 'on the calendar'; }
  // what the calendar holds, and what is only a suggestion for a day the calendar leaves empty
  for (const x of d) { const L = locksOf(x).filter(k => k !== 'any'); x.lifts = L; x.on_calendar = L.length > 0; x.suggested = !!x.lift && !x.on_calendar; }
  return d;
}
function permutations(a) { if (a.length <= 1) return [a]; const out = []; a.forEach((x, i) => { for (const p of permutations(a.slice(0, i).concat(a.slice(i + 1)))) out.push([x].concat(p)); }); return out; }

// Monday of the week a day is in (the lifting week is Monday to Sunday, like the calendar's and the coach's:
// until 15 Nov 2026 the count looked seven days back and the plan seven days ahead, so "this week" meant two
// different stretches and a missed session rolled forward for ever)
// The week from a day: each day's planned ride (the plan here and in
// intervals.icu, or the ride done), coaching minutes from the calendar.
async function weekDays(n, from0, kept) {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(from0 || '') ? from0 : tz.todayKey();   // the week from today, or from a day asked for
  const from = today, to = tz.shiftKey(today, (n || 7) - 1);
  const days = [];
  for (let i = 0; i < (n || 7); i++) days.push({ date: tz.shiftKey(today, i), ride: null, coaching_min: 0, long_coaching: false, rest: null });
  try {
    const { calendar } = require('./workouts');
    const cal = (kept && kept.cal) || await calendar(from, to);
    if (kept) kept.cal = cal;   // the report reads the calendar once and every part of it uses that read
    for (const day of cal.days || []) {
      const x = days.find(y => y.date === day.date); if (!x) continue;
      x.rest = day.rest || null;   // a day with all three classes: no lift goes on it
      const rides = (day.planned || []).filter(w => !/weight|lift|strength/i.test(w.sport || '') && !/^lift|^push$|^pull|^upper|^legs$/i.test(w.name || '')).map(w => ({ name: w.name, minutes: Math.round((w.metrics ? w.metrics.duration_s : 0) / 60), tss: w.metrics ? w.metrics.tss : 0 }))
        .concat((day.intervals || []).filter(e => !/weight|lift|strength/i.test(e.type || '')).map(e => ({ name: e.name, minutes: e.minutes, tss: e.tss })))
        .concat((day.done || []).filter(r => !/weight|lift|strength/i.test(r.type || '')).map(r => ({ name: r.name, minutes: r.minutes, tss: r.tss, done: true })));
      if (rides.length) {
        const big = rides.slice().sort((a, b) => (b.tss || 0) - (a.tss || 0))[0];
        // the plan's copy, intervals.icu's copy and Strava's ride are the same session: once it is ridden the ride is the day; before that, the largest copy
        const done = rides.filter(r => r.done), use = done.length ? done : [big];
        x.ride = { name: big.name, minutes: use.reduce((a, r) => a + (r.minutes || 0), 0), tss: use.reduce((a, r) => a + (r.tss || 0), 0),
          hard: rides.some(r => HARD.test(String(r.name || '').replace(/intervals\.?\s*icu/ig, ''))), done: done.length > 0 };
      }
    }
  } catch (e) { /* no plan: the week is placed on the calendar alone */ }
  try {
    const { scheduleReport } = require('./calendar');
    // read for the days still ahead only (a day gone needs no placing; the read is the slow part of this page)
    const t0 = tz.todayKey(), last = days[Math.min(days.length, 7) - 1].date, span = Math.round((Date.parse(last) - Date.parse(t0)) / 864e5) + 1;
    const s = span > 0 ? await scheduleReport({ days: span }) : { days: [] };
    for (const day of s.days || []) {
      const x = days.find(y => y.date === day.date); if (!x) continue;
      // a day with a long drive in it is a day away (the game in Somerset, NJ on 22 Nov had Upper 2 at Life Time at 7:30a)
      const drive = Math.max(0, ...(day.events || []).filter(e => e.category === 'commute').map(e => e.minutes || ((e.end_min || 0) - (e.start_min || 0)) || 0));
      if (drive >= AWAY_DRIVE_MIN) x.away = `a ${drive} min drive`;
      x.coaching_min = (day.events || []).filter(e => e.category === 'coaching' && !e.allDay).reduce((a, e) => a + (e.minutes || 0), 0);
      x.long_coaching = x.coaching_min >= LONG_COACHING_MIN;
    }
  } catch (e) { /* calendar unreachable: coaching unknown */ }
  return days;
}

// The week's count, one rule for the Day page's Lift box (chain.js) and the Lift page: the five
// sessions logged in the last seven days against five; in the plan's first week, against the
// sessions due since it started ("1 of 1 due" on day one, five a week from day seven). The pump is extra.
// the lift sessions the plan placed on the calendar between two dates (an untimed copy of a timed one counts once)
// nowMin: a lift on the last day counts as due only once its planned end has passed (an untimed one from
// 9 p.m.), so a Push at 12:45 is not "due" at 3 a.m.
async function placedLiftsBetween(from, to, nowMin) {
  const d = await getJSON('plan-workouts', { workouts: {} });
  const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; };
  const minsOf = w => Math.round((w.steps || []).reduce((a, x) => a + (x.dur_s || 0), 0) / 60) || 60;
  const due = w => nowMin == null || w.date < to || (toMin(w.time) != null ? toMin(w.time) + minsOf(w) <= nowMin : nowMin >= 21 * 60);
  // a Kettlebell Blast is an extra, like the Pump: never one of the five due
  const ws = Object.values(d.workouts || {}).filter(w => w && w.date >= from && w.date <= to && /weight|lift|strength/i.test(String(w.sport || '')) && !isBlast(w) && due(w));
  return new Set(ws.map(w => w.date + '|' + String(w.name || '').toLowerCase().replace(/\s+/g, ' ').trim())).size;
}
// Kettlebell Blasts (his at-home extras, on the calendar as WeightTraining, ~30 min) done in the window: a
// planned one logged, or a done one by its name. Counted beside the five as "+1", like the Pump, never inside.
const isBlast = w => require('./food-math').isBlast(w);
async function blastsBetween(from, to, sessions, kept) {
  const seen = new Set((sessions || []).filter(x => /^blast-/.test(x.template) && x.date >= from && x.date <= to).map(x => x.date));
  try {
    const { calendar } = require('./workouts');
    const cal = kept && (kept.days || []).some(x => x.date === from) ? kept : await calendar(from, to);
    for (const day of (cal.days || []).filter(x => x.date >= from && x.date <= to)) {
      if ((day.planned || []).filter(isBlast).some(w => w.logged) || (day.done || []).some(isBlast)) seen.add(day.date);
    }
  } catch (e) { /* the saved ones stand */ }
  return seen.size;
}
// the week's count with the first week's due sessions read from the calendar
async function weekCountPlaced(sessions, today, cal) {
  const fs = await require('./fresh-start').freshStart();
  const w0 = weekCount(sessions, today, undefined, fs);
  const nowMin = (() => { const p = tz.parts(new Date()); return p.h * 60 + p.mi; })();
  const inFirst = w0.first_count && w0.first_week;
  const [placed, dueNow, blasts, placedWeek, dueWeek] = await Promise.all([
    inFirst ? placedLiftsBetween(w0.first_count, today).catch(() => 0) : 0,
    inFirst ? placedLiftsBetween(w0.first_count, today, nowMin).catch(() => 0) : 0,
    blastsBetween(w0.from, today, sessions, cal).catch(() => 0),
    placedLiftsBetween(w0.from, w0.to).catch(() => 0),
    placedLiftsBetween(w0.from, today, nowMin).catch(() => 0)]);
  // with lifts on the calendar, the due count is the ones whose time has come (none yet reads "due later", not red)
  const c = placed ? weekCount(sessions, today, dueNow, fs) : w0;
  // how many of the five are due by now, for the box's colour: Monday reads "0 of 5" in grey, not red. With the week on
  // the calendar, the lifts whose time has passed; with nothing on it, five spread over the seven days
  const dow = Math.round((Date.parse(today) - Date.parse(mondayOf(today))) / 864e5) + 1;
  const due = Math.min(5, Math.max(c.sessions, placedWeek ? dueWeek : Math.floor(5 * (dow - 1) / 7)));
  return Object.assign(c, { blasts, extras: c.pumps + blasts, due });
}
function weekCount(sessions, today, placedDue, fresh) {
  // the fresh start (fresh-start.js): sessions before it are not counted, and the first week runs from it
  const fs = /^\d{4}-\d{2}-\d{2}$/.test(fresh || '') ? fresh : null;
  const mon = mondayOf(today), from = fs && fs > mon ? fs : mon;   // this week, Monday to Sunday
  const wk = (sessions || []).filter(x => x.date >= from && x.date <= today);
  const fiveAll = wk.filter(x => TEMPLATES.some(t => t.key === x.template));
  // each of the five counts once: Legs twice and no Upper 2 is four of the five, and the count never passes five
  const five = [...new Set(fiveAll.map(x => x.template))];
  const first = (sessions || []).filter(x => TEMPLATES.some(t => t.key === x.template)).map(x => x.date).sort()[0] || null;
  const dayN0 = first ? Math.round((Date.parse(today) - Date.parse(first)) / 864e5) + 1 : 0;
  const weekNo = first ? Math.floor((dayN0 - 1) / 7) + 1 : 0;   // the deload cycle runs from the plan's real first day
  // the count's first week: from the plan's first session, or from the fresh start when that is later
  const firstCount = first && fs && fs > first && fs <= today ? fs : first;
  const dayN = firstCount ? Math.round((Date.parse(today) - Date.parse(firstCount)) / 864e5) + 1 : 0;
  // in the first week, the sessions due are the ones the plan placed on the calendar from its first day through today;
  // with nothing placed yet, five a week prorated
  // placedDue 0 (a number) is lifts placed but none due yet; undefined is nothing placed: five a week prorated
  const expected = !first ? 0 : dayN < 7 ? (placedDue != null ? Math.min(5, Math.max(placedDue, five.length)) : Math.min(5, Math.ceil(5 * dayN / 7))) : 5;
  const firstWeek = !!first && dayN < 7 && expected < 5;
  const of = firstWeek ? expected : 5;
  return { from, to: tz.shiftKey(mon, 6), sessions: five.length, done: five, repeats: fiveAll.length - five.length, pumps: wk.filter(x => x.template === 'pump').length, blasts: 0, target: 5, expected, of, first_week: firstWeek, started: !!first, first, first_count: firstCount, fresh_start: fs,
    week_no: weekNo, deload: weekNo > 0 && weekNo % 9 === 0, word: firstWeek && !of ? 'due later' : `${five.length} of ${of}${firstWeek ? ' due' : ''}` };
}
// A calendar entry's name to its session: "Upper body and core (Upper 2)" by its bracket, "Pull" by its
// short name, "Pull and calves" by its full name. The two upper days share a name, so the bracket goes first.
function templateOf(name) {
  const n = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!n) return null;
  // the longest short name first, so "Legs 2" is not read as Legs, nor "Upper 2" as the upper day
  const T = TEMPLATES.concat(RETIRED).slice().sort((a, b) => String(b.short || '').length - String(a.short || '').length);
  const hit = T.find(t => t.short && n.includes('(' + t.short.toLowerCase() + ')'))
    || (/\(upper 1\)/.test(n) ? T.find(t => t.key === 'upper-1') : null)             // the upper day's name until 15 Nov 2026
    || T.find(t => n === t.key || n === String(t.short || '').toLowerCase() || n === t.name.toLowerCase())
    || (n === 'legs' ? T.find(t => t.key === 'legs') : null)
    || T.find(t => t.short && n.startsWith(t.short.toLowerCase()))
    || T.find(t => n.startsWith(t.name.toLowerCase()));
  return hit ? hit.key : null;
}
const isLiftEntry = w => /weight|lift|strength/i.test(String(w.sport || '')) || (!/ride|run|walk|hike/i.test(String(w.sport || '')) && !!templateOf(w.name));

// The week as it stands, checked against the rules (Harry, 15 Nov 2026: "the lifting schedule has been wrong a lot
// of times"). The placer only fills empty days; what is already on the calendar stood whatever it broke, and a moved
// or swapped lift was never looked at again. This reads every lift the week holds, done or planned, and says what
// is wrong in plain words. week: report()'s days (lifts, done_keys, ride, rest, times); sessions: the saved ones.
function checkWeek(week, sessions, o) {
  const out = [], fixed = !!(o && o.fixed), day = k => tz.dayShort(k), nm = k => (TEMPLATES.concat(RETIRED).find(t => t.key === k) || {}).short || k;
  const openOn = x => (x.lifts && x.lifts.length ? x.lifts : []).filter(k => k !== 'any' && !(x.done_keys || []).includes(k));
  const first = week.length ? week[0].date : null, last = week.length ? week[week.length - 1].date : null;
  // every time each of the five happens: saved sessions from six days before the week, and what the calendar holds
  const seen = {};
  for (const s of sessions || []) if (first && TEMPLATES.some(t => t.key === s.template) && s.date >= tz.shiftKey(first, -6) && s.date <= last) (seen[s.template] = seen[s.template] || []).push({ date: s.date, done: true });
  for (const x of week) for (const k of openOn(x)) { if (RETIRED.some(t => t.key === k)) { out.push({ kind: 'retired', date: x.date, key: k, text: `${nm(k)} is on ${day(x.date)}, but it is no longer one of the five: Legs 2 took its place.` }); continue; }
    (seen[k] = seen[k] || []).push({ date: x.date, done: false }); }
  for (const k of Object.keys(seen)) { const a = seen[k].sort((p, q) => p.date.localeCompare(q.date));
    for (let i = 1; i < a.length; i++) { const gap = Math.round((Date.parse(a[i].date) - Date.parse(a[i - 1].date)) / 864e5);
      if (!a[i].done && gap > 0 && gap < 5) out.push({ kind: 'again', date: a[i].date, key: k, text: `${nm(k)} is on ${day(a[i].date)}, ${gap} day${gap === 1 ? '' : 's'} after ${a[i - 1].done ? 'it was done' : 'another ' + nm(k)} (${day(a[i - 1].date)}). Each of the five is done once every seven days.` }); } }
  const missing = TEMPLATES.map(t => t.key).filter(k => !seen[k]);
  if (missing.length && out.some(p => p.kind === 'again')) out.push({ kind: 'missing', date: null, key: missing[0], text: `${missing.map(nm).join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not in the week: the repeated session's day would take ${missing.length === 1 ? 'it' : 'one'}.` });
  else for (const k of missing) { const was = week.find(x => (x.missed || []).includes(k)), fits = week.find(x => x.suggested && x.lift === k);
    if (was && fits) out.push({ kind: 'missed', date: was.date, key: k, text: `${nm(k)} was on ${day(was.date)} and was not logged. It fits on ${day(fits.date)}.` });
    else if (!fits) { const ahead = week.some(x => !x.past && (!o || !o.today || x.date > o.today));
      out.push({ kind: 'no_room', date: was ? was.date : null, key: k, text: `${was ? `${nm(k)} was on ${day(was.date)} and was not logged. ` : ''}${ahead ? `No day still open this week will take ${nm(k)} (rest days, days away and the rules leave none).` : `No day is left for ${nm(k)} this week${fixed ? ': it is lost with the week, and next week starts fresh' : ''}.`}` }); } }
  week.forEach((x, i) => { const next = week[i + 1], open = openOn(x);
    const hardNext = next && next.ride && next.ride.hard && !next.ride.done ? next : null;
    for (const lk of open.filter(isLegs)) if (hardNext) out.push({ kind: 'legs_before_hard', date: x.date, key: lk, text: `${nm(lk)} on ${day(x.date)} is the day before ${hardNext.ride.name} (${day(hardNext.date)}). Heavy leg work takes two days to clear: two or three days before is the place for it.` });
    if (open.includes('pull') && hardNext) out.push({ kind: 'pull_before_hard', date: x.date, key: 'pull', text: `Pull (deadlifts) on ${day(x.date)} is the day before ${hardNext.ride.name} (${day(hardNext.date)}).` });
    // the two leg days on one day or on days side by side
    const legsHere = (x.lifts || []).filter(isLegs), legsNext = next ? (next.lifts || []).filter(isLegs) : [];
    if (legsHere.length > 1 && open.some(isLegs)) out.push({ kind: 'legs_together', date: x.date, key: 'legs', text: `Legs 1 and Legs 2 are both on ${day(x.date)}.` });
    else if (legsHere.length && legsNext.length && legsHere[0] !== legsNext[0] && (open.some(isLegs) || openOn(next).some(isLegs)))
      out.push({ kind: 'legs_together', date: next.date, key: 'legs', text: `Legs 1 and Legs 2 are back to back (${day(x.date)} and ${day(next.date)}). Two clear days between them is the aim.` });
    if (x.away && open.length) out.push({ kind: 'away', date: x.date, key: open[0], text: `${open.map(nm).join(' and ')} on ${day(x.date)}, a day away (${x.away}): you are not near the gym that day.` });
    if (x.rest && open.length) out.push({ kind: 'rest_day', date: x.date, key: open[0], text: `${open.map(nm).join(' and ')} on ${day(x.date)}, a rest day (${x.rest}).` });
    // a heavy lower-body lift and a hard ride on one day: three hours between them
    for (const c of x.close || []) out.push({ kind: 'close_to_hard', date: x.date, key: c.key, text: `${nm(c.key)} on ${day(x.date)} is ${c.gap_min} min ${c.after ? 'after' : 'before'} ${c.ride}. A heavy lower-body lift and a hard ride want three hours between them.` });
  });
  return out;
}

async function report(from) {
  const d = await db();
  const sessions = d.sessions.slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.at).localeCompare(String(b.at)));
  const lastOf = {};
  for (const s of sessions) for (const e of s.exercises || []) lastOf[e.name] = { date: s.date, sets: e.sets };
  const templates = ALL.map(t => ({ key: t.key, name: t.name, short: t.short, minutes: t.minutes, why: t.why, order: t.order || 9, supplement: !!t.supplement, blast: !!t.blast, title: t.title || null, warmup: t.warmup || null, cue: t.cue || null,
    hard_sets: t.exercises.reduce((a, e) => a + e.sets, 0),
    exercises: t.exercises.map(e => Object.assign({}, e, { last: lastOf[e.name] || null, target: target(e, lastOf[e.name]) })) }));
  // the week: what was lifted already this week holds its day; the rest is placed
  const today = tz.todayKey();
  // this week, Monday to Sunday, or the week from a day asked for (the placer, for a week ahead); three days past it
  // are read too, only to be looked at (a leg day on the week's last day is placed by the rides that follow it)
  const start = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : mondayOf(today), rolling = start !== mondayOf(start);
  const kept = {}, ten = await weekDays(10, start, kept), days = ten.slice(0, 7), ahead = ten.slice(7);
  for (const x of days) if (x.date < today) x.past = true;
  // the strip mirrors the calendar: every lift saved on a day, then every lift the calendar holds that day
  const doneByDate = {}, locks = {};
  const add = (date, k) => { if (!k) return; const a = locks[date] = locks[date] || []; if (!a.includes(k)) a.push(k); };
  for (const s of sessions) if (s.date >= days[0].date && s.date <= days[6].date && !isExtra(s.template)) { doneByDate[s.date] = doneByDate[s.date] || s.template; add(s.date, s.template); }
  const doneKeys = new Set(sessions.filter(s => s.date >= days[0].date && s.date <= days[6].date).map(s => s.template)), missed = {};
  try {
    const { calendar } = require('./workouts');
    const cal = kept.cal || await calendar(days[0].date, days[days.length - 1].date);
    for (const day of cal.days || []) for (const w of (day.planned || []).filter(isLiftEntry)) { const k = templateOf(w.name); if (!k) continue;
      // a day gone: what was done that day is the day; a lift that was on it and was not saved is missed, not held
      if (day.date < today) { if (!(locks[day.date] || []).includes(k) && !doneKeys.has(k)) (missed[day.date] = missed[day.date] || []).push(k); }
      else add(day.date, k); }
    // a Legs or Pull within three hours of a hard ride on the same day (the times the calendar holds)
    const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? +m[1] * 60 + +m[2] : null; }, lenOf = w => Math.round((w.steps || []).reduce((a, s) => a + (s.dur_s || 0), 0) / 60) || 60;
    for (const day of cal.days || []) { const x = days.find(y => y.date === day.date); if (!x) continue;
      const hard = (day.planned || []).filter(w => !isLiftEntry(w) && toMin(w.time) != null && HARD.test(String(w.name || '')) && !w.logged);
      for (const w of (day.planned || []).filter(isLiftEntry)) { const k = templateOf(w.name), a = toMin(w.time); if (a == null || !/^(legs|legs-2|pull)$/.test(k || '') || w.logged) continue;
        for (const r of hard) { const rs = toMin(r.time), re = rs + lenOf(r), after = a >= rs, gap = after ? a - re : rs - (a + lenOf(w));
          if (gap < 180) (x.close = x.close || []).push({ key: k, ride: r.name, gap_min: Math.max(0, gap), after }); } } }
  } catch (e) { /* the placement stands on its own */ }
  for (const x of days) { if (locks[x.date]) { x.locks = locks[x.date]; x.locked = x.locks[0]; } if (missed[x.date]) x.missed = missed[x.date]; }
  // what was lifted in the six days before the window: not due again yet
  const recent = {};
  for (const s of sessions) if (!isExtra(s.template) && s.date < days[0].date && s.date >= tz.shiftKey(days[0].date, -6)) recent[s.template] = s.date;
  const week = placeWeek(days, { done: doneByDate, recent, ahead, rolling }).map(x => Object.assign(x, { done: !!doneByDate[x.date], label: tz.labelOf(x.date), name: x.lift ? nameOf(x.lift) : null }));
  // the pump fits any day but legs and the day before it
  week.forEach((x, i) => { const next = week[i + 1]; x.pump_ok = !isLegs(x.lift) && !(next && isLegs(next.lift)); x.pumped = sessions.some(s => s.date === x.date && s.template === 'pump'); x.blasted = sessions.filter(s => s.date === x.date && /^blast-/.test(s.template)).map(s => s.template); });
  // each day's sessions still to do (a day can hold a done Push and a planned Pull)
  for (const x of week) { x.done_keys = sessions.filter(s => s.date === x.date && !isExtra(s.template)).map(s => s.template);
    x.open = (x.lifts && x.lifts.length ? x.lifts : x.lift ? [x.lift] : []).filter(k => !x.done_keys.includes(k)); }
  // next: today's, if not done; else the next day that holds one
  const nextX = week.find(x => x.date >= today && x.open.length) || null;
  // strength over time: the best estimated one-rep max in each session, per exercise
  const history = {};
  for (const s of sessions) for (const e of s.exercises || []) {
    const best = Math.max(0, ...(e.sets || []).map(x => e1rm(x.lb, x.reps) || 0));
    if (best) (history[e.name] = history[e.name] || []).push({ date: s.date, e1rm: best, top_lb: Math.max(...e.sets.map(x => x.lb || 0)) });
  }
  const problems = checkWeek(week, sessions, { today, fixed: !rolling });
  const wc = await weekCountPlaced(sessions, today, kept.cal);
  const last = sessions[sessions.length - 1] || null;
  // eight weeks on, one off: counted from the first session of this plan
  const weekNo = wc.week_no || 1;
  const deload = wc.deload;
  const plan = periodization(TEMPLATES, sessions, today);
  return { templates, next: nextX ? nextX.open[0] : 'push', next_date: nextX ? nextX.date : null, week, week_from: days[0].date, week_to: days[6].date, plan: 'Bigger Leaner Stronger, five days', periodization: plan,
    week_no: weekNo, deload, deload_note: deload ? 'Deload week: the same lifts, half the hard sets, two reps shy of the top of the range. The weights stay.' : null,
    last: last ? { date: last.date, template: last.template, name: nameOf(last.template) } : null,
    sessions: sessions.slice(-15).reverse().map(s => ({ id: s.id, date: s.date, template: s.template, name: nameOf(s.template),
      notes: s.notes || '', volume_lb: (s.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, x) => b + (x.lb || 0) * (x.reps || 0), 0), 0),
      exercises: (s.exercises || []).map(e => ({ name: e.name, sets: e.sets })) })),
    problems, history, this_week: wc.sessions, target_per_week: 5, pumps_this_week: wc.pumps, blasts_this_week: wc.blasts || 0, count: wc,
    rules: ['Legs two or three days before a hard ride (VO2, threshold, a race), never the day before one; then the day before a day off the bike or a long coaching day.', 'No lift on the two biggest riding days.', 'Two leg days a week: Legs 1 heavy, Legs 2 lighter and short of failure, two clear days between them when the week allows.', 'Bench (Push) and close-grip bench (Upper) a day apart when the week allows.', 'Deadlifts (Pull) not the day before a hard ride. Legs or Pull three hours from a hard ride on the same day.', 'Pull (deadlift) a day clear of legs (Romanian deadlift) when the week allows.', 'The week runs Monday to Sunday: each of the five once in it. A session missed is named, moved to a day still open if one is left, and otherwise lost with the week; nothing is stacked.', 'Eight weeks, then a deload week.', 'No lift on a rest day (all three classes) or a day away (a drive of 90 minutes or more).', 'The pump at home is extra: any day but legs and the day before it; it does not count toward the five.', 'A Kettlebell Blast at home is extra too: shown as +1 beside the five, about 180 kcal toward the day\'s burn.'] };
}

async function save(body) {
  const b = body || {};
  const t = ALL.find(x => x.key === b.template);
  if (!t) throw new Error('unknown session');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : tz.todayKey();
  const exercises = (Array.isArray(b.exercises) ? b.exercises : []).map(e => ({
    name: String(e.name || '').slice(0, 60),
    sets: (Array.isArray(e.sets) ? e.sets : []).map(s => ({ reps: Math.max(0, Math.min(300, Math.round(Number(s.reps) || 0))), lb: Math.max(0, Math.min(1000, Math.round(Number(s.lb) || 0))) })).filter(s => s.reps > 0)
  })).filter(e => e.name && e.sets.length);
  // quick: the session was done and its sets were not written down (told to the coach, or ticked off): it counts for
  // the week, and the targets stay where the last real session left them
  if (!exercises.length && !b.quick) throw new Error('no sets to save');
  if (date > tz.todayKey()) throw new Error('a session cannot be saved for a day that has not come');
  const d = await db();
  if (b.quick && d.sessions.some(x => x.date === date && x.template === t.key)) { const e = new Error(`${t.name} is already logged for ${tz.dayShort(date)}.`); e.status = 409; throw e; }
  const s = { id: 'l_' + Date.now().toString(36), date, template: t.key, exercises, notes: String(b.notes || '').slice(0, 400), at: new Date().toISOString() };
  if (!exercises.length) s.quick = true;
  d.sessions.push(s); d.sessions = d.sessions.slice(-400);
  await setJSON('lifts', d);
  return s;
}

// This week's five onto the calendar as planned workouts (the plan store),
// skipping a day that already has a lift planned. time: "HH:MM", default the earliest workout (7:30, sleep first).
async function scheduleWeek(body) {
  const time = /^\d{2}:\d{2}$/.test((body || {}).time || '') ? body.time : require('./workouts').EARLIEST;
  const r = await report(/^\d{4}-\d{2}-\d{2}$/.test((body || {}).from || '') ? body.from : undefined);
  const { create, calendar } = require('./workouts');
  const cal = await calendar(r.week[0].date, r.week[r.week.length - 1].date).catch(() => ({ days: [] }));
  const added = [], kept = [], skipped = [];
  for (const x of r.week) {
    if (!x.lift || x.done) continue;
    const day = (cal.days || []).find(dd => dd.date === x.date);
    // a day with all three classes is a rest day: no lift goes on it
    if (day && day.rest) { skipped.push({ date: x.date, why: day.rest }); continue; }
    const has = day && (day.planned || []).some(w => /weight/i.test(w.sport || '') || /^(push|pull|upper|legs)/i.test(w.name || ''));
    if (has) { kept.push(x.date); continue; }
    const t = TEMPLATES.find(tt => tt.key === x.lift);
    const w = await create({ name: t.name, sport: 'WeightTraining', date: x.date, time, notes: `Log it on the Lift tab. ${x.why}.`, steps: [{ kind: 'step', label: 'Lift', dur_s: t.minutes * 60, target: { type: 'free' } }] });
    added.push({ date: x.date, name: t.name, id: w && w.id });
  }
  return { ok: true, added, kept, skipped, time };
}

function attach(app) {
  app.get('/lifts', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await report()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/lifts', async (req, res) => { if (!auth(req, res)) return;
    try { const s = await save(req.body); res.json({ ok: true, session: s, report: await report() }); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/lifts/schedule', async (req, res) => { if (!auth(req, res)) return;
    try { res.json(await scheduleWeek(req.body)); } catch (e) { res.status(400).json({ error: e.message }); } });
  app.delete('/lifts/:id', async (req, res) => { if (!auth(req, res)) return;
    try { const d = await db(); const n = d.sessions.length; d.sessions = d.sessions.filter(s => s.id !== req.params.id); await setJSON('lifts', d); res.json({ ok: true, removed: n - d.sessions.length }); } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { DESC, attach, weekCount, weekCountPlaced, templateOf, TEMPLATES, PUMP, target, e1rm, nextBell, prevBell, placeWeek, periodization, report, save, scheduleWeek, LONG_COACHING_MIN, checkWeek, HARD, nameOf, RETIRED, isLegs, BLASTS, isExtra, blastOf, blastNotes, mondayOf, ALL };
