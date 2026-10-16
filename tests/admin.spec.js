import { test, expect } from '@playwright/test';
import { uiLogin, poster, watchPage } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('configuración: paleta, Drive y orientación se guardan y persisten', async ({ page }) => {
  const w = watchPage(page);
  await uiLogin(page);
  // El modal carga sus ajustes en segundo plano: esperar esa respuesta antes de escribir,
  // o la carga pisa lo escrito con el valor guardado (vacío).
  const settingsLoaded = page.waitForResponse((r) => r.url().includes('/api/settings') && r.request().method() === 'GET');
  await page.click('#userSettingsBtn');
  await expect(page.locator('#settingsModalBackdrop')).toHaveClass(/is-open/);
  await settingsLoaded;

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

test('configuración: la resolución del póster se elige, muestra su tamaño y persiste', async ({ page }) => {
  const w = watchPage(page);
  await uiLogin(page);
  await page.click('#userSettingsBtn');
  await expect(page.locator('#settingsModalBackdrop')).toHaveClass(/is-open/);

  await expect(page.locator('#resSeg .seg__btn')).toHaveCount(4);
  await page.click('#orientV');
  await page.click('#resSeg [data-value="4k"]');
  await expect(page.locator('#resSeg [data-value="4k"]')).toHaveClass(/is-active/);
  await expect(page.locator('#formatSizeHint')).toHaveText('Tamaño del póster: 2160 × 3840 px');
  await page.click('#orientH43');
  await page.click('#resSeg [data-value="2k"]');
  await expect(page.locator('#formatSizeHint')).toHaveText('Tamaño del póster: 1920 × 1440 px');
  await page.click('#orientV');
  await page.click('#resSeg [data-value="4k"]');

  await page.click('#settingsSaveGenBtn');
  await expect(page.locator('#genFormOk')).toContainText('Guardado correctamente');
  const saved = (await (await page.request.get('/api/settings')).json()).data;
  expect(saved.defaultOrientation).toBe('vertical');
  expect(saved.posterResolution).toBe('4k');

  // Recordar al recargar la página
  await page.reload();
  await page.click('#userSettingsBtn');
  await expect(page.locator('#resSeg [data-value="4k"]')).toHaveClass(/is-active/);
  await expect(page.locator('#orientV')).toHaveClass(/is-active/);
  await expect(page.locator('#formatSizeHint')).toHaveText('Tamaño del póster: 2160 × 3840 px');

  // Dejar al cliente como estaba
  await page.request.patch('/api/settings', { data: { posterResolution: 'fullhd', defaultOrientation: 'horizontal' } });
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

test('orientación por imagen: solo Auto / Horizontal / Vertical; se guarda y se ve en el badge', async ({ page }) => {
  await uiLogin(page);
  const card = page.locator('#userGrid .image-card').last();
  const url = await card.locator('.image-card__url').textContent();
  await card.locator('button[data-action="edit"]').click();
  await expect(page.locator('#imgModalBackdrop')).toHaveClass(/is-open/);
  // Al editar no se muestra la URL
  await expect(page.locator('#imgUrl')).toBeHidden();
  await expect(page.locator('#viewSeg .seg__btn')).toHaveText(['Auto', 'Horizontal', 'Vertical']);
  await expect(page.locator('#viewSeg [data-value="auto"]')).toHaveClass(/is-active/);
  await page.click('#viewSeg .seg__btn[data-value="vertical"]');
  await page.click('#imgSaveBtn');
  await expect(page.locator('#userGrid .image-card').last().locator('.image-card__order')).toContainText('Vertical');

  const id = await page.locator('#userGrid .image-card').last().getAttribute('data-id');
  const list = await (await page.request.get('/api/carrusel?userId=USER1')).json();
  const saved = list.data.images.find((i) => i.id === id);
  expect(saved.view).toBe('vertical');
  expect(saved.url).toBe(url); // la URL no cambia al editar

  // Al añadir una imagen la URL sí se pide
  await page.click('#addImgBtn');
  await expect(page.locator('#imgUrl')).toBeVisible();
  await page.click('#imgCancelBtn');
});

test('duración: por imagen y por defecto se guardan y llegan al carrusel', async ({ page }) => {
  await uiLogin(page);

  // Por imagen
  const card = page.locator('#userGrid .image-card').last();
  await card.locator('button[data-action="edit"]').click();
  await expect(page.locator('#imgModalBackdrop')).toHaveClass(/is-open/);
  await page.fill('#imgDuration', '1');
  await page.click('#imgSaveBtn');
  await expect(page.locator('#imgFormError')).toContainText('entre 2 y 3600');
  await page.fill('#imgDuration', '20');
  await page.click('#imgSaveBtn');
  await expect(page.locator('#userGrid .image-card').last().locator('.image-card__order')).toContainText('20 s');

  // Por defecto del carrusel
  await page.click('#userSettingsBtn');
  await expect(page.locator('#genSlideDuration')).toHaveValue('8'); // ajustes ya cargados
  await page.fill('#genSlideDuration', '12');
  await page.click('#settingsSaveGenBtn');
  await expect(page.locator('#genFormOk')).toBeVisible();

  const id = await page.locator('#userGrid .image-card').last().getAttribute('data-id');
  const list = await (await page.request.get('/api/carrusel?userId=USER1')).json();
  expect(list.data.slideDuration).toBe(12);
  expect(list.data.images.find((i) => i.id === id).duration).toBe(20);

  // Vaciar el campo vuelve a la duración por defecto
  await page.click('#settingsCancelBtn');
  await page.locator('#userGrid .image-card').last().locator('button[data-action="edit"]').click();
  await expect(page.locator('#imgDuration')).toHaveValue('20');
  await page.fill('#imgDuration', '');
  await page.click('#imgSaveBtn');
  await expect(page.locator('#imgModalBackdrop')).not.toHaveClass(/is-open/);
  const again = await (await page.request.get('/api/carrusel?userId=USER1')).json();
  expect(again.data.images.find((i) => i.id === id).duration).toBeNull();
});

test('aviso de novedad: sale una sola vez por navegador', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

  await uiLogin(page, { news: true });
  await expect.poll(() => dialogs.length, { timeout: 5000 }).toBe(1);
  expect(dialogs[0]).toBe('Nueva actualización: ahora puedes modificar el tiempo de cada imagen.');

  // Al volver a entrar (sesión ya iniciada) no se repite
  await page.reload();
  await page.waitForSelector('#userDashboard:not([hidden])');
  await page.waitForTimeout(1200);
  expect(dialogs.length).toBe(1);
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

test('código QR: aparece en los ajustes con la URL del carrusel', async ({ page }) => {
  await uiLogin(page);
  const qrLoaded = page.waitForResponse((r) => r.url().includes('/api/qr') && r.request().method() === 'GET');
  await page.click('#userSettingsBtn');
  await expect(page.locator('#settingsModalBackdrop')).toHaveClass(/is-open/);
  await qrLoaded;
  await expect(page.locator('#qrImg')).toBeVisible();
  await expect(page.locator('#qrImg')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.locator('#qrUrl')).toContainText('/carrusel/USER');
  await expect(page.locator('#qrDownloadBtn')).toBeVisible();
  await expect(page.locator('#qrPrintBtn')).toBeVisible();
});
