// Storage abstraction.
// - On Vercel (no LOCAL_STORAGE): uses Upstash Redis (REST) + Vercel Blob.
// - With LOCAL_STORAGE=1 (Docker / local): uses files under LOCAL_DATA_DIR,
//   so the whole app runs with no external services.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { getJson as redisGet, setJson as redisSet } from './_redis.js';
import { put } from '@vercel/blob';

const LOCAL = process.env.LOCAL_STORAGE === '1';
const DATA_DIR = process.env.LOCAL_DATA_DIR || join(process.cwd(), '.data');
const BLOB_ACCESS = (process.env.BLOB_ACCESS || 'public').toLowerCase() === 'private' ? 'private' : 'public';

export function isLocal() {
  return LOCAL;
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

// ==================== Image hosting (Vercel Blob or local disk) ====================

export async function putImage(fileName, buffer, contentType, request) {
  if (LOCAL) {
    const file = join(DATA_DIR, 'uploads', fileName);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, buffer);
    let origin = '';
    try {
      origin = new URL(request.url).origin;
    } catch {
      origin = '';
    }
    return {
      url: `${origin}/uploads/${fileName}`,
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
