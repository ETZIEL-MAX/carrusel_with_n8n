import { SignJWT, jwtVerify } from 'jose';
import {
  createHmac, createHash, timingSafeEqual, randomUUID, randomBytes,
  createCipheriv, createDecipheriv,
} from 'crypto';
import { open } from 'node:fs/promises';
import {
  getJson, setJson, delKey, deleteImageFile, putImage, putImageFromFile, optimizeImageFile,
  ownFileName, isLocalImages,
  incrWithTtl, setOnce, tempExists, tempDelete,
  hashGetAll, hashSet, hashDel, hashIncrBy,
} from './_store.js';
import { planState, resolvePlans, trialFields, PLAN_IDS, PLAN_PROVIDERS } from './_plans.js';

const DEFAULT_IMAGES = [];

function imagesKey(userId) {
  return `carousel:${userId}:images`;
}

function usersKey() {
  return 'carousel:users';
}

function filesKey(userId) {
  return `carousel:${userId}:files`;
}

function devicesKey(userId) {
  return `carousel:${userId}:devices`;
}

// Pantallas quitadas desde el panel (id -> ms). Si siguen encendidas no vuelven a entrar.
function revokedDevicesKey(userId) {
  return `carousel:${userId}:devices:revoked`;
}

function usageKey(userId, month) {
  return `carousel:${userId}:usage:${month}`;
}

function sanitizeUserId(id) {
  return String(id).replace(/[^a-zA-Z0-9_.-]/g, '_').toUpperCase();
}

// `USER1`, `user2` -> `USER1` / `USER2`; cualquier otra cosa -> null.
// Todo userId que venga de fuera pasa por aquí antes de formar una llave.
export function normalizeUserId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toUpperCase();
  return /^USER\d+$/.test(id) ? id : null;
}

const sha256Hex = (value) => createHash('sha256').update(String(value)).digest('hex');

// IP del cliente: nginx manda la real en X-Forwarded-For (una sola).
export function getClientIp(request) {
  const raw = request.headers.get('x-forwarded-for') || '';
  return raw.split(',')[0].trim() || 'unknown';
}

// URL pública del sitio para armar enlaces (correos, URL de vuelta para n8n). Sale de
// APP_URL y nunca del header Host, que el cliente controla. Sin APP_URL, solo fuera de
// producción se usa el Host (dev y tests). Devuelve null si no se puede saber.
export function appBaseUrl(request) {
  const fromEnv = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production' || !request) return null;
  const host = request.headers.get('host');
  return host ? `http://${host}` : null;
}

// Webhooks de n8n a los que el servidor puede llamar: solo hosts de N8N_ALLOWED_HOSTS.
export function isAllowedN8nUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const allowed = String(process.env.N8N_ALLOWED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(url.hostname.toLowerCase());
}

// ==================== Configuración global (super-admin) ====================

const CONFIG_KEY = 'carousel:config';
const DEFAULT_IMAGE_PRICE_USD = 0.06;

export async function getConfig() {
  const cfg = await getJson(CONFIG_KEY);
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
}

export async function updateConfig(patch) {
  const cfg = { ...(await getConfig()), ...patch, updatedAt: new Date().toISOString() };
  await setJson(CONFIG_KEY, cfg);
  return cfg;
}

// Precio aproximado por imagen cuando el proveedor no reporta tokens.
export function imagePriceFrom(cfg) {
  const fromCfg = Number(cfg?.imagePriceUsd);
  if (Number.isFinite(fromCfg) && fromCfg >= 0) return fromCfg;
  const fromEnv = Number(process.env.IMAGE_PRICE_USD);
  return Number.isFinite(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_IMAGE_PRICE_USD;
}

// ==================== JWT Utilities ====================

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET not configured');
  }
  return new TextEncoder().encode(secret);
}

export async function createToken(payload, expiry = '1h') {
  const secret = getJwtSecret();
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(secret);
}

export async function verifyToken(token) {
  const secret = getJwtSecret();
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}

export function getTokenFromCookie(request, cookieName = 'auth_token') {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
  return match ? match[1] : null;
}

export function isSuperAdmin(payload) {
  return payload && payload.role === 'super-admin';
}

export function isUser(payload) {
  return payload && payload.role === 'user';
}

export function getTargetUserId(request, payload) {
  if (isSuperAdmin(payload)) {
    const url = new URL(request.url);
    return normalizeUserId(url.searchParams.get('userId'));
  }
  if (isUser(payload)) {
    return payload.userId;
  }
  return null;
}

// Carrusel sobre el que actúa una petición con cookie. El de un usuario sale SIEMPRE
// de su sesión; si además pide otro por la URL, se rechaza. El super-admin lo indica
// con ?userId. Devuelve el userId o una Response de error.
export function resolveUserId(request, payload) {
  const raw = new URL(request.url).searchParams.get('userId');
  const requested = raw ? normalizeUserId(raw) : null;
  if (isUser(payload)) {
    if (raw && requested !== payload.userId) return errorResponse('Forbidden', 403);
    return payload.userId;
  }
  if (isSuperAdmin(payload)) {
    if (!raw) return errorResponse('userId required for super-admin', 400);
    return requested || errorResponse('Invalid userId', 400);
  }
  return errorResponse('Forbidden', 403);
}

// ==================== Sesiones ====================
// El JWT lleva `sid` (identifica esta sesión) y `sv` (versión de sesiones de la cuenta).
// Cerrar sesión anota el `sid` como revocado; cambiar la contraseña o "cerrar todas"
// sube la versión y deja sin efecto todas las cookies anteriores, aunque se hayan copiado.

// '30m', '1h', '2d' o segundos -> segundos.
export function parseExpirySeconds(value, fallback) {
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(value || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 10) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
  return n > 0 ? n : fallback;
}

const userSessionSeconds = () => parseExpirySeconds(process.env.JWT_EXPIRY, 3600);
const adminSessionSeconds = () => parseExpirySeconds(process.env.ADMIN_JWT_EXPIRY, 1800);
const revokedKey = (sid) => `carousel:revoked:${sid}`;
const userAgentHash = (request) => sha256Hex(request.headers.get('user-agent') || '').slice(0, 16);

// Cambia sola si cambia la contraseña del super-admin (ADMIN_PASSWORD_HASH).
async function adminSessionVersion() {
  const cfg = await getConfig();
  return `${cfg.adminSessionVersion || 0}.${sha256Hex(process.env.ADMIN_PASSWORD_HASH || '').slice(0, 12)}`;
}

// Crea la sesión. Devuelve { token, maxAge } para la cookie.
export async function startSession(request, { role, userId }) {
  const claims = { role, sid: randomUUID() };
  let maxAge;
  if (role === 'super-admin') {
    claims.sv = await adminSessionVersion();
    claims.ua = userAgentHash(request); // atada al navegador donde se inició
    maxAge = adminSessionSeconds();
  } else {
    const users = await getUsers();
    claims.userId = userId;
    claims.sv = users[userId]?.sessionVersion || 0;
    maxAge = userSessionSeconds();
  }
  return { token: await createToken(claims, `${maxAge}s`), maxAge };
}

// Sesión vigente de la petición, o null.
export async function getSession(request) {
  const token = getTokenFromCookie(request);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload || !payload.sid) return null;
  if (await tempExists(revokedKey(payload.sid))) return null;

  if (isSuperAdmin(payload)) {
    if (payload.sv !== (await adminSessionVersion())) return null;
    if (payload.ua !== userAgentHash(request)) return null;
    return payload;
  }
  if (isUser(payload)) {
    const userId = normalizeUserId(payload.userId);
    if (!userId) return null;
    const users = await getUsers();
    if (!users[userId]) return null; // usuario borrado
    if ((users[userId].sessionVersion || 0) !== payload.sv) return null;
    return payload;
  }
  return null;
}

