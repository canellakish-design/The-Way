// ============================================================
// hydration-math.js — the day's fluid, from the drinks the camera saw.
//
// The target is drinks only: EFSA's adequate intake for men is 2.5 L of
// water a day with about 80% of it from drinks, and the sports-medicine
// rule for an athlete is 30 to 35 ml per kg. 30 ml/kg of drinks (3.1 L at
// 104 kg, never under 2 L) covers both. Riding adds the sweat: the ACSM
// position stand puts cycling sweat at 0.4 to 0.8 L an hour at a moderate
// pace, so each hour on the bike adds 600 ml, counted once the ride is
// done (the bottle on the bike counts as a drink when it is photographed).
//
// The score is paced through the day, not judged against the whole
// target at breakfast: the base target is spread over the waking hours
// (06:00 to 22:00), ride fluid lands when the ride ends, and the score is
// drunk ÷ due-so-far, capped at 100. Green from 80%, amber from 50%, red
// below. Coffee and tea count in full (the diuretic effect of habitual
// caffeine is too small to matter, Killer 2014); milk, smoothies, soup
// broth and bottle mixes count; alcohol counts nothing.
// ============================================================
const ML_PER_KG = 30, MIN_ML = 2000, RIDE_ML_PER_H = 600;
const WAKE = 6 * 60, SLEEP = 22 * 60;
const DEFAULT_KG = 104;

function target(kg, rideHours) {
  const k = kg > 40 ? kg : DEFAULT_KG;
  const base = Math.max(MIN_ML, Math.round(k * ML_PER_KG / 50) * 50);
  const ride = Math.round((rideHours || 0) * RIDE_ML_PER_H / 50) * 50;
  return { base, ride, total: base + ride };
}

// How much of the base target is due by a minute of the day.
function dueFraction(nowMin) {
  if (nowMin == null) return 1;
  return Math.max(0, Math.min(1, (nowMin - WAKE) / (SLEEP - WAKE)));
}

// The word says what the number means: green early in the day is "on pace",
// not hydrated; it reads "hydrated" only once the whole day's target is in.
function band(score, done) {
  if (score == null) return { key: 'none', word: '', tone: 'neutral' };
  if (score >= 80) return { key: 'green', word: done ? 'hydrated' : 'on pace', tone: 'good' };
  if (score >= 50) return { key: 'yellow', word: 'behind', tone: 'warn' };
  return { key: 'red', word: 'dry', tone: 'bad' };
}

// entries: the day's journal (fluid_ml on the ones with a drink).
// opts: { kg, ride_hours (rides done), now_min (today only; null = whole day) }
function score(entries, opts) {
  const o = opts || {};
  const drinks = (entries || []).filter(e => e && e.fluid_ml > 0).map(e => ({ id: e.id, time: e.time || null, name: e.drink || e.name || 'drink', ml: Math.round(e.fluid_ml) }));
  const drunk = drinks.reduce((a, d) => a + d.ml, 0);
  const t = target(o.kg, o.ride_hours);
  const frac = dueFraction(o.now_min);
  const due = Math.max(250, Math.round(t.base * frac / 50) * 50 + t.ride);
  const logged = (entries || []).some(e => e && !e.supplement);
  const s = logged ? Math.min(100, Math.round(drunk / due * 100)) : null;
  const left = Math.max(0, t.total - drunk);
  return { score: s, band: band(s, drunk >= t.total), drunk_ml: drunk, due_ml: due, target: t, left_ml: left, drinks,
    note: s == null ? 'Nothing logged yet. A glass, a mug or a bottle in any photo counts; a photo of the bottle alone counts too.'
      : drunk >= due ? `${(drunk / 1000).toFixed(1)} L so far, on pace for the time of day. ${left ? (left / 1000).toFixed(1) + ' L more by bedtime.' : 'Done for the day.'}`
      : `${(drunk / 1000).toFixed(1)} L so far, ${((due - drunk) / 1000).toFixed(1)} L behind where the day should be. Drink ${Math.min(500, due - drunk)} ml now.` };
}

module.exports = { ML_PER_KG, MIN_ML, RIDE_ML_PER_H, target, dueFraction, band, score };
