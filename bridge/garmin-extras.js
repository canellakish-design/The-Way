// ============================================================
// garmin-extras.js — what the Edge field needs beyond the session itself (9 Nov 2026):
// the fuel prompts, the fuel tank at the start, sunset, how long after the ride he needs before
// the next event, the VO2 targets, the pre-ride screen, the energy line; and the two things the
// Edge sends back: a fuel press (logged as on-bike carbs) and a post-ride rating.
// Pure helpers first (tested in garmin.test.js), then the gatherers that read the stores.
// ============================================================
const { getJSON, setJSON } = require('./storage');
const tz = require('./tz');

const HOME = { lat: 38.978, lon: -76.492 };        // Annapolis
const SOCCERPLEX = { lat: 39.153, lon: -77.312 };   // Maryland SoccerPlex, Boyds
const PLEX_RE = /soccerplex|schaeffer|germantown|boyds/i;
const VO2_RE = /\bvo2\b|40\/20|4\s*[x×]\s*4/i;
const MTB_RE = /mountain bike|\bmtb\b/i;

// ---- the fuel prompts: one rule with the plan's on-bike line (food-math.onBike) ----
// grams per hour by session length; a hard session is always fed; under 75 min easy, water only.
function fuelPlan(name, minutes) {
  const mins = Number(minutes) || 0;
  const hard = VO2_RE.test(String(name || ''));
  let gph;
  if (hard) gph = mins > 0 ? Math.min(60, Math.round(50 / (mins / 60))) : 50;
  else if (mins < 75) return null;
  else if (mins < 120) gph = 30;
  else if (mins <= 150) gph = 60;
  else gph = 90;
  const every = 20;
  return { every_min: every, grams: Math.round(gph * every / 60), product: 'Tailwind', start_min: 20, g_per_h: gph };
}

// ---- sunset: NOAA's simplified solar position, good to a minute or two ----
function sunsetEpoch(dateKey, lat, lon) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const rad = Math.PI / 180;
  const N = Math.floor(Date.UTC(y, m - 1, d) / 864e5 - Date.UTC(y, 0, 0) / 864e5);
  const g = 2 * Math.PI / 365 * (N - 1 + 0.5);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
  const minutesUTC = 720 - 4 * (lon - ha) - eqt;   // sunset, minutes after UTC midnight
  return Math.round(Date.UTC(y, m - 1, d) / 1000 + minutesUTC * 60);
}

// epochs for the Edge: good light ends, lights on, dark. Road: lights on at sunset, dark at civil dusk.
// Trail: under the trees it dims half an hour before sunset and is dark at sunset.
function lightFor(sunset, dateKey, lat, woods) {
  if (sunset == null) return null;
  const Lt = require('./light'), t = Lt.twilightMinutes(dateKey, lat), w = woods ? Lt.WOODS_MIN : 0;
  return { woods: !!woods, good_until: sunset - (w + Lt.LOW_MIN) * 60, lights_from: sunset - w * 60, dark_at: woods ? sunset : sunset + t * 60, twilight_min: t };
}

// where the ride starts, from its notes: the SoccerPlex weekend, else home
function placeOf(notes) { return PLEX_RE.test(String(notes || '')) ? SOCCERPLEX : HOME; }

// the minutes needed after the ride before the next event: a shower and the drive at the fields
function turnBuffer(notes) { return { buffer_min: PLEX_RE.test(String(notes || '')) ? 45 : 30 }; }

function vo2Of(name) { return VO2_RE.test(String(name || '')) ? { hr_floor: 147, goal_min: [8, 12] } : null; }

// the first line of the EAT note's "Before:" for the pre-ride screen
function eatBefore(notes) {
  const m = String(notes || '').match(/Before:\s*([^\n]+)/i);
  return m ? m[1].trim().slice(0, 60) : null;
}

// the session's fuel tank at its start, from the day's live fuel model (food.dayReport().energy)
function tankFor(energy, name) {
  if (!energy) return null;
  const s = (energy.starts || []).find(x => String(x.name || '') === String(name || '')) || null;
  const p = s || energy.now || null;
  if (!p || p.pct == null) return null;
  const full = energy.full_g || 110, legsFull = energy.legs_full_g || 320;
  return { quick_pct: Math.round(p.pct), legs_pct: p.legs_pct == null ? null : Math.round(p.legs_pct),
    quick_g: Math.round(full * p.pct / 100), legs_g: p.legs_pct == null ? null : Math.round(legsFull * p.legs_pct / 100) };
}

