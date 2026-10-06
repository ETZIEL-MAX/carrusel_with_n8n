import { test, expect } from '@playwright/test';
import { uiLogin, poster, watchPage } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('configuración: paleta, Drive y orientación se guardan y persisten', async ({ page }) => {
  const w = watchPage(page);
  await uiLogin(page);
  await page.click('#userSettingsBtn');
  await expect(page.locator('#settingsModalBackdrop')).toHaveClass(/is-open/);

  const drive = 'https://drive.google.com/drive/folders/PLAYWRIGHT123';
  await page.fill('#genDriveUrl', drive);
  await page.click('#addColorBtn');
  await expect(page.locator('#orientSeg + .hint')).toHaveText('El bot tomará como referencia esto si no es especificado en el mensaje de WhatsApp.');
  await expect(page.locator('#orientSeg .seg__btn')).toHaveCount(5);
  await page.click('#orientSq');
  await expect(page.locator('#orientSq')).toHaveClass(/is-active/);
  await page.click('#settingsSaveGenBtn');
  await expect(page.locator('#genFormOk')).toBeVisible();
  await expect(page.locator('#genFormOk')).toContainText('Guardado correctamente');

  // Cerrar y reabrir: debe recordar todo
  await page.click('#settingsCancelBtn');
  await page.click('#userSettingsBtn');
  await expect(page.locator('#genDriveUrl')).toHaveValue(drive);
  await expect(page.locator('#orientSq')).toHaveClass(/is-active/);
  await expect(page.locator('#colorPaletteRow .color-swatch')).not.toHaveCount(0);

  // El default viaja a la API
  const s = await page.request.get('/api/settings');
  expect((await s.json()).data.defaultOrientation).toBe('cuadrado');

  expect(w.problems, w.problems.join('\n')).toEqual([]);
  expect(await w.csp()).toEqual([]);
});

test('subir imagen desde el admin la guarda como WebP', async ({ page }) => {
  await uiLogin(page);
  const before = await page.locator('#userGrid .image-card').count();
  const png = await poster({ w: 1920, h: 1080, label: 'SUBIDA ADMIN', color: '#9333ea' });
  await page.setInputFiles('#uploadImgInput', { name: 'poster.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('#userGrid .image-card')).toHaveCount(before + 1, { timeout: 20_000 });
  const url = await page.locator('#userGrid .image-card .image-card__url').last().textContent();
  expect(url).toMatch(/\.webp$/);
  const img = await page.request.get(url);
  expect(img.headers()['content-type']).toBe('image/webp');
  expect((await img.body()).length).toBeLessThan(png.length);
});

test('orientación por imagen: "Girar 90°" se guarda y se ve en el badge', async ({ page }) => {
  await uiLogin(page);
  const card = page.locator('#userGrid .image-card').last();
  await card.locator('button[data-action="edit"]').click();
  await expect(page.locator('#imgModalBackdrop')).toHaveClass(/is-open/);
  await page.click('#viewSeg .seg__btn[data-value="rotate"]');
  await page.click('#imgSaveBtn');
  await expect(page.locator('#userGrid .image-card').last().locator('.image-card__order')).toContainText('Girar 90°');

  const id = await page.locator('#userGrid .image-card').last().getAttribute('data-id');
  const list = await (await page.request.get('/api/carrusel?userId=USER1')).json();
  expect(list.data.images.find((i) => i.id === id).view).toBe('rotate');
});

test('borrar imagen la quita del carrusel y del disco', async ({ page }) => {
  await uiLogin(page);
  const cards = page.locator('#userGrid .image-card');
  const count = await cards.count();
  const url = await cards.last().locator('.image-card__url').textContent();
  page.once('dialog', (d) => d.accept());
  await cards.last().locator('button[data-action="delete"]').click();
  await expect(cards).toHaveCount(count - 1);
  const list = await (await page.request.get('/api/carrusel?userId=USER1')).json();
  expect(list.data.images.some((i) => i.url === url)).toBe(false);
  expect((await page.request.get(url)).status()).toBe(404); // archivo borrado
});
