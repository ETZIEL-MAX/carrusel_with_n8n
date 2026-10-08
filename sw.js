// Service worker del carrusel público (TV). Build: __BUILD__
// - Imágenes subidas (/uploads/*): nombres únicos que nunca cambian -> cache-first.
// - Assets versionados (?v=hash): cache-first.
// - HTML del carrusel y la lista (/api/carrusel): red primero con respaldo en caché,
//   así la TV sigue mostrando el carrusel si se cae la conexión.
// - Lo que ya no está en ningún carrusel visto en esta pantalla se borra de la caché.
const BUILD = '__BUILD__';
const APP_CACHE = `carrusel-app-${BUILD}`;
const IMG_CACHE = 'carrusel-img-v1';
const META_CACHE = 'carrusel-meta-v1';
const MAX_IMAGES = 300; // tope de seguridad; lo normal es que mande la lista del carrusel
const NETWORK_TIMEOUT_MS = 5000;

const LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const old = keys.filter((k) => k.startsWith('carrusel-app-') && k !== APP_CACHE);
      await Promise.all(old.map((k) => caches.delete(k)));
      await self.clients.claim();
      // Este service worker reemplaza a uno anterior: las pantallas abiertas siguen con el
      // código viejo (que no sabe recargarse solo). Se recargan aquí, una vez.
      if (old.length > 0) {
        const pages = await self.clients.matchAll({ type: 'window' });
        await Promise.all(pages.map((page) => page.navigate(page.url).catch(() => {})));
      }
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
  if (res.status === 200 && res.type === 'basic') {
    await cache.put(request, res.clone());
    if (cacheName === IMG_CACHE) trim(IMG_CACHE, MAX_IMAGES);
  }
  return res;
}

async function networkFirst(request, cacheName, onFresh) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    if (res.ok) {
      await cache.put(request, res.clone());
      if (onFresh) onFresh(res.clone());
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (!hit) throw err;
    // Marca que es una copia guardada: la página no debe sacar de aquí la versión del sitio.
    const headers = new Headers(hit.headers);
    headers.set('X-From-Cache', '1');
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  }
}

// ==================== Limpieza según la lista del carrusel ====================
// Cada respuesta de /api/carrusel dice qué archivos usa ese carrusel. Se recuerda la
// última lista de cada uno y se borra de la caché lo que ya no usa ninguno.

async function rememberList(res, userId) {
  let items;
  try {
    const body = await res.json();
    items = (body && body.data && body.data.images) || [];
  } catch {
    return;
  }
  const paths = [];
  for (const item of items) {
    if (typeof item.url === 'string' && item.url.startsWith('/uploads/')) paths.push(item.url.split('?')[0].split('#')[0]);
  }
  const meta = await caches.open(META_CACHE);
  await meta.put(`/__sw/list/${userId}`, new Response(JSON.stringify({ at: Date.now(), paths })));

  const keep = new Set();
  for (const key of await meta.keys()) {
    const entry = await meta.match(key);
    const data = entry ? await entry.json().catch(() => null) : null;
    if (!data || Date.now() - data.at > LIST_MAX_AGE_MS) {
      await meta.delete(key);
      continue;
    }
    data.paths.forEach((p) => keep.add(p));
  }
  const cache = await caches.open(IMG_CACHE);
  for (const key of await cache.keys()) {
    if (!keep.has(new URL(key.url).pathname)) await cache.delete(key);
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.headers.has('range')) return;

  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request, IMG_CACHE));
    return;
  }

  if (url.searchParams.has('v')) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  } else if (url.pathname === '/api/carrusel') {
    const userId = (url.searchParams.get('userId') || '').toUpperCase();
    const onFresh = /^USER\d+$/.test(userId)
      ? (res) => event.waitUntil(rememberList(res, userId).catch(() => {}))
      : null;
    event.respondWith(networkFirst(request, APP_CACHE, onFresh));
  } else if (url.pathname.startsWith('/carrusel/')) {
    event.respondWith(networkFirst(request, APP_CACHE));
  }
});