// Revoca la sesión de esta petición (logout).
export async function endSession(request) {
  const token = getTokenFromCookie(request);
  const payload = token ? await verifyToken(token) : null;
  if (!payload || !payload.sid) return false;
  const left = Math.max(60, (payload.exp || 0) - Math.floor(Date.now() / 1000));
  await setOnce(revokedKey(payload.sid), left);
  return true;
}

// Deja sin efecto todas las sesiones de la cuenta (incluida la actual).
export async function endAllSessions(payload) {
  if (isSuperAdmin(payload)) {
    const cfg = await getConfig();
    await updateConfig({ adminSessionVersion: (cfg.adminSessionVersion || 0) + 1 });
    return true;
  }
  if (isUser(payload)) return bumpUserSessionVersion(payload.userId);
  return false;
}

// Las peticiones del navegador que cambian datos deben venir del propio sitio.
// (n8n, curl y los tests no mandan Origin; la cookie SameSite=Strict cubre el resto.)
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Sesión obligatoria para los handlers. Devuelve { payload } o una Response de error.
export async function requireSession(request, { superAdmin = false } = {}) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) {
    return errorResponse('Forbidden', 403);
  }
  if (!getTokenFromCookie(request)) return errorResponse('Unauthorized', 401);
  const payload = await getSession(request);
  if (!payload) return errorResponse('Unauthorized', 401);
  if (superAdmin && !isSuperAdmin(payload)) return errorResponse('Forbidden', 403);
  return { payload };
}

// ==================== Intentos de login ====================
// Contador compartido (Redis): sobrevive a reinicios. Tras varios fallos seguidos
// desde la misma IP contra la misma cuenta, se bloquea un rato.

const LOGIN_MAX_FAILS = parseInt(process.env.LOGIN_MAX_FAILS || '10', 10);
const LOGIN_LOCK_SECONDS = parseInt(process.env.LOGIN_LOCK_SECONDS || '900', 10);
const loginKey = (kind, request, account) =>
  `carousel:login${kind}:${sha256Hex(`${getClientIp(request)}|${String(account || 'admin').toLowerCase()}`).slice(0, 32)}`;

export async function isLoginLocked(request, account) {
  return tempExists(loginKey('lock', request, account));
}

export async function noteLoginFailure(request, account) {
  const fails = await incrWithTtl(loginKey('fail', request, account), LOGIN_LOCK_SECONDS);
  if (fails >= LOGIN_MAX_FAILS) await setOnce(loginKey('lock', request, account), LOGIN_LOCK_SECONDS);
}

export async function clearLoginFailures(request, account) {
  await tempDelete(loginKey('fail', request, account));
}

// ==================== User Operations ====================

// Detecta el tipo real de imagen por sus "magic bytes"; nunca confiar en el
// content-type del cliente. Devuelve { type, ext } o null.
export function sniffImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.length >= 6 && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return { type: 'image/gif', ext: 'gif' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}

export async function getUsers() {
  const users = await getJson(usersKey());
  return users || {};
}

export async function saveUsers(users) {
  await setJson(usersKey(), users);
}

export async function userExists(userId) {
  const users = await getUsers();
  return Boolean(users[sanitizeUserId(userId)]);
}

export function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const v = email.trim();
  if (v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

export async function findUserByEmail(email) {
  const users = await getUsers();
  const target = normalizeEmail(email);
  for (const [userId, data] of Object.entries(users)) {
    if (data && typeof data.email === 'string' && normalizeEmail(data.email) === target) {
      return { userId, ...data };
    }
  }
  return null;
}

// Contraseñas nuevas: mínimo 10. Las que ya existen siguen sirviendo para entrar.
export const MIN_PASSWORD = 10;
export const PASSWORD_ERROR = `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres`;
export const isValidNewPassword = (p) => typeof p === 'string' && p.length >= MIN_PASSWORD && p.length <= 200;

// ---- Candado de carousel:users ----
// Los usuarios viven en un solo JSON que se lee, se cambia y se vuelve a escribir. Con el
// registro abierto dos altas a la vez podrían pisarse o tomar el mismo USERn, así que toda
// escritura pasa por aquí. No es reentrante: una función con candado no llama a otra.
const USERS_LOCK = 'carousel:lock:users';
const USERS_LOCK_TTL = 15;
const USERS_LOCK_WAIT_MS = 10000;
const USER_SEQ_KEY = 'carousel:userSeq'; // último número de USERn asignado

export async function withUsersLock(fn) {
  const deadline = Date.now() + USERS_LOCK_WAIT_MS;
  while (!(await setOnce(USERS_LOCK, USERS_LOCK_TTL))) {
    if (Date.now() > deadline) {
      const err = new Error('Usuarios ocupados, inténtalo de nuevo');
      err.code = 'USERS_BUSY';
      throw err;
    }
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 40));
  }
  try {
    return await fn();
  } finally {
    await tempDelete(USERS_LOCK);
  }
}

const locked = (fn) => (...args) => withUsersLock(() => fn(...args));

export const updateUser = locked(updateUserUnlocked);
export const updateUserPassword = locked(updateUserPasswordUnlocked);
export const bumpUserSessionVersion = locked(bumpUserSessionVersionUnlocked);
export const generateClientToken = locked(generateClientTokenUnlocked);
export const updateUserSettings = locked(updateUserSettingsUnlocked);

// Alta de usuario. Recibe `password` (se hashea aquí) o `passwordHash` ya calculado
// (registro propio: la clave se hashea al registrarse, no al verificar el correo).
export async function createUser({ name, email, password, passwordHash, createdBy, terms }) {
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > 120) {
    throw new Error('Invalid name');
  }
  if (!validateEmail(email)) {
    throw new Error('Invalid email');
  }
  if (!passwordHash && !isValidNewPassword(password)) {
    throw new Error(PASSWORD_ERROR);
  }
  if (!passwordHash) {
    const { hash } = await import('@node-rs/argon2');
    passwordHash = await hash(password);
  }
  const cleanEmail = normalizeEmail(email);

  const userId = await withUsersLock(async () => {
    const users = await getUsers();
    const taken = Object.values(users).some((u) => u && typeof u.email === 'string' && normalizeEmail(u.email) === cleanEmail);
    if (taken) {
      const err = new Error('Email already in use');
      err.code = 'EMAIL_TAKEN';
      throw err;
    }
    // El número nunca se reutiliza: un USERn borrado puede seguir en pantallas
    // (/carrusel/USERn) y en las filas de n8n, y no debe pasar a otra cuenta.
    const existingIds = Object.keys(users).map(k => parseInt(k.replace('USER', ''), 10)).filter(n => !isNaN(n));
    const last = Math.max(0, ...existingIds, Number(await getJson(USER_SEQ_KEY)) || 0);
    const id = `USER${last + 1}`;
    await setJson(USER_SEQ_KEY, last + 1);
    users[id] = {
      name: cleanName,
      email: cleanEmail,
      passwordHash,
      createdAt: new Date().toISOString(),
      ...(createdBy ? { createdBy } : {}),
      // Qué versión de los términos aceptó y cuándo (registro propio).
      ...(terms && typeof terms.version === 'string' ? { termsVersion: terms.version, termsAcceptedAt: terms.acceptedAt } : {}),
      ...trialFields(),
    };
    await saveUsers(users);
    return id;
  });
  return { userId, name: cleanName, email: cleanEmail, password };
}

