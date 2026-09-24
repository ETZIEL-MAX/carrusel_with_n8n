// Test end-to-end local. Levanta el servidor con datos temporales y verifica
// todos los endpoints reales. Uso: npm test
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3123;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = '10Cuidado.2026';
const WEBHOOK_SECRET = 'test-webhook-secret';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let pass = 0;
let total = 0;
function check(name, ok, extra = '') {
  total++;
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
}

const sign = (b) => createHmac('sha256', WEBHOOK_SECRET).update(b, 'utf8').digest('hex');
const J = (o) => JSON.stringify(o);

async function waitReady(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/api/images');
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const dataDir = await mkdtemp(join(tmpdir(), 'carousel-test-'));
await mkdir(join(dataDir, 'uploads'), { recursive: true });
await writeFile(join(dataDir, 'uploads', 'probe.png'), PNG);

const child = spawn(process.execPath, ['scripts/server.mjs'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    LOCAL_DATA_DIR: dataDir,
    LOCAL_STORAGE: '1',
    ADMIN_PASSWORD: PASSWORD,
    JWT_SECRET: 'test-jwt-secret-0123456789abcdef',
    WEBHOOK_SECRET,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

try {
  if (!(await waitReady())) throw new Error('El servidor no arrancó');

  console.log('\n== Estaticos ==');
  let r = await fetch(BASE + '/');
  let html = await r.text();
  check('GET /', r.status === 200, r.status);
  check('  carrusel presente', /id="carousel"/.test(html));
  r = await fetch(BASE + '/admin');
  check('GET /admin', r.status === 200, r.status);

  console.log('\n== API publica ==');
  r = await fetch(BASE + '/api/images');
  let data = await r.json();
  check('GET /api/images (seed)', r.status === 200 && data.images.length === 5, data.images.length + ' imagenes');

  console.log('\n== Auth ==');
  r = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: J({ password: PASSWORD }),
  });
  const sc = r.headers.get('set-cookie') || '';
  const cookie = sc.split(';')[0];
  check('login', r.status === 200, r.status);
  check('  cookie HttpOnly', /httponly/i.test(sc));
  check('  cookie SameSite=Strict', /samesite=strict/i.test(sc));

  console.log('\n== CRUD imagenes ==');
  r = await fetch(BASE + '/api/images', { method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ url: 'https://x.test/a.jpg', alt: 'A' }) });
  check('POST sin auth -> 401', r.status === 401, r.status);

  r = await fetch(BASE + '/api/images', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: J({ url: 'https://x.test/a.jpg', alt: 'Nueva A' }),
  });
  let added = await r.json();
  check('POST con auth', r.status === 200 && added.data.url === 'https://x.test/a.jpg', r.status);
  const idA = added.data.id;

  r = await fetch(BASE + '/api/images', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: J({ id: idA, alt: 'Renombrada' }),
  });
  check('PATCH parcial', r.status === 200 && (await r.json()).data.alt === 'Renombrada', r.status);

  r = await fetch(BASE + '/api/images?id=' + idA, { method: 'DELETE', headers: { cookie } });
  check('DELETE', r.status === 200, r.status);

  console.log('\n== Webhook (HMAC) ==');
  let body = J({ images: [{ url: 'https://x.test/1.jpg', alt: 'Uno' }, { url: 'https://x.test/2.jpg', alt: 'Dos' }] });
  r = await fetch(BASE + '/api/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'bad' }, body });
  check('firma mala -> 401', r.status === 401, r.status);
  r = await fetch(BASE + '/api/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  const wh = await r.json();
  check('reemplazo HMAC', r.status === 200 && wh.data.count === 2, r.status);

  console.log('\n== Upload (re-hospedaje local) ==');
  body = J({ url: `${BASE}/uploads/probe.png`, alt: 'Subida' });
  r = await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  const up = await r.json();
  check('upload OK', r.status === 200 && typeof up.data?.url === 'string', r.status + ' ' + (up.data?.url || up.error || ''));
  if (up.data?.url) {
    const img = await fetch(up.data.url);
    check('  imagen servida en /uploads', img.status === 200 && (img.headers.get('content-type') || '').includes('image'), img.status);
  }

  console.log('\n== Health ==');
  body = '{}';
  r = await fetch(BASE + '/api/health', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  const h = await r.json();
  check('health OK', r.status === 200 && h.ok === true, r.status);
  check('  modo local', h.redisConfigured === false && h.blobToken === false);

  console.log(`\nRESULT: ${pass}/${total}`);
} catch (err) {
  console.error('\nERROR:', err.message);
} finally {
  child.kill();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

process.exit(pass === total && total > 0 ? 0 : 1);
