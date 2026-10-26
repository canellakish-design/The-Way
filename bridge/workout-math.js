// ============================================================
// workout-math.js — the arithmetic of a planned workout. Pure: no storage,
// no network, so it can be tested on its own (node bridge/workout-math.test.js).
//
// A workout is a flat list of items. An item is either a step or a repeat
// block holding steps. intervals.icu does not support nested repeats, so
// neither does this.
//
//   step   = { kind:'step', label, dur_s, target, cadence:{lo,hi}|null }
//   repeat = { kind:'repeat', label, count, steps:[step, ...] }
//
//   target = { type:'power', lo, hi }   % of FTP
//          | { type:'watts', lo, hi }   absolute watts
//          | { type:'ramp',  from, to } % of FTP, linear over the step
//          | { type:'hr',    lo, hi }   bpm — sent to intervals.icu as % LTHR
//          | { type:'free' }            no target, ERG off
//
// Settings carry the anchors every number is computed against:
//   { ftp, lthr, hr_rest }
// ============================================================

const DEFAULTS = { ftp: 175, lthr: 139, hr_rest: 55 };

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clampInt = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(num(v, d))));

function settingsOf(s) {
  const o = Object.assign({}, DEFAULTS, s || {});
  return { ftp: clampInt(o.ftp, 80, 600, DEFAULTS.ftp),
           lthr: clampInt(o.lthr, 90, 220, DEFAULTS.lthr),
           hr_rest: clampInt(o.hr_rest, 30, 100, DEFAULTS.hr_rest) };
}

// ---------- normalising what the page sends ----------
function normTarget(t) {
  t = t || {};
  const type = ['power', 'watts', 'ramp', 'hr', 'free'].includes(t.type) ? t.type : 'free';
  if (type === 'free') return { type };
  if (type === 'ramp') {
    const from = clampInt(t.from, 0, 300, 50), to = clampInt(t.to, 0, 300, 75);
    return { type, from, to };
  }
  const cap = type === 'watts' ? 2000 : type === 'hr' ? 230 : 300;
  let lo = clampInt(t.lo, 0, cap, 0), hi = clampInt(t.hi == null || t.hi === '' ? t.lo : t.hi, 0, cap, lo);
  if (hi < lo) [lo, hi] = [hi, lo];
  return { type, lo, hi };
}
function normCadence(c) {
  if (!c || c.lo == null || c.lo === '') return null;
  let lo = clampInt(c.lo, 30, 160, 90), hi = clampInt(c.hi == null || c.hi === '' ? c.lo : c.hi, 30, 160, lo);
  if (hi < lo) [lo, hi] = [hi, lo];
  return { lo, hi };
}
function normStep(s) {
  return { kind: 'step', label: String((s && s.label) || '').slice(0, 60),
           dur_s: clampInt(s && s.dur_s, 1, 6 * 3600, 60),
           target: normTarget(s && s.target), cadence: normCadence(s && s.cadence) };
}
function normItems(items) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (it && it.kind === 'repeat') {
      const steps = (Array.isArray(it.steps) ? it.steps : []).filter(Boolean).map(normStep);
      if (!steps.length) continue;
      out.push({ kind: 'repeat', label: String(it.label || '').slice(0, 60),
                 count: clampInt(it.count, 1, 50, 2), steps });
    } else if (it) out.push(normStep(it));
  }
  return out;
}

// ---------- flattening and intensity ----------
// Every step, repeats expanded, in order — what the rider actually does.
function flatten(items) {
  const out = [];
  for (const it of items) {
    if (it.kind === 'repeat') for (let i = 0; i < it.count; i++) for (const s of it.steps) out.push(s);
    else out.push(it);
  }
  return out;
}

// Intensity as a fraction of FTP for a moment in a step. Heart-rate steps are
// converted the hrTSS way — where the beat rate sits between resting and
// threshold — because there is no honest power number for them.
function fracAt(t, x, st) {
  switch (t.type) {
    case 'power': return ((t.lo + t.hi) / 2) / 100;
    case 'watts': return ((t.lo + t.hi) / 2) / st.ftp;
    case 'ramp':  return (t.from + (t.to - t.from) * x) / 100;
    case 'hr': {
      const mid = (t.lo + t.hi) / 2;
      return Math.max(0, (mid - st.hr_rest) / (st.lthr - st.hr_rest));
    }
    default: return 0.55;          // free riding: assume easy
  }
}

// Duration, normalised intensity, IF and TSS. NP is the fourth-power mean of
// intensity over time, which is what makes 30/15s cost more than their average.
function metrics(items, settings) {
  const st = settingsOf(settings);
  const flat = flatten(items);
  let T = 0, m4 = 0, hrSecs = 0, freeSecs = 0;
  for (const s of flat) {
    const d = s.dur_s;
    if (s.target.type === 'ramp') {
      const n = Math.max(1, Math.min(60, Math.round(d / 10)));
      for (let i = 0; i < n; i++) m4 += (d / n) * Math.pow(fracAt(s.target, (i + 0.5) / n, st), 4);
    } else m4 += d * Math.pow(fracAt(s.target, 0, st), 4);
    if (s.target.type === 'hr') hrSecs += d;
    if (s.target.type === 'free') freeSecs += d;
    T += d;
  }
  const IF = T ? Math.pow(m4 / T, 0.25) : 0;
  const tss = Math.round((T / 3600) * IF * IF * 100);
  return {
    duration_s: T,
    if: Math.round(IF * 100) / 100,
    tss,
    np_w: Math.round(IF * st.ftp),
    estimated_from: hrSecs > T / 2 ? 'heart rate' : freeSecs > T / 2 ? 'free riding (assumed easy)' : 'power',
    steps: flat.length
  };
}

