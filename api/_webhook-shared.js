// Lógica compartida de los endpoints por usuario:
//   POST /api/webhook/USERx  -> agregar/reemplazar imágenes del carrusel
//   POST /api/upload/USERx   -> re-hospedar una imagen temporal
//   POST /api/manage/USERx   -> listar / borrar / cambiar duración (desde el chat)
//
// La usan las rutas de Vercel (api/webhook/[userId].js, api/upload/[userId].js)
// y el servidor local (scripts/server.mjs).

import { randomUUID } from 'crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  appendImages, replaceAllImages, validateImageData, userExists,
  getImages, updateImage, deleteImage, updateUserSettings, isValidDuration,
  MIN_DURATION, MAX_DURATION, DEFAULT_SLIDE_DURATION,
  verifyClientSignature, clientSignatureHasher, isHttpUrl, sniffImageType, normalizeUserId, getClientIp,
  saveUserFile, saveImageFromTemp, quotaErrorResponse, recordUsage, getUsageSummary, USAGE_KINDS,
  checkRateLimit, errorResponse, successResponse, getGenerationSettings, normalizeFormat,
} from './_utils.js';
import { isLocal, isLocalImages, optimizeImage, uploadTempDir } from './_store.js';
import { writeCapped, withUploadSlot, cleanupTemp } from './_stream.js';

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_WEBHOOK || '10', 10);
const MAX_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES || String(15 * 1024 * 1024), 10);
// En base64 el cuerpo entero pasa por memoria (texto + JSON + bytes): tope más bajo.
const BASE64_MAX_BYTES = Math.min(MAX_BYTES, parseInt(process.env.UPLOAD_BASE64_MAX_BYTES || String(8 * 1024 * 1024), 10));
// Un JSON de upload más grande que esto no puede traer una imagen aceptable: el servidor
// lo rechaza antes de juntarlo en memoria (base64 ocupa 4/3 de los bytes).
const BASE64_MAX_CHARS = Math.ceil(BASE64_MAX_BYTES / 3) * 4;
export const UPLOAD_JSON_BODY_LIMIT = BASE64_MAX_CHARS + 64 * 1024;
export const BASE64_TOO_BIG = `Imagen demasiado grande para enviarla en base64 (máx ${Math.round(BASE64_MAX_BYTES / 1048576)} MB). Envíala en binario: el archivo como cuerpo de la petición, con Content-Type image/*.`;
const FETCH_TIMEOUT_MS = parseInt(process.env.UPLOAD_FETCH_TIMEOUT || '20000', 10);

const ALLOWED_HOSTS = (process.env.UPLOAD_ALLOWED_HOSTS || 'aliyuncs.com,cloudinary.com,pollinations.ai')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const CORS_OPTIONS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret, X-Webhook-Timestamp',
  'Access-Control-Max-Age': '86400',
};

export { normalizeUserId };