async function updateUserUnlocked(userId, { name, email, storageLimitMb, monthlyImageLimit }) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return null;

  // Tope mensual propio de imágenes; null o '' = usar el global.
  if (monthlyImageLimit !== undefined) {
    if (monthlyImageLimit === null || monthlyImageLimit === '') {
      delete users[id].monthlyImageLimit;
    } else if (!isValidImageLimit(monthlyImageLimit)) {
      const err = new Error(`El tope mensual debe ser un número entero entre 0 y ${MAX_MONTHLY_IMAGES}`);
      err.code = 'INVALID_LIMIT';
      throw err;
    } else {
      users[id].monthlyImageLimit = monthlyImageLimit;
    }
  }

  // null o '' = volver al límite por defecto del servidor.
  if (storageLimitMb !== undefined) {
    if (storageLimitMb === null || storageLimitMb === '') {
      delete users[id].storageLimitMb;
    } else if (!Number.isInteger(storageLimitMb) || storageLimitMb < 1 || storageLimitMb > MAX_STORAGE_MB) {
      const err = new Error(`El límite debe ser un número entero entre 1 y ${MAX_STORAGE_MB} MB`);
      err.code = 'INVALID_LIMIT';
      throw err;
    } else {
      users[id].storageLimitMb = storageLimitMb;
    }
  }

  if (name !== undefined) {
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 120) {
      const err = new Error('Invalid name');
      err.code = 'INVALID_NAME';
      throw err;
    }
    users[id].name = cleanName;
  }

  if (email !== undefined) {
    if (!validateEmail(email)) {
      const err = new Error('Invalid email');
      err.code = 'INVALID_EMAIL';
      throw err;
    }
    const cleanEmail = normalizeEmail(email);
    const other = await findUserByEmail(cleanEmail);
    if (other && other.userId !== id) {
      const err = new Error('Email already in use');
      err.code = 'EMAIL_TAKEN';
      throw err;
    }
    users[id].email = cleanEmail;
  }

  users[id].updatedAt = new Date().toISOString();
  await saveUsers(users);
  return { userId: id, ...users[id] };
}

export async function deleteUser(userId) {
  const id = sanitizeUserId(userId);
  const removed = await withUsersLock(async () => {
    const users = await getUsers();
    if (!users[id]) return false;
    delete users[id];
    await saveUsers(users);
    return true;
  });
  if (!removed) return false;
  // Borrar los archivos de las imágenes del usuario antes de quitar su lista.
  try {
    const imgs = await getImages(id);
    for (const im of imgs) {
      if (im && im.url) await removeUserFile(id, im).catch(() => {});
    }
    // Y los que subió pero nunca llegó a poner en el carrusel (solo disco local:
    // del blob no se conoce la URL completa).
    if (isLocalImages()) {
      for (const name of Object.keys(await hashGetAll(filesKey(id)))) {
        await deleteImageFile(`/uploads/${name}`).catch(() => {});
      }
    }
  } catch { /* no fatal */ }
  await delKey(imagesKey(id));
  await delKey(filesKey(id));
  await delKey(devicesKey(id));
  await delKey(revokedDevicesKey(id));
  return true;
}

// Hash argon2 de relleno: si el correo no existe se verifica contra él igual, para que
// la respuesta tarde lo mismo y no se pueda saber por tiempo qué correos existen.
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = import('@node-rs/argon2').then(({ hash }) => hash('dummy-password-not-used'));
  }
  return dummyHashPromise;
}

export async function verifyUserLogin(email, password) {
  const found = await findUserByEmail(email);
  const { verify } = await import('@node-rs/argon2');
  if (!found) {
    try { await verify(await getDummyHash(), password); } catch { /* ignore */ }
    return null;
  }
  const valid = await verify(found.passwordHash, password);
  return valid ? { userId: found.userId, name: found.name, email: found.email } : null;
}

async function updateUserPasswordUnlocked(userId, password) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return false;
  
  const { hash } = await import('@node-rs/argon2');
  users[id].passwordHash = await hash(password);
  // Contraseña nueva => las sesiones abiertas con la anterior dejan de valer.
  users[id].sessionVersion = (users[id].sessionVersion || 0) + 1;
  users[id].updatedAt = new Date().toISOString();
  await saveUsers(users);
  return true;
}

async function bumpUserSessionVersionUnlocked(userId) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return false;
  users[id].sessionVersion = (users[id].sessionVersion || 0) + 1;
  await saveUsers(users);
  return true;
}

// ==================== Token de webhook por cliente ====================
// Cada carrusel tiene su propio secreto para firmar las peticiones de n8n. Se guarda
// cifrado (AES-256-GCM con TOKEN_ENC_KEY) y solo se muestra al generarlo: para volver
// a verlo hay que regenerarlo. No se guarda un hash porque para comprobar una firma
// HMAC el servidor necesita el secreto original.

function tokenEncKey() {
  const secret = process.env.TOKEN_ENC_KEY;
  if (!secret || secret.length < 32) {
    const err = new Error('TOKEN_ENC_KEY no configurado (mínimo 32 caracteres)');
    err.code = 'NO_ENC_KEY';
    throw err;
  }
  return createHash('sha256').update(secret).digest();
}

function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenEncKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

function decryptSecret(stored) {
  const [version, iv, tag, data] = String(stored).split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Formato de token desconocido');
  const decipher = createDecipheriv('aes-256-gcm', tokenEncKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// Crea (o reemplaza) el token del cliente. Devuelve el token en claro: es la única vez
// que sale del servidor. El anterior deja de funcionar en ese momento.
export const newClientToken = () => `crt_${randomBytes(32).toString('base64url')}`;

// ==================== Número de WhatsApp vinculado ====================
// El flujo de n8n identifica al cliente por los últimos 10 dígitos del número
// (así da igual si WhatsApp lo manda como 52… o 521…). Aquí se guarda igual.
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits.slice(-10);
}

// userId que ya tiene ese número (distinto de `exceptId`) o null.
export function phoneOwner(users, phone, exceptId = null) {
  for (const [id, u] of Object.entries(users)) {
    if (id !== exceptId && u?.whatsappPhone === phone) return id;
  }
  return null;
}

// Guarda (o quita, con phone = null) el número y, si se da, el token nuevo, en un solo paso.
// Devuelve { user } o { error: 'NOT_FOUND' | 'PHONE_TAKEN' }.
async function setWhatsappUnlocked(userId, { phone, token }) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return { error: 'NOT_FOUND' };
  if (phone) {
    if (phoneOwner(users, phone, id)) return { error: 'PHONE_TAKEN' };
    users[id].whatsappPhone = phone;
    users[id].whatsappLinkedAt = new Date().toISOString();
  } else {
    delete users[id].whatsappPhone;
    delete users[id].whatsappLinkedAt;
  }
  if (token) {
    users[id].webhookTokenEnc = encryptSecret(token);
    users[id].webhookTokenHint = token.slice(-4);
    users[id].webhookTokenCreatedAt = new Date().toISOString();
  }
  users[id].updatedAt = new Date().toISOString();
  await saveUsers(users);
  return { user: { userId: id, ...users[id] } };
}
export const setWhatsapp = (...args) => withUsersLock(() => setWhatsappUnlocked(...args));

