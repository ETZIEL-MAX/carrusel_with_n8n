// Storage abstraction.
// - On Vercel (no LOCAL_STORAGE): uses Upstash Redis (REST) + Vercel Blob.
// - With LOCAL_STORAGE=1 (Docker / local): uses files under LOCAL_DATA_DIR,
//   so the whole app runs with no external services.

import { readFile, writeFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as redis from './_redis.js';
import { getJson as redisGet, setJson as redisSet, delKey as redisDel } from './_redis.js';
import { put, del as blobDel } from '@vercel/blob';

const LOCAL = process.env.LOCAL_STORAGE === '1';
// Image files can live on local disk even when data is in Redis (Docker: Redis + ./.data volume).
// On Vercel leave IMAGE_STORAGE unset so images go to Vercel Blob.
const LOCAL_IMAGES = LOCAL || (process.env.IMAGE_STORAGE || '').toLowerCase() === 'local';
const DATA_DIR = process.env.LOCAL_DATA_DIR || join(process.cwd(), '.data');
const BLOB_ACCESS = (process.env.BLOB_ACCESS || 'public').toLowerCase() === 'private' ? 'private' : 'public';

export function isLocal() {
  return LOCAL;
}

export function isLocalImages() {
  return LOCAL_IMAGES;
}

// Carpeta en disco de los archivos subidos (solo con imágenes locales).
export function localUploadsDir() {
  return join(DATA_DIR, 'uploads');
}

// Dónde se escriben los temporales de una subida mientras llega. En local, junto a los
// archivos finales (mismo disco: el paso a final es un rename). En Vercel, /tmp.
export function uploadTempDir() {
  return LOCAL_IMAGES ? localUploadsDir() : tmpdir();
}

function safeKey(key) {
  return String(key).replace(/[^a-zA-Z0-9_.-]/g, '_');
}

// ==================== Key/value (Redis or local files) ====================

export async function getJson(key) {
  if (!LOCAL) return redisGet(key);
  try {
    const raw = await readFile(join(DATA_DIR, 'kv', safeKey(key) + '.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setJson(key, value) {
  if (!LOCAL) return redisSet(key, value);
  const file = join(DATA_DIR, 'kv', safeKey(key) + '.json');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value), 'utf8');
  return true;
}

export async function delKey(key) {
  if (!LOCAL) return redisDel(key);
  try {
    await unlink(join(DATA_DIR, 'kv', safeKey(key) + '.json'));
    return true;
  } catch {
    return false;
  }
}

// ==================== Contadores y llaves con caducidad ====================
// En local viven en memoria (solo desarrollo y tests); en producción, en Redis.

const localTemp = new Map(); // key -> { value, exp }

function tempGet(key) {
  const rec = localTemp.get(key);
  if (!rec) return null;
  if (rec.exp && rec.exp <= Date.now()) {
    localTemp.delete(key);
    return null;
  }
  return rec;
}

function tempSweep() {
  if (localTemp.size < 5000) return;
  const now = Date.now();
  for (const [k, rec] of localTemp) if (rec.exp && rec.exp <= now) localTemp.delete(k);
}

// Suma 1 al contador; el primer incremento fija su caducidad. Devuelve el total.
export async function incrWithTtl(key, ttlSeconds) {
  if (!LOCAL) {
    const n = await redis.incrBy(key, 1);
    if (n === 1) await redis.expire(key, ttlSeconds);
    return n;
  }
  tempSweep();
  const rec = tempGet(key) || { value: 0, exp: Date.now() + ttlSeconds * 1000 };
  rec.value += 1;
  localTemp.set(key, rec);
  return rec.value;
}

// Crea la llave solo si no existía. Devuelve true si se creó.
export async function setOnce(key, ttlSeconds, value = '1') {
  if (!LOCAL) return redis.setNx(key, value, ttlSeconds);
  tempSweep();
  if (tempGet(key)) return false;
  localTemp.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
  return true;
}

export async function tempExists(key) {
  if (!LOCAL) return redis.exists(key);
  return Boolean(tempGet(key));
}

export async function tempDelete(key) {
  if (!LOCAL) return redisDel(key);
  localTemp.delete(key);
  return true;
}

// ==================== Hashes (campo -> número) ====================
// En local son un archivo JSON por hash; las escrituras se encadenan por llave
// para que dos peticiones simultáneas no se pisen.

const localLocks = new Map();
function withLocalLock(key, fn) {
  const prev = localLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  localLocks.set(key, next.catch(() => {}));
  return next;
}

async function localHash(key) {
  const data = await getJson(key);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

export async function hashGetAll(key) {
  const raw = LOCAL ? await localHash(key) : await redis.hGetAll(key);
  const out = {};
  for (const [field, value] of Object.entries(raw)) out[field] = Number(value) || 0;
  return out;
}

export async function hashSet(key, field, value) {
  if (!LOCAL) return redis.hSet(key, field, value);
  return withLocalLock(key, async () => {
    const data = await localHash(key);
    data[field] = Number(value) || 0;
    await setJson(key, data);
    return true;
  });
}

export async function hashDel(key, field) {
  if (!LOCAL) return redis.hDel(key, field);
  return withLocalLock(key, async () => {
    const data = await localHash(key);
    if (field in data) {
      delete data[field];
      await setJson(key, data);
    }
    return true;
  });
}

export async function hashIncrBy(key, field, amount = 1) {
  if (!LOCAL) return redis.hIncrBy(key, field, amount);
  return withLocalLock(key, async () => {
    const data = await localHash(key);
    data[field] = (Number(data[field]) || 0) + amount;
    await setJson(key, data);
    return data[field];
  });
}

// ==================== Image hosting (Vercel Blob or local disk) ====================

export async function putImage(fileName, buffer, contentType, request) {
  if (LOCAL_IMAGES) {
    const file = join(DATA_DIR, 'uploads', fileName);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buffer);
    // URL relativa: funciona con cualquier dominio (el interno puede ser
    // http://localhost:8080 y romper la imagen en el navegador).
    return {
      url: `/uploads/${fileName}`,
      pathname: `uploads/${fileName}`,
      contentType,
    };
  }

  const pathname = `carousel/${fileName}`;
  const blob = await put(pathname, buffer, {
    access: BLOB_ACCESS,
    contentType,
    addRandomSuffix: false,
  });
  return { url: blob.url, pathname: blob.pathname, contentType: blob.contentType };
}

// Nombre del archivo si la imagen la hospedamos nosotros (/uploads/... o Vercel Blob);
// null si es una URL externa. Es la llave con la que se lleva la cuenta del espacio.
export function ownFileName(image) {
  const url = typeof image === 'string' ? image : (image && image.url) || '';
  const pathname = (image && typeof image === 'object' && image.pathname) || '';
  const src = String(pathname || url);
  if (!src) return null;
  if (LOCAL_IMAGES) {
    const m = /(?:^|\/)uploads\/([A-Za-z0-9._-]+)$/.exec(src);
    return m ? m[1] : null;
  }
  if (!/vercel-storage\.com/i.test(String(url))) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || null;
  } catch {
    return null;
  }
}

// Igual que putImage, pero el contenido está en un archivo temporal: no se carga en
// memoria en local (se renombra). En Vercel Blob sí se lee, porque el SDK pide un buffer;
// ahí las subidas son pequeñas (límite 4.5 MB del despliegue).
export async function putImageFromFile(fileName, srcPath, contentType) {
  if (LOCAL_IMAGES) {
    const file = join(DATA_DIR, 'uploads', fileName);
    await mkdir(dirname(file), { recursive: true });
    await rename(srcPath, file);
    return {
      url: `/uploads/${fileName}`,
      pathname: `uploads/${fileName}`,
      contentType,
    };
  }
  return putImage(fileName, await readFile(srcPath), contentType);
}

// Borra el archivo físico de una imagen que hospedamos nosotros.
// SOLO toca lo propio: en local, rutas /uploads/...; en Vercel, blobs de
// vercel-storage.com. Las URLs externas (añadidas a mano) NO se tocan.
// Nunca lanza: devuelve true/false.
export async function deleteImageFile(image) {
  try {
    const url = typeof image === 'string' ? image : (image && image.url) || '';
    const pathname = (image && typeof image === 'object' && image.pathname) || '';
    if (!url && !pathname) return false;

    if (LOCAL_IMAGES) {
      const src = String(pathname || url);
      const m = /(?:^|\/)uploads\/([^/?#]+)$/.exec(src);
      if (!m) return false; // URL externa u otra ruta: no la tocamos
      await unlink(join(DATA_DIR, 'uploads', m[1]));
      return true;
    }

    if (/vercel-storage\.com/i.test(String(url))) {
      await blobDel(url);
      return true;
    }
    return false;
  } catch {
    return false; // archivo ya no existe / error: no es fatal
  }
}

// ==================== Optimización de imágenes (WebP) ====================
// sharp se carga perezosamente; si no está disponible se guarda el original.
let sharpMod = null;
async function getSharp() {
  if (sharpMod === null) {
    try {
      sharpMod = (await import('sharp')).default;
      sharpMod.cache(false); // poca RAM en el contenedor (mem_limit 256 MB)
      sharpMod.concurrency(1);
    } catch {
      sharpMod = false;
    }
  }
  return sharpMod || null;
}

// Si sharp se queda trabado con una imagen, corta y se guarda el original: una sola
// imagen no puede dejar la fila detenida para todas las demás.
const SHARP_TIMEOUT_SECONDS = 30;
// Lado mayor máximo de una imagen guardada: cabe un póster 4K (3840x2160); lo que pase se reduce.
const MAX_IMAGE_SIDE = 3840;

// Una optimización a la vez: cada una cuesta ~80 MB de RAM nativa (libvips, fuera del heap
// de Node), y el contenedor tiene 256 MB. Tres fotos en paralelo lo tiran.
let optimizeQueue = Promise.resolve();
function oneAtATime(fn) {
  const run = optimizeQueue.then(fn, fn);
  optimizeQueue = run.catch(() => {});
  return run;
}

// Versión en archivo de optimizeImage: sharp lee y escribe desde disco, así que la RAM
// no depende del tamaño de la foto. Devuelve { path, type, ext, bytes }; `path` es el
// original si no hay nada que ganar, o `${srcPath}.webp` si salió más chico.
export function optimizeImageFile(srcPath, kind) {
  return oneAtATime(() => optimizeFile(srcPath, kind));
}

async function optimizeFile(srcPath, kind) {
  const size = (await stat(srcPath)).size;
  const original = { path: srcPath, type: kind?.type, ext: kind?.ext, bytes: size };
  if (!kind || kind.type === 'image/gif') return original;
  const sharp = await getSharp();
  if (!sharp) return original;
  const out = `${srcPath}.webp`;
  try {
    // sequentialRead: libvips decodifica por franjas en vez de cargar la foto entera.
    const info = await sharp(srcPath, { limitInputPixels: 40_000_000, sequentialRead: true })
      .rotate()
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90, effort: 4, smartSubsample: true })
      .timeout({ seconds: SHARP_TIMEOUT_SECONDS })
      .toFile(out);
    if (info.size >= size) {
      await unlink(out).catch(() => {});
      return original;
    }
    return { path: out, type: 'image/webp', ext: 'webp', bytes: info.size };
  } catch {
    await unlink(out).catch(() => {});
    return original;
  }
}

// Recomprime a WebP de alta calidad (q90: el texto de los pósters se ve igual) sin
// agrandar y con 3840 px (4K) como máximo en el lado largo. GIF (puede ser animado) se deja
// igual. Si algo falla o no se gana peso, devuelve el original.
// `kind` = { type, ext } de sniffImageType. Devuelve { buffer, type, ext }.
// Pasa por la misma fila que optimizeImageFile: nunca dos pipelines de sharp a la vez.
export function optimizeImage(buffer, kind) {
  return oneAtATime(() => optimizeBuffer(buffer, kind));
}

async function optimizeBuffer(buffer, kind) {
  const original = { buffer, type: kind?.type, ext: kind?.ext };
  if (!kind || kind.type === 'image/gif') return original;
  const sharp = await getSharp();
  if (!sharp) return original;
  try {
    const out = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate() // respeta la orientación EXIF de fotos de celular
      .resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90, effort: 4, smartSubsample: true })
      .timeout({ seconds: SHARP_TIMEOUT_SECONDS })
      .toBuffer();
    if (out.length >= buffer.length) return original;
    return { buffer: out, type: 'image/webp', ext: 'webp' };
  } catch {
    return original;
  }
}
