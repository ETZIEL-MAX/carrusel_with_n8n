// Servidor para Playwright: datos temporales limpios en cada corrida y secretos de prueba.
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const DATA = join(tmpdir(), 'carrusel-playwright-data');
await rm(DATA, { recursive: true, force: true });
await mkdir(DATA, { recursive: true });

process.env.LOCAL_DATA_DIR = DATA;
process.env.LOCAL_STORAGE = '1';
process.env.PORT = process.env.PORT || '3210';
process.env.WEBHOOK_SECRET = 'pw-test-webhook-secret-0123456789abcdef';
process.env.JWT_SECRET = 'pw-test-jwt-secret-0123456789abcdef-0123';
delete process.env.NODE_ENV; // modo desarrollo: crea USER1 y el super-admin de prueba

// n8n falso para "Crear con IA": guarda los pedidos; GET /calls los devuelve a las pruebas.
export const FAKE_N8N_PORT = Number(process.env.PORT) + 1;
const calls = [];
createServer((req, res) => {
  if (req.method === 'GET') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(calls));
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try { calls.push(JSON.parse(raw)); } catch { /* ignorar */ }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
}).listen(FAKE_N8N_PORT, '127.0.0.1');
process.env.N8N_WEB_GENERATION_URL = `http://127.0.0.1:${FAKE_N8N_PORT}/web`;
process.env.N8N_ALLOWED_HOSTS = '127.0.0.1';

await import('../scripts/server.mjs');
