// Cuentas por cuenta propia: registro con verificación de correo y recuperación de contraseña.
//   POST /api/account/register  { name, email, password, turnstile }
//   POST /api/account/verify    { token }            -> crea la cuenta y abre sesión
//   POST /api/account/forgot    { email, turnstile }
//   POST /api/account/reset     { token, password }
// register y forgot responden siempre lo mismo, exista o no el correo.
import { createHash, randomBytes } from 'node:crypto';
import {
  checkRateLimit, getClientIp, sameOrigin, errorResponse, successResponse,
  validateEmail, normalizeEmail, findUserByEmail, getUsers, normalizeUserId,
  isValidNewPassword, PASSWORD_ERROR, createUser, updateUserPassword,
  startSession, setAuthCookie, appBaseUrl,
} from './_utils.js';
import { setOnce, tempTake, tempDelete, incrWithTtl } from './_store.js';
import {
  mailConfigured, sendMail, verifyEmailMessage, alreadyRegisteredMessage, resetPasswordMessage,
} from './_mail.js';
import { verifyTurnstile, turnstileReady, turnstileSiteKey } from './_turnstile.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || '5', 10);
const HOURLY_LIMIT = parseInt(process.env.ACCOUNT_HOURLY_LIMIT || '10', 10);
const MAIL_COOLDOWN_SECONDS = parseInt(process.env.MAIL_COOLDOWN_SECONDS || '120', 10);
const SIGNUP_TTL = 24 * 3600;
const RESET_TTL = 30 * 60;

const sha256Hex = (v) => createHash('sha256').update(String(v)).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const signupKey = (token) => `carousel:signup:${sha256Hex(token)}`;
const resetKey = (token) => `carousel:reset:${sha256Hex(token)}`;
const cooldownKey = (kind, email) => `carousel:mailcool:${kind}:${sha256Hex(email)}`;
// Huella de la clave actual: un enlace de recuperación deja de valer si la clave cambió.
const passwordPrint = (passwordHash) => sha256Hex(passwordHash || '').slice(0, 16);

export const signupEnabled = () => process.env.SIGNUP_ENABLED !== '0';

// Lo que el login necesita saber (solo valores publicables).
export function accountOptions() {
  const ready = mailConfigured() && turnstileReady();
  return {
    signupEnabled: signupEnabled() && ready,
    recoveryEnabled: ready,
    turnstileSiteKey: turnstileSiteKey(),
  };
}

const isToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(t);

async function readBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return null;
  }
}

// Límite por IP: ráfaga en memoria + tope por hora compartido (Redis).
async function limitByIp(request, kind) {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`account:${kind}:${ip}`, RATE_LIMIT);
  if (!rl.allowed) return errorResponse('Demasiados intentos. Espera un momento.', 429, { resetAt: rl.resetAt });
  if (kind === 'mail') {
    const n = await incrWithTtl(`carousel:accountip:${sha256Hex(ip)}`, 3600);
    if (n > HOURLY_LIMIT) return errorResponse('Demasiados intentos. Inténtalo más tarde.', 429);
  }
  return null;
}

// Requisitos comunes de register y forgot: correo y captcha configurados, límites, captcha.
async function mailGate(request, body) {
  if (!mailConfigured() || !turnstileReady()) {
    return errorResponse('El envío de correos no está configurado', 503);
  }
  const limited = await limitByIp(request, 'mail');
  if (limited) return limited;
  if (!(await verifyTurnstile(body.turnstile, getClientIp(request)))) {
    return errorResponse('No se pudo comprobar que no eres un robot. Recarga la página e inténtalo de nuevo.', 400);
  }
  return null;
}

async function issueResetLink(base, user) {
  const token = newToken();
  await setOnce(resetKey(token), RESET_TTL, `${user.userId}:${passwordPrint(user.passwordHash)}`);
  return `${base}/admin.html#restablecer=${token}`;
}

const CHECK_MAIL = 'Si los datos son correctos, te llegará un correo en unos minutos. Revisa también la carpeta de spam.';

