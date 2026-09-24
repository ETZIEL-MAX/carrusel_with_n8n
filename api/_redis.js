// Minimal Redis REST client compatible with both the legacy Vercel KV
// integration and the Upstash Redis marketplace integration.
//
// Accepts the exact names (KV_REST_API_URL / UPSTASH_REDIS_REST_URL) and also
// any custom-prefixed variant (e.g. MYAPP_KV_REST_API_URL), which Vercel's
// "Custom Prefix" option on a storage integration produces.

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

function resolve() {
  return {
    url: pickEnv(['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']),
    token: pickEnv(['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']),
  };
}

export function isConfigured() {
  const { url, token } = resolve();
  return Boolean(url && token);
}

async function command(...args) {
  const { url, token } = resolve();
  if (!url || !token) {
    throw new Error(
      'Redis no configurado. Define KV_REST_API_URL y KV_REST_API_TOKEN (o las variantes UPSTASH_*).'
    );
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
