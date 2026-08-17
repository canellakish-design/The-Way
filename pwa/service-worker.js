// The Way — service worker v7. Network-first, and it only caches genuine
// successes of the right content type.
const SHELL = "the-way-shell-v7";   // bumped whenever the shell changes, so a held copy is dropped on activate
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
      // Only cache a real success. A 404 page, or the API function answering
      // for /app.js during a bad deploy, would otherwise be cached and served
      // as the app itself — a blank page that survives reloads.
      const type = r.headers.get("content-type") || "";
      const cacheable = r.ok && r.status === 200
        && (u.pathname === "/styles.css" ? type.includes("css")
          : u.pathname === "/app.js" ? type.includes("javascript")
          : type.includes("html"));
      if (cacheable) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request)));
  }
});
