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

// El carrusel solo carga la diapositiva actual y sus dos vecinas (memoria de la TV).
// "Listo" = todas las que tienen `src` están completas y visibles.
const allLoaded = (page) =>
  page.evaluate(() => {
    const imgs = [...document.querySelectorAll('.slide img')].filter((i) => i.getAttribute('src'));
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0 && i.classList.contains('is-loaded'));
  });
const loadedIndexes = (page) =>
  page.locator('.slide img').evaluateAll((els) =>
    els.filter((e) => e.getAttribute('src')).map((e) => Number(e.closest('.slide').dataset.index)));

test('el carrusel carga todas las imágenes completas y sin errores', async ({ page }) => {
  const w = watchPage(page);
  await page.goto('/carrusel/USER1');
  await expect(page.locator('.slide')).toHaveCount(4);
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);

  // Las subidas grandes se guardan como WebP
  const srcs = await page.locator('.slide img').evaluateAll((els) => els.map((e) => e.dataset.src));
  for (const s of srcs) expect(s).toMatch(/^\/uploads\/[\w.-]+\.webp$/);

  // De 4 diapositivas solo están cargadas la actual (0), la siguiente (1) y la anterior (3)
  expect(await loadedIndexes(page)).toEqual([0, 1, 3]);
  // Al avanzar, la ventana se mueve: entra la 2 y se suelta la 3
  await page.locator('.dot[data-index="1"]').click();
  await expect.poll(() => loadedIndexes(page)).toEqual([0, 1, 2]);
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);
  expect(await page.locator('.slide[data-index="3"] img').evaluate((e) => e.classList.contains('is-loaded'))).toBe(false);

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
  const expected = [
    // horizontal: cubre en pantalla horizontal, se ve completa (contain) en vertical
    portraitScreen ? 'fit-contain' : 'fit-cover',
    // vertical: al revés
    portraitScreen ? 'fit-cover' : 'fit-contain',
    // "Girar 90°"
    'is-rotated',
    // cuadrado: proporción muy distinta a la pantalla en todos los casos => se ve completo
    'fit-contain',
  ];

  const vp = page.viewportSize();
  for (let i = 0; i < 4; i++) {
    await page.locator(`.dot[data-index="${i}"]`).click();
    const img = page.locator(`.slide[data-index="${i}"] img`);
    await expect(page.locator(`.slide[data-index="${i}"]`)).toHaveClass(/is-active/);
    await expect(img).toHaveClass(/is-loaded/); // el ajuste se decide al cargar cada imagen
    expect(await img.getAttribute('class')).toContain(expected[i]);
    // Si la imagen se ve completa, lo que sobra se rellena con ella misma difuminada (no negro)
    const bg = page.locator(`.slide[data-index="${i}"] .slide__bg`);
    const bgImage = await bg.evaluate((el) => getComputedStyle(el).backgroundImage);
    if (expected[i] === 'fit-contain') {
      expect(bgImage).toContain(await img.evaluate((el) => el.dataset.src));
      expect(await bg.evaluate((el) => getComputedStyle(el).filter)).toContain('blur');
    } else {
      expect(bgImage).toBe('none');
    }
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

test('el fondo difuminado se quita cuando la imagen sale de la ventana de carga', async ({ page }) => {
  await page.goto('/carrusel/USER1');
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);
  // Estando en la 0 están cargadas la 0, la 1 y la 3. La 3 (cuadrada) siempre se ve completa.
  expect(await loadedIndexes(page)).toEqual([0, 1, 3]);
  const bg3 = page.locator('.slide[data-index="3"] .slide__bg');
  expect(await bg3.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe('none');
  // Al avanzar a la 1, la 3 sale de la ventana: pierde su imagen y también su fondo
  await page.locator('.dot[data-index="1"]').click();
  await expect.poll(() => loadedIndexes(page)).toEqual([0, 1, 2]);
  expect(await bg3.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
  // La 2 entró a la ventana pero está girada: llena la pantalla y no necesita fondo
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);
  expect(await page.locator('.slide[data-index="2"] .slide__bg').evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
});

test('el carrusel arranca desde la última lista guardada', async ({ page }) => {
  await page.goto('/carrusel/USER1');
  await expect.poll(() => allLoaded(page), { timeout: 20_000 }).toBe(true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('carrusel:last:USER1') || '[]').length);
  expect(saved).toBe(4);
});

// Lista simulada (sin service worker) para medir el tiempo de cada diapositiva.
test.describe('duración por imagen', () => {
  // El resto de la suite usa reducedMotion (autoplay pausado); aquí hace falta que avance.
  test.use({ serviceWorkers: 'block', reducedMotion: 'no-preference' });

  test('cada imagen dura lo suyo; el resto usa la del carrusel', async ({ page }) => {
    const images = IMAGES.slice(0, 3).map((img, i) => ({
      id: `dur-${i}`, url: img.url, alt: '', order: i, view: 'auto', duration: i === 0 ? 2 : null,
    }));
    await page.route('**/api/carrusel?*', (route) =>
      route.fulfill({ json: { success: true, data: { images, slideDuration: 30 } } }));
    await page.goto('/carrusel/USER1');
    await expect(page.locator('.slide')).toHaveCount(3);
    await expect(page.locator('.slide[data-index="0"]')).toHaveClass(/is-active/);

    // La primera dura 2 s (propia): cambia mucho antes que los 30 s del carrusel.
    await expect(page.locator('.slide[data-index="1"]')).toHaveClass(/is-active/, { timeout: 5000 });
    // La segunda no tiene duración propia: usa los 30 s, así que sigue activa.
    await page.waitForTimeout(4000);
    await expect(page.locator('.slide[data-index="1"]')).toHaveClass(/is-active/);
    // La barra avanza por CSS (escala): se mide lo que ocupa respecto a su pista.
    const pct = await page.locator('#progressFill').evaluate((el) =>
      (el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width) * 100);
    expect(pct).toBeGreaterThan(5);
    expect(pct).toBeLessThan(40);
  });
});
