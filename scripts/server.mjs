// Servidor local / Docker.
// Ejecuta los handlers reales de api/ con almacenamiento en disco (LOCAL_STORAGE=1):
// no necesita Upstash ni Vercel Blob.
//
//   node scripts/server.mjs          (o: npm run dev:local)
//
// Datos persistentes en .data/ (KV en .data/kv, imágenes en .data/uploads).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const DEV_PASSWORD = process.env.ADMIN_PASSWORD || '10Cuidado.2026';
const IS_PROD = process.env.NODE_ENV === 'production';
const HASH_FROM_ENV = Boolean(process.env.ADMIN_PASSWORD_HASH);

// ---- Entorno local (antes de importar los handlers) ----
process.env.LOCAL_STORAGE = process.env.LOCAL_STORAGE || '1';
process.env.LOCAL_DATA_DIR = process.env.LOCAL_DATA_DIR || join(ROOT, '.data');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-0123456789abcdef';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'dev-webhook-secret';
process.env.ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || (await hash(DEV_PASSWORD));

// ---- Handlers reales ----
const { getJson, setJson } = await import('../api/_store.js');
const imagesHandler = await import('../api/images.js');
const authHandler = await import('../api/auth.js');
const usersHandler = await import('../api/users.js');
const webhookHandler = await import('../api/webhook.js');
const uploadHandler = await import('../api/upload.js');
const webhookShared = await import('../api/_webhook-shared.js');
const healthHandler = await import('../api/health.js');
const carruselHandler = await import('../api/carrusel.js');
const imagesUploadHandler = await import('../api/images-upload.js');
const settingsHandler = await import('../api/settings.js');
const generateHandler = await import('../api/generate.js');

const API_ROUTES = {
  '/api/images': imagesHandler,
  '/api/images-upload': imagesUploadHandler,
  '/api/auth': authHandler,
  '/api/users': usersHandler,
  '/api/users/password': usersHandler,
  '/api/carrusel': carruselHandler,
  '/api/webhook': webhookHandler,
  '/api/upload': uploadHandler,
  '/api/health': healthHandler,
  '/api/settings': settingsHandler,
  '/api/generate': generateHandler,
};

// ---- Seed de ejemplo (solo si está vacío y NO en producción) ----
const USERS_KEY = 'carousel:users';
const existingUsers = await getJson(USERS_KEY);
if (IS_PROD) {
  // En producción no se crean usuarios demo: el super-admin los crea desde el panel.
} else if (!existingUsers || Object.keys(existingUsers).length === 0) {
  const { hash: hashPwd } = await import('@node-rs/argon2');
  const passwordHash = await hashPwd(DEV_PASSWORD);
  await setJson(USERS_KEY, {
    USER1: {
      name: 'Usuario 1',
      email: 'user1@local.test',
      passwordHash,
      createdAt: new Date().toISOString(),
    },
  });
} else {
  // Migración: usuarios antiguos sin nombre/correo reciben valores por defecto.
  let changed = false;
  for (const [id, data] of Object.entries(existingUsers)) {
    if (!data.name) { data.name = id; changed = true; }
    if (!data.email) { data.email = `${String(id).toLowerCase()}@local.test`; changed = true; }
  }
  if (changed) await setJson(USERS_KEY, existingUsers);
}

