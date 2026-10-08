import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { uiLogin, apiLogin, freshIp, poster, watchPage } from './helpers.js';

// Video subido desde el panel y reproducido en el carrusel.
// Usa el Chrome instalado: el Chromium que trae Playwright no decodifica H.264,
// que es justo el formato que se acepta.
test.use({ channel: 'chrome' });
test.describe.configure({ mode: 'serial' });

const FIXTURE = fileURLToPath(new URL('./fixtures/sample-h264.mp4', import.meta.url));
const EMAIL = `video${Date.now()}@local.test`;
const PASSWORD = 'video-segura-123';
let userId;

test.beforeAll(async ({ playwright }, testInfo) => {
  const api = await playwright.request.newContext({ baseURL: testInfo.project.use.baseURL });
  await apiLogin(api); // super-admin
  const res = await api.post('/api/users', {
    data: { name: 'Cliente Video', email: EMAIL, password: PASSWORD },
    headers: { 'X-Forwarded-For': freshIp() },
  });
  expect(res.ok()).toBeTruthy();
  userId = (await res.json()).data.userId;
  await api.dispose();
});

test('subir un video desde el panel: tarjeta, insignia y espacio', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await expect(page.locator('#cameraBtn')).toBeHidden(); // la cámara es solo para pantallas táctiles

  await page.setInputFiles('#uploadImgInput', FIXTURE);
  const card = page.locator('.image-card[data-type="video"]');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.image-card__badge')).toHaveText('▶ Video');
  await expect(card.locator('.image-card__alt')).toHaveText('sample h264');
  await expect(card.locator('.image-card__previews')).toHaveCount(0);
  await expect(page.locator('#userCountHint')).toHaveText('0 imágenes · 1 video');

  // La miniatura es el propio video (primer cuadro) y carga
  const thumb = card.locator('video.image-card__thumb');
  await expect.poll(() => thumb.evaluate((v) => v.readyState)).toBeGreaterThanOrEqual(1);
  expect(await thumb.getAttribute('src')).toMatch(new RegExp(`^/uploads/${userId}-[\\w-]+\\.mp4#t=0\\.1$`));

  // Cuenta contra su espacio
  await expect(page.locator('#storageText')).toHaveText('0.1 MB de 500 MB');
});

test('un archivo que no es video H.264 se rechaza con aviso', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await page.setInputFiles('#uploadImgInput', {
    name: 'falso.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('esto no es un video'),
  });
  await expect(page.locator('.toast--error')).toContainText('falso.mp4');
  await expect(page.locator('.image-card')).toHaveCount(1); // sigue solo el bueno
});

test('el carrusel reproduce el video silenciado y avanza cuando termina', async ({ page }) => {
  // Segunda diapositiva (imagen) para que haya a dónde avanzar
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  const png = await poster({ label: 'DESPUES' });
  await page.setInputFiles('#uploadImgInput', { name: 'despues.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.image-card')).toHaveCount(2);

  const watch = watchPage(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); // con "reducir movimiento" no avanza solo
  await page.goto(`/carrusel/${userId}`);

  const video = page.locator('.slide[data-index="0"] video');
  await expect(page.locator('.slide[data-index="0"]')).toHaveClass(/is-active/);
  await expect(video).toHaveClass(/is-loaded/);
  expect(await video.evaluate((v) => ({ muted: v.muted, inline: v.playsInline, loop: v.loop })))
    .toEqual({ muted: true, inline: true, loop: false });

  // Se está reproduciendo de verdad
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 8000 }).toBeGreaterThan(0.3);
  expect(await video.evaluate((v) => v.videoWidth)).toBe(640);

  // Dura ~2 s: al terminar pasa a la imagen (no espera los 8 s por defecto del carrusel)
  await expect(page.locator('.slide[data-index="1"]')).toHaveClass(/is-active/, { timeout: 6000 });
  expect(await video.evaluate((v) => v.paused)).toBe(true);

  expect(watch.problems).toEqual([]);
  expect(await watch.csp()).toEqual([]);
});

