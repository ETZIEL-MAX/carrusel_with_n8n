import { test, expect } from '@playwright/test';
import { uploadPoster, setCarousel } from './helpers.js';

test('HTML con assets versionados, no-cache y 304 por ETag', async ({ request }) => {
  const res = await request.get('/admin');
  const html = await res.text();
  expect(res.headers()['cache-control']).toBe('no-cache');
  expect(html).toMatch(/src="\/admin\.js\?v=[0-9a-f]{10}"/);
  expect(html).toMatch(/src="\/api\.js\?v=[0-9a-f]{10}"/);
  expect(html).toMatch(/href="\/styles\.css\?v=[0-9a-f]{10}"/);
  const etag = res.headers()['etag'];
  expect(etag).toBeTruthy();
  const again = await request.get('/admin', { headers: { 'If-None-Match': etag } });
  expect(again.status()).toBe(304);

  const carrusel = await (await request.get('/carrusel/USER1')).text();
  expect(carrusel).toMatch(/src="\/carousel\.js\?v=[0-9a-f]{10}"/);
});

test('asset con hash correcto es immutable; sin hash o con hash viejo, no-cache', async ({ request }) => {
  const html = await (await request.get('/admin')).text();
  const v = html.match(/admin\.js\?v=([0-9a-f]{10})/)[1];
  expect((await request.get(`/admin.js?v=${v}`)).headers()['cache-control']).toContain('immutable');
  expect((await request.get('/admin.js')).headers()['cache-control']).toBe('no-cache');
  expect((await request.get('/admin.js?v=0000000000')).headers()['cache-control']).toBe('no-cache');
});

test('imágenes immutable y API no-store', async ({ request }) => {
  const url = await uploadPoster(request, 'USER1', { label: 'CACHE' });
  expect((await request.get(url)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await request.get('/api/carrusel?userId=USER1')).headers()['cache-control']).toBe('no-store');
});

test('service worker: versión inyectada y registrado en /carrusel/', async ({ page, request }) => {
  const sw = await request.get('/sw.js');
  expect(sw.headers()['cache-control']).toBe('no-cache');
  const src = await sw.text();
  expect(src).not.toContain('__BUILD__');

  await page.goto('/carrusel/USER1');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/carrusel\/$/);
});

test('sin red, el carrusel sigue mostrando las imágenes (TV)', async ({ page, context, request }) => {
  const a = await uploadPoster(request, 'USER1', { label: 'OFFLINE A', color: '#0ea5e9' });
  const b = await uploadPoster(request, 'USER1', { label: 'OFFLINE B', color: '#f59e0b' });
  await setCarousel(request, 'USER1', [{ url: a, order: 0 }, { url: b, order: 1 }]);

  await page.goto('/carrusel/USER1');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // ahora controlada por el SW: se llenan las cachés
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('.slide img')].every((i) => i.complete && i.naturalWidth > 0)))
    .toBe(true);
  await page.waitForTimeout(500);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.slide')).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll('.slide img')].every((i) => i.complete && i.naturalWidth > 0)))
    .toBe(true);
  await context.setOffline(false);
});
