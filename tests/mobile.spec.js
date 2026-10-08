import { test, expect, devices } from '@playwright/test';
import { uiLogin, apiLogin, freshIp, poster } from './helpers.js';

// El panel en un celular: nada se sale de la pantalla, se puede tomar una foto,
// reordenar con flechas y usar los modales.
const { defaultBrowserType, ...pixel } = devices['Pixel 7'];
test.use(pixel);
test.describe.configure({ mode: 'serial' });

const EMAIL = `movil${Date.now()}@local.test`;
const PASSWORD = 'movil-segura-123';

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  await apiLogin(api); // super-admin
  const res = await api.post('/api/users', {
    data: { name: 'Cliente Movil', email: EMAIL, password: PASSWORD },
    headers: { 'X-Forwarded-For': freshIp() },
  });
  expect(res.ok()).toBeTruthy();
  await api.dispose();
});

// Ningún elemento visible queda fuera del ancho de la pantalla.
async function expectNoOverflow(page, scope) {
  const result = await page.evaluate((selector) => {
    const width = document.documentElement.clientWidth;
    const outside = [...document.querySelectorAll(`${selector} *`)]
      .filter((el) => el.offsetParent !== null)
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > width + 1 || r.left < -1); })
      .map((el) => el.id || el.className || el.tagName);
    return { pageScroll: document.documentElement.scrollWidth - width, outside: outside.slice(0, 8) };
  }, scope);
  expect(result).toEqual({ pageScroll: 0, outside: [] });
}

test('panel del usuario: cabe en la pantalla y los botones son cómodos', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await expect(page.locator('#planPanel')).toBeVisible();
  await expectNoOverflow(page, '#userDashboard');

  // Todos los botones de la cabecera visibles y de al menos 44 px de alto
  const buttons = page.locator('#userDashboard .admin-actions .btn:visible');
  expect(await buttons.count()).toBeGreaterThanOrEqual(5);
  for (const box of await buttons.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Tomar foto y Subir van primero
  const labels = await buttons.evaluateAll((els) =>
    els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      .map((e) => e.id));
  expect(labels.slice(0, 2).sort()).toEqual(['cameraBtn', 'uploadImgBtn']);
  expect(labels[labels.length - 1]).toBe('userLogoutBtn');
});

test('tomar foto: abre la cámara y la foto queda en el carrusel', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await expect(page.locator('#cameraBtn')).toBeVisible();
  // El input pide la cámara trasera directamente
  expect(await page.locator('#cameraInput').evaluate((i) => [i.accept, i.getAttribute('capture')]))
    .toEqual(['image/*', 'environment']);

  // El botón abre ese selector
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.tap('#cameraBtn')]);
  await chooser.setFiles({ name: 'foto-camara.jpg', mimeType: 'image/png', buffer: await poster({ w: 1080, h: 1920, label: 'FOTO 1' }) });

  await expect(page.locator('.image-card')).toHaveCount(1);
  await expect(page.locator('.image-card__alt')).toHaveText('foto camara');
  expect(await page.locator('.image-card__thumb').getAttribute('src')).toMatch(/^\/uploads\/USER\d+-[\w-]+\.webp$/);
  await expect(page.locator('#userCountHint')).toHaveText('1 imagen');
});

test('reordenar con flechas y tarjetas sin mini vistas', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await page.setInputFiles('#uploadImgInput', { name: 'segunda.png', mimeType: 'image/png', buffer: await poster({ label: 'FOTO 2' }) });
  await expect(page.locator('.image-card')).toHaveCount(2);
  await expect(page.locator('.image-card__previews').first()).toBeHidden();
  await expectNoOverflow(page, '#userGrid');

  const titles = () => page.locator('.image-card__alt').allTextContents();
  expect(await titles()).toEqual(['foto camara', 'segunda']);
  await expect(page.locator('.image-card').first().locator('button[data-action="up"]')).toBeDisabled();

  await page.locator('.image-card').first().locator('button[data-action="down"]').tap();
  await expect(page.locator('.toast', { hasText: 'Orden actualizado' })).toBeVisible();
  expect(await titles()).toEqual(['segunda', 'foto camara']);

  await page.reload();
  await page.waitForSelector('#userDashboard:not([hidden])');
  await expect(page.locator('.image-card')).toHaveCount(2);
  expect(await titles()).toEqual(['segunda', 'foto camara']); // quedó guardado
});

test('modales a pantalla completa con los botones a la vista', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  const viewport = page.viewportSize();

  await page.tap('#userSettingsBtn');
  const modal = page.locator('#settingsModalForm');
  await expect(modal).toBeVisible();
  const box = await modal.boundingBox();
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
  await expectNoOverflow(page, '#settingsModalForm');
  // Guardar está a la vista sin tener que bajar hasta el final
  await expect(page.locator('#settingsSaveGenBtn')).toBeInViewport();
  await page.fill('#genSlideDuration', '15');
  await page.tap('#settingsSaveGenBtn');
  await expect(page.locator('#genFormOk')).toBeVisible();
  await page.tap('#settingsCancelBtn');

  await page.locator('.image-card').first().locator('button[data-action="edit"]').tap();
  await expect(page.locator('#imgModalForm')).toBeVisible();
  await expectNoOverflow(page, '#imgModalForm');
  await expect(page.locator('#imgSaveBtn')).toBeInViewport();
});

test('panel de super-admin: cabe en la pantalla', async ({ page }) => {
  await uiLogin(page, { asAdmin: true });
  await expect(page.locator('.user-card').first()).toBeVisible();
  await expectNoOverflow(page, '#superAdminDashboard');

  await page.locator('.user-card').first().locator('button[data-action="settings"]').tap();
  await expect(page.locator('#settingsModalForm')).toBeVisible();
  await page.waitForTimeout(400);
  await expectNoOverflow(page, '#settingsModalForm');
  await expect(page.locator('#settingsSaveBtn')).toBeInViewport();
});