// ---- the gatherer: everything above for today's session, each part on its own so one dead source never blanks the rest ----
async function extrasFor(session) {
  const w = (session && session.workout) || null;
  const today = tz.todayKey();
  const out = { fuel: null, tank: null, sunset: null, light: null, turn: null, vo2: null, recovery: null, eat_before: null, energy: null, sport: null };
  const place = placeOf(w && w.notes);
  try { out.sunset = sunsetEpoch(today, place.lat, place.lon); } catch (e) { out.sunset = null; }
  if (!w) return out;
  // light, not just sunset (pwa/light.js): when good light ends, when lights go on, when it is dark; a trail half an hour sooner
  try { out.light = lightFor(out.sunset, today, place.lat, require('./light').isWoods(w.name, w.sport)); } catch (e) { out.light = null; }
  out.sport = MTB_RE.test(w.name || '') ? 'mtb' : VO2_RE.test(w.name || '') ? 'vo2' : (w.sport || null);
  out.fuel = fuelPlan(w.name, (w.duration_s || 0) / 60);
  out.turn = turnBuffer(w.notes);
  out.vo2 = vo2Of(w.name);
  out.eat_before = eatBefore(w.notes);
  let day = null;
  try { day = await require('./food').dayReport(today); } catch (e) { day = null; }
  if (day) {
    try { out.tank = tankFor(day.energy, w.name); } catch (e) { out.tank = null; }
    try {
      const t = day.target || {};
      out.energy = { base_burn: t.base_burn != null ? Math.round(t.base_burn) : null, eaten_kcal: day.actual && day.actual.kcal != null ? Math.round(day.actual.kcal) : 0,
        day_target_net: t.deficit != null ? Math.round(t.deficit) : null };
    } catch (e) { out.energy = null; }
  }
  try { const s = await require('./whoop').sleepLatest({ sync: false }); out.recovery = s && s.recovery && s.recovery.score != null ? Math.round(s.recovery.score) : null; } catch (e) { out.recovery = null; }
  return out;
}

// ---- what the Edge sends back ----
// A fuel press: on-bike carbs, logged once per (ride, second). Tailwind 2 scoops: 50 g carbs in 200 kcal.
async function logFuel(b) {
  const x = b || {};
  const rideId = String(x.ride_id || '').slice(0, 40), t = Math.round(Number(x.t) || 0);
  const grams = Math.max(1, Math.min(100, Math.round(Number(x.grams) || 20)));
  if (!rideId) { const e = new Error('ride_id needed'); e.status = 400; throw e; }
  const seen = await getJSON('garmin-fuel', { presses: [] });
  const key = rideId + '|' + t;
  if ((seen.presses || []).some(p => p.key === key)) return { ok: true, duplicate: true };
  const product = String(x.product || 'Tailwind').slice(0, 40);
  const entry = await require('./food').addKnown({ name: `${product}, ${grams} g carbs (on the bike)`, kcal: grams * 4, carbs_g: grams, protein_g: 0, fat_g: 0,
    tags: [], why: 'Logged from the Edge with a lap press at a fuel prompt.', fits: 'yes' });
  seen.presses = (seen.presses || []).concat([{ key, ride_id: rideId, t, grams, at: Date.now(), entry: entry && entry.id }]).slice(-500);
  await setJSON('garmin-fuel', seen);
  return { ok: true, entry: entry && entry.id };
}

// A rating: legs and breathing, 1 to 5. Kept with the ride, and the legs feed the fuel model's calibration.
async function rateRide(b) {
  const x = b || {};
  const rideId = String(x.ride_id || '').slice(0, 40);
  const legs = Math.round(Number(x.legs)), breathing = Math.round(Number(x.breathing));
  const okN = n => n >= 1 && n <= 5;
  if (!rideId || (!okN(legs) && !okN(breathing))) { const e = new Error('ride_id and legs or breathing 1 to 5 needed'); e.status = 400; throw e; }
  const d = await getJSON('garmin-ratings', { rides: [] });
  const row = { ride_id: rideId, legs: okN(legs) ? legs : null, breathing: okN(breathing) ? breathing : null, name: x.name ? String(x.name).slice(0, 80) : null, date: tz.todayKey(), at: Date.now() };
  d.rides = (d.rides || []).filter(r => r.ride_id !== rideId).concat([row]).slice(-300);
  await setJSON('garmin-ratings', d);
  if (row.legs && row.name) { try { await require('./food').rateLegs(row.date + '|' + row.name, row.legs); } catch (e) { /* the rating stands on its own */ } }
  return { ok: true, rating: row };
}

module.exports = { fuelPlan, sunsetEpoch, lightFor, placeOf, turnBuffer, vo2Of, eatBefore, tankFor, extrasFor, logFuel, rateRide, HOME, SOCCERPLEX };