// Points for a profile chart: [{t0, t1, from, to}] as fractions of FTP.
function profile(items, settings) {
  const st = settingsOf(settings);
  let t = 0; const out = [];
  for (const s of flatten(items)) {
    const a = fracAt(s.target, 0, st), b = s.target.type === 'ramp' ? fracAt(s.target, 1, st) : a;
    out.push({ t0: t, t1: t + s.dur_s, from: Math.round(a * 100) / 100, to: Math.round(b * 100) / 100, kind: s.target.type });
    t += s.dur_s;
  }
  return out;
}

// ---------- intervals.icu workout text ----------
// Syntax per the intervals.icu builder guide: "- [cue] [duration] [target] [cadence]",
// "Nx" on its own line before a repeat block with a blank line either side.
// Text before the first duration becomes the on-device cue, so digits are taken
// out of labels — "2x10" in a cue would read as a duration.
function dur(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + 'h' : '') + (m ? m + 'm' : '') + (sec || (!h && !m) ? sec + 's' : '');
}
function cue(label) {
  return String(label || '').replace(/[0-9]/g, '').replace(/[^A-Za-z &'\/+-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}
function targetText(t, st) {
  switch (t.type) {
    case 'power': return t.lo === t.hi ? `${t.lo}%` : `${t.lo}-${t.hi}%`;
    case 'watts': return t.lo === t.hi ? `${t.lo}w` : `${t.lo}-${t.hi}w`;
    case 'ramp':  return `ramp ${t.from}%-${t.to}%`;
    case 'hr': {
      const lo = Math.round(t.lo / st.lthr * 100), hi = Math.round(t.hi / st.lthr * 100);
      return lo === hi ? `${lo}% LTHR` : `${lo}-${hi}% LTHR`;
    }
    default: return 'freeride';
  }
}
function stepLine(s, st) {
  const bits = ['-'];
  const c = cue(s.label); if (c) bits.push(c);
  bits.push(dur(s.dur_s));
  const tt = targetText(s.target, st);
  // "ramp" sits between duration and target in the syntax; it is part of tt.
  bits.push(tt);
  if (s.cadence) bits.push(s.cadence.lo === s.cadence.hi ? `${s.cadence.lo}rpm` : `${s.cadence.lo}-${s.cadence.hi}rpm`);
  return bits.join(' ');
}
function toIntervalsText(items, settings) {
  const st = settingsOf(settings);
  const lines = [];
  for (const it of items) {
    if (it.kind === 'repeat') {
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      const head = cue(it.label);
      lines.push((head ? head + ' ' : '') + it.count + 'x');
      for (const s of it.steps) lines.push(stepLine(s, st));
      lines.push('');
    } else lines.push(stepLine(it, st));
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// ---------- Zwift .zwo ----------
// Zwift wants power as a fraction of FTP. Heart-rate and free steps become
// FreeRide segments, which is the honest equivalent on the trainer.
function xmlEsc(s) { return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c])); }
function zwoStep(s, st) {
  const cad = s.cadence ? ` Cadence="${Math.round((s.cadence.lo + s.cadence.hi) / 2)}"` : '';
  const t = s.target, d = s.dur_s;
  if (t.type === 'power' || t.type === 'watts') {
    const p = fracAt(t, 0, st).toFixed(3);
    return `    <SteadyState Duration="${d}" Power="${p}"${cad}/>`;
  }
  if (t.type === 'ramp') return `    <Ramp Duration="${d}" PowerLow="${(t.from / 100).toFixed(3)}" PowerHigh="${(t.to / 100).toFixed(3)}"${cad}/>`;
  return `    <FreeRide Duration="${d}" FlatRoad="1"${cad}/>`;
}
function toZwo(workout, settings) {
  const st = settingsOf(settings);
  const body = [];
  for (const it of workout.steps || []) {
    if (it.kind === 'repeat') {
      const [a, b] = it.steps;
      const simple = it.steps.length === 2 && ['power', 'watts'].includes(a.target.type) && ['power', 'watts'].includes(b.target.type);
      if (simple) {
        body.push(`    <IntervalsT Repeat="${it.count}" OnDuration="${a.dur_s}" OffDuration="${b.dur_s}" OnPower="${fracAt(a.target, 0, st).toFixed(3)}" OffPower="${fracAt(b.target, 0, st).toFixed(3)}"${a.cadence ? ` Cadence="${Math.round((a.cadence.lo + a.cadence.hi) / 2)}"` : ''}/>`);
      } else for (let i = 0; i < it.count; i++) for (const s of it.steps) body.push(zwoStep(s, st));
    } else body.push(zwoStep(it, st));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>The Way</author>
  <name>${xmlEsc(workout.name || 'Workout')}</name>
  <description>${xmlEsc((workout.notes || '') + ' (planned at FTP ' + st.ftp + ' W)')}</description>
  <sportType>bike</sportType>
  <tags/>
  <workout>
${body.join('\n')}
  </workout>
</workout_file>
`;
}

module.exports = { DEFAULTS, settingsOf, normItems, flatten, metrics, profile, toIntervalsText, toZwo, dur, cue };
