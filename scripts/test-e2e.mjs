// Test end-to-end local. Levanta el servidor con datos temporales y verifica
// todos los endpoints reales. Uso: npm test
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
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
      const r = await fetch(BASE + '/api/auth');
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
    RATE_LIMIT_AUTH: '100',
    MANUAL_UPLOAD_MAX_BYTES: String(700 * 1024),
    UPLOAD_MAX_BYTES: String(900 * 1024),
    UPLOAD_BASE64_MAX_BYTES: String(700 * 1024),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

async function runTests() {
  if (!(await waitReady())) throw new Error('El servidor no arrancó');

  console.log('\n== Sintaxis frontend ==');
  for (const f of ['admin.js', 'api.js', 'carousel.js', 'sw.js', 'scripts/server.mjs', 'api/_webhook-shared.js', 'api/usage.js', 'api/_stream.js', 'api/images-upload.js', 'api/_store.js', 'api/_utils.js', 'scripts/migrate-storage.mjs']) {
    const code = await new Promise((resolve) => {
      const p = spawn(process.execPath, ['--check', join(ROOT, f)], { stdio: 'inherit' });
      p.on('exit', resolve);
    });
    check(`node --check ${f}`, code === 0);
  }

  console.log('\n== Estaticos ==');
  let r = await fetch(BASE + '/');
  let html = await r.text();
  check('GET / (admin.html)', r.status === 200, r.status);
  check('  admin login presente', /loginView/.test(html));
  
  r = await fetch(BASE + '/admin');
  check('GET /admin', r.status === 200, r.status);

  r = await fetch(BASE + '/carrusel/USER1');
  check('GET /carrusel/USER1 (index.html)', r.status === 200, r.status);

  console.log('\n== Auth ==');
  // Super-admin login
  r = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: J({ password: PASSWORD }),
  });
  const sc = r.headers.get('set-cookie') || '';
  const adminCookie = sc.split(';')[0];
  check('super-admin login', r.status === 200, r.status);
  check('  cookie HttpOnly', /httponly/i.test(sc));
  check('  cookie SameSite=Strict', /samesite=strict/i.test(sc));
  const adminAuth = await r.json();
  check('  role super-admin', adminAuth.data?.role === 'super-admin', adminAuth.data?.role);

  // User login with wrong password (seed USER1 has email user1@local.test)
  r = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: J({ email: 'user1@local.test', password: 'wrong' }),
  });
  check('user login wrong pwd -> 401', r.status === 401, r.status);

  // Old-style login with userId instead of email must fail
  r = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: J({ userId: 'USER1', password: 'wrong' }),
  });
  check('user login with userId -> 401', r.status === 401, r.status);

  console.log('\n== Super-Admin: User Management ==');
  // Get users list (should have USER1 from seed, with name/email/imageCount)
  r = await fetch(BASE + '/api/users', { headers: { cookie: adminCookie } });
  check('GET /api/users (super-admin)', r.status === 200, r.status);
  let usersData = await r.json();
  const seedUser = usersData.data?.users?.find(u => u.userId === 'USER1');
  check('  USER1 exists', Boolean(seedUser), usersData.data?.users?.map(u => u.userId));
  check('  USER1 has email', seedUser?.email === 'user1@local.test', seedUser?.email);
  check('  USER1 imageCount', seedUser?.imageCount === 5, seedUser?.imageCount);
  check('  USER1 preview', Array.isArray(seedUser?.preview) && seedUser.preview.length === 3, seedUser?.preview?.length);
  check('  no passwordHash leaked', !JSON.stringify(usersData).includes('passwordHash'));

  // Create new user USER2 with name + email
  r = await fetch(BASE + '/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ name: 'Usuario Dos', email: 'user2@example.com', password: 'user2pass123' }),
  });
  let newUser = await r.json();
  check('POST /api/users create USER2', r.status === 200, r.status);
  check('  userId returned', newUser.data?.userId === 'USER2', newUser.data?.userId);
  check('  name/email returned', newUser.data?.name === 'Usuario Dos' && newUser.data?.email === 'user2@example.com');
  const user2Password = newUser.data?.password;

  // Duplicate email -> 409
  r = await fetch(BASE + '/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ name: 'Duplicado', email: 'USER2@EXAMPLE.COM', password: 'otherpass123' }),
  });
  check('POST duplicate email -> 409', r.status === 409, r.status);

  // Invalid email -> 400
  r = await fetch(BASE + '/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ name: 'Malo', email: 'not-an-email', password: 'otherpass123' }),
  });
  check('POST invalid email -> 400', r.status === 400, r.status);

  // Edit USER2 name + email
  r = await fetch(BASE + '/api/users?userId=USER2', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ name: 'Usuario Dos Editado', email: 'user2b@example.com' }),
  });
  const edited = await r.json();
  check('PATCH /api/users edit USER2', r.status === 200 && edited.data?.email === 'user2b@example.com', r.status);

  // Change USER2 password
  r = await fetch(BASE + '/api/users/password?userId=USER2', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ password: 'newpass456' }),
  });
  check('PATCH /api/users/password?userId=USER2', r.status === 200, r.status);

  // Old email no longer works
  r = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: J({ email: 'user2@example.com', password: 'newpass456' }),
  });
  check('USER2 login old email -> 401', r.status === 401, r.status);

  // User login with new email + password
  r = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: J({ email: 'user2b@example.com', password: 'newpass456' }),
  });
  const userSc = r.headers.get('set-cookie') || '';
  const userCookie = userSc.split(';')[0];
  check('USER2 login', r.status === 200, r.status);
  const userAuth = await r.json();
  check('  role user', userAuth.data?.role === 'user', userAuth.data?.role);
  check('  userId USER2', userAuth.data?.userId === 'USER2', userAuth.data?.userId);
  check('  name returned', userAuth.data?.name === 'Usuario Dos Editado', userAuth.data?.name);
  void user2Password;

  console.log('\n== Admin Images (super-admin scoped) ==');
  // Super-admin GET images for USER1 (needs userId param)
  r = await fetch(BASE + '/api/images?userId=USER1', { headers: { cookie: adminCookie } });
  let imagesData = await r.json();
  check('GET /api/images?userId=USER1', r.status === 200, r.status);
  check('  5 seed images', imagesData.data?.images?.length === 5, imagesData.data?.images?.length);

  // Super-admin add image to USER1
  r = await fetch(BASE + '/api/images?userId=USER1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ url: 'https://x.test/admin-add.jpg', alt: 'Admin added' }),
  });
  let added = await r.json();
  check('POST /api/images?userId=USER1', r.status === 200, r.status);
  const idA = added.data?.id;

  // Super-admin update image
  r = await fetch(BASE + '/api/images?userId=USER1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ id: idA, alt: 'Renombrada por admin' }),
  });
  check('PATCH /api/images?userId=USER1', r.status === 200, r.status);
  check('  alt updated', (await r.json()).data?.alt === 'Renombrada por admin', r.status);

  // Duración por imagen
  r = await fetch(BASE + '/api/images?userId=USER1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ id: idA, duration: 20 }),
  });
  check('PATCH duration 20', r.status === 200 && (await r.json()).data?.duration === 20, r.status);
  for (const bad of [1, 3601, 2.5, '20']) {
    r = await fetch(BASE + '/api/images?userId=USER1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: J({ id: idA, duration: bad }),
    });
    check(`PATCH duration ${JSON.stringify(bad)} -> 400`, r.status === 400, r.status);
  }
  r = await fetch(BASE + '/api/images?userId=USER1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ id: idA, duration: null }),
  });
  check('PATCH duration null (vuelve al default)', r.status === 200 && (await r.json()).data?.duration === null, r.status);
  r = await fetch(BASE + '/api/images?userId=USER1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ url: 'https://x.test/bad-duration.jpg', duration: 0 }),
  });
  check('POST duration 0 -> 400', r.status === 400, r.status);

  // Super-admin reorder
  r = await fetch(BASE + '/api/images?userId=USER1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J([{ id: idA, order: 0 }]),
  });
  check('PATCH reorder', r.status === 200, r.status);

  // Super-admin delete
  r = await fetch(BASE + `/api/images?userId=USER1&id=${idA}`, { method: 'DELETE', headers: { cookie: adminCookie } });
  check('DELETE /api/images?userId=USER1', r.status === 200, r.status);

  console.log('\n== User Images (USER2 scoped) ==');
  // User GET own images
  r = await fetch(BASE + '/api/images?userId=USER2', { headers: { cookie: userCookie } });
  imagesData = await r.json();
  check('GET /api/images?userId=USER2 (user)', r.status === 200, r.status);
  check('  empty initially', imagesData.data?.images?.length === 0, imagesData.data?.images?.length);

  // User add image
  r = await fetch(BASE + '/api/images?userId=USER2', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: userCookie },
    body: J({ url: 'https://x.test/user2.jpg', alt: 'User2 image' }),
  });
  added = await r.json();
  check('POST /api/images?userId=USER2 (user)', r.status === 200, r.status);
  const idB = added.data?.id;

  // User update
  r = await fetch(BASE + '/api/images?userId=USER2', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: userCookie },
    body: J({ id: idB, alt: 'Updated by user' }),
  });
  check('PATCH by user', r.status === 200, r.status);

  // User reorder
  r = await fetch(BASE + '/api/images?userId=USER2', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: userCookie },
    body: J([{ id: idB, order: 0 }]),
  });
  check('PATCH reorder by user', r.status === 200, r.status);

  // User delete
  r = await fetch(BASE + `/api/images?userId=USER2&id=${idB}`, { method: 'DELETE', headers: { cookie: userCookie } });
  check('DELETE by user', r.status === 200, r.status);

  console.log('\n== Public Carrusel API ==');
  r = await fetch(BASE + '/api/carrusel?userId=USER1');
  imagesData = await r.json();
  check('GET /api/carrusel?userId=USER1 (public)', r.status === 200, r.status);
  check('  5 seed images', imagesData.data?.images?.length === 5, imagesData.data?.images?.length);
  check('  slideDuration por defecto 8', imagesData.data?.slideDuration === 8, imagesData.data?.slideDuration);

  // Duración por defecto del carrusel (settings)
  r = await fetch(BASE + '/api/settings?userId=USER1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ slideDuration: 12 }),
  });
  check('PATCH settings slideDuration 12', r.status === 200 && (await r.json()).data?.slideDuration === 12, r.status);
  r = await fetch(BASE + '/api/settings?userId=USER1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ slideDuration: 1 }),
  });
  check('PATCH settings slideDuration 1 -> 400', r.status === 400, r.status);
  r = await fetch(BASE + '/api/carrusel?userId=USER1');
  check('  carrusel publica slideDuration 12', (await r.json()).data?.slideDuration === 12, r.status);

  r = await fetch(BASE + '/api/carrusel?userId=INVALID');
  check('GET /api/carrusel invalid userId -> 400', r.status === 400, r.status);

  console.log('\n== Webhook (HMAC, por carrusel) ==');
  // Endpoints globales retirados
  r = await fetch(BASE + '/api/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'x' }, body: '{}' });
  check('webhook global -> 410', r.status === 410, r.status);
  r = await fetch(BASE + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'x' }, body: '{}' });
  check('upload global -> 410', r.status === 410, r.status);

  // Firma incorrecta
  let body = J({ images: [{ url: 'https://x.test/1.jpg' }] });
  r = await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'bad' }, body });
  check('webhook/USER1 firma mala -> 401', r.status === 401, r.status);

  // Carrusel inexistente -> 404
  body = J({ images: [{ url: 'https://x.test/nouser.jpg' }] });
  r = await fetch(BASE + '/api/webhook/USER999', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  check('webhook/USER999 inexistente -> 404', r.status === 404, r.status);

  // userId del cuerpo distinto al de la URL -> 400
  body = J({ userId: 'USER2', images: [{ url: 'https://x.test/mismatch.jpg' }] });
  r = await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  check('webhook userId body != URL -> 400', r.status === 400, r.status);

  // mode inválido -> 400
  body = J({ images: [{ url: 'https://x.test/mode.jpg' }], mode: 'bad' });
  r = await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  check('webhook mode invalido -> 400', r.status === 400, r.status);

  // Append por defecto: USER1 tenía 5 seed, agrega 2
  body = J({ images: [{ url: 'https://x.test/1.jpg', alt: 'Uno' }, { url: 'https://x.test/2.jpg', alt: 'Dos' }] });
  r = await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  let wh = await r.json();
  check('webhook append USER1', r.status === 200 && wh.data.count === 2 && wh.data.skipped === 0, r.status + ' count=' + wh.data?.count);
  check('  total 7 (5 seed + 2)', wh.data.images?.length === 7, wh.data.images?.length);

  // Dedupe: reenviar una URL ya presente + una nueva
  body = J({ images: [{ url: 'https://x.test/1.jpg', alt: 'Uno' }, { url: 'https://x.test/3.jpg', alt: 'Tres' }] });
  r = await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  wh = await r.json();
  check('webhook dedupe USER1', r.status === 200 && wh.data.count === 1 && wh.data.skipped === 1, r.status + ' count=' + wh.data?.count + ' skipped=' + wh.data?.skipped);
  check('  total 8', wh.data.images?.length === 8, wh.data.images?.length);

  // replace reemplaza todo
  body = J({ images: [{ url: 'https://x.test/only.jpg', alt: 'Solo' }], mode: 'replace' });
  r = await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  wh = await r.json();
  check('webhook replace USER1', r.status === 200 && wh.data.count === 1 && wh.data.images?.length === 1, r.status + ' total=' + wh.data?.images?.length);

  console.log('\n== Manage (HMAC, desde el chat) ==');
  const manage = async (payload, user = 'USER1', sig) => {
    const b = J(payload);
    const res = await fetch(BASE + '/api/manage/' + user, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sig || sign(b) }, body: b });
    return { status: res.status, json: await res.json() };
  };
  // Dejar USER1 con 3 imágenes conocidas
  body = J({ images: [{ url: 'https://x.test/m1.jpg' }, { url: 'https://x.test/m2.jpg' }, { url: 'https://x.test/m3.jpg' }], mode: 'replace' });
  await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });

  let mg = await manage({ action: 'list' }, 'USER1', 'bad');
  check('manage firma mala -> 401', mg.status === 401, mg.status);
  mg = await manage({ action: 'list' }, 'USER999');
  check('manage carrusel inexistente -> 404', mg.status === 404, mg.status);

  mg = await manage({ action: 'list' });
  check('manage list', mg.status === 200 && mg.json.data?.count === 3, mg.status + ' count=' + mg.json.data?.count);
  check('  indices 1..3 en orden', mg.json.data?.images?.map((i) => i.index).join() === '1,2,3' && mg.json.data.images[1].url === 'https://x.test/m2.jpg', mg.json.data?.images?.map((i) => i.url).join());
  check('  duracion efectiva = default (12)', mg.json.data?.images?.[0]?.effectiveDuration === 12 && mg.json.data.images[0].duration === null, mg.json.data?.images?.[0]?.effectiveDuration);

  mg = await manage({ action: 'duration', index: 2, duration: 25 });
  check('manage duration #2 = 25', mg.status === 200 && mg.json.data?.duration === 25 && mg.json.data?.url === 'https://x.test/m2.jpg', mg.status);
  mg = await manage({ action: 'duration', index: 2, duration: 99999 });
  check('manage duration fuera de rango -> 400', mg.status === 400, mg.status);
  mg = await manage({ action: 'duration', index: 9, duration: 10 });
  check('manage duration indice inexistente -> 404', mg.status === 404, mg.status + ' ' + mg.json.error);
  mg = await manage({ action: 'duration', index: 'all', duration: 15 });
  check('manage duration todas = 15', mg.status === 200 && mg.json.data?.slideDuration === 15, mg.status);

  mg = await manage({ action: 'delete', index: 7 });
  check('manage delete indice inexistente -> 404', mg.status === 404, mg.status);
  mg = await manage({ action: 'delete', index: 1 });
  check('manage delete #1', mg.status === 200 && mg.json.data?.count === 2 && mg.json.data?.url === 'https://x.test/m1.jpg', mg.status + ' count=' + mg.json.data?.count);
  mg = await manage({ action: 'list' });
  check('  quedan m2 y m3', mg.json.data?.images?.map((i) => i.url).join() === 'https://x.test/m2.jpg,https://x.test/m3.jpg', mg.json.data?.images?.map((i) => i.url).join());
  // m2 conserva su duracion propia (25); m3 usa la del carrusel (15). Max 10 llamadas/min por el rate limit.
  check('  m2 = 25 s, m3 = default 15 s', mg.json.data?.images?.map((i) => i.effectiveDuration).join() === '25,15', mg.json.data?.images?.map((i) => i.effectiveDuration).join());

  console.log('\n== Upload (re-hospedaje local, por carrusel) ==');
  body = J({ url: `${BASE}/uploads/probe.png`, alt: 'Subida' });
  r = await fetch(BASE + '/api/upload/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  const up = await r.json();
  check('upload/USER1 OK', r.status === 200 && typeof up.data?.url === 'string', r.status + ' ' + (up.data?.url || up.error || ''));
  check('  userId sale de la URL', up.data?.userId === 'USER1', up.data?.userId);
  check('  url relativa (/uploads)', String(up.data?.url || '').startsWith('/uploads/'), up.data?.url);
  if (up.data?.url) {
    const img = await fetch(BASE + up.data.url);
    check('  imagen servida en /uploads', img.status === 200 && (img.headers.get('content-type') || '').includes('image'), img.status);
  }

  // Modo binario (base64 en el cuerpo), como lo manda n8n
  body = J({ data: PNG.toString('base64'), contentType: 'image/png', alt: '' });
  r = await fetch(BASE + '/api/upload/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  const upBin = await r.json();
  check('upload binario base64', r.status === 200 && typeof upBin.data?.url === 'string', r.status + ' ' + (upBin.data?.url || upBin.error || ''));
  if (upBin.data?.url) {
    const img = await fetch(BASE + upBin.data.url);
    check('  binario servido como imagen', img.status === 200 && (img.headers.get('content-type') || '').includes('image'), img.status);
  }

  // Binario no-imagen -> 400
  body = J({ data: Buffer.from('<script>alert(1)</script>').toString('base64') });
  r = await fetch(BASE + '/api/upload/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  check('binario no-imagen -> 400', r.status === 400, r.status);

  // El webhook debe aceptar la URL relativa /uploads/... (imagen re-hospedada)
  if (upBin.data?.url) {
    body = J({ images: [{ url: upBin.data.url, alt: '' }], mode: 'append' });
    r = await fetch(BASE + '/api/webhook/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
    const whRel = await r.json();
    check('webhook acepta /uploads/...', r.status === 200 && whRel.data?.count === 1, r.status + ' count=' + whRel.data?.count);
  }

  // userId del cuerpo distinto al de la URL -> 400
  body = J({ url: `${BASE}/uploads/probe.png`, userId: 'USER2' });
  r = await fetch(BASE + '/api/upload/USER1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  check('upload userId body != URL -> 400', r.status === 400, r.status);

  // Carrusel inexistente: no se guarda nada
  body = J({ data: PNG.toString('base64'), contentType: 'image/png' });
  r = await fetch(BASE + '/api/upload/USER999', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  check('upload/USER999 inexistente -> 404', r.status === 404, r.status);

  console.log('\n== Manual upload (cuerpo crudo) ==');

  // User uploads to own carousel
  r = await fetch(BASE + '/api/images-upload?alt=Foto%20del%20movil', { method: 'POST', headers: { cookie: userCookie, 'content-type': 'image/png' }, body: PNG });
  let mu = await r.json();
  check('user upload own carousel', r.status === 200 && mu.data?.userId === 'USER2', r.status + ' ' + (mu.error || ''));
  check('  alt saved', mu.data?.alt === 'Foto del movil', mu.data?.alt);
  if (mu.data?.url) {
    const img = await fetch(BASE + mu.data.url);
    check('  file served', img.status === 200 && (img.headers.get('content-type') || '').includes('image'), img.status);
  }
  r = await fetch(BASE + '/api/carrusel?userId=USER2');
  imagesData = await r.json();
  check('  appears in public carousel', imagesData.data?.images?.some((i) => i.id === mu.data?.id));

  // Super-admin uploads to USER1
  r = await fetch(BASE + '/api/images-upload?userId=USER1', { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'image/png' }, body: PNG });
  mu = await r.json();
  check('super-admin upload to USER1', r.status === 200 && mu.data?.userId === 'USER1', r.status);

  // Rejections
  r = await fetch(BASE + '/api/images-upload', { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG });
  check('upload without session -> 401', r.status === 401, r.status);
  r = await fetch(BASE + '/api/images-upload?userId=USER1', { method: 'POST', headers: { cookie: userCookie, 'content-type': 'image/png' }, body: PNG });
  check('user upload to other carousel -> 403', r.status === 403, r.status);
  r = await fetch(BASE + '/api/images-upload', { method: 'POST', headers: { cookie: userCookie, 'content-type': 'image/png' }, body: Buffer.from('<script>alert(1)</script>') });
  check('non-image disguised as png -> 400', r.status === 400, r.status);
  r = await fetch(BASE + '/api/images-upload', { method: 'POST', headers: { cookie: adminCookie, 'content-type': 'image/png' }, body: PNG });
  check('super-admin without userId -> 400', r.status === 400, r.status);

  console.log('\n== Delete User ==');
  // Create USER3 with an image, then delete and verify cleanup
  r = await fetch(BASE + '/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ name: 'Borrable', email: 'borrable@example.com', password: 'borrable123' }),
  });
  const doomed = await r.json();
  check('POST create USER3', r.status === 200 && doomed.data?.userId === 'USER3', r.status);
  r = await fetch(BASE + '/api/images?userId=USER3', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: J({ url: 'https://x.test/doomed.jpg', alt: 'Doomed' }),
  });
  check('POST image to USER3', r.status === 200, r.status);

  r = await fetch(BASE + '/api/users?userId=USER3', { method: 'DELETE', headers: { cookie: adminCookie } });
  check('DELETE /api/users?userId=USER3', r.status === 200, r.status);

  r = await fetch(BASE + '/api/users', { headers: { cookie: adminCookie } });
  usersData = await r.json();
  check('  USER3 gone from list', !usersData.data?.users?.some(u => u.userId === 'USER3'));

  r = await fetch(BASE + '/api/carrusel?userId=USER3');
  imagesData = await r.json();
  check('  USER3 carousel empty', r.status === 200 && (imagesData.data?.images?.length || 0) === 0, r.status);

  r = await fetch(BASE + '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: J({ email: 'borrable@example.com', password: 'borrable123' }),
  });
  check('  deleted user login -> 401', r.status === 401, r.status);

  r = await fetch(BASE + '/api/users?userId=USER999', { method: 'DELETE', headers: { cookie: adminCookie } });
  check('DELETE unknown user -> 404', r.status === 404, r.status);

  // ---------- Token por cliente, espacio, consumo y sesiones ----------
  // (USER3 se borró arriba, así que el siguiente usuario vuelve a ser USER3.)
  let ipN = 0;
  const ip = () => `10.9.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`; // IP nueva: esquiva el rate limit por IP
  const signClient = (token, b, ts) => createHmac('sha256', token).update(`${ts}.${b}`, 'utf8').digest('hex');
  const now = () => Math.floor(Date.now() / 1000);
  const adminJson = (path, method, payload) => fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: adminCookie, 'x-forwarded-for': ip() },
    body: payload === undefined ? undefined : J(payload),
  });
  // Petición firmada como la haría n8n con el token del cliente.
  const clientPost = async (path, token, payload, { ts = now(), sig } = {}) => {
    const b = typeof payload === 'string' ? payload : J(payload);
    const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip() };
    if (ts !== null) headers['x-webhook-timestamp'] = String(ts);
    headers['x-webhook-secret'] = sig || signClient(token, b, ts);
    const res = await fetch(BASE + path, { method: 'POST', headers, body: b });
    return { status: res.status, json: await res.json().catch(() => ({})), sig: headers['x-webhook-secret'], ts, body: b };
  };

  console.log('\n== Token por cliente ==');
  r = await adminJson('/api/users', 'POST', { name: 'Cliente Token', email: 'token@example.com', password: 'cliente-token-1' });
  const tk = await r.json();
  check('crear USER3 (cliente con token)', r.status === 200 && tk.data?.userId === 'USER3', r.status + ' ' + tk.data?.userId);

  r = await adminJson('/api/users', 'POST', { name: 'Corta', email: 'corta@example.com', password: '123456789' });
  check('contraseña de 9 caracteres -> 400', r.status === 400, r.status);

  // Sin token todavía: sigue valiendo la firma global antigua
  body = J({ images: [{ url: 'https://x.test/legacy.jpg' }] });
  r = await fetch(BASE + '/api/webhook/USER3', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body), 'x-forwarded-for': ip() }, body });
  check('sin token: firma global aceptada', r.status === 200, r.status);

  r = await fetch(BASE + '/api/users/token?userId=USER3', { method: 'POST', headers: { cookie: userCookie, 'x-forwarded-for': ip() } });
  check('usuario normal no puede generar token -> 403', r.status === 403, r.status);

  r = await adminJson('/api/users/token?userId=USER3', 'POST');
  const gen = await r.json();
  const token1 = gen.data?.token || '';
  check('generar token', r.status === 200 && /^crt_[A-Za-z0-9_-]{40,}$/.test(token1), r.status);
  check('  hint = últimos 4', gen.data?.hint === token1.slice(-4), gen.data?.hint);
  r = await adminJson('/api/users/token?userId=USER999', 'POST');
  check('generar token usuario inexistente -> 404', r.status === 404, r.status);

  r = await fetch(BASE + '/api/users', { headers: { cookie: adminCookie } });
  const listRaw = await r.text();
  const u3 = JSON.parse(listRaw).data.users.find((u) => u.userId === 'USER3');
  check('  lista: hasToken + hint, sin el token', u3?.hasToken === true && u3?.tokenHint === token1.slice(-4) && !listRaw.includes(token1) && !listRaw.includes('webhookTokenEnc'));

  // Con token: la firma global ya no sirve para este cliente
  body = J({ images: [{ url: 'https://x.test/legacy2.jpg' }] });
  r = await fetch(BASE + '/api/webhook/USER3', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body), 'x-forwarded-for': ip() }, body });
  check('con token: firma global rechazada -> 401', r.status === 401, r.status);

  let cp = await clientPost('/api/webhook/USER3', token1, { images: [{ url: 'https://x.test/t1.jpg' }] }, { ts: null, sig: 'ab'.repeat(32) });
  check('sin timestamp -> 401', cp.status === 401, cp.status);
  cp = await clientPost('/api/webhook/USER3', token1, { images: [{ url: 'https://x.test/t1.jpg' }] }, { ts: now() - 3600 });
  check('timestamp viejo -> 401', cp.status === 401, cp.status + ' ' + cp.json.error);
  cp = await clientPost('/api/webhook/USER3', 'crt_token-equivocado', { images: [{ url: 'https://x.test/t1.jpg' }] });
  check('token equivocado -> 401', cp.status === 401, cp.status);
  cp = await clientPost('/api/webhook/USER3', token1, { images: [{ url: 'https://x.test/t1.jpg' }] });
  check('firma con token correcta', cp.status === 200 && cp.json.data?.count === 1, cp.status + ' ' + (cp.json.error || ''));
  // Repetir exactamente la misma petición (misma firma y timestamp)
  r = await fetch(BASE + '/api/webhook/USER3', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-timestamp': String(cp.ts), 'x-webhook-secret': cp.sig, 'x-forwarded-for': ip() }, body: cp.body });
  check('petición repetida -> 401', r.status === 401, r.status);
  cp = await clientPost('/api/webhook/USER1', token1, { images: [{ url: 'https://x.test/cross.jpg' }] });
  check('token de USER3 contra USER1 -> 401', cp.status === 401, cp.status);
  cp = await clientPost('/api/manage/USER3', token1, { action: 'list' });
  check('manage con token', cp.status === 200 && cp.json.data?.count === 2, cp.status + ' count=' + cp.json.data?.count);
  cp = await clientPost('/api/settings-read/USER3', token1, '{}');
  check('settings-read con token', cp.status === 200, cp.status);

  r = await adminJson('/api/users/token?userId=USER3', 'POST');
  const token2 = (await r.json()).data?.token || '';
  check('regenerar token', r.status === 200 && token2 && token2 !== token1, r.status);
  cp = await clientPost('/api/manage/USER3', token1, { action: 'list' });
  check('  token anterior -> 401', cp.status === 401, cp.status);
  cp = await clientPost('/api/manage/USER3', token2, { action: 'list' });
  check('  token nuevo OK', cp.status === 200, cp.status);

  console.log('\n== Espacio por usuario ==');
  r = await adminJson('/api/usage?userId=USER3', 'GET');
  let us = await r.json();
  check('GET /api/usage?userId=USER3', r.status === 200 && us.data?.storage?.usedBytes === 0, r.status + ' used=' + us.data?.storage?.usedBytes);
  check('  límite por defecto 500 MB', us.data?.storage?.limitBytes === 500 * 1024 * 1024, us.data?.storage?.limitBytes);

  r = await adminJson('/api/users?userId=USER3', 'PATCH', { storageLimitMb: 0 });
  check('límite 0 -> 400', r.status === 400, r.status);
  r = await adminJson('/api/users?userId=USER3', 'PATCH', { storageLimitMb: 1 });
  check('límite 1 MB', r.status === 200 && (await r.json()).data?.storageLimitMb === 1, r.status);

  // GIF de 600 KB (los GIF se guardan tal cual, sin recomprimir)
  const BIG = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(600 * 1024)]);
  r = await fetch(BASE + '/api/images-upload?userId=USER3', { method: 'POST', headers: { cookie: adminCookie, 'x-forwarded-for': ip(), 'content-type': 'image/gif' }, body: BIG });
  const big1 = await r.json();
  check('subir 600 KB (cabe en 1 MB)', r.status === 200 && /^\/uploads\/USER3-/.test(big1.data?.url || ''), r.status + ' ' + (big1.data?.url || big1.error));
  r = await adminJson('/api/usage?userId=USER3', 'GET');
  us = await r.json();
  check('  usado = 600 KB, 1 archivo', us.data?.storage?.usedBytes === BIG.length && us.data?.storage?.fileCount === 1, us.data?.storage?.usedBytes);

  r = await fetch(BASE + '/api/images-upload?userId=USER3', { method: 'POST', headers: { cookie: adminCookie, 'x-forwarded-for': ip(), 'content-type': 'image/gif' }, body: BIG });
  let full = await r.json();
  check('segunda subida excede -> 413 QUOTA_EXCEEDED', r.status === 413 && full.details?.code === 'QUOTA_EXCEEDED', r.status + ' ' + full.details?.code);
  cp = await clientPost('/api/upload/USER3', token2, { data: BIG.toString('base64'), contentType: 'image/gif' });
  check('subida de n8n también -> 413', cp.status === 413 && cp.json.details?.code === 'QUOTA_EXCEEDED', cp.status);

  r = await fetch(BASE + '/api/users', { headers: { cookie: adminCookie } });
  const u3b = (await r.json()).data.users.find((u) => u.userId === 'USER3');
  check('  lista de usuarios trae uso y límite', u3b?.usedBytes === BIG.length && u3b?.limitBytes === 1024 * 1024 && u3b?.storageLimitMb === 1, u3b?.usedBytes + '/' + u3b?.limitBytes);

  // Un archivo de USER3 añadido por URL a otro carrusel no se borra al quitarlo de allí
  r = await adminJson('/api/images?userId=USER1', 'POST', { url: big1.data.url, alt: 'ajena' });
  const foreign = await r.json();
  r = await fetch(BASE + `/api/images?userId=USER1&id=${foreign.data?.id}`, { method: 'DELETE', headers: { cookie: adminCookie } });
  const still = await fetch(BASE + big1.data.url);
  check('archivo ajeno no se borra desde otro carrusel', r.status === 200 && still.status === 200, r.status + '/' + still.status);

  r = await fetch(BASE + `/api/images?userId=USER3&id=${big1.data.id}`, { method: 'DELETE', headers: { cookie: adminCookie } });
  const gone = await fetch(BASE + big1.data.url);
  r = await adminJson('/api/usage?userId=USER3', 'GET');
  us = await r.json();
  check('borrar la imagen libera el espacio', gone.status === 404 && us.data?.storage?.usedBytes === 0, gone.status + ' used=' + us.data?.storage?.usedBytes);
  r = await fetch(BASE + '/api/images-upload?userId=USER3', { method: 'POST', headers: { cookie: adminCookie, 'x-forwarded-for': ip(), 'content-type': 'image/gif' }, body: BIG });
  check('  y se puede volver a subir', r.status === 200, r.status);
  r = await adminJson('/api/users?userId=USER3', 'PATCH', { storageLimitMb: null });
  r = await adminJson('/api/usage?userId=USER3', 'GET');
  check('límite null vuelve al default', (await r.json()).data?.storage?.limitBytes === 500 * 1024 * 1024);

  // Tope de tamaño de la subida del panel: se corta mientras llega y no deja nada guardado
  r = await fetch(BASE + '/api/images-upload?userId=USER3', { method: 'POST', headers: { cookie: adminCookie, 'x-forwarded-for': ip(), 'content-type': 'image/gif' }, body: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(750 * 1024)]) });
  full = await r.json();
  check('imagen del panel sobre el tope -> 413 (no es cuota)', r.status === 413 && full.details?.code !== 'QUOTA_EXCEEDED', r.status + ' ' + (full.error || ''));

  console.log('\n== Subida binaria de n8n (cuerpo crudo, firma sobre los bytes) ==');
  const signBytes = (token, buf, ts) => createHmac('sha256', token).update(`${ts}.`).update(buf).digest('hex');
  const rawUpload = async (buf, { token = token2, ts = now(), sig, type = 'image/png', path = '/api/upload/USER3?alt=Desde%20n8n' } = {}) => {
    const headers = { 'content-type': type, 'x-forwarded-for': ip(), 'x-webhook-timestamp': String(ts) };
    headers['x-webhook-secret'] = sig || signBytes(token, buf, ts);
    const res = await fetch(BASE + path, { method: 'POST', headers, body: buf });
    return { status: res.status, json: await res.json().catch(() => ({})), sig: headers['x-webhook-secret'], ts };
  };
  let rb = await rawUpload(PNG);
  check('binario firmado -> 200', rb.status === 200 && /^\/uploads\/USER3-/.test(rb.json.data?.url || ''), rb.status + ' ' + (rb.json.error || ''));
  check('  alt por query y userId', rb.json.data?.alt === 'Desde n8n' && rb.json.data?.userId === 'USER3', J([rb.json.data?.alt, rb.json.data?.userId]));
  r = await fetch(BASE + (rb.json.data?.url || '/nada'));
  check('  el archivo se sirve', r.status === 200 && (r.headers.get('content-type') || '').includes('image'), r.status);
  // Se añade al carrusel y se borra: el archivo deja de contar en su espacio
  r = await adminJson('/api/images?userId=USER3', 'POST', { url: rb.json.data?.url, alt: 'binaria' });
  const rawItem = (await r.json()).data;
  r = await fetch(BASE + `/api/images?userId=USER3&id=${rawItem?.id}`, { method: 'DELETE', headers: { cookie: adminCookie } });
  check('  se puede añadir al carrusel y borrar', r.status === 200 && (await fetch(BASE + rb.json.data.url)).status === 404, r.status);
  let rb2 = await rawUpload(PNG, { ts: rb.ts, sig: rb.sig });
  check('binario: repetir la misma firma -> 401', rb2.status === 401, rb2.status);
  rb2 = await rawUpload(PNG, { sig: '00'.repeat(32) });
  check('binario: firma inválida -> 401', rb2.status === 401, rb2.status);
  rb2 = await rawUpload(PNG, { token: token1 });
  check('binario: token viejo -> 401', rb2.status === 401, rb2.status);
  rb2 = await rawUpload(Buffer.from('<script>alert(1)</script>'));
  check('binario: firmado pero no es imagen -> 400', rb2.status === 400, rb2.status);
  rb2 = await rawUpload(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(950 * 1024)]), { type: 'image/gif' });
  check('binario: pasa del tope -> 413', rb2.status === 413 && rb2.json.details?.code !== 'QUOTA_EXCEEDED', rb2.status);
  // Cliente sin token: sigue valiendo la firma global, ahora sobre los bytes
  r = await fetch(BASE + '/api/upload/USER1', { method: 'POST', headers: { 'content-type': 'image/png', 'x-forwarded-for': ip(), 'x-webhook-secret': createHmac('sha256', WEBHOOK_SECRET).update(PNG).digest('hex') }, body: PNG });
  check('binario con firma global (cliente sin token) -> 200', r.status === 200, r.status);
  // El modo base64 tiene un tope más bajo: lo grande va en binario
  cp = await clientPost('/api/upload/USER3', token2, { data: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(800 * 1024)]).toString('base64'), contentType: 'image/gif' });
  check('base64 grande -> 413 y apunta al modo binario', cp.status === 413 && /binario/i.test(cp.json.error || ''), cp.status + ' ' + (cp.json.error || ''));

  // Bytes alterados después de firmar: la firma ya no cuadra
  const tampered = Buffer.from(PNG);
  tampered[tampered.length - 1] ^= 0xff;
  rb2 = await rawUpload(tampered, { sig: signBytes(token2, PNG, now() + 3), ts: now() + 3 });
  check('binario: bytes alterados tras firmar -> 401', rb2.status === 401, rb2.status);

  // Sin Content-Length (cuerpo por trozos): el tope tiene que cortar mientras llega
  const chunked = (buf) => new ReadableStream({
    start(c) {
      for (let i = 0; i < buf.length; i += 65536) c.enqueue(buf.subarray(i, i + 65536));
      c.close();
    },
  });
  const overPanel = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(750 * 1024)]);
  r = await fetch(BASE + '/api/images-upload?userId=USER3', { method: 'POST', duplex: 'half', headers: { cookie: adminCookie, 'x-forwarded-for': ip(), 'content-type': 'image/gif' }, body: chunked(overPanel) });
  check('panel, por trozos y sobre el tope -> 413', r.status === 413, r.status);
  const overRaw = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(950 * 1024)]);
  const tsRaw = now() + 5;
  r = await fetch(BASE + '/api/upload/USER3', { method: 'POST', duplex: 'half', headers: { 'content-type': 'image/gif', 'x-forwarded-for': ip(), 'x-webhook-timestamp': String(tsRaw), 'x-webhook-secret': signBytes(token2, overRaw, tsRaw) }, body: chunked(overRaw) });
  check('binario n8n, por trozos y sobre el tope -> 413', r.status === 413, r.status);

  // Un JSON de upload mucho mayor que el tope de base64 se rechaza sin llegar a leerlo entero
  r = await fetch(BASE + '/api/upload/USER3', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip(), 'x-webhook-secret': '00'.repeat(32) }, body: J({ data: 'A'.repeat(2 * 1024 * 1024), contentType: 'image/png' }) });
  check('JSON de upload enorme -> 413 antes de procesarlo', r.status === 413, r.status);

  console.log('\n== Streaming: cuerpo cortado (unidad de api/_stream.js) ==');
  {
    const { Readable } = await import('node:stream');
    const { mkdir, readdir } = await import('node:fs/promises');
    const { writeCapped, withUploadSlot } = await import('../api/_stream.js');
    const unitDir = join(dataDir, 'unit-stream');
    await mkdir(unitDir, { recursive: true });
    const settle = (p, ms = 1000) => Promise.race([
      p.then((v) => ['ok', v], () => ['rejected']),
      new Promise((res) => setTimeout(() => res(['pending']), ms)),
    ]);

    let out = await settle(writeCapped(Readable.from([Buffer.from('hola')]), join(unitDir, '.tmp-ok'), 100));
    check('cuerpo normal -> bytes escritos', out[0] === 'ok' && out[1] === 4, out.join());

    const dead = new Readable({ read() {} });
    dead.destroy();
    await new Promise((res) => setTimeout(res, 20));
    out = await settle(writeCapped(dead, join(unitDir, '.tmp-dead'), 100));
    check('cuerpo ya cortado -> rechaza (no se queda colgado)', out[0] === 'rejected', out[0]);

    const mid = new Readable({ read() {} });
    const pending = writeCapped(mid, join(unitDir, '.tmp-mid'), 100);
    mid.push(Buffer.from('abc'));
    setTimeout(() => mid.destroy(), 30);
    out = await settle(pending);
    check('cuerpo cortado a mitad -> rechaza', out[0] === 'rejected', out[0]);

    for (let i = 0; i < 3; i++) {
      const gone = new Readable({ read() {} });
      gone.destroy();
      await settle(withUploadSlot(() => writeCapped(gone, join(unitDir, `.tmp-gone${i}`), 100)), 300);
    }
    out = await settle(withUploadSlot(async () => 'libre'));
    check('subidas cortadas no se quedan con el turno', out[0] === 'ok', out[0]);
    const left = (await readdir(unitDir)).filter((n) => n.startsWith('.tmp-dead') || n.startsWith('.tmp-gone'));
    check('un cuerpo ya cortado no deja temporal', left.length === 0, left.join());
  }

  console.log('\n== Consumo (lo reporta n8n) ==');
  cp = await clientPost('/api/usage/USER3', token2, { eventId: 'evt-1', kind: 'image', model: 'qwen-image' });
  check('reportar imagen sin tokens', cp.status === 200 && cp.json.data?.usage?.images === 1 && cp.json.data?.usage?.imagesNoTokens === 1, cp.status + ' ' + (cp.json.error || ''));
  check('  costo aproximado 0.06', cp.json.data?.usage?.estimatedCostUsd === 0.06, cp.json.data?.usage?.estimatedCostUsd);
  // Reintento de n8n: mismo evento, firma nueva (otro timestamp)
  cp = await clientPost('/api/usage/USER3', token2, { eventId: 'evt-1', kind: 'image', model: 'qwen-image' }, { ts: now() + 2 });
  check('mismo eventId no se cuenta dos veces', cp.status === 200 && cp.json.data?.duplicate === true && cp.json.data?.usage?.images === 1, cp.status + ' images=' + cp.json.data?.usage?.images);
  cp = await clientPost('/api/usage/USER3', token2, { eventId: 'evt-2', kind: 'image', tokens: { input_tokens: 200, output_tokens: 1000, total_tokens: 1200 } });
  check('imagen con tokens del proveedor', cp.json.data?.usage?.images === 2 && cp.json.data?.usage?.imagesNoTokens === 1 && cp.json.data?.usage?.tokensTotal === 1200 && cp.json.data?.usage?.tokensIn === 200, J(cp.json.data?.usage));
  cp = await clientPost('/api/usage/USER3', token2, { eventId: 'evt-3', kind: 'video', seconds: 5 });
  check('video de 5 s', cp.json.data?.usage?.videos === 1 && cp.json.data?.usage?.videoSeconds === 5, J(cp.json.data?.usage));
  cp = await clientPost('/api/usage/USER3', token2, { eventId: 'evt-4', kind: 'text', tokens: { prompt_tokens: 50, completion_tokens: 30 } });
  check('texto: solo tokens', cp.json.data?.usage?.tokensTotal === 1280 && cp.json.data?.usage?.images === 2, cp.json.data?.usage?.tokensTotal);
  cp = await clientPost('/api/usage/USER3', token2, { kind: 'audio' });
  check('kind inválido -> 400', cp.status === 400, cp.status);
  cp = await clientPost('/api/usage/USER3', 'crt_otro', { kind: 'image' });
  check('consumo con token equivocado -> 401', cp.status === 401, cp.status);

  // El mismo código que corre en los nodos Code de n8n (n8n/firma.js y n8n/consumo.js).
  const n8n = new Function(
    (await readFile(join(ROOT, 'n8n/firma.js'), 'utf8')) + '\n' + (await readFile(join(ROOT, 'n8n/consumo.js'), 'utf8')) + '\n; return { firmar, armarConsumo };'
  )();
  const wanGen = { model: 'wan2.7-image-pro', imageUrl: 'https://x.test/w.png', usage: { input_tokens: 200, output_tokens: 1000, total_tokens: 1200 } };
  const n8nReport = async (userId, token, gen, run, firma) => {
    const f = n8n.firmar(token, J(n8n.armarConsumo(gen, 'e2e', run)));
    const res = await fetch(BASE + '/api/usage/' + userId, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': firma ? firma(f.body) : f.signature, 'x-webhook-timestamp': f.timestamp, 'x-forwarded-for': ip() },
      body: f.body,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, duplicate: json.data?.duplicate, u: json.data?.usage || {} };
  };
  // USER1 no tiene token: la fila de n8n lleva el secreto global (firma antigua).
  let nr = await n8nReport('USER1', WEBHOOK_SECRET, wanGen, 0);
  check('n8n: Wan con el secreto antiguo', nr.status === 200 && nr.duplicate === false && nr.u.images === 1 && nr.u.tokensTotal === 1200 && nr.u.imagesNoTokens === 0, nr.status + ' ' + J(nr.u));
  nr = await n8nReport('USER1', WEBHOOK_SECRET, wanGen, 0);
  check('n8n: la misma generación no se suma dos veces', nr.status === 200 && nr.duplicate === true && nr.u.images === 1, nr.status + ' images=' + nr.u.images);
  nr = await n8nReport('USER1', WEBHOOK_SECRET, {}, 1);
  check('n8n: Qwen sin tokens entra al costo aproximado', nr.status === 200 && nr.u.images === 2 && nr.u.imagesNoTokens === 1 && nr.u.estimatedCostUsd === 0.06, nr.status + ' ' + J(nr.u));
  // USER3 tiene token propio (crt_): firma con timestamp.
  nr = await n8nReport('USER3', token2, wanGen, 2);
  check('n8n: Wan con token crt_', nr.status === 200 && nr.u.images === 3 && nr.u.tokensTotal === 2480, nr.status + ' ' + J(nr.u));
  nr = await n8nReport('USER3', token2, wanGen, 3, (b) => createHmac('sha256', token2).update(b, 'utf8').digest('hex'));
  check('n8n: token crt_ firmado sin timestamp -> 401', nr.status === 401, nr.status);

  r = await adminJson('/api/usage', 'PATCH', { imagePriceUsd: 0.1 });
  check('super-admin cambia el precio por imagen', r.status === 200 && (await r.json()).data?.imagePriceUsd === 0.1, r.status);
  r = await adminJson('/api/usage', 'PATCH', { imagePriceUsd: -1 });
  check('precio negativo -> 400', r.status === 400, r.status);
  r = await adminJson('/api/usage?userId=USER3', 'GET');
  us = await r.json();
  check('  el costo usa el precio nuevo', us.data?.usage?.estimatedCostUsd === 0.1 && us.data?.usage?.imagePriceUsd === 0.1, us.data?.usage?.estimatedCostUsd);
  r = await adminJson('/api/usage?userId=USER3&month=2020-01', 'GET');
  check('  otro mes está en cero', (await r.json()).data?.usage?.images === 0);
  r = await adminJson('/api/usage?userId=USER3&month=octubre', 'GET');
  check('mes inválido -> 400', r.status === 400, r.status);

  // El cliente ve lo suyo y no puede tocar la configuración
  r = await fetch(BASE + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: J({ email: 'token@example.com', password: 'cliente-token-1' }) });
  const c3 = (r.headers.get('set-cookie') || '').split(';')[0];
  r = await fetch(BASE + '/api/usage', { headers: { cookie: c3 } });
  us = await r.json();
  check('el cliente ve su espacio y consumo', r.status === 200 && us.data?.userId === 'USER3' && us.data?.usage?.images === 3 && us.data?.storage?.fileCount === 1, r.status + ' images=' + us.data?.usage?.images);
  r = await fetch(BASE + '/api/usage?userId=USER1', { headers: { cookie: c3 } });
  check('  ?userId ajeno -> 403', r.status === 403, r.status);
  r = await fetch(BASE + '/api/usage', { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: c3 }, body: J({ imagePriceUsd: 0 }) });
  check('  cliente no cambia el precio -> 403', r.status === 403, r.status);
  r = await fetch(BASE + '/api/usage');
  check('consumo sin sesión -> 401', r.status === 401, r.status);

  console.log('\n== Aislamiento por cookie ==');
  // La cookie de un usuario solo vale para SU carrusel. Aquí USER2 intenta tocar USER1.
  r = await adminJson('/api/images?userId=USER1', 'POST', { url: 'https://x.test/victima.jpg', alt: 'intacta' });
  const victim = (await r.json()).data;
  const victimState = async () => {
    const res = await fetch(BASE + '/api/images?userId=USER1', { headers: { cookie: adminCookie } });
    const list = (await res.json()).data.images;
    const v = list.find((i) => i.id === victim.id);
    return `${list.length}|${v?.alt}|${v?.order}`;
  };
  const before = await victimState();
  const asUser2 = (path, method = 'GET', payload) => fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie: userCookie },
    body: payload === undefined ? undefined : J(payload),
  });

  // 1) Pidiendo el carrusel ajeno por la URL
  for (const [name, path, method, payload] of [
    ['GET images', '/api/images?userId=USER1', 'GET'],
    ['POST images', '/api/images?userId=USER1', 'POST', { url: 'https://x.test/intruso.jpg' }],
    ['PATCH images', '/api/images?userId=USER1', 'PATCH', { id: victim.id, alt: 'hackeada' }],
    ['PATCH reorder', '/api/images?userId=USER1', 'PATCH', [{ id: victim.id, order: 99 }]],
    ['DELETE images', `/api/images?userId=USER1&id=${victim.id}`, 'DELETE'],
    ['GET settings', '/api/settings?userId=USER1', 'GET'],
    ['PATCH settings', '/api/settings?userId=USER1', 'PATCH', { slideDuration: 30 }],
    ['POST generate', '/api/generate?userId=USER1', 'POST', {}],
    ['GET usage', '/api/usage?userId=USER1', 'GET'],
  ]) {
    r = await asUser2(path, method, payload);
    check(`USER2 -> ${name} de USER1 -> 403`, r.status === 403, r.status);
  }

  // 2) En su propio carrusel pero con el id de una imagen ajena
  r = await asUser2('/api/images', 'PATCH', { id: victim.id, alt: 'hackeada' });
  check('USER2 edita imagen ajena por id -> 404', r.status === 404, r.status);
  r = await asUser2(`/api/images?id=${victim.id}`, 'DELETE');
  check('USER2 borra imagen ajena por id -> 404', r.status === 404, r.status);
  r = await asUser2('/api/images', 'PATCH', [{ id: victim.id, order: 99 }]);
  check('USER2 reordena con id ajeno: no afecta a USER1', r.status === 200 && (await victimState()) === before, r.status);

  // 3) Rutas de super-admin con cookie de usuario
  for (const [name, path, method, payload] of [
    ['GET users', '/api/users', 'GET'],
    ['POST users', '/api/users', 'POST', { name: 'Intruso', email: 'intruso@example.com', password: 'intruso-12345' }],
    ['PATCH users', '/api/users?userId=USER1', 'PATCH', { name: 'Tomado' }],
    ['PATCH password', '/api/users/password?userId=USER1', 'PATCH', { password: 'tomada-12345' }],
    ['DELETE users', '/api/users?userId=USER1', 'DELETE'],
    ['POST token', '/api/users/token?userId=USER1', 'POST'],
    ['PATCH config', '/api/usage', 'PATCH', { imagePriceUsd: 0 }],
  ]) {
    r = await asUser2(path, method, payload);
    check(`USER2 -> ${name} (super-admin) -> 403`, r.status === 403, r.status);
  }
  check('el carrusel de USER1 quedó igual', (await victimState()) === before, await victimState());

  // 4) Cookies alteradas o fabricadas
  const b64u = (o) => Buffer.from(typeof o === 'string' ? o : J(o)).toString('base64url');
  const [h64, p64, sig64] = userCookie.replace('auth_token=', '').split('.');
  const claims = JSON.parse(Buffer.from(p64, 'base64url').toString('utf8'));
  const hs256 = (payload, secret) => {
    const head = b64u({ alg: 'HS256' });
    const data = `${head}.${b64u(payload)}`;
    return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
  };
  const exp = Math.floor(Date.now() / 1000) + 600;
  const forged = {
    'userId cambiado (firma original)': `${h64}.${b64u({ ...claims, userId: 'USER1' })}.${sig64}`,
    'rol super-admin (firma original)': `${h64}.${b64u({ ...claims, role: 'super-admin' })}.${sig64}`,
    'alg none': `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ role: 'super-admin', sid: 'x', exp })}.`,
    'firmada con otro secreto': hs256({ ...claims, userId: 'USER1' }, 'otro-secreto-que-no-es-el-del-servidor'),
    // Aun con el secreto real: sin sesión registrada (sid) o de otra versión no vale
    'firma válida pero sin sid': hs256({ role: 'user', userId: 'USER2', exp }, 'test-jwt-secret-0123456789abcdef'),
    'firma válida, versión de sesión vieja': hs256({ ...claims, sv: 999 }, 'test-jwt-secret-0123456789abcdef'),
    'super-admin sin atar al navegador': hs256({ role: 'super-admin', sid: 'x', sv: '0.x', exp }, 'test-jwt-secret-0123456789abcdef'),
  };
  for (const [name, jwt] of Object.entries(forged)) {
    const cookie = `auth_token=${jwt}`;
    const a = await fetch(BASE + '/api/images', { headers: { cookie } });
    const b = await fetch(BASE + '/api/users', { headers: { cookie } });
    const me = await (await fetch(BASE + '/api/auth', { headers: { cookie } })).json();
    check(`cookie ${name} -> 401`, a.status === 401 && b.status === 401 && me.authenticated === false, `${a.status}/${b.status}/${me.authenticated}`);
  }
  check('la cookie original de USER2 sigue valiendo', (await asUser2('/api/images')).status === 200);

  // 5) Cookie de un usuario que ya no existe
  r = await adminJson('/api/users', 'POST', { name: 'Efimero', email: 'efimero@example.com', password: 'efimero-12345' });
  const ghostId = (await r.json()).data?.userId;
  r = await fetch(BASE + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: J({ email: 'efimero@example.com', password: 'efimero-12345' }) });
  const ghostCookie = (r.headers.get('set-cookie') || '').split(';')[0];
  r = await fetch(BASE + '/api/images', { headers: { cookie: ghostCookie } });
  const aliveBefore = r.status;
  await fetch(BASE + `/api/users?userId=${ghostId}`, { method: 'DELETE', headers: { cookie: adminCookie } });
  r = await fetch(BASE + '/api/images', { headers: { cookie: ghostCookie } });
  check('cookie de usuario borrado -> 401', aliveBefore === 200 && r.status === 401, `${aliveBefore} -> ${r.status}`);

  console.log('\n== Sesiones ==');
  const whoami = async (cookie, extra = {}) => (await (await fetch(BASE + '/api/auth', { headers: { cookie, ...extra } })).json()).authenticated;
  check('sesión de USER3 vigente', (await whoami(c3)) === true);
  r = await fetch(BASE + '/api/auth', { method: 'DELETE', headers: { cookie: c3 } });
  check('logout', r.status === 200, r.status);
  check('  la cookie copiada ya no sirve', (await whoami(c3)) === false);
  r = await fetch(BASE + '/api/images', { headers: { cookie: c3 } });
  check('  ni para la API -> 401', r.status === 401, r.status);

  // Cambiar la contraseña cierra las sesiones abiertas
  check('sesión de USER2 vigente', (await whoami(userCookie)) === true);
  r = await adminJson('/api/users/password?userId=USER2', 'PATCH', { password: 'otra-clave-789' });
  check('cambio de contraseña de USER2', r.status === 200, r.status);
  check('  su sesión anterior queda cerrada', (await whoami(userCookie)) === false);

  // Cerrar todas las sesiones
  const loginU3 = async () => {
    const res = await fetch(BASE + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip() }, body: J({ email: 'token@example.com', password: 'cliente-token-1' }) });
    return (res.headers.get('set-cookie') || '').split(';')[0];
  };
  const sA = await loginU3();
  const sB = await loginU3();
  r = await fetch(BASE + '/api/auth?all=1', { method: 'DELETE', headers: { cookie: sA } });
  check('cerrar todas las sesiones', r.status === 200 && (await whoami(sA)) === false && (await whoami(sB)) === false, r.status);

  // La sesión de super-admin está atada al navegador
  check('super-admin vigente', (await whoami(adminCookie)) === true);
  check('  misma cookie desde otro navegador -> no vale', (await whoami(adminCookie, { 'user-agent': 'OtroNavegador/1.0' })) === false);

  // Peticiones de otro sitio
  r = await fetch(BASE + '/api/images?userId=USER1', { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie, origin: 'https://evil.test' }, body: J({ url: 'https://x.test/csrf.jpg' }) });
  check('POST con Origin ajeno -> 403', r.status === 403, r.status);
  r = await fetch(BASE + '/api/images?userId=USER1', { method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie, origin: BASE }, body: J({ url: 'https://x.test/propio.jpg' }) });
  check('POST con Origin propio OK', r.status === 200, r.status);

  // userId malformado no llega a formar una llave
  r = await fetch(BASE + '/api/carrusel?userId=USER1:images');
  check('carrusel userId malformado -> 400', r.status === 400, r.status);
  r = await fetch(BASE + '/api/images?userId=USERS', { headers: { cookie: adminCookie } });
  check('images userId malformado -> 400', r.status === 400, r.status);

  // Bloqueo tras 10 fallos seguidos (misma IP, misma cuenta)
  const lockIp = '10.77.0.1';
  const tryLogin = (password, from = lockIp) => fetch(BASE + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': from }, body: J({ email: 'token@example.com', password }) });
  for (let i = 0; i < 10; i++) await tryLogin('mala-' + i);
  r = await tryLogin('cliente-token-1');
  check('10 fallos -> bloqueo aunque la clave sea buena (429)', r.status === 429, r.status);
  r = await tryLogin('cliente-token-1', '10.77.0.2');
  check('  desde otra IP sí entra', r.status === 200, r.status);

  console.log('\n== Health ==');
  body = '{}';
  r = await fetch(BASE + '/api/health', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': sign(body) }, body });
  const h = await r.json();
  check('health OK', r.status === 200 && h.ok === true, r.status);
  check('  modo local', h.redisConfigured === false && h.blobToken === false);

  console.log(`\nRESULT: ${pass}/${total}`);
}

try {
  await runTests();
} catch (err) {
  console.error('\nERROR:', err.message);
} finally {
  child.kill();
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

process.exit(pass === total && total > 0 ? 0 : 1);