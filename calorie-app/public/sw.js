// Offline shell: the app opens with no signal (logging, search and your data all work). Network first so updates
// arrive as soon as you are online; the cache is only the fallback. OpenAI and Open Food Facts are never cached.
const CACHE = 'leanmode-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'local-api.js', 'local-storage.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'core/analyze.js', 'core/chat.js', 'core/match.js', 'core/nutrition.js', 'core/off.js', 'core/recipes.js', 'core/schemas.js', 'core/seed.js', 'core/foods.txt'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then((m) => m || caches.match('index.html'))),
  );
});
