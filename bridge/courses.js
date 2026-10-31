// ============================================================
// courses.js — the routes as courses to pick for a ride, scored against
// the wind of the hour.
//
// A course is one of his routes (flags.js keeps them: RideWithGPS when it
// is connected, otherwise the roads Strava has seen him ride, grouped by
// name) read as two halves: the heading of the first half and of the
// second, each the distance-weighted mean of its segments. Against the
// forecast wind for the start the plan has in mind, each half reads as
// headwind, crosswind or tailwind (weather.windKind), and the courses are
// ranked the way a rider wants them: into the wind out, wind at the back
// coming home, and a length that fits the time. Zwift routes are listed
// for an indoor day, without wind.
//   GET /courses?date=YYYY-MM-DD&start=HH:MM&minutes=90
//     → { courses: [...ranked], zwift: [...], wind: {out, back}, kit, hours }
// ============================================================
const { getJSON } = require('./storage');
const { auth } = require('./fuel-log');
const tz = require('./tz');
const G = require('./flags-math');
const WX = require('./weather');

const rad = x => x * Math.PI / 180, deg = x => x * 180 / Math.PI;
const norm = b => ((b % 360) + 360) % 360;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const compass = d => COMPASS[Math.round(norm(d) / 45) % 8];

// The distance-weighted mean heading of a run of points: the sum of the
// segment vectors (east, north in metres), read as a bearing.
function meanHeading(points) {
  let e = 0, n = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    e += (b.lng - a.lng) * 111320 * Math.cos(rad((a.lat + b.lat) / 2));
    n += (b.lat - a.lat) * 110540;
  }
  if (!e && !n) return null;
  return Math.round(norm(deg(Math.atan2(e, n))));
}
// A route in two halves by distance, with its shape.
function halves(points) {
  const pts = G.annotate ? G.annotate(points) : points;
  if (!pts || pts.length < 3) return null;
  const total = pts[pts.length - 1].d || 0;
  if (!total) return null;
  const mid = pts.findIndex(p => p.d >= total / 2);
  const out = pts.slice(0, Math.max(2, mid + 1)), back = pts.slice(Math.max(0, mid));
  const bOut = meanHeading(out), bBack = meanHeading(back);
  const closes = G.dist(pts[0], pts[pts.length - 1]) < 600;
  const diff = bOut != null && bBack != null ? Math.abs(((bBack - bOut) + 540) % 360 - 180) : null;   // 0 = straight back the way it came
  const shape = !closes ? 'point to point' : (diff != null && diff < 35) ? 'out and back' : 'loop';
  return { km: Math.round(total / 100) / 10, gain_m: pts[pts.length - 1].gain || 0, bearing_out: bOut, bearing_back: bBack, shape,
    start: { lat: pts[0].lat, lng: pts[0].lng } };
}

async function list() {
  const s = await getJSON('flags', { routes: [], speed_kmh: null });
  const out = [];
  for (const r of s.routes || []) {
    if (r.hidden) continue;
    const doc = await getJSON('route-' + String(r.id).replace(/[^\w-]/g, ''), null);
    const h = doc && doc.points ? halves(doc.points) : null;
    out.push(Object.assign({ id: r.id, name: r.name, source: r.source, virtual: !!r.virtual, rides: (r.rides || []).length || null },
      h || { km: r.km || null, gain_m: r.gain_m || null, bearing_out: null, bearing_back: null, shape: null, start: null }));
  }
  return { courses: out, speed_kmh: s.speed_kmh || null };
}

// The wind over a stretch of hours as one vector: mean of the hourly
// vectors, so a wind that veers through the ride reads as its average.
function windOver(hours, fromMin, toMin) {
  const hs = hours.filter(h => (h.hour + 1) * 60 > fromMin && h.hour * 60 < toMin);
  if (!hs.length) return null;
  let e = 0, n = 0, mph = 0, gust = 0;
  for (const h of hs) { const d = rad(h.wind_deg || 0); e += Math.sin(d) * h.wind_mph; n += Math.cos(d) * h.wind_mph; mph += h.wind_mph; gust = Math.max(gust, h.gust_mph || 0); }
  const from = norm(deg(Math.atan2(e, n)));
  return { deg: Math.round(from), from: compass(from), mph: Math.round(mph / hs.length), gust_mph: gust };
}

