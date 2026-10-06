import { test, expect } from '@playwright/test';
import { uploadPoster, setCarousel, watchPage } from './helpers.js';

// Tres pósters: horizontal, vertical y uno horizontal marcado "Girar 90°".
let IMAGES = [];

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  const h = await uploadPoster(api, 'USER1', { w: 1920, h: 1080, label: 'HORIZONTAL', color: '#1e66f5' });
  const v = await uploadPoster(api, 'USER1', { w: 1080, h: 1920, label: 'VERTICAL', color: '#16a34a' });
  const r = await uploadPoster(api, 'USER1', { w: 1920, h: 1080, label: 'GIRADA', color: '#dc2626' });
  const q = await uploadPoster(api, 'USER1', { w: 1080, h: 1080, label: 'CUADRADO', color: '#ca8a04' });
  IMAGES = [
    { url: h, alt: 'horizontal', order: 0 },
    { url: v, alt: 'vertical', order: 1 },
    { url: r, alt: 'girada', order: 2, view: 'rotate' },
    { url: q, alt: 'cuadrado', order: 3 },
  ];
  await setCarousel(api, 'USER1', IMAGES);
  await api.dispose();
});

const allLoaded = (page) =>
  page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.slide img')];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0 && i.classList.contains('is-loaded'));
  });

test('el carrusel carga todas las imágenes completas y sin errores', async ({ page }) => {
  const w = watchPage(page);
  await page.goto('/carrusel/USER1');
  await expect(page.locator('.slide')).toHaveCount(4);
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);

  // Las subidas grandes se guardan como WebP
  const srcs = await page.locator('.slide img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  for (const s of srcs) expect(s).toMatch(/^\/uploads\/[\w.-]+\.webp$/);

  // Sin scroll horizontal (nada se sale de la pantalla)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  expect(w.problems, w.problems.join('\n')).toEqual([]);
  expect(await w.csp()).toEqual([]);
});

test('cada imagen se ajusta según su orientación y la de la pantalla', async ({ page }, testInfo) => {
  await page.goto('/carrusel/USER1');
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);

  const portraitScreen = await page.evaluate(() => matchMedia('(orientation: portrait)').matches);
  const cls = await page.locator('.slide img').evaluateAll((els) => els.map((e) => e.className));

  // horizontal: cubre en pantalla horizontal, se ve completa (contain) en vertical
  expect(cls[0]).toContain(portraitScreen ? 'fit-contain' : 'fit-cover');
  // vertical: al revés
  expect(cls[1]).toContain(portraitScreen ? 'fit-cover' : 'fit-contain');
  // "Girar 90°"
  expect(cls[2]).toContain('is-rotated');
  // cuadrado: proporción muy distinta a la pantalla en todos los casos => se ve completo
  expect(cls[3]).toContain('fit-contain');

  const vp = page.viewportSize();
  for (let i = 0; i < 4; i++) {
    await page.locator(`.dot[data-index="${i}"]`).click();
    const img = page.locator(`.slide[data-index="${i}"] img`);
    await expect(page.locator(`.slide[data-index="${i}"]`)).toHaveClass(/is-active/);
    await page.waitForTimeout(1300); // fundido terminado
    // La imagen activa ocupa toda la pantalla (también la girada)
    const box = await img.boundingBox();
    expect(Math.abs(box.width - vp.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.height - vp.height)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y)).toBeLessThanOrEqual(2);
    const shot = testInfo.outputPath(`slide-${i}.png`);
    await page.screenshot({ path: shot });
    await testInfo.attach(`slide-${i}-${testInfo.project.name}`, { path: shot, contentType: 'image/png' });
  }
});

test('el carrusel arranca desde la última lista guardada', async ({ page }) => {
  await page.goto('/carrusel/USER1');
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carrusel:last:USER1') || '[]').length);
  expect(saved).toBe(4);
});
