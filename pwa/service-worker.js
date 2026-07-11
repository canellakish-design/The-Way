// The Way — service worker v2. Network-first: updates always land.
const SHELL = "the-way-shell-v2";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  const shellPaths = ["/", "/index.html", "/app.js", "/styles.css"];
  if (shellPaths.includes(u.pathname)) {
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(SHELL).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request)));
  }
});
