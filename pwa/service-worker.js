// The Way player — service worker. Network-first; a copy of the page is kept for when the network drops, and only
// genuine successes of the right content type are kept. (26 Nov 2026: the site is only the workout player; the
// push reminders and the 3D coach's cache went with the rest of the site.)
const SHELL = "the-way-player-v2";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const SHELL_PATHS = ["/", "/index.html", "/shell.js", "/fit.js", "/buckets.js", "/edge.js", "/player.js", "/player-test.html", "/styles.css", "/pages-player.css", "/course.js", "/course-map.js", "/vendor/maplibre/maplibre-gl.js", "/vendor/maplibre/maplibre-gl.css"];
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin || !SHELL_PATHS.includes(u.pathname)) return;
  e.respondWith(fetch(e.request).then(r => {
    const type = r.headers.get("content-type") || "";
    const want = /\.css$/.test(u.pathname) ? "css" : /\.js$/.test(u.pathname) ? "javascript" : "html";
    if (r.ok && r.status === 200 && type.includes(want)) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
