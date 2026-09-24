// Servidor de desarrollo local.
// Sirve el sitio estático y ejecuta los handlers reales de api/ contra un
// Redis en memoria (sin necesidad de Upstash ni de `vercel dev`).
//
//   node scripts/dev-local.mjs
//
// Contraseña de admin en local: admin12345678

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const DEV_PASSWORD = 'admin12345678';

// ---- Variables de entorno para el modo local ----
process.env.KV_REST_API_URL = 'http://in-memory.redis.local';
process.env.KV_REST_API_TOKEN = 'dev-token';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-0123456789abcdef';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'dev-webhook-secret';
process.env.ADMIN_PASSWORD_HASH = await hash(DEV_PASSWORD);

// ---- Redis en memoria ----
const store = new Map();
globalThis.fetch = async (url, opts = {}) => {
  if (String(url) === process.env.KV_REST_API_URL) {
    const args = JSON.parse(opts.body);
    const cmd = String(args[0]).toUpperCase();
    if (cmd === 'GET') {
      return new Response(JSON.stringify({ result: store.get(args[1]) ?? null }));
    }
    if (cmd === 'SET') {
      store.set(args[1], args[2]);
      return new Response(JSON.stringify({ result: 'OK' }));
    }
  }
  throw new Error('fetch bloqueado en dev-local: ' + url);
};

// ---- Datos de ejemplo ----
const seed = [
  ['Montañas al amanecer', 'https://picsum.photos/seed/amanecer/1920/1080'],
  ['Costa salvaje', 'https://picsum.photos/seed/costa/1920/1080'],
  ['Bosque en la niebla', 'https://picsum.photos/seed/bosque/1920/1080'],
  ['Arquitectura urbana', 'https://picsum.photos/seed/ciudad/1920/1080'],
  ['Desierto dorado', 'https://picsum.photos/seed/desierto/1920/1080'],
];

store.set(
  'carousel:images',
  JSON.stringify(
    seed.map(([alt, url], i) => ({
      id: `seed-${i + 1}`,
      url,
      alt,
      order: i,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  )
);

// ---- Handlers reales (se importan DESPUÉS de configurar env y fetch) ----
const imagesHandler = await import('../api/images.js');
const authHandler = await import('../api/auth.js');
const webhookHandler = await import('../api/webhook.js');
const uploadHandler = await import('../api/upload.js');

const API_ROUTES = {
  '/api/images': imagesHandler,
  '/api/auth': authHandler,
  '/api/webhook': webhookHandler,
  '/api/upload': uploadHandler,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

async function serveStatic(res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (file === '/admin' || file === '/admin/') file = '/admin.html';
  if (pathname.startsWith('/api/')) return false;

  const target = join(ROOT, file);
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return true;
  }

  try {
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[extname(target)] || 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // --- API ---
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
        res.setHeader(
          'Set-Cookie',
          setCookies.map((c) => c.replace(/;\s*Secure/gi, ''))
        );
      }
      res.writeHead(webRes.status);
      res.end(Buffer.from(await webRes.arrayBuffer()));
    } catch (err) {
      console.error('API error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ error: 'Error interno en dev-local', detail: err.message })
      );
    }
    return;
  }

  // --- Estáticos ---
  if (await serveStatic(res, pathname)) return;

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404 Not Found');
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Carrusel en local');
  console.log(`  Carrusel : http://localhost:${PORT}/`);
  console.log(`  Admin    : http://localhost:${PORT}/admin`);
  console.log(`  Password : ${DEV_PASSWORD}`);
  console.log('');
  console.log('  Ctrl+C para detener.');
  console.log('');
});
