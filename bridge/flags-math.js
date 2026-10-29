// ============================================================
// flags-math.js — the flag game, pure arithmetic.
//
// A flag is an iconic spot on one of his routes: a summit, a dam, a
// bridge, a viewpoint, a town, the far turn. Flags are placed on the
// RideWithGPS routes (or, until that is connected, on the roads Strava
// shows he rides) and named from OpenStreetMap's named features beside
// the road. Each flag knows the work it takes to reach it from the
// route's start (TSS and minutes), how often he has been there (which
// sets its rarity), and it is caught when a ride's GPS track passes
// within CATCH_M of it. Zwift rides upload with map coordinates too, so
// the same catch rule works in Watopia.
//
// Rarity, like the card game: common (ridden there most weeks),
// uncommon, rare (been once), legendary (on a route, never ridden).
// XP per catch by rarity, tripled the first time a flag is ever caught,
// a bonus for completing the day's hunt. Levels are triangular: 100,
// 300, 600, 1000...
// ============================================================
const CATCH_M = 70;        // within this of the flag counts as reaching it
const VISIT_M = 80;        // a past track within this counts as a visit
const MIN_GAP_M = 2500;    // flags on one route are at least this far apart
const MAX_PER_ROUTE = 8;
const XP = { common: 10, uncommon: 25, rare: 60, legendary: 150 };
const HUNT_BONUS = 50;
const TSS_PER_HOUR = 45;   // a steady outdoor ride, IF ≈ 0.67
const TSS_PER_M_GAIN = 1 / 15;

const R = 6371000;
const rad = x => x * Math.PI / 180;
function dist(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Cumulative distance and climbing along a list of {lat, lng, ele?}.
function annotate(points) {
  let d = 0, gain = 0, last = null, lastEle = null;
  return points.map(p => {
    if (last) d += dist(last, p);
    if (p.ele != null && lastEle != null && p.ele > lastEle) gain += p.ele - lastEle;
    if (p.ele != null) lastEle = p.ele;
    last = p;
    return Object.assign({}, p, { d: Math.round(d), gain: Math.round(gain) });
  });
}

// Keep a point every `everyM` metres (and the last one).
function downsample(points, everyM) {
  const out = []; let last = null;
  for (const p of points) {
    if (!last || dist(last, p) >= (everyM || 50)) { out.push(p); last = p; }
  }
  if (points.length && out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}

// A spatial index on ~110 m cells for the "is any track point near here" questions.
function cellOf(lat, lng) { return Math.floor(lat * 1000) + ':' + Math.floor(lng * 1000 * Math.max(0.2, Math.cos(rad(lat)))); }
function index(points) {
  const m = new Map();
  for (const p of points) { const k = cellOf(p.lat, p.lng); if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
  return m;
}
function nearest(idx, pt, within) {
  let best = null, bd = Infinity;
  const lat0 = Math.floor(pt.lat * 1000), lng0 = Math.floor(pt.lng * 1000 * Math.max(0.2, Math.cos(rad(pt.lat))));
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const arr = idx.get((lat0 + a) + ':' + (lng0 + b)); if (!arr) continue;
    for (const p of arr) { const d = dist(p, pt); if (d < bd) { bd = d; best = p; } }
  }
  return best && bd <= within ? { point: best, d: Math.round(bd) } : null;
}

// Work to reach a point: time at a steady pace plus the climbing.
function workAt(distM, gainM, speedKmh) {
  const v = speedKmh > 8 ? speedKmh : 24;
  const minutes = Math.round(distM / 1000 / v * 60 + (gainM || 0) / 10);   // VAM-ish: 10 m of climbing costs about a minute at his pace
  const tss = Math.round(minutes / 60 * TSS_PER_HOUR + (gainM || 0) * TSS_PER_M_GAIN);
  return { minutes, tss };
}

// What counts as iconic, and how much. OpenStreetMap tags → kind and rank.
const KINDS = [
  ['natural', 'peak', 'summit', 10], ['natural', 'saddle', 'summit', 8], ['tourism', 'viewpoint', 'view', 9],
  ['waterway', 'dam', 'dam', 9], ['man_made', 'dam', 'dam', 9], ['man_made', 'lighthouse', 'landmark', 9],
  ['man_made', 'tower', 'landmark', 6], ['historic', '*', 'historic', 7], ['natural', 'water', 'water', 7],
  ['natural', 'beach', 'water', 7], ['bridge', '*', 'bridge', 6], ['man_made', 'bridge', 'bridge', 6],
  ['leisure', 'nature_reserve', 'park', 6], ['leisure', 'park', 'park', 5], ['boundary', 'national_park', 'park', 7],
  ['place', 'town', 'town', 6], ['place', 'village', 'town', 5], ['place', 'hamlet', 'town', 4], ['place', 'suburb', 'town', 3],
  ['tourism', 'attraction', 'landmark', 7], ['amenity', 'cafe', 'cafe', 3], ['amenity', 'place_of_worship', 'church', 3],
  ['aeroway', 'aerodrome', 'landmark', 5], ['railway', 'station', 'landmark', 4]
];
function classify(tags) {
  if (!tags || !tags.name) return null;
  let best = null;
  for (const [k, v, kind, rank] of KINDS) {
    if (tags[k] != null && (v === '*' || tags[k] === v) && (!best || rank > best.rank)) best = { kind, rank };
  }
  return best;
}
// The Overpass query for named features within 200 m of the route polyline (vertices every 600 m; the
// snap to the road in placeFlags is the fine filter). Sent by POST, so its size only costs bandwidth.
function overpassQuery(points) {
  const pts = downsample(points, 600).map(p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5)).join(',');
  const sel = ['natural~"^(peak|saddle|water|beach)$"', 'tourism~"^(viewpoint|attraction)$"', 'waterway=dam', 'man_made~"^(dam|lighthouse|tower|bridge)$"',
    'historic', 'bridge', 'leisure~"^(nature_reserve|park)$"', 'boundary=national_park', 'place~"^(town|village|hamlet|suburb)$"', 'amenity~"^(cafe|place_of_worship)$"',
    'aeroway=aerodrome', 'railway=station'];
  return `[out:json][timeout:12];(${sel.map(s => `nwr[name][${s}](around:200,${pts});`).join('')});out center tags;`;
}
function parsePois(json) {
  const out = [];
  for (const el of (json && json.elements) || []) {
    const c = classify(el.tags); if (!c) continue;
    const lat = el.lat != null ? el.lat : el.center && el.center.lat, lng = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || lng == null) continue;
    out.push({ name: el.tags.name, kind: c.kind, rank: c.rank, lat, lng });
  }
  return out;
}

