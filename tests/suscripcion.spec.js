import { test, expect } from '@playwright/test';
import { uiLogin, apiLogin, freshIp } from './helpers.js';

// Prueba gratis, planes y límite de pantallas, vistos desde el panel y desde la TV.
// Usa un usuario propio: cambiarle el plan no debe afectar a las demás pruebas.

test.describe.configure({ mode: 'serial' });

const EMAIL = `subs${Date.now()}@local.test`;
const PASSWORD = 'subs-segura-123';
let userId;

async function adminApi(playwright, testInfo) {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  await apiLogin(api);
  return api;
}

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await adminApi(playwright, testInfo);
  const res = await api.post('/api/users', {
    data: { name: 'Cliente Plan', email: EMAIL, password: PASSWORD },
    headers: { 'X-Forwarded-For': freshIp() },
  });
  expect(res.ok()).toBeTruthy();
  userId = (await res.json()).data.userId;
  await api.dispose();
});

test('cuenta nueva: el panel muestra la prueba gratis y sus pantallas', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await expect(page.locator('#subText')).toHaveText('Prueba gratis · Básico');
  await expect(page.locator('#subHint')).toContainText('quedan 7 días');
  await expect(page.locator('#devText')).toHaveText('0 de 3');
  await expect(page.locator('#planAlert')).toBeHidden();
});

test('límite de pantallas: la 4.ª TV ve el aviso y se libera desde el panel', async ({ browser, page }) => {
  // Tres pantallas distintas (cada contexto tiene su propio localStorage = su propio id)
  const tvs = [];
  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext();
    const tv = await ctx.newPage();
    await tv.route('**/api/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': freshIp() } }));
    await tv.goto(`/carrusel/${userId}`);
    tvs.push({ ctx, tv });
    if (i < 3) await expect(tv.locator('#notice')).toBeHidden();
  }
  const last = tvs[3].tv;
  await expect(last.locator('#notice')).toBeVisible();
  await expect(last.locator('#notice .empty__title')).toHaveText('Límite de pantallas alcanzado');

  page.on('dialog', (d) => d.accept());
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await expect(page.locator('#devText')).toHaveText('3 de 3');
  await page.locator('#deviceList button[data-device]').first().click();
  await expect(page.locator('#devText')).toHaveText('2 de 3');

  await last.reload();
  await expect(last.locator('#notice')).toBeHidden();

  // La TV quitada sigue encendida, pero ya no vuelve a tomar el lugar.
  const poll = async (tv, action) => {
    const [res] = await Promise.all([tv.waitForResponse((r) => r.url().includes('/api/carrusel')), action()]);
    return (await res.json()).data;
  };
  const states = [];
  for (const { tv } of tvs.slice(0, 3)) states.push(await poll(tv, () => tv.reload()));
  expect(states.filter((s) => s.deviceRevoked).length).toBe(1);
  const removed = tvs[states.findIndex((s) => s.deviceRevoked)].tv;
  await expect(removed.locator('#notice .empty__title')).toHaveText('Pantalla desconectada');
  await expect(removed.locator('#noticeBtn')).toBeVisible();
  await expect(removed.locator('#noticeBtn')).toBeFocused(); // listo para el OK del control remoto
  // Conectarla como nueva: cuenta como otra pantalla y ya no hay lugar.
  expect((await poll(removed, () => removed.locator('#noticeBtn').click())).deviceBlocked).toBe(true);
  await expect(removed.locator('#notice .empty__title')).toHaveText('Límite de pantallas alcanzado');
  await expect(removed.locator('#noticeBtn')).toBeHidden();

  // Liberar todas: cualquier TV puede volver a conectarse como nueva.
  await page.click('#resetDevicesBtn');
  await expect(page.locator('#devText')).toHaveText('0 de 3');
  const other = tvs[3].tv;
  expect((await poll(other, () => other.reload())).deviceRevoked).toBe(true);
  expect((await poll(other, () => other.locator('#noticeBtn').click())).deviceRevoked).toBeUndefined();
  await expect(other.locator('#notice')).toBeHidden();
  for (const { ctx } of tvs) await ctx.close();
});

test('páginas legales: se abren, se ven en el celular y el registro pide aceptarlas', async ({ page }) => {
  for (const [path, title] of [['/terminos', 'Términos y condiciones de uso'], ['/privacidad', 'Aviso de privacidad']]) {
    const res = await page.goto(path);
    expect(res.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(title);
  }
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto('/admin');
  await expect(page.locator('footer.legal-links a[href="/privacidad"]')).toBeVisible();
  await page.click('.login-tab[data-mode="user"]');
  await page.click('#showSignupBtn');
  await expect(page.locator('label[for="signupTerms"] a[href="/terminos"]')).toBeVisible();
});

test('super-admin: plan vencido suspende la TV y avisa al cliente; activarlo lo devuelve', async ({ browser, page }) => {
  await uiLogin(page, { asAdmin: true });
  const card = page.locator(`.user-card[data-userid="${userId}"]`);
  await expect(card.locator('.plan-badge')).toContainText('Prueba gratis');
  // La prueba anterior liberó todas y volvió a conectar una.
  await expect(card.locator('.user-card__plan')).toContainText('Pantallas 1/3');

  // Plan Pro que terminó ayer
  await card.locator('button[data-action="settings"]').click();
  await page.selectOption('#setPlan', 'pro');
  const d = new Date(Date.now() - 86400000);
  await page.fill('#setPlanEnds', `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  await page.click('#settingsSaveBtn');
  await expect(card.locator('.plan-badge')).toHaveText('Pro · vencido');

  const ctx = await browser.newContext();
  const tv = await ctx.newPage();
  await tv.goto(`/carrusel/${userId}`);
  await expect(tv.locator('#notice .empty__title')).toHaveText('Carrusel suspendido');

  const client = await (await browser.newContext()).newPage();
  await uiLogin(client, { email: EMAIL, password: PASSWORD });
  await expect(client.locator('#planAlert')).toBeVisible();
  await expect(client.locator('#uploadImgBtn')).toBeDisabled();

  // Pro sin fecha de fin
  await card.locator('button[data-action="settings"]').click();
  await page.selectOption('#setPlan', 'pro');
  await page.fill('#setPlanEnds', '');
  await page.click('#settingsSaveBtn');
  await expect(card.locator('.plan-badge')).toHaveText('Pro');

  await tv.reload();
  await expect(tv.locator('#notice')).toBeHidden();
  await ctx.close();
});

test('super-admin: la tabla de planes se edita y se guarda', async ({ page }) => {
  await uiLogin(page, { asAdmin: true });
  const devices = page.locator('tr[data-plan="empresa"] input[data-field="devices"]');
  await expect(devices).toHaveValue('50');
  await devices.fill('60');
  await page.click('#plansSaveBtn');
  await expect(page.locator('.toast').last()).toHaveText('Planes guardados');
  await page.reload();
  await expect(page.locator('tr[data-plan="empresa"] input[data-field="devices"]')).toHaveValue('60');
  await page.locator('tr[data-plan="empresa"] input[data-field="devices"]').fill('50');
  await page.click('#plansSaveBtn');
});
