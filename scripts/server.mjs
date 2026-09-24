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
const webhookHandler = await import('../api/webhook.js');
const uploadHandler = await import('../api/upload.js');
const healthHandler = await import('../api/health.js');

const API_ROUTES = {
  '/api/images': imagesHandler,
  '/api/auth': authHandler,
  '/api/webhook': webhookHandler,
  '/api/upload': uploadHandler,
  '/api/health': healthHandler,
};

// ---- Seed de ejemplo (solo si está vacío) ----
const IMAGES_KEY = 'carousel:images';
const existing = await getJson(IMAGES_KEY);
if (!Array.isArray(existing) || existing.length === 0) {
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

  let file = pathname === '/' ? '/index.html' : pathname;
  if (file === '/admin' || file === '/admin/') file = '/admin.html';

  const target = join(ROOT, file);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }
  return sendFile(res, target);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  const module = API_ROUTES[pathname];
  if (module) {
    const handler = module[req.method];
    if (!handler) {
      res.writeHead(405).end('Method Not Allowed');
      return;
    }

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
      const webRes = await handler(webReq);
      const setCookies = webRes.headers.getSetCookie?.() || [];
      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') return;
        res.setHeader(key, value);
      });
      // En local (http) quitamos Secure para que el navegador guarde la cookie.
      if (setCookies.length) {
        res.setHeader('Set-Cookie', setCookies.map((c) => c.replace(/;\s*Secure/gi, '')));
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
  console.log(`  Carrusel : http://localhost:${PORT}/`);
  console.log(`  Admin    : http://localhost:${PORT}/admin`);
  console.log(`  Password : ${DEV_PASSWORD}`);
  console.log(`  Datos    : ${process.env.LOCAL_DATA_DIR}`);
  console.log('');
  console.log('  Ctrl+C para detener.');
  console.log('');
});