// Lo que se revisa antes de leer el cuerpo: userId válido, límite de peticiones y que
// venga una firma. Devuelve el userId o una Response.
function admitClient(request, rawUserId, route) {
  const userId = normalizeUserId(rawUserId);
  if (!userId) {
    return errorResponse(`userId inválido en la URL (formato: /api/${route}/USER1)`, 400);
  }

  const rateLimit = checkRateLimit(`${route}:${getClientIp(request)}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  if (!request.headers.get('x-webhook-secret')) {
    return errorResponse('Missing signature', 401);
  }
  return userId;
}

// Paso común de todos los endpoints de n8n: userId válido, límite de peticiones y
// firma del cliente sobre el cuerpo crudo. Devuelve { userId, rawBody } o una Response.
async function authorizeClient(request, rawUserId, route) {
  const userId = admitClient(request, rawUserId, route);
  if (userId instanceof Response) return userId;

  const rawBody = await request.text();
  const check = await verifyClientSignature(userId, rawBody, request);
  if (!check.ok) {
    return errorResponse(check.error, 401);
  }
  return { userId, rawBody };
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
  const auth = await authorizeClient(request, rawUserId, 'webhook');
  if (auth instanceof Response) return auth;
  const { userId, rawBody } = auth;

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
  const auth = await authorizeClient(request, rawUserId, 'settings-read');
  if (auth instanceof Response) return auth;
  const { userId, rawBody } = auth;

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
  const auth = await authorizeClient(request, rawUserId, 'manage');
  if (auth instanceof Response) return auth;
  const { userId, rawBody } = auth;

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

// POST /api/usage/:userId
// Body firmado (HMAC). n8n avisa cada vez que genera algo para este cliente:
//   { "eventId": "<id único>", "kind": "image"|"video"|"text", "model": "wan2.7-image-pro",
//     "count": 1, "tokens": { "input": 0, "output": 0, "total": 0 }, "seconds": 5 }
// `tokens` es lo que reporta el proveedor (también se aceptan input_tokens/output_tokens/
// total_tokens o prompt_tokens/completion_tokens); si no hay, la imagen se cuenta sin tokens
// y entra en el costo aproximado. `eventId` evita sumar dos veces si n8n reintenta.
export async function handleUsageReport(request, rawUserId) {
  const auth = await authorizeClient(request, rawUserId, 'usage');
  if (auth instanceof Response) return auth;
  const { userId, rawBody } = auth;

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { eventId, kind, count, tokens, seconds } = body || {};
  if (!USAGE_KINDS.includes(kind)) {
    return errorResponse(`kind debe ser uno de: ${USAGE_KINDS.join(', ')}`, 400);
  }
  if (eventId !== undefined && (typeof eventId !== 'string' || !eventId || eventId.length > 200)) {
    return errorResponse('eventId debe ser un texto de hasta 200 caracteres', 400);
  }

  if (!(await userExists(userId))) {
    return errorResponse(`El carrusel ${userId} no existe`, 404);
  }

  try {
    const recorded = await recordUsage(userId, { eventId, kind, count, tokens, seconds });
    const summary = await getUsageSummary(userId);
    return successResponse(
      { userId, duplicate: recorded.duplicate, usage: summary },
      recorded.duplicate ? 'Evento ya contado' : 'Consumo registrado'
    );
  } catch (err) {
    console.error('POST /api/usage/:userId error:', err);
    return errorResponse('No se pudo registrar el consumo', 500);
  }
}

// ¿El cuerpo es la imagen tal cual (y no JSON)?
export function isBinaryUpload(contentType) {
  const type = String(contentType || '').toLowerCase();
  return type.startsWith('image/') || type.startsWith('application/octet-stream');
}

// POST /api/upload/:userId[?alt=texto]  con Content-Type: image/* — el cuerpo es la imagen.
// La firma es la de siempre, sobre los bytes: HMAC(token, "<timestamp>." + cuerpo).
// El cuerpo se escribe a un temporal mientras llega y se firma al vuelo: no pasa por memoria.
async function handleUploadBinary(request, rawUserId, stream) {
  const userId = admitClient(request, rawUserId, 'upload');
  if (userId instanceof Response) return userId;

  const hasher = await clientSignatureHasher(userId, request);
  if (hasher.error) return errorResponse(hasher.error, 401);

  const tooBig = () => errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
  const declared = parseInt(request.headers.get('content-length') || '0', 10) || 0;
  if (declared > MAX_BYTES) return tooBig();
  if (!stream) return errorResponse('Falta la imagen en el cuerpo de la petición', 400);

  const rawAlt = new URL(request.url).searchParams.get('alt');
  const alt = typeof rawAlt === 'string' ? rawAlt.trim().slice(0, 300) : '';

  const dir = uploadTempDir();
  const tmp = join(dir, `.tmp-${randomUUID()}`);
  try {
    await mkdir(dir, { recursive: true });
    const size = await withUploadSlot(() => writeCapped(stream, tmp, MAX_BYTES, hasher.update));
    if (size === -1) return tooBig();

    // Nada se guarda ni se procesa hasta que la firma de los bytes recibidos cuadra.
    const check = await hasher.verify();
    if (!check.ok) return errorResponse(check.error, 401);
    if (size === 0) return errorResponse('Imagen vacía', 400);

    if (!(await userExists(userId))) {
      return errorResponse(`El carrusel ${userId} no existe`, 404);
    }
    if (!isLocalImages() && !process.env.BLOB_READ_WRITE_TOKEN) {
      return errorResponse('Almacenamiento no configurado (falta BLOB_READ_WRITE_TOKEN)', 500);
    }

    const stored = await saveImageFromTemp(userId, tmp);
    if (!stored) {
      return errorResponse('El contenido no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);
    }
    return successResponse(
      { url: stored.url, pathname: stored.pathname, contentType: stored.contentType, alt, userId },
      'Image stored permanently'
    );
  } catch (err) {
    const full = quotaErrorResponse(err);
    if (full) return full;
    console.error('POST /api/upload/:userId (raw) error:', err);
    return errorResponse('Error al guardar la imagen', 500);
  } finally {
    await cleanupTemp(tmp);
  }
}

// POST /api/upload/:userId
// Body firmado (HMAC). Tres formas:
//   1) Binario:  el cuerpo es la imagen (Content-Type: image/*). La recomendada: no usa memoria.
//   2) Base64:   { "data": "<base64>", "contentType": "image/png", "alt": "" }  (imágenes chicas)
//   3) URL:      { "url": "<URL temporal>", "alt": "" }
// `stream`: el cuerpo como Readable cuando el servidor no lo juntó (solo en la forma 1).
export async function handleUpload(request, rawUserId, stream = null) {
  if (isBinaryUpload(request.headers.get('content-type'))) {
    const body = stream || (request.body ? Readable.fromWeb(request.body) : null);
    return handleUploadBinary(request, rawUserId, body);
  }

  const auth = await authorizeClient(request, rawUserId, 'upload');
  if (auth instanceof Response) return auth;
  const { userId, rawBody } = auth;

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

  // El archivo se anota en la cuenta de espacio del usuario: tiene que existir.
  if (!(await userExists(userId))) {
    return errorResponse(`El carrusel ${userId} no existe`, 404);
  }

  if (!isLocalImages() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return errorResponse('Almacenamiento no configurado (falta BLOB_READ_WRITE_TOKEN)', 500);
  }

  // ---- Modo binario (base64 en el cuerpo) ----
  if (typeof data === 'string' && data.length > 0) {
    let b64 = data;
    const m = /^data:([^;,]+);base64,/.exec(b64);
    if (m) b64 = b64.slice(m[0].length);
    // Antes de decodificar: no se reserva memoria para algo que se va a rechazar.
    if (b64.length > BASE64_MAX_CHARS + 4) return errorResponse(BASE64_TOO_BIG, 413);

    let buffer;
    try {
      buffer = Buffer.from(b64, 'base64');
    } catch {
      return errorResponse('Contenido base64 inválido', 400);
    }
    if (buffer.length === 0) return errorResponse('Imagen vacía', 400);
    if (buffer.length > BASE64_MAX_BYTES) {
      return errorResponse(BASE64_TOO_BIG, 413);
    }

    const kind = sniffImageType(buffer);
    if (!kind) {
      return errorResponse('El contenido no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);
    }

    try {
      const opt = await optimizeImage(buffer, kind); // WebP de alta calidad
      const stored = await saveUserFile(userId, opt.buffer, opt.type, opt.ext, request);
      return successResponse(
        { url: stored.url, pathname: stored.pathname, contentType: kind.type, alt, userId },
        'Image stored permanently'
      );
    } catch (err) {
      const full = quotaErrorResponse(err);
      if (full) return full;
      console.error('POST /api/upload/:userId (binary) error:', err);
      return errorResponse('Error al guardar la imagen', 500);
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
  let tmp = null;

  try {
    // Las redirecciones se siguen a mano: cada salto tiene que ser a un host permitido
    // (si no, un host permitido podría redirigir a una dirección interna).
    let res;
    let target = url;
    for (let hop = 0; ; hop++) {
      res = await fetch(target, { signal: controller.signal, redirect: 'manual' });
      if (res.status < 300 || res.status >= 400) break;
      const next = res.headers.get('location');
      if (!next || hop >= 3) return errorResponse('Demasiadas redirecciones al descargar la imagen', 502);
      target = new URL(next, target).toString();
      if (!isHttpUrl(target) || (!isLocal() && !isHostAllowed(target))) {
        return errorResponse('La imagen redirige a un host no permitido', 400);
      }
    }
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

    // La imagen se escribe a un temporal mientras llega (no se carga entera en memoria).
    if (!res.body) return errorResponse('La URL no devuelve una imagen', 400);
    const dir = uploadTempDir();
    tmp = join(dir, `.tmp-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const size = await writeCapped(Readable.fromWeb(res.body), tmp, MAX_BYTES);
    if (size === -1) {
      return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
    }
    if (size === 0) return errorResponse('Imagen vacía', 400);

    // No confiar en el content-type remoto: saveImageFromTemp verifica los bytes.
    phase = 'upload';
    const stored = await saveImageFromTemp(userId, tmp);
    if (!stored) {
      return errorResponse('El contenido descargado no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);
    }

    return successResponse(
      { url: stored.url, pathname: stored.pathname, contentType: stored.contentType, alt, userId },
      'Image re-hosted permanently'
    );
  } catch (err) {
    if (err.name === 'AbortError') {
      return errorResponse('Tiempo de descarga agotado', 504);
    }
    const full = quotaErrorResponse(err);
    if (full) return full;
    console.error(`POST /api/upload/:userId error (${phase}):`, err);
    if (phase === 'upload') {
      return errorResponse('Error al guardar la imagen', 500);
    }
    return errorResponse('No se pudo descargar la imagen', 502);
  } finally {
    clearTimeout(timer);
    if (tmp) await cleanupTemp(tmp);
  }
}
