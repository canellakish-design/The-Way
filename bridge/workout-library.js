// ============================================================
// workout-library.js — the sessions this plan actually uses, as templates.
// Each one is copied into a new workout and can be edited from there.
// Sources (project docs): three-zone model (VT1 169 W / 117 bpm,
// VT2 208 W / 139 bpm), vo2-protocol-redesign (Sessions A and B, anchored to
// the Tymewear test in watts, not % FTP), training-week-oct26 (threshold 2×10).
// ============================================================
const m = n => n * 60;
const step = (label, dur_s, target, cadence) => ({ kind: 'step', label, dur_s, target, cadence: cadence || null });
const rep = (label, count, steps) => ({ kind: 'repeat', label, count, steps });
const hr = (lo, hi) => ({ type: 'hr', lo, hi });
const w = (lo, hi) => ({ type: 'watts', lo, hi: hi == null ? lo : hi });
const ramp = (from, to) => ({ type: 'ramp', from, to });

const LIBRARY = [
  {
    key: 'z1-45', name: 'Z1 endurance, 45 min', sport: 'VirtualRide',
    notes: 'Heart rate under 116 bpm the whole way. If heart rate climbs, the watts come down, not the other way round.',
    steps: [step('Settle', m(5), hr(95, 110)), step('Zone one', m(38), hr(100, 116)), step('Easy', m(2), hr(90, 105))]
  },
  {
    key: 'z1-90', name: 'Z1 endurance, 90 min', sport: 'Ride',
    notes: 'Flat route only: above about 6% Zone 1 is not physically available at 104 kg all in.',
    steps: [step('Settle', m(10), hr(95, 110)), step('Zone one', m(75), hr(100, 116)), step('Easy', m(5), hr(90, 105))]
  },
  {
    key: 'thr-2x10', name: '2 hr with 2 × 10 threshold (heart-rate led)', sport: 'Ride',
    notes: 'Targets by heart rate until a ramp test settles FTP: VT2 is 139 bpm. Over 145 means over threshold, back off. Start efforts on a steady stretch, never into a climb.',
    steps: [
      step('Easy start', m(30), hr(100, 116)),
      rep('Threshold', 2, [step('Threshold', m(10), hr(135, 142)), step('Recover', m(10), hr(100, 120))]),
      step('Easy home', m(50), hr(100, 116))
    ]
  },
  {
    key: 'vo2-a', name: 'VO2 Session A — 30/15 × 3 blocks', sport: 'VirtualRide',
    notes: 'The one metric: minutes above 147 bpm, target 8 to 12. Cadence 95 to 100 on the efforts; under 88 ends the block. Fan on, morning, fed, Tymewear on.',
    steps: [
      step('Build', m(15), ramp(50, 80)),
      rep('Openers', 3, [step('Opener', 30, w(250)), step('Easy', 90, w(95))]),
      step('Easy', m(3), w(100)),
      rep('Block one', 13, [step('On', 30, w(240), { lo: 95, hi: 100 }), step('Float', 15, w(110))]),
      step('Recover', m(4), w(90)),
      rep('Block two', 13, [step('On', 30, w(240), { lo: 95, hi: 100 }), step('Float', 15, w(110))]),
      step('Recover', m(4), w(90)),
      rep('Block three', 13, [step('On', 30, w(240), { lo: 95, hi: 100 }), step('Float', 15, w(110))]),
      step('Cool down', m(8), w(90))
    ]
  },
  {
    key: 'vo2-b', name: 'VO2 Session B — hard-start 4 × 4', sport: 'VirtualRide',
    notes: 'Open each rep at 235 W to drive heart rate up, then hold 210 W. Recoveries are deliberately incomplete. Cadence 92 to 95.',
    steps: [
      step('Build', m(15), ramp(50, 80)),
      rep('Openers', 3, [step('Opener', 30, w(250)), step('Easy', 90, w(95))]),
      step('Easy', m(2), w(100)),
      rep('Main set', 4, [step('Hard start', m(1), w(235), { lo: 92, hi: 95 }), step('Hold', m(3), w(210), { lo: 92, hi: 95 }), step('Recover', m(3), w(100))]),
      step('Cool down', m(8), w(90))
    ]
  },
  {
    key: 'ramp-test', name: 'Ramp test', sport: 'VirtualRide',
    notes: 'The number one blocker since August. One minute steps, plus 20 W each, until you cannot hold it; if you reach the last step, keep going in free ride. Wear the heart rate strap and the Tymewear. Planned load assumes you finish the steps; the real number will be lower.',
    steps: [step('Warm up', m(5), w(100))].concat(
      Array.from({ length: 11 }, (_, i) => step('Step', 60, w(120 + i * 20))),
      [step('Keep going', m(3), { type: 'free' })],
      [step('Cool down', m(8), w(90))])
  }
];

module.exports = { LIBRARY };