const IMAGES_KEY = 'carousel:USER1:images';
const existingImages = await getJson(IMAGES_KEY);
if (!IS_PROD && (!Array.isArray(existingImages) || existingImages.length === 0)) {
  const seed = [
    ['Montañas al amanecer', 'https://picsum.photos/seed/amanecer/1920/1080'],
    ['Costa salvaje', 'https://picsum.photos/seed/costa/1920/1080'],
    ['Bosque en la niebla', 'https://picsum.photos/seed/bosque/1920/1080'],
    ['Arquitectura urbana', 'https://picsum.photos/seed/ciudad/1920/1080'],
    ['Desierto dorado', 'https://picsum.photos/seed/desierto/1920/1080'],
  ];
  await setJson(
    IMAGES_KEY,
    seed.map(([alt, url], i) => ({
      id: `seed-${i + 1}`,
      url,
      alt,
      order: i,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  );
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const PUBLIC_FILES = new Set([
  'admin.html',
  'index.html',
  'admin.js',
  'api.js',
  'carousel.js',
  'styles.css',
  'favicon.ico',
]);

async function sendFile(res, absolutePath) {
  try {
    const data = await readFile(absolutePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(absolutePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function serveStatic(res, pathname) {
  // Imágenes subidas
  if (pathname.startsWith('/uploads/')) {
    const file = join(process.env.LOCAL_DATA_DIR, 'uploads', basename(pathname));
    return sendFile(res, file);
  }

  if (pathname.startsWith('/api/')) return false;

  // / y /admin -> admin.html (login / admin panel)
  // /carrusel/* -> index.html (carrusel público)
  let file;
  if (pathname === '/' || pathname === '/admin' || pathname === '/admin/') {
    file = 'admin.html';
  } else if (pathname.startsWith('/carrusel/')) {
    file = 'index.html';
  } else {
    file = pathname.slice(1);
  }

  // Solo se sirven los archivos públicos del frontend. Nada de package.json,
  // docker-compose.yml, .env, logs, scripts/ ni api/.
  if (!PUBLIC_FILES.has(file)) return false;
  return sendFile(res, join(ROOT, file));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Handle /api/carrusel?userId=... (query param) - exact match works for /api/carrusel
  // Rutas por usuario: /api/webhook/USERx y /api/upload/USERx
  const userApi = pathname.match(/^\/api\/(webhook|upload|settings-read)\/([^/]+)\/?$/);
  let apiHandler = null;

  if (userApi) {
    if (req.method !== 'POST') {
      res.writeHead(405).end('Method Not Allowed');
      return;
    }
    const kind = userApi[1];
    const rawId = decodeURIComponent(userApi[2]);
    apiHandler = (webReq) => {
      if (kind === 'webhook') return webhookShared.handleWebhook(webReq, rawId);
      if (kind === 'settings-read') return webhookShared.handleSettingsRead(webReq, rawId);
      return webhookShared.handleUpload(webReq, rawId);
    };
  } else {
    const module = API_ROUTES[pathname];
    if (module) {
      const handler = module[req.method];
      if (!handler) {
        res.writeHead(405).end('Method Not Allowed');
        return;
      }
      apiHandler = handler;
    }
  }

  if (apiHandler) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }

    const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });

    try {
      const webRes = await apiHandler(webReq);
      // Extract Set-Cookie headers from the response
      const setCookies = [];
      if (webRes.headers && typeof webRes.headers.forEach === 'function') {
        webRes.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'set-cookie') {
            setCookies.push(value);
          }
        });
        webRes.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'set-cookie') return;
          res.setHeader(key, value);
        });
      }
      // En local (http) quitamos Secure para que el navegador guarde la cookie.
      // Detrás de nginx con HTTPS (X-Forwarded-Proto: https) se mantiene Secure.
      if (setCookies.length) {
        const behindHttps = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
        res.setHeader(
          'Set-Cookie',
          behindHttps ? setCookies : setCookies.map((c) => c.replace(/;\s*Secure/gi, ''))
        );
      }
      res.writeHead(webRes.status);
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch (err) {
      console.error('API error:', err);
      res
        .writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Error interno del servidor local', detail: err.message }));
    }
    return;
  }

  if (await serveStatic(res, pathname)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 Not Found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Carrusel (local)');
  console.log(`  Admin       : http://localhost:${PORT}/admin`);
  console.log(`  Carrusel USER1: http://localhost:${PORT}/carrusel/USER1`);
  if (!HASH_FROM_ENV) console.log(`  Password    : ${DEV_PASSWORD}`);
  console.log(`  Datos       : ${process.env.LOCAL_DATA_DIR}`);
  console.log('');
  console.log('  Ctrl+C para detener.');
  console.log('');
});