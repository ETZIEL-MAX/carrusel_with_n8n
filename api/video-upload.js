import { randomUUID } from 'crypto';
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { isLocalImages, localUploadsDir } from './_store.js';
import { inspectVideo } from './_video.js';
import { writeCapped, withUploadSlot, sweepStaleTemps, cleanupTemp } from './_stream.js';
import {
  addImage, getUsers, requireSession, resolveUserId, isUser, checkRateLimit, getClientIp,
  assertFits, registerUserFile, quotaErrorResponse,
  errorResponse, successResponse,
} from './_utils.js';

// Subida de video desde el panel (PC / celular).
// POST /api/video-upload[?userId=USER2][&alt=texto]   cuerpo = el archivo tal cual (MP4 o MOV en H.264)
// Auth: cookie de sesión. Un usuario sube a su carrusel; el super-admin pasa ?userId.
//
// El video NO se carga en memoria: el servidor (scripts/server.mjs) pasa el flujo de la
// petición y aquí se escribe directo a disco, con tope de tamaño. Por eso no es un
// handler normal de Request/Response con cuerpo: `handleVideoUpload(request, stream)`.

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_MANUAL_UPLOAD || '30', 10);
const MAX_BYTES = parseInt(process.env.VIDEO_MAX_BYTES || String(50 * 1024 * 1024), 10);
const maxMb = () => Math.round(MAX_BYTES / 1048576);

const tooBig = () => errorResponse(`Video demasiado grande (máx ${maxMb()} MB)`, 413);

// `request`: Request sin cuerpo (URL, método y cabeceras). `stream`: el cuerpo (Readable).
export async function handleVideoUpload(request, stream) {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;

  const userId = resolveUserId(request, auth.payload);
  if (userId instanceof Response) return userId;
  if (!isUser(auth.payload)) {
    const users = await getUsers();
    if (!users[userId]) return errorResponse('User not found', 404);
  }

  const rateLimit = checkRateLimit(`video-upload:${getClientIp(request)}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  if (!isLocalImages()) {
    return errorResponse('La subida de video solo está disponible con almacenamiento en disco', 501);
  }

  const declared = parseInt(request.headers.get('content-length') || '0', 10) || 0;
  if (declared > MAX_BYTES) return tooBig();

  const dir = localUploadsDir();
  // Nombre con punto inicial: el servidor nunca sirve estos temporales.
  const tmp = join(dir, `.tmp-${randomUUID()}`);
  let keepTmp = false;
  try {
    // ¿Cabe en su espacio? Con el tamaño declarado antes de recibir nada...
    const usage = await assertFits(userId, declared);
    await mkdir(dir, { recursive: true });
    await sweepStaleTemps(dir);

    // ...y con tope real mientras llega (el tamaño declarado puede no venir o mentir).
    const size = await withUploadSlot(() => writeCapped(stream, tmp, MAX_BYTES));
    if (size === -1) return tooBig();
    if (size === 0) return errorResponse('Video vacío', 400);
    if (size > usage.freeBytes) await assertFits(userId, size);

    const info = await inspectVideo(tmp);
    if (!info.ok) return errorResponse(info.error, 400);

    const fileName = `${userId}-${Date.now()}-${randomUUID().slice(0, 8)}.${info.container}`;
    await rename(tmp, join(dir, fileName));
    keepTmp = true;
    await registerUserFile(userId, fileName, size);

    const rawAlt = new URL(request.url).searchParams.get('alt');
    const alt = typeof rawAlt === 'string' ? rawAlt.trim().slice(0, 300) : '';
    const item = await addImage(userId, {
      url: `/uploads/${fileName}`, alt, type: 'video',
      width: info.width, height: info.height, durationSec: info.durationSec, bytes: size,
    });
    return successResponse({ ...item, userId, bytes: size }, 'Video uploaded');
  } catch (err) {
    const full = quotaErrorResponse(err);
    if (full) return full;
    console.error('POST /api/video-upload error:', err);
    return errorResponse('Error al guardar el video', 500);
  } finally {
    // Solo se borra el temporal de ESTA subida (si ya se movió, no existe y no pasa nada).
    if (!keepTmp) await cleanupTemp(tmp);
  }
}

// En Vercel el cuerpo llega completo y limitado a 4.5 MB: no sirve para video.
export async function POST() {
  return errorResponse('La subida de video no está disponible en este despliegue', 501);
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
