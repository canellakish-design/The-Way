"use strict";
/* THE WAY — the course on a map (course mode, Harry 26 Nov 2026). Free sources only, no key, no account:
     - MapLibre GL JS 4.7.1 (BSD-3-Clause), stored with the site in pwa/vendor/maplibre, nothing loaded from a provider
     - the topo map: OpenTopoMap tiles (CC-BY-SA; credit opentopomap.org and OpenStreetMap). If they fail (the service
       may close), the same style from OpenMaps.fr (OpenTopoMap-R, free for non-commercial use), with its own credit
     - 3D: AWS Terrain Tiles (Terrarium PNG, AWS Open Data, no account), with their credit line
   The route is drawn on it, the part ridden darker, and an arrow at his place pointing the way the road goes. In 2D
   the map stays north up and follows him; in 3D the camera rides behind and above him, facing up the road.
   The map only draws: it never touches the trainer or the ride. If it can't start (no WebGL), the ride goes on.
   The street photo (Mapillary) is off until Harry enters his own token: it is his account, free, and the photo
   comes straight from Mapillary to this browser. It fails quietly and never gets in the way of the ride. */
(function(root){
  const TOPO = { id: "opentopomap", tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"], maxzoom: 17,
    attribution: 'Map: © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC-BY-SA</a>) · Data: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>' };
  const TOPO_BACKUP = { id: "openmaps", tiles: ["https://tile.openmaps.fr/opentopomap/{z}/{x}/{y}.png"], maxzoom: 17,
    attribution: '<a href="https://github.com/sletuffe/OpenTopoMap" target="_blank" rel="noopener">© OpenTopoMap-R</a> <a href="https://openmaps.fr/donate" target="_blank" rel="noopener">❤ Donation</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>' };
  const TERRAIN = { tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"], maxzoom: 15, encoding: "terrarium",
    attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a>, AWS Open Data (<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">sources</a>)' };
  const ARROW = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="rgba(0,0,0,.35)"/><path d="M20 4 L31 32 L20 26 L9 32 Z" fill="#FFD400" stroke="#111" stroke-width="2.2" stroke-linejoin="round"/></svg>`;

  // the line of the course, thinned to at most ~1500 points (the map doesn't need every 10 m)
  function lineOf(C, upTo){
    const n = C.lat.length, step = Math.max(1, Math.ceil(n / 1500)), out = [];
    const last = upTo == null ? n - 1 : Math.max(0, Math.min(n - 1, upTo));
    for (let k = 0; k <= last; k += step) out.push([C.lon[k], C.lat[k]]);
    if (out.length && (out[out.length - 1][0] !== C.lon[last] || out[out.length - 1][1] !== C.lat[last])) out.push([C.lon[last], C.lat[last]]);
    if (out.length === 1) out.push(out[0]);
    return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: out } };
  }
  const bounds = C => { let a = 180, b = 90, c = -180, d = -90; for (let k = 0; k < C.lat.length; k++){ a = Math.min(a, C.lon[k]); c = Math.max(c, C.lon[k]); b = Math.min(b, C.lat[k]); d = Math.max(d, C.lat[k]); } return [[a, b], [c, d]]; };
  const turn = (from, to, f) => { let d = ((to - from + 540) % 360) - 180; return (from + d * f + 360) % 360; };

  // el: the box; C: the course (pwa/course.js); o: { view: "2d" | "3d", follow: true, onError(msg) }
  function create(el, C, o){
    const opt = Object.assign({ view: "2d", follow: true }, o || {});
    const ML = root.maplibregl;
    const api = { ok: false, view: opt.view, source: TOPO.id, errors: 0, update(){}, setView(){}, destroy(){}, fit(){} };
    if (!ML){ el.innerHTML = `<div class="cm-off small">The map library didn't load, so there is no map. The ride is not affected.</div>`; return api; }
    let map;
    try{
      if (ML.supported && !ML.supported()) throw new Error("this computer can't draw WebGL maps");
      map = new ML.Map({ container: el, attributionControl: false, pitchWithRotate: true, maxPitch: 75, center: [C.lon[0], C.lat[0]], zoom: 12,
        style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#e9e6dc" } }] } });
    }catch(e){ el.innerHTML = `<div class="cm-off small">No map on this computer (${String(e.message || e).slice(0, 80)}). The ride is not affected: the profile below still shows where you are.</div>`; if (opt.onError) opt.onError(e.message); return api; }
    api.ok = true; api.map = map;
    const attrib = new ML.AttributionControl({ compact: false });
    map.addControl(attrib, "bottom-right");
    map.addControl(new ML.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    const el2 = document.createElement("div"); el2.className = "cm-arrow"; el2.innerHTML = ARROW;
    const marker = new ML.Marker({ element: el2, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat([C.lon[0], C.lat[0]]);
    let lastX = 0, camBearing = 0, ready = false, pending = null;

    function addTopo(src){
      if (map.getLayer("topo")) map.removeLayer("topo");
      if (map.getSource("topo")) map.removeSource("topo");
      map.addSource("topo", { type: "raster", tiles: src.tiles, tileSize: 256, maxzoom: src.maxzoom, attribution: src.attribution });
      map.addLayer({ id: "topo", type: "raster", source: "topo" }, map.getLayer("route-casing") ? "route-casing" : undefined);
      api.source = src.id;
    }
    // OpenTopoMap first; after a run of failed tiles and none loaded, the OpenMaps.fr copy of the same map
    let topoLoaded = 0;
    map.on("sourcedata", e => { if (e.sourceId === "topo" && e.tile && e.isSourceLoaded !== undefined) topoLoaded++; });
    map.on("error", e => {
      const id = e && e.sourceId;
      if (id === "topo"){ api.errors++; if (api.source === TOPO.id && api.errors >= 6 && topoLoaded < 2){ api.errors = 0; addTopo(TOPO_BACKUP); } }
    });
    map.on("load", () => {
      addTopo(TOPO);
      map.addSource("terrain", { type: "raster-dem", tiles: TERRAIN.tiles, tileSize: 256, maxzoom: TERRAIN.maxzoom, encoding: TERRAIN.encoding, attribution: TERRAIN.attribution });
      map.addSource("route", { type: "geojson", data: lineOf(C) });
      map.addSource("done", { type: "geojson", data: lineOf(C, 0) });
      map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 8, "line-opacity": 0.9 } });
      map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#E8432E", "line-width": 4.5 } });
      map.addLayer({ id: "done", type: "line", source: "done", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#6B1A10", "line-width": 4.5 } });
      marker.addTo(map);
      ready = true;
      setView(api.view, true);
      if (pending != null){ const x = pending; pending = null; update(x, true); }
    });
    function setView(v, first){
      api.view = v === "3d" ? "3d" : "2d";
      if (!ready) return;
      try{ map.setTerrain(api.view === "3d" ? { source: "terrain", exaggeration: 1.4 } : null); }catch(e){ /* terrain unavailable: stay flat */ api.view = "2d"; }
      if (api.view === "2d"){ map.easeTo({ pitch: 0, bearing: 0, duration: first ? 0 : 600 }); if (first) map.fitBounds(bounds(C), { padding: 40, duration: 0 }); }
      update(lastX, true);
    }
    function update(x, now){
      lastX = x;
      if (!ready){ pending = x; return; }
      const p = root.Course.posAt(C, x), h = root.Course.headingAt(C, x);
      marker.setLngLat([p.lon, p.lat]).setRotation(h);
      const k = root.Course.locate(C, x).k;
      const src = map.getSource("done"); if (src && (now || k % 5 === 0)) src.setData(lineOf(C, k));
      if (!opt.follow) return;
      if (api.view === "3d"){
        camBearing = now ? h : turn(camBearing, h, 0.25);
        map.easeTo({ center: [p.lon, p.lat], bearing: camBearing, pitch: 62, zoom: 14.6, duration: now ? 0 : 950, easing: t => t });
      } else {
        map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 13.5), duration: now ? 0 : 950, easing: t => t });
      }
    }
    api.update = update; api.setView = setView;
    api.fit = () => { if (ready) map.fitBounds(bounds(C), { padding: 40, duration: 0 }); };
    api.destroy = () => { try{ map.remove(); }catch{} };
    return api;
  }

  // ---------- the street photo (Mapillary): off unless Harry has entered his own token ----------
  // Every 30 s: the nearest image within about 60 m of his place on the course. Credit under it, as Mapillary asks:
  // "Images from Mapillary, CC BY-SA, by @username". Nothing found, or Mapillary slow or down: the last photo stays,
  // or a quiet line; the ride never waits for it.
  function photo(el, token){
    const api = { on: !!token, last: null, update(){} };
    if (!token){ el.hidden = true; return api; }
    el.hidden = false; el.innerHTML = `<div class="cm-ph-none small">Street photo: looking…</div>`;
    let busy = false, at = 0;
    api.update = async (lat, lon, force) => {
      const t = Date.now();
      if (busy || (!force && t - at < 30000)) return;
      busy = true; at = t;
      try{
        const r = 0.0006, bbox = [lon - r, lat - r * 0.75, lon + r, lat + r * 0.75].map(v => v.toFixed(6)).join(",");
        const u = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,thumb_1024_url,captured_at,creator,computed_geometry&bbox=${bbox}&limit=20`;
        const ctl = typeof AbortController === "function" ? new AbortController() : null; const tm = setTimeout(() => ctl && ctl.abort(), 8000);
        const res = await fetch(u, ctl ? { signal: ctl.signal } : {}); clearTimeout(tm);
        if (!res.ok) throw new Error("Mapillary " + res.status);
        const j = await res.json(); const xs = (j && j.data) || [];
        const d2 = g => { const c = g && g.computed_geometry && g.computed_geometry.coordinates; return c ? (c[0] - lon) ** 2 + (c[1] - lat) ** 2 : 1; };
        const best = xs.filter(x => x.thumb_1024_url).sort((a, b) => d2(a) - d2(b))[0];
        if (!best){ if (!api.last) el.innerHTML = `<div class="cm-ph-none small">No street photo near here.</div>`; return; }
        if (api.last && api.last.id === best.id) return;
        api.last = best;
        const who = best.creator && best.creator.username ? best.creator.username : "a Mapillary contributor";
        el.innerHTML = `<img src="${best.thumb_1024_url}" alt="Street-level photo near this point of the course" loading="lazy">
          <div class="cm-ph-credit small">Images from <a href="https://www.mapillary.com/app/?pKey=${encodeURIComponent(best.id)}" target="_blank" rel="noopener">Mapillary</a>, <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA</a>, by @${String(who).replace(/[<>&"]/g, "")}</div>`;
      }catch(e){ if (!api.last) el.innerHTML = `<div class="cm-ph-none small">Street photo unavailable right now.</div>`; }
      finally{ busy = false; }
    };
    return api;
  }

  root.CourseMap = { create, photo, lineOf, TOPO, TOPO_BACKUP, TERRAIN };
})(typeof window !== "undefined" ? window : this);
