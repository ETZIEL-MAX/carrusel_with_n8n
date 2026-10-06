// Migra las imágenes del carrusel (PNG/JPG en /uploads) a WebP de alta calidad.
// - Solo toca imágenes referenciadas por algún carrusel y alojadas en /uploads/.
// - Escribe el .webp nuevo, actualiza la URL en la lista del usuario y mueve el
//   original a uploads/_backup/ (no se borra nada).
//
// Uso (dentro del contenedor, con el mismo entorno que la app):
//   node scripts/migrate-webp.mjs --dry-run   # solo muestra qué haría
//   node scripts/migrate-webp.mjs             # aplica
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DRY = process.argv.includes('--dry-run');
const DATA_DIR = process.env.LOCAL_DATA_DIR || join(process.cwd(), '.data');
const UPLOADS = join(DATA_DIR, 'uploads');
const BACKUP = join(UPLOADS, '_backup');

const { getUsers, getImages, saveImages, sniffImageType } = await import('../api/_utils.js');
const { optimizeImage } = await import('../api/_store.js');

const users = await getUsers();
const ids = Object.keys(users || {});
let converted = 0;
let skipped = 0;
let before = 0;
let after = 0;

if (!DRY) await mkdir(BACKUP, { recursive: true });

for (const userId of ids) {
  const images = await getImages(userId);
  let changed = false;

  for (const img of images) {
    // Relativa (/uploads/x.png) o absoluta de nuestro dominio (https://…/uploads/x.png).
    // Solo se considera nuestra si el archivo existe en uploads/ (más abajo).
    let pathname = '';
    try { pathname = new URL(img.url, 'http://local').pathname; } catch { /* url rara */ }
    const m = /^\/uploads\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(pathname);
    if (!m || /\.webp$/i.test(m[1]) || /\.gif$/i.test(m[1])) { skipped++; continue; }

    const src = join(UPLOADS, m[1]);
    let buf;
    try { buf = await readFile(src); } catch { console.warn(`  [falta] ${userId} ${img.url}`); skipped++; continue; }

    const kind = sniffImageType(buf);
    const opt = await optimizeImage(buf, kind);
    if (opt.type !== 'image/webp') { skipped++; continue; } // no se ganó peso o falló

    const newName = `${Date.now()}-${randomUUID().slice(0, 8)}.webp`;
    before += buf.length;
    after += opt.buffer.length;
    console.log(`  ${userId}  ${m[1]}  ${(buf.length / 1024).toFixed(0)} KB -> ${newName}  ${(opt.buffer.length / 1024).toFixed(0)} KB`);

    if (!DRY) {
      await writeFile(join(UPLOADS, newName), opt.buffer);
      img.url = `/uploads/${newName}`;
      img.updatedAt = new Date().toISOString();
      changed = true;
      try { await rename(src, join(BACKUP, m[1])); } catch { /* ya movido */ }
    }
    converted++;
  }

  if (changed && !DRY) await saveImages(userId, images);
}

// Verificación rápida de que el respaldo existe
if (!DRY && converted) { try { await stat(BACKUP); } catch { console.warn('Sin carpeta de respaldo'); } }

console.log(`\n${DRY ? '[DRY-RUN] ' : ''}Convertidas: ${converted}  Omitidas: ${skipped}`);
if (converted) {
  console.log(`Peso: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB (${Math.round((1 - after / before) * 100)}% menos)`);
}
process.exit(0);
