// Local-first shell cache. Data calls go network-first.
const SHELL = 'the-way-shell-v1';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c =>
    c.addAll(['/', '/index.html', '/app.js', '/styles.css'])));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (['/index.html','/','/app.js','/styles.css'].includes(u.pathname)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
