import { randomUUID } from 'crypto';
import { putImage, isLocalImages, optimizeImage } from './_store.js';
import {
  addImage, getUsers, sniffImageType,
  verifyToken, getTokenFromCookie, checkRateLimit,
  errorResponse, successResponse,
  isSuperAdmin, isUser,
} from './_utils.js';

// Manual upload from the admin panel (PC / phone).
// POST /api/images-upload[?userId=USER2]  multipart/form-data: file=<image>, alt=<optional text>
// Auth: session cookie. A user uploads to their own carousel; the super-admin must pass ?userId.
// The browser already resizes to max 1920px, so files are small; the limit stays below
// Vercel's 4.5 MB request body cap.

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_MANUAL_UPLOAD || '30', 10);
const MAX_BYTES = parseInt(process.env.MANUAL_UPLOAD_MAX_BYTES || String(4 * 1024 * 1024), 10);

async function resolveTarget(request) {
  const token = getTokenFromCookie(request);
  if (!token) return errorResponse('Unauthorized', 401);
  const payload = await verifyToken(token);
  if (!payload || (!isSuperAdmin(payload) && !isUser(payload))) return errorResponse('Forbidden', 403);

  const requested = new URL(request.url).searchParams.get('userId');
  const requestedId = requested ? requested.trim().toUpperCase() : null;

  if (isUser(payload)) {
    if (requestedId && requestedId !== payload.userId) return errorResponse('Forbidden', 403);
    return payload.userId;
  }

  if (!requestedId || !/^USER\d+$/.test(requestedId)) {
    return errorResponse('userId required for super-admin', 400);
  }
  const users = await getUsers();
  if (!users[requestedId]) return errorResponse('User not found', 404);
  return requestedId;
}

export async function POST(request) {
  const userId = await resolveTarget(request);
  if (userId instanceof Response) return userId;

  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = checkRateLimit(`manual-upload:${clientIp}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  if (!isLocalImages() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return errorResponse('Almacenamiento no configurado (falta BLOB_READ_WRITE_TOKEN)', 500);
  }

  const declared = parseInt(request.headers.get('content-length') || '0', 10);
  if (declared && declared > MAX_BYTES + 64 * 1024) {
    return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return errorResponse('Expected multipart/form-data with a "file" field', 400);
  }

  const file = form.get('file');
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return errorResponse('Missing "file" field', 400);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return errorResponse('Empty file', 400);
  if (buffer.length > MAX_BYTES) {
    return errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);
  }

  const kind = sniffImageType(buffer);
  if (!kind) return errorResponse('El archivo no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);

  const rawAlt = form.get('alt');
  const alt = typeof rawAlt === 'string' ? rawAlt.trim().slice(0, 300) : '';

  try {
    const opt = await optimizeImage(buffer, kind); // WebP de alta calidad
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${opt.ext}`;
    const stored = await putImage(fileName, opt.buffer, opt.type, request);
    const image = await addImage(userId, { url: stored.url, alt });
    return successResponse({ ...image, userId }, 'Image uploaded');
  } catch (err) {
    console.error('POST /api/images-upload error:', err);
    const detail = [err?.name, err?.message].filter(Boolean).join(' | ');
    return errorResponse(`Error al guardar la imagen: ${detail || 'error'}`, 500);
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
