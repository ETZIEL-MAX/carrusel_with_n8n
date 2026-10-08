import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { uiLogin, apiLogin, freshIp } from './helpers.js';

// Espacio por usuario, token por cliente y consumo, vistos desde el panel.
// Usa un usuario propio: generar un token cambia cómo firma n8n para ese carrusel,
// y las demás pruebas firman USER1 con el secreto global.

test.describe.configure({ mode: 'serial' });

const EMAIL = `plan${Date.now()}@local.test`;
const PASSWORD = 'plan-segura-123';
let userId;
let token;

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  await apiLogin(api); // super-admin
  const res = await api.post('/api/users', {
    data: { name: 'Cliente Plan', email: EMAIL, password: PASSWORD },
    headers: { 'X-Forwarded-For': freshIp() },
  });
  expect(res.ok()).toBeTruthy();
  userId = (await res.json()).data.userId;
  await api.dispose();
});

test('super-admin: límite de espacio y token que se ve una sola vez', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await uiLogin(page, { asAdmin: true });

  const card = page.locator(`.user-card[data-userid="${userId}"]`);
  await expect(card.locator('.user-card__storage')).toContainText('de 500 MB');
  await expect(card.locator('.user-card__storage')).toContainText('sin token');
  await expect(page.locator('#priceInput')).toHaveValue('0.06');

  await card.locator('button[data-action="settings"]').click();
  await expect(page.locator('#tokenStatus')).toContainText('Sin token');
  await page.fill('#setStorageLimit', '5');

  await page.click('#tokenGenBtn');
  await expect(page.locator('#pwdRevealTitle')).toHaveText(`Token de ${userId}`);
  token = await page.locator('#pwdRevealText').inputValue();
  expect(token).toMatch(/^crt_[A-Za-z0-9_-]{40,}$/);
  await page.click('#pwdRevealCloseBtn');
  await expect(page.locator('#pwdRevealText')).toHaveValue(''); // ya no queda en la página

  // Después solo se ven los últimos 4 caracteres
  await expect(page.locator('#tokenStatus')).toContainText(`••••${token.slice(-4)}`);
  await expect(page.locator('#tokenGenBtn')).toHaveText('Regenerar token');
  expect(await page.content()).not.toContain(token);

  await page.click('#settingsSaveBtn');
  await expect(card.locator('.user-card__storage')).toContainText('de 5.0 MB');
  await expect(card.locator('.user-card__storage')).toContainText('con token');
});

test('cliente: ve su espacio y el consumo que reporta n8n', async ({ page }) => {
  // n8n reporta una imagen sin tokens, firmando con el token del cliente
  const body = JSON.stringify({ eventId: `pw-${Date.now()}`, kind: 'image', model: 'qwen-image' });
  const ts = String(Math.floor(Date.now() / 1000));
  const report = await page.request.post(`/api/usage/${userId}`, {
    data: body,
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Timestamp': ts,
      'X-Webhook-Secret': createHmac('sha256', token).update(`${ts}.${body}`, 'utf8').digest('hex'),
      'X-Forwarded-For': freshIp(),
    },
  });
  expect(report.ok()).toBeTruthy();

  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await expect(page.locator('#planPanel')).toBeVisible();
  await expect(page.locator('#storageText')).toHaveText('0.0 MB de 5.0 MB');
  await expect(page.locator('#storageHint')).toContainText('Te quedan 5.0 MB');

  const stats = page.locator('#usageStats .usage-stat');
  await expect(stats.nth(0)).toContainText('1'); // imágenes
  await expect(stats.nth(3)).toContainText('$0.06 USD');
  await expect(page.locator('#usageHint')).toContainText('1 imagen sin tokens');

  // Otro mes: sin consumo
  await page.selectOption('#usageMonth', { index: 1 });
  await expect(page.locator('#usageHint')).toHaveText('Sin generación registrada en este mes.');
});

test('cerrar todas las sesiones saca al usuario', async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await page.click('#userSettingsBtn');
  await page.click('#selfLogoutAllBtn');
  await expect(page.locator('#loginView')).toBeVisible();
  const me = await page.request.get('/api/auth');
  expect((await me.json()).authenticated).toBe(false);
});
