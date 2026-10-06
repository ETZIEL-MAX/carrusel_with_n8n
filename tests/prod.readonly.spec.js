// Pruebas SOLO LECTURA contra producción (PROD=1). No hace login ni escribe nada.
import { test, expect } from '@playwright/test';
import { watchPage } from './helpers.js';

test('carrusel público: todas las imágenes cargan completas y sin errores', async ({ page }) => {
  const w = watchPage(page);
  await page.goto('/carrusel/USER1');
  await expect(page.locator('.slide').first()).toBeAttached();
  await expect
    .poll(
      () => page.evaluate(() => {
        const imgs = [...document.querySelectorAll('.slide img')];
        return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0 && i.classList.contains('is-loaded'));
      }),
      { timeout: 45_000 }
    )
    .toBe(true);

  // La imagen activa ocupa toda la pantalla
  const box = await page.locator('.slide.is-active img').boundingBox();
  const vp = page.viewportSize();
  expect(Math.abs(box.width - vp.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - vp.height)).toBeLessThanOrEqual(2);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(w.problems, w.problems.join('\n')).toEqual([]);
  expect(await w.csp()).toEqual([]);
  await test.info().attach('carrusel-prod', { body: await page.screenshot(), contentType: 'image/png' });
});

test('headers de seguridad en producción', async ({ request }) => {
  const h = (await request.get('/admin')).headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['strict-transport-security']).toContain('max-age=31536000');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
});

test('caché: HTML no-cache con assets versionados immutable; imágenes WebP immutable; API no-store', async ({ request }) => {
  const res = await request.get('/carrusel/USER1');
  expect(res.headers()['cache-control']).toBe('no-cache');
  const html = await res.text();
  const v = html.match(/carousel\.js\?v=([0-9a-f]{10})/);
  expect(v).toBeTruthy();
  expect((await request.get(`/carousel.js?v=${v[1]}`)).headers()['cache-control']).toContain('immutable');

  const api = await request.get('/api/carrusel?userId=USER1');
  expect(api.headers()['cache-control']).toBe('no-store');
  const imgs = (await api.json()).data.images;
  const webp = imgs.find((i) => /\.webp$/.test(i.url));
  expect(webp, 'hay imágenes en WebP').toBeTruthy();
  const img = await request.get(webp.url);
  expect(img.headers()['content-type']).toBe('image/webp');
  expect(img.headers()['cache-control']).toContain('immutable');
});

test('archivos internos no expuestos', async ({ request }) => {
  for (const p of ['/package.json', '/.env', '/.env.prod', '/docker-compose.yml', '/Dockerfile', '/scripts/server.mjs', '/api/_utils.js']) {
    expect((await request.get(p)).status(), p).toBe(404);
  }
});

test('página de login carga sin errores', async ({ page }) => {
  const w = watchPage(page);
  await page.goto('/admin');
  await expect(page.locator('#loginView')).toBeVisible();
  await expect(page.locator('#adminLoginForm')).toBeVisible();
  expect(w.problems, w.problems.join('\n')).toEqual([]);
  expect(await w.csp()).toEqual([]);
});
