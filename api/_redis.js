// Redis client: supports ioredis (via REDIS_URL) or Upstash REST (KV_REST_API_URL / UPSTASH_*).
// - REDIS_URL=redis://host:6379 -> uses ioredis (local/Docker)
// - KV_REST_API_URL + KV_REST_API_TOKEN -> uses Upstash REST API (Vercel)

let ioredis = null;
let restConfig = null;

function pickEnv(suffixes) {
  for (const name of suffixes) {
    if (process.env[name]) return process.env[name];
  }
  const keys = Object.keys(process.env);
  for (const name of suffixes) {
    const match = keys.find((k) => k === name || k.endsWith('_' + name));
    if (match) return process.env[match];
  }
  return undefined;
}

function resolveRest() {
  if (!restConfig) {
    restConfig = {
      url: pickEnv(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']),
      token: pickEnv(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']),
    };
  }
  return restConfig;
}

async function getIoredis() {
  if (!ioredis && process.env.REDIS_URL) {
    const { default: Redis } = await import('ioredis');
    ioredis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });
    ioredis.on('error', (err) => console.error('ioredis error:', err.message));
  }
  return ioredis;
}

export function isConfigured() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) return true;
  const { url, token } = resolveRest();
  return Boolean(url && token);
}

async function restCommand(...args) {
  const { url, token } = resolveRest();
  if (!url || !token) {
    throw new Error('Redis no configurado. Define REDIS_URL o KV_REST_API_URL + KV_REST_API_TOKEN.');
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Redis error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.result;
}

async function ioCommand(...args) {
  const client = await getIoredis();
  if (!client) throw new Error('ioredis no inicializado');
  if (client.status === 'wait') await client.connect();
  return client.call(...args);
}

async function command(...args) {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) return ioCommand(...args);
  return restCommand(...args);
}

export async function getJson(key) {
  const raw = await command('GET', key);
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setJson(key, value) {
  await command('SET', key, JSON.stringify(value));
  return true;
}

export async function delKey(key) {
  await command('DEL', key);
  return true;
}