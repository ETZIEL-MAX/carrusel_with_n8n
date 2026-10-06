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
  for (const f of ['admin.js', 'api.js', 'carousel.js', 'scripts/server.mjs', 'api/_webhook-shared.js']) {
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

  console.log('\n== Manual upload (multipart) ==');
  const uploadForm = (buf, name, type, alt) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type }), name);
    if (alt) fd.append('alt', alt);
    return fd;
  };

  // User uploads to own carousel
  r = await fetch(BASE + '/api/images-upload', { method: 'POST', headers: { cookie: userCookie }, body: uploadForm(PNG, 'foto.png', 'image/png', 'Foto del movil') });
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
  r = await fetch(BASE + '/api/images-upload?userId=USER1', { method: 'POST', headers: { cookie: adminCookie }, body: uploadForm(PNG, 'a.png', 'image/png') });
  mu = await r.json();
  check('super-admin upload to USER1', r.status === 200 && mu.data?.userId === 'USER1', r.status);

  // Rejections
  r = await fetch(BASE + '/api/images-upload', { method: 'POST', body: uploadForm(PNG, 'x.png', 'image/png') });
  check('upload without session -> 401', r.status === 401, r.status);
  r = await fetch(BASE + '/api/images-upload?userId=USER1', { method: 'POST', headers: { cookie: userCookie }, body: uploadForm(PNG, 'x.png', 'image/png') });
  check('user upload to other carousel -> 403', r.status === 403, r.status);
  r = await fetch(BASE + '/api/images-upload', { method: 'POST', headers: { cookie: userCookie }, body: uploadForm(Buffer.from('<script>alert(1)</script>'), 'fake.png', 'image/png') });
  check('non-image disguised as png -> 400', r.status === 400, r.status);
  r = await fetch(BASE + '/api/images-upload', { method: 'POST', headers: { cookie: adminCookie }, body: uploadForm(PNG, 'x.png', 'image/png') });
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