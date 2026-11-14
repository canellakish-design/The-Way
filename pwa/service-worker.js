// The Way — service worker v44. Network-first, and it only caches genuine
// successes of the right content type.
const SHELL = "the-way-shell-v260";   // bumped whenever the shell changes, so a held copy is dropped on activate
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  const shellPaths = ["/", "/index.html", "/app.js", "/plan.js", "/food.js", "/links.js", "/coach.js", "/ride.js", "/flags.js", "/voice.js", "/face.js", "/fit.js", "/buckets.js", "/light.js", "/edge.js", "/player.js", "/styles.css", "/pages-app.css", "/pages-food.css", "/pages-ride.css", "/pages-calendar.css", "/pages-player.css"];
  if (shellPaths.includes(u.pathname)) {
    e.respondWith(fetch(e.request).then(r => {
      // Only cache a real success. A 404 page, or the API function answering
      // for /app.js during a bad deploy, would otherwise be cached and served
      // as the app itself — a blank page that survives reloads.
      const type = r.headers.get("content-type") || "";
      const cacheable = r.ok && r.status === 200
        && (/\.css$/.test(u.pathname) ? type.includes("css")
          : (u.pathname === "/app.js" || u.pathname === "/plan.js" || u.pathname === "/food.js" || u.pathname === "/links.js" || u.pathname === "/coach.js" || u.pathname === "/ride.js" || u.pathname === "/flags.js" || u.pathname === "/voice.js" || u.pathname === "/face.js" || u.pathname === "/fit.js" || u.pathname === "/buckets.js" || u.pathname === "/light.js" || u.pathname === "/edge.js" || u.pathname === "/player.js") ? type.includes("javascript")
          : type.includes("html"));
      if (cacheable) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request)));
  }
});

// Reminders (bridge/push.js): each supplement and medicine at its time. "Taken" logs every item in the
// notification without opening the app; tapping the notification itself (the only choice on an iPhone,
// where notifications carry no buttons) opens a one-tap "Taken" page.
const API = "/.netlify/functions/api";
self.addEventListener("push", e => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch (err) { p = { title: "The Way", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(p.title || "The Way", {
    body: p.body || "", tag: p.tag || "way", renotify: true, requireInteraction: true,
    icon: "icon-192.png", badge: "icon-192.png",
    data: { items: p.items || [], url: p.url || "/#today" },
    actions: (p.items || []).length ? [{ action: "taken", title: "Taken" }] : []
  }));
});
const logItem = it => fetch(API + (it.kind === "med" ? "/meds/taken" : "/food/supplement"), {
  method: "POST", headers: { "Content-Type": "application/json", "x-the-way-app": "1" }, body: JSON.stringify({ key: it.key }) });
self.addEventListener("notificationclick", e => {
  const d = e.notification.data || {}; e.notification.close();
  if (e.action === "taken"){ e.waitUntil(Promise.all((d.items || []).map(logItem)).catch(() => {})); return; }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const url = d.url || "/#today", open = list.find(c => "focus" in c);
    if (open) return open.focus().then(c => (c && c.navigate) ? c.navigate(url) : c);
    return self.clients.openWindow(url);
  }));
});