// Place the flags on one route. route: {id, name, points:[{lat,lng,ele?}]},
// pois from Overpass, tracks: past rides' points (for visits), speed km/h.
function placeFlags(route, pois, tracks, opts) {
  const o = opts || {};
  const pts = annotate(route.points || []);
  if (pts.length < 10) return [];
  const idx = index(pts);
  const cands = [];
  for (const poi of pois || []) {
    const n = nearest(idx, poi, 120); if (!n) continue;
    cands.push({ name: poi.name, kind: poi.kind, rank: poi.rank, lat: n.point.lat, lng: n.point.lng, d: n.point.d, gain: n.point.gain, ele: n.point.ele });
  }
  // The high point and the far turn are iconic on any route, named or not.
  const withEle = pts.filter(p => p.ele != null);
  if (withEle.length) {
    const top = withEle.reduce((a, p) => p.ele > a.ele ? p : a);
    if (top.d > 500 && top.d < pts[pts.length - 1].d - 500 && !cands.some(c => dist(c, top) < 400 && c.kind === 'summit'))
      cands.push({ name: `High point, ${Math.round(top.ele)} m`, kind: 'summit', rank: 8, lat: top.lat, lng: top.lng, d: top.d, gain: top.gain, ele: top.ele });
  }
  const far = pts.reduce((a, p) => dist(pts[0], p) > dist(pts[0], a) ? p : a);
  if (far.d > 1500 && !cands.some(c => dist(c, far) < 600)) cands.push({ name: 'The far turn', kind: 'turn', rank: 5, lat: far.lat, lng: far.lng, d: far.d, gain: far.gain, ele: far.ele });
  // Pick by rank, keeping them spread along the route; one flag per name.
  cands.sort((a, b) => b.rank - a.rank || a.d - b.d);
  const chosen = [], names = new Set();
  for (const c of cands) {
    if (chosen.length >= (o.max || MAX_PER_ROUTE)) break;
    if (names.has(c.name.toLowerCase())) continue;
    if (c.d < 800) continue;                                       // not the driveway
    if (chosen.some(x => Math.abs(x.d - c.d) < (o.min_gap || MIN_GAP_M))) continue;
    names.add(c.name.toLowerCase()); chosen.push(c);
  }
  chosen.sort((a, b) => a.d - b.d);
  const tIdx = index(tracks && tracks.length ? tracks.flatMap(t => t.points.map(p => Object.assign({ track: t.id }, p))) : []);
  return chosen.map((c, i) => {
    const w = workAt(c.d, c.gain, o.speed_kmh);
    const visits = visitCount(tIdx, c, tracks || []);
    return { id: `${route.id}:${i}`, route_id: route.id, route: route.name, name: c.name, kind: c.kind, lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5),
      km: Math.round(c.d / 100) / 10, gain_m: c.gain, ele_m: c.ele != null ? Math.round(c.ele) : null, work_tss: w.tss, work_min: w.minutes,
      visits, rarity: rarity(visits), virtual: !!route.virtual };
  });
}