async function generateClientTokenUnlocked(userId, token = newClientToken()) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return null;
  users[id].webhookTokenEnc = encryptSecret(token);
  users[id].webhookTokenHint = token.slice(-4);
  users[id].webhookTokenCreatedAt = new Date().toISOString();
  await saveUsers(users);
  return { token, hint: users[id].webhookTokenHint, createdAt: users[id].webhookTokenCreatedAt };
}

async function getClientToken(userId) {
  const users = await getUsers();
  const stored = users[sanitizeUserId(userId)]?.webhookTokenEnc;
  return stored ? decryptSecret(stored) : null;
}

const SIGNATURE_MAX_SKEW_SECONDS = 300;

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

// Comprueba la firma de una petición de n8n para ESTE carrusel.
//   X-Webhook-Timestamp: segundos (Unix)
//   X-Webhook-Secret:    HMAC-SHA256 hex de "<timestamp>.<cuerpo crudo>" con el token del cliente
// Rechaza marcas de tiempo viejas y firmas ya usadas (no se puede repetir una petición).
// Un cliente que todavía no tiene token acepta la firma global antigua (WEBHOOK_SECRET
// sobre el cuerpo), salvo que ALLOW_GLOBAL_WEBHOOK_SECRET=0.
// Devuelve { ok: true } o { ok: false, error }.
export async function verifyClientSignature(userId, rawBody, request) {
  const hasher = await clientSignatureHasher(userId, request);
  if (hasher.error) return { ok: false, error: hasher.error };
  hasher.update(Buffer.from(rawBody, 'utf8'));
  return hasher.verify();
}

// La misma comprobación para un cuerpo que llega por trozos (no hace falta tenerlo entero
// en memoria): `update(trozo)` con cada parte del cuerpo crudo y al final `verify()`.
// Devuelve { error } si la petición ya se puede rechazar por sus cabeceras.
export async function clientSignatureHasher(userId, request) {
  const signature = request.headers.get('x-webhook-secret');
  if (!signature) return { error: 'Missing signature' };

  const token = await getClientToken(userId);
  let hmac;
  if (!token) {
    if (process.env.ALLOW_GLOBAL_WEBHOOK_SECRET === '0') return { error: 'Invalid signature' };
    if (!process.env.WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET not configured');
    hmac = createHmac('sha256', process.env.WEBHOOK_SECRET);
  } else {
    const timestamp = request.headers.get('x-webhook-timestamp') || '';
    if (!/^\d{9,11}$/.test(timestamp)) return { error: 'Missing timestamp' };
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_MAX_SKEW_SECONDS) {
      return { error: 'Expired timestamp' };
    }
    hmac = createHmac('sha256', token).update(`${timestamp}.`, 'utf8');
  }

  return {
    update: (chunk) => { hmac.update(chunk); },
    async verify() {
      const expected = hmac.digest('hex');
      if (!safeEqualHex(signature, expected)) return { ok: false, error: 'Invalid signature' };
      if (!token) return { ok: true };
      const fresh = await setOnce(`carousel:nonce:${userId}:${expected}`, SIGNATURE_MAX_SKEW_SECONDS * 2);
      return fresh ? { ok: true } : { ok: false, error: 'Signature already used' };
    },
  };
}

// ==================== Espacio de almacenamiento por usuario ====================
// Cada archivo que hospedamos se anota en un hash por usuario (nombre -> bytes).
// Lo usado es la suma; el límite sale de `storageLimitMb` del usuario o del default.

const MB = 1024 * 1024;
export const MAX_STORAGE_MB = 1024 * 1024; // 1 TB: tope de cordura para el campo
const defaultStorageMb = () => {
  const n = parseInt(process.env.DEFAULT_STORAGE_MB || '500', 10);
  return n > 0 ? n : 500;
};

// Orden: límite propio del usuario -> el de su plan (null = sin tope) -> el del servidor.
export function storageLimitBytes(user, plans = null) {
  const own = Number(user?.storageLimitMb);
  if (Number.isInteger(own) && own > 0) return own * MB;
  const fromPlan = planState(user, plans).storageLimitMb;
  if (fromPlan === null) return MAX_STORAGE_MB * MB;
  if (Number.isInteger(fromPlan) && fromPlan > 0) return fromPlan * MB;
  return defaultStorageMb() * MB;
}

export async function getStorageUsage(userId, users = null) {
  const id = sanitizeUserId(userId);
  const all = users || (await getUsers());
  const files = await hashGetAll(filesKey(id));
  const usedBytes = Object.values(files).reduce((sum, n) => sum + n, 0);
  const limitBytes = storageLimitBytes(all[id], await getPlans());
  return {
    usedBytes,
    limitBytes,
    freeBytes: Math.max(0, limitBytes - usedBytes),
    fileCount: Object.keys(files).length,
    storageLimitMb: all[id]?.storageLimitMb ?? null,
    defaultLimitMb: defaultStorageMb(),
  };
}

const formatMb = (bytes) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;

// Lanza un error con code 'QUOTA_EXCEEDED' si un archivo de `bytes` no cabe en el
// espacio del usuario. Devuelve el uso actual cuando sí cabe.
export async function assertFits(userId, bytes) {
  const usage = await getStorageUsage(sanitizeUserId(userId));
  if (usage.usedBytes + bytes > usage.limitBytes) {
    const err = new Error(
      `Espacio lleno: usas ${formatMb(usage.usedBytes)} de ${formatMb(usage.limitBytes)} y este archivo pesa ${formatMb(bytes)}. Borra imágenes o pide más espacio.`
    );
    err.code = 'QUOTA_EXCEEDED';
    err.details = { code: 'QUOTA_EXCEEDED', usedBytes: usage.usedBytes, limitBytes: usage.limitBytes, fileBytes: bytes };
    throw err;
  }
  return usage;
}

