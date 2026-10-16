import { test, expect } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useFreshIp } from './helpers.js';

// Bandeja local: sin RESEND_API_KEY el servidor escribe los correos aquí (ver tests/serve.mjs).
const MAIL_DIR = join(tmpdir(), 'carrusel-playwright-data', 'mail');

async function linkFor(to, kind, count = 1) {
  for (let i = 0; i < 60; i++) {
    const files = (await readdir(MAIL_DIR).catch(() => [])).sort();
    const mails = [];
    for (const f of files) {
      const m = JSON.parse(await readFile(join(MAIL_DIR, f), 'utf8'));
      if (m.to === to) mails.push(m);
    }
    const m = mails[count - 1];
    const hit = m && new RegExp(`(/admin\\.html#${kind}=[A-Za-z0-9_-]+)`).exec(m.text);
    if (hit) return hit[1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No llegó el correo ${kind} a ${to}`);
}

test('crear cuenta, confirmar el correo y entrar directo al panel', async ({ page }) => {
  const email = `ui-${Date.now()}@example.com`;
  await useFreshIp(page);
  await page.goto('/admin');
  await page.click('.login-tab[data-mode="user"]');
  await page.click('#showSignupBtn');
  await page.fill('#signupName', 'Cliente Nuevo');
  await page.fill('#signupEmail', email);
  await page.fill('#signupPassword', 'clave-larga-123');
  await page.fill('#signupPassword2', 'otra-clave-123');
  await page.click('#signupBtn');
  await expect(page.locator('#signupError')).toHaveText(/no coinciden/);

  await page.fill('#signupPassword2', 'clave-larga-123');
  await page.click('#signupBtn');
  await expect(page.locator('#signupDone')).toContainText(email);

  await page.goto(await linkFor(email, 'verificar'));
  await expect(page.locator('#userDashboard')).toBeVisible();
  await expect(page.locator('#userDashboardTitle')).toHaveText('Cliente Nuevo');
  expect(page.url()).not.toContain('#verificar');

  // El mismo enlace ya no sirve: vuelve al login con el error.
  await page.click('#userLogoutBtn');
  await page.goto(await linkFor(email, 'verificar'));
  await expect(page.locator('#userLoginError')).toContainText(/no es válido/);
});

test('olvidé mi contraseña: el enlace del correo permite poner una nueva', async ({ page }) => {
  const email = `olvido-${Date.now()}@example.com`;
  await useFreshIp(page);
  const reg = await page.request.post('/api/account/register', {
    data: { name: 'Olvidadizo', email, password: 'clave-original-1' },
  });
  expect(reg.status()).toBe(200);
  await page.request.post('/api/account/verify', { data: { token: (await linkFor(email, 'verificar')).split('=')[1] } });
  await page.request.delete('/api/auth');

  await page.goto('/admin');
  await page.click('.login-tab[data-mode="user"]');
  await page.fill('#userEmail', email);
  await page.click('#showForgotBtn');
  await expect(page.locator('#forgotEmail')).toHaveValue(email);
  await page.click('#forgotBtn');
  await expect(page.locator('#forgotDone')).toContainText(email);

  await page.goto(await linkFor(email, 'restablecer', 2)); // el 1º fue el de verificar
  await expect(page.locator('#panelReset')).toBeVisible();
  await page.fill('#resetPassword', 'clave-nueva-2026');
  await page.fill('#resetPassword2', 'clave-nueva-2026');
  await page.click('#resetBtn');
  await expect(page.locator('#userLoginOk')).toContainText('Contraseña actualizada');

  await page.fill('#userEmail', email);
  await page.fill('#userPassword', 'clave-nueva-2026');
  await page.click('#userLoginBtn');
  await expect(page.locator('#userDashboard')).toBeVisible();
});
