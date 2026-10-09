import { test, expect } from '@playwright/test';
import { uiLogin, uploadPoster, setCarousel } from './helpers.js';

// Las ventanas emergentes del panel en pantallas bajas: tienen que caber, dejar bajar hasta
// el último campo y mantener «Guardar» a la vista. (En celular vertical, ver mobile.spec.js.)
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  const a = await uploadPoster(api, 'USER1', { label: 'MODAL', color: '#7c3aed' });
  await setCarousel(api, 'USER1', [{ url: a, alt: 'Modal', order: 0 }]);
  await api.dispose();
});

const PANTALLAS = [
  ['laptop 1366x768', { width: 1366, height: 768 }],
  ['laptop chica 1280x600', { width: 1280, height: 600 }],
  ['tablet acostada 1024x560', { width: 1024, height: 560 }],
  ['celular acostado 800x360', { width: 800, height: 360 }],
];

// Baja la ventana con la rueda del ratón, como lo haría una persona.
async function bajarConRueda(page, modal) {
  const box = await modal.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
}

async function revisarModal(page, { form, primero, ultimo, guardar }) {
  const vp = page.viewportSize();
  const modal = page.locator(form);
  await expect(modal).toBeVisible();
  await page.waitForTimeout(450); // termina la animación de entrada

  // Cabe en la pantalla: no se sale por arriba ni por abajo
  const box = await modal.boundingBox();
  expect(box.y, 'la ventana no empieza fuera de la pantalla').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, 'la ventana no termina fuera de la pantalla').toBeLessThanOrEqual(vp.height + 1);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 1);

  // «Guardar» está a la vista sin bajar
  await expect(page.locator(guardar)).toBeInViewport({ ratio: 1 });

  // Se puede bajar con la rueda hasta el último campo, y no queda tapado por los botones
  await bajarConRueda(page, modal);
  await expect(page.locator(ultimo)).toBeInViewport({ ratio: 1 });
  const fin = await page.locator(ultimo).boundingBox();
  const botones = await page.locator(guardar).boundingBox();
  expect(fin.y + fin.height, 'el último campo queda por encima de los botones').toBeLessThanOrEqual(botones.y + 1);
  await expect(page.locator(guardar)).toBeInViewport({ ratio: 1 });

  // Y volver a subir hasta el primero
  await modal.evaluate((el) => { el.scrollTop = 0; });
  await expect(page.locator(primero)).toBeInViewport({ ratio: 1 });

  // La página de atrás no se mueve ni aparece scroll horizontal
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

for (const [nombre, viewport] of PANTALLAS) {
  test.describe(nombre, () => {
    test.use({ viewport });

    test('«Editar imagen» deja bajar hasta el final', async ({ page }) => {
      await uiLogin(page);
      await page.locator('#userGrid .image-card').first().locator('[data-action="edit"]').click();
      await revisarModal(page, { form: '#imgModalForm', primero: '#imgUrl', ultimo: '#imgSuspended', guardar: '#imgSaveBtn' });
      // Y lo que se marca al fondo se guarda
      await page.locator('#imgBlur').check();
      await page.click('#imgSaveBtn');
      await expect(page.locator('#imgModalBackdrop')).not.toHaveClass(/is-open/);
      expect((await (await page.request.get('/api/images')).json()).data.images[0].blur).toBe(true);
    });

    test('«Configuración» deja bajar hasta el final', async ({ page }) => {
      await uiLogin(page);
      await page.click('#userSettingsBtn');
      await revisarModal(page, { form: '#settingsModalForm', primero: '#settingsModalTitle', ultimo: '#genSlideDuration', guardar: '#settingsSaveGenBtn' });
    });
  });
}

// Entre el celular y el escritorio: nada se sale por los lados y «Salir» siempre se ve.
for (const width of [660, 720, 800, 900, 1023, 1100]) {
  test.describe(`ancho ${width}px`, () => {
    test.use({ viewport: { width, height: 700 } });

    test('el panel del cliente y el del super-admin caben a lo ancho', async ({ page }) => {
      const desborde = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await uiLogin(page);
      await expect(page.locator('#userGrid .image-card').first()).toBeVisible();
      expect(await desborde(), 'panel del cliente').toBeLessThanOrEqual(0);
      await expect(page.locator('#userLogoutBtn')).toBeInViewport({ ratio: 1 });

      await page.click('#userLogoutBtn');
      await uiLogin(page, { asAdmin: true });
      expect(await desborde(), 'panel del super-admin').toBeLessThanOrEqual(0);
      await expect(page.locator('#superAdminDashboard .admin-actions .btn').last()).toBeInViewport({ ratio: 1 });
    });
  });
}
