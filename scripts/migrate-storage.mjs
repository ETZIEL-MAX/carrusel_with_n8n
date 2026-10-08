// Anota en la cuenta de espacio de cada usuario los archivos que ya tenía subidos
// antes de que existiera el límite de almacenamiento.
//
//   node scripts/migrate-storage.mjs            (aplica)
//   node scripts/migrate-storage.mjs --dry-run  (solo muestra lo que haría)
//
// Usa las mismas variables que el servidor (REDIS_URL / LOCAL_STORAGE, LOCAL_DATA_DIR).
// No borra ni renombra nada: solo agrega registros. Se puede correr varias veces.
// Al terminar marca `storageMigrated`: desde entonces un archivo sin registrar ya no
// se borra al quitar una imagen (ver removeUserFile en api/_utils.js).

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
process.env.LOCAL_DATA_DIR = process.env.LOCAL_DATA_DIR || join(ROOT, '.data');
if (!process.env.REDIS_URL && !process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
  process.env.LOCAL_STORAGE = process.env.LOCAL_STORAGE || '1';
}

const DRY = process.argv.includes('--dry-run');
const { getUsers, getImages, getStorageUsage, registerUserFile, updateConfig } = await import('../api/_utils.js');
const { ownFileName, isLocalImages } = await import('../api/_store.js');

if (!isLocalImages()) {
  console.error('Este script mide archivos en disco (IMAGE_STORAGE=local o LOCAL_STORAGE=1). Con Vercel Blob no aplica.');
  process.exit(1);
}

const uploadsDir = join(process.env.LOCAL_DATA_DIR, 'uploads');
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
const owners = new Map(); // archivo -> usuario al que se le anotó

const users = await getUsers();
for (const userId of Object.keys(users).sort()) {
  let added = 0;
  let bytes = 0;
  for (const image of await getImages(userId)) {
    const name = ownFileName(image);
    if (!name) continue; // URL externa: no ocupa espacio nuestro
    if (owners.has(name)) {
      if (owners.get(name) !== userId) console.log(`  ! ${name} también está en ${userId}; ya se anotó a ${owners.get(name)}`);
      continue;
    }
    let size;
    try {
      size = (await stat(join(uploadsDir, name))).size;
    } catch {
      console.log(`  ! ${userId}: ${name} está en el carrusel pero no existe en disco`);
      continue;
    }
    owners.set(name, userId);
    if (!DRY) await registerUserFile(userId, name, size);
    added++;
    bytes += size;
  }
  const usage = DRY ? null : await getStorageUsage(userId, users);
  console.log(
    `${userId}: ${added} archivo(s), ${mb(bytes)}` +
      (usage ? ` -> usado ${mb(usage.usedBytes)} de ${mb(usage.limitBytes)}` : ' (simulación)')
  );
}

// Archivos que no están en ningún carrusel: se listan, no se tocan.
let orphans = 0;
let orphanBytes = 0;
try {
  for (const name of await readdir(uploadsDir)) {
    if (owners.has(name) || /^USER\d+-/.test(name)) continue; // los nuevos ya se anotan al subir
    const info = await stat(join(uploadsDir, name)).catch(() => null);
    if (!info || !info.isFile()) continue;
    orphans++;
    orphanBytes += info.size;
    if (orphans <= 20) console.log(`  huérfano: ${name} (${mb(info.size)})`);
  }
} catch {
  console.log(`(no se pudo leer ${uploadsDir})`);
}
console.log(`Huérfanos (sin carrusel, no se cuentan a nadie ni se borran): ${orphans} archivo(s), ${mb(orphanBytes)}`);

if (!DRY) {
  await updateConfig({ storageMigrated: true });
  console.log('Listo: storageMigrated = true');
} else {
  console.log('Simulación: no se escribió nada.');
}
process.exit(0);