// How many distinct past rides passed within VISIT_M of the spot.
function visitCount(tIdx, spot, tracks) {
  const seen = new Set();
  const lat0 = Math.floor(spot.lat * 1000), lng0 = Math.floor(spot.lng * 1000 * Math.max(0.2, Math.cos(rad(spot.lat))));
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const arr = tIdx.get((lat0 + a) + ':' + (lng0 + b)); if (!arr) continue;
    for (const p of arr) if (!seen.has(p.track) && dist(p, spot) <= VISIT_M) seen.add(p.track);
  }
  return seen.size;
}
function rarity(visits) { return visits >= 6 ? 'common' : visits >= 2 ? 'uncommon' : visits >= 1 ? 'rare' : 'legendary'; }

// Flags from ride history alone (no RideWithGPS yet, and every Zwift
// world): rides that cover the same roads are one route, whatever Strava
// called them (his are mostly "Morning Ride"). Two rides are the same route
// when most of each lies within 150 m of the other. Each group's longest
// ride stands for the route.
const DEFAULT_NAME = /^(morning|lunch|afternoon|evening|night|early morning) (ride|zwift|virtual ride|activity)$/i;
function overlap(a, b) {
  const idx = index(b);
  let hit = 0;
  for (const p of a) if (nearest(idx, p, 150)) hit++;
  return a.length ? hit / a.length : 0;
}
function routesFromTracks(tracks) {
  const ts = tracks.filter(t => t.points && t.points.length >= 20).map(t => Object.assign({}, t, { thin: downsample(t.points, 120) }));
  const parent = ts.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
    if (!!ts[i].virtual !== !!ts[j].virtual) continue;
    if (dist(ts[i].thin[0], ts[j].thin[0]) > 30000) continue;          // different corners of the world: not the same loop
    if (overlap(ts[i].thin, ts[j].thin) >= 0.6 && overlap(ts[j].thin, ts[i].thin) >= 0.6) parent[find(i)] = find(j);
  }
  const groups = new Map();
  for (let i = 0; i < ts.length; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(ts[i]); }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2 && !list[0].virtual) continue;       // a one-off ride is not a route
    const longest = list.reduce((a, t) => t.points.length > a.points.length ? t : a);
    const given = list.map(t => t.name).find(n => n && !DEFAULT_NAME.test(n.trim()));
    const km = Math.round(annotate(longest.points).slice(-1)[0].d / 1000);
    out.push({ id: 'ride-' + longest.id, name: given || `${longest.virtual ? 'Route' : 'Loop'} · ${km} km`, virtual: !!longest.virtual, points: longest.points, rides: list.length });
  }
  return out.sort((a, b) => b.rides - a.rides).slice(0, 12);
}

// Zwift's worlds sit at real coordinates; the name of the world is the only naming a virtual flag can get.
const WORLDS = [['Watopia', -11.64, 166.95], ['Richmond', 37.54, -77.43], ['London', 51.50, -0.12], ['New York', 40.78, -73.97],
  ['Innsbruck', 47.27, 11.39], ['Yorkshire', 53.99, -1.54], ['France', -21.70, 166.17], ['Paris', 48.86, 2.33], ['Makuri Islands', -10.74, 165.84], ['Scotland', 55.62, -5.26]];
function worldOf(lat, lng) {
  let best = 'Zwift', bd = Infinity;
  for (const [n, la, lo] of WORLDS) { const d = dist({ lat, lng }, { lat: la, lng: lo }); if (d < bd) { bd = d; best = n; } }
  return bd < 200000 ? best : 'Zwift';
}

