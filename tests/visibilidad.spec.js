import { test, expect } from '@playwright/test';
import { uiLogin, uploadPoster, setCarousel, watchPage } from './helpers.js';

// Suspender, programar y difuminado por imagen, desde el panel del cliente.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  const a = await uploadPoster(api, 'USER1', { label: 'PROMO A', color: '#0ea5e9' });
  const b = await uploadPoster(api, 'USER1', { label: 'PROMO B', color: '#f59e0b' });
  await setCarousel(api, 'USER1', [{ url: a, alt: 'Promo A', order: 0 }, { url: b, alt: 'Promo B', order: 1 }]);
  await api.dispose();
});

const publicas = async (page) => (await (await page.request.get('/api/carrusel?userId=USER1')).json()).data.images;
const guardadas = async (page) => (await (await page.request.get('/api/images')).json()).data.images;

test('suspender una imagen la quita del carrusel sin borrarla; reactivarla la devuelve', async ({ page }) => {
  const w = watchPage(page);
  await uiLogin(page);
  await expect(page.locator('#userGrid .image-card')).toHaveCount(2);
  const card = page.locator('#userGrid .image-card').first();

  await card.locator('[data-action="suspend"]').click();
  await expect(card).toHaveClass(/is-suspended/);
  await expect(card.locator('.image-card__tags')).toContainText('Suspendida');
  await expect(card.locator('[data-action="suspend"]')).toHaveAttribute('aria-label', 'Reactivar');
  expect((await publicas(page)).map((i) => i.alt)).toEqual(['Promo B']);
  await expect(page.locator('#userGrid .image-card')).toHaveCount(2); // sigue en el panel

  await card.locator('[data-action="suspend"]').click();
  await expect(card).not.toHaveClass(/is-suspended/);
  await expect(card.locator('[data-action="suspend"]')).toHaveAttribute('aria-label', 'Suspender');
  expect((await publicas(page)).map((i) => i.alt)).toEqual(['Promo A', 'Promo B']);

  expect(w.problems, w.problems.join('\n')).toEqual([]);
  expect(await w.csp()).toEqual([]);
});

test('programar por días y fechas y encender el difuminado desde «Editar imagen»', async ({ page }, testInfo) => {
  const w = watchPage(page);
  await uiLogin(page);
  const card = page.locator('#userGrid .image-card').first();
  await card.locator('[data-action="edit"]').click();
  await expect(page.locator('#imgModalBackdrop')).toHaveClass(/is-open/);

  // Una imagen nueva: sin difuminado, sin suspender y «siempre»
  await expect(page.locator('#imgBlur')).not.toBeChecked();
  await expect(page.locator('#imgSuspended')).not.toBeChecked();
  await expect(page.locator('#imgDaysSeg .seg__btn.is-active')).toHaveCount(0);

  await page.locator('#imgBlur').check();
  await page.locator('#imgDaysSeg [data-day="5"]').click();
  await page.locator('#imgDaysSeg [data-day="1"]').click();
  await page.locator('#imgDaysSeg [data-day="1"]').click(); // se puede desmarcar
  await page.fill('#imgFrom', '2020-01-01');
  await page.fill('#imgTo', '2020-12-31');
  await page.screenshot({ path: testInfo.outputPath('modal.png') });
  await page.click('#imgSaveBtn');
  await expect(page.locator('#imgModalBackdrop')).not.toHaveClass(/is-open/);

  let img = (await guardadas(page))[0];
  expect(img.blur).toBe(true);
  expect(img.schedule).toEqual({ days: [5], from: '2020-01-01', to: '2020-12-31' });
  await expect(card.locator('.image-card__tags')).toContainText('Solo vie');
  await expect(card.locator('.image-card__tags')).toContainText('1 ene 2020 – 31 dic 2020');
  await expect(card.locator('.image-card__tags')).toContainText('Hoy no se muestra');
  await expect(card.locator('.image-card__tags')).toContainText('Difuminado');
  await card.screenshot({ path: testInfo.outputPath('tarjeta.png') });
  expect((await publicas(page)).map((i) => i.alt)).toEqual(['Promo B']);

  // Al volver a abrir, recuerda todo
  await card.locator('[data-action="edit"]').click();
  await expect(page.locator('#imgBlur')).toBeChecked();
  await expect(page.locator('#imgDaysSeg [data-day="5"]')).toHaveClass(/is-active/);
  await expect(page.locator('#imgDaysSeg .seg__btn.is-active')).toHaveCount(1);
  await expect(page.locator('#imgFrom')).toHaveValue('2020-01-01');
  await expect(page.locator('#imgTo')).toHaveValue('2020-12-31');

  // «Hasta» antes de «desde» no se guarda
  await page.fill('#imgTo', '2019-12-31');
  await page.click('#imgSaveBtn');
  await expect(page.locator('#imgFormError')).toContainText('no puede ser anterior');
  await expect(page.locator('#imgModalBackdrop')).toHaveClass(/is-open/);

  // «Siempre» limpia días y fechas
  await page.click('#imgScheduleClear');
  await expect(page.locator('#imgDaysSeg .seg__btn.is-active')).toHaveCount(0);
  await expect(page.locator('#imgFrom')).toHaveValue('');
  await expect(page.locator('#imgTo')).toHaveValue('');
  await page.locator('#imgBlur').uncheck();
  await page.click('#imgSaveBtn');
  await expect(page.locator('#imgModalBackdrop')).not.toHaveClass(/is-open/);

  img = (await guardadas(page))[0];
  expect(img.schedule).toBeNull();
  expect(img.blur).toBe(false);
  await expect(card.locator('.image-card__tags')).toHaveCount(0);
  expect((await publicas(page)).map((i) => i.alt)).toEqual(['Promo A', 'Promo B']);

  expect(w.problems, w.problems.join('\n')).toEqual([]);
  expect(await w.csp()).toEqual([]);
});

test('suspender también desde «Editar imagen»', async ({ page }) => {
  await uiLogin(page);
  const card = page.locator('#userGrid .image-card').nth(1);
  await card.locator('[data-action="edit"]').click();
  await page.locator('#imgSuspended').check();
  await page.click('#imgSaveBtn');
  await expect(card).toHaveClass(/is-suspended/);
  expect((await publicas(page)).map((i) => i.alt)).toEqual(['Promo A']);
  await card.locator('[data-action="suspend"]').click();
  await expect(card).not.toHaveClass(/is-suspended/);
});
