// Storage abstraction.
// - On Vercel (no LOCAL_STORAGE): uses Upstash Redis (REST) + Vercel Blob.
// - With LOCAL_STORAGE=1 (Docker / local): uses files under LOCAL_DATA_DIR,
//   so the whole app runs with no external services.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getJson as redisGet, setJson as redisSet, delKey as redisDel } from './_redis.js';
import { unlink } from 'node:fs/promises';
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

// Recomprime a WebP de alta calidad (q90: el texto de los pósters se ve igual) sin
// agrandar y con 1920 px como máximo en el lado largo. GIF (puede ser animado) se deja
// igual. Si algo falla o no se gana peso, devuelve el original.
// `kind` = { type, ext } de sniffImageType. Devuelve { buffer, type, ext }.
export async function optimizeImage(buffer, kind) {
  const original = { buffer, type: kind?.type, ext: kind?.ext };
  if (!kind || kind.type === 'image/gif') return original;
  const sharp = await getSharp();
  if (!sharp) return original;
  try {
    const out = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .rotate() // respeta la orientación EXIF de fotos de celular
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 90, effort: 4, smartSubsample: true })
      .toBuffer();
    if (out.length >= buffer.length) return original;
    return { buffer: out, type: 'image/webp', ext: 'webp' };
  } catch {
    return original;
  }
}
