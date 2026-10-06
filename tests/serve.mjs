// Servidor para Playwright: datos temporales limpios en cada corrida y secretos de prueba.
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DATA = join(tmpdir(), 'carrusel-playwright-data');
await rm(DATA, { recursive: true, force: true });
await mkdir(DATA, { recursive: true });

process.env.LOCAL_DATA_DIR = DATA;
process.env.LOCAL_STORAGE = '1';
process.env.PORT = process.env.PORT || '3210';
process.env.WEBHOOK_SECRET = 'pw-test-webhook-secret-0123456789abcdef';
process.env.JWT_SECRET = 'pw-test-jwt-secret-0123456789abcdef-0123';
delete process.env.NODE_ENV; // modo desarrollo: crea USER1 y el super-admin de prueba

await import('../scripts/server.mjs');
