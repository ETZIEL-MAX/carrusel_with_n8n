// Cloudflare Turnstile: captcha del registro y de la recuperación de contraseña.
// Sin TURNSTILE_SECRET_KEY y fuera de producción no se pide (dev y tests).
// En producción sin claves falla cerrado: no se acepta ningún registro.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 8000;

const isProd = () => process.env.NODE_ENV === 'production';

// Clave pública del widget (va al navegador) o null si no se usa.
export function turnstileSiteKey() {
  return process.env.TURNSTILE_SECRET_KEY ? (process.env.TURNSTILE_SITE_KEY || null) : null;
}

export function turnstileReady() {
  if (process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY) return true;
  return !isProd();
}

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return !isProd();
  if (!token || typeof token !== 'string' || token.length > 2048) return false;

  const form = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') form.set('remoteip', ip);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form, signal: controller.signal });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.success === true;
  } catch (err) {
    console.error('Turnstile siteverify error:', err.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
