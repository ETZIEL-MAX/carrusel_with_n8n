// Service worker del carrusel público (TV). Build: __BUILD__
// - Imágenes subidas (/uploads/*): nombres únicos que nunca cambian -> cache-first.
// - Assets versionados (?v=hash): cache-first.
// - HTML del carrusel y la lista (/api/carrusel): red primero con respaldo en caché,
//   así la TV sigue mostrando el carrusel si se cae la conexión.
const BUILD = '__BUILD__';
const APP_CACHE = `carrusel-app-${BUILD}`;
const IMG_CACHE = 'carrusel-img-v1';
const MAX_IMAGES = 150;
const NETWORK_TIMEOUT_MS = 5000;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('carrusel-app-') && k !== APP_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic') {
    await cache.put(request, res.clone());
    if (cacheName === IMG_CACHE) trim(IMG_CACHE, MAX_IMAGES);
  }
  return res;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request, IMG_CACHE));
  } else if (url.searchParams.has('v')) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  } else if (url.pathname.startsWith('/carrusel/') || url.pathname === '/api/carrusel') {
    event.respondWith(networkFirst(request, APP_CACHE));
  }
});