async function register(request) {
  if (!signupEnabled()) return errorResponse('El registro de cuentas está cerrado', 403);
  const body = await readBody(request);
  if (!body) return errorResponse('Invalid JSON', 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) return errorResponse('Escribe tu nombre (máximo 120 caracteres)', 400);
  if (!validateEmail(body.email)) return errorResponse('Correo no válido', 400);
  if (!isValidNewPassword(body.password)) return errorResponse(PASSWORD_ERROR, 400);

  const gate = await mailGate(request, body);
  if (gate) return gate;
  const base = appBaseUrl(request);
  if (!base) return errorResponse('Falta configurar APP_URL en el servidor', 500);

  const email = normalizeEmail(body.email);
  // La clave se hashea siempre, exista o no el correo: así ambas respuestas tardan lo mismo.
  const { hash } = await import('@node-rs/argon2');
  const passwordHash = await hash(body.password);
  const existing = await findUserByEmail(email);

  const cool = cooldownKey('register', email);
  if (!(await setOnce(cool, MAIL_COOLDOWN_SECONDS))) return successResponse(null, CHECK_MAIL);
  try {
    let message;
    if (existing) {
      message = alreadyRegisteredMessage({ name: existing.name || name, link: await issueResetLink(base, existing) });
    } else {
      const token = newToken();
      await setOnce(signupKey(token), SIGNUP_TTL, JSON.stringify({ name, email, passwordHash }));
      message = verifyEmailMessage({ name, link: `${base}/admin.html#verificar=${token}` });
    }
    await sendMail({ to: email, ...message });
  } catch (err) {
    console.error('POST /api/account/register mail error:', err.message);
    await tempDelete(cool);
    return errorResponse('No se pudo enviar el correo. Inténtalo de nuevo en unos minutos.', 502);
  }
  return successResponse(null, CHECK_MAIL);
}

async function verify(request) {
  const limited = await limitByIp(request, 'token');
  if (limited) return limited;
  const body = await readBody(request);
  if (!body) return errorResponse('Invalid JSON', 400);
  if (!isToken(body.token)) return errorResponse('El enlace no es válido', 400);

  const raw = await tempTake(signupKey(body.token));
  if (!raw) return errorResponse('El enlace no es válido o ya caducó. Vuelve a registrarte.', 400);
  let pending;
  try { pending = JSON.parse(raw); } catch { return errorResponse('El enlace no es válido', 400); }

  let user;
  try {
    user = await createUser({ ...pending, createdBy: 'self' });
  } catch (err) {
    if (err.code === 'EMAIL_TAKEN') return errorResponse('Ese correo ya tiene una cuenta. Inicia sesión.', 409);
    console.error('POST /api/account/verify error:', err);
    return errorResponse('No se pudo crear la cuenta', 500);
  }

  const { token, maxAge } = await startSession(request, { role: 'user', userId: user.userId });
  const response = successResponse(
    { authenticated: true, role: 'user', userId: user.userId, name: user.name, email: user.email },
    'Cuenta creada'
  );
  setAuthCookie(response, token, { 'Max-Age': maxAge });
  return response;
}

async function forgot(request) {
  const body = await readBody(request);
  if (!body) return errorResponse('Invalid JSON', 400);
  if (!validateEmail(body.email)) return errorResponse('Correo no válido', 400);

  const gate = await mailGate(request, body);
  if (gate) return gate;
  const base = appBaseUrl(request);
  if (!base) return errorResponse('Falta configurar APP_URL en el servidor', 500);

  const email = normalizeEmail(body.email);
  const user = await findUserByEmail(email);
  if (user && (await setOnce(cooldownKey('reset', email), MAIL_COOLDOWN_SECONDS))) {
    // Sin await: si el correo existe no debe tardar más en responder que si no existe.
    issueResetLink(base, user)
      .then((link) => sendMail({ to: email, ...resetPasswordMessage({ name: user.name || '', link }) }))
      .catch((err) => console.error('POST /api/account/forgot mail error:', err.message));
  }
  return successResponse(null, CHECK_MAIL);
}

async function reset(request) {
  const limited = await limitByIp(request, 'token');
  if (limited) return limited;
  const body = await readBody(request);
  if (!body) return errorResponse('Invalid JSON', 400);
  if (!isToken(body.token)) return errorResponse('El enlace no es válido', 400);
  if (!isValidNewPassword(body.password)) return errorResponse(PASSWORD_ERROR, 400);

  const invalid = () => errorResponse('El enlace no es válido o ya caducó. Pide uno nuevo.', 400);
  const raw = await tempTake(resetKey(body.token));
  if (!raw) return invalid();
  const [rawId, print] = raw.split(':');
  const userId = normalizeUserId(rawId);
  const current = userId ? (await getUsers())[userId] : null;
  if (!current || passwordPrint(current.passwordHash) !== print) return invalid();

  // Sube la versión de sesiones: se cierran todas las sesiones abiertas con la clave anterior.
  if (!(await updateUserPassword(userId, body.password))) return invalid();
  return successResponse(null, 'Contraseña actualizada. Ya puedes iniciar sesión.');
}

const ROUTES = { register, verify, forgot, reset };

export async function POST(request) {
  if (!sameOrigin(request)) return errorResponse('Forbidden', 403);
  const action = new URL(request.url).pathname.split('/').pop();
  const handler = ROUTES[action];
  if (!handler) return errorResponse('Not found', 404);
  try {
    return await handler(request);
  } catch (err) {
    console.error(`POST /api/account/${action} error:`, err);
    return errorResponse('Error interno', 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
