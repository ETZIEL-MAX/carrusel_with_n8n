// Lógica compartida de los endpoints por usuario:
//   POST /api/webhook/USERx  -> agregar/reemplazar imágenes del carrusel
//   POST /api/upload/USERx   -> re-hospedar una imagen temporal
//   POST /api/manage/USERx   -> listar / borrar / cambiar duración (desde el chat)
//
// La usan las rutas de Vercel (api/webhook/[userId].js, api/upload/[userId].js)
// y el servidor local (scripts/server.mjs).

import { randomUUID } from 'crypto';
import {
  appendImages, replaceAllImages, validateImageData, userExists,
  getImages, updateImage, deleteImage, updateUserSettings, isValidDuration,
  MIN_DURATION, MAX_DURATION, DEFAULT_SLIDE_DURATION,
  verifyWebhookSignature, isHttpUrl, sniffImageType,
  checkRateLimit, errorResponse, successResponse, getGenerationSettings, normalizeFormat,
} from './_utils.js';
import { putImage, isLocal, isLocalImages, optimizeImage } from './_store.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_WEBHOOK || '10', 10);
const MAX_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES || String(15 * 1024 * 1024), 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.UPLOAD_FETCH_TIMEOUT || '20000', 10);

const ALLOWED_HOSTS = (process.env.UPLOAD_ALLOWED_HOSTS || 'aliyuncs.com,cloudinary.com,pollinations.ai')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const CORS_OPTIONS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
  'Access-Control-Max-Age': '86400',
};

// `USER1`, `user2` -> `USER1` / `USER2`; cualquier otra cosa -> null.
export function normalizeUserId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().toUpperCase();
  return /^USER\d+$/.test(id) ? id : null;
}

// Extrae el userId de /api/webhook/USER1 o /api/upload/USER1 (para Vercel).
export function parseUserIdFromPath(request) {
  const { pathname } = new URL(request.url);
  const parts = pathname.split('/').filter(Boolean);
  return parts.length >= 3 ? decodeURIComponent(parts[2]) : null;
}

function isHostAllowed(url) {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return ALLOWED_HOSTS.some((suffix) => host === suffix || host.endsWith('.' + suffix));
  } catch {
    return false;
  }
}

// POST /api/webhook/:userId
// Body firmado (HMAC): { "images": [...], "mode": "append"|"replace" }
// `mode` por defecto "append": agrega sin borrar. "replace" sobrescribe todo.
export async function handleWebhook(request, rawUserId) {
  const userId = normalizeUserId(rawUserId);
  if (!userId) {
    return errorResponse('userId inválido en la URL (formato: /api/webhook/USER1)', 400);
  }

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`webhook:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  const signature = request.headers.get('x-webhook-secret');
  if (!signature) {
    return errorResponse('Missing signature', 401);
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, signature)) {
    return errorResponse('Invalid signature', 401);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const images = body?.images;
  const mode = body?.mode ?? 'append';
  const bodyUserId = body?.userId;

  if (bodyUserId !== undefined && normalizeUserId(bodyUserId) !== userId) {
    return errorResponse('El userId del cuerpo no coincide con la URL', 400);
  }

  if (mode !== 'append' && mode !== 'replace') {
    return errorResponse("mode debe ser 'append' o 'replace'", 400);
  }

  if (!Array.isArray(images)) {
    return errorResponse('Expected { images: [...] }', 400);
  }
  if (images.length === 0) {
    return errorResponse('Images array cannot be empty', 400);
  }
  if (images.length > 100) {
    return errorResponse('Maximum 100 images per request', 400);
  }

  const validationErrors = [];
  images.forEach((img, index) => {
    const errors = validateImageData(img);
    if (errors.length > 0) validationErrors.push({ index, errors });
  });
  if (validationErrors.length > 0) {
    return errorResponse('Validation failed', 400, validationErrors);
  }

  if (!(await userExists(userId))) {
    return errorResponse(`El carrusel ${userId} no existe`, 404);
  }

  try {
    if (mode === 'replace') {
      const replaced = await replaceAllImages(userId, images);
      return successResponse(
        { count: replaced.length, skipped: 0, images: replaced, userId, mode },
        `Carrusel de ${userId} reemplazado (${replaced.length} imágenes)`
      );
    }

    const { added, skipped, images: all } = await appendImages(userId, images);
    const extra = skipped ? ` (${skipped} ya existían)` : '';
    return successResponse(
      { count: added.length, skipped, images: all, userId, mode },
      `Añadidas ${added.length} imágenes a ${userId}${extra}`
    );
  } catch (err) {
    console.error('POST /api/webhook/:userId error:', err);
    return errorResponse('Failed to process webhook', 500);
  }
}

// POST /api/settings-read/:userId
// Body firmado (HMAC) — el cuerpo puede ir vacío o "{}". Devuelve la config de
// generación (carpeta de Drive + paleta de colores) para que n8n la lea al
// inicio de un run disparado por Telegram, sin necesidad de login.
export async function handleSettingsRead(request, rawUserId) {
  const userId = normalizeUserId(rawUserId);
  if (!userId) {
    return errorResponse('userId inválido en la URL (formato: /api/settings-read/USER1)', 400);
  }

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`settings-read:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  const signature = request.headers.get('x-webhook-secret');
  if (!signature) {
    return errorResponse('Missing signature', 401);
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, signature)) {
    return errorResponse('Invalid signature', 401);
  }

  if (!(await userExists(userId))) {
    return errorResponse(`El carrusel ${userId} no existe`, 404);
  }

  const settings = await getGenerationSettings(userId);
  if (!settings) {
    return errorResponse('User not found', 404);
  }

  return successResponse(
    {
      userId,
      googleDriveFolder: settings.googleDriveFolder || '',
      colorPalette: Array.isArray(settings.colorPalette) ? settings.colorPalette : [],
      defaultOrientation: normalizeFormat(settings.defaultOrientation),
    },
    'Settings'
  );
}

