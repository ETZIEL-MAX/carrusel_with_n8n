import { test, expect } from '@playwright/test';
import { uiLogin, apiLogin, uploadPoster, freshIp, sign, watchPage } from './helpers.js';

const XSS_ALT = `"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
const XSS_NAME = `<img src=x onerror="window.__xss=3">Mal`;

test.describe.configure({ mode: 'serial' });

let posterUrl;
test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  posterUrl = await uploadPoster(api, 'USER1', { label: 'XSS' });
  // USER2 (para probar acceso cruzado) con nombre malicioso
  await apiLogin(api); // super-admin
  const u = await api.post('/api/users', {
    data: { name: XSS_NAME, email: `xss${Date.now()}@local.test`, password: 'segura-123456' },
  });
  expect(u.ok()).toBeTruthy();
  await api.dispose();
});

test('XSS en alt: no se ejecuta en el admin ni en el carrusel público', async ({ page }) => {
  await uiLogin(page);
  const add = await page.request.post('/api/images?userId=USER1', { data: { url: posterUrl, alt: XSS_ALT } });
  expect(add.ok()).toBeTruthy();

  await page.reload();
  await page.waitForSelector('#userDashboard:not([hidden])');
  await expect(page.locator('.image-card__alt', { hasText: 'onerror' }).first()).toBeVisible(); // se ve como texto
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  await page.goto('/carrusel/USER1');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  // El alt quedó como atributo, no como HTML
  const alts = await page.locator('.slide img').evaluateAll((els) => els.map((e) => e.getAttribute('alt')));
  expect(alts).toContain(XSS_ALT);
});

test('XSS en nombre de usuario: no se ejecuta en el panel de super-admin', async ({ page }) => {
  await uiLogin(page, { asAdmin: true });
  await expect(page.locator('#superAdminGrid')).toContainText('onerror');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('URLs de imagen peligrosas se rechazan', async ({ page }) => {
  await uiLogin(page);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com/inseguro.png',
    'https://example.com/a.png" onerror="alert(1)',
    '/uploads/../kv/carousel_users.json',
  ]) {
    const r = await page.request.post('/api/images?userId=USER1', { data: { url, alt: 'x' } });
    expect(r.status(), url).toBe(400);
  }
});

test('headers de seguridad y CSP sin violaciones', async ({ page }) => {
  const w = watchPage(page);
  const res = await page.goto('/admin');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  await uiLogin(page);
  await page.goto('/carrusel/USER1');
  await page.waitForTimeout(1000);
  expect(await w.csp()).toEqual([]);
});

test('archivos internos no se pueden descargar', async ({ request }) => {
  for (const p of [
    '/package.json', '/.env', '/docker-compose.yml', '/Dockerfile', '/scripts/server.mjs',
    '/api/_utils.js', '/.data/kv/carousel_users.json', '/uploads/..%2Fkv%2Fcarousel_users.json',
    '/uploads/.%2E/kv/carousel_users.json', '/tests/helpers.js',
  ]) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(404);
    expect(await r.text()).not.toContain('passwordHash');
  }
});

test('permisos: sin sesión 401, usuario no ve datos de otro ni la lista de usuarios', async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.get('/api/images?userId=USER1')).status()).toBe(401);
  expect((await anon.get('/api/settings')).status()).toBe(401);
  expect((await anon.get('/api/users')).status()).toBe(401);
  await anon.dispose();

  const user = await playwright.request.newContext({ baseURL });
  await apiLogin(user, { email: 'user1@local.test' });
  // Pedir el carrusel de USER2 devuelve el propio (USER1), nunca el ajeno
  const own = await (await user.get('/api/images?userId=USER1')).json();
  const other = await (await user.get('/api/images?userId=USER2')).json();
  expect(other.data.images.map((i) => i.id)).toEqual(own.data.images.map((i) => i.id));
  expect((await user.get('/api/users')).status()).toBe(403);
  // Subir a otro usuario sí es 403 explícito
  expect((await user.post('/api/images-upload?userId=USER2', {
    multipart: { file: { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('x') } },
  })).status()).toBe(403);
  const s = await (await user.get('/api/settings?userId=USER2')).json();
  expect(s.data.userId).toBe('USER1'); // ignora el userId ajeno
  await user.dispose();
});

test('webhooks: firma inválida o ausente => 401', async ({ request }) => {
  const body = JSON.stringify({ images: [{ url: '/uploads/x.webp' }] });
  const bad = { 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp() };
  expect((await request.post('/api/webhook/USER1', { data: body, headers: bad })).status()).toBe(401);
  expect((await request.post('/api/webhook/USER1', { data: body, headers: { ...bad, 'X-Webhook-Secret': 'deadbeef' } })).status()).toBe(401);
  expect((await request.post('/api/settings-read/USER1', { data: '{}', headers: { ...bad, 'X-Webhook-Secret': sign('otro') } })).status()).toBe(401);
});

test('body demasiado grande => 413', async ({ request }) => {
  const big = 'x'.repeat(2 * 1024 * 1024);
  const r = await request.post('/api/auth', { data: big, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': freshIp() } });
  expect(r.status()).toBe(413);
});

test('subir algo que no es imagen => 400', async ({ page }) => {
  await uiLogin(page);
  const r = await page.request.post('/api/images-upload?userId=USER1', {
    multipart: { file: { name: 'malo.png', mimeType: 'image/png', buffer: Buffer.from('<?php echo 1; ?>') } },
  });
  expect(r.status()).toBe(400);
});

test('mass-assignment: PATCH no acepta campos arbitrarios', async ({ page }) => {
  await uiLogin(page);
  const list = await (await page.request.get('/api/images?userId=USER1')).json();
  const img = list.data.images[0];
  const r = await page.request.patch('/api/images?userId=USER1', {
    data: { id: img.id, alt: 'ok', createdAt: '1999-01-01', admin: true, foo: 'bar' },
  });
  const out = (await r.json()).data;
  expect(out.alt).toBe('ok');
  expect(out.foo).toBeUndefined();
  expect(out.admin).toBeUndefined();
  expect(out.createdAt).toBe(img.createdAt);
});