test('con duración propia, el video se corta a ese tiempo', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await page.locator('.image-card[data-type="video"] button[data-action="edit"]').click();
  await expect(page.locator('#imgModalTitle')).toHaveText('Editar video');
  await page.fill('#imgDuration', '4');
  await page.click('#imgSaveBtn');
  await expect(page.locator('.image-card[data-type="video"] .image-card__order')).toContainText('4 s');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/carrusel/${userId}`);
  const video = page.locator('.slide[data-index="0"] video');
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 8000 }).toBeGreaterThan(0.3);
  expect(await video.evaluate((v) => v.loop)).toBe(true); // 2 s de video en 4 s: se repite
  await page.waitForTimeout(2600);
  await expect(page.locator('.slide[data-index="0"]')).toHaveClass(/is-active/); // a los ~3 s sigue ahí
  await expect(page.locator('.slide[data-index="1"]')).toHaveClass(/is-active/, { timeout: 4000 });
});

test('el video se sirve por trozos; la TV lo guarda y la siguiente vez no lo baja', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  const src = await page.locator('.image-card[data-type="video"]').first().locator('.image-card__url').getAttribute('href');
  const partial = await page.request.get(src, { headers: { Range: 'bytes=0-99' } });
  expect(partial.status()).toBe(206);
  expect(partial.headers()['content-range']).toMatch(/^bytes 0-99\/\d+$/);
  expect(partial.headers()['content-type']).toBe('video/mp4');

  // Primera visita con service worker: se reproduce desde la red y, aparte, se guarda
  await page.goto(`/carrusel/${userId}`);
  await page.waitForFunction(() => navigator.serviceWorker?.controller);
  await page.reload();
  await expect(page.locator('.slide video')).toHaveClass(/is-loaded/);
  const stored = () => page.evaluate(async () => {
    const cache = await caches.open('carrusel-video-v1');
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  await expect.poll(stored, { timeout: 10000 }).toEqual([src]);

  // Segunda visita SIN red: el video sale de la copia guardada, por trozos
  await page.context().setOffline(true);
  await page.reload();
  const video = page.locator('.slide video');
  await expect(video).toHaveClass(/is-loaded/);
  await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 8000 }).toBeGreaterThan(0.3);
  const range = await page.evaluate(async (url) => {
    const res = await fetch(url, { headers: { Range: 'bytes=10-109' } });
    return { status: res.status, range: res.headers.get('content-range'), bytes: (await res.arrayBuffer()).byteLength };
  }, src);
  expect(range.status).toBe(206);
  expect(range.range).toMatch(/^bytes 10-109\/\d+$/);
  expect(range.bytes).toBe(100);
  await page.context().setOffline(false);
});

// Un video que el servidor no aceptaría (WebM VP9) se convierte en el navegador a MP4 H.264
// antes de subirlo. El WebM de prueba se genera aquí mismo con Mediabunny (no hay binario en el repo).
test('un WebM se convierte en el navegador y se sube como MP4', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  const h264 = readFileSync(FIXTURE).toString('base64');
  const webmB64 = await page.evaluate(async (b64) => {
    const mb = await import('/vendor/mediabunny.min.mjs');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(new Blob([bytes], { type: 'video/mp4' })) });
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.WebMOutputFormat(), target });
    const conversion = await mb.Conversion.init({ input, output, video: { codec: 'vp9' }, audio: { codec: 'opus' } });
    await conversion.execute();
    const out = new Uint8Array(target.buffer);
    let s = '';
    for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return btoa(s);
  }, h264);

  const before = await page.locator('.image-card[data-type="video"]').count();
  await page.setInputFiles('#uploadImgInput', { name: 'origen.webm', mimeType: 'video/webm', buffer: Buffer.from(webmB64, 'base64') });
  await expect(page.locator('.image-card[data-type="video"]')).toHaveCount(before + 1, { timeout: 60000 });
  const thumb = page.locator('.image-card[data-type="video"] video.image-card__thumb').last();
  await expect(thumb).toHaveAttribute('src', new RegExp(`^/uploads/${userId}-[\\w-]+\\.mp4#t=0\\.1$`));
});

// Si la librería de conversión no se puede descargar, un MP4 H.264 normal tiene que subir
// igual (el servidor lo valida), y el siguiente intento vuelve a probar la descarga.
test('sin la librería de conversión, un MP4 normal sube tal cual', async ({ page }) => {
  await uiLogin(page, { email: EMAIL, password: PASSWORD });
  await page.route('**/vendor/mediabunny.min.mjs', (route) => route.abort());
  const before = await page.locator('.image-card[data-type="video"]').count();
  await page.setInputFiles('#uploadImgInput', FIXTURE);
  await expect(page.locator('.image-card[data-type="video"]')).toHaveCount(before + 1, { timeout: 30000 });
});
