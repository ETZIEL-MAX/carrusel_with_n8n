import { test, expect } from '@playwright/test';
import { uiLogin, apiLogin, freshIp, poster } from './helpers.js';

// "Crear con IA": el cliente pide una imagen, n8n (falso, en tests/serve.mjs) la devuelve
// como borrador, el cliente pide cambios y la publica en su carrusel.

test.describe.configure({ mode: 'serial' });

const EMAIL = `ia${Date.now()}@local.test`;
const PASSWORD = 'ia-segura-12345';
let userId;

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  await apiLogin(api);
  const res = await api.post('/api/users', {
    data: { name: 'Cliente IA', email: EMAIL, password: PASSWORD },
    headers: { 'X-Forwarded-For': freshIp() },
  });
  expect(res.ok()).toBeTruthy();
  userId = (await res.json()).data.userId;
  await api.dispose();
});

// Lo que haría el flujo de n8n: toma el último pedido de este borrador y manda la imagen.
async function n8nResponde(request, baseURL, prompt, label) {
  const port = Number(new URL(baseURL).port) + 1;
  let call;
  await expect.poll(async () => {
    const calls = await (await request.get(`http://127.0.0.1:${port}/calls`)).json();
    call = calls.filter((c) => c.userId === userId && c.prompt === prompt).at(-1);
    return call?.round;
  }).toBeTruthy();
  const img = await poster({ w: 1280, h: 720, label });
  const res = await request.post(call.callbackUrl, {
    data: img,
    headers: { 'Content-Type': 'image/png', 'X-Draft-Token': call.callbackToken, 'X-Forwarded-For': freshIp() },
  });
  expect(res.status()).toBe(200);
  return call;
}

test('pedir una imagen, pedir cambios y publicarla', async ({ page, request }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await expect(page.locator('#aiPanel')).toBeVisible();

  await page.fill('#aiPrompt', 'Tacos al pastor 3x50');
  await page.click('#aiGenerateBtn');
  const card = page.locator('.draft-card').first();
  await expect(card.locator('.draft-card__status')).toHaveText('Generando…');
  await expect(card.locator('button[data-draft-action="publicar"]')).toBeDisabled();

  await n8nResponde(request, baseURL, 'Tacos al pastor 3x50', 'V1');
  await expect(card.locator('.draft-card__status')).toHaveText('Lista para revisar', { timeout: 15000 });
  await expect(card.locator('img')).toBeVisible();
  const first = await card.locator('img').getAttribute('src');

  await card.locator('button[data-draft-action="cambios"]').click();
  await card.locator('form[data-change] textarea').fill('precio más grande');
  await card.locator('form[data-change] button[type="submit"]').click();
  await expect(card.locator('.draft-card__status')).toContainText('Generando… · ronda 2');
  await expect(card.locator('.draft-card__changes')).toContainText('precio más grande');

  const call = await n8nResponde(request, baseURL, 'Tacos al pastor 3x50', 'V2');
  expect(call.changes).toEqual(['precio más grande']);
  await expect(card.locator('.draft-card__status')).toHaveText('Lista para revisar · ronda 2', { timeout: 15000 });
  const second = await card.locator('img').getAttribute('src');
  expect(second).not.toBe(first);

  await card.locator('button[data-draft-action="publicar"]').click();
  await expect(page.locator('.toast').last()).toHaveText('Publicada en el carrusel');
  await expect(page.locator('.draft-card')).toHaveCount(0);
  await expect(page.locator(`#userGrid .image-card__thumb[src="${second}"]`)).toHaveCount(1);
});

test('descartar un borrador', async ({ page, request }, testInfo) => {
  page.on('dialog', (d) => d.accept());
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await page.fill('#aiPrompt', 'Para tirar');
  await page.click('#aiGenerateBtn');
  await n8nResponde(request, testInfo.project.use.baseURL, 'Para tirar', 'X');
  const card = page.locator('.draft-card').first();
  await expect(card.locator('.draft-card__status')).toHaveText('Lista para revisar', { timeout: 15000 });
  await card.locator('button[data-draft-action="descartar"]').click();
  await expect(page.locator('.draft-card')).toHaveCount(0);
});