// Guarda un archivo del usuario (si cabe en su espacio) y lo anota en su cuenta.
// Lanza un error con code 'QUOTA_EXCEEDED' cuando no cabe.
export async function saveUserFile(userId, buffer, contentType, ext, request) {
  const id = sanitizeUserId(userId);
  await assertFits(id, buffer.length);
  const fileName = `${id}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const stored = await putImage(fileName, buffer, contentType, request);
  await hashSet(filesKey(id), fileName, buffer.length);
  return { ...stored, bytes: buffer.length };
}

// Como saveUserFile, pero el contenido ya está en un archivo temporal: se mueve, no se
// carga en memoria. Lanza QUOTA_EXCEEDED igual que saveUserFile.
export async function saveUserFileFromPath(userId, path, bytes, contentType, ext) {
  const id = sanitizeUserId(userId);
  await assertFits(id, bytes);
  const fileName = `${id}-${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const stored = await putImageFromFile(fileName, path, contentType);
  await hashSet(filesKey(id), fileName, bytes);
  return { ...stored, bytes };
}

// Revisa por sus primeros bytes que el temporal sea una imagen, la optimiza y la guarda.
// Devuelve { url, pathname, contentType, bytes }, o null si no es una imagen válida.
export async function saveImageFromTemp(userId, tmpPath) {
  const head = Buffer.alloc(16);
  const fh = await open(tmpPath, 'r');
  let read = 0;
  try {
    read = (await fh.read(head, 0, head.length, 0)).bytesRead;
  } finally {
    await fh.close();
  }
  const kind = sniffImageType(head.subarray(0, read));
  if (!kind) return null;
  const opt = await optimizeImageFile(tmpPath, kind);
  return saveUserFileFromPath(userId, opt.path, opt.bytes, opt.type, opt.ext);
}

// Respuesta 413 para un error de saveUserFile; null si el error es otro.
export function quotaErrorResponse(err) {
  return err && err.code === 'QUOTA_EXCEEDED' ? errorResponse(err.message, 413, err.details) : null;
}

// Borra el archivo de una imagen SOLO si pertenece a este usuario.
// Antes cualquiera podía añadir por URL la imagen de otro carrusel y, al quitarla,
// borrar el archivo ajeno.
export async function removeUserFile(userId, image) {
  const name = ownFileName(image);
  if (!name) return false; // URL externa: no es nuestra
  const id = sanitizeUserId(userId);
  const files = await hashGetAll(filesKey(id));
  if (name in files) {
    await deleteImageFile(image);
    await hashDel(filesKey(id), name);
    return true;
  }
  // Sin anotar: o es de otro usuario (no se toca) o es un archivo anterior al registro.
  // Esos últimos se siguen borrando como antes hasta que se corra migrate-storage.mjs.
  if (/^USER\d+-/.test(name)) return false;
  if ((await getConfig()).storageMigrated) return false;
  return deleteImageFile(image);
}

// Anota un archivo ya existente (lo usa scripts/migrate-storage.mjs).
export async function registerUserFile(userId, fileName, bytes) {
  return hashSet(filesKey(sanitizeUserId(userId)), fileName, bytes);
}

// ==================== Consumo de generación (lo reporta n8n) ====================
// Un hash por usuario y mes con contadores. No se consulta a ningún proveedor.

export const USAGE_KINDS = ['image', 'video', 'text', 'message'];
export const currentMonth = (date = new Date()) => date.toISOString().slice(0, 7); // UTC
export const isValidMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

const toCount = (v, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

// Acepta { input, output, total } o los nombres que usan los proveedores.
export function normalizeTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return { input: 0, output: 0, total: 0 };
  const input = toCount(tokens.input ?? tokens.input_tokens ?? tokens.prompt_tokens, 1e9);
  const output = toCount(tokens.output ?? tokens.output_tokens ?? tokens.completion_tokens, 1e9);
  const total = toCount(tokens.total ?? tokens.total_tokens, 1e9) || input + output;
  return { input, output, total };
}

// Suma un evento al mes en curso. `eventId` evita contar dos veces el mismo evento.
// Devuelve { duplicate } y lo que se sumó.
export async function recordUsage(userId, { eventId, kind, count, tokens, seconds }) {
  const id = sanitizeUserId(userId);
  if (eventId) {
    const first = await setOnce(`carousel:usageevt:${id}:${sha256Hex(eventId).slice(0, 32)}`, 3 * 86400);
    if (!first) return { duplicate: true };
  }
  const key = usageKey(id, currentMonth());
  const n = toCount(count ?? 1, 1000) || 1;
  const t = normalizeTokens(tokens);
  const secs = toCount(seconds, 36000);

  if (kind === 'image') {
    await hashIncrBy(key, 'images', n);
    if (t.total === 0) await hashIncrBy(key, 'imagesNoTokens', n);
  } else if (kind === 'video') {
    await hashIncrBy(key, 'videos', n);
    if (secs) await hashIncrBy(key, 'videoSeconds', secs);
  } else if (kind === 'message') {
    // Mensajes que el bot envió por WhatsApp a este cliente.
    await hashIncrBy(key, 'whatsappMessages', n);
  }
  if (t.input) await hashIncrBy(key, 'tokensIn', t.input);
  if (t.output) await hashIncrBy(key, 'tokensOut', t.output);
  if (t.total) await hashIncrBy(key, 'tokensTotal', t.total);
  return { duplicate: false, kind, count: n, tokens: t, seconds: secs };
}

// ==================== Tope mensual de imágenes generadas ====================
// Global en carousel:config.monthlyImageLimit (null = sin tope; sin definir = MONTHLY_IMAGE_LIMIT
// o 50) y, si existe, el propio del usuario (`monthlyImageLimit`), que manda sobre el global.
// Se cuenta con `images` del consumo del mes, el mismo que reporta n8n.
export const MAX_MONTHLY_IMAGES = 100000;
const DEFAULT_MONTHLY_IMAGES = 50;

export function isValidImageLimit(v) {
  return v === null || (Number.isInteger(v) && v >= 0 && v <= MAX_MONTHLY_IMAGES);
}

export function globalImageLimit(cfg) {
  if (cfg && 'monthlyImageLimit' in cfg) return cfg.monthlyImageLimit ?? null;
  const fromEnv = parseInt(process.env.MONTHLY_IMAGE_LIMIT ?? '', 10);
  return Number.isInteger(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_MONTHLY_IMAGES;
}

// { used, limit, remaining, own } — limit y remaining son null si no hay tope.
export async function getGenerationQuota(userId, users = null) {
  const id = sanitizeUserId(userId);
  const all = users || (await getUsers());
  const own = all[id]?.monthlyImageLimit;
  // Orden: tope propio -> el del plan (null = sin tope) -> el global.
  const cfg = await getConfig();
  const fromPlan = planState(all[id], resolvePlans(cfg.plans)).monthlyImageLimit;
  const limit = Number.isInteger(own) ? own : fromPlan !== undefined ? fromPlan : globalImageLimit(cfg);
  const used = (await hashGetAll(usageKey(id, currentMonth()))).images || 0;
  return {
    month: currentMonth(),
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    own: Number.isInteger(own) ? own : null,
  };
}

// ==================== Planes (ver _plans.js) ====================

export async function getPlans() {
  return resolvePlans((await getConfig()).plans);
}

export async function getPlanState(userId, users = null) {
  const all = users || (await getUsers());
  return planState(all[sanitizeUserId(userId)], await getPlans());
}

// 402 si la prueba o el plan del usuario venció; null si puede seguir.
export async function planBlockedResponse(userId, users = null) {
  const state = await getPlanState(userId, users);
  if (!state.blocked) return null;
  return errorResponse('Tu prueba o plan terminó. Contáctanos para activarlo.', 402, { code: 'PLAN_EXPIRED', plan: state });
}

// Único punto que cambia el plan de un usuario. Lo usa el super-admin (provider 'manual')
// y lo usará el webhook de Stripe (provider 'stripe', ref = id de la suscripción).
// `until`: fecha ISO de fin o null (sin fin). Una fecha pasada deja la cuenta vencida.
async function setPlanUnlocked(userId, { planId, until = null, provider = 'manual', ref = null }) {
  if (!PLAN_IDS.includes(planId)) {
    const err = new Error(`Plan inválido. Usa: ${PLAN_IDS.join(', ')}`);
    err.code = 'INVALID_PLAN';
    throw err;
  }
  if (!PLAN_PROVIDERS.includes(provider)) throw Object.assign(new Error('Proveedor inválido'), { code: 'INVALID_PLAN' });
  if (until !== null && !Number.isFinite(Date.parse(until))) {
    throw Object.assign(new Error('Fecha de fin inválida'), { code: 'INVALID_PLAN' });
  }
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return null;
  const now = new Date().toISOString();
  users[id].plan = planId;
  users[id].planStatus = 'active';
  users[id].planEndsAt = until === null ? null : new Date(until).toISOString();
  users[id].billing = { provider, ref: ref ? String(ref).slice(0, 200) : null, updatedAt: now };
  users[id].updatedAt = now;
  await saveUsers(users);
  return { userId: id, ...users[id] };
}

export const setPlan = locked(setPlanUnlocked);

// ==================== Pantallas (dispositivos) ====================
// Cada TV/navegador que abre el carrusel manda su id (UUID en su localStorage). Se guarda
// en el hash carousel:USERx:devices (id -> último visto, ms). Cuenta como activa si se vio
// en los últimos 30 días; las más viejas se borran solas al llegar una nueva.

export const DEVICE_ACTIVE_MS = 30 * 86400000;
const DEVICE_TOUCH_MS = 5 * 60000; // no reescribir "último visto" más seguido que esto
export const isValidDeviceId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function listDevices(userId, now = Date.now()) {
  const all = await hashGetAll(devicesKey(sanitizeUserId(userId)));
  return Object.entries(all)
    .map(([id, lastSeen]) => ({ id, lastSeen: new Date(lastSeen).toISOString(), active: now - lastSeen < DEVICE_ACTIVE_MS }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

// Anota la pantalla. `limit` null = sin tope. Devuelve { allowed, count, limit, revoked? }.
// Una pantalla quitada desde el panel recibe `revoked`: la TV ofrece conectarse con un id
// nuevo, que cuenta como pantalla nueva. Sin esto, una TV encendida volvería a tomar su
// lugar en la siguiente consulta y no se podría poner otra en su lugar.
export async function touchDevice(userId, deviceId, limit, now = Date.now()) {
  const uid = sanitizeUserId(userId);
  const key = devicesKey(uid);
  const id = deviceId.toLowerCase();
  const revoked = await hashGetAll(revokedDevicesKey(uid));
  if (id in revoked) {
    if (now - revoked[id] < DEVICE_ACTIVE_MS) return { allowed: false, revoked: true, limit };
    await hashDel(revokedDevicesKey(uid), id);
  }
  const all = await hashGetAll(key);
  if (id in all) {
    if (now - all[id] > DEVICE_TOUCH_MS) await hashSet(key, id, now);
    return { allowed: true, count: Object.keys(all).length, limit };
  }
  const stale = Object.keys(all).filter((d) => now - all[d] >= DEVICE_ACTIVE_MS);
  for (const d of stale) await hashDel(key, d);
  const count = Object.keys(all).length - stale.length;
  if (limit !== null && count >= limit) return { allowed: false, count, limit };
  await hashSet(key, id, now);
  return { allowed: true, count: count + 1, limit };
}

// Quita una pantalla (o todas con deviceId null) y la deja desconectada. Devuelve cuántas.
export async function removeDevice(userId, deviceId, now = Date.now()) {
  const uid = sanitizeUserId(userId);
  const key = devicesKey(uid);
  const all = await hashGetAll(key);
  const ids = deviceId === null ? Object.keys(all) : [String(deviceId).toLowerCase()].filter((id) => id in all);
  const revokedKey = revokedDevicesKey(uid);
  // Las desconexiones de más de 30 días ya no hacen falta: esa pantalla dejaría de contar igual.
  const revoked = await hashGetAll(revokedKey);
  for (const [id, at] of Object.entries(revoked)) if (now - at >= DEVICE_ACTIVE_MS) await hashDel(revokedKey, id);
  for (const id of ids) {
    await hashSet(revokedKey, id, now);
    await hashDel(key, id);
  }
  return ids.length;
}

export async function getUsageSummary(userId, month = currentMonth()) {
  const data = await hashGetAll(usageKey(sanitizeUserId(userId), month));
  const imagePriceUsd = imagePriceFrom(await getConfig());
  const imagesNoTokens = data.imagesNoTokens || 0;
  return {
    month,
    images: data.images || 0,
    imagesNoTokens,
    videos: data.videos || 0,
    videoSeconds: data.videoSeconds || 0,
    whatsappMessages: data.whatsappMessages || 0,
    tokensIn: data.tokensIn || 0,
    tokensOut: data.tokensOut || 0,
    tokensTotal: data.tokensTotal || 0,
    imagePriceUsd,
    // Aproximación: solo las imágenes de las que no se conocen los tokens.
    estimatedCostUsd: Math.round(imagesNoTokens * imagePriceUsd * 100) / 100,
  };
}

export async function verifyUserPassword(userId, password) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return false;

  const { verify } = await import('@node-rs/argon2');
  return verify(users[id].passwordHash, password);
}

// Formatos de póster que el bot puede generar (coinciden con los tamaños nativos de Qwen/Wan).
export const FORMATS = ['horizontal', 'vertical', 'cuadrado', 'horizontal43', 'vertical34'];
export const normalizeFormat = (f) => (FORMATS.includes(f) ? f : 'horizontal');

// Resolución del póster = lado corto en píxeles. Junto con el formato da el tamaño exacto
// que n8n pide al generador (admin.js y n8n/formato.js llevan la misma tabla).
export const RESOLUTIONS = ['hd', 'fullhd', '2k', '4k'];
const RESOLUTION_SHORT_SIDE = { hd: 720, fullhd: 1080, '2k': 1440, '4k': 2160 };
const FORMAT_RATIO = { horizontal: [16, 9], vertical: [9, 16], cuadrado: [1, 1], horizontal43: [4, 3], vertical34: [3, 4] };
export const normalizeResolution = (r) => (RESOLUTIONS.includes(r) ? r : 'fullhd');
export function posterSize(format, resolution) {
  const [rw, rh] = FORMAT_RATIO[normalizeFormat(format)];
  const unit = RESOLUTION_SHORT_SIDE[normalizeResolution(resolution)] / Math.min(rw, rh);
  return { width: Math.round(rw * unit), height: Math.round(rh * unit) };
}

// Duración de cada diapositiva, en segundos. Cada imagen puede tener la suya
// (`duration`); si no, se usa la del carrusel (`slideDuration`).
export const MIN_DURATION = 2;
export const MAX_DURATION = 3600;
export const DEFAULT_SLIDE_DURATION = 8;
export const isValidDuration = (d) => Number.isInteger(d) && d >= MIN_DURATION && d <= MAX_DURATION;
// Entero en rango -> número; cualquier otra cosa (vacío, null) -> null (usa la del carrusel).
export const normalizeDuration = (d) => (isValidDuration(d) ? d : null);

export async function getGenerationSettings(userId) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return null;
  const u = users[id];
  return {
    userId: id,
    googleDriveFolder: u.googleDriveFolder ?? null,
    colorPalette: u.colorPalette ?? null,
    n8nGenerationWebhook: u.n8nGenerationWebhook ?? null,
    defaultOrientation: normalizeFormat(u.defaultOrientation),
    posterResolution: normalizeResolution(u.posterResolution),
    slideDuration: normalizeDuration(u.slideDuration) ?? DEFAULT_SLIDE_DURATION,
  };
}

async function updateUserSettingsUnlocked(userId, { googleDriveFolder, colorPalette, n8nGenerationWebhook, defaultOrientation, posterResolution, slideDuration }) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return null;
  const errors = validateGenerationSettings({ googleDriveFolder, colorPalette, n8nGenerationWebhook, defaultOrientation, posterResolution, slideDuration });
  if (errors.length) {
    const e = new Error(errors[0]);
    e.code = 'VALIDATION_ERROR';
    e.details = errors;
    throw e;
  }
  if (defaultOrientation !== undefined) users[id].defaultOrientation = normalizeFormat(defaultOrientation);
  if (posterResolution !== undefined) users[id].posterResolution = normalizeResolution(posterResolution);
  if (googleDriveFolder !== undefined) users[id].googleDriveFolder = googleDriveFolder || null;
  if (colorPalette !== undefined) users[id].colorPalette = colorPalette || null;
  if (n8nGenerationWebhook !== undefined) users[id].n8nGenerationWebhook = n8nGenerationWebhook || null;
  if (slideDuration !== undefined) users[id].slideDuration = normalizeDuration(slideDuration);
  users[id].updatedAt = new Date().toISOString();
  await saveUsers(users);
  return getGenerationSettings(id);
}

export function setAuthCookie(response, token, options = {}, cookieName = 'auth_token') {
  const attrs = {
    HttpOnly: true,
    Secure: true,
    SameSite: 'Strict',
    Path: '/',
    'Max-Age': 3600, // 1 hour
    ...options,
  };

  const segments = [`${cookieName}=${token}`];
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    segments.push(value === true ? key : `${key}=${value}`);
  }

  response.headers.set('Set-Cookie', segments.join('; '));
}

export function clearAuthCookie(response, cookieName = 'auth_token') {
  response.headers.set(
    'Set-Cookie',
    `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
  );
}

// ==================== Webhook HMAC Verification ====================

export function verifyWebhookSignature(payload, signature) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('WEBHOOK_SECRET not configured');
  }
  
  const expected = createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');
  
  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  
  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }
  
  return timingSafeEqual(sigBuffer, expectedBuffer);
}

// ==================== Image Operations (per user) ====================

export async function getImages(userId) {
  const images = await getJson(imagesKey(userId));
  // Nota: devolver siempre un array nuevo. DEFAULT_IMAGES no debe reutilizarse
  // porque addImage muta el array devuelto y contaminaría futuras lecturas.
  return Array.isArray(images) ? images : [];
}

export async function saveImages(userId, images) {
  await setJson(imagesKey(userId), images);
}

const VIEWS = ['auto', 'horizontal', 'vertical', 'rotate'];

// ==================== Suspender y programar ====================
// Cada imagen puede estar suspendida (`suspended`) o programada (`schedule`): días de la semana
// (0 = domingo … 6 = sábado) y/o un rango de fechas AAAA-MM-DD, ambos extremos incluidos.
// El día y la fecha se cuentan en la zona del negocio, no en UTC.
const DEFAULT_TIMEZONE = 'America/Monterrey';
function validTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
export const CAROUSEL_TIMEZONE = (() => {
  const tz = process.env.CAROUSEL_TIMEZONE;
  if (!tz) return DEFAULT_TIMEZONE;
  if (validTimeZone(tz)) return tz;
  console.warn(`AVISO: CAROUSEL_TIMEZONE="${tz}" no es una zona horaria válida; se usa ${DEFAULT_TIMEZONE}.`);
  return DEFAULT_TIMEZONE;
})();

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function localDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { weekday: WEEKDAYS.indexOf(get('weekday')), ymd: `${get('year')}-${get('month')}-${get('day')}` };
}

// ¿Se muestra esta imagen en ese momento? La usa el carrusel público.
export function isVisibleAt(item, date = new Date(), timeZone = CAROUSEL_TIMEZONE) {
  if (!item || item.suspended === true) return false;
  const s = item.schedule;
  if (!s || typeof s !== 'object') return true;
  const { weekday, ymd } = localDay(date, timeZone);
  if (Array.isArray(s.days) && s.days.length > 0 && !s.days.includes(weekday)) return false;
  if (s.from && ymd < s.from) return false;
  if (s.to && ymd > s.to) return false;
  return true;
}

const isRealDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

// Valida y deja en forma canónica una programación. Devuelve { value } o { error }.
// `null` (o una programación sin días ni fechas) significa «siempre».
export function normalizeSchedule(schedule) {
  if (schedule === null) return { value: null };
  if (typeof schedule !== 'object' || Array.isArray(schedule)) return { error: 'schedule debe ser un objeto { days, from, to } o null' };
  let days = null;
  if (schedule.days != null) {
    if (!Array.isArray(schedule.days) || schedule.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return { error: 'schedule.days debe ser una lista de días de 0 (domingo) a 6 (sábado)' };
    }
    if (new Set(schedule.days).size !== schedule.days.length) return { error: 'schedule.days no puede repetir un día' };
    days = schedule.days.length ? schedule.days.slice().sort((a, b) => a - b) : null;
  }
  const dates = {};
  for (const key of ['from', 'to']) {
    const v = schedule[key];
    if (v == null || v === '') { dates[key] = null; continue; }
    if (!isRealDate(v)) return { error: `schedule.${key} debe ser una fecha AAAA-MM-DD que exista` };
    dates[key] = v;
  }
  if (dates.from && dates.to && dates.from > dates.to) return { error: 'schedule.from no puede ser posterior a schedule.to' };
  if (!days && !dates.from && !dates.to) return { value: null };
  return { value: { days, from: dates.from, to: dates.to } };
}

// Errores de los campos de visibilidad de una imagen (solo los que vengan).
function visibilityErrors(data) {
  const errors = [];
  if (data.blur !== undefined && typeof data.blur !== 'boolean') errors.push('blur debe ser true o false');
  if (data.suspended !== undefined && typeof data.suspended !== 'boolean') errors.push('suspended debe ser true o false');
  if (data.schedule !== undefined) {
    const { error } = normalizeSchedule(data.schedule);
    if (error) errors.push(error);
  }
  return errors;
}

export async function addImage(userId, imageData) {
  const images = await getImages(userId);
  const newImage = {
    id: randomUUID(),
    url: imageData.url,
    alt: imageData.alt || '',
    view: VIEWS.includes(imageData.view) ? imageData.view : 'auto',
    duration: normalizeDuration(imageData.duration),
    blur: imageData.blur === true,
    suspended: imageData.suspended === true,
    schedule: imageData.schedule == null ? null : (normalizeSchedule(imageData.schedule).value ?? null),
    order: imageData.order ?? (images.length > 0 ? Math.max(...images.map(i => i.order)) + 1 : 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  images.push(newImage);
  await saveImages(userId, images);
  return newImage;
}

export async function updateImage(userId, id, updates) {
  const images = await getImages(userId);
  const index = images.findIndex(img => img.id === id);
  if (index === -1) return null;

  // Solo campos editables (evita que el body agregue/pise propiedades arbitrarias).
  const allowed = {};
  for (const k of ['url', 'alt', 'order', 'view', 'duration', 'blur', 'suspended']) {
    if (updates[k] !== undefined) allowed[k] = updates[k];
  }
  if (updates.schedule !== undefined) allowed.schedule = normalizeSchedule(updates.schedule).value ?? null;
  images[index] = {
    ...images[index],
    ...allowed,
    updatedAt: new Date().toISOString(),
  };
  
  await saveImages(userId, images);
  return images[index];
}

export async function deleteImage(userId, id) {
  const images = await getImages(userId);
  const target = images.find(img => img.id === id);
  const filtered = images.filter(img => img.id !== id);
  if (filtered.length === images.length) return false;

  await saveImages(userId, filtered);
  // Borrar también el archivo físico (si lo hospedamos nosotros y es de este usuario).
  if (target && target.url) { await removeUserFile(userId, target).catch(() => {}); }
  return true;
}

export async function reorderImages(userId, imageOrders) {
  const images = await getImages(userId);
  const orderMap = new Map(imageOrders.map(({ id, order }) => [id, order]));
  
  images.forEach(img => {
    if (orderMap.has(img.id)) {
      img.order = orderMap.get(img.id);
      img.updatedAt = new Date().toISOString();
    }
  });
  
  images.sort((a, b) => a.order - b.order);
  await saveImages(userId, images);
  return images;
}

// Agrega imágenes al final del carrusel sin borrar las existentes.
// Omite las URLs que ya están presentes. Devuelve { added, skipped, images }.
export async function appendImages(userId, newImages) {
  const images = await getImages(userId);
  const existingUrls = new Set(images.map((i) => i.url));
  let maxOrder = images.length > 0
    ? Math.max(...images.map((i) => (typeof i.order === 'number' ? i.order : 0)))
    : -1;

  const added = [];
  let skipped = 0;

  for (const img of newImages) {
    if (existingUrls.has(img.url)) {
      skipped++;
      continue;
    }
    maxOrder += 1;
    const newImage = {
      id: randomUUID(),
      url: img.url,
      alt: img.alt || '',
      view: VIEWS.includes(img.view) ? img.view : 'auto',
    duration: normalizeDuration(img.duration),
      order: maxOrder,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    images.push(newImage);
    added.push(newImage);
    existingUrls.add(img.url);
  }

  if (added.length > 0) await saveImages(userId, images);
  return { added, skipped, images };
}

export async function replaceAllImages(userId, newImages) {
  const prev = await getImages(userId);
  // Una imagen que ya estaba (mismo id o misma URL) conserva si estaba suspendida,
  // programada o con difuminado: reemplazar la lista no la vuelve a mostrar.
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const prevByUrl = new Map(prev.map((p) => [p.url, p]));
  const kept = (img) => {
    const old = prevById.get(img.id) || prevByUrl.get(img.url);
    return old ? { blur: old.blur === true, suspended: old.suspended === true, schedule: old.schedule ?? null } : {};
  };
  const images = newImages.map((img, index) => ({
    id: img.id || randomUUID(),
    url: img.url,
    alt: img.alt || '',
    view: VIEWS.includes(img.view) ? img.view : 'auto',
    duration: normalizeDuration(img.duration),
    ...kept(img),
    order: img.order ?? index,
    createdAt: img.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  images.sort((a, b) => a.order - b.order);
  await saveImages(userId, images);

  // Borrar los archivos de las imágenes que ya no están en el carrusel.
  const keepUrls = new Set(images.map((i) => i.url));
  for (const old of prev) {
    if (old && old.url && !keepUrls.has(old.url)) {
      await removeUserFile(userId, old).catch(() => {});
    }
  }
  return images;
}

// ==================== Validation ====================

export function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const MAX_ALT = 300;
const DURATION_ERROR = `La duración debe ser un número entero entre ${MIN_DURATION} y ${MAX_DURATION} segundos`;

export function validateImageUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  // Nada de espacios, comillas, <, > ni backticks: la URL acaba en atributos HTML.
  if (/[\s<>"'`\\]/.test(url)) return false;
  // Rutas internas servidas por el propio dominio (imágenes re-hospedadas en disco).
  if (url.startsWith('/uploads/')) return /^\/uploads\/[A-Za-z0-9._-]+$/.test(url);
  // Absolutas: solo https (http daría contenido mixto y es inseguro).
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateImageData(data) {
  const errors = [];

  if (!data.url || typeof data.url !== 'string') {
    errors.push('URL is required');
  } else if (!validateImageUrl(data.url)) {
    errors.push('URL inválida (usa https:// o una imagen subida)');
  }

  if (data.alt && typeof data.alt !== 'string') {
    errors.push('Alt text must be a string');
  } else if (typeof data.alt === 'string' && data.alt.length > MAX_ALT) {
    errors.push(`Alt text max ${MAX_ALT} characters`);
  }
  
  if (data.order !== undefined && (typeof data.order !== 'number' || !Number.isInteger(data.order))) {
    errors.push('Order must be an integer');
  }

  if (data.view !== undefined && !VIEWS.includes(data.view)) {
    errors.push("view must be 'auto', 'horizontal', 'vertical' or 'rotate'");
  }

  if (data.duration != null && !isValidDuration(data.duration)) {
    errors.push(DURATION_ERROR);
  }

  errors.push(...visibilityErrors(data));
  return errors;
}

// Partial validation for PATCH: only validates the fields that are present.
export function validateImagePatch(data) {
  const errors = [];

  if (data.url !== undefined && (typeof data.url !== 'string' || !validateImageUrl(data.url))) {
    errors.push('URL inválida (usa https:// o una imagen subida)');
  }

  if (data.alt !== undefined && typeof data.alt !== 'string') {
    errors.push('Alt text must be a string');
  } else if (typeof data.alt === 'string' && data.alt.length > MAX_ALT) {
    errors.push(`Alt text max ${MAX_ALT} characters`);
  }

  if (data.order !== undefined && (typeof data.order !== 'number' || !Number.isInteger(data.order))) {
    errors.push('Order must be an integer');
  }

  if (data.view !== undefined && !VIEWS.includes(data.view)) {
    errors.push("view must be 'auto', 'horizontal', 'vertical' or 'rotate'");
  }

  if (data.duration != null && !isValidDuration(data.duration)) {
    errors.push(DURATION_ERROR);
  }

  errors.push(...visibilityErrors(data));
  return errors;
}

export function validateHexColor(color) {
  if (typeof color !== 'string') return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color.trim());
}