// One course against one ride: the window's wind read by half, and a score.
function score(c, hours, startMin, minutes, speedKmh) {
  const sp = speedKmh > 10 ? speedKmh : 24;
  const est = c.km ? Math.round(c.km / sp * 60) : null;
  const half = Math.round((est || minutes) / 2);
  const wOut = windOver(hours, startMin, startMin + half), wBack = windOver(hours, startMin + half, startMin + 2 * half);
  const kindOut = wOut && c.bearing_out != null ? WX.windKind(wOut.deg, c.bearing_out) : null;
  const kindBack = wBack && c.bearing_back != null ? WX.windKind(wBack.deg, c.bearing_back) : null;
  let s = 0; const why = [];
  if (kindBack === 'tailwind') { s += 3; why.push('wind at your back coming home'); }
  else if (kindBack === 'crosswind') { s += 1.5; why.push('crosswind home'); }
  else if (kindBack === 'headwind') { why.push('headwind home'); }
  if (kindOut === 'headwind') { s += 1; why.push('into the wind out, when the legs are fresh'); }
  else if (kindOut === 'tailwind') { why.push('tailwind out'); }
  if (wBack && wBack.mph < 7) { s += 0.5; why.length = 0; why.push(`light wind (${wBack.mph} mph), any way round`); }
  if (est && minutes) { const off = Math.abs(est - minutes) / minutes; s -= off * 2; if (off > 0.35) why.push(est > minutes ? `long for ${minutes} min (about ${est})` : `short for ${minutes} min (about ${est})`); else why.push(`about ${est} min`); }
  if (c.gain_m && c.km && c.gain_m / c.km > 15) why.push(`hilly, ${c.gain_m} m`);
  return Object.assign({}, c, { out: kindOut, back: kindBack, wind_out: wOut, wind_back: wBack, est_min: est, score: Math.round(s * 10) / 10, why: why.join('; ') });
}

async function forRide(date, startHM, minutes) {
  const { courses, speed_kmh } = await list();
  const sm = /^\d{2}:\d{2}$/.test(startHM || '') ? (+startHM.slice(0, 2)) * 60 + (+startHM.slice(3, 5)) : 9 * 60;
  const mins = minutes > 0 ? minutes : 90;
  let hours = [];
  try { const o = await WX.outlook(date, date); hours = (o.days[date] || {}).hours || []; } catch (e) { hours = []; }
  const window = hours.filter(h => (h.hour + 1) * 60 > sm && h.hour * 60 < sm + mins);
  const outdoor = courses.filter(c => !c.virtual).map(c => score(c, hours, sm, mins, speed_kmh)).sort((a, b) => b.score - a.score);
  const zwift = courses.filter(c => c.virtual).map(c => Object.assign({}, c, { est_min: c.km ? Math.round(c.km / (speed_kmh > 10 ? speed_kmh : 24) * 60) : null }));
  const w = windOver(hours, sm, sm + mins);
  return { date, start: String(Math.floor(sm / 60)).padStart(2, '0') + ':' + String(sm % 60).padStart(2, '0'), minutes: mins, wind: w, hours: window, kit: WX.kit(window), courses: outdoor, zwift, speed_kmh,
    grade: window.length ? (window.some(h => h.grade === 'bad') ? 'bad' : window.some(h => h.grade === 'ok') ? 'ok' : 'good') : null,
    note: outdoor.length ? null : 'No outdoor routes yet: ride a few loops and the flag game reads them from Strava, or connect RideWithGPS in Settings.' };
}

function attach(app) {
  app.get('/courses', async (req, res) => { if (!auth(req, res)) return;
    try {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : tz.todayKey();
      res.json(await forRide(date, req.query.start, parseInt(req.query.minutes, 10)));
    } catch (e) { res.status(500).json({ error: e.message }); } });
}

module.exports = { attach, list, forRide, halves, meanHeading, windOver, score };
