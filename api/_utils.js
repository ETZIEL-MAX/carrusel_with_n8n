import { SignJWT, jwtVerify } from 'jose';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { getJson, setJson, delKey } from './_store.js';

const DEFAULT_IMAGES = [];

function imagesKey(userId) {
  return `carousel:${userId}:images`;
}

function usersKey() {
  return 'carousel:users';
}

function sanitizeUserId(id) {
  return String(id).replace(/[^a-zA-Z0-9_.-]/g, '_').toUpperCase();
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
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

export function getTokenFromCookie(request, cookieName = 'auth_token') {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
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
    return url.searchParams.get('userId') ? sanitizeUserId(url.searchParams.get('userId')) : null;
  }
  if (isUser(payload)) {
    return payload.userId;
  }
  return null;
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

export async function createUser({ name, email, password }) {
  const cleanName = String(name || '').trim();
  if (!cleanName || cleanName.length > 120) {
    throw new Error('Invalid name');
  }
  if (!validateEmail(email)) {
    throw new Error('Invalid email');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }
  const cleanEmail = normalizeEmail(email);
  const existing = await findUserByEmail(cleanEmail);
  if (existing) {
    const err = new Error('Email already in use');
    err.code = 'EMAIL_TAKEN';
    throw err;
  }

  const users = await getUsers();
  const existingIds = Object.keys(users).map(k => parseInt(k.replace('USER', ''), 10)).filter(n => !isNaN(n));
  const nextNum = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
  const userId = `USER${nextNum}`;

  const { hash } = await import('@node-rs/argon2');
  const passwordHash = await hash(password);

  users[userId] = {
    name: cleanName,
    email: cleanEmail,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await saveUsers(users);
  return { userId, name: cleanName, email: cleanEmail, password };
}

export async function updateUser(userId, { name, email }) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return null;

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
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return false;
  delete users[id];
  await saveUsers(users);
  await delKey(imagesKey(id));
  return true;
}

export async function verifyUserLogin(email, password) {
  const found = await findUserByEmail(email);
  if (!found) return null;
  const { verify } = await import('@node-rs/argon2');
  const valid = await verify(found.passwordHash, password);
  return valid ? { userId: found.userId, name: found.name, email: found.email } : null;
}

export async function updateUserPassword(userId, password) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return false;
  
  const { hash } = await import('@node-rs/argon2');
  users[id].passwordHash = await hash(password);
  users[id].updatedAt = new Date().toISOString();
  await saveUsers(users);
  return true;
}

export async function verifyUserPassword(userId, password) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return false;

  const { verify } = await import('@node-rs/argon2');
  return verify(users[id].passwordHash, password);
}

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
  };
}

export async function updateUserSettings(userId, { googleDriveFolder, colorPalette, n8nGenerationWebhook }) {
  const users = await getUsers();
  const id = sanitizeUserId(userId);
  if (!users[id]) return null;
  const errors = validateGenerationSettings({ googleDriveFolder, colorPalette, n8nGenerationWebhook });
  if (errors.length) {
    const e = new Error(errors[0]);
    e.code = 'VALIDATION_ERROR';
    e.details = errors;
    throw e;
  }
  if (googleDriveFolder !== undefined) users[id].googleDriveFolder = googleDriveFolder || null;
  if (colorPalette !== undefined) users[id].colorPalette = colorPalette || null;
  if (n8nGenerationWebhook !== undefined) users[id].n8nGenerationWebhook = n8nGenerationWebhook || null;
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

export async function addImage(userId, imageData) {
  const images = await getImages(userId);
  const newImage = {
    id: randomUUID(),
    url: imageData.url,
    alt: imageData.alt || '',
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
  
  images[index] = {
    ...images[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await saveImages(userId, images);
  return images[index];
}

export async function deleteImage(userId, id) {
  const images = await getImages(userId);
  const filtered = images.filter(img => img.id !== id);
  if (filtered.length === images.length) return false;
  
  await saveImages(userId, filtered);
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
  const images = newImages.map((img, index) => ({
    id: img.id || randomUUID(),
    url: img.url,
    alt: img.alt || '',
    order: img.order ?? index,
    createdAt: img.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  
  images.sort((a, b) => a.order - b.order);
  await saveImages(userId, images);
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

export function validateImageUrl(url) {
  // Rutas internas servidas por el propio dominio (imágenes re-hospedadas en
  // disco). No se aceptan absolutas de otros orígenes ni "//host".
  if (typeof url === 'string' && url.startsWith('/uploads/')) return true;
  return isHttpUrl(url);
}

export function validateImageData(data) {
  const errors = [];
  
  if (!data.url || typeof data.url !== 'string') {
    errors.push('URL is required');
  } else if (!validateImageUrl(data.url)) {
    errors.push('Invalid URL format (must be http/https)');
  }
  
  if (data.alt && typeof data.alt !== 'string') {
    errors.push('Alt text must be a string');
  }
  
  if (data.order !== undefined && (typeof data.order !== 'number' || !Number.isInteger(data.order))) {
    errors.push('Order must be an integer');
  }
  
  return errors;
}

// Partial validation for PATCH: only validates the fields that are present.
export function validateImagePatch(data) {
  const errors = [];

  if (data.url !== undefined && (typeof data.url !== 'string' || !validateImageUrl(data.url))) {
    errors.push('Invalid URL format (must be http/https)');
  }

  if (data.alt !== undefined && typeof data.alt !== 'string') {
    errors.push('Alt text must be a string');
  }

  if (data.order !== undefined && (typeof data.order !== 'number' || !Number.isInteger(data.order))) {
    errors.push('Order must be an integer');
  }

  return errors;
}

export function validateHexColor(color) {
  if (typeof color !== 'string') return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color.trim());
}

export function validateGenerationSettings({ googleDriveFolder, colorPalette, n8nGenerationWebhook }) {
  const errors = [];
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