export function validateGenerationSettings({ googleDriveFolder, colorPalette, n8nGenerationWebhook, defaultOrientation, posterResolution, slideDuration }) {
  const errors = [];
  if (slideDuration != null && !isValidDuration(slideDuration)) {
    errors.push(DURATION_ERROR);
  }
  if (posterResolution != null && !RESOLUTIONS.includes(String(posterResolution))) {
    errors.push(`posterResolution must be one of: ${RESOLUTIONS.join(', ')}`);
  }
  if (defaultOrientation != null && !FORMATS.includes(String(defaultOrientation))) {
    errors.push(`defaultOrientation must be one of: ${FORMATS.join(', ')}`);
  }
  if (googleDriveFolder != null && !isHttpUrl(String(googleDriveFolder))) {
    errors.push('googleDriveFolder must be a valid http/https URL');
  }
  if (colorPalette != null) {
    if (!Array.isArray(colorPalette)) {
      errors.push('colorPalette must be an array');
    } else if (colorPalette.length > 5) {
      errors.push('colorPalette max 5 colors');
    } else {
      colorPalette.forEach((c, i) => {
        if (!validateHexColor(c)) errors.push(`colorPalette[${i}] invalid hex color`);
      });
    }
  }
  if (n8nGenerationWebhook != null && !isHttpUrl(String(n8nGenerationWebhook))) {
    errors.push('n8nGenerationWebhook must be a valid http/https URL');
  }
  return errors;
}

// ==================== Rate Limiting (simple in-memory) ====================

const rateLimitStore = new Map();
let lastSweep = Date.now();

export function checkRateLimit(identifier, limit = 60, windowMs = 60000) {
  const now = Date.now();

  // Opportunistic cleanup (serverless-safe: no background timers)
  if (now - lastSweep > 120000) {
    lastSweep = now;
    for (const [key, record] of rateLimitStore.entries()) {
      if (now - record.windowStart > 120000) rateLimitStore.delete(key);
    }
  }

  const record = rateLimitStore.get(identifier);
  
  if (!record || now - record.windowStart > windowMs) {
    rateLimitStore.set(identifier, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit - 1 };
  }
  
  if (record.count >= limit) {
    return { 
      allowed: false, 
      remaining: 0, 
      resetAt: record.windowStart + windowMs 
    };
  }
  
  record.count++;
  return { allowed: true, remaining: limit - record.count };
}

// ==================== Response Helpers ====================

export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export function errorResponse(message, status = 400, details = null) {
  return jsonResponse(
    { error: message, details },
    status
  );
}

export function successResponse(data, message = 'OK') {
  return jsonResponse({ success: true, message, data });
}
