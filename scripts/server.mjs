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
import { createHash } from 'node:crypto';
import { hash } from '@node-rs/argon2';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const DEV_PASSWORD = process.env.ADMIN_PASSWORD || '10Cuidado.2026';
const IS_PROD = process.env.NODE_ENV === 'production';
const HASH_FROM_ENV = Boolean(process.env.ADMIN_PASSWORD_HASH);

// En producción no hay secretos por defecto: si faltan o son débiles, no arranca.
if (IS_PROD) {
  const weak = [];
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) weak.push('JWT_SECRET (>=32 caracteres)');
  if (!process.env.WEBHOOK_SECRET || process.env.WEBHOOK_SECRET.length < 32) weak.push('WEBHOOK_SECRET (>=32 caracteres)');
  if (!process.env.ADMIN_PASSWORD_HASH) weak.push('ADMIN_PASSWORD_HASH');
  if (weak.length) {
    console.error(`FATAL: faltan o son débiles: ${weak.join(', ')}. No se inicia en producción.`);
    process.exit(1);
  }
}

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
  'sw.js',
  'favicon.ico',
]);

// ---- Caché con hash de contenido ----
// El HTML referencia /x.js?v=<hash>. Ese asset se sirve "immutable" (1 año): cuando
// cambia el archivo cambia el hash y el HTML (no-cache) apunta al nuevo. Así ningún
// navegador ni Cloudflare se queda con JS/CSS viejo después de un deploy.
const VERSIONED = ['admin.js', 'carousel.js', 'api.js', 'styles.css'];
const IMMUTABLE = 'public, max-age=31536000, immutable';
const assetHashes = {};
const sha1 = (buf, n = 10) => createHash('sha1').update(buf).digest('hex').slice(0, n);

async function computeHashes() {
  for (const f of VERSIONED) {
    try { assetHashes[f] = sha1(await readFile(join(ROOT, f))); } catch { delete assetHashes[f]; }
  }
}
const buildId = () => sha1(VERSIONED.map((f) => assetHashes[f] || '').join('.'));
await computeHashes();

const renderCache = new Map();
async function renderText(file, transform) {
  if (IS_PROD && renderCache.has(file)) return renderCache.get(file);
  if (!IS_PROD) await computeHashes(); // en desarrollo los archivos cambian en caliente
  const text = transform(await readFile(join(ROOT, file), 'utf8'));
  const body = Buffer.from(text, 'utf8');
  const out = { body, etag: `"${sha1(body, 16)}"` };
  renderCache.set(file, out);
  return out;
}

const withVersions = (html) =>
  html.replace(/(src|href)="\/(admin\.js|carousel\.js|api\.js|styles\.css)"/g, (m, attr, name) =>
    assetHashes[name] ? `${attr}="/${name}?v=${assetHashes[name]}"` : m
  );

function sendBuffer(req, res, body, type, cacheControl, etag) {
  const headers = { 'Content-Type': type, 'Cache-Control': cacheControl };
  if (etag) {
    headers.ETag = etag;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }
  }
  headers['Content-Length'] = body.length; // tamaño exacto (evita chunked y renders a medias)
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

async function sendFile(req, res, absolutePath, cacheControl, withEtag = true) {
  try {
    const data = await readFile(absolutePath);
    const type = MIME[extname(absolutePath).toLowerCase()] || 'application/octet-stream';
    return sendBuffer(req, res, data, type, cacheControl, withEtag ? `"${sha1(data, 16)}"` : null);
  } catch {
    return false;
  }
}

async function serveStatic(req, res, url) {
  const pathname = url.pathname;
  // Imágenes subidas: nombres únicos (timestamp+uuid) => cache inmutable y largo.
  if (pathname.startsWith('/uploads/')) {
    const name = basename(pathname);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return false;
    return sendFile(req, res, join(process.env.LOCAL_DATA_DIR, 'uploads', name), IMMUTABLE, false);
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

  if (file.endsWith('.html')) {
    const { body, etag } = await renderText(file, withVersions);
    return sendBuffer(req, res, body, MIME['.html'], 'no-cache', etag);
  }
  if (file === 'sw.js') {
    // La versión del build va dentro del SW: al cambiar, el SW nuevo borra cachés viejas.
    const { body, etag } = await renderText(file, (src) => src.replace(/__BUILD__/g, buildId()));
    return sendBuffer(req, res, body, MIME['.js'], 'no-cache', etag);
  }
  const v = url.searchParams.get('v');
  const versioned = Boolean(v && assetHashes[file] && v === assetHashes[file]);
  return sendFile(req, res, join(ROOT, file), versioned ? IMMUTABLE : 'no-cache');
}

// ---- Headers de seguridad (todas las respuestas) ----
const CSP = [
  "default-src 'self'",
  // Cloudflare inyecta su beacon de Web Analytics en el HTML (zona de carrusel.etziel.com).
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' https: data: blob:",
  "connect-src 'self' https://cloudflareinsights.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function applySecurityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  const https = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const MB = 1024 * 1024;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  applySecurityHeaders(req, res);

  // Handle /api/carrusel?userId=... (query param) - exact match works for /api/carrusel
  // Rutas por usuario: /api/webhook/USERx, /api/upload/USERx, /api/settings-read/USERx y /api/manage/USERx
  const userApi = pathname.match(/^\/api\/(webhook|upload|settings-read|manage)\/([^/]+)\/?$/);
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
      if (kind === 'manage') return webhookShared.handleManage(webReq, rawId);
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
    // Límite de tamaño del body: subidas de imagen 25 MB, el resto 1 MB.
    const isUpload = (userApi && userApi[1] === 'upload') || pathname === '/api/images-upload';
    const limit = isUpload ? 25 * MB : 1 * MB;
    const tooLarge = () =>
      res
        .writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ success: false, error: 'Payload too large' }));
    if (Number(req.headers['content-length'] || 0) > limit) {
      req.resume();
      tooLarge();
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) { overflow = true; continue; } // se drena sin guardar
      chunks.push(chunk);
    }
    if (overflow) { tooLarge(); return; }
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
      // Las respuestas de la API nunca se cachean (ni navegador ni Cloudflare).
      res.setHeader('Cache-Control', 'no-store');
      res.writeHead(webRes.status);
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch (err) {
      console.error('API error:', err);
      const payload = { success: false, error: 'Error interno del servidor' };
      if (!IS_PROD) payload.detail = err.message; // en prod no se filtran detalles internos
      res
        .writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(payload));
    }
    return;
  }

  if (await serveStatic(req, res, url)) return;

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