import { randomUUID } from 'crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { isLocalImages, uploadTempDir } from './_store.js';
import {
  addImage, getUsers, requireSession, resolveUserId, checkRateLimit, getClientIp,
  assertFits, saveImageFromTemp, quotaErrorResponse, setVideoPoster, isVideoItem, removeUserFile,
  errorResponse, successResponse,
  isUser,
} from './_utils.js';
import { writeCapped, withUploadSlot, sweepStaleTemps, cleanupTemp } from './_stream.js';

// Subida de imagen desde el panel (PC / celular).
// POST /api/images-upload[?userId=USER2][&alt=texto]   cuerpo = la imagen tal cual
// Auth: cookie de sesión. Un usuario sube a su carrusel; el super-admin pasa ?userId.
// Con &posterFor=<id de un video> la imagen no se añade al carrusel: queda como
// miniatura (primer cuadro) de ese video.
//
// El cuerpo NO se junta en memoria: se escribe a un temporal mientras llega, y de ahí
// pasa a sharp (WebP) y al carrusel. Por eso el handler recibe el flujo aparte:
// `handleImageUpload(request, stream)`. El navegador ya reduce la foto a 1920 px.

const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_MANUAL_UPLOAD || '30', 10);
const MAX_BYTES = parseInt(process.env.MANUAL_UPLOAD_MAX_BYTES || String(25 * 1024 * 1024), 10);

const tooBig = () => errorResponse(`Imagen demasiado grande (máx ${Math.round(MAX_BYTES / 1048576)} MB)`, 413);

async function resolveTarget(request) {
  const auth = await requireSession(request);
  if (auth instanceof Response) return auth;
  const { payload } = auth;

  const userId = resolveUserId(request, payload);
  if (userId instanceof Response || isUser(payload)) return userId;

  const users = await getUsers();
  if (!users[userId]) return errorResponse('User not found', 404);
  return userId;
}

// `request`: Request sin cuerpo (URL, método y cabeceras). `stream`: el cuerpo (Readable).
export async function handleImageUpload(request, stream) {
  const userId = await resolveTarget(request);
  if (userId instanceof Response) return userId;

  const rateLimit = checkRateLimit(`manual-upload:${getClientIp(request)}:${userId}`, RATE_LIMIT);
  if (!rateLimit.allowed) {
    return errorResponse('Rate limit exceeded', 429, { resetAt: rateLimit.resetAt });
  }

  if (!isLocalImages() && !process.env.BLOB_READ_WRITE_TOKEN) {
    return errorResponse('Almacenamiento no configurado (falta BLOB_READ_WRITE_TOKEN)', 500);
  }

  const declared = parseInt(request.headers.get('content-length') || '0', 10) || 0;
  if (declared > MAX_BYTES) return tooBig();
  if (!stream) return errorResponse('Falta la imagen en el cuerpo de la petición', 400);

  const params = new URL(request.url).searchParams;
  const rawAlt = params.get('alt');
  const alt = typeof rawAlt === 'string' ? rawAlt.trim().slice(0, 300) : '';
  const posterFor = params.get('posterFor');
  if (posterFor !== null && !(await isVideoItem(userId, posterFor))) {
    return errorResponse('Ese video no existe en este carrusel', 404);
  }

  const dir = uploadTempDir();
  // Nombre con punto inicial: el servidor nunca sirve estos temporales.
  const tmp = join(dir, `.tmp-${randomUUID()}`);
  try {
    await mkdir(dir, { recursive: true });
    await sweepStaleTemps(dir);
    // ¿Cabe en su espacio? Con el tamaño declarado antes de recibir nada...
    await assertFits(userId, declared);

    // ...y con tope real mientras llega (el tamaño declarado puede no venir o mentir).
    const size = await withUploadSlot(() => writeCapped(stream, tmp, MAX_BYTES));
    if (size === -1) return tooBig();
    if (size === 0) return errorResponse('Imagen vacía', 400);

    const stored = await saveImageFromTemp(userId, tmp);
    if (!stored) return errorResponse('El archivo no es una imagen válida (JPEG, PNG, WebP o GIF)', 400);

    if (posterFor !== null) {
      const video = await setVideoPoster(userId, posterFor, stored.url);
      if (!video) {
        // El video se borró mientras subía su miniatura: no dejar la imagen suelta.
        await removeUserFile(userId, { url: stored.url }).catch(() => {});
        return errorResponse('Ese video no existe en este carrusel', 404);
      }
      return successResponse({ ...video, userId }, 'Poster saved');
    }

    const image = await addImage(userId, { url: stored.url, alt });
    return successResponse({ ...image, userId }, 'Image uploaded');
  } catch (err) {
    const full = quotaErrorResponse(err);
    if (full) return full;
    console.error('POST /api/images-upload error:', err);
    return errorResponse('Error al guardar la imagen', 500);
  } finally {
    // Siempre: si el archivo ya se movió, no existe y no pasa nada.
    await cleanupTemp(tmp);
  }
}

// En Vercel el cuerpo llega como Web stream (limitado a 4.5 MB por la plataforma).
export async function POST(request) {
  return handleImageUpload(request, request.body ? Readable.fromWeb(request.body) : null);
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
