// Service worker del carrusel público (TV). Build: __BUILD__
// - Imágenes subidas (/uploads/*): nombres únicos que nunca cambian -> cache-first.
// - Videos subidos: se guardan completos (si caben en el presupuesto del dispositivo) y
//   los trozos que pide el reproductor (Range) se responden desde esa copia. Así la TV
//   no vuelve a bajar el video en cada vuelta y lo sigue mostrando sin red.
// - Assets versionados (?v=hash): cache-first.
// - HTML del carrusel y la lista (/api/carrusel): red primero con respaldo en caché,
//   así la TV sigue mostrando el carrusel si se cae la conexión.
// - Lo que ya no está en ningún carrusel visto en esta pantalla se borra de la caché.
const BUILD = '__BUILD__';
const APP_CACHE = `carrusel-app-${BUILD}`;
const IMG_CACHE = 'carrusel-img-v1';
const VIDEO_CACHE = 'carrusel-video-v1';
const META_CACHE = 'carrusel-meta-v1';
const MAX_IMAGES = 300; // tope de seguridad; lo normal es que mande la lista del carrusel
const NETWORK_TIMEOUT_MS = 5000;

const MB = 1024 * 1024;
const VIDEO_PATH = /\.(mp4|mov|m4v|webm)$/i;
const VIDEO_MAX_FILE = 20 * MB; // un video más pesado no se guarda: se ve desde la red
const VIDEO_BUDGET_MAX = 150 * MB; // tope para todos los videos guardados
const VIDEO_BUDGET_SHARE = 0.4; // ...o el 40 % del espacio que da el dispositivo, lo que sea menor
const STORAGE_MARGIN = 20 * MB; // siempre se deja libre
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

// ==================== Video ====================

// Espacio que pueden ocupar los videos en este dispositivo (0 = no guardar ninguno).
async function videoBudget() {
  if (!self.navigator.storage || !self.navigator.storage.estimate) return { total: 0, free: 0 };
  try {
    const { quota = 0, usage = 0 } = await self.navigator.storage.estimate();
    return {
      total: Math.min(VIDEO_BUDGET_MAX, Math.floor(quota * VIDEO_BUDGET_SHARE)),
      free: Math.max(0, quota - usage - STORAGE_MARGIN),
    };
  } catch {
    return { total: 0, free: 0 };
  }
}

const cachedSize = (res) => Number(res.headers.get('content-length')) || 0;

const storing = new Set();

// Baja el video completo y lo guarda si cabe. Borra los más antiguos para hacer sitio.
async function storeVideo(path) {
  if (storing.has(path)) return;
  storing.add(path);
  try {
    const budget = await videoBudget();
    if (budget.total <= 0) return;

    const res = await fetch(path);
    const size = cachedSize(res);
    if (res.status !== 200 || !size || size > VIDEO_MAX_FILE || size > budget.total || size > budget.free) {
      if (res.body) res.body.cancel().catch(() => {});
      return;
    }

    const cache = await caches.open(VIDEO_CACHE);
    const entries = [];
    let used = 0;
    for (const key of await cache.keys()) {
      const hit = await cache.match(key);
      const bytes = hit ? cachedSize(hit) : 0;
      entries.push({ key, bytes });
      used += bytes;
    }
    while (used + size > budget.total && entries.length > 0) {
      const oldest = entries.shift(); // cache.keys() va en orden de llegada
      await cache.delete(oldest.key);
      used -= oldest.bytes;
    }
    await cache.put(path, res);
  } finally {
    storing.delete(path);
  }
}

// Responde (entero o el trozo pedido) desde la copia guardada.
async function fromStoredVideo(hit, rangeHeader) {
  const blob = await hit.blob();
  const size = blob.size;
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' };

  const range = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || '').trim());
  if (!range || (range[1] === '' && range[2] === '')) {
    return new Response(blob, { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
  }
  let start;
  let end = size - 1;
  if (range[1] === '') {
    start = Math.max(0, size - Number(range[2])); // bytes=-N: los últimos N
  } else {
    start = Number(range[1]);
    if (range[2] !== '') end = Math.min(Number(range[2]), size - 1);
  }
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, 'video/mp4'), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}

async function videoResponse(event, path) {
  const cache = await caches.open(VIDEO_CACHE);
  const hit = await cache.match(path);
  if (hit) return fromStoredVideo(hit, event.request.headers.get('range'));
  // Primera vez: se reproduce desde la red y, aparte, se guarda para las siguientes.
  event.waitUntil(storeVideo(path).catch(() => {}));
  return fetch(event.request);
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
    for (const value of [item.url, item.poster]) {
      if (typeof value === 'string' && value.startsWith('/uploads/')) paths.push(value.split('?')[0].split('#')[0]);
    }
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
  for (const name of [IMG_CACHE, VIDEO_CACHE]) {
    const cache = await caches.open(name);
    for (const key of await cache.keys()) {
      if (!keep.has(new URL(key.url).pathname)) await cache.delete(key);
    }
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/uploads/')) {
    if (VIDEO_PATH.test(url.pathname)) event.respondWith(videoResponse(event, url.pathname));
    else if (!request.headers.has('range')) event.respondWith(cacheFirst(request, IMG_CACHE));
    return;
  }
  if (request.headers.has('range')) return;

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
