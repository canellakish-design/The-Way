// node bridge/workout-math.test.js
const assert = require('assert');
const W = require('./workout-math');
const { LIBRARY } = require('./workout-library');
const st = { ftp: 175, lthr: 139, hr_rest: 55 };
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

ok('one hour at FTP is 100 TSS, IF 1.00', () => {
  const m = W.metrics(W.normItems([{ kind: 'step', dur_s: 3600, target: { type: 'power', lo: 100, hi: 100 } }]), st);
  assert.strictEqual(m.tss, 100); assert.strictEqual(m.if, 1);
});
ok('watts are read against FTP', () => {
  const m = W.metrics(W.normItems([{ kind: 'step', dur_s: 3600, target: { type: 'watts', lo: 175 } }]), st);
  assert.strictEqual(m.tss, 100);
});
ok('repeats expand: 2 x (10m + 5m) = 30 min', () => {
  const items = W.normItems([{ kind: 'repeat', count: 2, steps: [{ dur_s: 600, target: { type: 'power', lo: 90 } }, { dur_s: 300, target: { type: 'power', lo: 50 } }] }]);
  assert.strictEqual(W.metrics(items, st).duration_s, 1800);
});
ok('intervals are costed above their average (NP > mean)', () => {
  const items = W.normItems([{ kind: 'repeat', count: 10, steps: [{ dur_s: 30, target: { type: 'power', lo: 140 } }, { dur_s: 30, target: { type: 'power', lo: 40 } }] }]);
  assert.ok(W.metrics(items, st).if > 0.9);
});
ok('heart rate at threshold is IF 1.0; Z1 is well below', () => {
  assert.strictEqual(W.metrics(W.normItems([{ dur_s: 3600, target: { type: 'hr', lo: 139, hi: 139 } }]), st).if, 1);
  const z1 = W.metrics(W.normItems([{ dur_s: 3600, target: { type: 'hr', lo: 100, hi: 116 } }]), st);
  assert.ok(z1.if > 0.6 && z1.if < 0.75, 'Z1 IF ' + z1.if);
  assert.strictEqual(z1.estimated_from, 'heart rate');
});
ok('intervals.icu text: steps, cues without digits, ramp, cadence', () => {
  const t = W.toIntervalsText(W.normItems([
    { label: 'Build', dur_s: 900, target: { type: 'ramp', from: 50, to: 80 } },
    { label: 'Block 2x10', dur_s: 90, target: { type: 'watts', lo: 240 }, cadence: { lo: 95, hi: 100 } }]), st);
  assert.strictEqual(t, '- Build 15m ramp 50%-80%\n- Block x 1m30s 240w 95-100rpm');
});
ok('intervals.icu text: heart rate goes as % LTHR', () => {
  const t = W.toIntervalsText(W.normItems([{ label: 'Threshold', dur_s: 600, target: { type: 'hr', lo: 135, hi: 142 } }]), st);
  assert.strictEqual(t, '- Threshold 10m 97-102% LTHR');
});
ok('intervals.icu text: repeat block has a blank line either side', () => {
  const t = W.toIntervalsText(W.normItems([
    { dur_s: 600, target: { type: 'hr', lo: 100, hi: 116 } },
    { kind: 'repeat', label: 'Main set', count: 2, steps: [{ dur_s: 600, target: { type: 'power', lo: 95, hi: 105 } }, { dur_s: 300, target: { type: 'free' } }] },
    { dur_s: 300, target: { type: 'power', lo: 50 } }]), st);
  assert.strictEqual(t, '- 10m 72-83% LTHR\n\nMain set 2x\n- 10m 95-105%\n- 5m freeride\n\n- 5m 50%');
});
ok('durations format the intervals.icu way', () => {
  assert.strictEqual(W.dur(30), '30s'); assert.strictEqual(W.dur(90), '1m30s');
  assert.strictEqual(W.dur(3600), '1h'); assert.strictEqual(W.dur(3725), '1h2m5s');
});
ok('normalising swaps reversed ranges and clamps nonsense', () => {
  const [s] = W.normItems([{ dur_s: -5, target: { type: 'power', lo: 120, hi: 80 } }]);
  assert.deepStrictEqual(s.target, { type: 'power', lo: 80, hi: 120 }); assert.strictEqual(s.dur_s, 1);
});
ok('zwo: steady states, ramps, IntervalsT for simple on/off repeats', () => {
  const z = W.toZwo({ name: 'A & B', steps: W.normItems([
    { dur_s: 900, target: { type: 'ramp', from: 50, to: 80 } },
    { kind: 'repeat', count: 13, steps: [{ dur_s: 30, target: { type: 'watts', lo: 240 } }, { dur_s: 15, target: { type: 'watts', lo: 110 } }] }]) }, st);
  assert.ok(z.includes('<Ramp Duration="900" PowerLow="0.500" PowerHigh="0.800"/>'));
  assert.ok(z.includes('<IntervalsT Repeat="13" OnDuration="30" OffDuration="15" OnPower="1.371" OffPower="0.629"/>'));
  assert.ok(z.includes('<name>A &amp; B</name>'));
});
ok('library: every template normalises, and the session lengths are right', () => {
  const byKey = Object.fromEntries(LIBRARY.map(t => [t.key, W.metrics(W.normItems(t.steps), st)]));
  // Only three kinds of workout: Zone 1, VO2 40/20s, mountain bike handling.
  assert.deepStrictEqual([...new Set(LIBRARY.map(t => t.key.split('-')[0]))], ['z1', 'vo2', 'mtb']);
  assert.strictEqual(byKey['z1-45'].duration_s, 45 * 60);
  assert.strictEqual(byKey['z1-150'].duration_s, 150 * 60);
  // Zwift's 40/20's #1 is 50 min
  assert.strictEqual(byKey['vo2-4020'].duration_s, 50 * 60);
  assert.strictEqual(byKey['mtb-60'].duration_s, 60 * 60);
  for (const t of LIBRARY) assert.ok(/EAT/.test(t.notes), t.key + ' has eating guidelines');
  for (const t of LIBRARY) assert.ok(W.toIntervalsText(W.normItems(t.steps), st).length > 0);
});
console.log(n + ' passed');