// Catches on one ride: every flag the track passed within CATCH_M of.
function catchesIn(flags, track) {
  const idx = index(track.points || []);
  const out = [];
  for (const f of flags) {
    const n = nearest(idx, f, CATCH_M);
    if (n) out.push({ flag_id: f.id, d: n.d, at_sec: n.point.t != null ? n.point.t : null });
  }
  return out;
}

function xpFor(flag, firstEver) { return (XP[flag.rarity] || XP.common) * (firstEver ? 3 : 1); }
function level(xp) {
  let n = 0; while (100 * (n + 1) * (n + 2) / 2 <= xp) n++;
  const floor = 100 * n * (n + 1) / 2, next = 100 * (n + 1) * (n + 2) / 2;
  return { level: n + 1, xp, floor, next, pct: Math.round((xp - floor) / (next - floor) * 100) };
}

// Today's hunt: the route whose flags fit the day's work, and the flags
// on it that the planned TSS reaches. virtual picks Zwift routes.
function hunt(flags, tssTarget, virtual) {
  if (!tssTarget || tssTarget < 15) return null;
  const pool = flags.filter(f => !!f.virtual === !!virtual && !f.hidden);
  const byRoute = new Map();
  for (const f of pool) { if (!byRoute.has(f.route_id)) byRoute.set(f.route_id, []); byRoute.get(f.route_id).push(f); }
  let best = null;
  for (const [rid, fs] of byRoute) {
    const reach = fs.filter(f => f.work_tss <= tssTarget * 1.1);
    if (!reach.length) continue;
    const top = Math.max(...reach.map(f => f.work_tss));
    // Prefer the route the day's work fills best, then the one with more flags to catch.
    const score = top / tssTarget - (reach.length / 100);
    if (!best || Math.abs(1 - score) < Math.abs(1 - best.score)) best = { route_id: rid, route: fs[0].route, flags: reach.sort((a, b) => a.km - b.km), score };
  }
  return best ? { route_id: best.route_id, route: best.route, tss: tssTarget, flags: best.flags, size: best.flags.length } : null;
}

// A Garmin course: the route's track with the flags as course points, so
// the Edge calls each flag out as it is reached.
function tcxCourse(route, flags) {
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const pts = annotate(downsample(route.points, 25));
  const t0 = Date.UTC(2026, 0, 1);
  const stamp = i => new Date(t0 + i * 1000).toISOString();
  const tp = pts.map((p, i) => `<Trackpoint><Time>${stamp(i)}</Time><Position><LatitudeDegrees>${p.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${p.lng.toFixed(6)}</LongitudeDegrees></Position>${p.ele != null ? `<AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>` : ''}<DistanceMeters>${p.d}</DistanceMeters></Trackpoint>`).join('');
  const idx = index(pts);
  const cp = flags.map(f => { const n = nearest(idx, f, 200); const i = n ? pts.indexOf(n.point) : 0;
    return `<CoursePoint><Name>${esc((f.name).slice(0, 10))}</Name><Time>${stamp(i)}</Time><Position><LatitudeDegrees>${f.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${f.lng.toFixed(6)}</LongitudeDegrees></Position><PointType>${f.kind === 'summit' ? 'Summit' : f.kind === 'water' ? 'Water' : f.kind === 'cafe' ? 'Food' : 'Generic'}</PointType><Notes>${esc(`Flag: ${f.name} (${f.rarity}, ${f.work_tss} TSS)`)}</Notes></CoursePoint>`; }).join('');
  const last = pts[pts.length - 1];
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses><Course><Name>${esc(route.name.slice(0, 15))}</Name>
<Lap><TotalTimeSeconds>${pts.length}</TotalTimeSeconds><DistanceMeters>${last.d}</DistanceMeters><BeginPosition><LatitudeDegrees>${pts[0].lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${pts[0].lng.toFixed(6)}</LongitudeDegrees></BeginPosition><EndPosition><LatitudeDegrees>${last.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${last.lng.toFixed(6)}</LongitudeDegrees></EndPosition><Intensity>Active</Intensity></Lap>
<Track>${tp}</Track>${cp}</Course></Courses></TrainingCenterDatabase>`;
}

module.exports = { CATCH_M, VISIT_M, MIN_GAP_M, XP, HUNT_BONUS, dist, annotate, downsample, index, nearest, workAt, classify, overpassQuery, parsePois,
  placeFlags, visitCount, rarity, routesFromTracks, overlap, worldOf, catchesIn, xpFor, level, hunt, tcxCourse };
