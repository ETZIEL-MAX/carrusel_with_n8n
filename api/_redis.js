// Minimal Redis REST client compatible with both the legacy Vercel KV
// integration and the Upstash Redis marketplace integration.
// Supports: KV_REST_API_URL/TOKEN and UPSTASH_REDIS_REST_URL/TOKEN.

const REST_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REST_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function isConfigured() {
  return Boolean(REST_URL && REST_TOKEN);
}

async function command(...args) {
  if (!isConfigured()) {
    throw new Error(
      'Redis no configurado. Define KV_REST_API_URL y KV_REST_API_TOKEN (o las variantes UPSTASH_*).'
    );
  }

  const res = await fetch(REST_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
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
