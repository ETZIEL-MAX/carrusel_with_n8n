import { SignJWT, jwtVerify } from 'jose';
import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import { getJson, setJson } from './_redis.js';

const IMAGES_KEY = 'carousel:images';
const DEFAULT_IMAGES = [];

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

// ==================== Image Operations ====================

export async function getImages() {
  const images = await getJson(IMAGES_KEY);
  return Array.isArray(images) ? images : DEFAULT_IMAGES;
}

export async function saveImages(images) {
  await setJson(IMAGES_KEY, images);
}

export async function addImage(imageData) {
  const images = await getImages();
  const newImage = {
    id: randomUUID(),
    url: imageData.url,
    alt: imageData.alt || '',
    order: imageData.order ?? (images.length > 0 ? Math.max(...images.map(i => i.order)) + 1 : 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  images.push(newImage);
  await saveImages(images);
  return newImage;
}

export async function updateImage(id, updates) {
  const images = await getImages();
  const index = images.findIndex(img => img.id === id);
  if (index === -1) return null;
  
  images[index] = {
    ...images[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  await saveImages(images);
  return images[index];
}

export async function deleteImage(id) {
  const images = await getImages();
  const filtered = images.filter(img => img.id !== id);
  if (filtered.length === images.length) return false;
  
  await saveImages(filtered);
  return true;
}

export async function reorderImages(imageOrders) {
  // imageOrders: [{ id, order }, ...]
  const images = await getImages();
  const orderMap = new Map(imageOrders.map(({ id, order }) => [id, order]));
  
  images.forEach(img => {
    if (orderMap.has(img.id)) {
      img.order = orderMap.get(img.id);
      img.updatedAt = new Date().toISOString();
    }
  });
  
  images.sort((a, b) => a.order - b.order);
  await saveImages(images);
  return images;
}

export async function replaceAllImages(newImages) {
  const images = newImages.map((img, index) => ({
    id: img.id || randomUUID(),
    url: img.url,
    alt: img.alt || '',
    order: img.order ?? index,
    createdAt: img.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  
  images.sort((a, b) => a.order - b.order);
  await saveImages(images);
  return images;
}

// ==================== Validation ====================

export function validateImageUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
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
