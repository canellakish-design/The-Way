// node bridge/flags-math.test.js
const assert = require('assert');
const G = require('./flags-math');
let n = 0;
function ok(name, fn) { fn(); n++; console.log('ok ' + name); }

// A 20 km out-and-back north from a start, climbing to 300 m at the turn.
function route(id, name, virtual) {
  const pts = [];
  for (let i = 0; i <= 200; i++) { const lat = 39.4 + i * 0.0009; pts.push({ lat: +lat.toFixed(6), lng: -76.6, ele: 50 + i * 1.25 }); }
  for (let i = 199; i >= 0; i--) { const lat = 39.4 + i * 0.0009; pts.push({ lat: +lat.toFixed(6), lng: -76.6002, ele: 50 + i * 1.25 }); }
  return { id, name, virtual: !!virtual, points: pts };
}
const main = route('r1', 'Loch Raven loop');
const dam = { name: 'Loch Raven Dam', kind: 'dam', rank: 9, lat: 39.4 + 60 * 0.0009, lng: -76.5999 };
const town = { name: 'Phoenix', kind: 'town', rank: 5, lat: 39.4 + 120 * 0.0009, lng: -76.5999 };
const cafe = { name: 'Corner cafe', kind: 'cafe', rank: 3, lat: 39.4 + 62 * 0.0009, lng: -76.6 };    // too close to the dam: dropped

ok('distance and annotation', () => {
  assert.ok(Math.abs(G.dist({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 50);
  const a = G.annotate(main.points);
  assert.ok(a[a.length - 1].d > 39000 && a[a.length - 1].d < 41000, 'about 40 km: ' + a[a.length - 1].d);
  assert.strictEqual(a[200].gain, 250);
});

ok('placeFlags: iconic spots by rank, spread out, plus the high point and the far turn', () => {
  const flags = G.placeFlags(main, [dam, town, cafe], [], { speed_kmh: 24 });
  const names = flags.map(f => f.name);
  assert.ok(names.includes('Loch Raven Dam') && names.includes('Phoenix'), names.join(', '));
  assert.strictEqual(new Set(names).size, names.length, 'one flag per name');
  assert.ok(flags.every((f, i) => i === 0 || f.km - flags[i - 1].km >= 2.5), 'spread out: ' + flags.map(f => f.km));
  assert.ok(names.some(x => /^High point, 300 m/.test(x)), 'high point named: ' + names);
  assert.ok(flags.every(f => f.rarity === 'legendary'), 'never ridden: every flag is legendary');
  const d = flags.find(f => f.name === 'Loch Raven Dam');
  assert.strictEqual(d.km, 6);
  assert.ok(d.work_tss > 10 && d.work_tss < 30, 'work to the dam ' + d.work_tss);
  assert.ok(flags.every((f, i) => i === 0 || f.km >= flags[i - 1].km), 'in route order');
});

ok('visits set rarity; catches come from the track; XP triples a first catch', () => {
  const tracks = [];
  for (let i = 0; i < 7; i++) tracks.push({ id: 't' + i, name: 'Loch Raven loop', points: main.points.slice(0, 80) });   // seven rides to the dam, never past it
  const flags = G.placeFlags(main, [dam, town], tracks, { speed_kmh: 24 });
  assert.strictEqual(flags.find(f => f.name === 'Loch Raven Dam').rarity, 'common');
  assert.strictEqual(flags.find(f => f.name === 'Phoenix').rarity, 'legendary');
  const c = G.catchesIn(flags, { id: 'x', points: main.points.slice(0, 130).map((p, i) => Object.assign({ t: i * 30 }, p)) });
  assert.deepStrictEqual(c.map(x => x.flag_id).sort(), flags.filter(f => f.km <= 13).map(f => f.id).sort());
  assert.ok(c.every(x => x.d <= G.CATCH_M));
  assert.strictEqual(G.xpFor({ rarity: 'legendary' }, true), 450);
  assert.strictEqual(G.xpFor({ rarity: 'common' }, false), 10);
  assert.deepStrictEqual(G.level(0), { level: 1, xp: 0, floor: 0, next: 100, pct: 0 });
  assert.strictEqual(G.level(650).level, 4);
});

ok('hunt: the flags the day\'s TSS reaches, on the route the work fills best', () => {
  const flags = G.placeFlags(main, [dam, town], [], { speed_kmh: 24 });
  const h = G.hunt(flags, 40, false);
  assert.ok(h && h.size >= 2 && h.flags.every(f => f.work_tss <= 44), JSON.stringify(h));
  assert.strictEqual(G.hunt(flags, 0, false), null);
  const home = G.homeOf([{ id: 1, points: main.points }, { id: 2, points: main.points }, { id: 3, points: [{ lat: 38.25, lng: -122.3 }] }]);
  assert.ok(Math.abs(home.lat - 39.4) < 0.01 && home.rides === 2, JSON.stringify(home));
  assert.strictEqual(G.hunt(flags, 40, false, { home: { lat: 38.25, lng: -122.3 } }), null, 'flags 4,000 km from home are not the hunt');
  assert.ok(G.hunt(flags, 40, false, { home }));
  assert.strictEqual(G.hunt(flags, 60, true), null);   // no Zwift flags
});

ok('routesFromTracks groups rides by name; worldOf names the Zwift world; the Garmin course carries the flags', () => {
  const other = route('r2', 'Morning Ride'); other.points = other.points.map(p => ({ lat: p.lat, lng: p.lng + 0.05, ele: p.ele }));   // 4 km east: a different loop
  const r = G.routesFromTracks([{ id: 1, name: 'Morning Ride', points: main.points }, { id: 2, name: 'Loch Raven Loop', points: main.points.slice(0, 300) },
    { id: 3, name: 'Morning Ride', points: other.points }, { id: 4, name: 'Morning Ride', points: other.points }, { id: 5, name: 'Once', points: main.points.map(p => ({ lat: p.lat + 0.2, lng: p.lng })) }]);
  assert.strictEqual(r.length, 2, JSON.stringify(r.map(x => [x.name, x.rides])));
  assert.deepStrictEqual(r.map(x => [x.name, x.rides]).sort(), [['Loch Raven Loop', 2], ['Loop · 40 km', 2]]);
  assert.strictEqual(G.worldOf(-11.63, 166.96), 'Watopia');
  const flags = G.placeFlags(main, [dam], [], {});
  const tcx = G.tcxCourse(main, flags);
  assert.ok(/<CoursePoint><Name>Loch Raven<\/Name>/.test(tcx) && /<Track>/.test(tcx));
  assert.ok(/<PointType>Summit<\/PointType>/.test(tcx));
  const q = G.overpassQuery(main.points, 'line');
  assert.ok(/around:200/.test(q) && q.length < 40000, 'query size ' + q.length);
  assert.ok(/\(39\.397/.test(G.overpassQuery(main.points)), 'bbox by default');
  assert.deepStrictEqual(G.parsePois({ elements: [{ lat: 1, lon: 2, tags: { name: 'Hill', natural: 'peak' } }, { center: { lat: 3, lon: 4 }, tags: { name: 'Big Park', leisure: 'park' } }, { lat: 5, lon: 6, tags: { natural: 'peak' } }] }).map(p => p.kind), ['summit', 'park']);
});
console.log(n + ' passed');