// POST /api/manage/:userId
// Body firmado (HMAC). Administra el carrusel desde n8n (chat) sin login:
//   { "action": "list" }
//   { "action": "delete",   "index": 3 }
//   { "action": "duration", "index": 3, "duration": 20 }
//   { "action": "duration", "index": "all", "duration": 12 }  -> duración por defecto
// `index` es la posición en el carrusel (1 = primera); también se acepta `id`.
export async function handleManage(request, rawUserId) {
  const userId = normalizeUserId(rawUserId);
  if (!userId) {
    return errorResponse('userId inválido en la URL (formato: /api/manage/USER1)', 400);
  }

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`manage:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  const signature = request.headers.get('x-webhook-secret');
  if (!signature) {
    return errorResponse('Missing signature', 401);
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, signature)) {
    return errorResponse('Invalid signature', 401);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { action, index, id, duration } = body || {};
  if (!['list', 'delete', 'duration'].includes(action)) {
    return errorResponse("action debe ser 'list', 'delete' o 'duration'", 400);
  }

  if (!(await userExists(userId))) {
    return errorResponse(`El carrusel ${userId} no existe`, 404);
  }

  try {
    const settings = await getGenerationSettings(userId);
    const slideDuration = settings?.slideDuration ?? DEFAULT_SLIDE_DURATION;
    const sorted = (await getImages(userId)).slice().sort((a, b) => a.order - b.order);

    if (action === 'list') {
      const images = sorted.map((img, i) => ({
        index: i + 1,
        id: img.id,
        url: img.url,
        alt: img.alt || '',
        duration: img.duration ?? null,
        effectiveDuration: img.duration ?? slideDuration,
      }));
      return successResponse(
        { userId, count: sorted.length, slideDuration, images },
        `${sorted.length} imágenes en ${userId}`
      );
    }

    if (action === 'duration') {
      if (!isValidDuration(duration)) {
        return errorResponse(`La duración debe ser un número entero entre ${MIN_DURATION} y ${MAX_DURATION} segundos`, 400);
      }
      if (index === 'all') {
        await updateUserSettings(userId, { slideDuration: duration });
        return successResponse(
          { userId, index: 'all', slideDuration: duration, count: sorted.length },
          `Duración por defecto de ${userId}: ${duration} s`
        );
      }
    }

    // Localizar la imagen por id o por posición (1..n).
    const byId = typeof id === 'string' && id !== '';
    const pos = byId
      ? sorted.findIndex((img) => img.id === id)
      : (Number.isInteger(index) ? index - 1 : -1);
    const target = pos >= 0 ? sorted[pos] : null;
    if (!target) {
      const which = byId ? 'esa imagen' : `la imagen #${index}`;
      return errorResponse(`No existe ${which}; hay ${sorted.length} en el carrusel`, 404);
    }

    if (action === 'duration') {
      const updated = await updateImage(userId, target.id, { duration });
      return successResponse(
        { userId, index: pos + 1, id: target.id, url: target.url, duration: updated.duration },
        `La imagen #${pos + 1} ahora dura ${duration} s`
      );
    }

    await deleteImage(userId, target.id);
    return successResponse(
      { userId, index: pos + 1, id: target.id, url: target.url, count: sorted.length - 1 },
      `Borrada la imagen #${pos + 1}. Quedan ${sorted.length - 1}`
    );
  } catch (err) {
    console.error('POST /api/manage/:userId error:', err);
    return errorResponse('Failed to manage carousel', 500);
  }
}

