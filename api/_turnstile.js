// Cloudflare Turnstile: captcha opcional del registro y de la recuperación de contraseña.
// El captcha se pide solo si están TURNSTILE_SECRET_KEY y TURNSTILE_SITE_KEY. Sin ellas,
// el registro sigue protegido por los límites por IP y por correo.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 8000;

const captchaOn = () => Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY);

// Clave pública del widget (va al navegador) o null si no se usa.
export function turnstileSiteKey() {
  return captchaOn() ? process.env.TURNSTILE_SITE_KEY : null;
}

// El captcha no es requisito para que el registro esté disponible.
export function turnstileReady() {
  return true;
}

export async function verifyTurnstile(token, ip) {
  if (!captchaOn()) return true;
  const secret = process.env.TURNSTILE_SECRET_KEY;
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
