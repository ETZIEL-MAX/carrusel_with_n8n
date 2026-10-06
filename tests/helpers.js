import { createHmac } from 'node:crypto';
import sharp from 'sharp';

export const SECRET = 'pw-test-webhook-secret-0123456789abcdef';
export const PASSWORD = '10Cuidado.2026';
export const USER1_EMAIL = 'user1@local.test';

// IP distinta por llamada: el rate-limit es por IP (X-Forwarded-For).
let n = 0;
export const freshIp = () => `10.${(Date.now() >> 8) & 255}.${Math.floor(Math.random() * 250)}.${(++n % 250) + 1}`;

export const sign = (body) => createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');

// Póster de prueba "real" (fotográfico + texto) para que el WebP tenga sentido.
export async function poster({ w = 1920, h = 1080, label = 'TEST', color = '#1e66f5' } = {}) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#111"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="30" y="30" width="${w - 60}" height="${h - 60}" fill="none" stroke="#fff" stroke-width="24"/>
    <text x="50%" y="50%" font-size="${Math.round(Math.min(w, h) / 7)}" fill="#fff" text-anchor="middle"
      font-family="Arial" font-weight="bold">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const signedHeaders = (body) => ({
  'Content-Type': 'application/json',
  'X-Webhook-Secret': sign(body),
  'X-Forwarded-For': freshIp(),
});

// Sube un póster por el endpoint firmado (como n8n). Devuelve la URL /uploads/...
export async function uploadPoster(api, userId, opts) {
  const buf = await poster(opts);
  const body = JSON.stringify({ data: buf.toString('base64'), contentType: 'image/png' });
  const res = await api.post(`/api/upload/${userId}`, { data: body, headers: signedHeaders(body) });
  if (!res.ok()) throw new Error(`upload ${res.status()} ${await res.text()}`);
  return (await res.json()).data.url;
}

// Reemplaza el carrusel completo (como n8n con mode=replace).
export async function setCarousel(api, userId, images) {
  const body = JSON.stringify({ images, mode: 'replace' });
  const res = await api.post(`/api/webhook/${userId}`, { data: body, headers: signedHeaders(body) });
  if (!res.ok()) throw new Error(`webhook ${res.status()} ${await res.text()}`);
  return res.json();
}

// Login por API (devuelve el contexto con la cookie).
export async function apiLogin(api, { email, password = PASSWORD } = {}) {
  const res = await api.post('/api/auth', {
    data: email ? { email, password } : { password },
    headers: { 'X-Forwarded-For': freshIp() },
  });
  if (!res.ok()) throw new Error(`login ${res.status()}`);
  return res;
}

// IP de prueba nueva solo para las llamadas a nuestra API (no a terceros como Google Fonts).
export async function useFreshIp(page) {
  const ip = freshIp();
  await page.route('**/api/**', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }));
}

// Login por la UI del admin.
export async function uiLogin(page, { asAdmin = false, email = USER1_EMAIL, password = PASSWORD } = {}) {
  await useFreshIp(page);
  await page.goto('/admin');
  if (asAdmin) {
    await page.fill('#adminPassword', password);
    await page.click('#adminLoginBtn');
    await page.waitForSelector('#superAdminDashboard:not([hidden])');
  } else {
    await page.click('.login-tab[data-mode="user"]');
    await page.fill('#userEmail', email);
    await page.fill('#userPassword', password);
    await page.click('#userLoginBtn');
    await page.waitForSelector('#userDashboard:not([hidden])');
  }
}

// Vigila errores de consola, requests fallidos y violaciones de CSP en una página.
export function watchPage(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (u.includes('fonts.g')) return; // fuentes de Google: externas, no son de la app
    problems.push(`requestfailed: ${u} ${r.failure()?.errorText}`);
  });
  page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return {
    problems,
    async csp() { return page.evaluate(() => window.__csp || []); },
  };
}