// POST /api/upload/:userId
// Body firmado (HMAC). Dos formas:
//   1) Binario:  { "data": "<base64>", "contentType": "image/png", "alt": "" }
//      (la imagen viene en el cuerpo; no hay descarga ni SSRF)
//   2) URL:      { "url": "<URL temporal>", "alt": "" }
export async function handleUpload(request, rawUserId) {
  const userId = normalizeUserId(rawUserId);
  if (!userId) {
    return errorResponse('userId inválido en la URL (formato: /api/upload/USER1)', 400);
  }

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`upload:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  const signature = request.headers.get('x-webhook-secret');
  if (!signature) {
    return errorResponse('Missing signature', 401);
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, signature)) {
    return errorResponse('Invalid signature', 401);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { url, data, alt: rawAlt, userId: bodyUserId } = body || {};

  if (bodyUserId !== undefined && normalizeUserId(bodyUserId) !== userId) {
    return errorResponse('El userId del cuerpo no coincide con la URL', 400);
  }

  const alt = typeof rawAlt === 'string' ? rawAlt.trim().slice(0, 300) : '';

  if (!isLocalImages() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return errorResponse('Almacenamiento no configurado (falta BLOB_READ_WRITE_TOKEN)', 500);
  }

  // ---- Modo binario (base64 en el cuerpo) ----
  if (typeof data === 'string' && data.length > 0) {
    let b64 = data;
    const m = /^data:([^;,]+);base64,/.exec(b64);
    if (m) b64 = b64.slice(m[0].length);

    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      return errorResponse('Contenido base64 inválido', 400);
    }
    if (buffer.length === 0) return errorResponse('Imagen vacía', 400);
    if (buffer.length > MAX_BYTES) {
      return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
    }

    const kind = sniffImageType(buffer);
    if (!kind) {
      return errorResponse('El contenido no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);
    }

    try {
      const opt = await optimizeImage(buffer, kind); // WebP de alta calidad
      const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${opt.ext}`;
      const stored = await putImage(fileName, opt.buffer, opt.type, request);
      return successResponse(
        { url: stored.url, pathname: stored.pathname, contentType: kind.type, alt, userId },
        'Image stored permanently'
      );
    } catch (err) {
      console.error('POST /api/upload/:userId (binary) error:', err);
      const detail = [err?.name, err?.message].filter(Boolean).join(' | ');
      return errorResponse(`Error al guardar la imagen: ${detail || 'error'}`, 500);
    }
  }

  // ---- Modo URL (descarga y re-hospeda) ----
  if (!url || typeof url !== 'string' || !isHttpUrl(url)) {
    return errorResponse('Se requiere "data" (base64) o una "url" de imagen válida (http/https)', 400);
  }

  if (!isLocal() && !isHostAllowed(url)) {
    return errorResponse(
      `Host no permitido. Configura UPLOAD_ALLOWED_HOSTS. Host recibido: ${(() => {
        try { return new URL(url).hostname; } catch { return 'invalido'; }
      })()}`,
      400
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let phase = 'download';

  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      return errorResponse(`No se pudo descargar la imagen (${res.status})`, 502);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return errorResponse('La URL no devuelve una imagen', 400);
    }

    const declaredLength = parseInt(res.headers.get('content-length') || '0', 10);
    if (declaredLength && declaredLength > MAX_BYTES) {
      return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
    }

    // No confiar en el content-type remoto: verificar que los bytes sean una imagen.
    const kind = sniffImageType(buffer);
    if (!kind) {
      return errorResponse('El contenido descargado no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);
    }
    const opt = await optimizeImage(buffer, kind);
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${opt.ext}`;

    phase = 'upload';
    const stored = await putImage(fileName, opt.buffer, opt.type, request);

    return successResponse(
      { url: stored.url, pathname: stored.pathname, contentType: stored.contentType, alt, userId },
      'Image re-hosted permanently'
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      return errorResponse('Tiempo de descarga agotado', 504);
    }
    console.error(`POST /api/upload/:userId error (${phase}):`, err);
    if (phase === 'upload') {
      const detail = [err?.name, err?.message, err?.cause?.message].filter(Boolean).join(' | ');
      return errorResponse(`Error al guardar la imagen: ${detail || 'error'}`, 500);
    }
    return errorResponse(`No se pudo descargar la imagen: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}
