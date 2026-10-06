import { test, expect } from '@playwright/test';
import { uiLogin, useFreshIp, freshIp, PASSWORD, USER1_EMAIL } from './helpers.js';

test('login de usuario por la UI y logout', async ({ page }) => {
  await uiLogin(page);
  await expect(page.locator('#userDashboardTitle')).toHaveText(/Usuario 1|USER1/);
  await page.click('#userLogoutBtn');
  await expect(page.locator('#loginView')).toBeVisible();
  const me = await (await page.request.get('/api/auth')).json();
  expect(me.authenticated).toBe(false);
});

test('contraseña incorrecta muestra error y no entra', async ({ page }) => {
  await useFreshIp(page);
  await page.goto('/admin');
  await page.click('.login-tab[data-mode="user"]');
  await page.fill('#userEmail', USER1_EMAIL);
  await page.fill('#userPassword', 'incorrecta-123');
  await page.click('#userLoginBtn');
  await expect(page.locator('#userLoginError')).not.toBeEmpty();
  await expect(page.locator('#userDashboard')).toBeHidden();
});

test('la cookie de sesión es HttpOnly y SameSite=Strict', async ({ request }) => {
  const res = await request.post('/api/auth', {
    data: { email: USER1_EMAIL, password: PASSWORD },
    headers: { 'X-Forwarded-For': freshIp() },
  });
  expect(res.status()).toBe(200);
  const cookie = res.headers()['set-cookie'] || '';
  expect(cookie).toMatch(/auth_token=/);
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/SameSite=Strict/i);
});

test('rate-limit: el 6º intento fallido seguido devuelve 429', async ({ request }) => {
  const ip = freshIp();
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    const r = await request.post('/api/auth', {
      data: { email: USER1_EMAIL, password: 'mal' },
      headers: { 'X-Forwarded-For': ip },
    });
    statuses.push(r.status());
  }
  expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
  expect(statuses[5]).toBe(429);
});

test('correo inexistente y contraseña mala responden igual (sin enumeración)', async ({ request }) => {
  const a = await request.post('/api/auth', { data: { email: 'noexiste@x.com', password: 'x' }, headers: { 'X-Forwarded-For': freshIp() } });
  const b = await request.post('/api/auth', { data: { email: USER1_EMAIL, password: 'x' }, headers: { 'X-Forwarded-For': freshIp() } });
  expect(a.status()).toBe(401);
  expect(b.status()).toBe(401);
  expect((await a.json()).error).toBe((await b.json()).error);
});
